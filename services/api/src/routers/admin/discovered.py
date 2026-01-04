"""
Admin Discovered Channels API

Provides management for channels discovered via message forwards.
Allows admins to view, promote to full archiving, or ignore discovered channels.
"""

import asyncio
import json
import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional

import redis.asyncio as redis
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...dependencies import AdminUser
from config.settings import settings

router = APIRouter(prefix="/api/admin/discovered", tags=["admin-discovered"])


class JoinStatus(str, Enum):
    pending = "pending"
    joining = "joining"
    joined = "joined"
    private = "private"
    failed = "failed"
    ignored = "ignored"


class DiscoveredChannelItem(BaseModel):
    """Discovered channel list item."""
    id: int
    telegram_id: int
    username: Optional[str]
    name: Optional[str]
    description: Optional[str]
    participant_count: Optional[int]
    verified: bool
    scam: bool
    fake: bool
    is_private: bool
    join_status: str
    join_error: Optional[str]
    discovery_count: int
    last_seen_at: datetime
    discovered_at: datetime
    joined_at: Optional[datetime]
    admin_action: Optional[str]
    promoted_to_channel_id: Optional[int]
    forward_count: int
    social_messages_fetched: int

    class Config:
        from_attributes = True


class DiscoveredChannelListResponse(BaseModel):
    """Paginated discovered channel list."""
    items: List[DiscoveredChannelItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class DiscoveredStatsResponse(BaseModel):
    """Statistics for discovered channels."""
    total: int
    by_status: Dict[str, int]
    pending: int
    joined: int
    private: int
    failed: int
    promoted: int
    ignored: int
    total_forwards_tracked: int
    avg_discovery_count: float


class PromoteRequest(BaseModel):
    """Request to promote discovered channel to full archiving."""
    category_id: Optional[int] = None
    folder: Optional[str] = None
    rule: str = "archive_all"


class IgnoreRequest(BaseModel):
    """Request to ignore a discovered channel."""
    reason: Optional[str] = None


@router.get("/", response_model=DiscoveredChannelListResponse)
async def list_discovered_channels(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=10, le=100),
    search: Optional[str] = None,
    status: Optional[JoinStatus] = None,
    min_forwards: Optional[int] = None,
    sort_by: str = Query(
        "discovery_count",
        pattern="^(discovery_count|discovered_at|last_seen_at|participant_count|name)$"
    ),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    db: AsyncSession = Depends(get_db)
) -> DiscoveredChannelListResponse:
    """
    Get paginated list of discovered channels.

    Discovered channels are channels found via message forwards but not yet
    being archived. Admins can promote them to full archiving or ignore them.
    """
    base_query = """
        SELECT
            dc.id,
            dc.telegram_id,
            dc.username,
            dc.name,
            dc.description,
            dc.participant_count,
            dc.verified,
            dc.scam,
            dc.fake,
            dc.is_private,
            dc.join_status,
            dc.join_error,
            dc.discovery_count,
            dc.last_seen_at,
            dc.discovered_at,
            dc.joined_at,
            dc.admin_action,
            dc.promoted_to_channel_id,
            COALESCE(fc.forward_count, 0) as forward_count,
            dc.social_messages_fetched
        FROM discovered_channels dc
        LEFT JOIN (
            SELECT discovered_channel_id, COUNT(*) as forward_count
            FROM message_forwards
            WHERE discovered_channel_id IS NOT NULL
            GROUP BY discovered_channel_id
        ) fc ON fc.discovered_channel_id = dc.id
        WHERE 1=1
    """

    count_query = """
        SELECT COUNT(*)
        FROM discovered_channels dc
        WHERE 1=1
    """

    params: Dict[str, Any] = {}

    # Filters
    if search:
        base_query += " AND (dc.name ILIKE :search OR dc.username ILIKE :search OR dc.description ILIKE :search)"
        count_query += " AND (dc.name ILIKE :search OR dc.username ILIKE :search OR dc.description ILIKE :search)"
        params["search"] = f"%{search}%"

    if status:
        base_query += " AND dc.join_status = :status"
        count_query += " AND dc.join_status = :status"
        params["status"] = status.value

    if min_forwards:
        base_query += " AND dc.discovery_count >= :min_forwards"
        count_query += " AND dc.discovery_count >= :min_forwards"
        params["min_forwards"] = min_forwards

    # Sorting (validated by Query pattern, but also whitelist for SQL safety)
    sort_column = {
        "discovery_count": "dc.discovery_count",
        "discovered_at": "dc.discovered_at",
        "last_seen_at": "dc.last_seen_at",
        "participant_count": "dc.participant_count",
        "name": "dc.name",
    }.get(sort_by, "dc.discovery_count")

    validated_order = "ASC" if sort_order.lower() == "asc" else "DESC"
    base_query += f" ORDER BY {sort_column} {validated_order} NULLS LAST"

    # Pagination
    base_query += " LIMIT :limit OFFSET :offset"
    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    # Execute
    result = await db.execute(text(base_query), params)
    rows = result.fetchall()

    count_params = {k: v for k, v in params.items() if k not in ["limit", "offset"]}
    count_result = await db.execute(text(count_query), count_params)
    total = count_result.scalar() or 0

    items = []
    for row in rows:
        items.append(DiscoveredChannelItem(
            id=row[0],
            telegram_id=row[1],
            username=row[2],
            name=row[3],
            description=row[4],
            participant_count=row[5],
            verified=row[6] or False,
            scam=row[7] or False,
            fake=row[8] or False,
            is_private=row[9] or False,
            join_status=row[10],
            join_error=row[11],
            discovery_count=row[12] or 0,
            last_seen_at=row[13],
            discovered_at=row[14],
            joined_at=row[15],
            admin_action=row[16],
            promoted_to_channel_id=row[17],
            forward_count=row[18] or 0,
            social_messages_fetched=row[19] or 0,
        ))

    return DiscoveredChannelListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.get("/stats", response_model=DiscoveredStatsResponse)
