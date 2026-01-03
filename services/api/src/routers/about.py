"""
About Page API

Public stats endpoint for the About page.
Returns platform statistics without requiring authentication.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import List, Literal, Optional

from ..database import get_db
from ..utils.formatting import format_bytes

router = APIRouter(prefix="/api/about", tags=["about"])


class AboutStats(BaseModel):
    """Platform statistics for the About page."""
    channels: int
    messages: int
    messages_formatted: str
    media_size_bytes: int
    media_size_formatted: str
    timestamp: str


def format_number(num: int) -> str:
    """Format large numbers with K/M suffix."""
    if num >= 1_000_000:
        return f"{num / 1_000_000:.1f}M"
    elif num >= 1_000:
        return f"{num / 1_000:.1f}K"
    return str(num)


@router.get("/stats", response_model=AboutStats)
async def get_about_stats(db: AsyncSession = Depends(get_db)) -> AboutStats:
    """
    Get platform statistics for the About page.

    Returns:
        - channels: Active monitored channels
        - messages: Total archived messages
        - media_size: Total media storage size

    All stats are pulled fresh from the database.
    """
    # Single efficient query combining all counts
    result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM channels WHERE active = true) as channels,
            (SELECT COUNT(*) FROM messages) as messages,
            (SELECT COALESCE(SUM(file_size), 0) FROM media_files) as media_size
    """))
    row = result.fetchone()

    return AboutStats(
        channels=row.channels or 0,
        messages=row.messages or 0,
        messages_formatted=format_number(row.messages or 0),
        media_size_bytes=row.media_size or 0,
        media_size_formatted=format_bytes(row.media_size or 0),
        timestamp=datetime.utcnow().isoformat(),
    )


# =============================================================================
# Activity Endpoint Models
# =============================================================================

class PulseData(BaseModel):
    """Real-time platform pulse metrics."""
    messages_last_hour: int
    messages_today: int
    channels_active_24h: int
    status: Literal["active", "slow", "idle"]


class VolumeBucket(BaseModel):
    """Single time bucket for volume chart."""
    timestamp: str
    count: int


class VolumeData(BaseModel):
    """Message volume over time."""
    granularity: Literal["hour", "day"]
    timeframe: Literal["24h", "7d", "30d"]
    buckets: List[VolumeBucket]
    peak: Optional[VolumeBucket]
    average: float
    total: int


class TopicItem(BaseModel):
    """Single topic in distribution."""
    topic: str
    count: int
    percent: float


class TopicsData(BaseModel):
    """Topic distribution data."""
    timeframe: Literal["24h", "7d"]
    items: List[TopicItem]
    total: int


class ChannelActivityItem(BaseModel):
    """Single channel in activity list."""
    id: int
    name: str
    username: Optional[str]
    count: int


class ChannelsData(BaseModel):
    """Most active channels data."""
    timeframe: Literal["24h"]
    items: List[ChannelActivityItem]
    total_active: int


class ActivityResponse(BaseModel):
    """Full activity response for the About page."""
    pulse: PulseData
    volume: VolumeData
    topics: TopicsData
    channels: ChannelsData
    timestamp: str


