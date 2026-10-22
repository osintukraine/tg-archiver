"""
Channel Join Worker - Auto-join discovered channels for social data fetching.

Background service that:
1. Finds discovered channels with join_status='pending'
2. Attempts to join using Telegram's JoinChannelRequest
3. Fetches channel metadata (name, description, participant_count)
4. Updates status to 'joined', 'private', or 'failed'

Configuration (from settings):
- CHANNEL_JOIN_MODE: approval (default, admin-approved rows only) | auto | off
- CHANNEL_JOIN_ENABLED: Deprecated; false is treated as mode "off"
- CHANNEL_JOIN_DAILY_CAP: Max successful joins per rolling 24 hours
- CHANNEL_JOIN_LIMIT_PAUSE_HOURS: Pause after Telegram's "too many channels" error
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

STUCK_JOINING_MINUTES = 15
MAX_FLOOD_WAIT_SECONDS = 3600


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
        self._paused_until: Optional[datetime] = None  # in-memory; resets on restart

    async def start(self) -> None:
        """Start the background join loop."""
        mode = settings.effective_channel_join_mode
        if not settings.CHANNEL_JOIN_ENABLED:
            logger.warning(
                "CHANNEL_JOIN_ENABLED is deprecated; use CHANNEL_JOIN_MODE=off "
                "(CHANNEL_JOIN_ENABLED=false is treated as off)"
            )
        if mode == "off":
            logger.info("Channel join worker disabled (CHANNEL_JOIN_MODE=off)")
            return

        self.running = True
        self._join_task = asyncio.create_task(self._join_loop())
        logger.info(
            f"Channel join worker started (mode={mode}, "
            f"interval={settings.CHANNEL_JOIN_INTERVAL_SECONDS}s, "
            f"batch={settings.CHANNEL_JOIN_BATCH_SIZE}, "
            f"daily_cap={settings.CHANNEL_JOIN_DAILY_CAP})"
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
        Single join cycle - process batch of eligible channels.

        1. Recover stuck 'joining' rows
        2. Respect the "too many channels" pause and the daily cap
        3. Attempt to join each eligible channel
        """
        await self._reset_stuck_joining()

        if self._is_paused():
            logger.debug("Channel joining paused (channel limit reached)")
            return

        remaining = settings.CHANNEL_JOIN_DAILY_CAP - await self._count_recent_joins()
        if remaining <= 0:
            logger.info(
                f"Daily join cap reached ({settings.CHANNEL_JOIN_DAILY_CAP} per 24h), skipping cycle"
            )
            return

        channels = await self._get_pending_channels(limit=remaining)
        if not channels:
            logger.debug("No eligible channels to join")
            return

        logger.info(f"Processing {len(channels)} discovered channels to join")

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
                # Row was already returned to 'pending' by _join_channel
                wait = min(e.seconds, MAX_FLOOD_WAIT_SECONDS)
                logger.warning(f"FloodWait: sleeping {wait}s (requested {e.seconds}s), ending cycle")
                await asyncio.sleep(wait)
                break
            except Exception as e:
                logger.error(
                    f"Unexpected error joining channel {channel_data['telegram_id']}: {e}",
                    exc_info=True
                )
                failed += 1

            if self._is_paused():
                break

            # Delay between join attempts to avoid rate limits
            await asyncio.sleep(2)

        logger.info(
            f"Channel join cycle complete: {joined} joined, {failed} failed"
        )

    def _is_paused(self) -> bool:
        """True while joining is paused after ChannelsTooMuchError."""
        return self._paused_until is not None and datetime.now(timezone.utc) < self._paused_until

    def _pause_joining(self) -> None:
        """Pause joining for CHANNEL_JOIN_LIMIT_PAUSE_HOURS (logged once per pause)."""
        self._paused_until = datetime.now(timezone.utc) + timedelta(
            hours=settings.CHANNEL_JOIN_LIMIT_PAUSE_HOURS
        )
        logger.error(
            f"Telegram channel limit reached; pausing joins until {self._paused_until.isoformat()}. "
            "Leave some channels with this account to resume sooner (restart the listener)."
        )

    async def _count_recent_joins(self) -> int:
        """Count successful joins in the last 24 hours."""
        async with AsyncSessionLocal() as session:
            result = await session.execute(text("""
                SELECT COUNT(*) FROM discovered_channels
                WHERE joined_at > :since
            """), {'since': datetime.now(timezone.utc) - timedelta(hours=24)})
            return result.scalar() or 0

    async def _reset_stuck_joining(self) -> None:
        """Return rows left in 'joining' (crash/restart) to 'pending'."""
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=STUCK_JOINING_MINUTES)
        async with AsyncSessionLocal() as session:
            try:
                result = await session.execute(text("""
                    UPDATE discovered_channels
                    SET join_status = 'pending', updated_at = NOW()
                    WHERE join_status = 'joining'
                      AND COALESCE(join_attempted_at, updated_at) < :cutoff
                """), {'cutoff': cutoff})
                await session.commit()
                if result.rowcount:
                    logger.warning(f"Reset {result.rowcount} stuck 'joining' channel(s) to pending")
            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to reset stuck joining channels: {e}")

    async def _get_pending_channels(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Get discovered channels that need joining.

        Returns channels where:
        - join_status = 'pending' OR
        - join_status = 'failed' AND join_retry_after < NOW() AND retry_count < max
        - never ignored/promoted (admin_action IS NULL)
        - in approval mode, only rows an admin approved (join_approved_at IS NOT NULL)
        """
        now = datetime.now(timezone.utc)
        approval_clause = (
            "AND join_approved_at IS NOT NULL"
            if settings.effective_channel_join_mode == "approval"
            else ""
        )
        batch_size = settings.CHANNEL_JOIN_BATCH_SIZE
        if limit is not None:
            batch_size = min(batch_size, limit)

        async with AsyncSessionLocal() as session:
            query = text(f"""
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
                {approval_clause}
                ORDER BY discovery_count DESC, discovered_at ASC
                LIMIT :batch_size
            """)  # noqa: S608  approval_clause is a constant picked from settings; values are bound params

            result = await session.execute(query, {
                'now': now,
                'max_retries': settings.CHANNEL_JOIN_MAX_RETRIES,
                'batch_size': batch_size,
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
            # Back to pending without a retry bump; pause all joining
            await self._update_status(db_id, 'pending')
            self._pause_joining()
            return False

        except FloodWaitError:
            # Back to pending without a retry bump; the cycle sleeps and ends
            await self._update_status(db_id, 'pending')
            raise

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
