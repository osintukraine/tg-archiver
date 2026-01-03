"""
Admin Message Actions API

Provides moderation actions for the admin sidebar on message detail pages.
Simplified for tg-archiver (no AI/enrichment features).
"""

import json
import logging
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...dependencies import AdminUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/messages", tags=["admin-message-actions"])


# =============================================================================
# REQUEST/RESPONSE MODELS
# =============================================================================

class ActionResponse(BaseModel):
    """Standard response for admin actions."""
    success: bool
    message_id: int
    action: str
    previous_value: Optional[str] = None
    new_value: Optional[str] = None


class ReasonRequest(BaseModel):
    """Request with optional reason."""
    reason: Optional[str] = None


class NoteRequest(BaseModel):
    """Request to add admin note."""
    note: str = Field(..., min_length=1, max_length=5000)


class TopicRequest(BaseModel):
    """Request to set message topic."""
    topic: Optional[str] = None  # None to clear topic


class MessageActionsInfo(BaseModel):
    """Info about admin actions on a message."""
    message_id: int
    is_hidden: bool
    admin_notes: Optional[str]


# =============================================================================
# AUDIT LOG MODELS
# =============================================================================

class AdminAction(BaseModel):
    """Admin action audit log entry."""
    id: int
    action: str
    resource_type: str
    resource_id: int
    details: dict
    admin_id: Optional[str]
    admin_email: Optional[str]
    ip_address: Optional[str]
    created_at: Optional[str]


class AdminActionsStats(BaseModel):
    """Audit log statistics."""
    total_actions: int
    actions_last_hour: int
    actions_last_24h: int
    by_action_type: dict
    by_admin: dict


class AdminActionsListResponse(BaseModel):
    """Paginated list of admin actions."""
    actions: List[AdminAction]
    total: int
    page: int
    page_size: int


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_client_ip(request: Request) -> str:
    """Get client IP from request, handling proxies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def get_message_or_404(db: AsyncSession, message_id: int) -> dict:
    """Fetch message or raise 404."""
    result = await db.execute(text("""
        SELECT id, is_hidden, admin_notes
        FROM messages
        WHERE id = :id
    """), {"id": message_id})
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    return dict(row._mapping)


async def log_admin_action(
    db: AsyncSession,
    action: str,
    resource_id: int,
    admin: AdminUser,
    request: Request,
    details: Optional[dict] = None,
    resource_type: str = "message",
):
    """Log an admin action to the audit table."""
    try:
        await db.execute(text("""
            INSERT INTO admin_actions (action, resource_type, resource_id, details, admin_id, admin_email, ip_address, created_at)
            VALUES (:action, :resource_type, :resource_id, :details, :admin_id, :admin_email, :ip_address, NOW())
        """), {
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": json.dumps(details or {}),
            "admin_id": str(admin.user_id) if admin.user_id else None,
            "admin_email": admin.email if hasattr(admin, 'email') else None,
            "ip_address": get_client_ip(request),
        })
    except Exception as e:
        logger.warning(f"Failed to log admin action: {e}")


# =============================================================================
# AUDIT LOG ENDPOINTS (STATIC ROUTES - MUST BE BEFORE DYNAMIC ROUTES)
# =============================================================================

@router.get("/audit/actions/stats", response_model=AdminActionsStats)
async def get_audit_stats(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Get audit log statistics."""
    # Total actions
    total_result = await db.execute(text("SELECT COUNT(*) FROM admin_actions"))
    total_actions = total_result.scalar() or 0

    # Actions last hour
    hour_result = await db.execute(text("""
        SELECT COUNT(*) FROM admin_actions
        WHERE created_at >= NOW() - INTERVAL '1 hour'
    """))
    actions_last_hour = hour_result.scalar() or 0

    # Actions last 24h
    day_result = await db.execute(text("""
        SELECT COUNT(*) FROM admin_actions
        WHERE created_at >= NOW() - INTERVAL '24 hours'
    """))
    actions_last_24h = day_result.scalar() or 0

    # By action type
    by_type_result = await db.execute(text("""
        SELECT action, COUNT(*) as count
        FROM admin_actions
        GROUP BY action
        ORDER BY count DESC
        LIMIT 10
    """))
    by_action_type = {row[0]: row[1] for row in by_type_result.fetchall()}

    # By admin
    by_admin_result = await db.execute(text("""
        SELECT COALESCE(admin_email, admin_id, 'Unknown'), COUNT(*) as count
        FROM admin_actions
        GROUP BY COALESCE(admin_email, admin_id, 'Unknown')
        ORDER BY count DESC
        LIMIT 10
    """))
    by_admin = {str(row[0]): row[1] for row in by_admin_result.fetchall()}

    return AdminActionsStats(
        total_actions=total_actions,
        actions_last_hour=actions_last_hour,
        actions_last_24h=actions_last_24h,
        by_action_type=by_action_type,
        by_admin=by_admin,
    )


