"""
Admin Channels API

Provides channel management with quality metrics and discovery status.
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from enum import Enum

from ...database import get_db
from ...dependencies import AdminUser

router = APIRouter(prefix="/api/admin/channels", tags=["admin-channels"])


class ChannelAffiliation(str, Enum):
    ukrainian = "ukrainian"
    russian = "russian"
    western = "western"
    neutral = "neutral"


class ChannelRule(str, Enum):
    archive_all = "archive_all"
    selective_archive = "selective_archive"
    monitor_only = "monitor_only"


class ChannelItem(BaseModel):
    """Channel list item."""
    id: int
    telegram_id: int
    username: Optional[str]
    name: Optional[str]
    description: Optional[str]
    type: str
    verified: bool
    scam: bool
    fake: bool
    source_type: Optional[str]
    affiliation: Optional[str]
    folder: Optional[str]
    rule: Optional[str]
    active: bool
    message_count: int
    last_message_at: Optional[datetime]
    quality_metrics: Optional[Dict[str, Any]]
    discovery_status: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True


class ChannelListResponse(BaseModel):
    """Paginated channel list response."""
    items: List[ChannelItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class ChannelStatsResponse(BaseModel):
    """Channel statistics."""
    total_channels: int
    active_channels: int
    verified_channels: int
    by_affiliation: Dict[str, int]
    by_folder: Dict[str, int]
    by_rule: Dict[str, int]
    by_source_type: Dict[str, int]


class ChannelUpdateRequest(BaseModel):
    """Request to update channel settings."""
    affiliation: Optional[str] = None
    active: Optional[bool] = None
    rule: Optional[str] = None
    folder: Optional[str] = None


@router.get("/", response_model=ChannelListResponse)
async def get_channels(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=10, le=100),
    search: Optional[str] = None,
    affiliation: Optional[str] = None,
    folder: Optional[str] = None,
    rule: Optional[str] = None,
    active: Optional[bool] = None,
    verified: Optional[bool] = None,
    source_type: Optional[str] = None,
    sort_by: str = Query("name", pattern="^(name|created_at|last_message_at|message_count)$"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db)
) -> ChannelListResponse:
    """
    Get paginated channel list with filters.
    """
    base_query = """
        SELECT
            c.id,
            c.telegram_id,
            c.username,
            c.name,
            c.description,
            c.type,
            c.verified,
            c.scam,
            c.fake,
            c.source_type,
            c.affiliation,
            c.folder,
            c.rule,
            c.active,
            COALESCE(mc.message_count, 0) as message_count,
            c.last_message_at,
            c.quality_metrics,
            c.discovery_status,
            c.created_at
        FROM channels c
        LEFT JOIN (
            SELECT channel_id, COUNT(*) as message_count
            FROM messages
            WHERE is_spam = false
            GROUP BY channel_id
        ) mc ON mc.channel_id = c.id
        WHERE 1=1
    """

    count_query = """
        SELECT COUNT(*)
        FROM channels c
        WHERE 1=1
    """

    params = {}

    # Add filters
    if search:
        base_query += " AND (c.name ILIKE :search OR c.username ILIKE :search OR c.description ILIKE :search)"
        count_query += " AND (c.name ILIKE :search OR c.username ILIKE :search OR c.description ILIKE :search)"
        params["search"] = f"%{search}%"

    if affiliation:
        base_query += " AND c.affiliation = :affiliation"
        count_query += " AND c.affiliation = :affiliation"
        params["affiliation"] = affiliation

    if folder:
        base_query += " AND c.folder ILIKE :folder"
        count_query += " AND c.folder ILIKE :folder"
        params["folder"] = f"%{folder}%"

    if rule:
        base_query += " AND c.rule = :rule"
        count_query += " AND c.rule = :rule"
        params["rule"] = rule

    if active is not None:
        base_query += " AND c.active = :active"
        count_query += " AND c.active = :active"
        params["active"] = active

    if verified is not None:
        base_query += " AND c.verified = :verified"
        count_query += " AND c.verified = :verified"
        params["verified"] = verified

    if source_type:
        base_query += " AND c.source_type = :source_type"
        count_query += " AND c.source_type = :source_type"
        params["source_type"] = source_type

    # Add sorting
    sort_column = {
        "name": "c.name",
        "created_at": "c.created_at",
        "last_message_at": "c.last_message_at",
        "message_count": "message_count",
    }.get(sort_by, "c.name")

    base_query += f" ORDER BY {sort_column} {sort_order.upper()} NULLS LAST"

    # Add pagination
    base_query += " LIMIT :limit OFFSET :offset"
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
        ChannelItem(
            id=row[0],
            telegram_id=row[1],
            username=row[2],
            name=row[3],
            description=row[4],
            type=row[5],
            verified=row[6],
            scam=row[7],
            fake=row[8],
            source_type=row[9],
            affiliation=row[10],
            folder=row[11],
            rule=row[12],
            active=row[13],
            message_count=row[14] or 0,
            last_message_at=row[15],
            quality_metrics=row[16],
            discovery_status=row[17],
            created_at=row[18],
        )
        for row in rows
    ]

    return ChannelListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.get("/stats", response_model=ChannelStatsResponse)
async def get_channel_stats(admin: AdminUser, db: AsyncSession = Depends(get_db)) -> ChannelStatsResponse:
    """Get channel statistics."""

    # Basic counts
    total_result = await db.execute(text("SELECT COUNT(*) FROM channels"))
    total_channels = total_result.scalar() or 0

    active_result = await db.execute(text("SELECT COUNT(*) FROM channels WHERE active = true"))
    active_channels = active_result.scalar() or 0

    verified_result = await db.execute(text("SELECT COUNT(*) FROM channels WHERE verified = true"))
    verified_channels = verified_result.scalar() or 0

    # By affiliation
    affiliation_result = await db.execute(text("""
        SELECT COALESCE(affiliation, 'unknown'), COUNT(*)
        FROM channels
        GROUP BY affiliation
    """))
    by_affiliation = {row[0]: row[1] for row in affiliation_result.fetchall()}

    # By folder
    folder_result = await db.execute(text("""
        SELECT COALESCE(folder, 'none'), COUNT(*)
        FROM channels
        GROUP BY folder
        ORDER BY COUNT(*) DESC
        LIMIT 15
    """))
    by_folder = {row[0]: row[1] for row in folder_result.fetchall()}

    # By rule
    rule_result = await db.execute(text("""
        SELECT COALESCE(rule, 'none'), COUNT(*)
        FROM channels
        GROUP BY rule
    """))
    by_rule = {row[0]: row[1] for row in rule_result.fetchall()}

    # By source type
    source_result = await db.execute(text("""
        SELECT COALESCE(source_type, 'unknown'), COUNT(*)
        FROM channels
        GROUP BY source_type
    """))
    by_source_type = {row[0]: row[1] for row in source_result.fetchall()}

    return ChannelStatsResponse(
        total_channels=total_channels,
        active_channels=active_channels,
        verified_channels=verified_channels,
        by_affiliation=by_affiliation,
        by_folder=by_folder,
        by_rule=by_rule,
        by_source_type=by_source_type,
    )


@router.get("/folders")
async def get_channel_folders(admin: AdminUser, db: AsyncSession = Depends(get_db)) -> List[Dict[str, Any]]:
    """Get distinct folder names for filtering."""
    result = await db.execute(text("""
        SELECT DISTINCT folder, COUNT(*)
        FROM channels
        WHERE folder IS NOT NULL
        GROUP BY folder
        ORDER BY COUNT(*) DESC
    """))
    return [{"folder": row[0], "count": row[1]} for row in result.fetchall()]


@router.get("/{channel_id}")
async def get_channel_detail(
    channel_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Get detailed channel information."""
    result = await db.execute(text("""
        SELECT
            c.*,
            COALESCE(mc.message_count, 0) as message_count,
            COALESCE(mc.first_message_at, NULL) as first_message_at,
            COALESCE(mc.spam_count, 0) as spam_count
        FROM channels c
        LEFT JOIN (
            SELECT
                channel_id,
                COUNT(*) as message_count,
                MIN(telegram_date) as first_message_at,
                COUNT(*) FILTER (WHERE is_spam = true) as spam_count
            FROM messages
            GROUP BY channel_id
        ) mc ON mc.channel_id = c.id
        WHERE c.id = :channel_id
    """), {"channel_id": channel_id})

    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Channel not found")

    return dict(row._mapping)


@router.put("/{channel_id}")
async def update_channel(
    channel_id: int,
    update: ChannelUpdateRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Update channel settings."""
    # Build update query
    updates = []
    params = {"channel_id": channel_id}

    if update.affiliation is not None:
        updates.append("affiliation = :affiliation")
        params["affiliation"] = update.affiliation

    if update.active is not None:
        updates.append("active = :active")
        params["active"] = update.active

    if update.rule is not None:
        updates.append("rule = :rule")
        params["rule"] = update.rule

    if update.folder is not None:
        updates.append("folder = :folder")
        params["folder"] = update.folder

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at = NOW()")

    query = f"UPDATE channels SET {', '.join(updates)} WHERE id = :channel_id RETURNING id"
    result = await db.execute(text(query), params)
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Channel not found")

    return {"success": True, "message": "Channel updated"}
