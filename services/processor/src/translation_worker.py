"""
Background translation worker.

Ingest never translates: it stores messages with translation_status='pending' (see
plan_translation) and this worker translates them afterwards, newest first.

Queue state lives in the messages table (migration 007), so it survives restarts:
  pending -> done      translated
  pending -> skipped   older than TRANSLATION_MAX_AGE_HOURS
  pending -> failed    TRANSLATION_MAX_ATTEMPTS attempts used up (see translation_last_error)
A claimed row is leased by pushing translation_next_attempt_at forward, so several
processor instances never translate the same message and a crashed worker's rows come
back after the lease expires.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Tuple

from sqlalchemy import text

from config.settings import settings
from observability.metrics import translation_deepl_chars_today
from translation import ProviderBusy, TranslationError, detect_language

logger = logging.getLogger(__name__)

LEASE_SECONDS = 600
MAX_RETRY_DELAY_SECONDS = 900
RETRY_BASE_DELAY_SECONDS = 60
MAX_ERROR_LENGTH = 500

CLAIM_SQL = text("""
    UPDATE messages SET translation_next_attempt_at = now() + make_interval(secs => :lease)
    WHERE id IN (
        SELECT id FROM messages
        WHERE translation_status = 'pending'
          AND (translation_next_attempt_at IS NULL OR translation_next_attempt_at <= now())
        ORDER BY telegram_date DESC
        LIMIT :n FOR UPDATE SKIP LOCKED)
    RETURNING id, content, language_detected, translation_attempts, telegram_date
""")
STALE_SQL = text("""
    UPDATE messages SET translation_status = 'skipped', translation_last_error = 'stale',
                        translation_next_attempt_at = NULL
    WHERE translation_status = 'pending'
      AND COALESCE(telegram_date, created_at) < now() - make_interval(hours => :hours)
""")
DONE_SQL = text("""
    UPDATE messages SET content_translated = :translated, translation_provider = :provider,
        translation_target = :target, translation_timestamp = now(), translation_status = 'done',
        translation_last_error = NULL, translation_next_attempt_at = NULL
    WHERE id = :id
""")
RESCHEDULE_SQL = text("""
    UPDATE messages SET translation_status = :status, translation_attempts = :attempts,
        translation_last_error = :error,
        translation_next_attempt_at = now() + make_interval(secs => :delay)
    WHERE id = :id
""")
RELEASE_SQL = text("""
    UPDATE messages SET translation_next_attempt_at = now() + make_interval(secs => :delay)
    WHERE id = ANY(:ids)
""")


def plan_translation(content: Optional[str], should_translate: bool) -> Tuple[Optional[str], Optional[str]]:
    """(translation_status, language_detected) for a message being ingested.

    Status is None when translation is off, 'pending' for configured source languages,
    'skipped' otherwise. Language detection is local and cheap, so it always runs.
    """
    lang = None
    if content and content.strip():
        detected, _ = detect_language(content)
        lang = None if detected == "unknown" else detected
    enabled = settings.TRANSLATION_ENABLED and settings.TRANSLATION_PROVIDER.strip().lower() != "none"
    if not enabled:
        return None, lang
    if should_translate and lang in settings.get_translation_languages():
        return "pending", lang
    return "skipped", lang


class TranslationWorker:
    def __init__(
        self,
        translator,
        session_factory,
        batch_size: int = settings.TRANSLATION_BATCH_SIZE,
        poll_interval: float = settings.TRANSLATION_POLL_INTERVAL_SECONDS,
        max_age_hours: int = settings.TRANSLATION_MAX_AGE_HOURS,
        max_attempts: int = settings.TRANSLATION_MAX_ATTEMPTS,
    ) -> None:
        self.translator = translator
        self.session_factory = session_factory
        self.batch_size = batch_size
        self.poll_interval = poll_interval
        self.max_age_hours = max_age_hours
        self.max_attempts = max_attempts
        self.stats = {"translated": 0, "failed": 0, "skipped_stale": 0, "rescheduled": 0}

    async def run(self, stop: asyncio.Event) -> None:
        logger.info("Translation worker started")
        while not stop.is_set():
            try:
                delay = await self.run_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Translation worker iteration failed")
                delay = self.poll_interval * 2
            try:
                await asyncio.wait_for(stop.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass
        logger.info(f"Translation worker stopped: {self.stats}")

    async def run_once(self) -> float:
        """Handle one batch; returns how long to wait before the next one."""
        async with self.session_factory() as session:
            stale = (await session.execute(STALE_SQL, {"hours": self.max_age_hours})).rowcount
            rows = (await session.execute(CLAIM_SQL, {"lease": LEASE_SECONDS, "n": self.batch_size})).all()
            await session.commit()
        if stale:
            self.stats["skipped_stale"] += stale
            logger.info(f"Skipped {stale} stale untranslated messages (older than {self.max_age_hours}h)")
        if not rows:
            return self.poll_interval

        far_future = datetime.max.replace(tzinfo=timezone.utc)
        rows.sort(key=lambda r: r.telegram_date or far_future, reverse=True)  # newest first
        for index, row in enumerate(rows):
            busy = await self._translate_one(row)
            if busy:
                # Google backoff: park the unprocessed rest of the batch until it ends
                rest = [r.id for r in rows[index + 1:]]
                if rest:
                    async with self.session_factory() as session:
                        await session.execute(RELEASE_SQL, {"ids": rest, "delay": busy.retry_after})
                        await session.commit()
                return busy.retry_after
        await self._update_usage_gauge()
        return 0.0 if len(rows) == self.batch_size else self.poll_interval

    async def _translate_one(self, row) -> Optional[ProviderBusy]:
        try:
            translated, provider = await self.translator.translate_text(row.content, row.language_detected)
        except ProviderBusy as busy:
            # only the call that hit the limit costs an attempt; others just wait
            await self._reschedule(row, busy.retry_after, str(busy), count_attempt=busy.fresh)
            return busy
        except TranslationError as e:
            attempts = row.translation_attempts + 1
            delay = min(MAX_RETRY_DELAY_SECONDS, RETRY_BASE_DELAY_SECONDS * 2 ** (attempts - 1))
            await self._reschedule(row, delay, str(e), count_attempt=True)
            return None
        async with self.session_factory() as session:
            await session.execute(DONE_SQL, {
                "id": row.id, "translated": translated, "provider": provider,
                "target": self.translator.target_language,
            })
            await session.commit()
        self.stats["translated"] += 1
        return None

    async def _reschedule(self, row, delay: float, error: str, count_attempt: bool) -> None:
        attempts = row.translation_attempts + (1 if count_attempt else 0)
        exhausted = attempts >= self.max_attempts
        status = "failed" if exhausted else "pending"
        self.stats["failed" if exhausted else "rescheduled"] += 1
        if exhausted:
            logger.warning(f"Message {row.id} failed translation after {attempts} attempts: {error}")
        async with self.session_factory() as session:
            await session.execute(RESCHEDULE_SQL, {
                "id": row.id, "status": status, "attempts": attempts,
                "error": error[:MAX_ERROR_LENGTH], "delay": delay,
            })
            await session.commit()

    async def _update_usage_gauge(self) -> None:
        try:
            used = await self.translator.deepl_chars_today()
        except Exception as e:
            logger.debug(f"Could not read DeepL usage: {e}")
            return
        if used is not None:
            translation_deepl_chars_today.set(used)
