"""Dead Letter Queue for failed messages that exceed retry limit."""

import json
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from redis.asyncio import Redis

logger = logging.getLogger(__name__)


class DeadLetterQueue:
    """Manages dead letter queue for messages that fail processing."""

    DLQ_STREAM_KEY = "telegram:messages:dlq"
    MAX_DLQ_LENGTH = 10000  # Keep last 10k failed messages

    def __init__(self, redis_client: Redis) -> None:
        self.redis = redis_client

    async def send_to_dlq(
        self,
        stream_id: str,
        message_data: Dict[str, Any],
        error: str,
        retry_count: int,
        original_stream: str = "telegram:messages",
    ) -> bool:
        """
        Send a failed message to the dead letter queue.

        Args:
            stream_id: Original stream entry ID
            message_data: The message data that failed processing
            error: Error message describing the failure
            retry_count: Number of retries attempted
            original_stream: Source stream name

        Returns:
            True if successfully added to DLQ
        """
        try:
            dlq_entry = {
                "original_stream_id": stream_id,
                "original_stream": original_stream,
                "message_data": json.dumps(message_data),
                "error": error,
                "retry_count": str(retry_count),
                "failed_at": datetime.utcnow().isoformat(),
            }

            await self.redis.xadd(
                self.DLQ_STREAM_KEY,
                dlq_entry,
                maxlen=self.MAX_DLQ_LENGTH,
            )

            logger.warning(
                f"Message sent to DLQ: stream_id={stream_id}, error={error}, "
                f"retries={retry_count}"
            )
            return True

        except Exception as e:
            logger.error(f"Failed to send message to DLQ: {e}")
            return False

    async def get_dlq_count(self) -> int:
        """Get the number of messages in the DLQ."""
        return await self.redis.xlen(self.DLQ_STREAM_KEY)

    async def get_dlq_messages(
        self,
        count: int = 100,
        start: str = "-",
        end: str = "+",
    ) -> List[Dict[str, Any]]:
        """
        Read messages from the DLQ for review.

        Args:
            count: Maximum number of messages to return
            start: Start ID (default: oldest)
            end: End ID (default: newest)

        Returns:
            List of DLQ entries
        """
        messages = await self.redis.xrange(
            self.DLQ_STREAM_KEY,
            min=start,
            max=end,
            count=count,
        )

        result = []
        for msg_id, data in messages:
            entry = {
                "dlq_id": msg_id,
                "original_stream_id": data.get("original_stream_id"),
                "error": data.get("error"),
                "retry_count": int(data.get("retry_count", 0)),
                "failed_at": data.get("failed_at"),
            }

            # Parse message_data JSON
            if "message_data" in data:
                try:
                    entry["message_data"] = json.loads(data["message_data"])
                except json.JSONDecodeError:
                    entry["message_data"] = data["message_data"]

            result.append(entry)

        return result
