"""
Tests for RedisConsumer retry / dead-letter logic.

Integration tests need a REAL Redis 8 server (XAUTOCLAIM/XPENDING semantics),
given by TEST_REDIS_URL. They flush the database - never point it at real data.
"""

import asyncio
import json
import os
from unittest.mock import AsyncMock, MagicMock

import pytest
import pytest_asyncio
import redis.asyncio as redis

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

from src.dead_letter_queue import DeadLetterQueue  # noqa: E402
from src.redis_consumer import ProcessedMessage, RedisConsumer, _id_key  # noqa: E402

pytestmark = pytest.mark.asyncio

REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")
RT = RedisConsumer.STREAM_REALTIME
BF = RedisConsumer.STREAM_BACKFILL
GROUP = RedisConsumer.CONSUMER_GROUP
PAYLOAD = {"message_id": "42", "channel_id": "7", "content": "hello", "extra": "kept"}


@pytest_asyncio.fixture
async def consumer():
    client = redis.from_url(REDIS_URL, decode_responses=True)
    await client.flushdb()
    c = RedisConsumer()
    c.client = client
    c.dlq = DeadLetterQueue(client)
    c.auto_claim_min_idle_ms = 20  # tiny retry spacing
    await c._ensure_consumer_group()
    yield c
    await client.flushdb()
    await client.aclose()


async def deliver(c: RedisConsumer) -> ProcessedMessage:
    """One delivery the way consume_messages does it: retry path first, then fresh."""
    await asyncio.sleep(0.05)  # exceed the retry idle time
    batch = await c._auto_claim_pending()
    for stream in (RT, BF):
        batch = batch or await c._read_from_stream(stream, 0, 10)
    assert batch, "nothing delivered"
    stream, stream_id, data = batch[0]
    return ProcessedMessage(stream_id, data, source_stream=stream)


async def pending(c: RedisConsumer, stream: str = RT) -> int:
    return (await c.client.xpending(stream, GROUP))["pending"]


async def test_first_failure_is_not_acked_and_is_redelivered(consumer):
    await consumer.client.xadd(RT, PAYLOAD)
    msg = await deliver(consumer)

    await consumer.reject(msg.stream_id, "boom", msg)

    assert await pending(consumer) == 1
    assert await consumer.dlq.get_dlq_count() == 0
    assert consumer.messages_retried == 1 and consumer.messages_acknowledged == 0
    again = await deliver(consumer)
    assert again.stream_id == msg.stream_id
    assert again.source_stream == RT


@pytest.mark.parametrize("stream", [RT, BF])
async def test_third_failure_goes_to_dlq_with_full_payload_then_acked(consumer, stream):
    await consumer.client.xadd(stream, PAYLOAD)
    for _ in range(RedisConsumer.MAX_RETRIES):
        msg = await deliver(consumer)
        await consumer.reject(msg.stream_id, "boom", msg)

    assert await pending(consumer, stream) == 0
    (entry,) = await consumer.dlq.get_dlq_messages()
    assert entry["original_stream"] == stream
    assert entry["original_stream_id"] == msg.stream_id
    assert entry["fields"] == PAYLOAD
    assert entry["retry_count"] == RedisConsumer.MAX_RETRIES
    assert entry["error"] == "boom"
    assert consumer.messages_dead_lettered == 1
    assert consumer.messages_retried == RedisConsumer.MAX_RETRIES - 1


async def test_crash_loop_message_is_dead_lettered_without_being_yielded(consumer):
    await consumer.client.xadd(RT, PAYLOAD)
    # deliveries 1..3 "crash": never rejected or acked
    for _ in range(RedisConsumer.MAX_RETRIES):
        await deliver(consumer)

    await asyncio.sleep(0.05)
    assert await consumer._auto_claim_pending() == []  # guard: not yielded

    assert await pending(consumer) == 0
    (entry,) = await consumer.dlq.get_dlq_messages()
    assert entry["fields"] == PAYLOAD and entry["original_stream"] == RT
    assert entry["retry_count"] > RedisConsumer.MAX_RETRIES
    assert "crash" in entry["error"]


