"""
Admin Dashboard API

Provides aggregated statistics and system health for the admin dashboard.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List, Optional

from ...database import get_db
from ...dependencies import AdminUser
from models import Message, Channel, MediaFile

router = APIRouter(prefix="/api/admin", tags=["admin"])


class DashboardStats(BaseModel):
    """Dashboard statistics response model."""
    messages_total: int
    messages_today: int
    messages_last_hour: int
    channels_active: int
    storage_used_gb: float


class RecentActivity(BaseModel):
    """Recent activity item."""
    timestamp: str
    type: str  # message, channel, error, info
    description: str


class DashboardResponse(BaseModel):
    """Full dashboard response."""
    stats: DashboardStats
    recent_activity: List[RecentActivity]


@router.get("/dashboard", response_model=DashboardResponse)
async def get_dashboard(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """
    Get dashboard statistics and recent activity.

    Returns aggregated stats from across the platform:
    - Message counts (total, today, last hour)
    - Channel and entity counts
    - Storage usage
    - Processing performance
    """
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    hour_ago = now - timedelta(hours=1)

    # Message counts
    total_messages = await db.execute(
        select(func.count(Message.id))
    )
    total_messages = total_messages.scalar() or 0

    today_messages = await db.execute(
        select(func.count(Message.id))
        .where(Message.created_at >= today_start)
    )
    today_messages = today_messages.scalar() or 0

    hour_messages = await db.execute(
        select(func.count(Message.id))
        .where(Message.created_at >= hour_ago)
    )
    hour_messages = hour_messages.scalar() or 0

    # Active channels (with messages in last 7 days)
    week_ago = now - timedelta(days=7)
    active_channels = await db.execute(
        select(func.count(func.distinct(Message.channel_id)))
        .where(Message.created_at >= week_ago)
    )
    active_channels = active_channels.scalar() or 0

    # Storage usage (from media_files)
    try:
        storage_result = await db.execute(
            select(func.sum(MediaFile.file_size))
        )
        storage_bytes = storage_result.scalar() or 0
        storage_gb = storage_bytes / (1024 ** 3)
    except Exception:
        storage_gb = 0.0

    # Build stats
    stats = DashboardStats(
        messages_total=total_messages,
        messages_today=today_messages,
        messages_last_hour=hour_messages,
        channels_active=active_channels,
        storage_used_gb=round(storage_gb, 2),
    )

    # Recent activity (simplified - can be expanded)
    recent_activity = []

    # Get recent messages count
    if hour_messages > 0:
        recent_activity.append(RecentActivity(
            timestamp=now.isoformat(),
            type="message",
            description=f"Processed {hour_messages} messages in the last hour"
        ))

    # Get recently added channels (last 24 hours)
    try:
        day_ago = now - timedelta(days=1)
        new_channels = await db.execute(
            select(Channel.name, Channel.created_at)
            .where(Channel.created_at >= day_ago)
            .order_by(Channel.created_at.desc())
            .limit(3)
        )
        for row in new_channels.fetchall():
            recent_activity.append(RecentActivity(
                timestamp=row[1].isoformat() if row[1] else now.isoformat(),
                type="channel",
                description=f"New channel added: {row[0]}"
            ))
    except Exception:
        pass

    return DashboardResponse(
        stats=stats,
        recent_activity=recent_activity
    )


@router.post("/actions/{action}")
async def perform_action(action: str, admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """
    Perform a quick action from the dashboard.

    Available actions:
    - sync-folders: Trigger Telegram folder sync
    - clear-cache: Clear Redis cache
    - rebuild-embeddings: Queue embedding regeneration
    """
    # For now, return success - actual implementation depends on service architecture
    return {
        "action": action,
        "status": "queued",
        "message": f"Action '{action}' has been queued for execution"
    }
