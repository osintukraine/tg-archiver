"""
Admin System Management Router

Provides endpoints for system administration:
- Worker status (via Redis consumer groups)
- Cache management
- Basic audit log (platform actions)
"""

import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional

import redis.asyncio as redis
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings

from ...database import get_db
from ...dependencies import AdminUser


router = APIRouter(prefix="/api/admin/system", tags=["Admin - System"])


# =============================================================================
# SCHEMAS
# =============================================================================


class WorkerInfo(BaseModel):
    """Worker/consumer information."""
    name: str
    pending: int
    idle_time_ms: Optional[int] = None
    last_delivered_id: Optional[str] = None


class ConsumerGroupInfo(BaseModel):
    """Redis consumer group information."""
    name: str
    stream: str
    consumers: int
    pending: int
    last_delivered_id: Optional[str] = None
    lag: int = 0
    workers: List[WorkerInfo] = []


class WorkersResponse(BaseModel):
    """Response for workers endpoint."""
    groups: List[ConsumerGroupInfo]
    total_consumers: int
    total_pending: int
    total_lag: int
    timestamp: str


# =============================================================================
# WORKERS ENDPOINTS
# =============================================================================


@router.get("/workers", response_model=WorkersResponse)
async def get_workers(admin: AdminUser):
    """
    Get status of all message processing workers.

    Returns Redis consumer group information including:
    - Active workers per group
    - Pending message counts
    - Processing lag
    """
    try:
        redis_client = redis.from_url(settings.REDIS_URL)
        groups: List[ConsumerGroupInfo] = []

        # Check streams that might have consumer groups
        streams = ["telegram:messages", "telegram_messages"]

        for stream in streams:
            try:
                group_infos = await redis_client.xinfo_groups(stream)

                for group in group_infos:
                    group_name = group.get("name", "unknown")

                    workers = []
                    try:
                        consumers = await redis_client.xinfo_consumers(stream, group_name)
                        for consumer in consumers:
                            workers.append(WorkerInfo(
                                name=consumer.get("name", "unknown"),
                                pending=consumer.get("pending", 0),
                                idle_time_ms=consumer.get("idle", 0),
                            ))
                    except Exception:
                        pass

                    groups.append(ConsumerGroupInfo(
                        name=group_name,
                        stream=stream,
                        consumers=group.get("consumers", 0),
                        pending=group.get("pending", 0),
                        lag=group.get("lag", 0),
                        last_delivered_id=group.get("last-delivered-id"),
                        workers=workers,
                    ))

            except Exception as e:
                if "no such key" not in str(e).lower():
                    print(f"Error checking stream {stream}: {e}")
                continue

        await redis_client.close()

        total_consumers = sum(g.consumers for g in groups)
        total_pending = sum(g.pending for g in groups)
        total_lag = sum(g.lag for g in groups)

        return WorkersResponse(
            groups=groups,
            total_consumers=total_consumers,
            total_pending=total_pending,
            total_lag=total_lag,
            timestamp=datetime.utcnow().isoformat(),
        )

    except Exception as e:
        return WorkersResponse(
            groups=[],
            total_consumers=0,
            total_pending=0,
            total_lag=0,
            timestamp=datetime.utcnow().isoformat(),
        )


@router.get("/workers/stats")
async def get_worker_stats(admin: AdminUser):
    """
    Get aggregated worker statistics for dashboard cards.
    """
    try:
        redis_client = redis.from_url(settings.REDIS_URL)

        try:
            stream_info = await redis_client.xinfo_stream("telegram:messages")
            queue_length = stream_info.get("length", 0)
            first_entry = stream_info.get("first-entry")
            last_entry = stream_info.get("last-entry")
        except Exception:
            queue_length = 0
            first_entry = None
            last_entry = None

        total_consumers = 0
        total_pending = 0
        total_lag = 0

        try:
            groups = await redis_client.xinfo_groups("telegram:messages")
            for group in groups:
                total_consumers += group.get("consumers", 0)
                total_pending += group.get("pending", 0)
                total_lag += group.get("lag", 0)
        except Exception:
            pass

        await redis_client.close()

        return {
            "queue_length": queue_length,
            "total_consumers": total_consumers,
            "total_pending": total_pending,
            "total_lag": total_lag,
            "status": "healthy" if total_lag < 100 else "degraded" if total_lag < 1000 else "overloaded",
            "first_entry_id": first_entry[0] if first_entry else None,
            "last_entry_id": last_entry[0] if last_entry else None,
        }

    except Exception as e:
        return {
            "error": str(e),
            "queue_length": 0,
            "total_consumers": 0,
            "status": "unknown",
        }


