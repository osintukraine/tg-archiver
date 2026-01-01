"""
Admin Urgency Kanban API

Provides urgency-based message lanes for prioritized review.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List, Optional, Dict
from enum import Enum

from ...database import get_db
from ...dependencies import AdminUser
from config.settings import settings

router = APIRouter(prefix="/api/admin/kanban", tags=["admin-kanban"])


class UrgencyLane(str, Enum):
    critical = "Critical"
    high = "High"
    medium = "Medium"
    low = "Low"
    normal = "Normal"


class KanbanItem(BaseModel):
    """Kanban card item."""
    message_id: int
    date: datetime
    title: str
    urgency_lane: str
    osint_topic: Optional[str]
    importance_level: Optional[str]
    sentiment: Optional[str]
    views: Optional[int]
    forwards: Optional[int]
    channel: str
    thumbnail_url: Optional[str]
    has_media: bool


class KanbanLane(BaseModel):
    """A kanban lane with items."""
    name: str
    count: int
    items: List[KanbanItem]


class KanbanResponse(BaseModel):
    """Full kanban board response."""
    lanes: Dict[str, KanbanLane]
    total_items: int


class KanbanStatsResponse(BaseModel):
    """Kanban statistics."""
    by_lane: Dict[str, int]
    by_sentiment: Dict[str, int]
    by_importance: Dict[str, int]
    avg_urgency: float


@router.get("/", response_model=KanbanResponse)
async def get_kanban_board(
    admin: AdminUser,
    days: int = Query(7, ge=1, le=30),
    importance: Optional[str] = None,
    channel: Optional[str] = None,
    limit_per_lane: int = Query(20, ge=5, le=50),
    db: AsyncSession = Depends(get_db)
):
    """
    Get urgency kanban board.

    Returns messages organized by urgency lanes (Critical/High/Medium/Low/Normal).
    """
    # Return s3_key directly - frontend uses getMediaUrl() to build proper URL
    # This matches the pattern in messages.py (public API)

    # Use osint_topic for lane assignment (semantic urgency based on content type)
    # Critical: combat, casualties, movements (active military operations)
    # High: equipment, units, propaganda (military intelligence)
    # Medium: diplomatic, humanitarian (strategic context)
    # Low: general, uncertain, NULL (background/unclassified)
    base_query = """
        WITH ranked_messages AS (
            SELECT
                m.id as message_id,
                m.telegram_date as date,
                LEFT(COALESCE(m.content_translated, m.content), 150) as title,
                CASE
                    WHEN m.osint_topic IN ('combat', 'casualties', 'movements') THEN 'Critical'
                    WHEN m.osint_topic IN ('equipment', 'units', 'propaganda') THEN 'High'
                    WHEN m.osint_topic IN ('diplomatic', 'humanitarian') THEN 'Medium'
                    ELSE 'Low'
                END as urgency_lane,
                m.osint_topic,
                m.importance_level,
                m.content_sentiment as sentiment,
                c.name || CASE WHEN c.verified THEN ' ✓' ELSE '' END as channel,
                m.media_type,
                mf.s3_key,
                m.views,
                m.forwards,
                ROW_NUMBER() OVER (
                    PARTITION BY CASE
                        WHEN m.osint_topic IN ('combat', 'casualties', 'movements') THEN 'Critical'
                        WHEN m.osint_topic IN ('equipment', 'units', 'propaganda') THEN 'High'
                        WHEN m.osint_topic IN ('diplomatic', 'humanitarian') THEN 'Medium'
                        ELSE 'Low'
                    END
                    ORDER BY m.telegram_date DESC
                ) as row_num
            FROM messages m
            LEFT JOIN channels c ON c.id = m.channel_id
            LEFT JOIN message_media mm ON mm.message_id = m.id
            LEFT JOIN media_files mf ON mf.id = mm.media_id
            WHERE m.is_spam = false
            AND m.telegram_date >= NOW() - INTERVAL '1 day' * :days
    """

    params = {"days": days, "limit": limit_per_lane}

    if importance:
        base_query += " AND m.importance_level = :importance"
        params["importance"] = importance

    if channel:
        base_query += " AND (c.name ILIKE :channel OR c.username ILIKE :channel)"
        params["channel"] = f"%{channel}%"

    base_query += f"""
        )
        SELECT
            message_id,
            date,
            title,
            urgency_lane,
            osint_topic,
            importance_level,
            sentiment,
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

    # Organize into lanes (based on osint_topic classification)
    lanes_data = {
        "Critical": [],  # combat, casualties, movements
        "High": [],      # equipment, units, propaganda
        "Medium": [],    # diplomatic, humanitarian
        "Low": [],       # general, uncertain, NULL
    }

    # Column order: message_id, date, title, urgency_lane, osint_topic,
    #               importance_level, sentiment, channel, media_type, views, forwards, thumbnail_url
    for row in rows:
        item = KanbanItem(
            message_id=row[0],
            date=row[1],
            title=row[2] or "(No content)",
            urgency_lane=row[3],
            osint_topic=row[4],
            importance_level=row[5],
            sentiment=row[6],
            channel=row[7] or "Unknown",
            views=row[9],
            forwards=row[10],
            thumbnail_url=row[11],
            has_media=row[8] is not None,
        )
        if item.urgency_lane in lanes_data:
            lanes_data[item.urgency_lane].append(item)

    # Build response
    lanes = {}
    total = 0
    for lane_name, items in lanes_data.items():
        lanes[lane_name] = KanbanLane(
            name=lane_name,
            count=len(items),
            items=items,
        )
        total += len(items)

    return KanbanResponse(lanes=lanes, total_items=total)


