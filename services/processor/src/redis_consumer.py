"""
Redis Consumer - Message Queue Consumer for Processor Workers

Consumes messages from Redis Streams using consumer groups.
Provides reliable message delivery with acknowledgment.

Architecture:
- Stream: telegram:messages
- Consumer Group: processor-workers
- Consumer Name: worker-{hostname}-{pid}
- Auto-claim: Redeliver unacked (failed/crashed) messages after PROCESSOR_RETRY_IDLE_MS (5 min)
- Block time: 5000ms (5 seconds)

Features:
- Acknowledgment only after successful processing; failures are retried
- Dead letter queue (full payload) after 3 failed deliveries
- Graceful shutdown (stop consuming, finish current message)
- Message parsing from Redis Stream format
"""

import asyncio
import logging
import os
import socket
from typing import AsyncGenerator, Optional

import redis.asyncio as redis
from redis.asyncio.client import Redis
from redis.exceptions import RedisError

from config.settings import settings
from observability import redact_url
from config import Timeouts, RetryConfig
from .dead_letter_queue import DeadLetterQueue

logger = logging.getLogger(__name__)


def _id_key(stream_id: str) -> tuple[int, int]:
    """Sort key for Redis Stream IDs ("ms-seq")."""
    ms, _, seq = stream_id.partition("-")
    return int(ms), int(seq or 0)


class ProcessedMessage:
    """
    Parsed message from Redis Stream.

    Contains all fields needed for processing.
    """

    def __init__(self, stream_id: str, data: dict, source_stream: Optional[str] = None):
        """
        Initialize processed message.

        Args:
            stream_id: Redis Stream message ID
            data: Message data from stream
            source_stream: Name of the stream the message was read from
        """
        self.stream_id = stream_id
        self.source_stream = source_stream
        # Verbatim stream fields, kept so a failed message can be dead-lettered and replayed
        self.raw_fields = dict(data)
        self.message_id = int(data.get("message_id", 0))
        self.channel_id = int(data.get("channel_id", 0))
        self.content = data.get("content", "")
        self.media_type = data.get("media_type") or None
        self.media_url = data.get("media_url") or None
        self.telegram_date = data.get("telegram_date")
        self.ingested_at = data.get("ingested_at")

        # Album/grouped message support
        self.grouped_id = int(data.get("grouped_id")) if data.get("grouped_id") else None
        self.media_count = int(data.get("media_count", 1))

        # Parse album_message_ids (list of all message IDs in album)
        import json
        album_ids_str = data.get("album_message_ids")
        if album_ids_str:
            try:
                self.album_message_ids = json.loads(album_ids_str) if isinstance(album_ids_str, str) else album_ids_str
            except (json.JSONDecodeError, TypeError):
                self.album_message_ids = None
        else:
            self.album_message_ids = None

        # Engagement metrics (from Telegram API)
        self.views = int(data.get("views")) if data.get("views") else None
        self.forwards = int(data.get("forwards")) if data.get("forwards") else None

        # Social graph metadata (from Telegram listener)
        self.author_user_id = int(data.get("author_user_id")) if data.get("author_user_id") else None
        self.replied_to_message_id = int(data.get("replied_to_message_id")) if data.get("replied_to_message_id") else None
        self.forward_from_channel_id = int(data.get("forward_from_channel_id")) if data.get("forward_from_channel_id") else None
        self.forward_from_message_id = int(data.get("forward_from_message_id")) if data.get("forward_from_message_id") else None
        self.forward_date = data.get("forward_date") or None  # ISO format string from Redis

        # Comments/Discussion (Telegram's discussion feature)
        self.has_comments = bool(data.get("has_comments", False))
        self.comments_count = int(data.get("comments_count", 0))
        self.linked_chat_id = int(data.get("linked_chat_id")) if data.get("linked_chat_id") else None

        # Multi-account session routing
        # Identifies which Telegram account received this message (for enrichment routing)
        self.source_account = data.get("source_account", "default")

        # Optional translation info
        self.translated_content = data.get("translated_content") or None
        self.translation_info = data.get("translation_info") or None

        # Backfill flag (from backfill_service)
        # When true, this message was fetched from historical backfill, not live monitoring
        self.is_backfilled = data.get("is_backfilled", "").lower() == "true"

        # Reprocessing flags (from decision_reprocessor enrichment task)
        # When set, this message is being re-classified through the pipeline
        self.is_reprocess = data.get("is_reprocess", "").lower() == "true"
        self.previous_decision_id = (
            int(data.get("previous_decision_id"))
            if data.get("previous_decision_id")
            else None
        )
        # Skip media archival for reprocessed messages (already archived)
        self.skip_media_archival = data.get("skip_media_archival", "").lower() == "true"
        # Database message ID (for updating existing record instead of creating new)
        self.db_message_id = (
            int(data.get("db_message_id"))
            if data.get("db_message_id")
            else None
        )

        # Cross-service tracing
        # trace_id enables log correlation between listener and processor
        self.trace_id = data.get("trace_id", "unknown")

    def __repr__(self) -> str:
        return (
            f"ProcessedMessage(stream_id={self.stream_id}, "
            f"message_id={self.message_id}, channel_id={self.channel_id}, "
            f"has_media={bool(self.media_type)}, trace_id={self.trace_id})"
        )


