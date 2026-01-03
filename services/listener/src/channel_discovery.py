"""
Channel Discovery Service - Folder-Based Management (tg-archiver)

Simplified channel discovery for tg-archiver standalone deployment.
Discovers channels from a SINGLE Telegram folder configured via .env.

Architecture:
1. User creates a folder in Telegram app (e.g., "tg-archiver")
2. User drags channels into the folder
3. ChannelDiscovery reads folder structure via Telethon API
4. Matches ONLY the folder name from FOLDER_ARCHIVE_ALL_PATTERN
5. All discovered channels get "archive_all" rule
6. Background task syncs every 5 minutes

Configuration (.env):
    FOLDER_ARCHIVE_ALL_PATTERN=tg-archiver

Note: This version uses EXACT folder name matching instead of regex patterns.
Only one folder is monitored.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.errors.common import TypeNotFoundError
from telethon.tl.functions.messages import GetDialogFiltersRequest
from telethon.tl.types import Channel as TelegramChannel
from telethon.tl.types import DialogFilter
from telethon.utils import get_peer_id
from telethon.tl.types import PeerChannel

from .backfill_service import BackfillService
from config.settings import settings
from models.base import AsyncSessionLocal
from models.channel import Channel
from audit.audit_logger import AuditLogger

logger = logging.getLogger(__name__)

# Audit logger for platform events
audit = AuditLogger("listener")


class ChannelDiscovery:
    """
    Discovers channels from Telegram folders and syncs with database.

    Uses Telethon GetDialogFiltersRequest to read user's folder structure.
    Simplified for tg-archiver: only monitors ONE folder (FOLDER_ARCHIVE_ALL_PATTERN).
    """

    # tg-archiver: No hardcoded patterns - folder name comes from settings

    def __init__(
        self, client: TelegramClient, backfill_service: Optional[BackfillService] = None
    ):
        """
        Initialize ChannelDiscovery.

        Args:
            client: Authenticated Telethon client
            backfill_service: Optional BackfillService for historical message fetching
        """
        self.client = client
        self.backfill_service = backfill_service
        self._discovery_count = 0

    async def discover_channels(self) -> list[Channel]:
        """
        Discover all channels from Telegram folders.

        Returns:
            List of discovered Channel models (not yet saved to DB)

        Raises:
            FloodWaitError: If Telegram rate-limits us
        """
        logger.info("Starting channel discovery from Telegram folders...")

        try:
            # Get all dialog filters (folders) from Telegram
            # NOTE: Telegram API changes frequently. If this fails with TypeNotFoundError,
            # Telethon's schema may be outdated. Upgrade: pip install -U telethon
            result = await self.client(GetDialogFiltersRequest())
            filters: list[DialogFilter] = result.filters
        except TypeNotFoundError as e:
            logger.warning(
                f"Telegram API schema mismatch (Constructor ID error). "
                f"This usually means Telegram updated their API but Telethon hasn't caught up yet. "
                f"Folder discovery temporarily disabled. Update Telethon to fix: pip install -U telethon"
            )
            logger.debug(f"Full error: {e}")
            return []  # Return empty list, will use existing database channels

        logger.info(f"Found {len(filters)} Telegram folders")

        discovered_channels = []

        try:
            for folder in filters:
                # Skip default "All Chats" folder (DialogFilterDefault has no title)
                if not hasattr(folder, "title"):
                    logger.debug("Skipping default folder (All Chats)")
                    continue

                # Check if folder name matches any rule pattern
                # Extract text from TextWithEntities object for regex matching
                rule = self._get_rule_for_folder(folder.title.text)

                if not rule:
                    logger.info(
                        f"Skipping folder '{folder.title}' - no matching rule pattern"
                    )
                    continue

                logger.info(
                    f"Processing folder '{folder.title}' with rule '{rule}' "
                    f"({len(folder.include_peers)} channels)"
                )

                # Process each channel in the folder
                for peer in folder.include_peers:
                    try:
                        # Get full channel entity with metadata
                        entity = await self.client.get_entity(peer)

                        # Only process channels (not users or chats)
                        if not isinstance(entity, TelegramChannel):
                            logger.debug(
                                f"Skipping non-channel entity: {getattr(entity, 'title', 'Unknown')}"
                            )
                            continue

                        channel = await self._entity_to_channel(
                            entity, folder.title.text, rule
                        )
                        discovered_channels.append(channel)

                        logger.info(
                            f"Discovered: {channel.name} (@{channel.username or 'private'}) "
                            f"in folder '{folder.title}' → rule '{rule}'"
                        )

                    except Exception as e:
                        logger.error(f"Error processing channel in folder: {e}")
                        continue

            self._discovery_count += 1

            # Deduplicate channels (same channel may appear in multiple folders)
            # Keep last occurrence (last folder wins for folder/rule assignment)
            seen = {}
            for channel in discovered_channels:
                seen[channel.telegram_id] = channel

            deduplicated = list(seen.values())

            if len(deduplicated) < len(discovered_channels):
                logger.info(
                    f"Deduplicated {len(discovered_channels)} → {len(deduplicated)} channels "
                    f"(removed {len(discovered_channels) - len(deduplicated)} duplicates)"
                )

            logger.info(
                f"Discovery #{self._discovery_count} complete: "
                f"{len(deduplicated)} unique channels from {len(filters)} folders"
            )

            return deduplicated

        except FloodWaitError as e:
            logger.warning(f"Flood wait error - sleeping for {e.seconds} seconds")
            raise
        except Exception as e:
            logger.exception(f"Error discovering channels: {e}")
            raise

    async def sync_to_database(
        self, discovered_channels: list[Channel], session: AsyncSession
    ) -> dict[str, int]:
        """
        Sync discovered channels to PostgreSQL database.

        Logic:
        1. Mark all existing channels as inactive
        2. For each discovered channel:
           - If exists: update metadata and mark active
           - If new: insert with active=True
        3. Channels not in discovered list remain inactive (user removed from folder)

        Args:
            discovered_channels: List of Channel models from discovery
            session: Database session

        Returns:
            Dictionary with counts: {added, updated, removed, total_active}
        """
        logger.info(f"Syncing {len(discovered_channels)} channels to database...")

        stats = {"added": 0, "updated": 0, "removed": 0, "total_active": 0}

        try:
            # Step 1: Mark all channels as inactive (will be re-activated if still in folders)
            result = await session.execute(select(Channel).where(Channel.active == True))
            existing_active = result.scalars().all()

            for channel in existing_active:
                channel.active = False

            logger.debug(f"Marked {len(existing_active)} channels as inactive")

            # Step 2: Process discovered channels
            for discovered in discovered_channels:
                # Check if channel already exists by telegram_id
                result = await session.execute(
                    select(Channel).where(Channel.telegram_id == discovered.telegram_id)
                )
                existing = result.scalar_one_or_none()

                if existing:
                    # Update existing channel
                    existing.username = discovered.username
                    existing.name = discovered.name
                    existing.description = discovered.description
                    existing.verified = discovered.verified
                    existing.scam = discovered.scam
                    existing.fake = discovered.fake
                    existing.restricted = discovered.restricted
                    existing.folder = discovered.folder
                    existing.rule = discovered.rule
                    existing.active = True
                    existing.removed_at = None  # Clear removal timestamp
                    existing.updated_at = datetime.utcnow()

                    stats["updated"] += 1
                    logger.debug(
                        f"Updated channel: {existing.name} (@{existing.username or 'private'})"
                    )
                else:
                    # Add new channel
                    session.add(discovered)
                    stats["added"] += 1
                    logger.info(
                        f"Added new channel: {discovered.name} (@{discovered.username or 'private'})"
                    )

                    # Log to audit trail
                    await audit.log_channel_discovered(
                        session=session,
                        channel_id=discovered.telegram_id,
                        channel_name=discovered.name,
                        username=discovered.username,
                        folder=discovered.folder,
                        rule=discovered.rule,
                        verified=discovered.verified,
                    )

                    # Trigger backfill if enabled and mode is on_discovery
                    await self._trigger_backfill_if_enabled(discovered)

            # Commit all changes
            await session.commit()

            # Step 3: Count removed channels (active=False, no removal timestamp yet)
            result = await session.execute(
                select(Channel).where(
                    Channel.active == False, Channel.removed_at == None
                )
            )
            newly_removed = result.scalars().all()

            # Set removal timestamp for newly inactive channels
            for channel in newly_removed:
                channel.removed_at = datetime.utcnow()
                stats["removed"] += 1
                logger.info(
                    f"Channel removed from folders: {channel.name} "
                    f"(@{channel.username or 'private'})"
                )

                # Log to audit trail
                await audit.log_channel_removed(
                    session=session,
                    channel_id=channel.id,
                    channel_name=channel.name,
                    username=channel.username,
                    folder=channel.folder or "unknown",
                )

            await session.commit()

            # Count total active channels
            result = await session.execute(select(Channel).where(Channel.active == True))
            stats["total_active"] = len(result.scalars().all())

            logger.info(
                f"Database sync complete: "
                f"{stats['added']} added, "
                f"{stats['updated']} updated, "
                f"{stats['removed']} removed, "
                f"{stats['total_active']} total active"
            )

            # Log sync stats to audit (only if there were changes)
            if stats["added"] > 0 or stats["removed"] > 0:
                await audit.log_sync_stats(
                    session=session,
                    added=stats["added"],
                    updated=stats["updated"],
                    removed=stats["removed"],
                    total_active=stats["total_active"],
                )

            return stats

        except Exception as e:
            logger.exception(f"Error syncing to database: {e}")
            await session.rollback()
            raise

    async def _entity_to_channel(
        self, entity: TelegramChannel, folder_name: str, rule: str
    ) -> Channel:
        """
        Convert Telethon Channel entity to our Channel model.

        Args:
            entity: Telethon Channel entity
            folder_name: Name of Telegram folder
            rule: Processing rule for this channel

        Returns:
            Channel model instance (not yet saved to DB)
        """
        # Use get_peer_id to get the marked ID (-100 prefix for channels)
        # This ensures consistent ID format for API calls
        marked_id = get_peer_id(PeerChannel(entity.id))

        return Channel(
            telegram_id=marked_id,
            access_hash=entity.access_hash,
            username=entity.username if hasattr(entity, "username") else None,
            name=entity.title,
            description=entity.about if hasattr(entity, "about") else None,
            type="channel" if entity.broadcast else "megagroup",
            verified=getattr(entity, "verified", False),
            scam=getattr(entity, "scam", False),
            fake=getattr(entity, "fake", False),
            restricted=getattr(entity, "restricted", False),
            folder=folder_name,
            rule=rule,
            active=True,
            removed_at=None,
        )

    def _get_rule_for_folder(self, folder_name: str) -> Optional[str]:
        """
        Check if folder name matches the configured folder (exact match).

        tg-archiver uses EXACT folder name matching from FOLDER_ARCHIVE_ALL_PATTERN.
        Only one folder is monitored, and all channels get "archive_all" rule.

        Args:
            folder_name: Name of Telegram folder

        Returns:
            "archive_all" if folder matches, None otherwise

        Examples:
            Configured: FOLDER_ARCHIVE_ALL_PATTERN=tg-archiver
            "tg-archiver" → "archive_all"
            "Archive-UA" → None (no match)
            "Discover-RU" → None (no match)
        """
        # Exact match against configured folder name (case-insensitive)
        if folder_name.lower() == settings.FOLDER_ARCHIVE_ALL_PATTERN.lower():
            return "archive_all"

        return None

    async def _trigger_backfill_if_enabled(self, channel: Channel) -> None:
        """
        Trigger historical backfill for newly added channel if enabled.

        Only triggers if:
        - BACKFILL_ENABLED=true
        - BACKFILL_MODE=on_discovery
        - BackfillService is available

        Args:
            channel: Newly added Channel model instance
        """
        # Check if backfill is enabled and configured for on_discovery
        if not settings.BACKFILL_ENABLED:
            logger.debug(f"Backfill disabled - skipping for channel {channel.name}")
            return

        if settings.BACKFILL_MODE != "on_discovery":
            logger.debug(
                f"Backfill mode is '{settings.BACKFILL_MODE}' (not on_discovery) "
                f"- skipping for channel {channel.name}"
            )
            return

        if not self.backfill_service:
            logger.warning(
                f"BackfillService not available - cannot backfill channel {channel.name}"
            )
            return

        # Trigger backfill in background (don't await - let it run async)
        logger.info(
            f"Triggering historical backfill for newly added channel: {channel.name} "
            f"(telegram_id={channel.telegram_id})"
        )

        try:
            # Set backfill status to pending
            channel.backfill_status = "pending"

            # Start backfill asynchronously (don't block the sync)
            # The backfill service will update the channel status as it progresses
            asyncio.create_task(
                self._run_backfill_with_error_handling(channel),
                name=f"backfill-{channel.telegram_id}",
            )

            logger.info(
                f"Backfill task created for channel {channel.name} "
                f"(will fetch from {settings.BACKFILL_START_DATE})"
            )

        except Exception as e:
            logger.error(
                f"Error creating backfill task for channel {channel.name}: {e}"
            )

    async def _run_backfill_with_error_handling(self, channel: Channel) -> None:
        """
        Run backfill with error handling (called as async task).

        Args:
            channel: Channel to backfill
        """
        try:
            # Create new database session for the background task
            async with AsyncSessionLocal() as session:
                # Re-fetch channel from DB to avoid detached instance issues
                result = await session.execute(
                    select(Channel).where(Channel.telegram_id == channel.telegram_id)
                )
                db_channel = result.scalar_one_or_none()

                if not db_channel:
                    logger.error(
                        f"Channel {channel.telegram_id} not found in database - cannot backfill"
                    )
                    return

                # Run backfill
                stats = await self.backfill_service.backfill_channel(
                    db_channel, from_date=None, session=session  # Use configured start date
                )

                logger.info(
                    f"Backfill completed for channel {db_channel.name}: "
                    f"{stats.get('messages_fetched', 0)} messages fetched"
                )

        except FloodWaitError as e:
            logger.warning(
                f"FloodWait error during backfill for channel {channel.name}: "
                f"will retry in {e.seconds} seconds"
            )
            # Channel status is already set to 'paused' by backfill_service
        except Exception as e:
            logger.exception(
                f"Error during backfill for channel {channel.name}: {e}"
            )
            # Channel status is already set to 'failed' by backfill_service

    async def check_pending_backfills(self, session: AsyncSession) -> None:
        """
        Check for channels with backfill_status="pending" and trigger backfill.

        This enables manual backfill via API endpoint:
        1. API sets channel.backfill_status = "pending"
        2. This method picks up pending requests
        3. Triggers backfill in background

        Args:
            session: Database session
        """
        if not self.backfill_service:
            return  # Backfill service not available

        # Find channels with pending backfill
        result = await session.execute(
            select(Channel).where(Channel.backfill_status == "pending")
        )
        pending_channels = result.scalars().all()

        if not pending_channels:
            return  # No pending backfills

        logger.info(f"Found {len(pending_channels)} channels with pending backfill")

        for channel in pending_channels:
            logger.info(
                f"Triggering backfill for channel {channel.name} (id={channel.id})"
            )

            # Trigger backfill asynchronously
            asyncio.create_task(
                self._run_backfill_with_error_handling(channel),
                name=f"backfill-manual-{channel.telegram_id}",
            )

    async def detect_message_gaps(self, session: AsyncSession) -> list[tuple[Channel, timedelta]]:
        """
        Detect channels with message gaps (silence longer than threshold).

        This enables automatic resilience - if the listener was down for hours,
        we detect which channels have gaps and queue them for backfill.

        Args:
            session: Database session

        Returns:
            List of (Channel, gap_duration) tuples sorted by gap size (largest first)
        """
        if not settings.GAP_DETECTION_ENABLED:
            return []

        threshold_hours = settings.GAP_THRESHOLD_HOURS
        now = datetime.now(timezone.utc)
        threshold_time = now - timedelta(hours=threshold_hours)

        # Find active channels with last_message_at older than threshold
        # These channels have been silent longer than expected
        result = await session.execute(
            select(Channel).where(
                and_(
                    Channel.active == True,
                    Channel.last_message_at != None,
                    Channel.last_message_at < threshold_time,
                    # Skip channels already being backfilled
                    Channel.backfill_status.notin_(["pending", "in_progress"]),
                    # Only archive_all and selective_archive channels (not discovery)
                    Channel.rule.in_(["archive_all", "selective_archive"]),
                )
            )
        )
        channels_with_gaps = result.scalars().all()

        if not channels_with_gaps:
            return []

        # Calculate gap duration for each channel
        gaps = []
        for channel in channels_with_gaps:
            # Ensure last_message_at is timezone-aware
            last_msg = channel.last_message_at
            if last_msg.tzinfo is None:
                last_msg = last_msg.replace(tzinfo=timezone.utc)

            gap_duration = now - last_msg
            gaps.append((channel, gap_duration))

        # Sort by gap size (largest first - prioritize longest gaps)
        gaps.sort(key=lambda x: x[1], reverse=True)

        if gaps:
            logger.info(
                f"Gap detection found {len(gaps)} channels with gaps > {threshold_hours}h: "
                f"{', '.join(f'{ch.name}({gap.total_seconds()/3600:.1f}h)' for ch, gap in gaps[:5])}"
                f"{'...' if len(gaps) > 5 else ''}"
            )

        return gaps

    async def fill_detected_gaps(self, session: AsyncSession) -> dict[str, int]:
        """
        Detect and fill message gaps for resilience.

        Called on startup and periodically to ensure no messages are missed
        during platform downtime.

        Args:
            session: Database session

        Returns:
            Dict with stats: {gaps_detected, backfills_triggered, skipped}
        """
        stats = {"gaps_detected": 0, "backfills_triggered": 0, "skipped": 0}

        if not self.backfill_service:
            logger.debug("BackfillService not available - skipping gap detection")
            return stats

        if not settings.GAP_DETECTION_ENABLED:
            logger.debug("Gap detection disabled")
            return stats

        # Detect gaps
        gaps = await self.detect_message_gaps(session)
        stats["gaps_detected"] = len(gaps)

        if not gaps:
            return stats

        # Limit channels per check to be rate-limit friendly
        max_channels = settings.GAP_MAX_CHANNELS_PER_CHECK
        channels_to_backfill = gaps[:max_channels]

        if len(gaps) > max_channels:
            logger.info(
                f"Gap detection: processing {max_channels} of {len(gaps)} gaps this cycle "
                f"(remaining will be processed in next cycle)"
            )
            stats["skipped"] = len(gaps) - max_channels

        for channel, gap_duration in channels_to_backfill:
            try:
                # Calculate backfill start time (from last message + small buffer)
                last_msg = channel.last_message_at
                if last_msg.tzinfo is None:
                    last_msg = last_msg.replace(tzinfo=timezone.utc)

                # Start 5 minutes before last known message to ensure overlap
                backfill_from = last_msg - timedelta(minutes=5)

                logger.info(
                    f"Gap detected for {channel.name}: {gap_duration.total_seconds()/3600:.1f}h gap, "
                    f"backfilling from {backfill_from.isoformat()}"
                )

                # Mark as pending and trigger backfill
                channel.backfill_status = "pending"
                await session.commit()

                # Trigger backfill asynchronously with the calculated start time
                asyncio.create_task(
                    self._run_gap_backfill(channel, backfill_from),
                    name=f"gap-backfill-{channel.telegram_id}",
                )

                stats["backfills_triggered"] += 1

            except Exception as e:
                logger.error(f"Error triggering gap backfill for {channel.name}: {e}")

        logger.info(
            f"Gap detection complete: {stats['gaps_detected']} detected, "
            f"{stats['backfills_triggered']} backfills triggered, "
            f"{stats['skipped']} deferred to next cycle"
        )

        return stats

    async def _run_gap_backfill(self, channel: Channel, from_date: datetime) -> None:
        """
        Run gap-based backfill with specific start time.

        Unlike discovery backfill which uses BACKFILL_START_DATE,
        gap backfill starts from the last known message time.

        Args:
            channel: Channel to backfill
            from_date: Start time for backfill (usually last_message_at - 5min)
        """
        try:
            async with AsyncSessionLocal() as session:
                # Re-fetch channel to avoid detached instance
                result = await session.execute(
                    select(Channel).where(Channel.telegram_id == channel.telegram_id)
                )
                db_channel = result.scalar_one_or_none()

                if not db_channel:
                    logger.error(f"Channel {channel.telegram_id} not found - cannot gap-backfill")
                    return

                # Run backfill with specific from_date (not config's BACKFILL_START_DATE)
                stats = await self.backfill_service.backfill_channel(
                    db_channel,
                    from_date=from_date,
                    session=session,
                )

                logger.info(
                    f"Gap backfill completed for {db_channel.name}: "
                    f"{stats.get('messages_fetched', 0)} messages fetched"
                )

        except FloodWaitError as e:
            logger.warning(
                f"FloodWait during gap backfill for {channel.name}: {e.seconds}s wait"
            )
        except Exception as e:
            logger.exception(f"Error during gap backfill for {channel.name}: {e}")

    async def start_background_sync(self, interval_seconds: int = 300):
        """
        Start background task that syncs folders every N seconds.

        Also checks for pending manual backfill requests and detects message gaps.

        Args:
            interval_seconds: Sync interval (default: 300 = 5 minutes)
        """
        logger.info(
            f"Starting background folder sync (every {interval_seconds} seconds)..."
        )

        # Track last gap check time (gap detection runs less frequently)
        gap_check_interval = settings.GAP_CHECK_INTERVAL_SECONDS
        last_gap_check = datetime.now(timezone.utc) - timedelta(seconds=gap_check_interval)

        while True:
            try:
                # Discover channels from folders
                channels = await self.discover_channels()

                # Sync to database
                async with AsyncSessionLocal() as session:
                    stats = await self.sync_to_database(channels, session)

                    # Check for manual backfill requests (API-triggered)
                    await self.check_pending_backfills(session)

                    # Periodic gap detection (runs every GAP_CHECK_INTERVAL_SECONDS)
                    now = datetime.now(timezone.utc)
                    if (now - last_gap_check).total_seconds() >= gap_check_interval:
                        gap_stats = await self.fill_detected_gaps(session)
                        if gap_stats["gaps_detected"] > 0:
                            logger.info(
                                f"Gap detection: {gap_stats['gaps_detected']} gaps found, "
                                f"{gap_stats['backfills_triggered']} backfills triggered"
                            )
                        last_gap_check = now

                logger.info(
                    f"Background sync complete: {stats['total_active']} active channels"
                )

            except FloodWaitError as e:
                logger.warning(f"Flood wait - will retry in {e.seconds} seconds")
                await asyncio.sleep(e.seconds)
                continue
            except Exception as e:
                logger.exception(f"Error in background sync: {e}")

            # Wait for next sync
            await asyncio.sleep(interval_seconds)
