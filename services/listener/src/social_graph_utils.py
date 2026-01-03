"""
Social Graph Utilities - Extract and Store Social Metadata

Extracts social graph metadata from Telegram messages for network analysis.
Handles user profiles, forwards, replies, and discussion metadata.

Key Functions:
1. extract_social_metadata() - Extract all social graph data from Telethon Message
2. upsert_telegram_user() - Insert or update user profile in database

Social Graph Patterns Captured:
- Author attribution (who sent the message)
- Forward chains (where content originated)
- Reply threads (conversation structure)
- Discussion groups (linked chat interactions)

Telethon Message Properties Used:
- message.from_id: Author of the message (User or Channel)
- message.fwd_from: Forward metadata (original author, date, channel)
- message.reply_to: Reply metadata (parent message ID)
- message.replies: Discussion/comments metadata
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert
from telethon.tl.types import (
    Message as TelegramMessage,
    MessageFwdHeader,
    MessageReplyHeader,
    MessageReplies,
    PeerChannel,
    PeerUser,
)

from models.base import AsyncSessionLocal

logger = logging.getLogger(__name__)


async def extract_social_metadata(message: TelegramMessage) -> Dict[str, Any]:
    """
    Extract social graph metadata from Telethon Message object.

    Args:
        message: Telethon Message object

    Returns:
        Dictionary with social graph fields:
        {
            'author_user_id': Optional[int],
            'replied_to_message_id': Optional[int],
            'forward_from_channel_id': Optional[int],
            'forward_from_message_id': Optional[int],
            'forward_date': Optional[datetime],
            'has_comments': bool,
            'comments_count': int,
            'linked_chat_id': Optional[int],
        }
    """
    metadata = {
        'author_user_id': None,
        'replied_to_message_id': None,
        'forward_from_channel_id': None,
        'forward_from_message_id': None,
        'forward_date': None,
        'has_comments': False,
        'comments_count': 0,
        'linked_chat_id': None,
    }

    # Extract author information
    if message.from_id:
        if isinstance(message.from_id, PeerUser):
            metadata['author_user_id'] = message.from_id.user_id
            logger.debug(f"Message {message.id} authored by user {message.from_id.user_id}")
        elif isinstance(message.from_id, PeerChannel):
            # Channel sent the message (common for channel posts)
            # We store channel_id in messages.channel_id already
            logger.debug(f"Message {message.id} authored by channel {message.from_id.channel_id}")
        # Note: There's also PeerChat but that's for groups, not channels

    # Extract forward metadata
    if message.fwd_from:
        fwd: MessageFwdHeader = message.fwd_from

        # Original channel/user who posted the message
        if fwd.from_id:
            if isinstance(fwd.from_id, PeerChannel):
                metadata['forward_from_channel_id'] = fwd.from_id.channel_id
                logger.debug(
                    f"Message {message.id} forwarded from channel {fwd.from_id.channel_id}"
                )
            elif isinstance(fwd.from_id, PeerUser):
                # Forwarded from user (store as author_user_id if not already set)
                # This is rare - usually forwards come from channels
                logger.debug(f"Message {message.id} forwarded from user {fwd.from_id.user_id}")

        # Original message ID (if forwarded from channel)
        if fwd.channel_post:
            metadata['forward_from_message_id'] = fwd.channel_post
            logger.debug(
                f"Message {message.id} forwarded from message {fwd.channel_post}"
            )

        # Original post timestamp
        if fwd.date:
            # Ensure timezone-aware datetime
            if fwd.date.tzinfo is None:
                metadata['forward_date'] = fwd.date.replace(tzinfo=timezone.utc)
            else:
                metadata['forward_date'] = fwd.date
            logger.debug(
                f"Message {message.id} original post date: {metadata['forward_date']}"
            )

    # Extract reply metadata
    if message.reply_to:
        reply: MessageReplyHeader = message.reply_to

        # Parent message ID (message being replied to)
        if reply.reply_to_msg_id:
            metadata['replied_to_message_id'] = reply.reply_to_msg_id
            logger.debug(
                f"Message {message.id} replies to message {reply.reply_to_msg_id}"
            )

    # Extract comments/discussion metadata
    if message.replies:
        replies: MessageReplies = message.replies

        # Has discussion group enabled?
        if replies.comments:
            metadata['has_comments'] = True
            logger.debug(f"Message {message.id} has discussion group enabled")

        # Number of comments/replies
        if replies.replies:
            metadata['comments_count'] = replies.replies
            logger.debug(
                f"Message {message.id} has {replies.replies} comments"
            )

        # Discussion group channel ID
        if replies.channel_id:
            metadata['linked_chat_id'] = replies.channel_id
            logger.debug(
                f"Message {message.id} linked to discussion group {replies.channel_id}"
            )

    return metadata


async def upsert_telegram_user(
    telegram_id: int,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    username: Optional[str] = None,
    phone: Optional[str] = None,
    is_bot: bool = False,
    is_verified: bool = False,
    is_scam: bool = False,
    is_fake: bool = False,
    is_premium: bool = False,
    has_photo: bool = False,
    has_username: bool = False,
) -> None:
    """
    Insert or update Telegram user profile in database.

    Uses PostgreSQL's ON CONFLICT DO UPDATE to upsert user data.
    Updates: last_seen timestamp, interaction_count, profile fields.

    Args:
        telegram_id: Telegram user ID (unique identifier)
        first_name: User's first name
        last_name: User's last name
        username: Telegram username (without @)
        phone: Phone number (rarely available)
        is_bot: Whether user is a bot
        is_verified: Telegram verified badge
        is_scam: Flagged as scam by Telegram
        is_fake: Flagged as fake by Telegram
        is_premium: Has Telegram Premium
        has_photo: User has profile photo
        has_username: User has public username
    """
    async with AsyncSessionLocal() as session:
        try:
            # Use raw SQL for upsert to avoid importing telegram_users model
            # (keeps listener service lightweight)
            query = text("""
                INSERT INTO telegram_users (
                    telegram_id, first_name, last_name, username, phone,
                    is_bot, is_verified, is_scam, is_fake, is_premium,
                    has_photo, has_username,
                    first_seen, last_seen, interaction_count
                )
                VALUES (
                    :telegram_id, :first_name, :last_name, :username, :phone,
                    :is_bot, :is_verified, :is_scam, :is_fake, :is_premium,
                    :has_photo, :has_username,
                    NOW(), NOW(), 1
                )
                ON CONFLICT (telegram_id) DO UPDATE SET
                    first_name = COALESCE(EXCLUDED.first_name, telegram_users.first_name),
                    last_name = COALESCE(EXCLUDED.last_name, telegram_users.last_name),
                    username = COALESCE(EXCLUDED.username, telegram_users.username),
                    phone = COALESCE(EXCLUDED.phone, telegram_users.phone),
                    is_bot = EXCLUDED.is_bot,
                    is_verified = EXCLUDED.is_verified,
                    is_scam = EXCLUDED.is_scam,
                    is_fake = EXCLUDED.is_fake,
                    is_premium = EXCLUDED.is_premium,
                    has_photo = EXCLUDED.has_photo,
                    has_username = EXCLUDED.has_username,
                    last_seen = NOW(),
                    interaction_count = telegram_users.interaction_count + 1,
                    updated_at = NOW()
            """)

            params = {
                'telegram_id': telegram_id,
                'first_name': first_name,
                'last_name': last_name,
                'username': username,
                'phone': phone,
                'is_bot': is_bot,
                'is_verified': is_verified,
                'is_scam': is_scam,
                'is_fake': is_fake,
                'is_premium': is_premium,
                'has_photo': has_photo,
                'has_username': has_username,
            }

            await session.execute(query, params)
            await session.commit()

            logger.debug(
                f"Upserted telegram_user {telegram_id} "
                f"(username={username}, name={first_name} {last_name})"
            )

        except Exception as e:
            await session.rollback()
            logger.error(
                f"Failed to upsert telegram_user {telegram_id}: {e}",
                exc_info=True
            )
            # Don't raise - social graph metadata is nice-to-have, not critical


async def fetch_and_upsert_user_from_telegram(
    client,
    telegram_user_id: int
) -> None:
    """
    Fetch user profile from Telegram API and upsert to database.

    Args:
        client: Telethon TelegramClient instance
        telegram_user_id: Telegram user ID to fetch

    Note:
        This makes an API call to Telegram. Use sparingly to avoid rate limits.
        Only call when you need fresh user data (e.g., first encounter).
    """
    try:
        # Get full user entity from Telegram
        user = await client.get_entity(telegram_user_id)

        # Extract user metadata
        await upsert_telegram_user(
            telegram_id=user.id,
            first_name=getattr(user, 'first_name', None),
            last_name=getattr(user, 'last_name', None),
            username=getattr(user, 'username', None),
            phone=getattr(user, 'phone', None),
            is_bot=getattr(user, 'bot', False),
            is_verified=getattr(user, 'verified', False),
            is_scam=getattr(user, 'scam', False),
            is_fake=getattr(user, 'fake', False),
            is_premium=getattr(user, 'premium', False),
            has_photo=hasattr(user, 'photo') and user.photo is not None,
            has_username=bool(getattr(user, 'username', None)),
        )

        logger.info(
            f"Fetched and upserted user {telegram_user_id} "
            f"(username={getattr(user, 'username', 'N/A')})"
        )

    except Exception as e:
        logger.warning(
            f"Failed to fetch user {telegram_user_id} from Telegram: {e}",
            exc_info=False  # Don't spam logs with full traces
        )
        # Still upsert with just the ID so we track the interaction
        await upsert_telegram_user(
            telegram_id=telegram_user_id,
        )
