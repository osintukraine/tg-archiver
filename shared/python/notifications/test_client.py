"""Tests for NotificationClient."""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from .client import NotificationClient
from .schemas import NotificationEvent


@pytest.fixture
def mock_redis():
    """Mock Redis client."""
    redis = MagicMock()
    redis.publish = AsyncMock()
    return redis


@pytest.mark.asyncio
async def test_emit_event_publishes_to_redis(mock_redis):
    """Emitting event should publish to Redis channel."""
    with patch("notifications.client.Redis.from_url", return_value=mock_redis):
        client = NotificationClient("test-service", "redis://localhost")

        await client.emit(
            "test.event",
            {"foo": "bar"},
            priority="high",
            tags=["test"]
        )

        # Verify Redis publish called
        assert mock_redis.publish.called
        call_args = mock_redis.publish.call_args

        # Verify channel name
        assert call_args[0][0] == "notifications:events"

        # Verify event structure
        event_json = call_args[0][1]
        event = json.loads(event_json)
        assert event["service"] == "test-service"
        assert event["type"] == "test.event"
        assert event["data"] == {"foo": "bar"}
        assert event["priority"] == "high"
        assert event["tags"] == ["test"]
        assert "timestamp" in event


@pytest.mark.asyncio
async def test_emit_with_defaults(mock_redis):
    """Emitting without priority/tags should use defaults."""
    with patch("notifications.client.Redis.from_url", return_value=mock_redis):
        client = NotificationClient("service", "redis://localhost")

        await client.emit("event.type", {"data": "value"})

        event_json = mock_redis.publish.call_args[0][1]
        event = json.loads(event_json)
        assert event["priority"] == "default"
        assert event["tags"] == []


@pytest.mark.asyncio
async def test_emit_validates_priority(mock_redis):
    """Invalid priority should be handled gracefully (fire-and-forget)."""
    with patch("notifications.client.Redis.from_url", return_value=mock_redis):
        client = NotificationClient("service", "redis://localhost")

        # Should not raise - invalid priority logged and ignored
        await client.emit("test", {}, priority="invalid")

        # Redis publish should NOT be called (validation failed)
        assert not mock_redis.publish.called


@pytest.mark.asyncio
async def test_emit_handles_redis_failure_gracefully(mock_redis):
    """Redis publish failure should not crash (fire-and-forget)."""
    mock_redis.publish.side_effect = Exception("Redis connection failed")

    with patch("notifications.client.Redis.from_url", return_value=mock_redis):
        client = NotificationClient("service", "redis://localhost")

        # Should not raise exception
        await client.emit("test.event", {"data": "value"})


@pytest.mark.asyncio
async def test_close_cleans_up_redis_connection(mock_redis):
    """Calling close should cleanup Redis connection."""
    mock_redis.close = AsyncMock()

    with patch("notifications.client.Redis.from_url", return_value=mock_redis):
        client = NotificationClient("service", "redis://localhost")
        await client.emit("test", {})  # Establish connection

        await client.close()

        assert mock_redis.close.called