@router.get("/stats", response_model=KanbanStatsResponse)
async def get_kanban_stats(
    admin: AdminUser,
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db)
):
    """Get kanban statistics for the dashboard."""

    # By lane - using osint_topic for semantic urgency classification
    lane_result = await db.execute(text("""
        SELECT
            CASE
                WHEN osint_topic IN ('combat', 'casualties', 'movements') THEN 'Critical'
                WHEN osint_topic IN ('equipment', 'units', 'propaganda') THEN 'High'
                WHEN osint_topic IN ('diplomatic', 'humanitarian') THEN 'Medium'
                ELSE 'Low'
            END as lane,
            COUNT(*)
        FROM messages
        WHERE is_spam = false
        AND telegram_date >= NOW() - INTERVAL '1 day' * :days
        GROUP BY 1
    """), {"days": days})
    by_lane = {row[0]: row[1] for row in lane_result.fetchall()}

    # By sentiment
    sentiment_result = await db.execute(text("""
        SELECT COALESCE(content_sentiment, 'unknown'), COUNT(*)
        FROM messages
        WHERE is_spam = false
        AND telegram_date >= NOW() - INTERVAL '1 day' * :days
        GROUP BY content_sentiment
    """), {"days": days})
    by_sentiment = {row[0]: row[1] for row in sentiment_result.fetchall()}

    # By importance
    importance_result = await db.execute(text("""
        SELECT COALESCE(importance_level, 'unknown'), COUNT(*)
        FROM messages
        WHERE is_spam = false
        AND telegram_date >= NOW() - INTERVAL '1 day' * :days
        GROUP BY importance_level
    """), {"days": days})
    by_importance = {row[0]: row[1] for row in importance_result.fetchall()}

    # Average engagement score (views + forwards*10)
    avg_result = await db.execute(text("""
        SELECT AVG(COALESCE(views, 0) + COALESCE(forwards, 0) * 10)
        FROM messages
        WHERE is_spam = false
        AND telegram_date >= NOW() - INTERVAL '1 day' * :days
    """), {"days": days})
    avg_urgency = avg_result.scalar() or 0

    return KanbanStatsResponse(
        by_lane=by_lane,
        by_sentiment=by_sentiment,
        by_importance=by_importance,
        avg_urgency=round(avg_urgency, 1),
    )
