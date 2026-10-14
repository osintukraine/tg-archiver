"""
Tests for admin overrides from platform_config (shared/python/config/platform_config.py) and
the translation worker honouring processing.translation_enabled.

Needs a migrated Postgres 18 (POSTGRES_* env). Touches only platform_config rows for the keys
below and TRUNCATEs messages/channels: never point at real data.
"""

import os
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

for _k, _v in {
    "JWT_SECRET_KEY": "x" * 48,
    "REDIS_PASSWORD": "x",
    "POSTGRES_PASSWORD": "x",
    "MINIO_ENDPOINT": "x:9000",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

from config import platform_config  # noqa: E402
from config.platform_config import get_override, parse_value  # noqa: E402
from config.settings import settings  # noqa: E402
from src.translation_worker import TranslationWorker  # noqa: E402

pytestmark = pytest.mark.asyncio

ENABLED = "processing.translation_enabled"
INTERVAL = "telegram.folder_sync_interval"


@pytest_asyncio.fixture
async def sessions():
    engine = create_async_engine(
        settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://"), poolclass=NullPool
    )
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as s:
        # back to the seeded state: every row unmodified
        await s.execute(text("UPDATE platform_config SET last_modified_at = NULL"))
        await s.execute(text("TRUNCATE messages, channels RESTART IDENTITY CASCADE"))
        await s.execute(text(
            "INSERT INTO channels (id, telegram_id, name, username) VALUES (1, -1001, 'c', 'chan')"
        ))
        await s.commit()
    platform_config.clear_cache()
    yield factory
    platform_config.clear_cache()
    await engine.dispose()


async def admin_save(factory, key, value):
    async with factory() as s:
        await s.execute(
            text("UPDATE platform_config SET value = :v, last_modified_at = NOW() WHERE key = :k"),
            {"v": value, "k": key},
        )
        await s.commit()
    platform_config.clear_cache()


async def test_seeded_row_never_overrides(sessions):
    # seeded translation_enabled is 'true' and INTERVAL is '300', but nobody saved them
    assert await get_override(ENABLED, sessions) is None
    assert await get_override(INTERVAL, sessions) is None


async def test_modified_row_is_applied_and_typed(sessions):
    await admin_save(sessions, ENABLED, "false")
    await admin_save(sessions, INTERVAL, "42")
    assert await get_override(ENABLED, sessions) is False
    assert await get_override(INTERVAL, sessions) == 42


async def test_bad_value_returns_none(sessions):
    await admin_save(sessions, INTERVAL, "not-a-number")
    assert await get_override(INTERVAL, sessions) is None


async def test_db_error_returns_none():
    def broken():
        raise RuntimeError("db down")

    platform_config.clear_cache()
    assert await get_override(ENABLED, broken) is None


async def test_result_is_cached_until_cleared(sessions):
    await admin_save(sessions, INTERVAL, "42")
    assert await get_override(INTERVAL, sessions) == 42
    async with sessions() as s:  # change behind the cache's back
        await s.execute(text("UPDATE platform_config SET value = '99' WHERE key = :k"), {"k": INTERVAL})
        await s.commit()
    assert await get_override(INTERVAL, sessions) == 42
    platform_config.clear_cache()
    assert await get_override(INTERVAL, sessions) == 99


async def test_parse_value_types():
    assert parse_value("TRUE", "boolean") is True
    assert parse_value("1.5", "float") == 1.5
    assert parse_value("en", "string") == "en"
    with pytest.raises(ValueError):
        parse_value("yes", "boolean")


class CountingTranslator:
    target_language = "EN-US"

    def __init__(self) -> None:
        self.calls = 0

    async def translate_text(self, content, language):
        self.calls += 1
        return "translated", "fake"


async def add_pending(factory):
    async with factory() as s:
        await s.execute(text(
            """INSERT INTO messages (message_id, channel_id, content, telegram_date,
               language_detected, translation_status)
               VALUES (1, 1, 'privet', :d, 'ru', 'pending')"""),
            {"d": datetime.now(timezone.utc) - timedelta(hours=1)},
        )
        await s.commit()


async def test_worker_pauses_when_admin_disables_translation(sessions):
    await add_pending(sessions)
    await admin_save(sessions, ENABLED, "false")
    translator = CountingTranslator()
    await TranslationWorker(translator, sessions).run_once()
    assert translator.calls == 0

    await admin_save(sessions, ENABLED, "true")
    await TranslationWorker(translator, sessions).run_once()
    assert translator.calls == 1


async def test_worker_ignores_seeded_row(sessions):
    # the seed says true, but even a seeded 'false' must not pause: only saved rows count
    await add_pending(sessions)
    async with sessions() as s:
        await s.execute(text("UPDATE platform_config SET value = 'false' WHERE key = :k"), {"k": ENABLED})
        await s.commit()
    translator = CountingTranslator()
    await TranslationWorker(translator, sessions).run_once()
    assert translator.calls == 1
