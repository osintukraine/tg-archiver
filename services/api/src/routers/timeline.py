"""
Timeline API Router - Temporal context for messages

Provides temporal context by showing messages before/after a target message.
Helps understand narrative development and event sequencing.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from typing import Any, Dict, List
from datetime import datetime

from shared.python.models import Message, Channel
from ..database import get_db
from ..utils.embedding_safety import format_embedding_safe

router = APIRouter(prefix="/api/messages", tags=["timeline"])


@router.get("/{message_id}/timeline")
async def get_timeline_context(
    message_id: int,
    before_count: int = Query(5, ge=0, le=20, description="Messages before"),
    after_count: int = Query(5, ge=0, le=20, description="Messages after"),
    same_channel_only: bool = Query(False, description="Filter to same channel"),
    use_semantic: bool = Query(True, description="Use semantic similarity to find topically related messages across time"),
    similarity_threshold: float = Query(0.7, ge=0.5, le=1.0, description="Min similarity for semantic timeline"),
    use_events: bool = Query(True, description="Use new event-based timeline when available (recommended)"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get temporal context around a message (before/after).

    **New (use_events=True):** Returns event-based timeline showing messages
    that are part of the same real-world event/story development.

    **Legacy (use_events=False):** Returns semantic similarity + time ordering
    (deprecated, will be removed in future version).

    **Purpose:**
    - Understand narrative flow
    - Find event sequences
    - Track story development
    - Identify coordinated messaging

    **Filters:**
    - `same_channel_only=true`: Only show messages from same channel
    - `same_channel_only=false`: Show messages from all channels (default)

    **Use Cases:**
    - "What happened before/after this report?"
    - "How did the narrative develop?"
    - "Are channels coordinating messages?"
    """
    # Try event-based timeline first (using V2 schema)
    if use_events:
        event_result = await db.execute(
            text("""
                SELECT
                    e.id as event_id,
                    e.title,
                    e.telegram_message_count as message_count
                FROM event_messages em
                JOIN events e ON em.event_id = e.id
                WHERE em.message_id = :message_id
                  AND em.unlinked_at IS NULL
                  AND e.deleted_at IS NULL
            """),
            {"message_id": message_id}
        )
        event_row = event_result.fetchone()

        if event_row and event_row.message_count > 1:
            # Has an event with multiple messages - use event timeline
            # Get the event timeline data
            timeline_result = await db.execute(
                text("""
                    SELECT
                        m.id,
                        m.content,
                        m.content_translated,
                        m.telegram_date,
                        m.importance_level,
                        m.views,
                        m.forwards,
                        m.media_type,
                        c.name AS channel_name,
                        c.username AS channel_username,
                        em.match_confidence as link_confidence
                    FROM event_messages em
                    JOIN messages m ON em.message_id = m.id
                    JOIN channels c ON m.channel_id = c.id
                    WHERE em.event_id = :event_id
                      AND em.unlinked_at IS NULL
                    ORDER BY m.telegram_date ASC
                """),
                {"event_id": event_row.event_id}
            )

            messages = [
                {
                    "id": row.id,
                    "content": row.content_translated or row.content,
                    "created_at": row.telegram_date.isoformat() if row.telegram_date else None,
                    "channel": row.channel_name,
                    "channel_username": row.channel_username,
                    "importance_level": row.importance_level,
                    "views": row.views,
                    "forwards": row.forwards,
                    "media_type": row.media_type,
                    "link_confidence": float(row.link_confidence) if row.link_confidence else None,
                }
                for row in timeline_result.fetchall()
            ]

            # Split messages into before and after based on the center message
            before_messages = []
            after_messages = []
            center_message_data = None

            for msg in messages:
                if msg["id"] == message_id:
                    center_message_data = msg
                elif center_message_data is None:
                    before_messages.append(msg)
                else:
                    after_messages.append(msg)

            # Return event-based timeline
            return {
                "center_message": center_message_data or {
                    "id": message_id,
                    "content": "Message not found",
                    "created_at": None,
                    "channel": None,
                    "importance_level": None,
                },
                "before": before_messages,
                "after": after_messages,
                "filters": {
                    "use_events": True,
                    "event_id": event_row.event_id,
                    "event_title": event_row.title,
                    "total_event_messages": event_row.message_count,
                    "before_count": len(before_messages),
                    "after_count": len(after_messages),
                },
            }

    # Fall back to legacy semantic timeline
    # Get central message with channel
    result = await db.execute(
        select(Message)
        .options(selectinload(Message.channel))
        .where(Message.id == message_id)
    )
    center_message = result.scalar_one_or_none()

    if not center_message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Use semantic similarity if enabled and message has embedding
    if use_semantic and center_message.content_embedding is not None:
        # SECURITY: Use validated embedding formatting to prevent SQL injection
        embedding_str = format_embedding_safe(center_message.content_embedding)

        # Query for semantically similar messages before and after
        # We need more results since we'll split by time and filter
        total_needed = before_count + after_count

        semantic_query = text(f"""
            SELECT
                m.id,
                m.content,
                m.content_translated,
                m.importance_level,
                m.created_at,
                c.name as channel_name,
                1 - (m.content_embedding <=> '{embedding_str}') AS similarity
            FROM messages m
            JOIN channels c ON m.channel_id = c.id
            WHERE m.id != :message_id
              AND m.content_embedding IS NOT NULL
              AND 1 - (m.content_embedding <=> '{embedding_str}') >= :threshold
            ORDER BY m.content_embedding <=> '{embedding_str}'
            LIMIT :limit
        """)

        result = await db.execute(
            semantic_query,
            {
                "message_id": message_id,
                "threshold": similarity_threshold,
                "limit": total_needed * 2,  # Get more, then split by time
            }
        )

        # Split results into before/after based on time
        all_similar = []
        for row in result:
            all_similar.append({
                "id": row.id,
                "content": row.content_translated or row.content,
                "created_at": row.created_at,
                "channel": row.channel_name,
                "importance_level": row.importance_level,
                "similarity": float(row.similarity),
            })

        # Split by time
        before_messages = [m for m in all_similar if m["created_at"] < center_message.created_at]
        after_messages = [m for m in all_similar if m["created_at"] > center_message.created_at]

        # Sort and limit
        before_messages = sorted(before_messages, key=lambda x: x["created_at"], reverse=True)[:before_count]
        after_messages = sorted(after_messages, key=lambda x: x["created_at"])[:after_count]

        # Reverse before to chronological order
        before_messages = list(reversed(before_messages))

    else:
        # Fallback to pure temporal queries (original behavior)
        query_before = (
            select(Message)
            .options(selectinload(Message.channel))
            .where(Message.created_at < center_message.created_at)
        )

        query_after = (
            select(Message)
            .options(selectinload(Message.channel))
            .where(Message.created_at > center_message.created_at)
        )

        # Filter to same channel if requested
        if same_channel_only:
            query_before = query_before.where(
                Message.channel_id == center_message.channel_id
            )
            query_after = query_after.where(
                Message.channel_id == center_message.channel_id
            )

        # Execute queries
        before_result = await db.execute(
            query_before.order_by(Message.created_at.desc()).limit(before_count)
        )
        after_result = await db.execute(
            query_after.order_by(Message.created_at.asc()).limit(after_count)
        )

        # Get results and convert to dict format
        before_raw = list(reversed(before_result.scalars().all()))
        after_raw = list(after_result.scalars().all())

        before_messages = [
            {
                "id": m.id,
                "content": (m.content_translated or m.content),
                "created_at": m.created_at,
                "channel": m.channel.name if m.channel else None,
                "importance_level": m.importance_level,
            }
            for m in before_raw
        ]

        after_messages = [
            {
                "id": m.id,
                "content": (m.content_translated or m.content),
                "created_at": m.created_at,
                "channel": m.channel.name if m.channel else None,
                "importance_level": m.importance_level,
            }
            for m in after_raw
        ]

    # Format response (before_messages and after_messages are already dicts if semantic, need conversion if not)
    def format_message(m):
        if isinstance(m, dict):
            # Already formatted from semantic query
            return {
                "id": m["id"],
                "content": m["content"][:200],
                "created_at": m["created_at"].isoformat() if hasattr(m["created_at"], 'isoformat') else m["created_at"],
                "channel": m["channel"],
                "importance_level": m["importance_level"],
                "similarity": m.get("similarity"),  # Only present for semantic results
            }
        else:
            # From ORM query
            return {
                "id": m.id,
                "content": (m.content_translated or m.content)[:200],
                "created_at": m.created_at.isoformat(),
                "channel": m.channel.name if m.channel else None,
                "importance_level": m.importance_level,
            }

    return {
        "center_message": {
            "id": center_message.id,
            "content": (
                center_message.content_translated or center_message.content
            ),
            "created_at": center_message.created_at.isoformat(),
            "channel": center_message.channel.name if center_message.channel else None,
            "importance_level": center_message.importance_level,
        },
        "before": [format_message(m) for m in before_messages],
        "after": [format_message(m) for m in after_messages],
        "filters": {
            "use_semantic": use_semantic,
            "same_channel_only": same_channel_only,
            "similarity_threshold": similarity_threshold if use_semantic else None,
            "before_count": len(before_messages),
            "after_count": len(after_messages),
        },
    }
