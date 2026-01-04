"""
Promotion Worker - Handles channel promotion requests from API.

Listens to Redis stream for promotion requests and adds channels
to Telegram folders using ChannelDiscovery.add_channel_to_folder().

This maintains folder as the single source of truth - promotion
modifies the actual Telegram folder, not just the database.
"""

import asyncio
import json
import logging
from typing import TYPE_CHECKING

import redis.asyncio as redis
from redis.exceptions import RedisError

from config.settings import settings

if TYPE_CHECKING:
    from .channel_discovery import ChannelDiscovery

logger = logging.getLogger(__name__)


class PromotionWorker:
    """
    Background worker for processing channel promotion requests.

    Listens to Redis stream 'channels:promote' and adds channels
    to Telegram folders.
    """

    STREAM_PROMOTE = "channels:promote"
    STREAM_RESULT = "channels:promote:result"
    CONSUMER_GROUP = "promotion-workers"

    def __init__(self, channel_discovery: "ChannelDiscovery"):
        """
        Initialize PromotionWorker.

        Args:
            channel_discovery: ChannelDiscovery instance with add_channel_to_folder method
        """
        self.channel_discovery = channel_discovery
        self.redis_client: redis.Redis | None = None
        self._running = False
        self._consumer_name = f"listener-{id(self)}"

    async def start(self) -> None:
        """Start the promotion worker background task."""
        logger.info("Starting promotion worker...")

        try:
            self.redis_client = redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
            )
            await self.redis_client.ping()
            logger.info("Promotion worker connected to Redis")

            await self._ensure_consumer_group()

        except RedisError as e:
            logger.warning(f"Redis unavailable for promotion worker: {e}")
            self.redis_client = None
            return

        self._running = True
        await self._consume_stream()

    async def stop(self) -> None:
        """Stop the promotion worker."""
        logger.info("Stopping promotion worker...")
        self._running = False

        if self.redis_client:
            await self.redis_client.aclose()
            self.redis_client = None

    async def _ensure_consumer_group(self) -> None:
        """Ensure consumer group exists for the stream."""
        if not self.redis_client:
            return

        try:
            await self.redis_client.xgroup_create(
                self.STREAM_PROMOTE,
                self.CONSUMER_GROUP,
                id="0",
                mkstream=True,
            )
            logger.info(f"Created consumer group '{self.CONSUMER_GROUP}'")
        except RedisError as e:
            if "BUSYGROUP" in str(e):
                logger.debug(f"Consumer group '{self.CONSUMER_GROUP}' already exists")
            else:
                raise

    async def _consume_stream(self) -> None:
        """Consume promotion requests from Redis stream."""
        if not self.redis_client:
            return

        logger.info(f"Listening for promotion requests on '{self.STREAM_PROMOTE}'...")

        while self._running:
            try:
                messages = await self.redis_client.xreadgroup(
                    groupname=self.CONSUMER_GROUP,
                    consumername=self._consumer_name,
                    streams={self.STREAM_PROMOTE: ">"},
                    count=1,
                    block=5000,  # 5 second block
                )

                if not messages:
                    continue

                for stream_name, stream_messages in messages:
                    for message_id, data in stream_messages:
                        await self._process_promotion(message_id, data)

            except RedisError as e:
                logger.error(f"Redis error in promotion worker: {e}")
                await asyncio.sleep(5)
            except Exception as e:
                logger.exception(f"Error in promotion worker: {e}")
                await asyncio.sleep(1)

    async def _process_promotion(self, message_id: str, data: dict) -> None:
        """
        Process a single promotion request.

        Expected data format:
        {
            "request_id": "uuid",
            "username": "channel_username",
            "folder": "target_folder_name" (optional),
            "discovered_channel_id": 123 (optional, for updating discovered_channels table)
        }
        """
        request_id = data.get("request_id", message_id)
        username = data.get("username")
        folder = data.get("folder")
        discovered_channel_id = data.get("discovered_channel_id")

        logger.info(f"Processing promotion request {request_id}: @{username} -> {folder}")

        if not username:
            await self._send_result(request_id, {
                "success": False,
                "error": "Missing 'username' in request",
            })
            await self._ack_message(message_id)
            return

        # Call the channel discovery method to add to folder
        result = await self.channel_discovery.add_channel_to_folder(
            channel_username=username,
            folder_name=folder,
        )

        # Add request context to result
        result["request_id"] = request_id
        if discovered_channel_id:
            result["discovered_channel_id"] = discovered_channel_id

        # Send result back via Redis
        await self._send_result(request_id, result)

        # Acknowledge the message
        await self._ack_message(message_id)

        if result.get("success"):
            logger.info(
                f"Promotion successful: @{username} added to folder '{result.get('folder_name')}'"
            )
        else:
            logger.warning(f"Promotion failed: {result.get('error')}")

    async def _send_result(self, request_id: str, result: dict) -> None:
        """Send promotion result to result stream."""
        if not self.redis_client:
            return

        try:
            await self.redis_client.xadd(
                self.STREAM_RESULT,
                {
                    "request_id": request_id,
                    "result": json.dumps(result),
                },
                maxlen=1000,  # Keep last 1000 results
            )
        except RedisError as e:
            logger.error(f"Failed to send promotion result: {e}")

    async def _ack_message(self, message_id: str) -> None:
        """Acknowledge a processed message."""
        if not self.redis_client:
            return

        try:
            await self.redis_client.xack(
                self.STREAM_PROMOTE,
                self.CONSUMER_GROUP,
                message_id,
            )
        except RedisError as e:
            logger.error(f"Failed to acknowledge message: {e}")


async def start_promotion_worker(
    channel_discovery: "ChannelDiscovery",
) -> PromotionWorker:
    """
    Create and start the promotion worker.

    Args:
        channel_discovery: ChannelDiscovery instance

    Returns:
        Running PromotionWorker instance
    """
    worker = PromotionWorker(channel_discovery)
    asyncio.create_task(worker.start())
    return worker
