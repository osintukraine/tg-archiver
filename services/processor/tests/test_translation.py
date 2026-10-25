"""
Tests for the translation queue: ingest planning, the background worker, the DeepL daily
character cap and Google rate-limit backoff.

Integration tests need a REAL Redis 8 (TEST_REDIS_URL) and a migrated Postgres 18 (POSTGRES_*
env). They TRUNCATE messages/channels and flush the Redis database - never point them at
real data. Providers are simulated by fake client objects; nothing touches the network.
"""

import os
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import deepl
import pytest
import pytest_asyncio
import redis.asyncio as redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

# Settings are validated on import; provide dummies before importing src.*
for _k, _v in {
    "JWT_SECRET_KEY": "x" * 48,
    "REDIS_PASSWORD": "x",
    "POSTGRES_PASSWORD": "x",
    "MINIO_ENDPOINT": "x:9000",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

from config.settings import settings  # noqa: E402
from translation import CommentTranslator  # noqa: E402

import src.message_processor as message_processor_module  # noqa: E402
from src.entity_extractor import EntityExtractor  # noqa: E402
from src.message_processor import MessageProcessor  # noqa: E402
from src.message_router import MessageRouter  # noqa: E402
from src.redis_consumer import ProcessedMessage  # noqa: E402
from src.translation_worker import TranslationWorker, plan_translation  # noqa: E402

pytestmark = pytest.mark.asyncio

REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")
RU = "Привет мир, это тестовое сообщение для проверки перевода"  # 56 chars
EN = "Hello world, this is a plain English test message"
NOW = datetime.now(timezone.utc)


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


class FakeDeepL:
    """Stands in for deepl.Translator; records calls, optionally raises."""

    def __init__(self, error=None) -> None:
        self.calls = []
        self.error = error

    def translate_text(self, text, source_lang=None, target_lang=None):
        self.calls.append((text, source_lang, target_lang))
        if self.error:
            raise self.error
        return SimpleNamespace(text=f"deepl:{text}")


class FakeGoogle:
    """Stands in for GoogleTranslator; fails with `errors` first (one per call), then works."""

    def __init__(self, errors=()) -> None:
        self.calls = []
        self.errors = list(errors)

    def translate(self, text):
        self.calls.append(text)
        if self.errors:
            raise self.errors.pop(0)
        return f"google:{text}"


@pytest_asyncio.fixture
async def redis_client():
    client = redis.from_url(REDIS_URL, decode_responses=True)
    await client.flushdb()
    yield client
    await client.flushdb()
    await client.aclose()


@pytest_asyncio.fixture
async def sessions():
    engine = create_async_engine(
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"), poolclass=NullPool
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        await s.execute(text("TRUNCATE messages, channels RESTART IDENTITY CASCADE"))
        await s.execute(text(
            "INSERT INTO channels (id, telegram_id, name, username) VALUES (1, -1001, 'c', 'chan')"
        ))
        await s.commit()
    yield factory
    await engine.dispose()


async def add_message(factory, content=RU, age_hours=1.0, status="pending", lang="ru", mid=None):
    async with factory() as s:
        count = (await s.execute(text("SELECT count(*) FROM messages"))).scalar_one()
        row = await s.execute(
            text("""INSERT INTO messages (message_id, channel_id, content, telegram_date,
                    language_detected, translation_status)
                    VALUES (:mid, 1, :c, :d, :l, :st) RETURNING id"""),
            {"mid": mid or count + 1, "c": content, "d": NOW - timedelta(hours=age_hours),
             "l": lang, "st": status},
        )
        await s.commit()
        return row.scalar_one()


async def get_row(factory, id_):
    async with factory() as s:
        return (await s.execute(text("""
            SELECT content_translated, translation_provider, translation_status, translation_attempts,
                   translation_last_error, translation_next_attempt_at, language_detected
            FROM messages WHERE id = :id"""), {"id": id_})).one()


async def make_due(factory):
    async with factory() as s:
        await s.execute(text("UPDATE messages SET translation_next_attempt_at = now() - interval '1 second'"))
        await s.commit()


def translator(redis_client=None, deepl_client=None, google=None, clock=None, **kw):
    kw.setdefault("google_min_interval", 0)
    return CommentTranslator(
        provider=kw.pop("provider", "deepl"), redis_client=redis_client, deepl_client=deepl_client,
        google_client=google, clock=clock or Clock(), **kw,
    )


def worker(t, factory, **kw):
    return TranslationWorker(t, factory, batch_size=kw.pop("batch_size", 10), poll_interval=0.01,
                             max_age_hours=kw.pop("max_age_hours", 48),
                             max_attempts=kw.pop("max_attempts", 8))


# ---- ingest ----------------------------------------------------------------------


async def test_ingest_persists_pending_without_calling_any_provider(sessions, monkeypatch):
    # Providers that would hang forever if the ingest path touched them
    deepl_client, google = FakeDeepL(), FakeGoogle()
    monkeypatch.setattr(message_processor_module, "AsyncSessionLocal", sessions)
    processor = MessageProcessor(message_router=MessageRouter(), entity_extractor=EntityExtractor())
    assert "translation_service" not in MessageProcessor.__init__.__code__.co_varnames

    def msg(mid, content):
        return ProcessedMessage("1-0", {
            "message_id": str(mid), "channel_id": "-1001", "content": content,
            "telegram_date": NOW.isoformat()}, "telegram:messages:realtime")

    started = time.monotonic()
    assert await processor.process(msg(10, RU))
    assert await processor.process(msg(11, EN))
    assert time.monotonic() - started < 5

    async with sessions() as s:
        rows = (await s.execute(text(
            "SELECT message_id, translation_status, language_detected, content_translated "
            "FROM messages ORDER BY message_id"))).all()
    assert [tuple(r) for r in rows] == [(10, "pending", "ru", None), (11, "skipped", "en", None)]
    assert deepl_client.calls == [] and google.calls == []


async def test_plan_translation_respects_provider_none(monkeypatch):
    monkeypatch.setattr(settings, "TRANSLATION_PROVIDER", "none")
    assert plan_translation(RU, True) == (None, "ru")
    monkeypatch.setattr(settings, "TRANSLATION_PROVIDER", "deepl")
    assert plan_translation(RU, False) == ("skipped", "ru")  # channel opted out
    assert plan_translation("", True) == ("skipped", None)


# ---- worker ----------------------------------------------------------------------


async def test_worker_translates_newest_first(sessions, redis_client):
    old = await add_message(sessions, age_hours=10)
    new = await add_message(sessions, content=RU + " new", age_hours=1)
    mid = await add_message(sessions, content=RU + " mid", age_hours=5)
    fake = FakeDeepL()
    await worker(translator(redis_client, fake, FakeGoogle()), sessions).run_once()

    assert [c[0] for c in fake.calls] == [RU + " new", RU + " mid", RU]
    for id_ in (old, new, mid):
        row = await get_row(sessions, id_)
        assert (row.translation_status, row.translation_provider) == ("done", "deepl")
        assert row.content_translated.startswith("deepl:")
    # target and explicit source are mapped for DeepL
    assert fake.calls[0][1:] == ("RU", "EN-US")


async def test_stale_messages_are_skipped(sessions, redis_client):
    stale = await add_message(sessions, age_hours=100)
    fresh = await add_message(sessions, age_hours=1)
    fake = FakeDeepL()
    await worker(translator(redis_client, fake), sessions, max_age_hours=48).run_once()

    row = await get_row(sessions, stale)
    assert (row.translation_status, row.translation_last_error) == ("skipped", "stale")
    assert (await get_row(sessions, fresh)).translation_status == "done"
    assert len(fake.calls) == 1


async def test_deepl_daily_cap_falls_back_to_google(sessions, redis_client):
    ids = [await add_message(sessions, content=f"{'а' * 10}{i}", age_hours=i + 1) for i in range(3)]
    fake, google = FakeDeepL(), FakeGoogle()
    t = translator(redis_client, fake, google, daily_char_limit=25)  # fits two 11-char texts
    await worker(t, sessions).run_once()

    providers = [(await get_row(sessions, i)).translation_provider for i in ids]
    assert providers == ["deepl", "deepl", "google"]
    assert len(fake.calls) == 2 and len(google.calls) == 1
    assert await t.deepl_chars_today() == 22  # only characters actually sent are counted


async def test_deepl_cap_counter_is_shared_between_instances(redis_client):
    a = translator(redis_client, FakeDeepL(), FakeGoogle(), daily_char_limit=30)
    b = translator(redis_client, FakeDeepL(), FakeGoogle(), daily_char_limit=30)
    assert (await a.translate_text("x" * 20))[1] == "deepl"
    assert (await b.translate_text("x" * 20))[1] == "google"  # 20 + 20 > 30


async def test_deepl_quota_exceeded_pauses_deepl(sessions, redis_client):
    for i in range(3):
        await add_message(sessions, content=f"{RU} {i}", age_hours=i + 1)
    fake = FakeDeepL(error=deepl.QuotaExceededException("quota"))
    google = FakeGoogle()
    t = translator(redis_client, fake, google, daily_char_limit=1000)
    await worker(t, sessions).run_once()

    assert len(fake.calls) == 1  # paused after the first rejection
    assert len(google.calls) == 3
    assert t._deepl_paused_until is not None
    assert t._deepl_paused_until > datetime.now(timezone.utc)
    assert await t.deepl_chars_today() == 0  # rejected characters are refunded


async def test_deepl_transient_error_cools_down_and_uses_google(redis_client):
    clock = Clock()
    fake = FakeDeepL(error=ConnectionError("down"))
    t = translator(redis_client, fake, FakeGoogle(), clock=clock)
    assert (await t.translate_text(RU))[1] == "google"
    assert (await t.translate_text(RU))[1] == "google"
    assert len(fake.calls) == 1
    clock.t += 61
    fake.error = None
    assert (await t.translate_text(RU))[1] == "deepl"


async def test_google_rate_limit_backs_off_reschedules_then_succeeds(sessions, redis_client):
    first = await add_message(sessions, age_hours=1)
    second = await add_message(sessions, content=RU + " 2", age_hours=2)
    clock = Clock()
    google = FakeGoogle(errors=[Exception("429 Too Many Requests"), Exception("429 Too Many Requests")])
    t = translator(redis_client, None, google, clock=clock, provider="google",
                   google_backoff_base=30, google_backoff_max=100)
    w = worker(t, sessions)

    delay = await w.run_once()
    assert 30 <= delay <= 36
    row = await get_row(sessions, first)
    assert (row.translation_status, row.translation_attempts) == ("pending", 1)
    assert row.translation_next_attempt_at > datetime.now(timezone.utc)
    other = await get_row(sessions, second)  # parked, no attempt burned
    assert other.translation_attempts == 0 and other.translation_status == "pending"
    assert len(google.calls) == 1

    # still inside the backoff: nothing is sent and no attempt is consumed
    await make_due(sessions)
    assert await w.run_once() > 0
    assert len(google.calls) == 1
    assert (await get_row(sessions, first)).translation_attempts == 1

    # backoff over, second failure doubles it (capped at 100 incl. jitter)
    clock.t += 40
    await make_due(sessions)
    delay2 = await w.run_once()
    assert 60 <= delay2 <= 72
    assert (await get_row(sessions, first)).translation_attempts == 2

    # recovery: success resets the backoff
    clock.t += 100
    await make_due(sessions)
    await w.run_once()
    assert t._google_backoff == 0
    for id_ in (first, second):
        row = await get_row(sessions, id_)
        assert (row.translation_status, row.translation_provider) == ("done", "google")


async def test_google_min_interval_between_calls(redis_client):
    t = translator(redis_client, None, FakeGoogle(), provider="google", google_min_interval=0.2)
    t._clock = time.monotonic
    started = time.monotonic()
    await t.translate_text("a")
    await t.translate_text("b")
    assert time.monotonic() - started >= 0.2


async def test_max_attempts_marks_failed_with_last_error(sessions, redis_client):
    id_ = await add_message(sessions)
    google = FakeGoogle(errors=[ValueError("bad payload")] * 5)
    t = translator(redis_client, None, google, provider="google")
    w = worker(t, sessions, max_attempts=2)

    await w.run_once()
    assert (await get_row(sessions, id_)).translation_status == "pending"
    await make_due(sessions)
    await w.run_once()
    row = await get_row(sessions, id_)
    assert (row.translation_status, row.translation_attempts) == ("failed", 2)
    assert "bad payload" in row.translation_last_error
    await make_due(sessions)
    await w.run_once()  # failed rows are never picked again
    assert len(google.calls) == 2


async def test_restart_resumes_from_database_state(sessions, redis_client):
    due = await add_message(sessions, age_hours=1)
    waiting = await add_message(sessions, content=RU + " later", age_hours=2)
    google = FakeGoogle(errors=[Exception("429 Too Many Requests")])
    w1 = worker(translator(redis_client, None, google, provider="google"), sessions, batch_size=1)
    await w1.run_once()  # newest fails and is rescheduled; the worker "dies" here
    assert (await get_row(sessions, due)).translation_attempts == 1

    # a brand new worker + translator (empty in-memory state) continues from the DB
    w2 = worker(translator(redis_client, None, FakeGoogle(), provider="google"), sessions)
    await w2.run_once()
    assert (await get_row(sessions, waiting)).translation_status == "done"
    assert (await get_row(sessions, due)).translation_status == "pending"  # not due yet
    await make_due(sessions)
    await w2.run_once()
    assert (await get_row(sessions, due)).translation_status == "done"


async def test_provider_none_translates_nothing():
    t = translator(provider="none", deepl_client=FakeDeepL(), google=FakeGoogle())
    assert not t.enabled
    assert await t.translate(RU, "ru") == (None, "none", 1.0)
