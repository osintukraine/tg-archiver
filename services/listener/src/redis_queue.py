"""
Redis Queue Client - Message Ingestion

Pushes raw Telegram messages to Redis Streams for processing.
Uses Redis 7 Streams with consumer groups for reliable delivery.

Architecture (v2 - Priority Queues):
1. Listener pushes messages to priority streams:
   - telegram:messages:realtime - Live messages (processed first)
   - telegram:messages:backfill - Historical messages (processed when idle)
2. Processor workers consume from streams in priority order
3. Messages remain in stream until acknowledged
4. Dead letter queue for failed messages after max retries

Stream Structure:
- Realtime stream: "telegram:messages:realtime"
- Backfill stream: "telegram:messages:backfill"
- Fields: message_id, channel_id, content, media_type, etc.
- Consumer group: "processor-workers"
- Max length: 100,000 messages per stream (MAXLEN ~ 100000)

Legacy:
- "telegram:messages" stream is deprecated and only drained by processor
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Optional

import redis.asyncio as redis
from redis.asyncio.client import Redis
from redis.exceptions import RedisError

from config.settings import settings

logger = logging.getLogger(__name__)


class RedisQueue:
    """
    Redis Streams client for message queue.

    Uses Redis 7 Streams with consumer groups for reliable message delivery.

    Priority Queue Architecture (v2 - December 2024):
    - STREAM_REALTIME: Live messages from Telegram monitoring (processed first)
    - STREAM_BACKFILL: Historical messages from backfill service (processed when idle)

    Legacy:
    - STREAM_KEY: Old single stream, deprecated. Only exists for draining
      messages from pre-v2 deployments. Will be removed once drained.
    """

    # Priority streams (current architecture)
    STREAM_REALTIME = "telegram:messages:realtime"
    STREAM_BACKFILL = "telegram:messages:backfill"

    # Legacy stream - DEPRECATED, do not use for new messages
    # Only kept for processor to drain existing messages from old deployments
    STREAM_KEY = "telegram:messages"

    CONSUMER_GROUP = "processor-workers"
    MAX_STREAM_LENGTH = 100000  # 10x increase for 500+ channels (handles 100k msg burst)

    def __init__(self):
        """Initialize Redis client."""
        self.client: Optional[Redis] = None
        self._connection_count = 0

    async def connect(self):
        """
        Connect to Redis and create consumer group if needed.

        Raises:
            RedisError: If connection fails
        """
        try:
            self.client = redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=5,
                socket_keepalive=True,
            )

            # Test connection
            await self.client.ping()

            self._connection_count += 1
            logger.info(
                f"Connected to Redis (connection #{self._connection_count}): "
                f"{settings.REDIS_URL}"
            )

            # Create consumer group if it doesn't exist
            await self._ensure_consumer_group()

        except RedisError as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise

    async def disconnect(self):
        """Disconnect from Redis."""
        if self.client:
            await self.client.close()
            logger.info("Disconnected from Redis")

    async def _ensure_consumer_group(self):
        """
        Create consumer groups for priority streams.

        Consumer group allows multiple processor workers to consume
        messages in parallel without duplicates.

        Creates groups on:
        - STREAM_REALTIME: Live messages (primary)
        - STREAM_BACKFILL: Historical messages
        - STREAM_KEY: Legacy stream (for migration only, will be removed)
        """
        # Priority streams for new deployments
        streams_to_init = [self.STREAM_REALTIME, self.STREAM_BACKFILL]

        for stream_name in streams_to_init:
            try:
                await self.client.xgroup_create(
                    name=stream_name,
                    groupname=self.CONSUMER_GROUP,
                    id="0",  # Start from beginning
                    mkstream=True,  # Create stream if doesn't exist
                )
                logger.info(
                    f"Created consumer group '{self.CONSUMER_GROUP}' for stream '{stream_name}'"
                )
            except RedisError as e:
                if "BUSYGROUP" in str(e):
                    # Group already exists - this is fine
                    logger.debug(f"Consumer group '{self.CONSUMER_GROUP}' already exists for {stream_name}")
                else:
                    logger.error(f"Error creating consumer group for {stream_name}: {e}")
                    raise

    async def push_message(
        self,
        message_id: int,
        channel_id: int,
        content: Optional[str],
        media_type: Optional[str] = None,
        media_url: Optional[str] = None,
        telegram_date: Optional[datetime] = None,
        is_backfilled: bool = False,
        **extra_fields,
    ) -> str:
        """
        Push a raw Telegram message to Redis queue.

        Routes to priority streams based on is_backfilled:
        - Real-time messages → STREAM_REALTIME (processed first)
        - Backfill messages → STREAM_BACKFILL (processed when idle)

        Args:
            message_id: Telegram message ID
            channel_id: Telegram channel ID
            content: Message text content
            media_type: Type of media (photo, video, document, etc.)
            media_url: Telegram media URL
            telegram_date: Message timestamp
            is_backfilled: If True, routes to backfill stream (lower priority)
            **extra_fields: Additional fields to store

        Returns:
            Redis Stream message ID (e.g., "1234567890-0")

        Raises:
            RedisError: If push fails
        """
        if not self.client:
            raise RedisError("Redis client not connected")

        # Generate trace_id for cross-service request correlation
        trace_id = str(uuid.uuid4())

        # Prepare message fields
        fields = {
            "message_id": str(message_id),
            "channel_id": str(channel_id),
            "content": content or "",
            "media_type": media_type or "",
            "media_url": media_url or "",
            "telegram_date": (
                telegram_date.isoformat() if telegram_date else datetime.utcnow().isoformat()
            ),
            "ingested_at": datetime.utcnow().isoformat(),
            "trace_id": trace_id,  # For cross-service log correlation
        }

        # Add any extra fields
        for key, value in extra_fields.items():
            if value is not None:
                # Convert complex types to JSON
                if isinstance(value, (dict, list)):
                    fields[key] = json.dumps(value)
                else:
                    fields[key] = str(value)

        try:
            # Route to priority stream based on is_backfilled
            stream_name = self.STREAM_BACKFILL if is_backfilled else self.STREAM_REALTIME

            # Add message to stream with MAXLEN to prevent unbounded growth
            stream_id = await self.client.xadd(
                name=stream_name,
                fields=fields,
                maxlen=self.MAX_STREAM_LENGTH,
                approximate=True,  # ~MAXLEN for better performance
            )

            logger.debug(
                f"Pushed message to queue: stream={stream_name}, stream_id={stream_id}, "
                f"message_id={message_id}, channel_id={channel_id}, "
                f"has_media={bool(media_type)}, trace_id={trace_id}"
            )

            return stream_id

        except RedisError as e:
            logger.error(
                f"Failed to push message to queue (msg_id={message_id}, "
                f"channel_id={channel_id}): {e}"
            )
            raise

    async def get_stream_info(self) -> dict[str, Any]:
        """
        Get information about the message stream.

        Returns:
            Dictionary with stream stats:
            - length: Number of messages in stream
            - first_entry: First message ID
            - last_entry: Last message ID
            - groups: Consumer groups info
        """
        if not self.client:
            raise RedisError("Redis client not connected")

        try:
            info = await self.client.xinfo_stream(self.STREAM_KEY)
            groups = await self.client.xinfo_groups(self.STREAM_KEY)

            return {
                "length": info.get("length", 0),
                "first_entry": info.get("first-entry"),
                "last_entry": info.get("last-entry"),
                "groups": groups,
            }
        except RedisError as e:
            logger.error(f"Failed to get stream info: {e}")
            raise

    async def get_pending_count(self) -> int:
        """
        Get count of messages pending processing.

        Returns:
            Number of pending messages in consumer group
        """
        if not self.client:
            raise RedisError("Redis client not connected")

        try:
            pending = await self.client.xpending(
                name=self.STREAM_KEY, groupname=self.CONSUMER_GROUP
            )
            return pending.get("pending", 0)
        except RedisError as e:
            logger.error(f"Failed to get pending count: {e}")
            return 0

    async def health_check(self) -> bool:
        """
        Check if Redis connection is healthy.

        Returns:
            True if healthy, False otherwise
        """
        if not self.client:
            return False

        try:
            await self.client.ping()
            return True
        except RedisError:
            return False


# Global Redis queue instance
redis_queue = RedisQueue()