async def test_cleanup_keeps_consumers_with_pending_and_removes_empty_idle_ones(consumer):
    await consumer.client.xadd(RT, PAYLOAD)
    await consumer.client.xreadgroup(GROUP, "dead-with-pending", {RT: ">"}, count=1)
    await consumer.client.xgroup_createconsumer(RT, GROUP, "idle-empty")
    await asyncio.sleep(0.05)

    await consumer._cleanup_stale_consumers(max_idle_ms=1)

    names = {c["name"] for c in await consumer.client.xinfo_consumers(RT, GROUP)}
    assert "dead-with-pending" in names
    assert "idle-empty" not in names
    assert await pending(consumer) == 1
    # and the orphaned entry is still recoverable via XAUTOCLAIM
    assert (await deliver(consumer)).message_id == 42


async def test_stats_count_success_failure_and_retry(consumer):
    await consumer.client.xadd(RT, PAYLOAD)
    await consumer.client.xadd(RT, {**PAYLOAD, "message_id": "43"})
    gen = consumer.consume_messages()
    ok = await anext(gen)
    bad = await anext(gen)
    await gen.aclose()

    await consumer.acknowledge(ok.stream_id, ok.source_stream)
    await consumer.reject(bad.stream_id, "boom", bad)

    stats = consumer.get_stats()
    assert stats["messages_consumed"] == 2
    assert stats["messages_acknowledged"] == 1
    assert stats["messages_failed"] == 1
    assert stats["messages_retried"] == 1
    assert stats["messages_dead_lettered"] == 0
    assert stats["success_rate"] == 0.5


async def test_old_format_dlq_entries_are_still_readable(consumer):
    await consumer.client.xadd(
        DeadLetterQueue.DLQ_STREAM_KEY,
        {"original_stream_id": "1-0", "message_data": json.dumps({"message_id": 1}), "error": "e"},
    )
    (entry,) = await consumer.dlq.get_dlq_messages()
    assert entry["message_data"] == {"message_id": 1}
    assert entry["original_stream"] is None and entry["retry_count"] == 0
    assert "fields" not in entry


# ---- unit tests (mocked client) ------------------------------------------------


def unit_consumer() -> RedisConsumer:
    c = RedisConsumer()
    c.client = MagicMock()
    c.client.xack = AsyncMock(return_value=1)
    c.client.xpending_range = AsyncMock(return_value=[])
    c.dlq = MagicMock()
    c.dlq.send_to_dlq = AsyncMock(return_value=True)
    return c


async def test_acknowledge_uses_only_the_known_stream():
    c = unit_consumer()
    await c.acknowledge("1-0", BF)
    c.client.xack.assert_awaited_once_with(BF, GROUP, "1-0")


async def test_acknowledge_without_stream_tries_all_until_hit():
    c = unit_consumer()
    c.client.xack = AsyncMock(side_effect=[0, 1])
    await c.acknowledge("1-0")
    assert c.client.xack.await_count == 2 and c.messages_acknowledged == 1


async def test_dlq_write_failure_leaves_message_pending():
    c = unit_consumer()
    c.client.xpending_range = AsyncMock(
        return_value=[{"message_id": "1-0", "times_delivered": 3}]
    )
    c.dlq.send_to_dlq = AsyncMock(return_value=False)
    msg = ProcessedMessage("1-0", PAYLOAD, source_stream=RT)

    await c.reject("1-0", "boom", msg)

    c.client.xack.assert_not_awaited()
    assert c.messages_dead_lettered == 0


async def test_reject_without_message_never_acks():
    c = unit_consumer()
    c.client.xpending_range = AsyncMock(
        return_value=[{"message_id": "1-0", "times_delivered": 9}]
    )
    await c.reject("1-0", "boom")
    c.client.xack.assert_not_awaited()
    c.dlq.send_to_dlq.assert_not_awaited()


async def test_id_key_orders_numerically():
    assert _id_key("9-0") < _id_key("10-0") < _id_key("10-2")