class RedisConsumer:
    """
    Redis Streams consumer for processor workers.

    Priority Queue Architecture (v2 - December 2024):
    - STREAM_REALTIME: Live messages (highest priority, always checked first)
    - STREAM_BACKFILL: Historical messages (lowest priority, only when idle)

    Legacy (deprecated):
    - STREAM_LEGACY: Old single stream from pre-v2 deployments.
      Drained during migration, will be removed once empty.
      New deployments should NOT have any messages in this stream.

    Processing order:
    1. Auto-claim pending messages from dead workers
    2. Check realtime (1s block)
    3. If empty, check legacy stream (drain migration backlog)
    4. If empty, check backfill (no block, 1 message at a time)
    5. Loop back to realtime
    """

    # Priority order (highest to lowest)
    STREAM_REALTIME = "telegram:messages:realtime"
    STREAM_BACKFILL = "telegram:messages:backfill"

    # Legacy stream - DEPRECATED, only for draining old deployments
    STREAM_LEGACY = "telegram:messages"

    # All streams in priority order
    PRIORITY_STREAMS = [STREAM_REALTIME, STREAM_LEGACY, STREAM_BACKFILL]

    CONSUMER_GROUP = "processor-workers"
    BLOCK_TIME_REALTIME_MS = 1000  # 1 second for realtime (responsive)
    BLOCK_TIME_LEGACY_MS = 0  # No block for legacy/backfill
    AUTO_CLAIM_MIN_IDLE_MS = 300000  # 5 minutes (reclaim from dead workers)
    MAX_RETRIES = 3
    BATCH_SIZE = 10  # Read 10 messages per XREADGROUP call

    def __init__(self):
        """Initialize Redis consumer."""
        self.client: Optional[Redis] = None
        self.dlq: Optional[DeadLetterQueue] = None

        # Consumer name: worker-{hostname}-{pid}
        hostname = socket.gethostname()
        pid = os.getpid()
        self.consumer_name = f"worker-{hostname}-{pid}"

        # Batch size for XREADGROUP (configurable via settings)
        self.batch_size = settings.PROCESSOR_BATCH_SIZE

        # Shutdown flag
        self._shutdown = False

        # Statistics
        self.messages_consumed = 0
        self.messages_acknowledged = 0
        self.messages_failed = 0
        self.messages_retried = 0
        self.messages_dead_lettered = 0

        # Idle time before an unacked (failed or crashed) message is redelivered
        self.auto_claim_min_idle_ms = settings.PROCESSOR_RETRY_IDLE_MS

    async def connect(self):
        """
        Connect to Redis and ensure consumer group exists.

        Raises:
            RedisError: If connection fails
        """
        try:
            self.client = redis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=Timeouts.SOCKET_CONNECT,
                socket_keepalive=True,
            )

            # Test connection
            await self.client.ping()

            logger.info(
                f"Redis consumer connected: {self.consumer_name} @ {redact_url(settings.REDIS_URL)}"
            )

            # Initialize Dead Letter Queue
            self.dlq = DeadLetterQueue(self.client)

            # Ensure consumer group exists
            await self._ensure_consumer_group()

        except RedisError as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise

    async def disconnect(self):
        """Disconnect from Redis."""
        if self.client:
            await self.client.close()
            logger.info("Redis consumer disconnected")

    async def _ensure_consumer_group(self):
        """Create consumer groups for all priority streams."""
        for stream_name in self.PRIORITY_STREAMS:
            try:
                # Try to create consumer group
                await self.client.xgroup_create(
                    name=stream_name,
                    groupname=self.CONSUMER_GROUP,
                    id="0",
                    mkstream=True,
                )
                logger.info(
                    f"Created consumer group '{self.CONSUMER_GROUP}' for stream '{stream_name}'"
                )
            except RedisError as e:
                if "BUSYGROUP" in str(e):
                    # Group already exists
                    logger.debug(f"Consumer group '{self.CONSUMER_GROUP}' already exists for {stream_name}")
                else:
                    logger.error(f"Error creating consumer group for {stream_name}: {e}")
                    raise

        # Clean up stale consumers from previous container restarts
        await self._cleanup_stale_consumers()

    async def _cleanup_stale_consumers(self, max_idle_ms: int = 300000):
        """
        Remove idle consumers that own no pending messages.

        Consumers that still own pending entries are never deleted: XGROUP
        DELCONSUMER would drop those entries from the PEL (message loss).
        XAUTOCLAIM moves them to a live consumer once they are idle long enough.

        Args:
            max_idle_ms: Maximum idle time in milliseconds before removal
        """
        total_removed = 0

        for stream_name in self.PRIORITY_STREAMS:
            try:
                consumers = await self.client.xinfo_consumers(
                    name=stream_name,
                    groupname=self.CONSUMER_GROUP
                )

                for consumer in consumers:
                    consumer_name = consumer.get("name", "")

                    if consumer_name == self.consumer_name:
                        continue
                    if consumer.get("pending", 0) > 0:
                        continue
                    if consumer.get("idle", 0) <= max_idle_ms:
                        continue

                    await self.client.xgroup_delconsumer(
                        name=stream_name,
                        groupname=self.CONSUMER_GROUP,
                        consumername=consumer_name
                    )
                    total_removed += 1
                    logger.debug(f"Removed stale consumer from {stream_name}: {consumer_name}")

            except RedisError as e:
                # Non-fatal - log and continue to next stream
                logger.warning(f"Failed to cleanup stale consumers from {stream_name}: {e}")

        if total_removed > 0:
            logger.info(f"Cleaned up {total_removed} idle consumers with no pending messages")

    async def consume_messages(self) -> AsyncGenerator[ProcessedMessage, None]:
        """
        Consume messages from Redis Streams with priority ordering.

        Priority order:
        1. STREAM_REALTIME - Live messages (1s block wait)
        2. STREAM_LEGACY - Old single stream (drain during migration)
        3. STREAM_BACKFILL - Historical messages (only when idle)

        After processing any message, loops back to check realtime first.
        This ensures real-time messages are never starved by backfill.

        Yields:
            ProcessedMessage instances

        This is a generator that yields messages as they arrive.
        Use like: async for message in consumer.consume_messages()
        """
        if not self.client:
            raise RedisError("Redis client not connected")

        logger.info(
            f"Starting priority message consumption: consumer={self.consumer_name}, "
            f"group={self.CONSUMER_GROUP}, streams={self.PRIORITY_STREAMS}"
        )

        while not self._shutdown:
            try:
                # First, try to auto-claim unacked messages (failed or from dead workers)
                batch = await self._auto_claim_pending()

                if not batch:
                    # Priority 1: REALTIME (short block); 2: LEGACY (drain migration);
                    # 3: BACKFILL (1 message, then check realtime again)
                    for stream_name, block_ms, count in (
                        (self.STREAM_REALTIME, self.BLOCK_TIME_REALTIME_MS, self.batch_size),
                        (self.STREAM_LEGACY, self.BLOCK_TIME_LEGACY_MS, self.batch_size),
                        (self.STREAM_BACKFILL, self.BLOCK_TIME_LEGACY_MS, 1),
                    ):
                        batch = await self._read_from_stream(stream_name, block_ms, count)
                        if batch:
                            break

                for stream_name, stream_id, data in batch:
                    self.messages_consumed += 1
                    yield ProcessedMessage(stream_id, data, source_stream=stream_name)

            except asyncio.CancelledError:
                logger.info("Message consumption cancelled")
                break
            except RedisError as e:
                logger.error(f"Error consuming messages: {e}")
                await asyncio.sleep(RetryConfig.RETRY_LONG)  # Wait before retry
                continue
            except Exception as e:
                logger.exception(f"Unexpected error in message consumption: {e}")
                await asyncio.sleep(RetryConfig.RETRY_LONG)
                continue

    async def _read_from_stream(
        self,
        stream_name: str,
        block_ms: int = 0,
        count: int = 10
    ) -> list[tuple[str, str, dict]]:
        """
        Read messages from a specific stream.

        Args:
            stream_name: Redis stream name
            block_ms: Block timeout in milliseconds (0 = no block)
            count: Maximum messages to read

        Returns:
            List of (stream_name, stream_id, data) tuples
        """
        try:
            messages = await self.client.xreadgroup(
                groupname=self.CONSUMER_GROUP,
                consumername=self.consumer_name,
                streams={stream_name: ">"},
                count=count,
                block=block_ms if block_ms > 0 else None,
            )

            if not messages:
                return []

            # Extract messages from response
            result = []
            for _, stream_messages in messages:
                for stream_id, data in stream_messages:
                    result.append((stream_name, stream_id, data))

            return result

        except RedisError as e:
            logger.warning(f"Error reading from {stream_name}: {e}")
            return []

    async def _auto_claim_pending(self) -> list[tuple[str, str, dict]]:
        """
        Auto-claim unacked messages across all priority streams.

        This is the retry path: a message that failed (reject() leaves it
        pending) or whose worker died is reclaimed once idle for
        auto_claim_min_idle_ms. Messages already delivered more than
        MAX_RETRIES times crashed/hung the worker without ever being rejected;
        they are dead-lettered and acked here instead of being yielded.

        Returns:
            List of (stream_name, stream_id, data) tuples to process
        """
        all_claimed = []

        for stream_name in self.PRIORITY_STREAMS:
            try:
                pending = await self.client.xpending(
                    name=stream_name,
                    groupname=self.CONSUMER_GROUP,
                )

                if not pending or pending.get("pending", 0) == 0:
                    continue

                result = await self.client.xautoclaim(
                    name=stream_name,
                    groupname=self.CONSUMER_GROUP,
                    consumername=self.consumer_name,
                    min_idle_time=self.auto_claim_min_idle_ms,
                    start_id="0-0",
                    count=10,  # Claim up to 10 at a time
                )

                # Result format: (next_start_id, claimed_messages, deleted_ids)
                claimed = [(i, d) for i, d in result[1] if d is not None] if len(result) >= 2 else []
                if not claimed:
                    continue

                counts = await self._get_delivery_counts(stream_name, [i for i, _ in claimed])
                for stream_id, data in claimed:
                    deliveries = counts.get(stream_id, 1)
                    if deliveries > self.MAX_RETRIES:
                        await self._dead_letter(
                            stream_name, stream_id, data,
                            f"Exceeded {self.MAX_RETRIES} deliveries without being rejected "
                            f"(worker crash or hang suspected)",
                            deliveries,
                        )
                    else:
                        all_claimed.append((stream_name, stream_id, data))

                logger.info(f"Auto-claimed {len(claimed)} pending messages from {stream_name}")

            except RedisError as e:
                logger.warning(f"Error auto-claiming from {stream_name}: {e}")
                continue

        return all_claimed

    async def _get_delivery_counts(self, stream_name: str, stream_ids: list[str]) -> dict[str, int]:
        """Delivery counts (XPENDING) for the given ids of one stream."""
        details = await self.client.xpending_range(
            name=stream_name,
            groupname=self.CONSUMER_GROUP,
            min=min(stream_ids, key=_id_key),
            max=max(stream_ids, key=_id_key),
            count=len(stream_ids) + 1000,  # the id range may also contain other pending ids
        )
        wanted = set(stream_ids)
        return {d["message_id"]: d["times_delivered"] for d in details if d["message_id"] in wanted}

    async def _dead_letter(
        self, stream_name: str, stream_id: str, fields: dict, error: str, retry_count: int
    ) -> bool:
        """
        Write a message to the DLQ and, only if that succeeded, XACK it.

        If the DLQ write fails the message stays pending (nothing is lost).
        """
        if not await self.dlq.send_to_dlq(
            stream_id=stream_id,
            fields=fields,
            error=error,
            retry_count=retry_count,
            original_stream=stream_name,
        ):
            return False
        await self._xack(stream_id, stream_name)
        self.messages_dead_lettered += 1
        return True

    async def _xack(self, stream_id: str, stream_name: Optional[str] = None) -> int:
        """XACK on the known stream, or (tolerant fallback) on every stream."""
        for name in [stream_name] if stream_name else self.PRIORITY_STREAMS:
            if await self.client.xack(name, self.CONSUMER_GROUP, stream_id) > 0:
                return 1
        return 0

    async def acknowledge(self, stream_id: str, stream_name: Optional[str] = None):
        """
        Acknowledge message as successfully processed.

        Args:
            stream_id: Redis Stream message ID
            stream_name: Source stream (if unknown, all streams are tried)
        """
        if not self.client:
            raise RedisError("Redis client not connected")

        try:
            await self._xack(stream_id, stream_name)
            self.messages_acknowledged += 1
            logger.debug(f"Acknowledged message: {stream_id}")

        except RedisError as e:
            logger.error(f"Failed to acknowledge message {stream_id}: {e}")
            raise

    async def reject(self, stream_id: str, error: str, message: Optional[ProcessedMessage] = None):
        """
        Reject message (failed processing).

        Below MAX_RETRIES deliveries the message is left pending so XAUTOCLAIM
        redelivers it after the idle time. Once it has been delivered
        MAX_RETRIES times it is dead-lettered (full payload) and acked.

        Args:
            stream_id: Redis Stream message ID
            error: Error description
            message: ProcessedMessage instance (needed to dead-letter)
        """
        self.messages_failed += 1
        stream_name = message.source_stream if message else None
        retry_count = await self._get_delivery_count(stream_id, stream_name)

        if retry_count < self.MAX_RETRIES:
            self.messages_retried += 1
            logger.error(
                f"Message failed (delivery {retry_count}/{self.MAX_RETRIES}), "
                f"will retry: {stream_id} - {error}"
            )
            return

        if not (self.dlq and message and stream_name):
            # Cannot dead-letter without the payload and stream; keep it pending
            logger.error(f"Message failed, cannot dead-letter, left pending: {stream_id} - {error}")
            return

        logger.error(f"Message failed {retry_count} times, dead-lettering: {stream_id} - {error}")
        await self._dead_letter(stream_name, stream_id, message.raw_fields, error, retry_count)

    async def _get_delivery_count(self, stream_id: str, stream_name: Optional[str] = None) -> int:
        """
        Get delivery count for a message from XPENDING.

        Args:
            stream_id: Redis Stream message ID
            stream_name: Source stream (if unknown, all streams are searched)

        Returns:
            Number of times message has been delivered (1 = first attempt)
        """
        try:
            for name in [stream_name] if stream_name else self.PRIORITY_STREAMS:
                counts = await self._get_delivery_counts(name, [stream_id])
                if stream_id in counts:
                    return counts[stream_id]
            return 1  # Not pending: assume first attempt

        except RedisError as e:
            logger.error(f"Failed to get delivery count for {stream_id}: {e}")
            return 1  # Default to 1 on error

    async def get_pending_count(self) -> int:
        """
        Get total count of messages pending processing across all streams.

        Returns:
            Total number of pending messages
        """
        if not self.client:
            return 0

        total_pending = 0
        for stream_name in self.PRIORITY_STREAMS:
            try:
                pending = await self.client.xpending(
                    name=stream_name,
                    groupname=self.CONSUMER_GROUP,
                )
                total_pending += pending.get("pending", 0)
            except RedisError as e:
                # Stream might not exist yet
                logger.debug(f"Failed to get pending count for {stream_name}: {e}")

        return total_pending

    async def get_queue_depths(self) -> dict[str, int]:
        """
        Get queue depth (pending + unread) for each priority stream.

        Returns:
            Dictionary mapping stream name to total messages waiting
        """
        if not self.client:
            return {}

        depths = {}
        for stream_name in self.PRIORITY_STREAMS:
            try:
                # Get stream length (all messages not yet trimmed)
                stream_len = await self.client.xlen(stream_name)
                depths[stream_name] = stream_len
            except RedisError:
                depths[stream_name] = 0

        return depths

    def shutdown(self):
        """Signal consumer to stop consuming messages."""
        logger.info("Shutdown signal received")
        self._shutdown = True

    def get_stats(self) -> dict:
        """
        Get consumer statistics.

        Returns:
            Dictionary with stats
        """
        success_rate = (
            self.messages_acknowledged / self.messages_consumed
            if self.messages_consumed > 0
            else 0.0
        )

        return {
            "consumer_name": self.consumer_name,
            "messages_consumed": self.messages_consumed,
            "messages_acknowledged": self.messages_acknowledged,
            "messages_failed": self.messages_failed,
            "messages_retried": self.messages_retried,
            "messages_dead_lettered": self.messages_dead_lettered,
            "success_rate": success_rate,
        }


# Global Redis consumer instance
redis_consumer = RedisConsumer()
