"""
Forward Social Fetcher - Fetch social data from original messages in forward sources.

Background service that:
1. Finds message_forwards that need social data (from joined discovered channels)
2. Fetches the original message content from Telegram
3. Stores reactions and comments from the original
4. Updates message_forwards.social_data_fetched_at

This is SEPARATE from social_fetcher.py which handles social data for OUR archived messages.
This module handles social data from the ORIGINAL messages that were forwarded to our channels.

Configuration (reuses SOCIAL_FETCH_* settings):
- SOCIAL_FETCH_ENABLED: Enable/disable social fetching
- SOCIAL_FETCH_INTERVAL_SECONDS: Interval between fetch cycles
- SOCIAL_FETCH_BATCH_SIZE: Message forwards per cycle
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from telethon import TelegramClient
from telethon.errors import (
    ChannelPrivateError,
    ChatAdminRequiredError,
    FloodWaitError,
    MsgIdInvalidError,
)
from telethon.tl.functions.messages import (
    GetDiscussionMessageRequest,
    GetMessagesReactionsRequest,
)
from telethon.tl.types import (
    Message as TelegramMessage,
    PeerChannel,
    InputPeerChannel,
    ReactionEmoji,
    ReactionCustomEmoji,
    ReactionPaid,
    PeerUser,
)

from config.settings import settings
from models.base import AsyncSessionLocal

logger = logging.getLogger(__name__)


class ForwardSocialFetcher:
    """
    Background service for fetching social data from original messages.

    Handles:
    - Fetching original message content
    - Getting reactions from originals
    - Getting comments from originals (if available)
    - Rate limiting and error handling
    """

    def __init__(self, client: TelegramClient):
        """
        Initialize forward social fetcher.

        Args:
            client: Authenticated Telethon client
        """
        self.client = client
        self.running = False
        self._fetch_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the background fetch loop."""
        if not settings.SOCIAL_FETCH_ENABLED:
            logger.info("Forward social fetching disabled (SOCIAL_FETCH_ENABLED=false)")
            return

        self.running = True
        self._fetch_task = asyncio.create_task(self._fetch_loop())
        logger.info("Forward social fetcher started")

    async def stop(self) -> None:
        """Stop the background fetch loop."""
        self.running = False
        if self._fetch_task:
            self._fetch_task.cancel()
            try:
                await self._fetch_task
            except asyncio.CancelledError:
                pass
        logger.info("Forward social fetcher stopped")

    async def _fetch_loop(self) -> None:
        """Main fetch loop - runs periodically."""
        # Initial delay to let other services start
        await asyncio.sleep(30)

        while self.running:
            try:
                await self._fetch_cycle()
            except Exception as e:
                logger.error(f"Forward social fetch cycle failed: {e}", exc_info=True)

            # Wait for next cycle (use same interval as social fetcher)
            await asyncio.sleep(settings.SOCIAL_FETCH_INTERVAL_SECONDS)

    async def _fetch_cycle(self) -> None:
        """
        Single fetch cycle - process batch of forwards needing social data.
        """
        forwards = await self._get_forwards_needing_social()
        if not forwards:
            logger.debug("No forwards needing social data")
            return

        logger.info(f"Processing {len(forwards)} forwards for social data")

        fetched = 0
        for forward in forwards:
            try:
                success = await self._fetch_social_for_forward(forward)
                if success:
                    fetched += 1
            except FloodWaitError as e:
                logger.warning(f"FloodWait: sleeping {e.seconds}s")
                await asyncio.sleep(e.seconds)
            except Exception as e:
                logger.warning(
                    f"Failed to fetch social data for forward {forward['id']}: {e}"
                )

            # Rate limiting delay
            await asyncio.sleep(1)

        logger.info(f"Forward social fetch cycle complete: {fetched} fetched")

    async def _get_forwards_needing_social(self) -> List[Dict[str, Any]]:
        """
        Get message_forwards that need social data fetched.

        Criteria:
        - social_data_fetched_at IS NULL
        - discovered_channel has join_status = 'joined'
        """
        async with AsyncSessionLocal() as session:
            query = text("""
                SELECT
                    mf.id,
                    mf.local_message_id,
                    mf.original_channel_id,
                    mf.original_message_id,
                    mf.discovered_channel_id,
                    dc.username as channel_username,
                    dc.access_hash as channel_access_hash
                FROM message_forwards mf
                LEFT JOIN discovered_channels dc ON dc.id = mf.discovered_channel_id
                WHERE mf.social_data_fetched_at IS NULL
                  AND (
                    -- Either channel is joined OR we monitor the source
                    dc.join_status = 'joined'
                    OR EXISTS (
                        SELECT 1 FROM channels c
                        WHERE c.telegram_id = mf.original_channel_id
                    )
                  )
                ORDER BY mf.created_at ASC
                LIMIT :batch_size
            """)

            result = await session.execute(query, {
                'batch_size': settings.SOCIAL_FETCH_BATCH_SIZE,
            })

            return [dict(row._mapping) for row in result]

    async def _fetch_social_for_forward(self, forward: Dict[str, Any]) -> bool:
        """
        Fetch social data for a single forward.

        Args:
            forward: Dict with forward data

        Returns:
            True if successful
        """
        forward_id = forward['id']
        channel_id = forward['original_channel_id']
        message_id = forward['original_message_id']
        username = forward.get('channel_username')
        access_hash = forward.get('channel_access_hash')

        logger.debug(
            f"Fetching social data for forward {forward_id} "
            f"(channel={channel_id}, msg={message_id})"
        )

        try:
            # Get channel entity
            if username:
                entity = await self.client.get_entity(f"@{username}")
            elif access_hash:
                entity = InputPeerChannel(channel_id=channel_id, access_hash=access_hash)
            else:
                # Try by ID (may fail for some channels)
                entity = await self.client.get_entity(PeerChannel(channel_id))

            # Fetch the original message
            messages = await self.client.get_messages(entity, ids=[message_id])
            if not messages or not messages[0]:
                logger.warning(f"Original message {message_id} not found in channel {channel_id}")
                await self._mark_fetched(forward_id, error="Message not found")
                return False

            original_msg = messages[0]
            if not isinstance(original_msg, TelegramMessage):
                await self._mark_fetched(forward_id, error="Invalid message type")
                return False

            # Store original message content
            await self._store_original_message(forward_id, original_msg)

            # Fetch and store reactions
            await self._fetch_reactions(forward_id, entity, message_id)

            # Fetch comments if available
            if original_msg.replies and original_msg.replies.comments:
                await self._fetch_comments(forward_id, entity, original_msg)

            # Mark as fetched with engagement stats
            await self._mark_fetched(
                forward_id,
                views=getattr(original_msg, 'views', None),
                forwards=getattr(original_msg, 'forwards', None),
                reactions_count=self._count_reactions(original_msg),
                comments_count=getattr(original_msg.replies, 'replies', 0) if original_msg.replies else 0,
            )

            return True

        except ChannelPrivateError:
            logger.warning(f"Channel {channel_id} is private")
            await self._mark_fetched(forward_id, error="Channel is private")
            return False

        except MsgIdInvalidError:
            logger.warning(f"Message {message_id} is invalid/deleted")
            await self._mark_fetched(forward_id, error="Message deleted")
            return False

        except Exception as e:
            logger.warning(f"Error fetching social data: {e}")
            # Don't mark as fetched - will retry later
            return False

    def _count_reactions(self, msg: TelegramMessage) -> int:
        """Count total reactions on a message."""
        if not msg.reactions or not msg.reactions.results:
            return 0
        return sum(r.count for r in msg.reactions.results)

    async def _store_original_message(
        self,
        forward_id: int,
        msg: TelegramMessage
    ) -> None:
        """Store original message content."""
        async with AsyncSessionLocal() as session:
            try:
                # Extract author info
                author_user_id = None
                author_username = None
                if msg.from_id:
                    if isinstance(msg.from_id, PeerUser):
                        author_user_id = msg.from_id.user_id

                # Determine media type
                has_media = msg.media is not None
                media_type = None
                media_count = 0
                if msg.media:
                    media_type = msg.media.__class__.__name__.replace('MessageMedia', '').lower()
                    media_count = 1

                query = text("""
                    INSERT INTO original_messages (
                        message_forward_id, content, has_media, media_type, media_count,
                        author_user_id, author_username, original_date, edit_date,
                        views, forwards, has_comments, comments_count,
                        fetched_at, updated_at
                    )
                    VALUES (
                        :forward_id, :content, :has_media, :media_type, :media_count,
                        :author_user_id, :author_username, :original_date, :edit_date,
                        :views, :forwards, :has_comments, :comments_count,
                        NOW(), NOW()
                    )
                    ON CONFLICT (message_forward_id) DO UPDATE SET
                        content = EXCLUDED.content,
                        views = EXCLUDED.views,
                        forwards = EXCLUDED.forwards,
                        comments_count = EXCLUDED.comments_count,
                        updated_at = NOW()
                """)

                await session.execute(query, {
                    'forward_id': forward_id,
                    'content': msg.message,
                    'has_media': has_media,
                    'media_type': media_type,
                    'media_count': media_count,
                    'author_user_id': author_user_id,
                    'author_username': author_username,
                    'original_date': msg.date,
                    'edit_date': msg.edit_date,
                    'views': getattr(msg, 'views', None),
                    'forwards': getattr(msg, 'forwards', None),
                    'has_comments': bool(msg.replies and msg.replies.comments),
                    'comments_count': getattr(msg.replies, 'replies', 0) if msg.replies else 0,
                })

                await session.commit()

            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to store original message: {e}")

    async def _fetch_reactions(
        self,
        forward_id: int,
        entity,
        message_id: int
    ) -> None:
        """Fetch and store reactions for the original message."""
        try:
            result = await self.client(GetMessagesReactionsRequest(
                peer=entity,
                id=[message_id]
            ))

            if not result or not hasattr(result, 'updates'):
                return

            reactions_list = []
            for update in result.updates:
                if hasattr(update, 'reactions') and update.reactions:
                    for r in update.reactions.results:
                        reaction = r.reaction
                        emoji = None
                        custom_emoji_id = None

                        if isinstance(reaction, ReactionEmoji):
                            emoji = reaction.emoticon
                        elif isinstance(reaction, ReactionCustomEmoji):
                            emoji = f"custom:{reaction.document_id}"
                            custom_emoji_id = reaction.document_id
                        elif isinstance(reaction, ReactionPaid):
                            emoji = "⭐"
                        else:
                            continue

                        reactions_list.append({
                            'emoji': emoji,
                            'count': r.count,
                            'custom_emoji_id': custom_emoji_id,
                        })

            if reactions_list:
                await self._store_reactions(forward_id, reactions_list)

        except Exception as e:
            logger.warning(f"Failed to fetch reactions: {e}")

    async def _store_reactions(
        self,
        forward_id: int,
        reactions: List[Dict[str, Any]]
    ) -> None:
        """Store reactions for a forward."""
        async with AsyncSessionLocal() as session:
            try:
                # Delete existing reactions for this forward
                await session.execute(
                    text("DELETE FROM forward_reactions WHERE message_forward_id = :fid"),
                    {'fid': forward_id}
                )

                # Insert new reactions
                for r in reactions:
                    query = text("""
                        INSERT INTO forward_reactions (
                            message_forward_id, emoji, count, custom_emoji_id, fetched_at
                        )
                        VALUES (:forward_id, :emoji, :count, :custom_emoji_id, NOW())
                    """)
                    await session.execute(query, {
                        'forward_id': forward_id,
                        'emoji': r['emoji'],
                        'count': r['count'],
                        'custom_emoji_id': r['custom_emoji_id'],
                    })

                await session.commit()

            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to store reactions: {e}")

    async def _fetch_comments(
        self,
        forward_id: int,
        entity,
        msg: TelegramMessage
    ) -> None:
        """Fetch and store comments for the original message."""
        if not msg.replies or not msg.replies.comments:
            return

        try:
            # Get the discussion message
            result = await self.client(GetDiscussionMessageRequest(
                peer=entity,
                msg_id=msg.id
            ))

            if not result or not result.messages:
                return

            # The first message is the forwarded post in discussion
            discussion_msg = result.messages[0]
            discussion_chat_id = abs(discussion_msg.peer_id.channel_id)

            # Get discussion group entity
            discussion_group = await self.client.get_entity(discussion_msg.peer_id)

            # Fetch replies
            comments_saved = 0
            async for reply in self.client.iter_messages(
                discussion_group,
                reply_to=discussion_msg.id,
                limit=50,  # Limit for original messages
            ):
                if isinstance(reply, TelegramMessage):
                    saved = await self._save_comment(
                        forward_id=forward_id,
                        comment_msg=reply,
                        discussion_chat_id=discussion_chat_id
                    )
                    if saved:
                        comments_saved += 1

            if comments_saved > 0:
                logger.debug(f"Fetched {comments_saved} comments for forward {forward_id}")

        except ChannelPrivateError:
            logger.debug(f"Cannot access discussion for forward {forward_id}")
        except ChatAdminRequiredError:
            logger.debug(f"Admin required for discussion of forward {forward_id}")
        except Exception as e:
            logger.warning(f"Failed to fetch comments: {e}")

    async def _save_comment(
        self,
        forward_id: int,
        comment_msg: TelegramMessage,
        discussion_chat_id: int
    ) -> bool:
        """Save a comment to forward_comments."""
        async with AsyncSessionLocal() as session:
            try:
                # Extract author info
                author_user_id = None
                author_username = None
                author_first_name = None

                if comment_msg.from_id and isinstance(comment_msg.from_id, PeerUser):
                    author_user_id = comment_msg.from_id.user_id

                # Reply threading
                reply_to_comment_id = None
                if comment_msg.reply_to and comment_msg.reply_to.reply_to_msg_id:
                    reply_to_comment_id = comment_msg.reply_to.reply_to_msg_id

                query = text("""
                    INSERT INTO forward_comments (
                        message_forward_id, comment_id, discussion_chat_id,
                        author_user_id, author_username, author_first_name,
                        content, reply_to_comment_id, comment_date, fetched_at
                    )
                    VALUES (
                        :forward_id, :comment_id, :discussion_chat_id,
                        :author_user_id, :author_username, :author_first_name,
                        :content, :reply_to_comment_id, :comment_date, NOW()
                    )
                    ON CONFLICT DO NOTHING
                """)

                await session.execute(query, {
                    'forward_id': forward_id,
                    'comment_id': comment_msg.id,
                    'discussion_chat_id': discussion_chat_id,
                    'author_user_id': author_user_id,
                    'author_username': author_username,
                    'author_first_name': author_first_name,
                    'content': comment_msg.message,
                    'reply_to_comment_id': reply_to_comment_id,
                    'comment_date': comment_msg.date,
                })

                await session.commit()
                return True

            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to save comment: {e}")
                return False

    async def _mark_fetched(
        self,
        forward_id: int,
        views: Optional[int] = None,
        forwards: Optional[int] = None,
        reactions_count: Optional[int] = None,
        comments_count: Optional[int] = None,
        error: Optional[str] = None,
    ) -> None:
        """Mark forward as having social data fetched."""
        async with AsyncSessionLocal() as session:
            try:
                query = text("""
                    UPDATE message_forwards
                    SET social_data_fetched_at = NOW(),
                        original_views = COALESCE(:views, original_views),
                        original_forwards = COALESCE(:forwards, original_forwards),
                        original_reactions_count = COALESCE(:reactions_count, original_reactions_count),
                        original_comments_count = COALESCE(:comments_count, original_comments_count),
                        updated_at = NOW()
                    WHERE id = :forward_id
                """)

                await session.execute(query, {
                    'forward_id': forward_id,
                    'views': views,
                    'forwards': forwards,
                    'reactions_count': reactions_count,
                    'comments_count': comments_count,
                })

                await session.commit()

            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to mark forward as fetched: {e}")


# Module-level instance
forward_social_fetcher: Optional[ForwardSocialFetcher] = None


async def start_forward_social_fetcher(client: TelegramClient) -> ForwardSocialFetcher:
    """
    Create and start the forward social fetcher.

    Args:
        client: Authenticated Telethon client

    Returns:
        Running ForwardSocialFetcher instance
    """
    global forward_social_fetcher
    forward_social_fetcher = ForwardSocialFetcher(client)
    await forward_social_fetcher.start()
    return forward_social_fetcher


async def stop_forward_social_fetcher() -> None:
    """Stop the forward social fetcher if running."""
    global forward_social_fetcher
    if forward_social_fetcher:
        await forward_social_fetcher.stop()
        forward_social_fetcher = None
