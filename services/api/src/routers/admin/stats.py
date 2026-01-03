"""
Admin Statistics API

Aggregated statistics for the platform dashboard.
Simple archiving metrics without AI/enrichment features.
"""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

from ...database import get_db
from ...dependencies import AdminUser
from ...utils.cache import get_cached, set_cached, make_cache_key
from ...utils.formatting import format_bytes

router = APIRouter(prefix="/api/admin/stats", tags=["admin-stats"])

# Cache TTLs for admin endpoints
OVERVIEW_CACHE_TTL = 30   # 30 seconds
STORAGE_CACHE_TTL = 60    # 1 minute


class OverviewStats(BaseModel):
    """Platform overview statistics."""

    # Database totals
    total_messages: int
    total_channels: int
    total_media_files: int

    # Recent activity
    messages_today: int
    messages_this_week: int
    messages_per_hour: float

    # Metadata
    timestamp: str
    cached: bool = False


@router.get("/overview", response_model=OverviewStats)
async def get_overview_stats(
    admin: AdminUser,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Get platform overview statistics.

    Response cached for 30 seconds.
    """
    cache_key = make_cache_key("admin", "stats", "overview")

    # Try cache first
    cached = await get_cached(cache_key)
    if cached:
        response.headers["X-Cached"] = "true"
        response.headers["Cache-Control"] = f"public, max-age={OVERVIEW_CACHE_TTL}"
        return OverviewStats(**cached)

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)
    hour_ago = now - timedelta(hours=1)

    # Database queries
    db_result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM messages) as total_messages,
            (SELECT COUNT(*) FROM channels) as total_channels,
            (SELECT COUNT(*) FROM media_files) as total_media,
            (SELECT COUNT(*) FROM messages WHERE telegram_date >= :today) as today,
            (SELECT COUNT(*) FROM messages WHERE telegram_date >= :week) as week,
            (SELECT COUNT(*) FROM messages WHERE telegram_date >= :hour_ago) as last_hour
    """), {"today": today_start, "week": week_start, "hour_ago": hour_ago})
    row = db_result.fetchone()

    total_messages = row[0] or 0
    messages_per_hour = float(row[5] or 0)

    result = OverviewStats(
        total_messages=total_messages,
        total_channels=row[1] or 0,
        total_media_files=row[2] or 0,
        messages_today=row[3] or 0,
        messages_this_week=row[4] or 0,
        messages_per_hour=messages_per_hour,
        timestamp=now.isoformat(),
        cached=False
    )

    # Cache the result
    await set_cached(cache_key, result.model_dump(), OVERVIEW_CACHE_TTL)

    response.headers["X-Cached"] = "false"
    response.headers["Cache-Control"] = f"public, max-age={OVERVIEW_CACHE_TTL}"

    return result


@router.get("/processing")
async def get_processing_metrics(
    admin: AdminUser,
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db)
):
    """
    Get message processing metrics for the specified time window.
    """
    since = datetime.utcnow() - timedelta(hours=hours)

    # Processing by hour
    hourly_result = await db.execute(text("""
        SELECT
            DATE_TRUNC('hour', telegram_date) as hour,
            COUNT(*) as total
        FROM messages
        WHERE telegram_date >= :since
        GROUP BY DATE_TRUNC('hour', telegram_date)
        ORDER BY hour
    """), {"since": since})

    hourly_data = [
        {
            "hour": row[0].isoformat() if row[0] else None,
            "total": row[1],
        }
        for row in hourly_result.fetchall()
    ]

    # Summary stats
    summary_result = await db.execute(text("""
        SELECT
            COUNT(*) as total,
            MAX(telegram_date) as latest
        FROM messages
        WHERE telegram_date >= :since
    """), {"since": since})
    summary_row = summary_result.fetchone()

    return {
        "period_hours": hours,
        "since": since.isoformat(),
        "summary": {
            "total_messages": summary_row[0] or 0,
            "latest_message": summary_row[1].isoformat() if summary_row[1] else None,
            "messages_per_hour": round((summary_row[0] or 0) / hours, 1),
        },
        "hourly": hourly_data,
    }


@router.get("/storage")
async def get_storage_metrics(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """
    Get storage usage metrics.
    """
    # Database table sizes (PostgreSQL specific)
    table_result = await db.execute(text("""
        SELECT
            relname as table_name,
            n_live_tup as row_count
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY n_live_tup DESC
        LIMIT 10
    """))
    table_sizes = [
        {"table": row[0], "rows": row[1]}
        for row in table_result.fetchall()
    ]

    # Media storage by type
    media_result = await db.execute(text("""
        SELECT
            CASE
                WHEN mime_type LIKE 'image/%' THEN 'image'
                WHEN mime_type LIKE 'video/%' THEN 'video'
                WHEN mime_type LIKE 'audio/%' THEN 'audio'
                WHEN mime_type LIKE 'application/%' THEN 'document'
                ELSE 'other'
            END as type,
            COUNT(*) as count,
            COALESCE(SUM(file_size), 0) as total_size
        FROM media_files
        GROUP BY type
        ORDER BY total_size DESC
    """))
    media_storage = [
        {
            "type": row[0],
            "count": row[1],
            "size_bytes": row[2],
            "size_human": format_bytes(row[2]),
        }
        for row in media_result.fetchall()
    ]

    # Total media size
    total_result = await db.execute(text("""
        SELECT COUNT(*), COALESCE(SUM(file_size), 0) FROM media_files
    """))
    total_row = total_result.fetchone()

    return {
        "database": {
            "tables": table_sizes,
        },
        "media": {
            "total_files": total_row[0] or 0,
            "total_size_bytes": total_row[1] or 0,
            "total_size_human": format_bytes(total_row[1] or 0),
            "by_type": media_storage,
        },
    }


@router.get("/channels")
async def get_channel_stats(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Get per-channel statistics.
    """
    result = await db.execute(text("""
        SELECT
            c.id,
            c.name,
            c.username,
            c.telegram_id,
            COUNT(m.id) as message_count,
            MAX(m.telegram_date) as last_message
        FROM channels c
        LEFT JOIN messages m ON c.telegram_id = m.channel_id
        GROUP BY c.id, c.name, c.username, c.telegram_id
        ORDER BY message_count DESC
        LIMIT 50
    """))

    return {
        "channels": [
            {
                "id": row[0],
                "name": row[1],
                "username": row[2],
                "telegram_id": row[3],
                "message_count": row[4] or 0,
                "last_message": row[5].isoformat() if row[5] else None,
            }
            for row in result.fetchall()
        ]
    }
