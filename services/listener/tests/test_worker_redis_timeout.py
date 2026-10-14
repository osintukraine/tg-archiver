"""
Regression: the import and promotion workers' blocking XREADGROUP must not time out.

redis-py 8 times out socket reads after ~5s unless socket_timeout is set, and the
workers block for BLOCK_MS (5s), so every read raised "Timeout reading from redis"
and the workers never processed a job (found in a live run). Runs against a REAL
Redis (TEST_REDIS_URL); skipped when it is not provided.
"""

import os
import uuid

import pytest
import redis.asyncio as redis

from src import import_worker, promotion_worker

REDIS_URL = os.environ.get("TEST_REDIS_URL")


@pytest.mark.parametrize("module", [import_worker, promotion_worker], ids=["import", "promotion"])
def test_socket_timeout_exceeds_block_time(module):
    assert module.REDIS_SOCKET_TIMEOUT_S > module.BLOCK_MS / 1000


@pytest.mark.skipif(not REDIS_URL, reason="needs a real Redis via TEST_REDIS_URL")
@pytest.mark.parametrize("module", [import_worker, promotion_worker], ids=["import", "promotion"])
@pytest.mark.asyncio
async def test_blocking_read_returns_empty_instead_of_timing_out(module):
    stream = f"tgtest:block:{uuid.uuid4().hex}"
    client = redis.from_url(REDIS_URL, decode_responses=True, socket_timeout=module.REDIS_SOCKET_TIMEOUT_S)
    try:
        await client.xgroup_create(stream, "g", id="0", mkstream=True)
        result = await client.xreadgroup("g", "c", {stream: ">"}, count=1, block=module.BLOCK_MS)
        assert result == []
    finally:
        await client.delete(stream)
        await client.aclose()
