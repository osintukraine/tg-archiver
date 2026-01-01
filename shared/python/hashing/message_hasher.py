"""
Message Authenticity Hashing

Generates cryptographic hashes to prove message authenticity and detect tampering.

Hash Strategy:
1. content_hash: SHA-256 of message content only
2. metadata_hash: SHA-256 of full message + all immutable metadata

Hash Components (in order):
- message_id (Telegram message ID)
- channel_id (Telegram channel ID)
- telegram_date (ISO 8601 UTC timestamp)
- content (message text)
- sender_id (author user ID if available)
- forward_from_id (forwarded from user/channel ID)
- forward_from_name (forwarded from name)
- forward_date (ISO 8601 UTC timestamp if forwarded)
"""

import hashlib
import json
from datetime import datetime
from typing import Any, Optional, Tuple
import logging

logger = logging.getLogger(__name__)


class MessageHasher:
    """Generates cryptographic hashes for message authenticity verification"""

    HASH_VERSION = 1
    HASH_ALGORITHM = "sha256"

    @staticmethod
    def _normalize_datetime(dt: Optional[datetime]) -> Optional[str]:
        """Convert datetime to ISO 8601 UTC string for consistent hashing"""
        if not dt:
            return None
        # Ensure UTC timezone
        if dt.tzinfo is None:
            # Assume UTC if no timezone
            return dt.isoformat() + "Z"
        return dt.isoformat()

    @staticmethod
    def _normalize_value(value: Any) -> str:
        """Normalize a value for hashing (consistent string representation)"""
        if value is None:
            return ""
        if isinstance(value, datetime):
            return MessageHasher._normalize_datetime(value) or ""
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(value)

    @staticmethod
    def generate_content_hash(content: Optional[str]) -> str:
        """
        Generate SHA-256 hash of message content only.

        Args:
            content: Message text content

        Returns:
            64-character hex string (SHA-256 hash)
        """
        if not content:
            content = ""

        # SHA-256 hash of content
        hash_obj = hashlib.sha256(content.encode('utf-8'))
        return hash_obj.hexdigest()

    @staticmethod
    def generate_metadata_hash(
        message_id: int,
        channel_id: int,
        telegram_date: datetime,
        content: Optional[str] = None,
        sender_id: Optional[int] = None,
        forward_from_id: Optional[int] = None,
        forward_from_name: Optional[str] = None,
        forward_date: Optional[datetime] = None,
    ) -> str:
        """
        Generate SHA-256 hash of full message metadata.

        This hash includes all immutable message metadata to prove authenticity.
        The order of fields is fixed to ensure consistent hash generation.

        Args:
            message_id: Telegram message ID
            channel_id: Telegram channel ID
            telegram_date: Message timestamp (UTC)
            content: Message text content
            sender_id: Author user ID
            forward_from_id: Forwarded from user/channel ID
            forward_from_name: Forwarded from name
            forward_date: Forward timestamp (UTC)

        Returns:
            64-character hex string (SHA-256 hash)
        """
        # Build ordered dictionary of metadata (order matters for hash consistency)
        metadata = {
            "message_id": MessageHasher._normalize_value(message_id),
            "channel_id": MessageHasher._normalize_value(channel_id),
            "telegram_date": MessageHasher._normalize_datetime(telegram_date),
            "content": MessageHasher._normalize_value(content),
            "sender_id": MessageHasher._normalize_value(sender_id),
            "forward_from_id": MessageHasher._normalize_value(forward_from_id),
            "forward_from_name": MessageHasher._normalize_value(forward_from_name),
            "forward_date": MessageHasher._normalize_datetime(forward_date),
        }

        # Convert to JSON string with sorted keys for consistency
        metadata_json = json.dumps(metadata, sort_keys=True, ensure_ascii=False)

        # SHA-256 hash of metadata JSON
        hash_obj = hashlib.sha256(metadata_json.encode('utf-8'))
        return hash_obj.hexdigest()

    @staticmethod
    def generate_hashes(
        message_id: int,
        channel_id: int,
        telegram_date: datetime,
        content: Optional[str] = None,
        sender_id: Optional[int] = None,
        forward_from_id: Optional[int] = None,
        forward_from_name: Optional[str] = None,
        forward_date: Optional[datetime] = None,
    ) -> Tuple[str, str]:
        """
        Generate both content hash and metadata hash for a message.

        Returns:
            (content_hash, metadata_hash) tuple
        """
        content_hash = MessageHasher.generate_content_hash(content)
        metadata_hash = MessageHasher.generate_metadata_hash(
            message_id=message_id,
            channel_id=channel_id,
            telegram_date=telegram_date,
            content=content,
            sender_id=sender_id,
            forward_from_id=forward_from_id,
            forward_from_name=forward_from_name,
            forward_date=forward_date,
        )

        return content_hash, metadata_hash

    @staticmethod
    def verify_hash(
        stored_hash: str,
        message_id: int,
        channel_id: int,
        telegram_date: datetime,
        content: Optional[str] = None,
        sender_id: Optional[int] = None,
        forward_from_id: Optional[int] = None,
        forward_from_name: Optional[str] = None,
        forward_date: Optional[datetime] = None,
    ) -> bool:
        """
        Verify that a stored hash matches the computed hash from message data.

        Args:
            stored_hash: The hash stored in the database
            message_id: Telegram message ID
            channel_id: Telegram channel ID
            telegram_date: Message timestamp (UTC)
            content: Message text content
            sender_id: Author user ID
            forward_from_id: Forwarded from user/channel ID
            forward_from_name: Forwarded from name
            forward_date: Forward timestamp (UTC)

        Returns:
            True if hash matches (message is authentic), False otherwise
        """
        _, computed_hash = MessageHasher.generate_hashes(
            message_id=message_id,
            channel_id=channel_id,
            telegram_date=telegram_date,
            content=content,
            sender_id=sender_id,
            forward_from_id=forward_from_id,
            forward_from_name=forward_from_name,
            forward_date=forward_date,
        )

        return stored_hash == computed_hash


def get_message_hasher() -> MessageHasher:
    """Get MessageHasher instance"""
    return MessageHasher()
