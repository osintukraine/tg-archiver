"""
Social Data Fetcher - Fetch comments and reactions from Telegram.

Background service that periodically fetches:
1. Comments from discussion groups (for messages with has_comments=True)
2. Reactions for recent messages (emoji counts)

Uses Telegram API methods:
- messages.getDiscussionMessage - Fetch comment thread
- messages.getMessagesReactions - Fetch reaction data

Configuration (from settings):
- SOCIAL_FETCH_ENABLED: Enable/disable social fetching
- SOCIAL_FETCH_PERIOD_DAYS: Fetch data for messages from last N days
- SOCIAL_FETCH_INTERVAL_SECONDS: Interval between fetch cycles
- SOCIAL_FETCH_BATCH_SIZE: Messages per fetch cycle
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
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
    Updates,
    UpdateMessageReactions,
)

from config.settings import settings
from models.base import AsyncSessionLocal
from .social_graph_utils import extract_reactions, upsert_reactions

logger = logging.getLogger(__name__)


class SocialFetcher:
    """
    Background service for fetching social data from Telegram.

    Handles:
    - Comment fetching from discussion groups
    - Reaction polling for recent messages
    - Rate limiting and error handling
    """

    def __init__(self, client: TelegramClient):
        """
        Initialize social fetcher.

        Args:
            client: Authenticated Telethon client
        """
        self.client = client
        self.running = False
        self._fetch_task: Optional[asyncio.Task] = None

    async def start(self) -> None:
        """Start the background fetch loop."""
        if not settings.SOCIAL_FETCH_ENABLED:
            logger.info("Social fetching disabled (SOCIAL_FETCH_ENABLED=false)")
            return

        self.running = True
        self._fetch_task = asyncio.create_task(self._fetch_loop())
        logger.info(
            f"Social fetcher started (period={settings.SOCIAL_FETCH_PERIOD_DAYS}d, "
            f"interval={settings.SOCIAL_FETCH_INTERVAL_SECONDS}s)"
        )

    async def stop(self) -> None:
        """Stop the background fetch loop."""
        self.running = False
        if self._fetch_task:
            self._fetch_task.cancel()
            try:
                await self._fetch_task
            except asyncio.CancelledError:
                pass
        logger.info("Social fetcher stopped")

    async def _fetch_loop(self) -> None:
        """Main fetch loop - runs periodically."""
        while self.running:
            try:
                await self._fetch_cycle()
            except Exception as e:
                logger.error(f"Social fetch cycle failed: {e}", exc_info=True)

            # Wait for next cycle
            await asyncio.sleep(settings.SOCIAL_FETCH_INTERVAL_SECONDS)

    async def _fetch_cycle(self) -> None:
        """
        Single fetch cycle - process batch of messages.

        1. Get messages needing comment fetch
        2. Get messages needing reaction update
        3. Process each batch
        """
        logger.debug("Starting social fetch cycle")

        # Fetch comments for messages that have them but haven't been fetched
        comments_fetched = await self._fetch_comments_batch()

        # Update reactions for recent messages
        reactions_updated = await self._update_reactions_batch()

        logger.info(
            f"Social fetch cycle complete: "
            f"{comments_fetched} comments fetched, "
            f"{reactions_updated} reactions updated"
        )

    async def _get_messages_needing_comments(self) -> List[Dict[str, Any]]:
        """
        Get messages that have comments but haven't been fetched yet.

        Returns messages where:
        - has_comments = True
        - comments_fetched_at IS NULL
        - telegram_date within SOCIAL_FETCH_PERIOD_DAYS
        """
        cutoff_date = datetime.now(timezone.utc) - timedelta(
            days=settings.SOCIAL_FETCH_PERIOD_DAYS
        )

        async with AsyncSessionLocal() as session:
            query = text("""
                SELECT
                    m.id,
                    m.message_id,
                    m.channel_id,
                    m.linked_chat_id,
                    c.telegram_id as channel_telegram_id
                FROM messages m
                JOIN channels c ON c.id = m.channel_id
                WHERE m.has_comments = true
                  AND m.comments_fetched_at IS NULL
                  AND m.linked_chat_id IS NOT NULL
                  AND m.telegram_date >= :cutoff_date
                ORDER BY m.telegram_date DESC
                LIMIT :batch_size
            """)

            result = await session.execute(query, {
                'cutoff_date': cutoff_date,
                'batch_size': settings.SOCIAL_FETCH_BATCH_SIZE,
            })

            return [dict(row._mapping) for row in result]

    async def _get_messages_needing_reactions(self) -> List[Dict[str, Any]]:
        """
        Get messages that need reaction updates.

        Returns messages where:
        - telegram_date within SOCIAL_FETCH_PERIOD_DAYS
        - Either no reactions fetched yet, or last update > poll interval
        """
        cutoff_date = datetime.now(timezone.utc) - timedelta(
            days=settings.SOCIAL_FETCH_PERIOD_DAYS
        )
        stale_threshold = datetime.now(timezone.utc) - timedelta(
            seconds=settings.SOCIAL_REACTION_POLL_INTERVAL * 10  # Poll older messages less frequently
        )

        async with AsyncSessionLocal() as session:
            query = text("""
                SELECT
                    m.id,
                    m.message_id,
                    m.channel_id,
                    c.telegram_id as channel_telegram_id
                FROM messages m
                JOIN channels c ON c.id = m.channel_id
                LEFT JOIN (
                    SELECT message_id, MAX(last_updated) as last_reaction_update
                    FROM message_reactions
                    GROUP BY message_id
                ) r ON r.message_id = m.id
                WHERE m.telegram_date >= :cutoff_date
                  AND (r.last_reaction_update IS NULL OR r.last_reaction_update < :stale_threshold)
                ORDER BY m.telegram_date DESC
                LIMIT :batch_size
            """)

            result = await session.execute(query, {
                'cutoff_date': cutoff_date,
                'stale_threshold': stale_threshold,
                'batch_size': settings.SOCIAL_FETCH_BATCH_SIZE,
            })

            return [dict(row._mapping) for row in result]

    async def _fetch_comments_batch(self) -> int:
        """
        Fetch comments for a batch of messages.

        Returns:
            Number of messages processed
        """
        messages = await self._get_messages_needing_comments()
        if not messages:
            return 0

        processed = 0
        for msg in messages:
            try:
                await self._fetch_comments_for_message(msg)
                processed += 1
            except FloodWaitError as e:
                logger.warning(f"FloodWait: sleeping {e.seconds}s")
                await asyncio.sleep(e.seconds)
            except Exception as e:
                logger.warning(
                    f"Failed to fetch comments for message {msg['id']}: {e}"
                )

            # Small delay between requests to avoid rate limits
            await asyncio.sleep(0.5)

        return processed

    async def _fetch_comments_for_message(self, msg: Dict[str, Any]) -> None:
        """
        Fetch comments for a single message using GetDiscussionMessage.

        The process is:
        1. Call GetDiscussionMessageRequest on the CHANNEL with the message ID
        2. Get the discussion_msg_id from the result (auto-forwarded message in discussion group)
        3. Fetch replies to THAT message using iter_messages with reply_to

        Args:
            msg: Message dict with id, message_id, channel_telegram_id, linked_chat_id
        """
        try:
            # Convert relative linked_chat_id to full Telegram format
            # e.g., 1660451607 -> -1001660451607
            full_chat_id = -1000000000000 - msg['linked_chat_id']

            # First: Get the discussion message (the auto-forwarded copy in the discussion group)
            # This gives us the correct message ID to look for replies
            # NOTE: peer must be the CHANNEL, not the discussion group!
            result = await self.client(GetDiscussionMessageRequest(
                peer=PeerChannel(msg['channel_telegram_id']),
                msg_id=msg['message_id']
            ))

            if not result or not result.messages:
                logger.debug(f"No discussion thread for message {msg['id']}")
                await self._mark_comments_fetched(msg['id'])
                return

            # The first message in the result is the forwarded post in the discussion group
            discussion_msg = result.messages[0]
            discussion_msg_id = discussion_msg.id

            logger.debug(
                f"Fetching comments for msg {msg['id']} "
                f"(channel_msg={msg['message_id']}, discussion_msg={discussion_msg_id}) "
                f"from group {full_chat_id}"
            )

            # Get the discussion group entity
            discussion_group = await self.client.get_entity(full_chat_id)

            # Fetch replies to the discussion message (not the channel message!)
            comments_saved = 0
            async for reply in self.client.iter_messages(
                discussion_group,
                reply_to=discussion_msg_id,
                limit=100,  # Limit per message
            ):
                if isinstance(reply, TelegramMessage):
                    saved = await self._save_comment(
                        parent_db_id=msg['id'],
                        comment_msg=reply,
                        discussion_chat_id=msg['linked_chat_id']
                    )
                    if saved:
                        comments_saved += 1

            # Mark message as fetched
            await self._mark_comments_fetched(msg['id'])

            if comments_saved > 0:
                logger.info(
                    f"Fetched {comments_saved} comments for message {msg['id']}"
                )

        except ChannelPrivateError:
            logger.warning(
                f"Cannot access discussion group {msg['linked_chat_id']} (private)"
            )
            await self._mark_comments_fetched(msg['id'])  # Don't retry
        except MsgIdInvalidError:
            logger.warning(
                f"Message {msg['message_id']} not found in discussion group"
            )
            await self._mark_comments_fetched(msg['id'])  # Don't retry
        except ChatAdminRequiredError:
            logger.warning(
                f"Admin rights required for discussion group {msg['linked_chat_id']}"
            )
            await self._mark_comments_fetched(msg['id'])  # Don't retry

    async def _save_comment(
        self,
        parent_db_id: int,
        comment_msg: TelegramMessage,
        discussion_chat_id: int
    ) -> bool:
        """
        Save a comment to the database.

        Args:
            parent_db_id: Database ID of parent message
            comment_msg: Telethon Message object for the comment
            discussion_chat_id: Telegram ID of discussion group

        Returns:
            True if saved successfully
        """
        async with AsyncSessionLocal() as session:
            try:
                # Extract author info
                author_user_id = None
                if comment_msg.from_id:
                    from telethon.tl.types import PeerUser
                    if isinstance(comment_msg.from_id, PeerUser):
                        author_user_id = comment_msg.from_id.user_id

                # Reply threading
                reply_to_comment_id = None
                if comment_msg.reply_to and comment_msg.reply_to.reply_to_msg_id:
                    reply_to_comment_id = comment_msg.reply_to.reply_to_msg_id

                query = text("""
                    INSERT INTO message_comments (
                        parent_message_id, comment_message_id, discussion_chat_id,
                        author_user_id, content, reply_to_comment_id, comment_date,
                        created_at, updated_at
                    )
                    VALUES (
                        :parent_message_id, :comment_message_id, :discussion_chat_id,
                        :author_user_id, :content, :reply_to_comment_id, :comment_date,
                        NOW(), NOW()
                    )
                    ON CONFLICT (discussion_chat_id, comment_message_id) DO UPDATE SET
                        content = EXCLUDED.content,
                        updated_at = NOW()
                """)

                await session.execute(query, {
                    'parent_message_id': parent_db_id,
                    'comment_message_id': comment_msg.id,
                    'discussion_chat_id': discussion_chat_id,
                    'author_user_id': author_user_id,
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

    async def _mark_comments_fetched(self, db_message_id: int) -> None:
        """Mark a message as having its comments fetched."""
        async with AsyncSessionLocal() as session:
            try:
                query = text("""
                    UPDATE messages
                    SET comments_fetched_at = NOW()
                    WHERE id = :message_id
                """)
                await session.execute(query, {'message_id': db_message_id})
                await session.commit()
            except Exception as e:
                await session.rollback()
                logger.error(f"Failed to mark comments fetched: {e}")

    async def _update_reactions_batch(self) -> int:
        """
        Update reactions for a batch of messages.

        Returns:
            Number of messages processed
        """
        messages = await self._get_messages_needing_reactions()
        if not messages:
            return 0

        # Group messages by channel for batch API calls
        by_channel: Dict[int, List[Dict]] = {}
        for msg in messages:
            channel_id = msg['channel_telegram_id']
            if channel_id not in by_channel:
                by_channel[channel_id] = []
            by_channel[channel_id].append(msg)

        processed = 0
        for channel_telegram_id, channel_msgs in by_channel.items():
            try:
                count = await self._fetch_reactions_for_channel(
                    channel_telegram_id, channel_msgs
                )
                processed += count
            except FloodWaitError as e:
                logger.warning(f"FloodWait: sleeping {e.seconds}s")
                await asyncio.sleep(e.seconds)
            except Exception as e:
                logger.warning(
                    f"Failed to fetch reactions for channel {channel_telegram_id}: {e}"
                )

            # Small delay between channels
            await asyncio.sleep(0.5)

        return processed

    async def _fetch_reactions_for_channel(
        self,
        channel_telegram_id: int,
        messages: List[Dict[str, Any]]
    ) -> int:
        """
        Fetch reactions for multiple messages in a channel.

        Args:
            channel_telegram_id: Telegram channel ID
            messages: List of message dicts

        Returns:
            Number of messages with reactions updated
        """
        try:
            # Get channel entity
            channel_peer = await self.client.get_input_entity(
                PeerChannel(channel_telegram_id)
            )

            # Get message IDs (Telegram message_id, not DB id)
            msg_ids = [msg['message_id'] for msg in messages]

            # Fetch reactions for all messages in one call
            result = await self.client(GetMessagesReactionsRequest(
                peer=channel_peer,
                id=msg_ids
            ))

            # Process updates
            if not result:
                return 0

            # Map telegram message_id to db_id
            id_map = {msg['message_id']: msg['id'] for msg in messages}

            updated = 0
            if hasattr(result, 'updates'):
                for update in result.updates:
                    if isinstance(update, UpdateMessageReactions):
                        db_id = id_map.get(update.msg_id)
                        if db_id and update.reactions:
                            # Extract and save reactions
                            reactions = self._extract_reactions_from_update(update)
                            if reactions:
                                await upsert_reactions(db_id, reactions)
                                updated += 1

            return updated

        except ChannelPrivateError:
            logger.warning(f"Cannot access channel {channel_telegram_id} (private)")
            return 0

    def _extract_reactions_from_update(
        self,
        update: UpdateMessageReactions
    ) -> List[Dict[str, Any]]:
        """
        Extract reaction data from UpdateMessageReactions.

        Args:
            update: Telethon UpdateMessageReactions object

        Returns:
            List of reaction dictionaries
        """
        from telethon.tl.types import (
            ReactionEmoji,
            ReactionCustomEmoji,
            ReactionPaid,
        )

        reactions_list = []

        if not update.reactions or not update.reactions.results:
            return reactions_list

        for reaction_count in update.reactions.results:
            reaction_data = {
                'emoji': None,
                'count': reaction_count.count,
                'custom_emoji_id': None,
            }

            reaction = reaction_count.reaction

            if isinstance(reaction, ReactionEmoji):
                reaction_data['emoji'] = reaction.emoticon
            elif isinstance(reaction, ReactionCustomEmoji):
                reaction_data['emoji'] = f"custom:{reaction.document_id}"
                reaction_data['custom_emoji_id'] = reaction.document_id
            elif isinstance(reaction, ReactionPaid):
                reaction_data['emoji'] = "⭐"
            else:
                continue

            reactions_list.append(reaction_data)

        return reactions_list


# Module-level instance for easy import
social_fetcher: Optional[SocialFetcher] = None


async def start_social_fetcher(client: TelegramClient) -> SocialFetcher:
    """
    Create and start the social fetcher.

    Args:
        client: Authenticated Telethon client

    Returns:
        Running SocialFetcher instance
    """
    global social_fetcher
    social_fetcher = SocialFetcher(client)
    await social_fetcher.start()
    return social_fetcher


async def stop_social_fetcher() -> None:
    """Stop the social fetcher if running."""
    global social_fetcher
    if social_fetcher:
        await social_fetcher.stop()
        social_fetcher = None
