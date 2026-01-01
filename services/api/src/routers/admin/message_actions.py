"""
Admin Message Actions API

Provides moderation actions for the admin sidebar on message detail pages.
All actions are logged to admin_audit_log for accountability.
"""

import json
import logging
from datetime import datetime
from typing import Optional, List
from uuid import UUID

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
    audit_id: int


class ReasonRequest(BaseModel):
    """Request with optional reason."""
    reason: Optional[str] = None


class TopicChangeRequest(BaseModel):
    """Request to change message topic."""
    topic: str = Field(..., pattern="^(combat|equipment|casualties|movements|infrastructure|humanitarian|diplomatic|intelligence|propaganda|units|locations|general)$")
    reason: Optional[str] = None


class ImportanceChangeRequest(BaseModel):
    """Request to change message importance."""
    importance: str = Field(..., pattern="^(high|medium|low)$")
    reason: Optional[str] = None


class NoteRequest(BaseModel):
    """Request to add admin note."""
    note: str = Field(..., min_length=1, max_length=5000)


class GeolocationRequest(BaseModel):
    """Request to add/change geolocation."""
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    location_name: Optional[str] = None
    reason: Optional[str] = None


class LinkEventRequest(BaseModel):
    """Request to link message to event."""
    event_id: int
    reason: Optional[str] = None


class MessageActionHistory(BaseModel):
    """Action history item for a message."""
    action: str
    performed_by: Optional[str]
    performed_at: datetime
    details: dict


