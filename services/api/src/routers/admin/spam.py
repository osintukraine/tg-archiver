"""
Admin Spam Management API

Provides spam review queue and management for false positives.
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import select, func, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List, Optional
from enum import Enum

from ...database import get_db
from ...dependencies import AdminUser

router = APIRouter(prefix="/api/admin/spam", tags=["admin-spam"])


class SpamReviewStatus(str, Enum):
    pending = "pending"
    reviewed = "reviewed"
    false_positive = "false_positive"
    true_positive = "true_positive"
    reprocessed = "reprocessed"


class SpamItem(BaseModel):
    """Spam item for review."""
    message_id: int
    posted_at: datetime
    content_preview: str
    content_translated: Optional[str]
    language_detected: Optional[str]
    spam_type: Optional[str]
    spam_reason: Optional[str]
    spam_confidence: Optional[float]
    spam_review_status: Optional[str]
    channel_name: str
    channel_username: Optional[str]
    source_type: Optional[str]
    affiliation: Optional[str]
    telegram_url: Optional[str]


class SpamListResponse(BaseModel):
    """Paginated spam list response."""
    items: List[SpamItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class SpamStatsResponse(BaseModel):
    """Spam statistics."""
    total_spam: int
    pending_review: int
    false_positives: int
    true_positives: int
    spam_rate_24h: float
    spam_by_type: dict


class BulkReviewRequest(BaseModel):
    """Bulk review request."""
    message_ids: List[int]
    status: SpamReviewStatus


@router.get("/", response_model=SpamListResponse)
async def get_spam_queue(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    status: Optional[SpamReviewStatus] = None,
    spam_type: Optional[str] = None,
    channel: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get paginated spam review queue with optional filters.

    Fetches messages marked as spam for human review. Joins with the messages
    table to include translated content (first 500 characters) alongside the
    spam review metadata. Results are ordered by posted_at descending (newest first).

    **Spam Review Workflow:**
    1. Messages flagged as spam by processor are added to nocodb_spam_review
    2. Admin reviews spam queue using this endpoint
    3. Admin marks each message as true_positive, false_positive, or reprocessed
    4. Confirmed spam (true_positive) can be bulk-deleted or purged

    Args:
        admin: Admin user (dependency-injected)
        page: Page number for pagination (default: 1, minimum: 1)
        page_size: Results per page (default: 50, range: 1-100)
        status: Filter by spam review status (pending, reviewed, false_positive, true_positive, reprocessed)
        spam_type: Filter by spam type (e.g., "low_quality", "duplicate", "off_topic")
        channel: Filter by channel name or username (case-insensitive partial match)
        db: Database session (dependency-injected)

    Returns:
        SpamListResponse with:
        - items: List of SpamItem objects with message details and spam metadata
        - total: Total matching spam messages (across all pages)
        - page: Current page number
        - page_size: Results per page
        - total_pages: Total number of pages
    """
    # Build query joining messages directly to get translated content
    base_query = """
        SELECT
            sr.message_id,
            sr.posted_at,
            sr.content_preview,
            LEFT(m.content_translated, 500) as content_translated,
            sr.language_detected,
            sr.spam_type,
            sr.spam_reason,
            sr.spam_confidence,
            sr.spam_review_status,
            sr.channel_name,
            sr.channel_username,
            sr.source_type,
            sr.affiliation,
            sr.telegram_url
        FROM nocodb_spam_review sr
        LEFT JOIN messages m ON m.id = sr.message_id
        WHERE 1=1
    """
    count_query = "SELECT COUNT(*) FROM nocodb_spam_review WHERE 1=1"
    params = {}

    # Add filters
    if status:
        base_query += " AND sr.spam_review_status = :status"
        count_query += " AND spam_review_status = :status"
        params["status"] = status.value

    if spam_type:
        base_query += " AND sr.spam_type = :spam_type"
        count_query += " AND spam_type = :spam_type"
        params["spam_type"] = spam_type

    if channel:
        base_query += " AND (sr.channel_name ILIKE :channel OR sr.channel_username ILIKE :channel)"
        count_query += " AND (channel_name ILIKE :channel OR channel_username ILIKE :channel)"
        params["channel"] = f"%{channel}%"

    # Add pagination
    base_query += " ORDER BY sr.posted_at DESC LIMIT :limit OFFSET :offset"
    params["limit"] = page_size
    params["offset"] = (page - 1) * page_size

    # Execute queries
    result = await db.execute(text(base_query), params)
    rows = result.fetchall()

    count_result = await db.execute(text(count_query), {k: v for k, v in params.items() if k not in ["limit", "offset"]})
    total = count_result.scalar() or 0

    items = [
        SpamItem(
            message_id=row[0],
            posted_at=row[1],
            content_preview=row[2] or "",
            content_translated=row[3],
            language_detected=row[4],
            spam_type=row[5],
            spam_reason=row[6],
            spam_confidence=row[7],
            spam_review_status=row[8],
            channel_name=row[9] or "Unknown",
            channel_username=row[10],
            source_type=row[11],
            affiliation=row[12],
            telegram_url=row[13],
        )
        for row in rows
    ]

    return SpamListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size if total > 0 else 1,
    )


