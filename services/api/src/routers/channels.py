"""
Channels Router

Provides endpoints for channel information and statistics.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from ..utils.sql_safety import escape_ilike_pattern
from models.channel import Channel
from models.message import Message

from ..database import get_db
from ..schemas import BackfillRequest, BackfillResponse, ChannelDetail, ChannelList, ChannelStats

router = APIRouter(prefix="/api/channels", tags=["channels"])


@router.get("/", response_model=list[ChannelList])
async def list_channels(
    active_only: bool = Query(default=True, description="Show only active channels"),
    rule: Optional[str] = Query(None, description="Filter by processing rule"),
    folder: Optional[str] = Query(None, description="Filter by folder name"),
    verified_only: bool = Query(default=False, description="Show only verified channels"),
    limit: int = Query(default=100, ge=1, le=500, description="Maximum channels to return"),
    db: AsyncSession = Depends(get_db),
):
    """
    List channels with optional filters.

    Returns summary information for all matching channels.

    Filters:
    - active_only: Only show active channels (default: true)
    - rule: Filter by processing rule (archive_all, selective_archive, test, staging)
    - folder: Filter by Telegram folder name
    - verified_only: Only show verified channels
    """
    query = select(Channel)

    # Apply filters
    if active_only:
        query = query.where(Channel.active == True)

    if rule:
        query = query.where(Channel.rule == rule)

    if folder:
        # SECURITY: Escape ILIKE wildcards to prevent pattern injection
        folder_escaped = escape_ilike_pattern(folder)
        query = query.where(Channel.folder.ilike(f"%{folder_escaped}%"))

    if verified_only:
        query = query.where(Channel.verified == True)

    # Order by last message (most recent first)
    query = query.order_by(desc(Channel.last_message_at)).limit(limit)

    result = await db.execute(query)
    channels = result.scalars().all()

    return [ChannelList.model_validate(ch) for ch in channels]


@router.get("/{channel_id}", response_model=ChannelDetail)
async def get_channel(channel_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get detailed information about a specific channel.

    Args:
        channel_id: Channel ID (Telegram channel ID or database ID)
        db: Database session

    Returns:
        ChannelDetail with full channel data

    Raises:
        HTTPException 404: Channel not found
    """
    # Try to find by database ID first, then by Telegram ID
    result = await db.execute(
        select(Channel).where(
            or_(Channel.id == channel_id, Channel.telegram_id == channel_id)
        )
    )
    channel = result.scalar_one_or_none()

    if not channel:
        raise HTTPException(status_code=404, detail=f"Channel {channel_id} not found")

    return channel