class MessageActionsInfo(BaseModel):
    """Full info about admin actions on a message."""
    message_id: int
    is_hidden: bool
    is_deleted: bool
    is_spam: bool
    topic_override: Optional[str]
    importance_override: Optional[str]
    admin_notes: Optional[str]
    has_location: bool
    primary_event_id: Optional[int]
    history: List[MessageActionHistory]


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_client_ip(request: Request) -> str:
    """Get client IP from request, handling proxies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def log_audit(
    db: AsyncSession,
    admin_id: str,
    action: str,
    resource_id: int,
    details: dict,
    ip_address: str
) -> int:
    """Log action to admin_audit_log and return the audit ID."""
    result = await db.execute(text("""
        INSERT INTO admin_audit_log
        (kratos_identity_id, action, resource_type, resource_id, details, ip_address)
        VALUES (:admin_id, :action, 'message', :resource_id, :details, :ip_address)
        RETURNING id
    """), {
        "admin_id": admin_id,
        "action": action,
        "resource_id": resource_id,
        "details": json.dumps(details),
        "ip_address": ip_address,
    })
    row = result.fetchone()
    return row[0] if row else 0


async def get_message_or_404(db: AsyncSession, message_id: int) -> dict:
    """Fetch message or raise 404."""
    result = await db.execute(text("""
        SELECT id, osint_topic, importance_level, is_spam, admin_hidden,
               deleted_at, admin_topic_override, admin_importance_override,
               admin_notes, primary_event_id
        FROM messages
        WHERE id = :id
    """), {"id": message_id})
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")
    return dict(row._mapping)


# =============================================================================
# AUDIT LOG LISTING (Must be before /{message_id} routes to avoid path conflict)
# =============================================================================

class AdminActionItem(BaseModel):
    """Admin action log item for audit display."""
    id: int
    action: str
    resource_type: str
    resource_id: int
    details: dict
    admin_id: Optional[str]
    admin_email: Optional[str] = None
    ip_address: Optional[str]
    created_at: datetime


class AdminActionsListResponse(BaseModel):
    """Response for admin actions list."""
    actions: List[AdminActionItem]
    total: int
    page: int
    page_size: int


class AdminActionsStats(BaseModel):
    """Statistics for admin actions."""
    total_actions: int
    actions_last_hour: int
    actions_last_24h: int
    by_action_type: dict
    by_admin: dict


@router.get("/audit/actions", response_model=AdminActionsListResponse)
async def list_admin_actions(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    action_type: Optional[str] = Query(None),
    resource_id: Optional[int] = Query(None),
):
    """
    List admin message actions from audit log.

    Query params:
    - action_type: Filter by action (e.g., 'message.hidden', 'message.deleted')
    - resource_id: Filter by specific message ID
    """
    offset = (page - 1) * page_size

    # Build query
    where_clauses = ["resource_type = 'message'"]
    params = {"limit": page_size, "offset": offset}

    if action_type:
        where_clauses.append("action = :action_type")
        params["action_type"] = action_type

    if resource_id:
        where_clauses.append("resource_id = :resource_id")
        params["resource_id"] = resource_id

    where_sql = " AND ".join(where_clauses)

    # Get total count
    count_result = await db.execute(text(f"""
        SELECT COUNT(*) FROM admin_audit_log WHERE {where_sql}
    """), params)
    total = count_result.scalar() or 0

    # Get actions with admin email from Kratos identity_verifiable_addresses
    result = await db.execute(text(f"""
        SELECT
            a.id,
            a.action,
            a.resource_type,
            a.resource_id,
            a.details,
            a.kratos_identity_id,
            a.ip_address,
            a.created_at,
            iva.value as admin_email
        FROM admin_audit_log a
        LEFT JOIN identity_verifiable_addresses iva
            ON a.kratos_identity_id = iva.identity_id AND iva.via = 'email'
        WHERE {where_sql.replace('resource_type', 'a.resource_type').replace('action =', 'a.action =').replace('created_at', 'a.created_at')}
        ORDER BY a.created_at DESC
        LIMIT :limit OFFSET :offset
    """), params)

    actions = []
    for row in result.fetchall():
        # details is already a dict from JSONB, only parse if it's a string
        details = row.details if isinstance(row.details, dict) else (json.loads(row.details) if row.details else {})
        actions.append(AdminActionItem(
            id=row.id,
            action=row.action,
            resource_type=row.resource_type,
            resource_id=row.resource_id,
            details=details,
            admin_id=str(row.kratos_identity_id) if row.kratos_identity_id else None,
            admin_email=row.admin_email,
            ip_address=str(row.ip_address) if row.ip_address else None,
            created_at=row.created_at
        ))

    return AdminActionsListResponse(
        actions=actions,
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/audit/actions/stats", response_model=AdminActionsStats)
async def get_admin_actions_stats(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Get statistics for admin message actions."""

    # Total actions
    total_result = await db.execute(text("""
        SELECT COUNT(*) FROM admin_audit_log WHERE resource_type = 'message'
    """))
    total = total_result.scalar() or 0

    # Last hour
    hour_result = await db.execute(text("""
        SELECT COUNT(*) FROM admin_audit_log
        WHERE resource_type = 'message'
        AND created_at > NOW() - INTERVAL '1 hour'
    """))
    last_hour = hour_result.scalar() or 0

    # Last 24h
    day_result = await db.execute(text("""
        SELECT COUNT(*) FROM admin_audit_log
        WHERE resource_type = 'message'
        AND created_at > NOW() - INTERVAL '24 hours'
    """))
    last_24h = day_result.scalar() or 0

    # By action type
    by_action_result = await db.execute(text("""
        SELECT action, COUNT(*) as count
        FROM admin_audit_log
        WHERE resource_type = 'message'
        GROUP BY action
        ORDER BY count DESC
    """))
    by_action = {row.action: row.count for row in by_action_result.fetchall()}

    # By admin (join with Kratos identity_verifiable_addresses to get email)
    by_admin_result = await db.execute(text("""
        SELECT
            COALESCE(iva.value, a.kratos_identity_id::text) as admin,
            COUNT(*) as count
        FROM admin_audit_log a
        LEFT JOIN identity_verifiable_addresses iva
            ON a.kratos_identity_id = iva.identity_id AND iva.via = 'email'
        WHERE a.resource_type = 'message'
        GROUP BY COALESCE(iva.value, a.kratos_identity_id::text)
        ORDER BY count DESC
        LIMIT 10
    """))
    by_admin = {row.admin: row.count for row in by_admin_result.fetchall()}

    return AdminActionsStats(
        total_actions=total,
        actions_last_hour=last_hour,
        actions_last_24h=last_24h,
        by_action_type=by_action,
        by_admin=by_admin
    )


