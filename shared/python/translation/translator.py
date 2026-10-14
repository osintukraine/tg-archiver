"""
Translation backends: DeepL (with a daily character cap) and Google (free scraping).

TRANSLATION_PROVIDER picks the order: "deepl" = DeepL first (if a key is set), then
Google; "google" = Google only; "none" = nothing.

`translate_text` raises instead of returning None so a queue worker can tell failures apart:
- ProviderBusy: Google is rate limited (global exponential backoff); retry after `retry_after`
- TranslationError: this text failed; count an attempt against the message

`translate` keeps the old (text, method, confidence) tuple for interactive callers.
"""

import asyncio
import logging
import random
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Tuple

try:
    import deepl
except ImportError:
    deepl = None

try:
    from deep_translator import GoogleTranslator
except ImportError:
    GoogleTranslator = None

try:
    from langdetect import DetectorFactory, detect
    DetectorFactory.seed = 0  # deterministic
except ImportError:
    detect = None

logger = logging.getLogger(__name__)

DEEPL_COOLDOWN_SECONDS = 60  # after a transient DeepL error
CHAR_COUNTER_TTL_SECONDS = 2 * 86400
# DeepL needs regional targets; everything else is just upper-cased
DEEPL_TARGETS = {"en": "EN-US", "pt": "PT-PT", "zh": "ZH"}
# Only ru/uk are passed as an explicit DeepL source; others are auto-detected by DeepL
# (an unsupported source code would be rejected).
DEEPL_EXPLICIT_SOURCES = {"ru", "uk"}
RATE_LIMIT_MARKERS = ("429", "too many requests", "toomanyrequests", "connection", "timed out",
                      "timeout", "requesterror", "503", "unusual traffic")


class TranslationError(Exception):
    """This text could not be translated right now."""


class ProviderBusy(TranslationError):
    """Google is rate limited. `fresh` is True when this very call triggered the backoff."""

    def __init__(self, retry_after: float, fresh: bool = False) -> None:
        super().__init__(f"rate limited, retry in {retry_after:.0f}s")
        self.retry_after = retry_after
        self.fresh = fresh


def detect_language(text: str) -> Tuple[str, float]:
    """Return (language_code, confidence estimate); ("unknown", 0.0) when undetectable."""
    if not detect or not text or len(text.strip()) < 3:
        return "unknown", 0.0
    try:
        return detect(text), round(min(1.0, len(text) / 100), 2)
    except Exception as e:  # langdetect raises on text without letters
        logger.debug(f"Language detection failed: {e}")
        return "unknown", 0.0


def _is_rate_limit(exc: Exception) -> bool:
    haystack = f"{type(exc).__name__} {exc}".lower()
    return any(marker in haystack for marker in RATE_LIMIT_MARKERS)