async def get_discovered_stats(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> DiscoveredStatsResponse:
    """Get statistics for discovered channels."""

    # Total count
    total_result = await db.execute(
        text("SELECT COUNT(*) FROM discovered_channels")
    )
    total = total_result.scalar() or 0

    # By status
    status_result = await db.execute(text("""
        SELECT join_status, COUNT(*)
        FROM discovered_channels
        GROUP BY join_status
    """))
    by_status = {row[0]: row[1] for row in status_result.fetchall()}

    # Promoted count
    promoted_result = await db.execute(text("""
        SELECT COUNT(*) FROM discovered_channels WHERE admin_action = 'promoted'
    """))
    promoted = promoted_result.scalar() or 0

    # Ignored count
    ignored_result = await db.execute(text("""
        SELECT COUNT(*) FROM discovered_channels WHERE admin_action = 'ignored'
    """))
    ignored = ignored_result.scalar() or 0

    # Total forwards tracked
    forwards_result = await db.execute(
        text("SELECT COUNT(*) FROM message_forwards")
    )
    total_forwards = forwards_result.scalar() or 0

    # Average discovery count
    avg_result = await db.execute(text("""
        SELECT COALESCE(AVG(discovery_count), 0) FROM discovered_channels
    """))
    avg_discovery = float(avg_result.scalar() or 0)

    return DiscoveredStatsResponse(
        total=total,
        by_status=by_status,
        pending=by_status.get("pending", 0),
        joined=by_status.get("joined", 0),
        private=by_status.get("private", 0),
        failed=by_status.get("failed", 0),
        promoted=promoted,
        ignored=ignored,
        total_forwards_tracked=total_forwards,
        avg_discovery_count=round(avg_discovery, 2),
    )


@router.get("/{channel_id}")
async def get_discovered_channel(
    channel_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """Get detailed information about a discovered channel."""
    result = await db.execute(text("""
        SELECT
            dc.*,
            u.username as admin_username,
            c.name as promoted_channel_name
        FROM discovered_channels dc
        LEFT JOIN users u ON u.id = dc.admin_action_by
        LEFT JOIN channels c ON c.id = dc.promoted_to_channel_id
        WHERE dc.id = :channel_id
    """), {"channel_id": channel_id})

    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Discovered channel not found")

    data = dict(row._mapping)

    # Get recent forwards from this channel
    forwards_result = await db.execute(text("""
        SELECT
            mf.id,
            mf.local_message_id,
            mf.original_message_id,
            mf.propagation_seconds,
            mf.social_data_fetched_at,
            mf.created_at,
            m.content as forwarded_content
        FROM message_forwards mf
        JOIN messages m ON m.id = mf.local_message_id
        WHERE mf.discovered_channel_id = :channel_id
        ORDER BY mf.created_at DESC
        LIMIT 10
    """), {"channel_id": channel_id})

    data["recent_forwards"] = [dict(row._mapping) for row in forwards_result.fetchall()]

    return data


@router.post("/{channel_id}/promote")
async def promote_channel(
    channel_id: int,
    request: PromoteRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Promote a discovered channel to full archiving.

    This sends a request to the listener service to add the channel to the
    specified Telegram folder. The listener will then discover it through
    the normal folder sync process, maintaining folder as single source of truth.
    """
    # Get the discovered channel
    result = await db.execute(text("""
        SELECT id, telegram_id, username, name, description, participant_count,
               verified, scam, fake, join_status, admin_action
        FROM discovered_channels
        WHERE id = :id
    """), {"id": channel_id})

    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Discovered channel not found")

    dc = dict(row._mapping)

    # Check if already promoted
    if dc["admin_action"] == "promoted":
        raise HTTPException(status_code=400, detail="Channel already promoted")

    # Must have username to add to folder
    if not dc["username"]:
        raise HTTPException(
            status_code=400,
            detail="Cannot promote channel without username"
        )

    # Check if channel already exists in channels table
    existing = await db.execute(text("""
        SELECT id FROM channels WHERE telegram_id = :tid
    """), {"tid": dc["telegram_id"]})

    if existing.fetchone():
        raise HTTPException(
            status_code=400,
            detail="Channel already exists in monitored channels"
        )

    # Send promotion request to listener via Redis
    request_id = str(uuid.uuid4())
    redis_client = None

    try:
        redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

        # Send promotion request
        await redis_client.xadd(
            "channels:promote",
            {
                "request_id": request_id,
                "username": dc["username"],
                "folder": request.folder or settings.FOLDER_ARCHIVE_ALL_PATTERN,
                "discovered_channel_id": str(channel_id),
            },
        )

        # Wait for result (with timeout)
        result_received = False
        promotion_result = None

        for _ in range(30):  # 30 seconds timeout
            await asyncio.sleep(1)

            # Check for result
            messages = await redis_client.xread(
                {"channels:promote:result": "0"},
                count=100,
            )

            for stream_name, stream_messages in messages:
                for msg_id, data in stream_messages:
                    if data.get("request_id") == request_id:
                        promotion_result = json.loads(data.get("result", "{}"))
                        result_received = True
                        break
                if result_received:
                    break

            if result_received:
                break

        if not result_received:
            raise HTTPException(
                status_code=504,
                detail="Promotion request timed out - listener may be unavailable"
            )

        if not promotion_result.get("success"):
            raise HTTPException(
                status_code=400,
                detail=f"Promotion failed: {promotion_result.get('error', 'Unknown error')}"
            )

        # Update discovered_channels to mark as promoted
        await db.execute(text("""
            UPDATE discovered_channels
            SET admin_action = 'promoted',
                admin_action_at = NOW(),
                admin_action_by = :admin_id,
                updated_at = NOW()
            WHERE id = :id
        """), {
            "id": channel_id,
            "admin_id": admin.user_id,
        })

        await db.commit()

        return {
            "success": True,
            "message": f"Channel '{promotion_result.get('channel_name')}' added to folder '{promotion_result.get('folder_name')}'",
            "folder": promotion_result.get("folder_name"),
            "already_existed": promotion_result.get("already_existed", False),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to promote channel: {str(e)}"
        )
    finally:
        if redis_client:
            await redis_client.aclose()


@router.post("/{channel_id}/ignore")
async def ignore_channel(
    channel_id: int,
    request: IgnoreRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Mark a discovered channel as ignored.

    Ignored channels will not be shown in the default list and will not
    be considered for promotion suggestions.
    """
    result = await db.execute(text("""
        UPDATE discovered_channels
        SET admin_action = 'ignored',
            admin_action_at = NOW(),
            admin_action_by = :admin_id,
            join_status = 'ignored',
            join_error = :reason,
            updated_at = NOW()
        WHERE id = :id
        RETURNING id
    """), {
        "id": channel_id,
        "admin_id": admin.user_id,  # user_id is int, id is str
        "reason": request.reason,
    })

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Discovered channel not found")

    await db.commit()

    return {"success": True, "message": "Channel marked as ignored"}


@router.post("/{channel_id}/retry")
async def retry_join(
    channel_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Reset a failed channel to pending status to retry joining.
    """
    result = await db.execute(text("""
        UPDATE discovered_channels
        SET join_status = 'pending',
            join_error = NULL,
            join_retry_count = 0,
            join_retry_after = NULL,
            updated_at = NOW()
        WHERE id = :id AND join_status IN ('failed', 'ignored')
        RETURNING id
    """), {"id": channel_id})

    if result.rowcount == 0:
        raise HTTPException(
            status_code=400,
            detail="Channel not found or not in retriable status"
        )

    await db.commit()

    return {"success": True, "message": "Channel reset to pending for retry"}


@router.delete("/{channel_id}")
async def delete_discovered(
    channel_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Delete a discovered channel and its associated data.

    This will also delete related message_forwards, original_messages,
    forward_reactions, and forward_comments due to CASCADE.
    """
    result = await db.execute(text("""
        DELETE FROM discovered_channels WHERE id = :id RETURNING id
    """), {"id": channel_id})

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Discovered channel not found")

    await db.commit()

    return {"success": True, "message": "Discovered channel deleted"}
