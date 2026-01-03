"""
Admin Message Board API

Provides engagement-based message lanes for prioritized review.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Dict

from ...database import get_db
from ...dependencies import AdminUser
from config.settings import settings

router = APIRouter(prefix="/api/admin/kanban", tags=["admin-kanban"])


class BoardItem(BaseModel):
    """Board card item."""
    message_id: int
    date: datetime
    title: str
    lane: str
    views: Optional[int]
    forwards: Optional[int]
    channel: str
    thumbnail_url: Optional[str]
    has_media: bool


class BoardLane(BaseModel):
    """A board lane with items."""
    name: str
    count: int
    items: List[BoardItem]


class BoardResponse(BaseModel):
    """Full board response."""
    lanes: Dict[str, BoardLane]
    total_items: int


class BoardStatsResponse(BaseModel):
    """Board statistics."""
    by_lane: Dict[str, int]
    total_messages: int
    with_media: int


@router.get("/", response_model=BoardResponse)
async def get_kanban_board(
    admin: AdminUser,
    days: int = Query(0, ge=0, le=3650),
    channel: Optional[str] = None,
    limit_per_lane: int = Query(20, ge=5, le=50),
    db: AsyncSession = Depends(get_db)
):
    """
    Get message board organized by engagement.

    Returns messages organized by engagement lanes:
    - Trending: High engagement (views > 10k or forwards > 100)
    - Popular: Above average engagement
    - Recent: Recently posted
    - Quiet: Low engagement

    Set days=0 for all time.
    """
    # Calculate engagement thresholds
    # days=0 means all time (no date filter)
    date_filter = "WHERE telegram_date >= NOW() - INTERVAL '1 day' * :days" if days > 0 else ""
    threshold_query = f"""
        SELECT
            PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY COALESCE(views, 0)) as p90_views,
            PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY COALESCE(forwards, 0)) as p90_forwards,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(views, 0)) as p50_views
        FROM messages
        {date_filter}
    """
    threshold_result = await db.execute(text(threshold_query), {"days": days})
    thresholds = threshold_result.fetchone()
    p90_views = thresholds[0] or 10000
    p90_forwards = thresholds[1] or 100
    p50_views = thresholds[2] or 1000

    base_query = f"""
        WITH ranked_messages AS (
            SELECT
                m.id as message_id,
                m.telegram_date as date,
                LEFT(COALESCE(m.content_translated, m.content), 150) as title,
                CASE
                    WHEN COALESCE(m.views, 0) >= :p90_views OR COALESCE(m.forwards, 0) >= :p90_forwards THEN 'Trending'
                    WHEN COALESCE(m.views, 0) >= :p50_views THEN 'Popular'
                    WHEN m.telegram_date >= NOW() - INTERVAL '2 days' THEN 'Recent'
                    ELSE 'Quiet'
                END as lane,
                c.name || CASE WHEN c.verified THEN ' ' || chr(10003) ELSE '' END as channel,
                m.media_type,
                mf.s3_key,
                m.views,
                m.forwards,
                ROW_NUMBER() OVER (
                    PARTITION BY CASE
                        WHEN COALESCE(m.views, 0) >= :p90_views OR COALESCE(m.forwards, 0) >= :p90_forwards THEN 'Trending'
                        WHEN COALESCE(m.views, 0) >= :p50_views THEN 'Popular'
                        WHEN m.telegram_date >= NOW() - INTERVAL '2 days' THEN 'Recent'
                        ELSE 'Quiet'
                    END
                    ORDER BY m.telegram_date DESC
                ) as row_num
            FROM messages m
            LEFT JOIN channels c ON c.id = m.channel_id
            LEFT JOIN message_media mm ON mm.message_id = m.id
            LEFT JOIN media_files mf ON mf.id = mm.media_file_id
            {date_filter}
    """

    params = {
        "days": days,
        "limit": limit_per_lane,
        "p90_views": p90_views,
        "p90_forwards": p90_forwards,
        "p50_views": p50_views,
    }

    if channel:
        channel_condition = "WHERE" if days == 0 else "AND"
        base_query += f" {channel_condition} (c.name ILIKE :channel OR c.username ILIKE :channel)"
        params["channel"] = f"%{channel}%"

    base_query += """
        )
        SELECT
            message_id,
            date,
            title,
            lane,
            channel,
            media_type,
            views,
            forwards,
            s3_key as thumbnail_url
        FROM ranked_messages
        WHERE row_num <= :limit
        ORDER BY date DESC
    """

    result = await db.execute(text(base_query), params)
    rows = result.fetchall()

    # Organize into lanes
    lanes_data = {
        "Trending": [],
        "Popular": [],
        "Recent": [],
        "Quiet": [],
    }

    for row in rows:
        item = BoardItem(
            message_id=row[0],
            date=row[1],
            title=row[2] or "(No content)",
            lane=row[3],
            channel=row[4] or "Unknown",
            views=row[6],
            forwards=row[7],
            thumbnail_url=row[8],
            has_media=row[5] is not None,
        )
        if item.lane in lanes_data:
            lanes_data[item.lane].append(item)

    # Build response
    lanes = {}
    total = 0
    for lane_name, items in lanes_data.items():
        lanes[lane_name] = BoardLane(
            name=lane_name,
            count=len(items),
            items=items,
        )
        total += len(items)

    return BoardResponse(lanes=lanes, total_items=total)


@router.get("/stats", response_model=BoardStatsResponse)
async def get_kanban_stats(
    admin: AdminUser,
    days: int = Query(0, ge=0, le=3650),
    db: AsyncSession = Depends(get_db)
):
    """Get board statistics for the dashboard. Set days=0 for all time."""

    # days=0 means all time (no date filter)
    date_filter = "WHERE telegram_date >= NOW() - INTERVAL '1 day' * :days" if days > 0 else ""

    # Get thresholds first
    threshold_query = f"""
        SELECT
            PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY COALESCE(views, 0)) as p90_views,
            PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY COALESCE(forwards, 0)) as p90_forwards,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(views, 0)) as p50_views
        FROM messages
        {date_filter}
    """
    threshold_result = await db.execute(text(threshold_query), {"days": days})
    thresholds = threshold_result.fetchone()
    p90_views = thresholds[0] or 10000
    p90_forwards = thresholds[1] or 100
    p50_views = thresholds[2] or 1000

    # By lane
    lane_result = await db.execute(text(f"""
        SELECT
            CASE
                WHEN COALESCE(views, 0) >= :p90_views OR COALESCE(forwards, 0) >= :p90_forwards THEN 'Trending'
                WHEN COALESCE(views, 0) >= :p50_views THEN 'Popular'
                WHEN telegram_date >= NOW() - INTERVAL '2 days' THEN 'Recent'
                ELSE 'Quiet'
            END as lane,
            COUNT(*)
        FROM messages
        {date_filter}
        GROUP BY 1
    """), {"days": days, "p90_views": p90_views, "p90_forwards": p90_forwards, "p50_views": p50_views})
    by_lane = {row[0]: row[1] for row in lane_result.fetchall()}

    # Total messages
    total_result = await db.execute(text(f"""
        SELECT COUNT(*)
        FROM messages
        {date_filter}
    """), {"days": days})
    total_messages = total_result.scalar() or 0

    # With media
    media_filter = "WHERE media_type IS NOT NULL" if days == 0 else f"{date_filter} AND media_type IS NOT NULL"
    media_result = await db.execute(text(f"""
        SELECT COUNT(*)
        FROM messages
        {media_filter}
    """), {"days": days})
    with_media = media_result.scalar() or 0

    return BoardStatsResponse(
        by_lane=by_lane,
        total_messages=total_messages,
        with_media=with_media,
    )
