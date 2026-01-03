"""
Message Router - Folder-Based Processing Rules

Routes messages based on channel's folder rule (discovered from Telegram folders).
Implements the folder-based architecture for channel management:

Folder Rules:
1. archive_all: Archive everything from this channel
   - Translate → Extract entities → Archive
   - Default rule for all monitored channels

2. test: Test environment
   - Process but mark as test data

3. staging: Staging environment
   - Process but mark as staging data

Processing Pipeline:
┌─────────────┐
│ Raw Message │
└─────┬───────┘
      │
      ▼
┌─────────────┐
│  Translate  │ (optional, if enabled)
└─────┬───────┘
      │
      ▼
┌─────────────┐
│   Archive   │
└─────────────┘
"""

import logging
from enum import Enum
from typing import Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.channel import Channel

logger = logging.getLogger(__name__)


class ProcessingRule(str, Enum):
    """Processing rules for channels based on Telegram folder."""

    ARCHIVE_ALL = "archive_all"  # Archive everything from this channel
    TEST = "test"  # Test environment
    STAGING = "staging"  # Staging environment


class RoutingDecision:
    """
    Decision made by message router.

    Contains information about how to process this message.
    """

    def __init__(
        self,
        rule: ProcessingRule,
        should_archive: bool,
        should_translate: bool,
        should_extract_entities: bool,
    ) -> None:
        """
        Initialize routing decision.

        Args:
            rule: Processing rule for this message
            should_archive: Whether to archive this message
            should_translate: Whether to translate content
            should_extract_entities: Whether to extract entities
        """
        self.rule = rule
        self.should_archive = should_archive
        self.should_translate = should_translate
        self.should_extract_entities = should_extract_entities

    def __repr__(self) -> str:
        return (
            f"RoutingDecision(rule={self.rule}, "
            f"archive={self.should_archive}, "
            f"translate={self.should_translate}, "
            f"entities={self.should_extract_entities})"
        )


class MessageRouter:
    """
    Routes messages based on channel's folder rule.

    Reads channel configuration from database and determines processing path.
    """

    def __init__(self) -> None:
        """Initialize message router."""
        self._channel_cache: dict[int, Channel] = {}
        self._cache_hits = 0
        self._cache_misses = 0

    async def get_routing_decision(
        self,
        channel_id: int,
        session: AsyncSession,
        translation_enabled: bool = True,
    ) -> RoutingDecision:
        """
        Get routing decision for a message from this channel.

        Args:
            channel_id: Channel ID from database
            session: Database session
            translation_enabled: Whether translation is enabled globally

        Returns:
            RoutingDecision with processing instructions

        Raises:
            ValueError: If channel not found or has invalid rule
        """
        # Get channel from cache or database
        channel = await self._get_channel(channel_id, session)

        if not channel:
            raise ValueError(f"Channel {channel_id} not found in database")

        if not channel.active:
            logger.warning(
                f"Channel {channel_id} ({channel.name}) is inactive - skipping"
            )
            # Return decision to skip this message
            return RoutingDecision(
                rule=ProcessingRule.ARCHIVE_ALL,
                should_archive=False,
                should_translate=False,
                should_extract_entities=False,
            )

        # Parse rule from channel
        try:
            rule = ProcessingRule(channel.rule) if channel.rule else ProcessingRule.ARCHIVE_ALL
        except ValueError:
            logger.error(
                f"Invalid rule '{channel.rule}' for channel {channel_id} ({channel.name}) "
                f"- defaulting to archive_all"
            )
            rule = ProcessingRule.ARCHIVE_ALL

        # All rules archive everything - test/staging just mark the data differently
        return RoutingDecision(
            rule=rule,
            should_archive=True,
            should_translate=translation_enabled,
            should_extract_entities=True,
        )

    async def _get_channel(
        self, channel_id: int, session: AsyncSession
    ) -> Optional[Channel]:
        """
        Get channel from cache or database.

        Args:
            channel_id: Channel ID
            session: Database session

        Returns:
            Channel model or None if not found
        """
        # Query database by telegram_id
        # Note: We don't cache ORM objects to avoid DetachedInstanceError
        # SQLAlchemy's session identity map provides sufficient caching within a request
        result = await session.execute(select(Channel).where(Channel.telegram_id == channel_id))
        channel = result.scalar_one_or_none()

        if channel:
            self._cache_hits += 1
        else:
            self._cache_misses += 1

        return channel

    def invalidate_cache(self, channel_id: Optional[int] = None) -> None:
        """
        Invalidate channel cache.

        Args:
            channel_id: Specific channel to invalidate, or None to clear all
        """
        if channel_id:
            self._channel_cache.pop(channel_id, None)
            logger.debug(f"Invalidated cache for channel {channel_id}")
        else:
            self._channel_cache.clear()
            logger.info("Cleared entire channel cache")

    def get_cache_stats(self) -> Dict[str, float]:
        """
        Get cache statistics.

        Returns:
            Dictionary with cache stats
        """
        total_requests = self._cache_hits + self._cache_misses
        hit_rate = self._cache_hits / total_requests if total_requests > 0 else 0.0

        return {
            "cache_size": len(self._channel_cache),
            "cache_hits": self._cache_hits,
            "cache_misses": self._cache_misses,
            "hit_rate": hit_rate,
        }


# Global message router instance
message_router = MessageRouter()
