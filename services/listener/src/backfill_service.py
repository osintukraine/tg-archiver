"""
Backfill Service - Historical Message Fetching

Fetches historical messages from Telegram channels using iter_messages().
Supports configurable start dates, tracks progress, and handles ephemeral media.

Features:
- Date-based backfill (e.g., from 2022-02-24 invasion start)
- FloodWait error handling with exponential backoff
- Progress tracking in database
- Ephemeral media detection (media that existed but expired)
- Resume capability after interruption

Usage:
    backfill = BackfillService(telegram_client, db_session, config)
    await backfill.backfill_channel(channel, from_date=datetime(2024, 1, 1))
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.types import Channel as TelegramChannel, Message as TelegramMessage

from config.settings import settings
from .media_utils import get_media_type
from .social_graph_utils import extract_social_metadata
from .metrics import (
    record_backfill_complete,
    record_backfill_media,
    record_backfill_message,
    update_backfill_status,
)
from models.channel import Channel
from models.message import Message

logger = logging.getLogger(__name__)


class BackfillService:
    """
    Service for backfilling historical messages from Telegram channels.

    Handles:
    - Date-based historical fetching
    - FloodWait error handling
    - Progress tracking
    - Ephemeral media detection
    """

    def __init__(
        self,
        client: TelegramClient,
        db: AsyncSession,
        redis_queue=None,  # Optional: For queueing backfilled messages
        media_archiver=None,  # Optional: For downloading media
        notifier=None,  # Optional: For emitting events
    ):
        """
        Initialize backfill service.

        Args:
            client: Authenticated Telethon client
            db: Database session for tracking progress
            redis_queue: Optional Redis queue for backfilled messages
            media_archiver: Optional MediaArchiver for downloading media
            notifier: Optional NotificationClient for emitting events
        """
        self.client = client
        self.db = db
        self.redis_queue = redis_queue
        self.media_archiver = media_archiver
        self.notifier = notifier

        # Configuration from .env
        self.batch_size = settings.BACKFILL_BATCH_SIZE  # Messages per batch
        self.delay_ms = settings.BACKFILL_DELAY_MS  # Delay between batches
        self.media_strategy = settings.BACKFILL_MEDIA_STRATEGY  # Media handling
        self.enabled = settings.BACKFILL_ENABLED

        # Track grouped messages (media albums) to consolidate them
        self.grouped_messages_cache = {}  # {grouped_id: {'message': first_msg, 'media': [media_list]}}

    async def backfill_channel(
        self,
        channel: Channel,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
        session: Optional[AsyncSession] = None,
    ) -> dict:
        """
        Backfill historical messages for a channel.

        Args:
            channel: Channel model instance
            from_date: Start date for backfill (default: from .env or epoch)
            to_date: End date for backfill (default: now)

        Returns:
            dict with stats:
                - messages_fetched: Total messages fetched
                - messages_stored: Messages successfully stored
                - media_available: Media files still available
                - media_expired: Media files that expired
                - duration_seconds: Time taken
                - completed: Whether backfill finished
        """
        if not self.enabled:
            logger.warning("Backfill disabled in configuration")
            return {"error": "backfill_disabled"}

        # Use provided session or fall back to self.db
        db = session if session is not None else self.db
        if db is None:
            raise ValueError("No database session provided")

        # Use configured start date if not provided
        if from_date is None:
            from_date = settings.get_backfill_start_date() or datetime(1970, 1, 1, tzinfo=timezone.utc)

        if to_date is None:
            to_date = datetime.now(timezone.utc)

        logger.info(
            f"Starting backfill for channel {channel.telegram_id} "
            f"from {from_date} to {to_date}"
        )

        # Emit backfill.started event
        if self.notifier:
            await self.notifier.emit(
                "backfill.started",
                data={
                    "channel": channel.name or f"Channel {channel.telegram_id}",
                    "channel_id": channel.telegram_id,
                    "from_date": from_date.isoformat(),
                    "to_date": to_date.isoformat(),
                },
                priority="default",
                tags=["backfill", "telegram"]
            )

        # Update channel status
        channel.backfill_status = "in_progress"
        # Ensure from_date has timezone (database now uses TIMESTAMP WITH TIME ZONE)
        channel.backfill_from_date = from_date if from_date and from_date.tzinfo else from_date.replace(tzinfo=timezone.utc) if from_date else None
        channel.backfill_messages_fetched = 0
        await db.commit()

        # Update Prometheus metrics
        update_backfill_status(
            channel.telegram_id,
            channel.name or f"Channel {channel.telegram_id}",
            "in_progress",
        )

        start_time = datetime.now(timezone.utc)
        stats = {
            "messages_fetched": 0,
            "messages_stored": 0,
            "media_available": 0,
            "media_expired": 0,
            "errors": 0,
        }

        try:
            # Get Telegram entity for channel
            entity = await self.client.get_entity(channel.telegram_id)

            # Track previous grouped_id to detect group transitions
            previous_grouped_id = None

            # Iterate messages in batches
            # Start from from_date and go forward in time with reverse=True
            async for message in self.client.iter_messages(
                entity=entity,
                offset_date=from_date,  # Start from earliest date
                reverse=True,  # Go forward in time (oldest to newest)
                limit=None,  # No limit, fetch all
            ):
                # Check if message exceeds end date
                if message.date > to_date:
                    break

                # Detect group transition - flush previous group if needed
                current_grouped_id = message.grouped_id
                if previous_grouped_id is not None and current_grouped_id != previous_grouped_id:
                    # Group changed - flush the previous group
                    await self._flush_grouped_message(previous_grouped_id, channel, stats, db)

                previous_grouped_id = current_grouped_id

                # Process message
                try:
                    await self._process_backfilled_message(message, channel, stats, db)
                    stats["messages_fetched"] += 1

                    # Update progress every 100 messages
                    if stats["messages_fetched"] % 100 == 0:
                        channel.backfill_messages_fetched = stats["messages_fetched"]
                        await db.commit()
                        logger.info(
                            f"Backfill progress: {stats['messages_fetched']} messages "
                            f"for channel {channel.telegram_id}"
                        )

                        # Emit backfill.progress event
                        if self.notifier:
                            await self.notifier.emit(
                                "backfill.progress",
                                data={
                                    "channel": channel.name or f"Channel {channel.telegram_id}",
                                    "channel_id": channel.telegram_id,
                                    "messages_fetched": stats["messages_fetched"],
                                },
                                priority="low",  # Low priority for progress updates
                                tags=["backfill", "telegram"]
                            )

                    # Rate limiting: delay between batches
                    if stats["messages_fetched"] % self.batch_size == 0:
                        await asyncio.sleep(self.delay_ms / 1000.0)

                except Exception as e:
                    logger.error(
                        f"Error processing message {message.id} "
                        f"from channel {channel.telegram_id}: {e}"
                    )
                    stats["errors"] += 1
                    continue

            # Flush any remaining grouped message at end of backfill
            if previous_grouped_id is not None:
                await self._flush_grouped_message(previous_grouped_id, channel, stats, db)

            # Mark backfill as completed
            channel.backfill_status = "completed"
            # Store with timezone (database now uses TIMESTAMP WITH TIME ZONE)
            channel.backfill_completed_at = datetime.now(timezone.utc)
            channel.backfill_messages_fetched = stats["messages_fetched"]
            await db.commit()

            end_time = datetime.now(timezone.utc)
            duration = (end_time - start_time).total_seconds()

            # Update Prometheus metrics
            update_backfill_status(
                channel.telegram_id,
                channel.name or f"Channel {channel.telegram_id}",
                "completed",
            )
            record_backfill_complete(
                channel.telegram_id,
                duration,
                "completed",
            )

            logger.info(
                f"Backfill completed for channel {channel.telegram_id}: "
                f"{stats['messages_fetched']} messages in {duration:.1f}s"
            )

            # Emit backfill.completed event
            if self.notifier:
                await self.notifier.emit(
                    "backfill.completed",
                    data={
                        "channel": channel.name or f"Channel {channel.telegram_id}",
                        "channel_id": channel.telegram_id,
                        "messages_fetched": stats["messages_fetched"],
                        "duration_seconds": duration,
                    },
                    priority="default",
                    tags=["backfill", "telegram"]
                )

            return {
                **stats,
                "duration_seconds": duration,
                "completed": True,
            }

        except FloodWaitError as e:
            # Telegram rate limit exceeded
            wait_seconds = e.seconds
            logger.warning(
                f"FloodWait error for channel {channel.telegram_id}: "
                f"must wait {wait_seconds} seconds"
            )

            # Rollback any pending transaction before updating status
            await db.rollback()
            channel.backfill_status = "paused"
            await db.commit()

            # Update Prometheus metrics
            update_backfill_status(
                channel.telegram_id,
                channel.name or f"Channel {channel.telegram_id}",
                "paused",
            )
            end_time = datetime.now(timezone.utc)
            duration = (end_time - start_time).total_seconds()
            record_backfill_complete(
                channel.telegram_id,
                duration,
                "paused",
            )

            return {
                **stats,
                "completed": False,
                "flood_wait_seconds": wait_seconds,
                "error": "flood_wait",
            }

        except Exception as e:
            logger.error(f"Backfill failed for channel {channel.telegram_id}: {e}")
            # Rollback any pending transaction before updating status
            await db.rollback()
            channel.backfill_status = "failed"
            await db.commit()

            # Update Prometheus metrics
            update_backfill_status(
                channel.telegram_id,
                channel.name or f"Channel {channel.telegram_id}",
                "failed",
            )
            end_time = datetime.now(timezone.utc)
            duration = (end_time - start_time).total_seconds()
            record_backfill_complete(
                channel.telegram_id,
                duration,
                "failed",
            )

            # Emit backfill.failed event
            if self.notifier:
                await self.notifier.emit(
                    "backfill.failed",
                    data={
                        "channel": channel.name or f"Channel {channel.telegram_id}",
                        "channel_id": channel.telegram_id,
                        "error": str(e),
                        "messages_fetched": stats["messages_fetched"],
                    },
                    priority="high",  # Important to know about failures
                    tags=["backfill", "telegram", "error"]
                )

            return {
                **stats,
                "completed": False,
                "error": str(e),
            }

    async def _process_backfilled_message(
        self, telegram_msg: TelegramMessage, channel: Channel, stats: dict, db: AsyncSession
    ) -> None:
        """
        Process a single backfilled message, handling grouped media (albums).

        For grouped messages (multiple photos/videos in one post):
        - Buffer messages with same grouped_id
        - Create ONE database entry (using first message ID)
        - Link ALL media files to that one message
        - Use caption from first message (only one with text)

        Args:
            telegram_msg: Telethon Message object
            channel: Channel model instance
            stats: Statistics dict to update
            db: Database session
        """
        # Check if this is part of a grouped message (media album)
        if telegram_msg.grouped_id:
            await self._handle_grouped_message(telegram_msg, channel, stats, db)
            return

        # Single message (not part of album) - process normally
        await self._create_message_entry(telegram_msg, channel, stats, db)

    async def _handle_grouped_message(
        self, telegram_msg: TelegramMessage, channel: Channel, stats: dict, db: AsyncSession
    ) -> None:
        """
        Handle messages that are part of a grouped album.

        Strategy:
        - Buffer all messages with same grouped_id
        - When group complete (next message has different/no grouped_id), process the group
        - Create ONE message entry for the entire group
        - Link all media files to that one entry
        """
        grouped_id = telegram_msg.grouped_id

        # Initialize group buffer if needed
        if grouped_id not in self.grouped_messages_cache:
            self.grouped_messages_cache[grouped_id] = {
                'messages': [],
                'first_message': None,
            }

        group = self.grouped_messages_cache[grouped_id]

        # Track first message (has the caption)
        if not group['first_message']:
            group['first_message'] = telegram_msg

        # Add this message to the group
        group['messages'].append(telegram_msg)

        logger.debug(
            f"Buffered grouped message {telegram_msg.id} "
            f"(group {grouped_id}, {len(group['messages'])} total)"
        )

        # Note: We'll flush the group when we detect the group is complete
        # This happens in the main backfill loop when we see a different grouped_id
        # or when backfill completes. For now, just buffer.

    async def _flush_grouped_message(
        self, grouped_id: int, channel: Channel, stats: dict, db: AsyncSession
    ) -> None:
        """
        Flush a completed grouped message - create ONE database entry with ALL media.

        Args:
            grouped_id: The grouped_id to flush
            channel: Channel model
            stats: Statistics dict
            db: Database session
        """
        if grouped_id not in self.grouped_messages_cache:
            return

        group = self.grouped_messages_cache[grouped_id]
        messages = group['messages']
        first_msg = group['first_message']

        if not first_msg or not messages:
            logger.warning(f"Empty grouped message {grouped_id}, skipping")
            del self.grouped_messages_cache[grouped_id]
            return

        # BUGFIX: Find message with caption (can be ANY message in album, not just first)
        # In Telegram albums, the caption might be on any message, especially for forwards.
        caption_msg = None
        content = ""
        for msg in messages:
            if msg.message and msg.message.strip():
                caption_msg = msg
                content = msg.message
                break

        # Use caption message for metadata, or fallback to first message
        primary_msg = caption_msg if caption_msg else first_msg

        logger.info(
            f"Flushing grouped message {grouped_id}: "
            f"{len(messages)} media items, primary={primary_msg.id}, "
            f"caption_from={caption_msg.id if caption_msg else 'none'}"
        )

        # Detect media type from first message (normalized)
        media_type = get_media_type(first_msg)

        # Extract social graph metadata from message with caption (has better forward info)
        social_metadata = await extract_social_metadata(primary_msg)

        # Create ONE message record for the entire group
        telegram_date_tz = primary_msg.date if primary_msg.date and primary_msg.date.tzinfo else primary_msg.date.replace(tzinfo=timezone.utc) if primary_msg.date else None

        # PHASE 1 FIX: Database writes disabled - processors will handle insertion
        # This fixes duplicate key errors by ensuring single insertion path
        # Processors will:
        #   1. Insert message (with ON CONFLICT DO NOTHING)
        #   2. Download ALL media from album (using album_message_ids)
        #   3. Create MessageMedia links for all media files

        # Collect all message IDs in the group for media download
        all_message_ids = [msg.id for msg in messages]

        # Queue to Redis for processing
        if self.redis_queue:
            await self.redis_queue.push_message(
                message_id=primary_msg.id,
                channel_id=channel.telegram_id,  # Telegram channel ID
                content=content,
                media_type=media_type,
                media_url=None,  # Processors will download from Telegram
                telegram_date=telegram_date_tz,
                grouped_id=grouped_id,  # Signals this is a grouped message
                media_count=len(messages),  # Number of media files in album
                album_message_ids=all_message_ids,  # ALL message IDs for media download
                is_backfilled=True,
                # Engagement metrics
                views=primary_msg.views,
                forwards=primary_msg.forwards,
                # Social graph metadata
                author_user_id=social_metadata.get('author_user_id'),
                replied_to_message_id=social_metadata.get('replied_to_message_id'),
                forward_from_channel_id=social_metadata.get('forward_from_channel_id'),
                forward_from_message_id=social_metadata.get('forward_from_message_id'),
                forward_date=social_metadata.get('forward_date'),
                has_comments=social_metadata.get('has_comments', False),
                comments_count=social_metadata.get('comments_count', 0),
                linked_chat_id=social_metadata.get('linked_chat_id'),
            )
            logger.info(
                f"Queued grouped message {grouped_id} to Redis for processing "
                f"({len(messages)} media files)"
            )

        # Record metrics
        record_backfill_message(channel.telegram_id, channel.name or f"Channel {channel.telegram_id}", "fetched")

        stats["messages_stored"] += 1
        record_backfill_message(channel.telegram_id, channel.name or f"Channel {channel.telegram_id}", "stored")

        # Clean up cache
        del self.grouped_messages_cache[grouped_id]

    async def _create_message_entry(
        self, telegram_msg: TelegramMessage, channel: Channel, stats: dict, db: AsyncSession
    ) -> None:
        """
        Create a database entry for a single (non-grouped) message.

        This is the original logic for standalone messages.
        """
        # Extract message content
        content = telegram_msg.message or ""

        # Detect media type (normalized)
        media_type = get_media_type(telegram_msg)

        # Extract social graph metadata
        social_metadata = await extract_social_metadata(telegram_msg)

        # Create message record
        telegram_date_tz = telegram_msg.date if telegram_msg.date and telegram_msg.date.tzinfo else telegram_msg.date.replace(tzinfo=timezone.utc) if telegram_msg.date else None

        # PHASE 1 FIX: Database writes disabled - processors will handle insertion
        # This fixes duplicate key errors by ensuring single insertion path
        # Processors will:
        #   1. Insert message (with ON CONFLICT DO NOTHING)
        #   2. Download media from Telegram (if media_type is set)
        #   3. Create MessageMedia links

        # Queue to Redis for processing
        if self.redis_queue:
            await self.redis_queue.push_message(
                message_id=telegram_msg.id,
                channel_id=channel.telegram_id,  # Telegram channel ID
                content=content,
                media_type=media_type,
                media_url=None,  # Processors will download from Telegram
                telegram_date=telegram_date_tz,
                grouped_id=None,  # Not part of a group
                is_backfilled=True,
                # Engagement metrics
                views=telegram_msg.views,
                forwards=telegram_msg.forwards,
                # Social graph metadata
                author_user_id=social_metadata.get('author_user_id'),
                replied_to_message_id=social_metadata.get('replied_to_message_id'),
                forward_from_channel_id=social_metadata.get('forward_from_channel_id'),
                forward_from_message_id=social_metadata.get('forward_from_message_id'),
                forward_date=social_metadata.get('forward_date'),
                has_comments=social_metadata.get('has_comments', False),
                comments_count=social_metadata.get('comments_count', 0),
                linked_chat_id=social_metadata.get('linked_chat_id'),
            )
            logger.debug(f"Queued message {telegram_msg.id} to Redis for processing")

        # Record metrics
        record_backfill_message(channel.telegram_id, channel.name or f"Channel {channel.telegram_id}", "fetched")

        stats["messages_stored"] += 1
        record_backfill_message(channel.telegram_id, channel.name or f"Channel {channel.telegram_id}", "stored")

    async def _queue_for_processing(self, message: Message, channel: Channel) -> None:
        """
        Queue backfilled message for processing (spam filter, OSINT scoring, etc.).

        Args:
            message: Message model instance
            channel: Channel model instance
        """
        try:
            # Push to Redis queue for async processing
            # NOTE: Use channel.telegram_id (Telegram's ID), not message.channel_id (database FK)
            await self.redis_queue.push_message(
                message_id=message.message_id,
                channel_id=channel.telegram_id,  # Telegram channel ID, not database FK
                content=message.content,
                media_type=message.media_type,
                media_url=message.media_url_telegram,
                telegram_date=message.telegram_date,
                grouped_id=message.grouped_id,
                is_backfilled=True,  # Flag to indicate this is historical data
            )
            logger.debug(
                f"Queued backfilled message for processing: "
                f"message_id={message.message_id}, channel={channel.name} "
                f"(telegram_id={channel.telegram_id})"
            )
        except Exception as e:
            logger.warning(
                f"Failed to queue backfilled message {message.message_id} for processing: {e}"
            )

    async def resume_backfill(
        self, channel: Channel, session: Optional[AsyncSession] = None
    ) -> dict:
        """
        Resume a paused or failed backfill.

        Args:
            channel: Channel model instance
            session: Optional database session

        Returns:
            Backfill stats dict
        """
        # Use provided session or fall back to self.db
        db = session if session is not None else self.db
        if db is None:
            raise ValueError("No database session provided")

        if channel.backfill_status not in ("paused", "failed"):
            logger.warning(
                f"Cannot resume backfill for channel {channel.telegram_id}: "
                f"status is {channel.backfill_status}"
            )
            return {"error": "invalid_status"}

        logger.info(f"Resuming backfill for channel {channel.telegram_id}")

        # Get last message date to resume from
        last_msg = await db.execute(
            select(Message.telegram_date)
            .where(
                Message.channel_id == channel.id,
                Message.is_backfilled == True
            )
            .order_by(Message.telegram_date.desc())
            .limit(1)
        )
        last_date = last_msg.scalar_one_or_none()

        # Resume from last message date (or original from_date)
        from_date = last_date or channel.backfill_from_date

        return await self.backfill_channel(channel, from_date=from_date, session=db)


# Configuration helper (loaded from .env)
class BackfillConfig:
    """Backfill configuration from environment variables."""

    def __init__(self):
        # Add to config/settings.py
        self.BACKFILL_ENABLED = True
        self.BACKFILL_START_DATE = datetime(2024, 1, 1, tzinfo=timezone.utc)
        self.BACKFILL_MODE = "on_discovery"  # on_discovery | manual | scheduled
        self.BACKFILL_BATCH_SIZE = 100
        self.BACKFILL_DELAY_MS = 1000  # 1 second between batches
        self.BACKFILL_MEDIA_STRATEGY = "download_available"  # download_available | skip | download_all
