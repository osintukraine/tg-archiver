"""
Admin Fact-Check Management API

Provides endpoints for reviewing classification fact-check discrepancies.
Supports pending review queue, hidden messages, and auto-reclassified items.
"""

import json

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID

from ...database import get_db
from ...dependencies.auth import AdminUser

router = APIRouter(prefix="/api/admin/fact-check", tags=["admin-fact-check"])

# System UUID for fact-check service
SYSTEM_UUID = "00000000-0000-0000-0000-000000000001"


class FactCheckItem(BaseModel):
    """Fact-check item for review."""
    id: int
    message_id: int
    content_preview: str
    content_translated: Optional[str]
    channel_name: str
    channel_username: Optional[str]
    telegram_url: Optional[str]
    original_topic: Optional[str]
    original_is_spam: Optional[bool]
    factcheck_topic: Optional[str]
    factcheck_is_spam: Optional[bool]
    factcheck_spam_type: Optional[str]
    factcheck_confidence: Optional[float]
    factcheck_reasoning: Optional[str]
    discrepancy_type: Optional[str]
    human_reviewed: bool
    created_at: str  # ISO format string for reliable JSON serialization


class FactCheckListResponse(BaseModel):
    """Paginated fact-check list response."""
    items: List[FactCheckItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class FactCheckStats(BaseModel):
    """Fact-check statistics."""
    total_checked: int
    pending_review: int
    discrepancies_total: int
    topic_mismatches: int
    spam_mismatches: int
    accuracy_rate: float
    discrepancies_by_type: dict


class BulkActionRequest(BaseModel):
    """Bulk action request."""
    ids: List[int]


@router.get("/stats", response_model=FactCheckStats)
async def get_fact_check_stats(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """
    Get fact-check statistics for the dashboard.

    Returns:
        FactCheckStats: Statistics about fact-check results including accuracy rate,
        pending reviews, and breakdown by discrepancy type.
    """
    # Total checked
    total = await db.execute(text("SELECT COUNT(*) FROM classification_fact_checks"))
    total_checked = total.scalar() or 0

    # Pending review (discrepancies not yet human reviewed)
    pending = await db.execute(text("""
        SELECT COUNT(*) FROM classification_fact_checks
        WHERE classification_match = FALSE AND human_reviewed = FALSE
    """))
    pending_review = pending.scalar() or 0

    # Total discrepancies
    discrepancies = await db.execute(text("""
        SELECT COUNT(*) FROM classification_fact_checks
        WHERE classification_match = FALSE
    """))
    discrepancies_total = discrepancies.scalar() or 0

    # Topic mismatches
    topic_mismatches = await db.execute(text("""
        SELECT COUNT(*) FROM classification_fact_checks
        WHERE topic_match = FALSE
    """))
    topic_mismatches_count = topic_mismatches.scalar() or 0

    # Spam mismatches
    spam_mismatches = await db.execute(text("""
        SELECT COUNT(*) FROM classification_fact_checks
        WHERE spam_match = FALSE
    """))
    spam_mismatches_count = spam_mismatches.scalar() or 0

    # Accuracy rate
    matches = await db.execute(text("""
        SELECT COUNT(*) FROM classification_fact_checks
        WHERE classification_match = TRUE
    """))
    match_count = matches.scalar() or 0
    accuracy_rate = (match_count / total_checked * 100) if total_checked > 0 else 0

    # Discrepancies by type
    by_type = await db.execute(text("""
        SELECT COALESCE(discrepancy_type, 'match'), COUNT(*)
        FROM classification_fact_checks
        GROUP BY discrepancy_type
    """))
    discrepancies_by_type = {row[0] or 'match': row[1] for row in by_type.fetchall()}

    return FactCheckStats(
        total_checked=total_checked,
        pending_review=pending_review,
        discrepancies_total=discrepancies_total,
        topic_mismatches=topic_mismatches_count,
        spam_mismatches=spam_mismatches_count,
        accuracy_rate=round(accuracy_rate, 2),
        discrepancies_by_type=discrepancies_by_type
    )


@router.get("/pending", response_model=FactCheckListResponse)
async def get_pending_review(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """
    Get messages pending human review (discrepancies not yet reviewed).

    Args:
        admin: Admin user (dependency-injected)
        page: Page number for pagination (default: 1, minimum: 1)
        page_size: Results per page (default: 50, range: 1-100)
        db: Database session (dependency-injected)

    Returns:
        FactCheckListResponse with pending fact-check discrepancies
    """
    # Build query for pending reviews (discrepancies not yet human reviewed)
    base_query = """
        SELECT
            fc.id,
            fc.message_id,
            LEFT(m.content, 200) as content_preview,
            LEFT(m.content_translated, 500) as content_translated,
            c.name as channel_name,
            c.username as channel_username,
            m.message_id as telegram_msg_id,
            fc.original_topic,
            fc.original_is_spam,
            fc.factcheck_topic,
            fc.factcheck_is_spam,
            fc.factcheck_spam_type,
            fc.factcheck_confidence,
            fc.factcheck_reasoning,
            fc.discrepancy_type,
            fc.human_reviewed,
            fc.created_at
        FROM classification_fact_checks fc
        JOIN messages m ON fc.message_id = m.id
        JOIN channels c ON m.channel_id = c.id
        WHERE fc.classification_match = FALSE
          AND fc.human_reviewed = FALSE
        ORDER BY fc.created_at DESC
        LIMIT :limit OFFSET :offset
    """

    count_query = """
        SELECT COUNT(*) FROM classification_fact_checks
        WHERE classification_match = FALSE AND human_reviewed = FALSE
    """

    params = {
        "limit": page_size,
        "offset": (page - 1) * page_size
    }

    # Execute queries
    result = await db.execute(text(base_query), params)
    rows = result.fetchall()

    count_result = await db.execute(text(count_query))
    total = count_result.scalar() or 0

    def build_telegram_url(username: str | None, msg_id: int | None) -> str | None:
        if username and msg_id:
            return f"https://t.me/{username}/{msg_id}"
        return None

    items = [
        FactCheckItem(
            id=row[0],
            message_id=row[1],
            content_preview=row[2] or "",
            content_translated=row[3],
            channel_name=row[4] or "Unknown",
            channel_username=row[5],
            telegram_url=build_telegram_url(row[5], row[6]),
            original_topic=row[7],
            original_is_spam=row[8],
            factcheck_topic=row[9],
            factcheck_is_spam=row[10],
            factcheck_spam_type=row[11],
            factcheck_confidence=float(row[12]) if row[12] is not None else None,
            factcheck_reasoning=row[13],
            discrepancy_type=row[14],
            human_reviewed=row[15],
            created_at=row[16].isoformat() if row[16] else None,
        )
        for row in rows
    ]

    return FactCheckListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.get("/reviewed", response_model=FactCheckListResponse)
async def get_reviewed_items(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """
    Get already reviewed fact-check discrepancies.

    Args:
        admin: Admin user (dependency-injected)
        page: Page number for pagination (default: 1, minimum: 1)
        page_size: Results per page (default: 50, range: 1-100)
        db: Database session (dependency-injected)

    Returns:
        FactCheckListResponse with reviewed fact-check items
    """
    base_query = """
        SELECT
            fc.id,
            fc.message_id,
            LEFT(m.content, 200) as content_preview,
            LEFT(m.content_translated, 500) as content_translated,
            c.name as channel_name,
            c.username as channel_username,
            m.message_id as telegram_msg_id,
            fc.original_topic,
            fc.original_is_spam,
            fc.factcheck_topic,
            fc.factcheck_is_spam,
            fc.factcheck_spam_type,
            fc.factcheck_confidence,
            fc.factcheck_reasoning,
            fc.discrepancy_type,
            fc.human_reviewed,
            fc.created_at
        FROM classification_fact_checks fc
        JOIN messages m ON fc.message_id = m.id
        JOIN channels c ON m.channel_id = c.id
        WHERE fc.human_reviewed = TRUE
        ORDER BY fc.reviewed_at DESC
        LIMIT :limit OFFSET :offset
    """

    count_query = """
        SELECT COUNT(*) FROM classification_fact_checks
        WHERE human_reviewed = TRUE
    """

    params = {
        "limit": page_size,
        "offset": (page - 1) * page_size
    }

    result = await db.execute(text(base_query), params)
    rows = result.fetchall()

    count_result = await db.execute(text(count_query))
    total = count_result.scalar() or 0

    def build_telegram_url(username: str | None, msg_id: int | None) -> str | None:
        if username and msg_id:
            return f"https://t.me/{username}/{msg_id}"
        return None

    items = [
        FactCheckItem(
            id=row[0],
            message_id=row[1],
            content_preview=row[2] or "",
            content_translated=row[3],
            channel_name=row[4] or "Unknown",
            channel_username=row[5],
            telegram_url=build_telegram_url(row[5], row[6]),
            original_topic=row[7],
            original_is_spam=row[8],
            factcheck_topic=row[9],
            factcheck_is_spam=row[10],
            factcheck_spam_type=row[11],
            factcheck_confidence=float(row[12]) if row[12] is not None else None,
            factcheck_reasoning=row[13],
            discrepancy_type=row[14],
            human_reviewed=row[15],
            created_at=row[16].isoformat() if row[16] else None,
        )
        for row in rows
    ]

    return FactCheckListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.get("/all", response_model=FactCheckListResponse)
async def get_all_discrepancies(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    discrepancy_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all fact-check discrepancies with optional filters.

    Args:
        admin: Admin user (dependency-injected)
        page: Page number for pagination (default: 1, minimum: 1)
        page_size: Results per page (default: 50, range: 1-100)
        discrepancy_type: Filter by discrepancy type (topic_mismatch, spam_mismatch, both_mismatch)
        db: Database session (dependency-injected)

    Returns:
        FactCheckListResponse with all fact-check discrepancies matching filters
    """
    base_query = """
        SELECT
            fc.id,
            fc.message_id,
            LEFT(m.content, 200) as content_preview,
            LEFT(m.content_translated, 500) as content_translated,
            c.name as channel_name,
            c.username as channel_username,
            m.message_id as telegram_msg_id,
            fc.original_topic,
            fc.original_is_spam,
            fc.factcheck_topic,
            fc.factcheck_is_spam,
            fc.factcheck_spam_type,
            fc.factcheck_confidence,
            fc.factcheck_reasoning,
            fc.discrepancy_type,
            fc.human_reviewed,
            fc.created_at
        FROM classification_fact_checks fc
        JOIN messages m ON fc.message_id = m.id
        JOIN channels c ON m.channel_id = c.id
        WHERE fc.classification_match = FALSE
    """
    count_query = "SELECT COUNT(*) FROM classification_fact_checks WHERE classification_match = FALSE"
    params = {}

    # Add filters
    if discrepancy_type:
        base_query += " AND fc.discrepancy_type = :discrepancy_type"
        count_query += " AND discrepancy_type = :discrepancy_type"
        params["discrepancy_type"] = discrepancy_type

    # Add pagination
    base_query += " ORDER BY fc.created_at DESC LIMIT :limit OFFSET :offset"
    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    # Execute queries
    result = await db.execute(text(base_query), params)
    rows = result.fetchall()

    count_result = await db.execute(text(count_query), {k: v for k, v in params.items() if k not in ["limit", "offset"]})
    total = count_result.scalar() or 0

    def build_telegram_url(username: str | None, msg_id: int | None) -> str | None:
        if username and msg_id:
            return f"https://t.me/{username}/{msg_id}"
        return None

    items = [
        FactCheckItem(
            id=row[0],
            message_id=row[1],
            content_preview=row[2] or "",
            content_translated=row[3],
            channel_name=row[4] or "Unknown",
            channel_username=row[5],
            telegram_url=build_telegram_url(row[5], row[6]),
            original_topic=row[7],
            original_is_spam=row[8],
            factcheck_topic=row[9],
            factcheck_is_spam=row[10],
            factcheck_spam_type=row[11],
            factcheck_confidence=float(row[12]) if row[12] is not None else None,
            factcheck_reasoning=row[13],
            discrepancy_type=row[14],
            human_reviewed=row[15],
            created_at=row[16].isoformat() if row[16] else None,
        )
        for row in rows
    ]

    return FactCheckListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.post("/{fact_check_id}/approve")
async def approve_fact_check(
    fact_check_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Accept the fact-check classification (apply to message).

    This endpoint applies the fact-check classification to the original message,
    updating the message's topic and spam status to match the fact-check results.

    Args:
        fact_check_id: ID of the fact-check record to approve
        admin: Admin user (dependency-injected)
        db: Database session (dependency-injected)

    Returns:
        Dictionary with success status and message ID

    Raises:
        HTTPException 404: Fact-check record not found
    """
    # Get the fact-check record
    fc = await db.execute(text("""
        SELECT fc.message_id, fc.factcheck_topic, fc.factcheck_is_spam, fc.factcheck_spam_type
        FROM classification_fact_checks fc
        WHERE fc.id = :id
    """), {"id": fact_check_id})
    row = fc.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Fact-check record not found")

    message_id, new_topic, is_spam, spam_type = row

    # Apply the fact-check classification
    await db.execute(text("""
        UPDATE messages
        SET osint_topic = :topic,
            is_spam = :is_spam,
            spam_type = :spam_type,
            needs_human_review = FALSE,
            reviewed_by = :admin_id,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = :message_id
    """), {
        "topic": new_topic,
        "is_spam": is_spam,
        "spam_type": spam_type,
        "admin_id": str(admin.id),
        "message_id": message_id
    })

    # Mark as human reviewed with fact-check classification as correct
    await db.execute(text("""
        UPDATE classification_fact_checks
        SET human_reviewed = TRUE,
            human_correct_topic = :topic,
            human_correct_is_spam = :is_spam,
            human_correct_spam_type = :spam_type,
            reviewed_by = :admin_id,
            reviewed_at = NOW()
        WHERE id = :id
    """), {
        "topic": new_topic,
        "is_spam": is_spam,
        "spam_type": spam_type,
        "admin_id": str(admin.id),
        "id": fact_check_id
    })

    # Log to audit
    await db.execute(text("""
        INSERT INTO admin_audit_log (kratos_identity_id, action, resource_type, resource_id, details)
        VALUES (:admin_id, 'fact_check_approve', 'message', :message_id, :details)
    """), {
        "admin_id": str(admin.id),
        "message_id": message_id,
        "details": json.dumps({"fact_check_id": fact_check_id, "action": "approved_factcheck_classification"})
    })

    await db.commit()
    return {"success": True, "message_id": message_id, "fact_check_id": fact_check_id}


@router.post("/{fact_check_id}/reject")
async def reject_fact_check(
    fact_check_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Reject the fact-check classification (keep original).

    This endpoint marks the fact-check as reviewed but does not change the message
    classification, indicating that the original classification was correct.

    Args:
        fact_check_id: ID of the fact-check record to reject
        admin: Admin user (dependency-injected)
        db: AsyncSession = Depends(get_db)

    Returns:
        Dictionary with success status and message ID

    Raises:
        HTTPException 404: Fact-check record not found
    """
    # Get the fact-check record and original classification
    fc = await db.execute(text("""
        SELECT fc.message_id, fc.original_topic, fc.original_is_spam, fc.original_spam_type
        FROM classification_fact_checks fc
        WHERE fc.id = :id
    """), {"id": fact_check_id})
    row = fc.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Fact-check record not found")

    message_id, original_topic, original_is_spam, original_spam_type = row

    # Mark as human reviewed with original classification as correct
    await db.execute(text("""
        UPDATE classification_fact_checks
        SET human_reviewed = TRUE,
            human_correct_topic = :topic,
            human_correct_is_spam = :is_spam,
            human_correct_spam_type = :spam_type,
            reviewed_by = :admin_id,
            reviewed_at = NOW()
        WHERE id = :id
    """), {
        "topic": original_topic,
        "is_spam": original_is_spam,
        "spam_type": original_spam_type,
        "admin_id": str(admin.id),
        "id": fact_check_id
    })

    # Update message review status (but keep original classification)
    await db.execute(text("""
        UPDATE messages
        SET needs_human_review = FALSE,
            reviewed_by = :admin_id,
            reviewed_at = NOW(),
            updated_at = NOW()
        WHERE id = :message_id
    """), {
        "admin_id": str(admin.id),
        "message_id": message_id
    })

    # Log to audit
    await db.execute(text("""
        INSERT INTO admin_audit_log (kratos_identity_id, action, resource_type, resource_id, details)
        VALUES (:admin_id, 'fact_check_reject', 'message', :message_id, :details)
    """), {
        "admin_id": str(admin.id),
        "message_id": message_id,
        "details": json.dumps({"fact_check_id": fact_check_id, "action": "rejected_factcheck_kept_original"})
    })

    await db.commit()
    return {"success": True, "message_id": message_id, "fact_check_id": fact_check_id}


@router.post("/{message_id}/unhide")
async def unhide_message(
    message_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Unhide a previously hidden message.

    This restores a hidden message to normal visibility in public endpoints.

    Args:
        message_id: Database ID of the message to unhide
        admin: Admin user (dependency-injected)
        db: Database session (dependency-injected)

    Returns:
        Dictionary with success status and message ID

    Raises:
        HTTPException 404: Message not found
    """
    # Check if message exists and is hidden
    check = await db.execute(text("""
        SELECT id, is_hidden FROM messages WHERE id = :id
    """), {"id": message_id})
    row = check.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Message not found")

    if not row[1]:
        raise HTTPException(status_code=400, detail="Message is not hidden")

    # Unhide the message
    await db.execute(text("""
        UPDATE messages
        SET is_hidden = FALSE,
            hidden_reason = NULL,
            hidden_at = NULL,
            hidden_by = NULL,
            updated_at = NOW()
        WHERE id = :id
    """), {"id": message_id})

    # Log to audit
    await db.execute(text("""
        INSERT INTO admin_audit_log (kratos_identity_id, action, resource_type, resource_id, details)
        VALUES (:admin_id, 'fact_check_unhide', 'message', :message_id, :details)
    """), {
        "admin_id": str(admin.id),
        "message_id": message_id,
        "details": json.dumps({"action": "unhide_message"})
    })

    await db.commit()
    return {"success": True, "message_id": message_id}


@router.delete("/{message_id}")
async def delete_message(
    message_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Permanently delete a message.

    WARNING: This is a destructive operation that permanently removes the message
    and all associated fact-check records.

    Args:
        message_id: Database ID of the message to delete
        admin: Admin user (dependency-injected)
        db: Database session (dependency-injected)

    Returns:
        Dictionary with success status and message ID

    Raises:
        HTTPException 404: Message not found
    """
    # Check if message exists
    check = await db.execute(text("SELECT id FROM messages WHERE id = :id"), {"id": message_id})
    if not check.fetchone():
        raise HTTPException(status_code=404, detail="Message not found")

    # Log to audit before deletion
    await db.execute(text("""
        INSERT INTO admin_audit_log (kratos_identity_id, action, resource_type, resource_id, details)
        VALUES (:admin_id, 'fact_check_delete_message', 'message', :message_id, '{}')
    """), {
        "admin_id": str(admin.id),
        "message_id": message_id
    })

    # Delete the message (cascade will delete fact-check records)
    await db.execute(text("DELETE FROM messages WHERE id = :id"), {"id": message_id})

    await db.commit()
    return {"success": True, "message_id": message_id}


@router.post("/bulk-approve")
async def bulk_approve(
    request: BulkActionRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Bulk approve fact-check results.

    Applies fact-check classifications to multiple messages in a single operation.

    Args:
        request: BulkActionRequest with list of fact-check IDs
        admin: Admin user (dependency-injected)
        db: Database session (dependency-injected)

    Returns:
        Dictionary with count of approved records

    Raises:
        HTTPException 400: No IDs provided
    """
    if not request.ids:
        raise HTTPException(status_code=400, detail="No fact-check IDs provided")

    # Get all fact-check records
    result = await db.execute(text("""
        SELECT id, message_id, factcheck_topic, factcheck_is_spam, factcheck_spam_type
        FROM classification_fact_checks
        WHERE id = ANY(:ids)
    """), {"ids": request.ids})

    rows = result.fetchall()
    approved_count = 0

    for row in rows:
        fc_id, msg_id, topic, is_spam, spam_type = row

        # Apply fact-check classification to message
        await db.execute(text("""
            UPDATE messages
            SET osint_topic = :topic,
                is_spam = :is_spam,
                spam_type = :spam_type,
                needs_human_review = FALSE,
                reviewed_by = :admin_id,
                reviewed_at = NOW(),
                updated_at = NOW()
            WHERE id = :message_id
        """), {
            "topic": topic,
            "is_spam": is_spam,
            "spam_type": spam_type,
            "admin_id": str(admin.id),
            "message_id": msg_id
        })

        # Mark fact-check as reviewed
        await db.execute(text("""
            UPDATE classification_fact_checks
            SET human_reviewed = TRUE,
                human_correct_topic = :topic,
                human_correct_is_spam = :is_spam,
                human_correct_spam_type = :spam_type,
                reviewed_by = :admin_id,
                reviewed_at = NOW()
            WHERE id = :id
        """), {
            "topic": topic,
            "is_spam": is_spam,
            "spam_type": spam_type,
            "admin_id": str(admin.id),
            "id": fc_id
        })

        approved_count += 1

    # Log bulk action to audit
    await db.execute(text("""
        INSERT INTO admin_audit_log (kratos_identity_id, action, resource_type, resource_id, details)
        VALUES (:admin_id, 'fact_check_bulk_approve', 'fact_check', NULL, :details)
    """), {
        "admin_id": str(admin.id),
        "details": json.dumps({"count": approved_count, "ids": list(request.ids)})
    })

    await db.commit()
    return {
        "success": True,
        "approved_count": approved_count,
        "requested_count": len(request.ids)
    }


@router.post("/bulk-delete")
async def bulk_delete(
    request: BulkActionRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Bulk delete messages.

    WARNING: Permanently deletes multiple messages and their fact-check records.

    Args:
        request: BulkActionRequest with list of message IDs
        admin: Admin user (dependency-injected)
        db: Database session (dependency-injected)

    Returns:
        Dictionary with count of deleted messages

    Raises:
        HTTPException 400: No IDs provided
    """
    if not request.ids:
        raise HTTPException(status_code=400, detail="No message IDs provided")

    # Log bulk delete to audit before deletion
    await db.execute(text("""
        INSERT INTO admin_audit_log (kratos_identity_id, action, resource_type, resource_id, details)
        VALUES (:admin_id, 'fact_check_bulk_delete', 'message', NULL, :details)
    """), {
        "admin_id": str(admin.id),
        "details": json.dumps({"count": len(request.ids), "ids": list(request.ids)})
    })

    # Delete messages
    result = await db.execute(text("""
        DELETE FROM messages
        WHERE id = ANY(:ids)
        RETURNING id
    """), {"ids": request.ids})

    deleted_ids = [row[0] for row in result.fetchall()]

    await db.commit()
    return {
        "success": True,
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids
    }