def _utc_day() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class CommentTranslator:
    def __init__(
        self,
        deepl_api_key: Optional[str] = None,
        target_language: str = "en",
        provider: str = "deepl",
        deepl_api_url: Optional[str] = None,
        daily_char_limit: int = 0,
        redis_client=None,
        google_min_interval: float = 2.0,
        google_backoff_base: float = 30.0,
        google_backoff_max: float = 900.0,
        deepl_client=None,  # injectable (tests)
        google_client=None,  # injectable (tests)
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.provider = provider
        self.target_language = target_language.lower().split("-")[0]
        self.daily_char_limit = daily_char_limit
        self.redis = redis_client
        self.google_min_interval = google_min_interval
        self.google_backoff_base = google_backoff_base
        self.google_backoff_max = google_backoff_max
        self._clock = clock

        self._deepl = deepl_client
        self._google = google_client
        if provider != "none":
            if self._deepl is None and provider == "deepl" and deepl_api_key and deepl:
                kwargs = {"server_url": deepl_api_url} if deepl_api_url else {}
                self._deepl = deepl.Translator(deepl_api_key, **kwargs)
            if self._google is None and GoogleTranslator:
                self._google = GoogleTranslator(source="auto", target=self.target_language)
        if provider == "deepl" and not self._deepl:
            logger.warning("TRANSLATION_PROVIDER=deepl but DeepL is unavailable; using Google only")

        self._deepl_paused_until: Optional[datetime] = None  # quota exceeded: next UTC midnight
        self._deepl_cooldown_until = 0.0
        self._cap_logged_day: Optional[str] = None
        self._google_lock = asyncio.Lock()
        self._google_next_call = 0.0
        self._google_backoff = 0.0  # current backoff length; 0 = healthy
        self._google_blocked_until = 0.0

    @property
    def enabled(self) -> bool:
        return self.provider != "none" and bool(self._deepl or self._google)

    def detect_language(self, text: str) -> Tuple[str, float]:
        return detect_language(text)

    # ---- DeepL -------------------------------------------------------------------

    def _char_key(self) -> str:
        return f"translation:deepl:chars:{_utc_day()}"

    async def deepl_chars_today(self) -> Optional[int]:
        if not self.redis:
            return None
        return int(await self.redis.get(self._char_key()) or 0)

    async def _reserve_deepl_chars(self, n: int) -> bool:
        """Atomically reserve n chars of today's cap. False when the cap would be exceeded."""
        if not self.daily_char_limit or not self.redis:
            return True
        key = self._char_key()
        used = await self.redis.incrby(key, n)
        await self.redis.expire(key, CHAR_COUNTER_TTL_SECONDS)
        if used > self.daily_char_limit:
            await self.redis.decrby(key, n)
            day = _utc_day()
            if self._cap_logged_day != day:
                self._cap_logged_day = day
                logger.warning(
                    f"DeepL daily cap reached ({used - n}/{self.daily_char_limit} chars); "
                    "using Google until 00:00 UTC"
                )
            return False
        return True

    async def _refund_deepl_chars(self, n: int) -> None:
        if self.daily_char_limit and self.redis:
            await self.redis.decrby(self._char_key(), n)

    def _deepl_usable(self) -> bool:
        if not self._deepl:
            return False
        if self._deepl_paused_until and datetime.now(timezone.utc) < self._deepl_paused_until:
            return False
        return self._clock() >= self._deepl_cooldown_until

    def _deepl_translate(self, text: str, source_lang: Optional[str]) -> str:
        source = source_lang.upper() if source_lang in DEEPL_EXPLICIT_SOURCES else None
        target = DEEPL_TARGETS.get(self.target_language, self.target_language.upper())
        return self._deepl.translate_text(text, source_lang=source, target_lang=target).text

    async def _try_deepl(self, text: str, source_lang: Optional[str]) -> Optional[str]:
        """Translated text, or None when DeepL should be skipped (paused, capped, failing)."""
        if not self._deepl_usable() or not await self._reserve_deepl_chars(len(text)):
            return None
        try:
            return await asyncio.to_thread(self._deepl_translate, text, source_lang)
        except Exception as e:
            await self._refund_deepl_chars(len(text))
            if deepl and isinstance(e, deepl.QuotaExceededException):
                tomorrow = datetime.now(timezone.utc).date() + timedelta(days=1)
                self._deepl_paused_until = datetime.combine(tomorrow, datetime.min.time(), timezone.utc)
                logger.warning("DeepL quota exceeded; paused until 00:00 UTC, using Google")
            else:
                self._deepl_cooldown_until = self._clock() + DEEPL_COOLDOWN_SECONDS
                logger.warning(f"DeepL error ({type(e).__name__}: {e}); using Google for {DEEPL_COOLDOWN_SECONDS}s")
            return None

    # ---- Google ------------------------------------------------------------------

    def google_wait(self) -> float:
        """Seconds left in the global Google backoff (0 = not backing off)."""
        return max(0.0, self._google_blocked_until - self._clock())

    def _enter_backoff(self) -> float:
        if self._google_backoff == 0:
            logger.warning("Google Translate rate limited; entering backoff")
        self._google_backoff = min(
            self.google_backoff_max, self._google_backoff * 2 or self.google_backoff_base
        )
        delay = min(self.google_backoff_max, self._google_backoff * random.uniform(1.0, 1.2))
        self._google_blocked_until = self._clock() + delay
        return delay

    async def _google_translate(self, text: str) -> str:
        if not self._google:
            raise TranslationError("Google Translate unavailable")
        async with self._google_lock:
            wait = self.google_wait()
            if wait > 0:
                raise ProviderBusy(wait)
            gap = self._google_next_call - self._clock()
            if gap > 0:
                await asyncio.sleep(gap)
            try:
                out = await asyncio.to_thread(self._google.translate, text)
            except Exception as e:
                self._google_next_call = self._clock() + self.google_min_interval
                if _is_rate_limit(e):
                    raise ProviderBusy(self._enter_backoff(), fresh=True) from e
                raise TranslationError(f"Google: {type(e).__name__}: {e}") from e
            self._google_next_call = self._clock() + self.google_min_interval
            if self._google_backoff:
                logger.info("Google Translate recovered; leaving backoff")
                self._google_backoff = 0.0
            if not out:
                raise TranslationError("Google returned an empty translation")
            return out

    # ---- public ------------------------------------------------------------------

    async def translate_text(self, text: str, source_lang: Optional[str] = None) -> Tuple[str, str]:
        """Translate text; returns (translated, provider) with provider "deepl" or "google"."""
        if self.provider == "none":
            raise TranslationError("translation disabled (TRANSLATION_PROVIDER=none)")
        if self.provider == "deepl":
            out = await self._try_deepl(text, source_lang)
            if out:
                return out, "deepl"
        return await self._google_translate(text), "google"

    async def translate(
        self, text: str, source_lang: Optional[str] = None
    ) -> Tuple[Optional[str], str, float]:
        """Interactive helper: (translated_text, method, confidence); (None, "none", c) on failure."""
        if not text or not text.strip():
            return None, "none", 0.0
        if source_lang:
            confidence = 1.0
        else:
            source_lang, confidence = detect_language(text)
        if source_lang == self.target_language:
            return text, "none", 1.0
        if source_lang == "unknown":
            return None, "none", 0.0
        try:
            out, provider = await self.translate_text(text, source_lang)
        except TranslationError as e:
            logger.warning(f"Translation failed ({source_lang}): {e}")
            return None, "none", confidence
        return out, provider, confidence


def build_translator(settings, redis_client=None) -> CommentTranslator:
    """Translator configured from the shared Settings (used by processor and api)."""
    return CommentTranslator(
        deepl_api_key=settings.DEEPL_API_KEY or None,
        target_language=settings.TRANSLATION_TARGET_LANG,
        provider=settings.TRANSLATION_PROVIDER.strip().lower(),
        deepl_api_url=settings.DEEPL_API_URL or None,
        daily_char_limit=settings.TRANSLATION_DAILY_CHAR_LIMIT,
        redis_client=redis_client,
        google_min_interval=settings.GOOGLE_MIN_INTERVAL_SECONDS,
        google_backoff_max=settings.GOOGLE_BACKOFF_MAX_SECONDS,
        google_backoff_base=settings.GOOGLE_BACKOFF_BASE_SECONDS,
    )