@router.get("/audit/actions")
async def get_audit_actions(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    action_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Get paginated list of admin actions."""
    try:
        offset = (page - 1) * page_size

        # Build query
        base_query = """
            SELECT id, action, resource_type, resource_id, details,
                   admin_id, admin_email, ip_address, created_at
            FROM admin_actions
        """
        count_query = "SELECT COUNT(*) FROM admin_actions"
        params = {"limit": page_size, "offset": offset}

        if action_type:
            base_query += " WHERE action = :action_type"
            count_query += " WHERE action = :action_type"
            params["action_type"] = action_type

        base_query += " ORDER BY created_at DESC LIMIT :limit OFFSET :offset"

        # Execute queries
        result = await db.execute(text(base_query), params)
        rows = result.fetchall()

        count_result = await db.execute(
            text(count_query),
            {"action_type": action_type} if action_type else {}
        )
        total = count_result.scalar() or 0

        actions = []
        for row in rows:
            details = row[4]
            if isinstance(details, str):
                try:
                    details = json.loads(details)
                except:
                    details = {}

            actions.append({
                "id": row[0],
                "action": row[1],
                "resource_type": row[2],
                "resource_id": row[3],
                "details": details or {},
                "admin_id": row[5],
                "admin_email": row[6],
                "ip_address": row[7],
                "created_at": row[8].isoformat() if row[8] else "",
            })

        return {
            "actions": actions,
            "total": total,
            "page": page,
            "page_size": page_size,
        }
    except Exception as e:
        logger.error(f"Error in get_audit_actions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# MESSAGE INFO ENDPOINT (DYNAMIC ROUTES - AFTER STATIC ROUTES)
# =============================================================================

@router.get("/{message_id}/actions", response_model=MessageActionsInfo)
async def get_message_actions_info(
    message_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Get current admin action state for a message.
    """
    msg = await get_message_or_404(db, message_id)

    return MessageActionsInfo(
        message_id=message_id,
        is_hidden=msg.get("is_hidden") or False,
        admin_notes=msg.get("admin_notes"),
    )


# =============================================================================
# MODERATION ACTIONS
# =============================================================================

@router.post("/{message_id}/hide", response_model=ActionResponse)
async def hide_message(
    message_id: int,
    request: Request,
    body: ReasonRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Hide message from public view (soft hide, reversible)."""
    msg = await get_message_or_404(db, message_id)

    if msg.get("is_hidden"):
        raise HTTPException(status_code=409, detail="Message is already hidden")

    await db.execute(text("""
        UPDATE messages
        SET is_hidden = TRUE,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": message_id})

    await db.commit()

    logger.info(f"Message {message_id} hidden by admin {admin.user_id}")

    # Log the action
    await log_admin_action(db, "message.hidden", message_id, admin, request, {
        "reason": body.reason,
    })

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="hidden",
        previous_value="visible",
        new_value="hidden",
    )


@router.post("/{message_id}/unhide", response_model=ActionResponse)
async def unhide_message(
    message_id: int,
    request: Request,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Unhide a previously hidden message."""
    msg = await get_message_or_404(db, message_id)

    if not msg.get("is_hidden"):
        raise HTTPException(status_code=409, detail="Message is not hidden")

    await db.execute(text("""
        UPDATE messages
        SET is_hidden = FALSE,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": message_id})

    await db.commit()

    logger.info(f"Message {message_id} unhidden by admin {admin.user_id}")

    # Log the action
    await log_admin_action(db, "message.unhidden", message_id, admin, request, {})

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="unhidden",
        previous_value="hidden",
        new_value="visible",
    )


@router.post("/{message_id}/quarantine", response_model=ActionResponse)
async def quarantine_message(
    message_id: int,
    request: Request,
    body: ReasonRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Move message to quarantine."""
    msg = await get_message_or_404(db, message_id)

    # Copy to quarantine table
    await db.execute(text("""
        INSERT INTO message_quarantine (
            channel_id, message_id, content, media_type, telegram_date,
            quarantine_reason, quarantine_details, created_at
        )
        SELECT
            m.channel_id, m.message_id, m.content, m.media_type, m.telegram_date,
            :reason, '{"source": "admin_action"}'::jsonb, NOW()
        FROM messages m
        WHERE m.id = :id
        ON CONFLICT (channel_id, message_id) DO NOTHING
    """), {
        "id": message_id,
        "reason": body.reason or "Admin quarantined",
    })

    # Hide the original
    await db.execute(text("""
        UPDATE messages
        SET is_hidden = TRUE,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": message_id})

    await db.commit()

    logger.info(f"Message {message_id} quarantined by admin {admin.user_id}")

    # Log the action
    await log_admin_action(db, "message.quarantined", message_id, admin, request, {
        "reason": body.reason,
    })

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="quarantined",
        previous_value="active",
        new_value="quarantined",
    )


@router.post("/{message_id}/note", response_model=ActionResponse)
async def add_admin_note(
    message_id: int,
    request: Request,
    body: NoteRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Add or update admin note on message."""
    msg = await get_message_or_404(db, message_id)

    previous_note = msg.get("admin_notes")

    await db.execute(text("""
        UPDATE messages
        SET admin_notes = :note,
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "note": body.note,
    })

    await db.commit()

    # Log the action
    await log_admin_action(db, "message.note_added", message_id, admin, request, {
        "previous_note": previous_note,
        "new_note": body.note,
    })

    logger.info(f"Admin note added to message {message_id} by admin {admin.user_id}")

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="note_added",
        previous_value=previous_note,
        new_value=body.note,
    )


@router.post("/{message_id}/topic", response_model=ActionResponse)
async def set_message_topic(
    message_id: int,
    request: Request,
    body: TopicRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Set or clear topic for a message."""
    msg = await get_message_or_404(db, message_id)

    # Get previous topic
    result = await db.execute(text(
        "SELECT topic FROM messages WHERE id = :id"
    ), {"id": message_id})
    row = result.fetchone()
    previous_topic = row[0] if row else None

    await db.execute(text("""
        UPDATE messages
        SET topic = :topic,
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "topic": body.topic,
    })

    await db.commit()

    # Log the action
    await log_admin_action(db, "message.topic_changed", message_id, admin, request, {
        "previous_topic": previous_topic,
        "new_topic": body.topic,
    })

    logger.info(f"Topic set to '{body.topic}' for message {message_id} by admin {admin.user_id}")

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="topic_changed",
        previous_value=previous_topic,
        new_value=body.topic,
    )
