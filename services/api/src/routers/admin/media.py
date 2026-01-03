"""
Admin Media Gallery API

Provides media browsing and management for archived photos/videos.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List, Optional
from enum import Enum

from ...database import get_db
from ...dependencies import AdminUser
from config.settings import settings

router = APIRouter(prefix="/api/admin/media", tags=["admin-media"])


class MediaType(str, Enum):
    photo = "photo"
    video = "video"
    document = "document"
    audio = "audio"


class MediaItem(BaseModel):
    """Media item for gallery."""
    message_id: int
    post_id: int
    posted_at: datetime
    caption: Optional[str]
    media_type: str
    s3_key: Optional[str]
    mime_type: Optional[str]
    file_size: Optional[int]
    media_url: Optional[str]
    topic: Optional[str]
    channel_name: str
    channel_username: Optional[str]


class MediaListResponse(BaseModel):
    """Paginated media list response."""
    items: List[MediaItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class MediaStatsResponse(BaseModel):
    """Media storage statistics."""
    total_files: int
    total_size_gb: float
    photos_count: int
    videos_count: int
    documents_count: int
    by_channel: dict


@router.get("/", response_model=MediaListResponse)
async def get_media_gallery(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(48, ge=1, le=100),  # 48 for 6x8 grid
    media_type: Optional[MediaType] = None,
    channel: Optional[str] = None,
    topic: Optional[str] = None,
    days: Optional[int] = Query(None, ge=1, le=365),
    db: AsyncSession = Depends(get_db)
):
    """
    Get media gallery with thumbnails.

    Returns paginated media items for visual browsing.
    """
    # Return s3_key directly - frontend uses getMediaUrl() to build proper URL
    # This matches the pattern in messages.py (public API)
    base_query = """
        SELECT
            m.id as message_id,
            COALESCE(m.grouped_id, m.id) as post_id,
            m.telegram_date as posted_at,
            LEFT(COALESCE(m.content_translated, m.content), 200) as caption,
            m.media_type,
            mf.s3_key,
            mf.mime_type,
            mf.file_size,
            mf.s3_key as media_url,
            m.topic,
            c.name as channel_name,
            c.username as channel_username
        FROM messages m
        LEFT JOIN message_media mm ON mm.message_id = m.id
        LEFT JOIN media_files mf ON mf.id = mm.media_file_id
        LEFT JOIN channels c ON c.id = m.channel_id
        WHERE m.media_type IS NOT NULL
    """

    count_query = """
        SELECT COUNT(DISTINCT COALESCE(m.grouped_id, m.id))
        FROM messages m
        LEFT JOIN message_media mm ON mm.message_id = m.id
        LEFT JOIN media_files mf ON mf.id = mm.media_file_id
        WHERE m.media_type IS NOT NULL
    """

    params = {}

    # Add filters
    if media_type:
        base_query += " AND m.media_type = :media_type"
        count_query += " AND m.media_type = :media_type"
        params["media_type"] = media_type.value

    if channel:
        base_query += " AND (c.name ILIKE :channel OR c.username ILIKE :channel)"
        count_query += " AND (c.name ILIKE :channel OR c.username ILIKE :channel)"
        params["channel"] = f"%{channel}%"

    if topic:
        base_query += " AND m.topic = :topic"
        count_query += " AND m.topic = :topic"
        params["topic"] = topic

    if days:
        base_query += " AND m.telegram_date >= NOW() - INTERVAL '1 day' * :days"
        count_query += " AND m.telegram_date >= NOW() - INTERVAL '1 day' * :days"
        params["days"] = days

    # Add pagination (distinct by post_id to group albums)
    base_query += """
        ORDER BY m.telegram_date DESC
        LIMIT :limit OFFSET :offset
    """
    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    # Execute queries
    result = await db.execute(text(base_query), params)
    rows = result.fetchall()

    count_result = await db.execute(
        text(count_query),
        {k: v for k, v in params.items() if k not in ["limit", "offset"]}
    )
    total = count_result.scalar() or 0

    items = [
        MediaItem(
            message_id=row[0],
            post_id=row[1],
            posted_at=row[2],
            caption=row[3],
            media_type=row[4] or "unknown",
            s3_key=row[5],
            mime_type=row[6],
            file_size=row[7],
            media_url=row[8],
            topic=row[9],
            channel_name=row[10] or "Unknown",
            channel_username=row[11],
        )
        for row in rows
    ]

    return MediaListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.get("/stats", response_model=MediaStatsResponse)
async def get_media_stats(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """Get media storage statistics."""

    # Total files and size
    total_result = await db.execute(text("""
        SELECT COUNT(*), COALESCE(SUM(file_size), 0)
        FROM media_files
    """))
    row = total_result.fetchone()
    total_files = row[0] or 0
    total_size_bytes = row[1] or 0
    total_size_gb = total_size_bytes / (1024 ** 3)

    # Count by type
    type_result = await db.execute(text("""
        SELECT
            COALESCE(m.media_type, 'unknown'),
            COUNT(DISTINCT mf.id)
        FROM media_files mf
        JOIN message_media mm ON mm.media_file_id = mf.id
        JOIN messages m ON m.id = mm.message_id
        GROUP BY m.media_type
    """))
    type_counts = {row[0]: row[1] for row in type_result.fetchall()}

    # By channel (top 10)
    channel_result = await db.execute(text("""
        SELECT c.name, COUNT(mf.id), SUM(mf.file_size)
        FROM media_files mf
        JOIN message_media mm ON mm.media_file_id = mf.id
        JOIN messages m ON m.id = mm.message_id
        JOIN channels c ON c.id = m.channel_id
        GROUP BY c.name
        ORDER BY COUNT(mf.id) DESC
        LIMIT 10
    """))
    by_channel = {
        row[0]: {"count": row[1], "size_mb": round((row[2] or 0) / (1024 ** 2), 1)}
        for row in channel_result.fetchall()
    }

    return MediaStatsResponse(
        total_files=total_files,
        total_size_gb=round(total_size_gb, 2),
        photos_count=type_counts.get("photo", 0),
        videos_count=type_counts.get("video", 0),
        documents_count=type_counts.get("document", 0),
        by_channel=by_channel,
    )


@router.get("/topics")
async def get_media_topics(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """Get available topics for filtering."""
    result = await db.execute(text("""
        SELECT DISTINCT topic, COUNT(*)
        FROM messages
        WHERE media_type IS NOT NULL
        AND topic IS NOT NULL
        GROUP BY topic
        ORDER BY COUNT(*) DESC
        LIMIT 20
    """))
    return [{"topic": row[0], "count": row[1]} for row in result.fetchall()]
