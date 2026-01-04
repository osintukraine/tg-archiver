"""
Telegram Listener - Main Message Monitoring Service

Monitors Telegram channels for new messages and pushes to Redis queue.
Uses Telethon client for Telegram API access.

Architecture:
1. Connects to Telegram with Telethon client
2. Subscribes to channel updates using events.Album + events.NewMessage
3. Albums handled by events.Album (Telethon buffers automatically)
4. Single messages handled by events.NewMessage
5. Pushes to Redis queue for processing
6. Tracks metrics (Prometheus)

Event Handling Strategy (Telethon 1.42+):
- events.Album: Primary handler for grouped media (albums)
  - Telethon automatically buffers all messages in an album
  - Provides .text (caption), .messages (all items), .forward (metadata)
  - Known limitation: May not fire for exactly 1 image + 1 video (issue #4426)
- events.NewMessage: Handler for single (non-grouped) messages
  - Skips messages with grouped_id (Album handles those)
- Fallback: Stale group flush for edge cases where Album doesn't fire

Features:
- Handles flood-wait gracefully (exponential backoff)
- Reconnection logic with retry
- Session persistence (survives restarts)
- Multi-channel support (single session handles 254+ channels)
- Graceful shutdown (flushes pending messages)
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from telethon import TelegramClient, events
from telethon.errors import (
    FloodWaitError,
    SessionPasswordNeededError,
    UnauthorizedError,
)
from telethon.tl.types import Channel as TelegramChannel
from telethon.tl.types import InputPeerChannel
from telethon.tl.types import Message as TelegramMessage
from telethon.utils import resolve_id

from config.settings import settings
from models.base import AsyncSessionLocal
from models.channel import Channel

from .media_utils import get_media_type
from .metrics import (
    record_connection_error,
    record_flood_wait,
    record_message_failed,
    record_message_queued,
    record_message_received,
    telegram_connections,
)
from .redis_queue import RedisQueue
from .social_graph_utils import extract_social_metadata, fetch_and_upsert_user_from_telegram
# Translation removed - now handled in processor for cost efficiency
# from .translation import TranslationService

logger = logging.getLogger(__name__)


class TelegramListener:
    """
    Telegram message listener using Telethon.

    Monitors channels discovered from folders and pushes messages to queue.
    """

    def __init__(
        self,
        redis_queue: RedisQueue,
        telegram_client: Optional[TelegramClient] = None,
    ):
        """
        Initialize Telegram listener.

        Args:
            redis_queue: Redis queue client for message publishing
            telegram_client: Optional pre-connected TelegramClient to reuse
        """
        self.redis_queue = redis_queue

        # Telethon client (can be passed in to share session)
        self.client: Optional[TelegramClient] = telegram_client

        # Active channels being monitored
        self.active_channels: dict[int, Channel] = {}

        # Fallback buffer for grouped messages (in case events.Album doesn't fire)
        # {grouped_id: {'messages': [msg1, msg2, ...], 'first_message': msg, 'channel': channel}}
        # NOTE: This is only used when Album event fails (edge cases like 1 img + 1 vid)
        self.grouped_messages_cache: dict = {}

        # Shutdown flag
        self._shutdown = False

        # Event handler references (for re-registration when channels change)
        self._album_handler = None
        self._message_handler = None

    async def start(self):
        """
        Start Telegram listener.

        Connects to Telegram, loads active channels, and starts monitoring.

        Raises:
            Exception: If connection or authentication fails
        """
        logger.info("Starting Telegram Listener...")

        # Use existing client if provided, otherwise create new one
        if self.client is None:
            # Initialize Telethon client
            # Use configured session name from settings (shared across all services)
            self.client = TelegramClient(
                session=str(settings.TELEGRAM_SESSION_PATH / settings.TELEGRAM_SESSION_NAME),
                api_id=settings.TELEGRAM_API_ID,
                api_hash=settings.TELEGRAM_API_HASH,
                connection_retries=5,
                retry_delay=5,
                auto_reconnect=True,
            )

        try:
            # Connect to Telegram (if not already connected)
            if not self.client.is_connected():
                await self.client.connect()

            # Authenticate if needed
            if not await self.client.is_user_authorized():
                logger.warning("Telegram session not authorized")
                await self._authenticate()

            telegram_connections.set(1)
            logger.info("Connected to Telegram successfully")

            # Load active channels from database
            await self.load_active_channels()

            # Start periodic group flush task BEFORE subscribe (since subscribe blocks forever)
            asyncio.create_task(self._periodic_group_flush())

            logger.info(
                f"Telegram Listener started - monitoring {len(self.active_channels)} channels"
            )

            # Subscribe to channel messages (blocks until disconnected)
            await self._subscribe_to_channels()

        except Exception as e:
            logger.exception(f"Failed to start Telegram Listener: {e}")
            record_connection_error("telegram")
            telegram_connections.set(0)
            raise

    async def stop(self):
        """Stop Telegram listener gracefully."""
        logger.info("Stopping Telegram Listener...")

        self._shutdown = True

        if self.client:
            await self.client.disconnect()
            telegram_connections.set(0)

        logger.info("Telegram Listener stopped")

    async def load_active_channels(self):
        """
        Load active channels from database.

        Updates self.active_channels with current active channels.
        Keys are RAW channel IDs (without -100 prefix) to match message.peer_id.channel_id.
        """
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Channel).where(Channel.active == True))
            channels = result.scalars().all()

            # Use raw channel ID as key (convert from marked -100xxx format)
            # This matches message.peer_id.channel_id which uses raw IDs
            self.active_channels = {}
            for channel in channels:
                raw_id, _ = resolve_id(channel.telegram_id)
                self.active_channels[raw_id] = channel

            logger.info(
                f"Loaded {len(self.active_channels)} active channels: "
                f"{', '.join(c.name for c in self.active_channels.values())}"
            )

    async def _authenticate(self):
        """
        Authenticate with Telegram if needed.

        Requires user interaction (phone number, code, 2FA password).
        """
        phone = input("Enter phone number (with country code, e.g., +1234567890): ")
        await self.client.send_code_request(phone)

        code = input("Enter the code you received: ")

        try:
            await self.client.sign_in(phone, code)
        except SessionPasswordNeededError:
            password = input("Two-step verification enabled. Enter password: ")
            await self.client.sign_in(password=password)

        logger.info("Authentication successful")

    async def _subscribe_to_channels(self):
        """
        Subscribe to new message events from active channels.

        Uses Telethon's event handler system. Handlers can be re-registered
        when channels change via _resubscribe_to_channels().
        """
        await self._register_event_handlers()

        # Keep client running
        await self.client.run_until_disconnected()

    async def _get_channel_entities(self) -> list:
        """
        Get Telethon channel entities for all active channels.

        Returns:
            List of TelegramChannel entities
        """
        channel_entities = []

        for channel in self.active_channels.values():
            try:
                # Convert marked ID (-1001234567890) back to raw channel ID (1234567890)
                # InputPeerChannel expects raw ID, not the marked format
                raw_channel_id, peer_type = resolve_id(channel.telegram_id)

                # Use InputPeerChannel with access_hash for reliable entity resolution
                input_peer = InputPeerChannel(
                    channel_id=raw_channel_id,
                    access_hash=channel.access_hash
                )
                entity = await self.client.get_entity(input_peer)
                if isinstance(entity, TelegramChannel):
                    channel_entities.append(entity)
                else:
                    logger.warning(f"Entity {channel.telegram_id} is not a channel, skipping")
            except Exception as e:
                logger.error(f"Failed to get entity for channel {channel.name}: {e}")
                continue

        return channel_entities

    async def _register_event_handlers(self):
        """
        Register event handlers for current active channels.

        Stores handler references so they can be removed later.
        """
        channel_entities = await self._get_channel_entities()

        # Define handler functions
        async def handle_album(event: events.Album.Event):
            """Handle complete album from subscribed channels."""
            await self._on_album(event)

        async def handle_new_message(event: events.NewMessage.Event):
            """Handle single message from subscribed channels."""
            # Skip grouped messages - Album event handles complete albums
            if event.message.grouped_id:
                # Buffer for fallback (in case Album event doesn't fire)
                await self._buffer_grouped_message(event.message)
                return
            await self._on_single_message(event.message)

        # Store references for later removal
        self._album_handler = handle_album
        self._message_handler = handle_new_message

        # Register handlers with channel filter
        self.client.add_event_handler(
            handle_album,
            events.Album(chats=channel_entities)
        )
        self.client.add_event_handler(
            handle_new_message,
            events.NewMessage(chats=channel_entities)
        )

        logger.info(
            f"Subscribed to {len(channel_entities)} channels "
            f"(events.Album for albums, events.NewMessage for singles)"
        )

    async def _resubscribe_to_channels(self):
        """
        Re-register event handlers with updated channel list.

        Called when channels are added/removed to update the subscription
        without restarting the listener.
        """
        # Remove old handlers if they exist
        if self._album_handler:
            self.client.remove_event_handler(self._album_handler)
            logger.debug("Removed old Album handler")
        if self._message_handler:
            self.client.remove_event_handler(self._message_handler)
            logger.debug("Removed old NewMessage handler")

        # Register new handlers with updated channel list
        await self._register_event_handlers()
        logger.info("Re-subscribed to channels with updated list")

    async def _on_album(self, event: events.Album.Event):
        """
        Process complete album from Telegram using events.Album.

        This is the PRIMARY handler for grouped media. Telethon automatically
        buffers all messages in an album and delivers them together.

        Args:
            event: Telethon Album event containing all album messages
        """
        if self._shutdown:
            return

        # Get channel from first message
        first_msg = event.messages[0]
        channel_id = first_msg.peer_id.channel_id
        channel = self.active_channels.get(channel_id)

        if not channel:
            logger.warning(f"Received album from unknown channel: {channel_id}")
            return

        grouped_id = event.grouped_id

        try:
            # Mark this grouped_id as processed by Album event
            # This prevents the fallback mechanism from double-processing
            if grouped_id in self.grouped_messages_cache:
                logger.debug(f"Album event received for {grouped_id}, clearing fallback buffer")
                self.grouped_messages_cache.pop(grouped_id, None)

            # Use Telethon's built-in text extraction (finds caption from any message)
            content = event.text  # Already handles caption on any message
            messages = event.messages

            # Get primary message (one with caption, or first)
            primary_msg = None
            for msg in messages:
                if msg.message and msg.message.strip():
                    primary_msg = msg
                    break
            if not primary_msg:
                primary_msg = first_msg

            telegram_date = primary_msg.date

            logger.info(
                f"Album received via events.Album: channel={channel.name}, "
                f"grouped_id={grouped_id}, items={len(messages)}, "
                f"has_caption={content is not None and len(content) > 0}"
            )

            # Detect media type from first message with media
            media_type = get_media_type(first_msg)

            # Extract social graph metadata - use Album's forward property if available
            if event.forward:
                # Album provides forward metadata directly
                social_metadata = await extract_social_metadata(primary_msg)
            else:
                social_metadata = await extract_social_metadata(primary_msg)

            # If message has an author, upsert user profile
            if social_metadata.get('author_user_id'):
                asyncio.create_task(
                    fetch_and_upsert_user_from_telegram(
                        self.client,
                        social_metadata['author_user_id']
                    )
                )

            # Record metric
            record_message_received(
                channel_id=channel.telegram_id,
                channel_name=channel.name,
                has_media=bool(media_type),
            )

            # Collect all message IDs for media download
            all_message_ids = [msg.id for msg in messages]

            # Push to Redis queue
            await self.redis_queue.push_message(
                message_id=primary_msg.id,
                channel_id=channel.telegram_id,
                content=content,
                media_type=media_type,
                telegram_date=telegram_date,
                grouped_id=grouped_id,
                media_count=len(messages),
                album_message_ids=all_message_ids,
                views=primary_msg.views,
                forwards=primary_msg.forwards,
                source_account=settings.SOURCE_ACCOUNT,
                author_user_id=social_metadata.get('author_user_id'),
                replied_to_message_id=social_metadata.get('replied_to_message_id'),
                forward_from_channel_id=social_metadata.get('forward_from_channel_id'),
                forward_from_message_id=social_metadata.get('forward_from_message_id'),
                forward_date=social_metadata.get('forward_date'),
                has_comments=social_metadata.get('has_comments', False),
                comments_count=social_metadata.get('comments_count', 0),
                linked_chat_id=social_metadata.get('linked_chat_id'),
            )

            record_message_queued(channel_id=channel.telegram_id)

            logger.info(
                f"Queued album: channel={channel.name}, "
                f"message_id={primary_msg.id}, media_count={len(messages)}, "
                f"has_caption={content is not None and len(content) > 0}"
            )

        except FloodWaitError as e:
            logger.warning(f"Flood wait error in album handler: {e.seconds}s")
            record_flood_wait(e.seconds)
            await asyncio.sleep(e.seconds)

        except Exception as e:
            logger.exception(f"Error processing album from {channel.name}: {e}")
            record_message_failed(channel_id=channel_id, error_type=type(e).__name__)

    async def _on_single_message(self, message: TelegramMessage):
        """
        Process single (non-grouped) message from Telegram.

        This handles regular messages that are NOT part of an album.
        Album messages are handled by _on_album via events.Album.

        Args:
            message: Telethon Message object
        """
        if self._shutdown:
            return

        channel_id = message.peer_id.channel_id
        channel = self.active_channels.get(channel_id)

        if not channel:
            logger.warning(f"Received message from unknown channel: {channel_id}")
            return

        try:
            await self._process_single_message(message, channel)

        except FloodWaitError as e:
            logger.warning(
                f"Flood wait error - sleeping for {e.seconds} seconds "
                f"(channel={channel.name})"
            )
            record_flood_wait(e.seconds)

            await asyncio.sleep(e.seconds)

        except Exception as e:
            logger.exception(
                f"Error processing message from {channel.name} (id={message.id}): {e}"
            )
            record_message_failed(channel_id=channel_id, error_type=type(e).__name__)

    async def _buffer_grouped_message(self, message: TelegramMessage):
        """
        Buffer grouped message as FALLBACK for when events.Album doesn't fire.

        This is a safety mechanism for edge cases like:
        - Exactly 1 image + 1 video (known Telethon issue #4426)
        - Cross-datacenter album delivery issues
        - Any other case where Album event fails to fire

        The stale flush mechanism will process these buffered messages
        if they aren't claimed by an Album event within the timeout.

        Args:
            message: Telethon Message object (with grouped_id)
        """
        grouped_id = message.grouped_id
        channel_id = message.peer_id.channel_id
        channel = self.active_channels.get(channel_id)

        if not channel:
            return

        # Initialize group buffer if needed
        if grouped_id not in self.grouped_messages_cache:
            self.grouped_messages_cache[grouped_id] = {
                'messages': [],
                'first_message': None,
                'channel': channel,
            }

        group = self.grouped_messages_cache[grouped_id]

        # Track first message
        if not group['first_message']:
            group['first_message'] = message

        # Add this message to the group
        group['messages'].append(message)

        # Debug log - Album event should normally handle this
        logger.debug(
            f"Fallback buffer: msg_id={message.id}, group={grouped_id}, "
            f"buffered={len(group['messages'])}, channel={channel.name}"
        )

    async def _fetch_complete_album_from_telegram(
        self,
        channel_telegram_id: int,
        message_id: int,
        grouped_id: int,
    ) -> list:
        """
        Actively fetch complete album from Telegram API.

        When events.Album fails to fire AND events.NewMessage doesn't deliver
        all messages (known Telethon issue), this method fetches the complete
        album directly from Telegram using get_messages().

        Uses a window around the known message_id to find all messages with
        the same grouped_id.

        Args:
            channel_telegram_id: Telegram channel ID
            message_id: Known message ID from the album
            grouped_id: The album's grouped_id

        Returns:
            List of Telethon Message objects belonging to this album
        """
        try:
            # Fetch messages in a window around the known message_id
            # Albums typically have sequential message IDs, so +/-30 is safe margin
            all_messages = await self.client.get_messages(
                entity=channel_telegram_id,
                min_id=message_id - 30,
                max_id=message_id + 30,
                limit=60
            )

            # Filter to messages with matching grouped_id
            album_messages = [m for m in all_messages if m.grouped_id == grouped_id]

            return album_messages

        except Exception as e:
            logger.warning(
                f"Failed to fetch complete album from Telegram: grouped_id={grouped_id}, "
                f"channel={channel_telegram_id}, error={e}"
            )
            return []

    async def _flush_grouped_message(self, grouped_id: int):
        """
        FALLBACK: Flush buffered grouped message when events.Album didn't fire.

        This is called by the periodic stale flush mechanism when:
        - Album event failed to fire (edge cases like 1 image + 1 video)
        - Messages were buffered but not claimed by Album handler
        - Stale timeout (60s) was reached

        ENHANCED (Dec 2024): If album appears incomplete (1 message or no caption),
        actively fetches the complete album from Telegram API before processing.
        This fixes the issue where events.NewMessage doesn't deliver all messages
        when events.Album fails to fire.

        Creates ONE database entry with ALL buffered media.

        Args:
            grouped_id: The grouped_id to flush
        """
        # Early return if group not in cache (prevents KeyError in finally block)
        # This can happen if flush is called twice for same group (race condition)
        if grouped_id not in self.grouped_messages_cache:
            logger.debug(f"Grouped message {grouped_id} not in cache, already flushed")
            return

        group = self.grouped_messages_cache[grouped_id]
        messages = group['messages']
        first_msg = group['first_message']
        channel = group['channel']

        if not first_msg or not messages:
            logger.warning(f"Empty grouped message {grouped_id}, skipping")
            # Don't delete here - finally block will clean up with pop()
            return

        try:
            # ENHANCEMENT: Check if album appears incomplete and actively fetch from Telegram
            # Incomplete = only 1 message buffered OR no message has caption
            has_caption = any(msg.message and msg.message.strip() for msg in messages)
            is_incomplete = len(messages) == 1 or not has_caption

            if is_incomplete:
                logger.info(
                    f"Album appears incomplete: grouped_id={grouped_id}, "
                    f"buffered={len(messages)}, has_caption={has_caption}. "
                    f"Fetching complete album from Telegram..."
                )

                # Actively fetch the complete album from Telegram
                fetched_messages = await self._fetch_complete_album_from_telegram(
                    channel_telegram_id=channel.telegram_id,
                    message_id=first_msg.id,
                    grouped_id=grouped_id,
                )

                if fetched_messages and len(fetched_messages) > len(messages):
                    logger.info(
                        f"Fetched complete album: grouped_id={grouped_id}, "
                        f"buffered={len(messages)} → fetched={len(fetched_messages)}"
                    )
                    # Use fetched messages instead of buffered ones
                    messages = fetched_messages
                    # Update first_msg to ensure we have a valid reference
                    first_msg = messages[0]
                elif fetched_messages:
                    logger.debug(
                        f"Fetch didn't find more messages: grouped_id={grouped_id}, "
                        f"buffered={len(messages)}, fetched={len(fetched_messages)}"
                    )
                else:
                    logger.warning(
                        f"Active fetch failed for album: grouped_id={grouped_id}. "
                        f"Proceeding with {len(messages)} buffered message(s)."
                    )

            # BUGFIX: Find message with caption (can be ANY message in album, not just first)
            # In Telegram albums, the caption might be on any message, especially for forwards.
            # The first message by arrival order is NOT guaranteed to have the caption.
            caption_msg = None
            content = None
            for msg in messages:
                if msg.message and msg.message.strip():
                    caption_msg = msg
                    content = msg.message
                    break

            # Use caption message for metadata, or fallback to first message
            primary_msg = caption_msg if caption_msg else first_msg
            telegram_date = primary_msg.date

            logger.warning(
                f"FALLBACK flush (Album event didn't fire): grouped_id={grouped_id}, "
                f"items={len(messages)}, primary={primary_msg.id}, "
                f"caption_from={caption_msg.id if caption_msg else 'none'}, "
                f"channel={channel.name}"
            )

            # Detect media type from first message with media
            media_type = get_media_type(first_msg)

            # Extract social graph metadata from message with caption (has better forward info)
            social_metadata = await extract_social_metadata(primary_msg)

            # If message has an author, upsert user profile
            if social_metadata.get('author_user_id'):
                # Fire and forget - don't block message processing on user fetch
                asyncio.create_task(
                    fetch_and_upsert_user_from_telegram(
                        self.client,
                        social_metadata['author_user_id']
                    )
                )

            # Record metric
            record_message_received(
                channel_id=channel.telegram_id,
                channel_name=channel.name,
                has_media=bool(media_type),
            )

            logger.debug(
                f"Flushing grouped message: channel={channel.name}, "
                f"message_id={primary_msg.id}, media_count={len(messages)}, "
                f"author={social_metadata.get('author_user_id')}, "
                f"forwarded={bool(social_metadata.get('forward_from_channel_id'))}"
            )

            # Collect all message IDs in the group for media download
            all_message_ids = [msg.id for msg in messages]

            # Push to Redis queue with grouped_id for album support
            await self.redis_queue.push_message(
                message_id=primary_msg.id,
                channel_id=channel.telegram_id,
                content=content,
                media_type=media_type,
                telegram_date=telegram_date,
                grouped_id=grouped_id,  # Pass grouped_id via extra_fields
                media_count=len(messages),  # Number of media files in album
                album_message_ids=all_message_ids,  # ALL message IDs for media download
                views=primary_msg.views,  # Engagement metrics from Telegram
                forwards=primary_msg.forwards,
                # Multi-account session routing
                source_account=settings.SOURCE_ACCOUNT,
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

            record_message_queued(channel_id=channel.telegram_id)

            logger.info(
                f"Queued album (via fallback): channel={channel.name}, "
                f"message_id={primary_msg.id}, media_count={len(messages)}, "
                f"has_caption={content is not None}"
            )

        except Exception as e:
            logger.exception(
                f"Error flushing grouped message {grouped_id}: {e}"
            )

        finally:
            # Clean up cache (use pop to avoid KeyError if already removed)
            self.grouped_messages_cache.pop(grouped_id, None)

    async def _process_single_message(self, message: TelegramMessage, channel: Channel):
        """
        Process non-grouped (single) message.

        This is the original message processing logic.

        Args:
            message: Telethon Message object
            channel: Channel model instance
        """
        # Extract message data
        content = message.message if message.message else None
        telegram_date = message.date

        # Check for media
        media_type = get_media_type(message)

        # Extract social graph metadata
        social_metadata = await extract_social_metadata(message)

        # If message has an author, upsert user profile
        if social_metadata.get('author_user_id'):
            # Fire and forget - don't block message processing on user fetch
            asyncio.create_task(
                fetch_and_upsert_user_from_telegram(
                    self.client,
                    social_metadata['author_user_id']
                )
            )

        # Record metric
        record_message_received(
            channel_id=channel.telegram_id,
            channel_name=channel.name,
            has_media=bool(media_type),
        )

        logger.debug(
            f"Received message: channel={channel.name}, "
            f"message_id={message.id}, has_media={bool(media_type)}, "
            f"author={social_metadata.get('author_user_id')}, "
            f"forwarded={bool(social_metadata.get('forward_from_channel_id'))}"
        )

        # Push to Redis queue with social graph metadata
        await self.redis_queue.push_message(
            message_id=message.id,
            channel_id=channel.telegram_id,
            content=content,
            media_type=media_type,
            telegram_date=telegram_date,
            views=message.views,  # Engagement metrics from Telegram
            forwards=message.forwards,
            # Multi-account session routing
            source_account=settings.SOURCE_ACCOUNT,
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

        record_message_queued(channel_id=channel.telegram_id)

        logger.debug(
            f"Queued message: channel={channel.name}, message_id={message.id}"
        )

    async def _periodic_group_flush(self):
        """
        FALLBACK: Periodically flush stale grouped messages when Album event didn't fire.

        This is a safety mechanism for edge cases where events.Album doesn't fire:
        - Exactly 1 image + 1 video (known Telethon issue #4426)
        - Cross-datacenter album delivery issues
        - Any other case where Album event fails

        Messages are buffered by _buffer_grouped_message (called from NewMessage handler).
        If Album event fires, it clears the buffer and processes directly.
        If Album event doesn't fire, this mechanism flushes after timeout.

        Flushes groups that haven't received new messages in 60 seconds.
        """
        STALE_TIMEOUT_SECONDS = 60  # Time to wait for Album event or more messages
        CHECK_INTERVAL_SECONDS = 30

        logger.info(
            f"Started fallback group flush task "
            f"(checks every {CHECK_INTERVAL_SECONDS}s, timeout={STALE_TIMEOUT_SECONDS}s)"
        )

        while not self._shutdown:
            await asyncio.sleep(CHECK_INTERVAL_SECONDS)

            if not self.grouped_messages_cache:
                continue  # No groups to flush

            now = datetime.now(timezone.utc)
            stale_groups = []

            # Find groups that haven't been updated in STALE_TIMEOUT_SECONDS
            for grouped_id, group in self.grouped_messages_cache.items():
                messages = group.get('messages', [])
                if not messages:
                    stale_groups.append(grouped_id)
                    continue

                # Check last message timestamp
                last_msg = messages[-1]
                if last_msg.date:
                    # Ensure message date has timezone
                    msg_date = last_msg.date if last_msg.date.tzinfo else last_msg.date.replace(tzinfo=timezone.utc)
                    age_seconds = (now - msg_date).total_seconds()

                    if age_seconds > STALE_TIMEOUT_SECONDS:
                        stale_groups.append(grouped_id)
                        # Log at WARNING - Album event should have handled this
                        channel = group.get('channel')
                        logger.warning(
                            f"Album event didn't fire for group {grouped_id}: "
                            f"{age_seconds:.1f}s old, {len(messages)} messages buffered, "
                            f"channel={channel.name if channel else 'unknown'}"
                        )

            # Flush stale groups
            for grouped_id in stale_groups:
                logger.info(f"Auto-flushing stale grouped message {grouped_id}")
                await self._flush_grouped_message(grouped_id)

        logger.info("Periodic group flush task stopped")

    async def reload_channels(self):
        """
        Reload active channels from database and re-subscribe if changed.

        Called by background sync task when channels are added/removed.
        Automatically re-registers event handlers with updated channel list.
        """
        logger.info("Reloading active channels...")

        old_count = len(self.active_channels)
        old_ids = set(self.active_channels.keys())

        await self.load_active_channels()

        new_count = len(self.active_channels)
        new_ids = set(self.active_channels.keys())

        # Check if channels actually changed (not just count, but which channels)
        if old_ids != new_ids:
            added = new_ids - old_ids
            removed = old_ids - new_ids

            logger.info(
                f"Channel list changed: {old_count} → {new_count} "
                f"(+{len(added)} added, -{len(removed)} removed)"
            )

            # Re-register event handlers with updated channel list
            await self._resubscribe_to_channels()
        else:
            logger.debug("No channel changes detected")
