"""Lightweight notification client for services."""
import json
import logging
from typing import Any, Optional
from redis.asyncio import Redis
from .schemas import NotificationEvent, PriorityLevel

logger = logging.getLogger(__name__)


class NotificationClient:
    """Lightweight client for emitting notification events.

    Services use this to publish events to Redis. The aggregator service
    subscribes to these events and handles routing to ntfy topics.

    Example:
        notifier = NotificationClient("listener", "redis://redis:6379")
        await notifier.emit("channel.discovered", {"channel": "@UkraineNews"})
    """

    def __init__(self, service_name: str, redis_url: str) -> None:
        """Initialize notification client.

        Args:
            service_name: Name of service (listener, processor, api)
            redis_url: Redis connection URL (e.g., redis://redis:6379)
        """
        self.service_name = service_name
        self.redis_url = redis_url
        self.redis: Optional[Redis] = None
        self.channel = "notifications:events"

    async def _get_redis(self) -> Redis:
        """Get or create Redis connection."""
        if self.redis is None:
            self.redis = Redis.from_url(self.redis_url, decode_responses=True)
        return self.redis

    async def emit(
        self,
        event_type: str,
        data: dict[str, Any],
        priority: PriorityLevel = "default",
        tags: Optional[list[str]] = None,
    ) -> None:
        """Emit notification event.

        Args:
            event_type: Event type (e.g., "message.archived", "spam.detected")
            data: Event-specific payload data
            priority: Notification priority (urgent/high/default/low/min)
            tags: Optional tags for filtering/routing

        Note:
            This is fire-and-forget. If Redis publish fails, we log and continue.
            Services should not block on notification delivery.
        """
        try:
            # Create event
            event = NotificationEvent(
                service=self.service_name,
                type=event_type,
                data=data,
                priority=priority,
                tags=tags or [],
            )

            # Publish to Redis (fire-and-forget)
            redis = await self._get_redis()
            await redis.publish(self.channel, event.model_dump_json())

            logger.debug(
                f"Emitted {event_type} event",
                extra={"service": self.service_name, "priority": priority}
            )

        except Exception as e:
            # Fire-and-forget: Log error but don't crash service
            logger.warning(
                f"Failed to emit notification: {e}",
                extra={"event_type": event_type, "service": self.service_name}
            )

    async def close(self) -> None:
        """Close Redis connection."""
        if self.redis:
            await self.redis.close()
            self.redis = None