@router.get("/stats", response_model=SpamStatsResponse)
async def get_spam_stats(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """
    Get spam statistics for the admin dashboard.

    Provides aggregated statistics across all spam messages, including:
    - Total spam message count (all-time)
    - Pending review count (awaiting human review)
    - False positive count (incorrectly flagged as spam)
    - True positive count (confirmed spam)
    - Spam rate over the last 24 hours (percentage)
    - Top 10 spam types by message count

    **Spam Review Statuses:**
    - pending: Awaiting human review (default for new spam)
    - false_positive: Incorrectly flagged, should be archived
    - true_positive: Confirmed spam, safe to delete
    - reprocessed: Spam flag cleared, message re-entered processing pipeline

    Args:
        admin: Admin user (dependency-injected)
        db: Database session (dependency-injected)

    Returns:
        SpamStatsResponse with:
        - total_spam: Total spam messages across all time
        - pending_review: Messages awaiting human review
        - false_positives: Messages incorrectly flagged as spam
        - true_positives: Confirmed spam messages
        - spam_rate_24h: Percentage of messages marked as spam in last 24h (rounded to 1 decimal)
        - spam_by_type: Dictionary mapping spam type to message count (top 10)
    """
    now = datetime.utcnow()
    day_ago = now - timedelta(hours=24)

    # Total spam count
    total_result = await db.execute(text("SELECT COUNT(*) FROM messages WHERE is_spam = true"))
    total_spam = total_result.scalar() or 0

    # Pending review
    pending_result = await db.execute(text(
        "SELECT COUNT(*) FROM messages WHERE is_spam = true AND spam_review_status = 'pending'"
    ))
    pending_review = pending_result.scalar() or 0

    # False positives
    fp_result = await db.execute(text(
        "SELECT COUNT(*) FROM messages WHERE spam_review_status = 'false_positive'"
    ))
    false_positives = fp_result.scalar() or 0

    # True positives
    tp_result = await db.execute(text(
        "SELECT COUNT(*) FROM messages WHERE spam_review_status = 'true_positive'"
    ))
    true_positives = tp_result.scalar() or 0

    # Spam rate 24h
    total_24h = await db.execute(text(
        "SELECT COUNT(*) FROM messages WHERE created_at >= :day_ago"
    ), {"day_ago": day_ago})
    total_24h_count = total_24h.scalar() or 1

    spam_24h = await db.execute(text(
        "SELECT COUNT(*) FROM messages WHERE created_at >= :day_ago AND is_spam = true"
    ), {"day_ago": day_ago})
    spam_24h_count = spam_24h.scalar() or 0

    spam_rate = (spam_24h_count / total_24h_count) * 100 if total_24h_count > 0 else 0

    # Spam by type
    type_result = await db.execute(text("""
        SELECT COALESCE(spam_type, 'unknown'), COUNT(*)
        FROM messages
        WHERE is_spam = true
        GROUP BY spam_type
        ORDER BY COUNT(*) DESC
        LIMIT 10
    """))
    spam_by_type = {row[0]: row[1] for row in type_result.fetchall()}

    return SpamStatsResponse(
        total_spam=total_spam,
        pending_review=pending_review,
        false_positives=false_positives,
        true_positives=true_positives,
        spam_rate_24h=round(spam_rate, 1),
        spam_by_type=spam_by_type,
    )


@router.put("/{message_id}/review")
async def review_spam_message(
    message_id: int,
    status: SpamReviewStatus,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Update spam review status for a single message.

    Allows admins to mark spam messages with human review decisions. This is
    the primary endpoint for single-message spam review workflow. The status
    update is recorded in the messages table along with an updated timestamp.

    **Common Use Cases:**
    - Mark as true_positive: Confirm message is spam, safe to delete
    - Mark as false_positive: Message was incorrectly flagged, should be archived
    - Mark as reprocessed: Clear spam flag and reprocess (use /reprocess endpoint instead)

    Args:
        message_id: Database ID of the message to review
        status: New spam review status (pending, reviewed, false_positive, true_positive, reprocessed)
        admin: Admin user (dependency-injected)
        db: Database session (dependency-injected)

    Returns:
        Dictionary with:
        - message_id: ID of the updated message
        - status: New spam review status
        - success: True if update succeeded

    Raises:
        HTTPException 404: Message not found with given ID
    """
    result = await db.execute(text("""
        UPDATE messages
        SET spam_review_status = :status,
            updated_at = NOW()
        WHERE id = :message_id
        RETURNING id
    """), {"message_id": message_id, "status": status.value})

    updated = result.fetchone()
    if not updated:
        raise HTTPException(status_code=404, detail="Message not found")

    await db.commit()

    return {"message_id": message_id, "status": status.value, "success": True}


@router.post("/bulk-review")
async def bulk_review_spam(
    admin: AdminUser,
    request: BulkReviewRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Bulk update spam review status for multiple messages.

    Efficiently updates spam review status for a list of messages in a single
    database transaction. Useful for batch processing spam review queue when
    multiple messages share the same review decision.

    **Request Body Example:**
    ```json
    {
        "message_ids": [123, 456, 789],
        "status": "true_positive"
    }
    ```

    **Performance Notes:**
    - Uses PostgreSQL's ANY operator for efficient batch updates
    - All updates occur in single transaction (atomic)
    - Returns list of successfully updated message IDs

    Args:
        admin: Admin user (dependency-injected)
        request: BulkReviewRequest with message_ids list and target status
        db: Database session (dependency-injected)

    Returns:
        Dictionary with:
        - updated_count: Number of messages successfully updated
        - updated_ids: List of message IDs that were updated
        - status: The spam review status that was applied

    Raises:
        HTTPException 400: No message IDs provided in request
    """
    if not request.message_ids:
        raise HTTPException(status_code=400, detail="No message IDs provided")

    result = await db.execute(text("""
        UPDATE messages
        SET spam_review_status = :status,
            updated_at = NOW()
        WHERE id = ANY(:ids)
        RETURNING id
    """), {"status": request.status.value, "ids": request.message_ids})

    updated_ids = [row[0] for row in result.fetchall()]
    await db.commit()

    return {
        "updated_count": len(updated_ids),
        "updated_ids": updated_ids,
        "status": request.status.value,
    }


@router.post("/{message_id}/reprocess")
async def reprocess_message(
    admin: AdminUser,
    message_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Mark a message for reprocessing through the full pipeline.

    Resets all spam-related fields on a message and queues it for reprocessing.
    The message will be re-classified by the processor using the current LLM prompt,
    then go through all enrichment tasks (translation, embedding, geolocation, etc.).

    **Full Pipeline Triggered:**
    1. Clears spam flag and metadata on message
    2. Creates decision_log entry with reprocess_requested=true
    3. DecisionReprocessorTask picks up the entry
    4. Message pushed to Redis queue for processor
    5. Processor re-classifies with current prompt (v10)
    6. If not spam → enrichment pipeline runs (translation, embedding, etc.)

    **Side Effects:**
    - Sets is_spam = false
    - Sets spam_review_status = 'reprocessed'
    - Clears spam_type, spam_reason, spam_confidence
    - Creates decision_log entry for reprocessing queue

    Args:
        admin: Admin user (dependency-injected)
        message_id: Database ID of the message to reprocess
        db: Database session (dependency-injected)

    Returns:
        Dictionary with:
        - message_id: ID of the reprocessed message
        - decision_log_id: ID of the reprocessing request entry
        - reprocessed: True if queued successfully

    Raises:
        HTTPException 404: Message not found with given ID
    """
    # Get message details needed for decision_log
    msg_result = await db.execute(text("""
        SELECT m.id, m.channel_id, m.message_id, c.telegram_id as channel_telegram_id
        FROM messages m
        JOIN channels c ON m.channel_id = c.id
        WHERE m.id = :message_id
    """), {"message_id": message_id})

    msg = msg_result.fetchone()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Clear spam flags on message
    await db.execute(text("""
        UPDATE messages
        SET is_spam = false,
            spam_review_status = 'reprocessed',
            spam_type = NULL,
            spam_reason = NULL,
            spam_confidence = NULL,
            updated_at = NOW()
        WHERE id = :message_id
    """), {"message_id": message_id})

    # Create decision_log entry for reprocessing queue
    # DecisionReprocessorTask will pick this up and push to Redis
    decision_result = await db.execute(text("""
        INSERT INTO decision_log (
            message_id,
            channel_id,
            telegram_message_id,
            decision_type,
            decision_value,
            decision_source,
            verification_status,
            verification_notes,
            reprocess_requested,
            reprocess_priority
        ) VALUES (
            :message_id,
            :channel_id,
            :telegram_message_id,
            'reprocess_request',
            :decision_value,
            'admin_ui',
            'pending_reprocess',
            :notes,
            true,
            10
        )
        RETURNING id
    """), {
        "message_id": msg[0],
        "channel_id": msg[1],
        "telegram_message_id": msg[2],
        "decision_value": '{"source": "admin_ui", "reason": "false_positive_correction"}',
        "notes": f"Queued for reprocessing by admin. Original spam flag cleared."
    })

    decision_id = decision_result.fetchone()[0]
    await db.commit()

    return {
        "message_id": message_id,
        "decision_log_id": decision_id,
        "reprocessed": True,
        "note": "Message queued for reprocessing. DecisionReprocessorTask will push to processor."
    }


@router.delete("/{message_id}")
async def delete_spam_message(
    admin: AdminUser,
    message_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Permanently delete a single spam message from the database.

    This is a destructive operation that completely removes the message record.
    Only messages with is_spam = true can be deleted via this endpoint as a
    safety mechanism to prevent accidental deletion of legitimate archived content.

    **Safety Checks:**
    - Verifies message exists before deletion
    - Ensures message is marked as spam (is_spam = true)
    - Rejects deletion of non-spam messages with HTTP 400

    **Important Notes:**
    - This is safe because spam messages have no associated media files in MinIO
    - Spam messages are filtered before media archival in the processor
    - Deletion is permanent and cannot be undone
    - Foreign key constraints in database will cascade deletions appropriately

    Args:
        admin: Admin user (dependency-injected)
        message_id: Database ID of the spam message to delete
        db: Database session (dependency-injected)

    Returns:
        Dictionary with:
        - message_id: ID of the deleted message
        - deleted: True if deletion succeeded

    Raises:
        HTTPException 404: Message not found with given ID
        HTTPException 400: Message is not marked as spam (cannot delete non-spam messages)
    """
    # First verify the message exists and is spam
    check = await db.execute(text("""
        SELECT id, is_spam FROM messages WHERE id = :message_id
    """), {"message_id": message_id})
    row = check.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Message not found")

    if not row[1]:  # is_spam = false
        raise HTTPException(
            status_code=400,
            detail="Cannot delete non-spam message. Use spam review to mark as spam first."
        )

    # Delete the message
    await db.execute(text("""
        DELETE FROM messages WHERE id = :message_id
    """), {"message_id": message_id})

    await db.commit()

    return {"message_id": message_id, "deleted": True}


class BulkDeleteRequest(BaseModel):
    """Bulk delete request."""
    message_ids: List[int]


@router.post("/bulk-delete")
async def bulk_delete_spam(
    admin: AdminUser,
    request: BulkDeleteRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Bulk delete multiple spam messages from the database.

    Efficiently deletes a list of spam messages in a single database transaction.
    Only messages with is_spam = true will be deleted from the provided list,
    silently skipping any non-spam messages (safety mechanism).

    **Request Body Example:**
    ```json
    {
        "message_ids": [123, 456, 789]
    }
    ```

    **Safety Mechanism:**
    - Only messages with is_spam = true are deleted
    - Non-spam messages in the list are silently skipped
    - Returns list of actually deleted message IDs (may be subset of input)

    **Performance Notes:**
    - Uses PostgreSQL's ANY operator for efficient batch deletion
    - Single atomic transaction for all deletions
    - Safe for large batches (no media files to clean up)

    Args:
        admin: Admin user (dependency-injected)
        request: BulkDeleteRequest with list of message IDs to delete
        db: Database session (dependency-injected)

    Returns:
        Dictionary with:
        - deleted_count: Number of messages successfully deleted
        - deleted_ids: List of message IDs that were deleted (only spam messages)

    Raises:
        HTTPException 400: No message IDs provided in request
    """
    if not request.message_ids:
        raise HTTPException(status_code=400, detail="No message IDs provided")

    # Delete only spam messages from the list
    result = await db.execute(text("""
        DELETE FROM messages
        WHERE id = ANY(:ids) AND is_spam = true
        RETURNING id
    """), {"ids": request.message_ids})

    deleted_ids = [row[0] for row in result.fetchall()]
    await db.commit()

    return {
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
    }


@router.delete("/purge/confirmed")
async def purge_confirmed_spam(admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Purge all confirmed spam (true_positive) from the database.

    This is a destructive operation that permanently removes all messages
    where spam_review_status = 'true_positive'. Use this for periodic cleanup
    of confirmed spam after human review.

    **Workflow:**
    1. Admin reviews spam queue and marks confirmed spam as 'true_positive'
    2. Confirmed spam accumulates in database
    3. Periodically run this endpoint to purge all confirmed spam
    4. Operation is safe because spam messages have no media files

    **What Gets Deleted:**
    - Only messages where is_spam = true AND spam_review_status = 'true_positive'
    - Does NOT delete pending, false_positive, or reprocessed messages
    - Does NOT delete any non-spam messages

    **Performance Notes:**
    - Returns count of messages before deletion for confirmation
    - If no confirmed spam found, returns count = 0 with no deletion
    - Single atomic transaction for safety

    Args:
        admin: Admin user (dependency-injected)
        db: Database session (dependency-injected)

    Returns:
        Dictionary with:
        - purged_count: Number of confirmed spam messages deleted
        - message: Human-readable success message
    """
    # Get count before deletion for reporting
    count_result = await db.execute(text("""
        SELECT COUNT(*) FROM messages
        WHERE is_spam = true AND spam_review_status = 'true_positive'
    """))
    count = count_result.scalar() or 0

    if count == 0:
        return {
            "purged_count": 0,
            "message": "No confirmed spam to purge"
        }

    # Delete all confirmed spam
    await db.execute(text("""
        DELETE FROM messages
        WHERE is_spam = true AND spam_review_status = 'true_positive'
    """))

    await db.commit()

    return {
        "purged_count": count,
        "message": f"Successfully purged {count} confirmed spam messages"
    }
