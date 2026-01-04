"""
Channel Join Worker - Auto-join discovered channels for social data fetching.

Background service that:
1. Finds discovered channels with join_status='pending'
2. Attempts to join using Telegram's JoinChannelRequest
3. Fetches channel metadata (name, description, participant_count)
4. Updates status to 'joined', 'private', or 'failed'

Configuration (from settings):
- CHANNEL_JOIN_ENABLED: Enable/disable auto-joining
- CHANNEL_JOIN_INTERVAL_SECONDS: Interval between join cycles
- CHANNEL_JOIN_BATCH_SIZE: Max channels per cycle
- CHANNEL_JOIN_MAX_RETRIES: Max retries before permanent failure
- CHANNEL_JOIN_RETRY_DELAY_HOURS: Hours to wait before retrying
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from telethon import TelegramClient
from telethon.errors import (
    ChannelInvalidError,
    ChannelPrivateError,
    ChannelsTooMuchError,
    FloodWaitError,
    InviteHashExpiredError,
    InviteHashInvalidError,
    UserAlreadyParticipantError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
)
from telethon.tl.functions.channels import GetFullChannelRequest, JoinChannelRequest
from telethon.tl.types import Channel, InputPeerChannel

from config.settings import settings
from models.base import AsyncSessionLocal

logger = logging.getLogger(__name__)


class ChannelJoinWorker:
    """
    Background service for auto-joining discovered channels.

    Handles:
    - Processing pending discovered channels
    - Joining via Telegram API
    - Fetching channel metadata after join
    - Rate limiting and error handling
    """

    def __init__(self, client: TelegramClient):
        """
        Initialize channel join worker.

        Args:
            client: Authenticated Telethon client
        """
        self.client = client
        self.running = False
        self._join_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the background join loop."""
        if not settings.CHANNEL_JOIN_ENABLED:
            logger.info("Channel join worker disabled (CHANNEL_JOIN_ENABLED=false)")
            return

        self.running = True
        self._join_task = asyncio.create_task(self._join_loop())
        logger.info(
            f"Channel join worker started (interval={settings.CHANNEL_JOIN_INTERVAL_SECONDS}s, "
            f"batch={settings.CHANNEL_JOIN_BATCH_SIZE})"
        )

    async def stop(self) -> None:
        """Stop the background join loop."""
        self.running = False
        if self._join_task:
            self._join_task.cancel()
            try:
                await self._join_task
            except asyncio.CancelledError:
                pass
        logger.info("Channel join worker stopped")

    async def _join_loop(self) -> None:
        """Main join loop - runs periodically."""
        # Initial delay to let other services start
        await asyncio.sleep(10)

        while self.running:
            try:
                await self._join_cycle()
            except Exception as e:
                logger.error(f"Channel join cycle failed: {e}", exc_info=True)

            # Wait for next cycle
            await asyncio.sleep(settings.CHANNEL_JOIN_INTERVAL_SECONDS)

    async def _join_cycle(self) -> None:
        """
        Single join cycle - process batch of pending channels.

        1. Get pending channels (respecting retry delays)
        2. Attempt to join each
        3. Fetch metadata for successful joins
        """
        channels = await self._get_pending_channels()
        if not channels:
            logger.debug("No pending channels to join")
            return

        logger.info(f"Processing {len(channels)} pending discovered channels")

        joined = 0
        failed = 0
        for channel_data in channels:
            try:
                success = await self._join_channel(channel_data)
                if success:
                    joined += 1
                else:
                    failed += 1
            except FloodWaitError as e:
                logger.warning(f"FloodWait: sleeping {e.seconds}s")
                await asyncio.sleep(e.seconds)
                failed += 1
            except Exception as e:
                logger.error(
                    f"Unexpected error joining channel {channel_data['telegram_id']}: {e}",
                    exc_info=True
                )
                failed += 1

            # Delay between join attempts to avoid rate limits
            await asyncio.sleep(2)

        logger.info(
            f"Channel join cycle complete: {joined} joined, {failed} failed"
        )

    async def _get_pending_channels(self) -> List[Dict[str, Any]]:
        """
        Get discovered channels that need joining.

        Returns channels where:
        - join_status = 'pending' OR
        - join_status = 'failed' AND join_retry_after < NOW() AND retry_count < max
        """
        now = datetime.now(timezone.utc)

        async with AsyncSessionLocal() as session:
            query = text("""
                SELECT
                    id,
                    telegram_id,
                    username,
                    access_hash,
                    name,
                    join_retry_count
                FROM discovered_channels
                WHERE (
                    join_status = 'pending'
                    OR (
                        join_status = 'failed'
                        AND join_retry_after IS NOT NULL
                        AND join_retry_after < :now
                        AND join_retry_count < :max_retries
                    )
                )
                AND admin_action IS NULL  -- Not ignored or promoted
                ORDER BY discovery_count DESC, discovered_at ASC
                LIMIT :batch_size
            """)

            result = await session.execute(query, {
                'now': now,
                'max_retries': settings.CHANNEL_JOIN_MAX_RETRIES,
                'batch_size': settings.CHANNEL_JOIN_BATCH_SIZE,
            })

            return [dict(row._mapping) for row in result]

    async def _join_channel(self, channel_data: Dict[str, Any]) -> bool:
        """
        Attempt to join a discovered channel.

        Args:
            channel_data: Dict with id, telegram_id, username, access_hash

        Returns:
            True if join succeeded, False otherwise
        """
        channel_id = channel_data['telegram_id']
        db_id = channel_data['id']
        username = channel_data.get('username')
        access_hash = channel_data.get('access_hash')

        logger.info(
            f"Attempting to join channel {channel_id} "
            f"(username={username}, retry={channel_data['join_retry_count']})"
        )

        # Mark as joining
        await self._update_status(db_id, 'joining')

        try:
            # Try to get entity and join
            if username:
                # Join by username (more reliable)
                entity = await self.client.get_entity(f"@{username}")
            elif access_hash:
                # Join by ID + access_hash
                entity = InputPeerChannel(channel_id=channel_id, access_hash=access_hash)
            else:
                # Try to resolve by ID alone (may fail for private channels)
                try:
                    entity = await self.client.get_entity(channel_id)
                except ValueError:
                    logger.warning(f"Cannot resolve channel {channel_id} without username or access_hash")
                    await self._mark_private(db_id, "Cannot resolve without username")
                    return False

            # Attempt to join
            await self.client(JoinChannelRequest(entity))

            # Fetch full channel info
            full_channel = await self.client(GetFullChannelRequest(entity))

            # Extract metadata
            metadata = self._extract_channel_metadata(full_channel)

            # Update with success
            await self._mark_joined(db_id, metadata)
            logger.info(f"Successfully joined channel {channel_id}: {metadata.get('name', 'Unknown')}")
            return True

        except UserAlreadyParticipantError:
            # Already a member - fetch metadata and mark as joined
            logger.info(f"Already a participant of channel {channel_id}")
            try:
                if username:
                    entity = await self.client.get_entity(f"@{username}")
                else:
                    entity = await self.client.get_entity(channel_id)
                full_channel = await self.client(GetFullChannelRequest(entity))
                metadata = self._extract_channel_metadata(full_channel)
                await self._mark_joined(db_id, metadata)
            except Exception as e:
                logger.warning(f"Could not fetch metadata for already-joined channel: {e}")
                await self._mark_joined(db_id, {})
            return True

        except (ChannelPrivateError, InviteHashExpiredError, InviteHashInvalidError):
            logger.warning(f"Channel {channel_id} is private or invite-only")
            await self._mark_private(db_id, "Channel is private or invite-only")
            return False

        except (UsernameInvalidError, UsernameNotOccupiedError):
            logger.warning(f"Channel {channel_id} username invalid or not found")
            await self._mark_failed(db_id, "Username invalid or not occupied")
            return False

        except ChannelInvalidError:
            logger.warning(f"Channel {channel_id} is invalid (possibly deleted)")
            await self._mark_failed(db_id, "Channel invalid (possibly deleted)")
            return False

        except ChannelsTooMuchError:
            logger.error("Joined too many channels! Need to leave some channels.")
            await self._update_status(db_id, 'pending')  # Will retry later
            return False

        except Exception as e:
            logger.warning(f"Failed to join channel {channel_id}: {e}")
            await self._mark_failed(db_id, str(e))
            return False

    def _extract_channel_metadata(self, full_channel) -> Dict[str, Any]:
        """
        Extract metadata from FullChannel response.

        Args:
            full_channel: Response from GetFullChannelRequest

        Returns:
            Dict with channel metadata
        """
        metadata = {}

        # Get the channel object
        channel = None
        if hasattr(full_channel, 'chats') and full_channel.chats:
            for chat in full_channel.chats:
                if isinstance(chat, Channel):
                    channel = chat
                    break

        if channel:
            metadata['name'] = channel.title
            metadata['username'] = channel.username
            metadata['access_hash'] = channel.access_hash
            metadata['verified'] = getattr(channel, 'verified', False)
            metadata['scam'] = getattr(channel, 'scam', False)
            metadata['fake'] = getattr(channel, 'fake', False)
            metadata['restricted'] = getattr(channel, 'restricted', False)
            metadata['has_link'] = getattr(channel, 'has_link', False)
            if channel.photo:
                metadata['photo_id'] = getattr(channel.photo, 'photo_id', None)

        # Get full info
        if hasattr(full_channel, 'full_chat'):
            full_info = full_channel.full_chat
            metadata['description'] = getattr(full_info, 'about', None)
            metadata['participant_count'] = getattr(full_info, 'participants_count', None)
            metadata['linked_chat_id'] = getattr(full_info, 'linked_chat_id', None)

        return metadata

    async def _update_status(self, db_id: int, status: str) -> None:
        """Update join_status for a discovered channel."""
        async with AsyncSessionLocal() as session:
            try:
                query = text("""
                    UPDATE discovered_channels
                    SET join_status = :status,
                        join_attempted_at = NOW(),
                        updated_at = NOW()
                    WHERE id = :id
                """)
                await session.execute(query, {'id': db_id, 'status': status})
                await session.commit()
            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to update channel status: {e}")

    async def _mark_joined(self, db_id: int, metadata: Dict[str, Any]) -> None:
        """Mark channel as successfully joined with metadata."""
        async with AsyncSessionLocal() as session:
            try:
                query = text("""
                    UPDATE discovered_channels
                    SET join_status = 'joined',
                        joined_at = NOW(),
                        join_attempted_at = NOW(),
                        join_error = NULL,
                        name = COALESCE(:name, name),
                        username = COALESCE(:username, username),
                        access_hash = COALESCE(:access_hash, access_hash),
                        description = COALESCE(:description, description),
                        participant_count = COALESCE(:participant_count, participant_count),
                        photo_id = COALESCE(:photo_id, photo_id),
                        verified = COALESCE(:verified, verified),
                        scam = COALESCE(:scam, scam),
                        fake = COALESCE(:fake, fake),
                        restricted = COALESCE(:restricted, restricted),
                        has_link = COALESCE(:has_link, has_link),
                        updated_at = NOW()
                    WHERE id = :id
                """)
                await session.execute(query, {
                    'id': db_id,
                    'name': metadata.get('name'),
                    'username': metadata.get('username'),
                    'access_hash': metadata.get('access_hash'),
                    'description': metadata.get('description'),
                    'participant_count': metadata.get('participant_count'),
                    'photo_id': metadata.get('photo_id'),
                    'verified': metadata.get('verified'),
                    'scam': metadata.get('scam'),
                    'fake': metadata.get('fake'),
                    'restricted': metadata.get('restricted'),
                    'has_link': metadata.get('has_link'),
                })
                await session.commit()
            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to mark channel as joined: {e}")

    async def _mark_private(self, db_id: int, reason: str) -> None:
        """Mark channel as private (cannot join)."""
        async with AsyncSessionLocal() as session:
            try:
                query = text("""
                    UPDATE discovered_channels
                    SET join_status = 'private',
                        is_private = true,
                        join_attempted_at = NOW(),
                        join_error = :reason,
                        updated_at = NOW()
                    WHERE id = :id
                """)
                await session.execute(query, {'id': db_id, 'reason': reason})
                await session.commit()
            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to mark channel as private: {e}")

    async def _mark_failed(self, db_id: int, reason: str) -> None:
        """Mark channel join as failed with retry scheduling."""
        retry_after = datetime.now(timezone.utc) + timedelta(
            hours=settings.CHANNEL_JOIN_RETRY_DELAY_HOURS
        )

        async with AsyncSessionLocal() as session:
            try:
                query = text("""
                    UPDATE discovered_channels
                    SET join_status = 'failed',
                        join_attempted_at = NOW(),
                        join_error = :reason,
                        join_retry_count = join_retry_count + 1,
                        join_retry_after = :retry_after,
                        updated_at = NOW()
                    WHERE id = :id
                """)
                await session.execute(query, {
                    'id': db_id,
                    'reason': reason,
                    'retry_after': retry_after,
                })
                await session.commit()
            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to mark channel as failed: {e}")


# Module-level instance for easy import
channel_join_worker: Optional[ChannelJoinWorker] = None


async def start_channel_join_worker(client: TelegramClient) -> ChannelJoinWorker:
    """
    Create and start the channel join worker.

    Args:
        client: Authenticated Telethon client

    Returns:
        Running ChannelJoinWorker instance
    """
    global channel_join_worker
    channel_join_worker = ChannelJoinWorker(client)
    await channel_join_worker.start()
    return channel_join_worker


async def stop_channel_join_worker() -> None:
    """Stop the channel join worker if running."""
    global channel_join_worker
    if channel_join_worker:
        await channel_join_worker.stop()
        channel_join_worker = None
