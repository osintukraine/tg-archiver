"""
Fixtures for listener tests.

Needs a real PostgreSQL with infrastructure/postgres/init.sql and migrations
003 + 004 applied, reachable via the POSTGRES_* env vars. Run inside the
listener image with the tests mounted at /app/tests:
    pip install -r requirements-dev.txt && python -m pytest tests
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import text

from config.settings import settings
from models.base import AsyncSessionLocal


@pytest.fixture(autouse=True)
async def clean_table():
    async with AsyncSessionLocal() as session:
        await session.execute(text("TRUNCATE discovered_channels RESTART IDENTITY CASCADE"))
        await session.commit()
    yield


@pytest.fixture(autouse=True)
def join_settings(monkeypatch):
    """Deterministic worker settings; individual tests override as needed."""
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MODE", "auto")
    monkeypatch.setattr(settings, "CHANNEL_JOIN_ENABLED", True)
    monkeypatch.setattr(settings, "CHANNEL_JOIN_BATCH_SIZE", 5)
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MAX_RETRIES", 3)
    monkeypatch.setattr(settings, "CHANNEL_JOIN_DAILY_CAP", 20)
    monkeypatch.setattr(settings, "CHANNEL_JOIN_LIMIT_PAUSE_HOURS", 24)


@pytest.fixture
def sleeps(monkeypatch):
    """Replace asyncio.sleep (as used by the worker) and record requested delays."""
    import asyncio

    calls: list[float] = []

    async def fake_sleep(seconds, *args, **kwargs):
        calls.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    return calls


@pytest.fixture
def client():
    """Mock Telethon client: awaiting it (requests) and get_entity both succeed."""
    mock = AsyncMock()
    mock.get_entity.return_value = object()
    return mock


async def insert_channel(
    telegram_id: int,
    *,
    join_status: str = "pending",
    approved: bool = False,
    admin_action: str | None = None,
    joined_at: datetime | None = None,
    join_attempted_at: datetime | None = None,
    join_retry_after: datetime | None = None,
    join_retry_count: int = 0,
    username: str | None = None,
) -> int:
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("""
            INSERT INTO discovered_channels
                (telegram_id, username, join_status, admin_action, joined_at,
                 join_attempted_at, join_retry_after, join_retry_count, join_approved_at)
            VALUES
                (:tid, :username, :status, :action, :joined_at,
                 :attempted, :retry_after, :retry_count, :approved_at)
            RETURNING id
        """), {
            "tid": telegram_id,
            "username": username or f"chan{telegram_id}",
            "status": join_status,
            "action": admin_action,
            "joined_at": joined_at,
            "attempted": join_attempted_at,
            "retry_after": join_retry_after,
            "retry_count": join_retry_count,
            "approved_at": datetime.now(timezone.utc) if approved else None,
        })
        await session.commit()
        return result.scalar_one()


async def get_row(db_id: int) -> dict:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            text("SELECT * FROM discovered_channels WHERE id = :id"), {"id": db_id}
        )
        return dict(result.one()._mapping)


def hours_ago(hours: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=hours)
