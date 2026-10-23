"""Channel discovery and Redis connection metrics. Stubs only; no Telegram."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from prometheus_client import REGISTRY
from redis.exceptions import RedisError

from src import redis_queue as redis_queue_module
from src.channel_discovery import ChannelDiscovery
from src.redis_queue import RedisQueue


def sample(name, **labels):
    return REGISTRY.get_sample_value(name, labels) or 0


def discovery(monkeypatch, result=None, error=None):
    d = ChannelDiscovery(client=MagicMock())
    monkeypatch.setattr(d, "_discover_channels", AsyncMock(return_value=result, side_effect=error))
    return d


async def test_success_records_operation_duration_and_per_folder_gauge(monkeypatch):
    channels = [SimpleNamespace(folder="tg-archiver")] * 3
    ops = sample("telegram_discovery_operations_total", status="success")
    runs = sample("telegram_discovery_duration_seconds_count")

    assert await discovery(monkeypatch, result=channels).discover_channels() == channels

    assert sample("telegram_discovery_operations_total", status="success") == ops + 1
    assert sample("telegram_discovery_duration_seconds_count") == runs + 1
    assert sample("telegram_channels_discovered", folder="tg-archiver") == 3


async def test_folder_gauge_drops_folders_that_disappeared(monkeypatch):
    await discovery(monkeypatch, result=[SimpleNamespace(folder="old")]).discover_channels()
    await discovery(monkeypatch, result=[SimpleNamespace(folder="new")]).discover_channels()

    assert REGISTRY.get_sample_value("telegram_channels_discovered", {"folder": "old"}) is None
    assert sample("telegram_channels_discovered", folder="new") == 1


async def test_schema_mismatch_counts_as_failed_and_returns_empty(monkeypatch):
    failed = sample("telegram_discovery_operations_total", status="failed")

    assert await discovery(monkeypatch, result=None).discover_channels() == []

    assert sample("telegram_discovery_operations_total", status="failed") == failed + 1


async def test_exception_counts_as_failed_and_propagates(monkeypatch):
    failed = sample("telegram_discovery_operations_total", status="failed")

    with pytest.raises(RuntimeError):
        await discovery(monkeypatch, error=RuntimeError("boom")).discover_channels()

    assert sample("telegram_discovery_operations_total", status="failed") == failed + 1


async def test_redis_connect_sets_gauge_and_failure_counts_error(monkeypatch):
    client = MagicMock()
    client.ping = AsyncMock()
    client.close = AsyncMock()
    monkeypatch.setattr(redis_queue_module.redis, "from_url", lambda *a, **k: client)
    queue = RedisQueue()
    monkeypatch.setattr(queue, "_ensure_consumer_group", AsyncMock())

    await queue.connect()
    assert sample("redis_connections_active") == 1
    await queue.disconnect()
    assert sample("redis_connections_active") == 0

    client.ping = AsyncMock(side_effect=RedisError("down"))
    errors = sample("connection_errors_total", service="redis")
    with pytest.raises(RedisError):
        await queue.connect()
    assert sample("connection_errors_total", service="redis") == errors + 1