@router.get("/activity", response_model=ActivityResponse)
async def get_activity(
    volume_timeframe: Literal["24h", "7d", "30d"] = Query(default="24h"),
    topics_timeframe: Literal["24h", "7d"] = Query(default="24h"),
    db: AsyncSession = Depends(get_db),
) -> ActivityResponse:
    """
    Get platform activity data for the About page.

    Returns:
        - pulse: Real-time metrics (messages/hour, today, active channels)
        - volume: Message volume over time (hourly or daily buckets)
        - topics: Topic distribution
        - channels: Most active channels

    All data is public and does not require authentication.
    """
    now = datetime.utcnow()
    hour_ago = now - timedelta(hours=1)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_ago = now - timedelta(hours=24)

    # =========================================================================
    # 1. Pulse Data
    # =========================================================================
    pulse_result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM messages WHERE created_at >= :hour_ago) as messages_last_hour,
            (SELECT COUNT(*) FROM messages WHERE created_at >= :today_start) as messages_today,
            (SELECT COUNT(DISTINCT channel_id) FROM messages WHERE created_at >= :day_ago) as channels_active_24h
    """), {
        "hour_ago": hour_ago,
        "today_start": today_start,
        "day_ago": day_ago,
    })
    pulse_row = pulse_result.fetchone()

    messages_last_hour = pulse_row.messages_last_hour or 0
    # Determine status based on message rate
    if messages_last_hour >= 10:
        status = "active"
    elif messages_last_hour >= 1:
        status = "slow"
    else:
        status = "idle"

    pulse = PulseData(
        messages_last_hour=messages_last_hour,
        messages_today=pulse_row.messages_today or 0,
        channels_active_24h=pulse_row.channels_active_24h or 0,
        status=status,
    )

    # =========================================================================
    # 2. Volume Data
    # =========================================================================
    # Determine time range and granularity
    if volume_timeframe == "24h":
        volume_start = day_ago
        granularity = "hour"
        # Generate hourly buckets for last 24 hours
        volume_query = text("""
            SELECT
                date_trunc('hour', created_at) as bucket,
                COUNT(*) as count
            FROM messages
            WHERE created_at >= :start_time
            GROUP BY bucket
            ORDER BY bucket ASC
        """)
    else:
        days = 7 if volume_timeframe == "7d" else 30
        volume_start = now - timedelta(days=days)
        granularity = "day"
        volume_query = text("""
            SELECT
                date_trunc('day', created_at) as bucket,
                COUNT(*) as count
            FROM messages
            WHERE created_at >= :start_time
            GROUP BY bucket
            ORDER BY bucket ASC
        """)

    volume_result = await db.execute(volume_query, {"start_time": volume_start})
    volume_rows = volume_result.fetchall()

    buckets = [
        VolumeBucket(timestamp=row.bucket.isoformat(), count=row.count)
        for row in volume_rows
    ]

    # Calculate peak and average
    counts = [b.count for b in buckets] if buckets else [0]
    total = sum(counts)
    average = total / len(counts) if counts else 0
    peak = max(buckets, key=lambda b: b.count) if buckets else None

    volume = VolumeData(
        granularity=granularity,
        timeframe=volume_timeframe,
        buckets=buckets,
        peak=peak,
        average=round(average, 1),
        total=total,
    )

    # =========================================================================
    # 3. Topics Data
    # =========================================================================
    topics_start = day_ago if topics_timeframe == "24h" else now - timedelta(days=7)

    topics_result = await db.execute(text("""
        SELECT
            COALESCE(topic, 'unknown') as topic_name,
            COUNT(*) as count
        FROM messages
        WHERE created_at >= :start_time
        GROUP BY topic
        ORDER BY count DESC
    """), {"start_time": topics_start})
    topics_rows = topics_result.fetchall()

    # Calculate total and build items (top 8 + other)
    topics_total = sum(row.count for row in topics_rows)
    topic_items = []
    other_count = 0

    for i, row in enumerate(topics_rows):
        if i < 8:
            percent = (row.count / topics_total * 100) if topics_total > 0 else 0
            topic_items.append(TopicItem(
                topic=row.topic_name,
                count=row.count,
                percent=round(percent, 1),
            ))
        else:
            other_count += row.count

    # Add "other" if there are more than 8 topics
    if other_count > 0:
        percent = (other_count / topics_total * 100) if topics_total > 0 else 0
        topic_items.append(TopicItem(
            topic="other",
            count=other_count,
            percent=round(percent, 1),
        ))

    topics = TopicsData(
        timeframe=topics_timeframe,
        items=topic_items,
        total=topics_total,
    )

    # =========================================================================
    # 4. Channels Data (Most Active)
    # =========================================================================
    channels_result = await db.execute(text("""
        SELECT
            c.id,
            c.name,
            c.username,
            COUNT(m.id) as message_count
        FROM channels c
        JOIN messages m ON m.channel_id = c.id
        WHERE m.created_at >= :day_ago
        GROUP BY c.id, c.name, c.username
        ORDER BY message_count DESC
        LIMIT 5
    """), {"day_ago": day_ago})
    channels_rows = channels_result.fetchall()

    channel_items = [
        ChannelActivityItem(
            id=row.id,
            name=row.name or f"Channel {row.id}",
            username=row.username,
            count=row.message_count,
        )
        for row in channels_rows
    ]

    # Get total active channels count
    total_active = pulse.channels_active_24h

    channels_data = ChannelsData(
        timeframe="24h",
        items=channel_items,
        total_active=total_active,
    )

    return ActivityResponse(
        pulse=pulse,
        volume=volume,
        topics=topics,
        channels=channels_data,
        timestamp=now.isoformat(),
    )