# =============================================================================
# AUDIT LOG (Platform Actions)
# =============================================================================


@router.get("/audit")
async def get_audit_log(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=200),
    action_type: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Get platform audit log with pagination.

    Tracks admin actions like:
    - Channel additions/removals
    - Message moderation (hide/unhide)
    - Configuration changes
    """
    # For now, return recent channel activity as audit events
    # A proper admin_audit_log table could be added later
    try:
        offset = (page - 1) * page_size

        # Get recent channel changes as audit entries
        result = await db.execute(text("""
            SELECT
                id,
                'channel_added' as action_type,
                name as target_name,
                telegram_id::text as target_id,
                created_at as action_time,
                'system' as actor
            FROM channels
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """), {"limit": page_size, "offset": offset})

        items = []
        for row in result.fetchall():
            items.append({
                "id": row[0],
                "action_type": row[1],
                "target_name": row[2],
                "target_id": row[3],
                "action_time": row[4].isoformat() if row[4] else None,
                "actor": row[5],
            })

        # Get total count
        count_result = await db.execute(text("SELECT COUNT(*) FROM channels"))
        total = count_result.scalar() or 0
        total_pages = (total + page_size - 1) // page_size

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    except Exception as e:
        return {
            "error": str(e),
            "items": [],
            "total": 0,
            "page": page,
            "page_size": page_size,
            "total_pages": 0,
        }


@router.get("/audit/stats")
async def get_audit_stats(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """
    Get audit statistics summary.
    """
    try:
        result = await db.execute(text("""
            SELECT
                (SELECT COUNT(*) FROM channels) as total_channels,
                (SELECT COUNT(*) FROM channels WHERE created_at > NOW() - INTERVAL '24 hours') as channels_24h,
                (SELECT COUNT(*) FROM messages) as total_messages,
                (SELECT COUNT(*) FROM messages WHERE is_hidden = true) as hidden_messages
        """))

        row = result.fetchone()

        return {
            "channels": {
                "total": row[0] or 0,
                "added_last_24h": row[1] or 0,
            },
            "messages": {
                "total": row[2] or 0,
                "hidden": row[3] or 0,
            },
        }

    except Exception as e:
        return {"error": str(e)}


# =============================================================================
# CACHE MANAGEMENT
# =============================================================================


@router.get("/cache/stats")
async def get_cache_stats(admin: AdminUser):
    """
    Get Redis cache statistics.
    """
    try:
        redis_client = redis.from_url(settings.REDIS_URL)
        info = await redis_client.info()

        await redis_client.close()

        return {
            "used_memory": info.get("used_memory_human", "unknown"),
            "used_memory_peak": info.get("used_memory_peak_human", "unknown"),
            "connected_clients": info.get("connected_clients", 0),
            "total_connections_received": info.get("total_connections_received", 0),
            "total_commands_processed": info.get("total_commands_processed", 0),
            "keyspace_hits": info.get("keyspace_hits", 0),
            "keyspace_misses": info.get("keyspace_misses", 0),
            "hit_rate": round(
                info.get("keyspace_hits", 0) /
                max(info.get("keyspace_hits", 0) + info.get("keyspace_misses", 0), 1) * 100,
                1
            ),
            "uptime_seconds": info.get("uptime_in_seconds", 0),
            "redis_version": info.get("redis_version", "unknown"),
        }

    except Exception as e:
        return {"error": str(e)}


@router.post("/cache/clear")
async def clear_cache(
    admin: AdminUser,
    pattern: Optional[str] = Query(None, description="Key pattern to clear (e.g., 'feed:*')"),
):
    """
    Clear cache keys matching pattern.

    Use with caution - clearing all keys can impact performance.
    """
    try:
        redis_client = redis.from_url(settings.REDIS_URL)

        if pattern:
            cursor = 0
            deleted = 0
            while True:
                cursor, keys = await redis_client.scan(cursor, match=pattern, count=100)
                if keys:
                    deleted += await redis_client.delete(*keys)
                if cursor == 0:
                    break

            await redis_client.close()
            return {"success": True, "deleted_keys": deleted, "pattern": pattern}
        else:
            await redis_client.close()
            return {"error": "Pattern required. Use pattern='*' to clear all (dangerous)."}

    except Exception as e:
        return {"error": str(e)}
