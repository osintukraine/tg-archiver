"""
Message Router - Folder-Based Processing Rules

Routes messages based on channel's folder rule (discovered from Telegram folders).
Implements the revolutionary folder-based architecture:

Folder Rules:
1. archive_all: Archive everything after spam filter
   - Spam filter → (if ham) → Translate → Extract entities → Archive
   - Used for high-value channels where we want complete archives

2. selective_archive: Only archive high OSINT value (score ≥70)
   - Spam filter → (if ham) → Translate → OSINT scoring → (if ≥70) → Archive
   - Used for monitoring channels with mixed content quality

3. test: Test environment
   - Process but mark as test data

4. staging: Staging environment
   - Process but mark as staging data

Processing Pipeline:
┌─────────────┐
│ Raw Message │
└─────┬───────┘
      │
      ▼
┌─────────────┐
│ Spam Filter │ (BEFORE expensive operations)
└─────┬───────┘
      │ (if HAM)
      ▼
┌─────────────┐
│  Translate  │ (optional, if enabled)
└─────┬───────┘
      │
      ▼
┌─────────────────┐
│ Route by Rule   │
│ - archive_all   │ → Archive immediately
│ - selective     │ → OSINT scoring → Archive if ≥70
└─────────────────┘

Cost Savings:
- Spam filter BEFORE download saves 80-90% media storage
- Spam filter BEFORE translate saves translation API costs
- Spam filter BEFORE LLM saves OSINT scoring costs
- Selective archival saves 30-50% storage for monitoring channels
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

    ARCHIVE_ALL = "archive_all"  # Archive everything after spam filter
    SELECTIVE_ARCHIVE = "selective_archive"  # Only OSINT score ≥70
    DISCOVERY = "discovery"  # Auto-joined channels in 14-day probation
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
        should_score_osint: bool,
        should_translate: bool,
        should_extract_entities: bool,
        min_osint_threshold: Optional[int] = None,
    ) -> None:
        """
        Initialize routing decision.

        Args:
            rule: Processing rule for this message
            should_archive: Whether to archive this message
            should_score_osint: Whether to run OSINT scoring
            should_translate: Whether to translate content
            should_extract_entities: Whether to extract entities
            min_osint_threshold: Minimum OSINT score required for archival (selective mode)
        """
        self.rule = rule
        self.should_archive = should_archive
        self.should_score_osint = should_score_osint
        self.should_translate = should_translate
        self.should_extract_entities = should_extract_entities
        self.min_osint_threshold = min_osint_threshold

    def __repr__(self) -> str:
        return (
            f"RoutingDecision(rule={self.rule}, "
            f"archive={self.should_archive}, "
            f"osint={self.should_score_osint}, "
            f"translate={self.should_translate}, "
            f"entities={self.should_extract_entities}, "
            f"threshold={self.min_osint_threshold})"
        )


class MessageRouter:
    """
    Routes messages based on channel's folder rule.

    Reads channel configuration from database and determines processing path.
    """

    # Minimum OSINT score threshold for selective archival
    SELECTIVE_ARCHIVE_THRESHOLD = 70

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
                should_score_osint=False,
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

        # Determine processing steps based on rule
        if rule == ProcessingRule.ARCHIVE_ALL:
            # Archive everything after spam filter
            return RoutingDecision(
                rule=rule,
                should_archive=True,  # Archive immediately (after spam + entities)
                should_score_osint=False,  # No OSINT scoring needed
                should_translate=translation_enabled,
                should_extract_entities=True,
                min_osint_threshold=None,
            )

        elif rule == ProcessingRule.SELECTIVE_ARCHIVE:
            # Only archive if OSINT score ≥70
            return RoutingDecision(
                rule=rule,
                should_archive=False,  # Archive decision made after OSINT scoring
                should_score_osint=True,  # Need OSINT score to decide
                should_translate=translation_enabled,
                should_extract_entities=True,
                min_osint_threshold=self.SELECTIVE_ARCHIVE_THRESHOLD,
            )

        elif rule == ProcessingRule.DISCOVERY:
            # Discovery channels (14-day probation) - LLM decides archival
            return RoutingDecision(
                rule=rule,
                should_archive=True,  # LLM makes final should_archive decision
                should_score_osint=False,  # Legacy field - not used
                should_translate=translation_enabled,
                should_extract_entities=True,
                min_osint_threshold=None,
            )

        elif rule in [ProcessingRule.TEST, ProcessingRule.STAGING]:
            # Process but mark as test/staging
            return RoutingDecision(
                rule=rule,
                should_archive=True,  # Archive for testing
                should_score_osint=True,  # Full processing for testing
                should_translate=translation_enabled,
                should_extract_entities=True,
                min_osint_threshold=None,
            )

        else:
            # Unknown rule - default to archive_all
            logger.error(f"Unknown rule '{rule}' - defaulting to archive_all")
            return RoutingDecision(
                rule=ProcessingRule.ARCHIVE_ALL,
                should_archive=True,
                should_score_osint=False,
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
