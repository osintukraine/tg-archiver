"""/api/system health + pipeline read the REAL processor streams (not `telegram_messages`).

Uses a real Redis (TEST_REDIS_URL; the database is flushed). Self-contained.
"""

import os
from types import SimpleNamespace

import pytest
import pytest_asyncio
import redis.asyncio as redis

for _k, _v in {
    "JWT_SECRET_KEY": "x" * 48,
    "REDIS_PASSWORD": "x",
    "POSTGRES_PASSWORD": "x",
    "MINIO_ENDPOINT": "x:9000",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

from src.routers import system  # noqa: E402

REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/14")
RT, BF, LEGACY = system.STREAMS[0], system.STREAMS[1], system.STREAMS[2]
GROUP = "processor-workers"


@pytest_asyncio.fixture
async def r(monkeypatch):
    client = redis.from_url(REDIS_URL, decode_responses=True)
    await client.flushdb()
    monkeypatch.setattr(system, "settings", SimpleNamespace(REDIS_URL=REDIS_URL))
    yield client
    await client.flushdb()
    await client.aclose()


async def fill(r, stream, n, read=0):
    """n entries in a stream with the processor group; `read` delivered (pending, unacked)."""
    await r.xgroup_create(stream, GROUP, id="0", mkstream=True)
    for i in range(n):
        await r.xadd(stream, {"message_id": str(i)})
    if read:
        await r.xreadgroup(GROUP, "c1", {stream: ">"}, count=read)


def test_stream_names_match_processor():
    # processor RedisConsumer: STREAM_REALTIME / STREAM_BACKFILL / STREAM_LEGACY
    assert set(system.STREAMS) == {"telegram:messages:realtime", "telegram:messages:backfill", "telegram:messages"}
    assert system.CONSUMER_GROUP == "processor-workers"


async def test_pipeline_queue_status_sums_all_streams(r):
    await fill(r, RT, 5, read=2)  # lag 3, pending 2
    await fill(r, BF, 4)  # lag 4
    out = await system.check_queue_status()
    assert (out["lag"], out["pending"], out["consumers"], out["queue_length"]) == (7, 2, 1, 9)
    assert out["ok"] is True


async def test_pipeline_queue_status_flags_backlog(r):
    await fill(r, LEGACY, 150)
    out = await system.check_queue_status()
    assert out["ok"] is False and out["lag"] == 150


async def test_processor_health(r):
    assert (await system.check_processor_health())["status"] == "unknown"  # no group yet
    await fill(r, RT, 3, read=3)
    out = await system.check_processor_health()
    assert out["status"] == "healthy"
    assert out["metrics"]["workers_active"] == 1


async def test_redis_health_reports_backlog(r):
    await fill(r, RT, 5, read=2)
    out = await system.check_redis_health()
    assert out["status"] == "healthy"
    assert out["metrics"]["queue_depth"] == 5  # lag 3 + pending 2
