"""
Queue / DLQ gauges set by the processor's 10 s updater, and the single observation of
the processing duration. Needs a REAL Redis 8 (TEST_REDIS_URL); the database is flushed.
"""

import os

import pytest_asyncio
import redis.asyncio as redis
from prometheus_client import REGISTRY

for _k, _v in {
    "JWT_SECRET_KEY": "x" * 48,
    "REDIS_PASSWORD": "x",
    "POSTGRES_PASSWORD": "x",
    "MINIO_ENDPOINT": "x:9000",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

from observability import metrics  # noqa: E402

from src import message_processor  # noqa: E402
from src.dead_letter_queue import DeadLetterQueue  # noqa: E402
from src.redis_consumer import RedisConsumer  # noqa: E402

REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")
RT = RedisConsumer.STREAM_REALTIME
BF = RedisConsumer.STREAM_BACKFILL
LEGACY = RedisConsumer.STREAM_LEGACY


@pytest_asyncio.fixture
async def consumer():
    client = redis.from_url(REDIS_URL, decode_responses=True)
    await client.flushdb()
    c = RedisConsumer()
    c.client = client
    c.dlq = DeadLetterQueue(client)
    await c._ensure_consumer_group()
    yield c
    await client.flushdb()
    await client.aclose()


def sample(name, **labels):
    return REGISTRY.get_sample_value(name, labels or None)


async def test_updater_sets_per_stream_backlog(consumer):
    for _ in range(5):
        await consumer.client.xadd(RT, {"message_id": "1"})
    for _ in range(3):
        await consumer.client.xadd(BF, {"message_id": "2"})
    # 2 realtime entries delivered but not acked: still backlog (pending)
    await consumer.client.xreadgroup(consumer.CONSUMER_GROUP, "c1", {RT: ">"}, count=2)

    await consumer.update_queue_metrics()

    assert sample("tg_queue_depth", stream="realtime") == 5  # 3 unread + 2 pending
    assert sample("tg_queue_depth", stream="backfill") == 3
    assert sample("tg_queue_depth", stream="legacy") == 0
    assert sample("tg_queue_messages_pending", consumer_group=consumer.CONSUMER_GROUP) == 2


async def test_acked_messages_leave_the_backlog(consumer):
    ids = [await consumer.client.xadd(RT, {"message_id": str(i)}) for i in range(4)]
    await consumer.client.xreadgroup(consumer.CONSUMER_GROUP, "c1", {RT: ">"}, count=4)
    await consumer.client.xack(RT, consumer.CONSUMER_GROUP, *ids[:3])

    await consumer.update_queue_metrics()

    assert sample("tg_queue_depth", stream="realtime") == 1  # XLEN would say 4


async def test_updater_sets_dlq_gauge(consumer):
    await consumer.update_queue_metrics()
    assert sample("tg_dlq_messages") == 0

    for i in range(2):
        await consumer.dlq.send_to_dlq(f"{i}-0", {"message_id": str(i)}, "boom", 3, RT)
    await consumer.update_queue_metrics()

    assert sample("tg_dlq_messages") == 2


def test_stream_label_and_processed_counter():
    before = {s: sample("tg_processed_total", stream=s) or 0 for s in ("realtime", "backfill", "legacy")}
    for stream in (RT, BF, BF, LEGACY, ""):
        metrics.record_message_processed_by_stream(stream)
    after = {s: sample("tg_processed_total", stream=s) or 0 for s in before}
    assert {s: after[s] - before[s] for s in before} == {"realtime": 1, "backfill": 2, "legacy": 2}


def test_processing_duration_observed_once_per_message():
    before = sample("tg_processing_duration_seconds_count", stage="total") or 0
    metrics.record_message_processed("w", 1, 0.2)
    assert sample("tg_processing_duration_seconds_count", stage="total") == before + 1
    # message_processor must not observe the histogram itself as well
    assert not hasattr(message_processor, "processing_duration_seconds")


def test_removed_osint_metrics_are_not_registered():
    for gone in (
        "tg_llm_requests_total", "tg_rule_evaluations_total", "tg_messages_skipped_total",
        "tg_classifier_mode_total", "tg_api_requests_total", "tg_database_connections_active",
        "tg_pipeline_active", "tg_queue_depth_realtime", "tg_queue_consumer_lag_seconds",
        "tg_topics_total", "tg_database_query_duration_seconds",
    ):
        assert gone not in REGISTRY._names_to_collectors, gone