@router.get("/{channel_id}/stats", response_model=ChannelStats)
async def get_channel_stats(channel_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get statistics for a specific channel.

    Provides:
    - Total messages, spam count, archived count
    - Average OSINT score
    - Message distribution by topic
    - First and last message timestamps

    Args:
        channel_id: Channel ID (Telegram channel ID)
        db: Database session

    Returns:
        ChannelStats with aggregated statistics

    Raises:
        HTTPException 404: Channel not found
    """
    # Verify channel exists - try both database ID and telegram_id
    channel_result = await db.execute(
        select(Channel).where(
            or_(Channel.id == channel_id, Channel.telegram_id == channel_id)
        )
    )
    channel = channel_result.scalar_one_or_none()

    if not channel:
        raise HTTPException(status_code=404, detail=f"Channel {channel_id} not found")

    # Use the database ID for message queries (Message.channel_id is FK to channels.id)
    db_channel_id = channel.id

    # Count total messages
    total_result = await db.execute(
        select(func.count(Message.id)).where(Message.channel_id == db_channel_id)
    )
    total_messages = total_result.scalar_one()

    # Count spam messages
    spam_result = await db.execute(
        select(func.count(Message.id)).where(
            Message.channel_id == db_channel_id, Message.is_spam == True
        )
    )
    spam_messages = spam_result.scalar_one()

    # Count archived (non-spam) messages
    archived_messages = total_messages - spam_messages

    # High importance message count (non-spam only)
    high_importance_result = await db.execute(
        select(func.count(Message.id)).where(
            Message.channel_id == db_channel_id,
            Message.is_spam == False,
            Message.importance_level == 'high',
        )
    )
    high_importance_count = high_importance_result.scalar_one()

    # Messages by topic (non-spam only)
    topic_result = await db.execute(
        select(Message.osint_topic, func.count(Message.id))
        .where(
            Message.channel_id == db_channel_id,
            Message.is_spam == False,
            Message.osint_topic.isnot(None),
        )
        .group_by(Message.osint_topic)
    )
    messages_by_topic = {topic: count for topic, count in topic_result.all()}

    # First and last message timestamps
    first_msg_result = await db.execute(
        select(Message.created_at)
        .where(Message.channel_id == db_channel_id)
        .order_by(Message.created_at)
        .limit(1)
    )
    first_message_at = first_msg_result.scalar_one_or_none()

    last_msg_result = await db.execute(
        select(Message.created_at)
        .where(Message.channel_id == db_channel_id)
        .order_by(desc(Message.created_at))
        .limit(1)
    )
    last_message_at = last_msg_result.scalar_one_or_none()

    return ChannelStats(
        total_messages=total_messages,
        spam_messages=spam_messages,
        archived_messages=archived_messages,
        high_importance_count=high_importance_count or 0,
        messages_by_topic=messages_by_topic,
        first_message_at=first_message_at,
        last_message_at=last_message_at,
    )


@router.post("/{channel_id}/backfill", response_model=BackfillResponse)
async def trigger_backfill(
    channel_id: int,
    request: BackfillRequest = Body(default=None),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger manual historical backfill for a channel.

    This endpoint queues a backfill request by setting the channel's backfill_status
    to "pending". The listener service will pick up the request and start fetching
    historical messages from Telegram.

    **Backfill Configuration:**
    - `BACKFILL_ENABLED` must be set to `true` in .env
    - `BACKFILL_MODE` should be set to `manual` for API-triggered backfill
    - Historical messages will be fetched from `from_date` (or BACKFILL_START_DATE if not provided)

    **Request Body:**
    ```json
    {
        "from_date": "2024-01-01T00:00:00Z"  // Optional: defaults to BACKFILL_START_DATE
    }
    ```

    **Important Notes:**
    - Backfilling large channels can take hours and may trigger Telegram FloodWait errors
    - Check channel.backfill_status and backfill_messages_fetched for progress
    - Use GET /api/channels/{channel_id} to check current backfill status

    Args:
        channel_id: Channel ID (Telegram channel ID or database ID)
        request: Optional backfill parameters (from_date)
        db: Database session

    Returns:
        BackfillResponse with queued status

    Raises:
        HTTPException 404: Channel not found
        HTTPException 400: Backfill disabled or already in progress
    """
    # Check if backfill is enabled
    if not settings.BACKFILL_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="Backfill is disabled. Set BACKFILL_ENABLED=true in .env to enable.",
        )

    # Find channel by database ID or Telegram ID
    result = await db.execute(
        select(Channel).where(
            or_(Channel.id == channel_id, Channel.telegram_id == channel_id)
        )
    )
    channel = result.scalar_one_or_none()

    if not channel:
        raise HTTPException(status_code=404, detail=f"Channel {channel_id} not found")

    # Check if backfill is already in progress
    if channel.backfill_status in ("in_progress", "pending"):
        return BackfillResponse(
            channel_id=channel.id,
            channel_name=channel.name or f"Channel {channel.telegram_id}",
            status=channel.backfill_status,
            messages_fetched=channel.backfill_messages_fetched or 0,
            completed=False,
            error=f"Backfill already {channel.backfill_status}",
        )

    # Set backfill parameters
    from_date = None
    if request and request.from_date:
        from_date = request.from_date
    else:
        # Use configured start date from .env
        from_date = settings.get_backfill_start_date()

    # Queue backfill by setting status to "pending"
    channel.backfill_status = "pending"
    # Strip timezone since database column is TIMESTAMP WITHOUT TIME ZONE
    channel.backfill_from_date = from_date.replace(tzinfo=None) if from_date else None
    channel.backfill_messages_fetched = 0

    await db.commit()
    await db.refresh(channel)

    return BackfillResponse(
        channel_id=channel.id,
        channel_name=channel.name or f"Channel {channel.telegram_id}",
        status="pending",
        messages_fetched=0,
        completed=False,
        error=None,
    )
