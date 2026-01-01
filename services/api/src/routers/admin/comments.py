"""
Comments Admin API - On-demand comment fetching.

Provides API endpoints for:
- Triggering immediate comment fetch for specific messages
- Fetching comments for messages in a channel/date range
- Viewing comment fetch status

This API interacts with the enrichment service's CommentOnDemandTask via Redis queue.
"""

import logging
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...dependencies import AdminUser
from ...utils.enrichment_queue import enqueue_comment_fetch, get_queue_depth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/comments", tags=["admin-comments"])


# Request/Response schemas
class CommentFetchRequest(BaseModel):
    """Request to fetch comments for specific messages."""

    # Option 1: Specific message IDs
    message_ids: Optional[List[int]] = Field(
        None, description="Specific message IDs to fetch comments for"
    )

    # Option 2: Filter-based selection
    channel_id: Optional[int] = Field(
        None, description="Fetch comments for messages from this channel"
    )
    date_from: Optional[datetime] = Field(
        None, description="Start date filter (inclusive)"
    )
    date_to: Optional[datetime] = Field(
        None, description="End date filter (inclusive)"
    )

    # Safety limits
    max_messages: int = Field(
        default=100,
        le=500,
        description="Maximum messages to process (max 500)"
    )

    # Execution mode
    async_mode: bool = Field(
        default=True,
        description="If True, queue tasks and return immediately. If False, wait for completion (slower)."
    )

    class Config:
        json_schema_extra = {
            "examples": [
                {
                    "message_ids": [12345, 12346, 12347],
                    "max_messages": 100
                },
                {
                    "channel_id": 42,
                    "date_from": "2025-12-01T00:00:00Z",
                    "date_to": "2025-12-05T23:59:59Z",
                    "max_messages": 50
                }
            ]
        }


class CommentFetchResult(BaseModel):
    """Result for a single message fetch."""
    message_id: int
    comments_count: Optional[int] = None
    error: Optional[str] = None
    reason: Optional[str] = None  # For skipped messages


class CommentFetchResponse(BaseModel):
    """Response from comment fetch request."""
    status: str  # "completed", "partial", "queued"
    messages_processed: int
    task_id: Optional[str] = None  # For async mode - use to track progress
    success: List[CommentFetchResult]
    failed: List[CommentFetchResult]
    skipped: List[CommentFetchResult]
    info: Optional[str] = None
    queue_depth: Optional[int] = None  # Current telegram queue depth


class CommentStats(BaseModel):
    """Statistics about comment fetching."""
    total_messages_with_comments: int
    messages_never_fetched: int
    messages_needing_refresh: int
    viral_posts_active: int
    last_24h_fetched: int