# =============================================================================
# INFO ENDPOINT
# =============================================================================

@router.get("/{message_id}/actions", response_model=MessageActionsInfo)
async def get_message_actions_info(
    message_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Get current admin action state and history for a message.
    Used by the sidebar to show current state and recent actions.
    """
    msg = await get_message_or_404(db, message_id)

    # Check if message has location
    loc_result = await db.execute(text("""
        SELECT id FROM message_locations WHERE message_id = :id LIMIT 1
    """), {"id": message_id})
    has_location = loc_result.fetchone() is not None

    # Get action history
    history_result = await db.execute(text("""
        SELECT action, kratos_identity_id, created_at, details
        FROM admin_audit_log
        WHERE resource_type = 'message' AND resource_id = :id
        ORDER BY created_at DESC
        LIMIT 10
    """), {"id": message_id})

    history = []
    for row in history_result.fetchall():
        # details is already a dict from JSONB, only parse if it's a string
        details = row.details if isinstance(row.details, dict) else (json.loads(row.details) if row.details else {})
        history.append(MessageActionHistory(
            action=row.action,
            performed_by=str(row.kratos_identity_id) if row.kratos_identity_id else None,
            performed_at=row.created_at,
            details=details
        ))

    return MessageActionsInfo(
        message_id=message_id,
        is_hidden=msg.get("admin_hidden") or False,
        is_deleted=msg.get("deleted_at") is not None,
        is_spam=msg.get("is_spam") or False,
        topic_override=msg.get("admin_topic_override"),
        importance_override=msg.get("admin_importance_override"),
        admin_notes=msg.get("admin_notes"),
        has_location=has_location,
        primary_event_id=msg.get("primary_event_id"),
        history=history
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

    if msg.get("admin_hidden"):
        raise HTTPException(status_code=409, detail="Message is already hidden")

    await db.execute(text("""
        UPDATE messages
        SET admin_hidden = TRUE,
            admin_hidden_at = NOW(),
            admin_hidden_by = :admin_id,
            admin_hidden_reason = :reason,
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "admin_id": str(admin.user_id),
        "reason": body.reason,
    })

    audit_id = await log_audit(
        db, str(admin.user_id), "message.hidden", message_id,
        {"reason": body.reason},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="hidden",
        previous_value="visible",
        new_value="hidden",
        audit_id=audit_id
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

    if not msg.get("admin_hidden"):
        raise HTTPException(status_code=409, detail="Message is not hidden")

    await db.execute(text("""
        UPDATE messages
        SET admin_hidden = FALSE,
            admin_hidden_at = NULL,
            admin_hidden_by = NULL,
            admin_hidden_reason = NULL,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": message_id})

    audit_id = await log_audit(
        db, str(admin.user_id), "message.unhidden", message_id,
        {},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="unhidden",
        previous_value="hidden",
        new_value="visible",
        audit_id=audit_id
    )


@router.post("/{message_id}/delete", response_model=ActionResponse)
async def delete_message(
    message_id: int,
    request: Request,
    body: ReasonRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Soft delete message (sets deleted_at, can be recovered)."""
    msg = await get_message_or_404(db, message_id)

    if msg.get("deleted_at"):
        raise HTTPException(status_code=409, detail="Message is already deleted")

    # Check if message has media for audit trail
    media_result = await db.execute(text("""
        SELECT COUNT(*) FROM message_media WHERE message_id = :id
    """), {"id": message_id})
    has_media = media_result.scalar() > 0

    await db.execute(text("""
        UPDATE messages
        SET deleted_at = NOW(),
            deleted_by = :admin_id,
            deletion_reason = :reason,
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "admin_id": str(admin.user_id),
        "reason": body.reason,
    })

    audit_id = await log_audit(
        db, str(admin.user_id), "message.deleted", message_id,
        {"reason": body.reason, "had_media": has_media},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="deleted",
        previous_value="active",
        new_value="deleted",
        audit_id=audit_id
    )


@router.post("/{message_id}/spam", response_model=ActionResponse)
async def mark_as_spam(
    message_id: int,
    request: Request,
    body: ReasonRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Mark message as spam (admin override of AI classification)."""
    msg = await get_message_or_404(db, message_id)

    previous_spam = msg.get("is_spam") or False

    await db.execute(text("""
        UPDATE messages
        SET is_spam = TRUE,
            spam_reason = :reason,
            spam_review_status = 'true_positive',
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "reason": body.reason or "Admin marked as spam",
    })

    audit_id = await log_audit(
        db, str(admin.user_id), "message.marked_spam", message_id,
        {"reason": body.reason, "previous_spam": previous_spam},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="marked_spam",
        previous_value=str(previous_spam),
        new_value="True",
        audit_id=audit_id
    )


@router.post("/{message_id}/unspam", response_model=ActionResponse)
async def unmark_spam(
    message_id: int,
    request: Request,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Remove spam flag from message (false positive correction)."""
    msg = await get_message_or_404(db, message_id)

    if not msg.get("is_spam"):
        raise HTTPException(status_code=409, detail="Message is not marked as spam")

    await db.execute(text("""
        UPDATE messages
        SET is_spam = FALSE,
            spam_review_status = 'false_positive',
            updated_at = NOW()
        WHERE id = :id
    """), {"id": message_id})

    audit_id = await log_audit(
        db, str(admin.user_id), "message.unmarked_spam", message_id,
        {},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="unmarked_spam",
        previous_value="True",
        new_value="False",
        audit_id=audit_id
    )


@router.post("/{message_id}/quarantine", response_model=ActionResponse)
async def quarantine_message(
    message_id: int,
    request: Request,
    body: ReasonRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Move message to quarantine (off-topic review queue)."""
    msg = await get_message_or_404(db, message_id)

    # Copy to quarantine table
    await db.execute(text("""
        INSERT INTO message_quarantine (
            original_message_id, channel_id, message_id, content, telegram_date,
            language_detected, content_translated, media_type, quarantine_reason,
            quarantine_source, created_at
        )
        SELECT
            m.id, m.channel_id, m.message_id, m.content, m.telegram_date,
            m.language_detected, m.content_translated, m.media_type,
            :reason, 'admin_action', NOW()
        FROM messages m
        WHERE m.id = :id
    """), {
        "id": message_id,
        "reason": body.reason or "Admin quarantined",
    })

    # Soft delete the original
    await db.execute(text("""
        UPDATE messages
        SET deleted_at = NOW(),
            deleted_by = :admin_id,
            deletion_reason = 'Quarantined: ' || COALESCE(:reason, 'Admin action'),
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "admin_id": str(admin.user_id),
        "reason": body.reason,
    })

    audit_id = await log_audit(
        db, str(admin.user_id), "message.quarantined", message_id,
        {"reason": body.reason},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="quarantined",
        previous_value="active",
        new_value="quarantined",
        audit_id=audit_id
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
            admin_notes_updated_at = NOW(),
            admin_notes_updated_by = :admin_id,
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "note": body.note,
        "admin_id": str(admin.user_id),
    })

    audit_id = await log_audit(
        db, str(admin.user_id), "message.note_added", message_id,
        {"note": body.note, "previous_note": previous_note},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="note_added",
        previous_value=previous_note,
        new_value=body.note,
        audit_id=audit_id
    )


# =============================================================================
# CLASSIFICATION ACTIONS
# =============================================================================

@router.post("/{message_id}/topic", response_model=ActionResponse)
async def change_topic(
    message_id: int,
    request: Request,
    body: TopicChangeRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Override AI-assigned topic."""
    msg = await get_message_or_404(db, message_id)

    previous_topic = msg.get("admin_topic_override") or msg.get("osint_topic")

    await db.execute(text("""
        UPDATE messages
        SET admin_topic_override = :topic,
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "topic": body.topic,
    })

    audit_id = await log_audit(
        db, str(admin.user_id), "message.topic_changed", message_id,
        {"previous": previous_topic, "new": body.topic, "reason": body.reason},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="topic_changed",
        previous_value=previous_topic,
        new_value=body.topic,
        audit_id=audit_id
    )


@router.post("/{message_id}/importance", response_model=ActionResponse)
async def change_importance(
    message_id: int,
    request: Request,
    body: ImportanceChangeRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Override AI-assigned importance level."""
    msg = await get_message_or_404(db, message_id)

    previous_importance = msg.get("admin_importance_override") or msg.get("importance_level")

    await db.execute(text("""
        UPDATE messages
        SET admin_importance_override = :importance,
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "importance": body.importance,
    })

    audit_id = await log_audit(
        db, str(admin.user_id), "message.importance_changed", message_id,
        {"previous": previous_importance, "new": body.importance, "reason": body.reason},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="importance_changed",
        previous_value=previous_importance,
        new_value=body.importance,
        audit_id=audit_id
    )


@router.post("/{message_id}/reprocess", response_model=ActionResponse)
async def reprocess_message(
    message_id: int,
    request: Request,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Queue message for AI reprocessing."""
    msg = await get_message_or_404(db, message_id)

    # Flag for reprocessing by updating decision_log
    await db.execute(text("""
        UPDATE decision_log
        SET verification_status = 'pending_reprocess'
        WHERE message_id = :id
        AND decision_type = 'classification'
        AND verification_status != 'pending_reprocess'
    """), {"id": message_id})

    # Also flag the message for needs_human_review to trigger reprocess
    await db.execute(text("""
        UPDATE messages
        SET needs_human_review = TRUE,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": message_id})

    audit_id = await log_audit(
        db, str(admin.user_id), "message.reprocessed", message_id,
        {"triggered_by": "admin"},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="reprocessed",
        previous_value=None,
        new_value="queued",
        audit_id=audit_id
    )


# =============================================================================
# GEOLOCATION ACTIONS
# =============================================================================

@router.post("/{message_id}/geolocation", response_model=ActionResponse)
async def set_geolocation(
    message_id: int,
    request: Request,
    body: GeolocationRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Add or update message geolocation."""
    msg = await get_message_or_404(db, message_id)

    # Check for existing location
    existing = await db.execute(text("""
        SELECT id, latitude, longitude, location_name
        FROM message_locations
        WHERE message_id = :id
        LIMIT 1
    """), {"id": message_id})
    existing_row = existing.fetchone()

    previous_location = None
    if existing_row:
        previous_location = {
            "lat": float(existing_row.latitude),
            "lng": float(existing_row.longitude),
            "name": existing_row.location_name
        }

        # Update existing
        await db.execute(text("""
            UPDATE message_locations
            SET latitude = :lat,
                longitude = :lng,
                location_name = :name,
                source = 'admin',
                confidence = 1.0,
                updated_at = NOW()
            WHERE message_id = :id
        """), {
            "id": message_id,
            "lat": body.latitude,
            "lng": body.longitude,
            "name": body.location_name,
        })
        action = "message.geolocation_changed"
    else:
        # Insert new
        await db.execute(text("""
            INSERT INTO message_locations (message_id, latitude, longitude, location_name, source, confidence, created_at)
            VALUES (:id, :lat, :lng, :name, 'admin', 1.0, NOW())
        """), {
            "id": message_id,
            "lat": body.latitude,
            "lng": body.longitude,
            "name": body.location_name,
        })
        action = "message.geolocation_added"

    new_location = {
        "lat": body.latitude,
        "lng": body.longitude,
        "name": body.location_name
    }

    audit_id = await log_audit(
        db, str(admin.user_id), action, message_id,
        {"previous": previous_location, "new": new_location, "reason": body.reason},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action=action.replace("message.", ""),
        previous_value=json.dumps(previous_location) if previous_location else None,
        new_value=json.dumps(new_location),
        audit_id=audit_id
    )


@router.delete("/{message_id}/geolocation", response_model=ActionResponse)
async def remove_geolocation(
    message_id: int,
    request: Request,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Remove geolocation from message."""
    msg = await get_message_or_404(db, message_id)

    # Get existing location for audit
    existing = await db.execute(text("""
        SELECT latitude, longitude, location_name
        FROM message_locations
        WHERE message_id = :id
        LIMIT 1
    """), {"id": message_id})
    existing_row = existing.fetchone()

    if not existing_row:
        raise HTTPException(status_code=404, detail="Message has no location")

    previous_location = {
        "lat": float(existing_row.latitude),
        "lng": float(existing_row.longitude),
        "name": existing_row.location_name
    }

    await db.execute(text("""
        DELETE FROM message_locations WHERE message_id = :id
    """), {"id": message_id})

    audit_id = await log_audit(
        db, str(admin.user_id), "message.geolocation_removed", message_id,
        {"previous": previous_location},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="geolocation_removed",
        previous_value=json.dumps(previous_location),
        new_value=None,
        audit_id=audit_id
    )


# =============================================================================
# EVENT LINKING ACTIONS
# =============================================================================

@router.post("/{message_id}/link-event", response_model=ActionResponse)
async def link_to_event(
    message_id: int,
    request: Request,
    body: LinkEventRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Link message to an event cluster."""
    msg = await get_message_or_404(db, message_id)

    # Verify event exists
    event_result = await db.execute(text("""
        SELECT id, title FROM telegram_event_clusters WHERE id = :id
    """), {"id": body.event_id})
    event = event_result.fetchone()

    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    previous_event_id = msg.get("primary_event_id")

    # Update message's primary event
    await db.execute(text("""
        UPDATE messages
        SET primary_event_id = :event_id,
            updated_at = NOW()
        WHERE id = :id
    """), {
        "id": message_id,
        "event_id": body.event_id,
    })

    # Also add to cluster_messages junction if not exists
    await db.execute(text("""
        INSERT INTO cluster_messages (cluster_id, message_id, added_at)
        VALUES (:cluster_id, :message_id, NOW())
        ON CONFLICT (cluster_id, message_id) DO NOTHING
    """), {
        "cluster_id": body.event_id,
        "message_id": message_id,
    })

    audit_id = await log_audit(
        db, str(admin.user_id), "message.event_linked", message_id,
        {
            "event_id": body.event_id,
            "event_title": event.title,
            "previous_event_id": previous_event_id,
            "reason": body.reason
        },
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="event_linked",
        previous_value=str(previous_event_id) if previous_event_id else None,
        new_value=str(body.event_id),
        audit_id=audit_id
    )


@router.delete("/{message_id}/link-event", response_model=ActionResponse)
async def unlink_from_event(
    message_id: int,
    request: Request,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """Remove message from its event cluster."""
    msg = await get_message_or_404(db, message_id)

    previous_event_id = msg.get("primary_event_id")

    if not previous_event_id:
        raise HTTPException(status_code=409, detail="Message is not linked to any event")

    # Remove from cluster_messages
    await db.execute(text("""
        DELETE FROM cluster_messages WHERE message_id = :id
    """), {"id": message_id})

    # Clear primary event
    await db.execute(text("""
        UPDATE messages
        SET primary_event_id = NULL,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": message_id})

    audit_id = await log_audit(
        db, str(admin.user_id), "message.event_unlinked", message_id,
        {"previous_event_id": previous_event_id},
        get_client_ip(request)
    )

    await db.commit()

    return ActionResponse(
        success=True,
        message_id=message_id,
        action="event_unlinked",
        previous_value=str(previous_event_id),
        new_value=None,
        audit_id=audit_id
    )