@router.post("/fetch", response_model=CommentFetchResponse)
async def fetch_comments(
    request: CommentFetchRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> CommentFetchResponse:
    """
    Fetch comments for specific messages on-demand.

    This endpoint allows analysts to trigger immediate comment fetching for:
    - Specific message IDs (e.g., high-value posts)
    - All messages from a channel within a date range

    Note: This endpoint runs synchronously and returns when complete.
    For large batches, the request may take several minutes.
    """
    # Validate request
    if not request.message_ids and not request.channel_id:
        raise HTTPException(
            status_code=400,
            detail="Must provide either message_ids or channel_id"
        )

    if request.message_ids and request.channel_id:
        raise HTTPException(
            status_code=400,
            detail="Provide either message_ids OR channel_id, not both"
        )

    # Get message IDs to process
    if request.message_ids:
        message_ids = request.message_ids[:request.max_messages]
    else:
        # Query messages from channel
        query_parts = [
            "SELECT id FROM messages",
            "WHERE channel_id = :channel_id",
            "AND has_comments = true",
            "AND linked_chat_id IS NOT NULL",
            "AND is_spam = false",
        ]
        params = {"channel_id": request.channel_id, "max_messages": request.max_messages}

        if request.date_from:
            query_parts.append("AND telegram_date >= :date_from")
            params["date_from"] = request.date_from

        if request.date_to:
            query_parts.append("AND telegram_date <= :date_to")
            params["date_to"] = request.date_to

        query_parts.append("ORDER BY telegram_date DESC")
        query_parts.append("LIMIT :max_messages")

        result = await db.execute(text(" ".join(query_parts)), params)
        message_ids = [row.id for row in result]

    if not message_ids:
        return CommentFetchResponse(
            status="completed",
            messages_processed=0,
            success=[],
            failed=[],
            skipped=[],
            info="No messages found matching criteria"
        )

    # Note: In a full implementation, this would call the enrichment service
    # via Redis queue or direct task invocation. For now, we return the
    # messages that would be processed.

    # Check which messages are valid for comment fetching
    check_query = """
        SELECT
            m.id,
            m.has_comments,
            m.linked_chat_id,
            m.is_spam
        FROM messages m
        WHERE m.id = ANY(:message_ids)
    """
    check_result = await db.execute(text(check_query), {"message_ids": message_ids})
    messages = {row.id: row for row in check_result}

    success = []
    failed = []
    skipped = []

    for msg_id in message_ids:
        msg = messages.get(msg_id)

        if not msg:
            failed.append(CommentFetchResult(
                message_id=msg_id,
                error="Message not found"
            ))
            continue

        if not msg.has_comments:
            skipped.append(CommentFetchResult(
                message_id=msg_id,
                reason="has_comments=false"
            ))
            continue

        if not msg.linked_chat_id:
            skipped.append(CommentFetchResult(
                message_id=msg_id,
                reason="No linked discussion group"
            ))
            continue

        if msg.is_spam:
            skipped.append(CommentFetchResult(
                message_id=msg_id,
                reason="Message is spam"
            ))
            continue

        # Message is valid for comment fetching
        success.append(CommentFetchResult(
            message_id=msg_id,
            comments_count=None  # Will be populated by enrichment worker
        ))

    # Handle async vs sync mode
    if not success:
        return CommentFetchResponse(
            status="completed",
            messages_processed=0,
            success=[],
            failed=failed,
            skipped=skipped,
            info="No valid messages to process"
        )

    if request.async_mode:
        # Queue tasks to enrichment service via Redis
        valid_message_ids = [r.message_id for r in success]
        task_id = await enqueue_comment_fetch(valid_message_ids)
        queue_depth = await get_queue_depth()

        return CommentFetchResponse(
            status="queued",
            messages_processed=len(success),
            task_id=task_id,
            success=success,
            failed=failed,
            skipped=skipped,
            info=f"Queued {len(success)} messages for async comment fetching",
            queue_depth=queue_depth,
        )
    else:
        # Synchronous mode - not implemented (would require direct Telegram access)
        # For now, return validation results with info about async mode
        return CommentFetchResponse(
            status="completed",
            messages_processed=len(success),
            success=success,
            failed=failed,
            skipped=skipped,
            info=f"Validated {len(success)} messages. Note: sync mode not fully implemented - "
                 f"use async_mode=true to queue for background processing."
        )


@router.get("/stats", response_model=CommentStats)
async def get_comment_stats(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> CommentStats:
    """
    Get statistics about comment fetching status.

    Returns counts of:
    - Messages with comments (has_comments=true)
    - Messages never fetched (comments_fetched_at IS NULL)
    - Messages needing refresh (based on tiered polling)
    - Active viral posts
    """
    stats_query = """
        SELECT
            (SELECT COUNT(*) FROM messages WHERE has_comments = true AND linked_chat_id IS NOT NULL) as total_with_comments,
            (SELECT COUNT(*) FROM messages WHERE has_comments = true AND linked_chat_id IS NOT NULL AND comments_fetched_at IS NULL) as never_fetched,
            (SELECT COUNT(*) FROM messages m
             LEFT JOIN viral_posts vp ON vp.message_id = m.id AND vp.is_active = true
             WHERE m.has_comments = true
               AND m.linked_chat_id IS NOT NULL
               AND m.comments_fetched_at IS NOT NULL
               AND m.telegram_date > NOW() - INTERVAL '30 days'
               AND (
                   (vp.is_active = true AND (vp.last_comment_check IS NULL OR vp.last_comment_check < NOW() - INTERVAL '4 hours'))
                   OR (m.telegram_date > NOW() - INTERVAL '1 day' AND (m.comments_refreshed_at IS NULL OR m.comments_refreshed_at < NOW() - INTERVAL '4 hours'))
                   OR (m.telegram_date BETWEEN NOW() - INTERVAL '7 days' AND NOW() - INTERVAL '1 day' AND (m.comments_refreshed_at IS NULL OR m.comments_refreshed_at < NOW() - INTERVAL '24 hours'))
               )
            ) as needing_refresh,
            (SELECT COUNT(*) FROM viral_posts WHERE is_active = true) as viral_active,
            (SELECT COUNT(*) FROM messages WHERE has_comments = true AND comments_fetched_at > NOW() - INTERVAL '24 hours') as last_24h
    """

    result = await db.execute(text(stats_query))
    row = result.fetchone()

    return CommentStats(
        total_messages_with_comments=row.total_with_comments or 0,
        messages_never_fetched=row.never_fetched or 0,
        messages_needing_refresh=row.needing_refresh or 0,
        viral_posts_active=row.viral_active or 0,
        last_24h_fetched=row.last_24h or 0,
    )


@router.get("/viral", response_model=List[dict])
async def get_viral_posts(
    admin: AdminUser,
    active_only: bool = Query(True, description="Only show active viral posts"),
    limit: int = Query(50, le=200, description="Maximum results"),
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    """
    Get list of viral posts being tracked for enhanced polling.
    """
    query = """
        SELECT
            vp.id,
            vp.message_id,
            vp.detected_at,
            vp.viral_reason,
            vp.viral_score,
            vp.views_at_detection,
            vp.forwards_at_detection,
            vp.comments_at_detection,
            vp.channel_avg_views,
            vp.last_comment_check,
            vp.comment_check_count,
            vp.is_active,
            vp.deactivated_at,
            vp.deactivation_reason,
            m.content,
            m.views as current_views,
            m.forwards as current_forwards,
            m.comments_count as current_comments,
            c.name as channel_name
        FROM viral_posts vp
        JOIN messages m ON m.id = vp.message_id
        JOIN channels c ON c.id = m.channel_id
        WHERE (:active_only = false OR vp.is_active = true)
        ORDER BY vp.detected_at DESC
        LIMIT :limit
    """

    result = await db.execute(
        text(query),
        {"active_only": active_only, "limit": limit}
    )

    return [dict(row._mapping) for row in result]
