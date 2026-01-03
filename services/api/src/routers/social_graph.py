"""
Social Graph API Router

Endpoints for Telegram social interaction analysis:
- Message propagation (forwards, replies)
- Engagement timelines (views, reactions over time)
- Comment threads (discussion analysis)
- Channel influence networks
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, func
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

from ..database import get_db
from models import Message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/social-graph", tags=["social-graph"])


@router.get("/messages/{message_id}")
async def get_message_social_graph(
    message_id: int,
    include_forwards: bool = Query(True, description="Include forward chain"),
    include_replies: bool = Query(True, description="Include reply thread"),
    max_depth: int = Query(3, ge=1, le=10, description="Max graph depth"),
    max_comments: int = Query(50, ge=1, le=200, description="Max comments to include"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get social interaction graph for a message showing propagation and engagement.

    Builds a comprehensive graph representation of how a message spreads and generates
    engagement across the Telegram network. The graph includes the central message node,
    author attribution, forward propagation chain, reply threads, reactions, and comments.

    Author nodes can be either individual users (for group messages) or channels (for
    channel posts). Forward chain shows message propagation with timing data. Reply
    threads capture conversation structure. Reactions include emoji sentiment with
    counts. Comments come from linked discussion groups.

    The response includes engagement metrics (virality, reach, engagement rate) calculated
    from view counts, forward counts, and reaction totals. Virality levels range from
    'none' to 'very_high' based on forward thresholds. Reach levels are based on view counts.

    Args:
        message_id: Database message ID
        include_forwards: Include forward propagation chain from message_forwards table
        include_replies: Include reply thread from message_replies table
        max_depth: Maximum graph traversal depth (currently unused, reserved for future)
        max_comments: Maximum number of comments to include from message_comments table
        db: Database session

    Returns:
        Dict containing:
        - message_id: The queried message ID
        - nodes: List of graph nodes (message, author, forwards, replies, reactions, comments)
        - edges: List of graph edges connecting nodes with relationship types
        - reactions: List of reaction data with emoji, count, and last_updated
        - metadata: Engagement metrics including virality, reach, engagement_rate

    Raises:
        HTTPException 404: Message not found
    """
    # Get the message
    result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    nodes = []
    edges = []

    # Center node: The message itself
    nodes.append({
        "id": f"msg-{message.id}",
        "type": "message",
        "label": (message.content or "")[:50],
        "data": {
            "message_id": message.id,
            "content": message.content,
            "channel_id": message.channel_id,
            "views": message.views,
            "forwards": message.forwards,
            "created_at": message.telegram_date.isoformat() if message.telegram_date else None,
        }
    })

    # Author node - Either the user (for group messages) or the channel (for channel posts)
    # Get channel info for author fallback
    channel_info = None
    try:
        channel_query = text("""
            SELECT id, name, username FROM channels WHERE id = :channel_id
        """)
        channel_result = await db.execute(channel_query, {"channel_id": message.channel_id})
        channel_info = channel_result.first()
    except Exception as e:
        logger.warning("Could not fetch channel info for message %d: %s", message.id, e)

    if message.author_user_id:
        # Individual user author (common in group chats)
        nodes.append({
            "id": f"user-{message.author_user_id}",
            "type": "author",
            "label": f"User {message.author_user_id}",
            "data": {
                "user_id": message.author_user_id,
                "is_channel": False,
            }
        })
        edges.append({
            "id": f"edge-author-{message.id}",
            "source": f"user-{message.author_user_id}",
            "target": f"msg-{message.id}",
            "type": "authored",
            "label": "posted"
        })
    elif channel_info:
        # Channel is the author (for channel posts without individual author)
        channel_label = channel_info.name or channel_info.username or f"Channel {channel_info.id}"
        nodes.append({
            "id": f"channel-{channel_info.id}",
            "type": "author",
            "label": channel_label,
            "data": {
                "channel_id": channel_info.id,
                "channel_name": channel_info.name,
                "channel_username": channel_info.username,
                "is_channel": True,
            }
        })
        edges.append({
            "id": f"edge-author-channel-{message.id}",
            "source": f"channel-{channel_info.id}",
            "target": f"msg-{message.id}",
            "type": "authored",
            "label": "posted"
        })

    # Forward chain (NEW: from message_forwards table)
    if include_forwards:
        try:
            forwards_query = text("""
                SELECT
                    mf.id,
                    mf.forwarded_message_id,
                    mf.forward_date,
                    mf.propagation_seconds,
                    m.content,
                    m.channel_id
                FROM message_forwards mf
                JOIN messages m ON m.id = mf.forwarded_message_id
                WHERE mf.original_message_id = :message_id
                ORDER BY mf.forward_date DESC
                LIMIT 20
            """)
            forwards_result = await db.execute(forwards_query, {"message_id": message.id})
            forwards = list(forwards_result)

            for fwd in forwards:
                nodes.append({
                    "id": f"msg-{fwd.forwarded_message_id}",
                    "type": "forwarded_message",
                    "label": (fwd.content or "Forwarded")[:30],
                    "data": {
                        "message_id": fwd.forwarded_message_id,
                        "channel_id": fwd.channel_id,
                        "forward_date": fwd.forward_date.isoformat() if fwd.forward_date else None,
                        "propagation_seconds": fwd.propagation_seconds,
                    }
                })
                edges.append({
                    "id": f"edge-forward-{fwd.id}",
                    "source": f"msg-{message.id}",
                    "target": f"msg-{fwd.forwarded_message_id}",
                    "type": "forwarded_to",
                    "label": f"{fwd.propagation_seconds}s" if fwd.propagation_seconds else "forwarded",
                    "data": {
                        "propagation_seconds": fwd.propagation_seconds
                    }
                })
        except Exception as e:
            logger.warning("Could not fetch forwards for message %d: %s", message.id, e)

    # Reply thread (NEW: from message_replies table)
    if include_replies:
        try:
            replies_query = text("""
                SELECT
                    mr.id,
                    mr.reply_message_id,
                    mr.author_user_id,
                    mr.created_at,
                    m.content
                FROM message_replies mr
                JOIN messages m ON m.id = mr.reply_message_id
                WHERE mr.parent_message_id = :message_id
                ORDER BY mr.created_at ASC
                LIMIT 20
            """)
            replies_result = await db.execute(replies_query, {"message_id": message.id})
            replies = list(replies_result)

            for reply in replies:
                nodes.append({
                    "id": f"msg-{reply.reply_message_id}",
                    "type": "reply",
                    "label": (reply.content or "Reply")[:30],
                    "data": {
                        "message_id": reply.reply_message_id,
                        "author_user_id": reply.author_user_id,
                        "created_at": reply.created_at.isoformat() if reply.created_at else None,
                    }
                })
                edges.append({
                    "id": f"edge-reply-{reply.id}",
                    "source": f"msg-{reply.reply_message_id}",
                    "target": f"msg-{message.id}",
                    "type": "replied_to",
                    "label": "replied"
                })
        except Exception as e:
            logger.warning("Could not fetch replies for message %d: %s", message.id, e)

    # Reactions (from message_reactions table)
    # Get only the latest count per emoji (table stores historical snapshots)
    reactions_data = []
    try:
        reactions_query = text("""
            SELECT DISTINCT ON (emoji)
                emoji,
                count,
                last_updated
            FROM message_reactions
            WHERE message_id = :message_id
            ORDER BY emoji, last_updated DESC
        """)
        reactions_result = await db.execute(reactions_query, {"message_id": message.id})
        reactions = list(reactions_result)

        for reaction in reactions:
            reactions_data.append({
                "emoji": reaction.emoji,
                "count": reaction.count,
                "last_updated": reaction.last_updated.isoformat() if reaction.last_updated else None,
            })

            # Add reaction as a graph node
            # Normalize emoji for node ID (handle special cases like "ReactionPaid()")
            emoji_id = reaction.emoji.replace("(", "").replace(")", "").replace(" ", "_")
            nodes.append({
                "id": f"reaction-{emoji_id}",
                "type": "reaction",
                "label": f"{reaction.emoji} {reaction.count:,}",
                "data": {
                    "emoji": reaction.emoji,
                    "count": reaction.count,
                    "last_updated": reaction.last_updated.isoformat() if reaction.last_updated else None,
                }
            })
            edges.append({
                "id": f"edge-reaction-{emoji_id}",
                "source": f"reaction-{emoji_id}",
                "target": f"msg-{message.id}",
                "type": "reacted",
                "label": ""  # No label needed for reactions
            })
    except Exception as e:
        logger.warning("Could not fetch reactions for message %d: %s", message.id, e)

    # Comments (from message_comments table)
    if message.has_comments:
        try:
            comments_query = text("""
                SELECT
                    id,
                    content,
                    author_user_id,
                    telegram_date as created_at
                FROM message_comments
                WHERE parent_message_id = :message_id
                ORDER BY telegram_date ASC
                LIMIT :max_comments
            """)

            comments_result = await db.execute(
                comments_query,
                {"message_id": message.id, "max_comments": max_comments}
            )
            comments = list(comments_result)

            for idx, comment in enumerate(comments):
                nodes.append({
                    "id": f"comment-{comment.id}",
                    "type": "comment",
                    "label": comment.content[:30] if comment.content else f"Comment {idx+1}",
                    "data": {
                        "comment_id": comment.id,
                        "content": comment.content,
                        "author_user_id": comment.author_user_id,
                        "created_at": comment.created_at.isoformat() if comment.created_at else None,
                    }
                })
                edges.append({
                    "id": f"edge-comment-{comment.id}",
                    "source": f"comment-{comment.id}",
                    "target": f"msg-{message.id}",
                    "type": "commented_on",
                    "label": "commented"
                })
        except Exception as e:
            logger.warning("Could not fetch comments for message %d: %s", message.id, e)

    # Calculate engagement metrics
    views = message.views or 0
    forwards = message.forwards or 0
    reactions_total = sum(r["count"] for r in reactions_data)
    engagement_rate = ((forwards + reactions_total) / views) if views > 0 else 0.0

    # Determine virality level based on forward count
    if forwards >= 1000:
        virality = "very_high"
    elif forwards >= 100:
        virality = "high"
    elif forwards >= 10:
        virality = "medium"
    elif forwards > 0:
        virality = "low"
    else:
        virality = "none"

    # Determine reach level based on view count
    if views >= 100000:
        reach = "very_high"
    elif views >= 10000:
        reach = "high"
    elif views >= 1000:
        reach = "medium"
    elif views > 0:
        reach = "low"
    else:
        reach = "none"

    # Build author info for metadata
    author_info = None
    if message.author_user_id:
        author_info = {
            "type": "user",
            "user_id": message.author_user_id,
            "name": f"User {message.author_user_id}",
        }
    elif channel_info:
        author_info = {
            "type": "channel",
            "channel_id": channel_info.id,
            "name": channel_info.name or channel_info.username or f"Channel {channel_info.id}",
            "username": channel_info.username,
        }

    return {
        "message_id": message.id,
        "nodes": nodes,
        "edges": edges,
        "reactions": reactions_data,
        "metadata": {
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "has_author": True,  # Always true now (either user or channel)
            "author": author_info,
            "is_forward": message.forward_from_message_id is not None,
            "is_reply": message.replied_to_message_id is not None,
            "has_comments": message.has_comments,
            "comments_count": message.comments_count,
            # Engagement metrics
            "views": views,
            "forwards": forwards,
            "reactions_total": reactions_total,
            "engagement_rate": round(engagement_rate, 4),
            "virality": virality,
            "reach": reach,
        }
    }


@router.get("/channels/{channel_id}/influence")
async def get_channel_influence(
    channel_id: int,
    limit: int = Query(20, ge=1, le=100, description="Max channels to return"),
    min_forward_count: int = Query(1, ge=1, description="Minimum forwards"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get bidirectional channel influence network showing forward relationships.

    Analyzes the channel's position in the broader information ecosystem by identifying
    which channels it forwards content to (outgoing influence) and which channels forward
    its content (incoming influence). This reveals information flow patterns, content
    amplification networks, and channel authority.

    Uses the channel_interactions materialized view which aggregates forward relationships
    with metrics like forward count, average propagation time, and timestamps. Outgoing
    relationships show content redistribution patterns. Incoming relationships indicate
    the channel's influence and credibility.

    Propagation time metrics reveal how quickly content spreads between channels, which
    can indicate coordination or automated forwarding. High forward counts with low
    propagation times may suggest bot networks or coordinated information campaigns.

    Args:
        channel_id: Database channel ID
        limit: Maximum channels to return per direction (outgoing/incoming)
        min_forward_count: Minimum number of forwards required to include relationship
        db: Database session

    Returns:
        Dict containing:
        - channel_id: The queried channel ID
        - outgoing: List of channels this channel forwards TO
        - incoming: List of channels that forward FROM this channel
        - metadata: Aggregate metrics (counts and totals for both directions)
    """
    # Get forward relationships where this channel is the source
    try:
        outgoing_query = text("""
            SELECT
                c.id as target_channel_id,
                c.name as target_channel_name,
                c.username as target_channel_username,
                ci.forward_count,
                ci.avg_propagation_seconds,
                ci.last_forward_at
            FROM channel_interactions ci
            JOIN channels c ON c.id = ci.target_channel_id
            WHERE ci.source_channel_id = :channel_id
                AND ci.forward_count >= :min_forward_count
            ORDER BY ci.forward_count DESC
            LIMIT :limit
        """)
        outgoing_result = await db.execute(
            outgoing_query,
            {"channel_id": channel_id, "min_forward_count": min_forward_count, "limit": limit}
        )
        outgoing = list(outgoing_result)
    except Exception as e:
        logger.warning("Could not fetch outgoing forwards for channel %d: %s", channel_id, e)
        outgoing = []

    # Get forward relationships where this channel is the target
    try:
        incoming_query = text("""
            SELECT
                c.id as source_channel_id,
                c.name as source_channel_name,
                c.username as source_channel_username,
                ci.forward_count,
                ci.avg_propagation_seconds,
                ci.first_forward_at
            FROM channel_interactions ci
            JOIN channels c ON c.id = ci.source_channel_id
            WHERE ci.target_channel_id = :channel_id
                AND ci.forward_count >= :min_forward_count
            ORDER BY ci.forward_count DESC
            LIMIT :limit
        """)
        incoming_result = await db.execute(
            incoming_query,
            {"channel_id": channel_id, "min_forward_count": min_forward_count, "limit": limit}
        )
        incoming = list(incoming_result)
    except Exception as e:
        logger.warning("Could not fetch incoming forwards for channel %d: %s", channel_id, e)
        incoming = []

    # Format outgoing relationships
    outgoing_list = []
    for row in outgoing:
        outgoing_list.append({
            "channel_id": row.target_channel_id,
            "channel_name": row.target_channel_name,
            "channel_username": row.target_channel_username,
            "forward_count": row.forward_count,
            "avg_propagation_seconds": float(row.avg_propagation_seconds) if row.avg_propagation_seconds else None,
            "last_forward_at": row.last_forward_at.isoformat() if row.last_forward_at else None,
        })

    # Format incoming relationships
    incoming_list = []
    for row in incoming:
        incoming_list.append({
            "channel_id": row.source_channel_id,
            "channel_name": row.source_channel_name,
            "channel_username": row.source_channel_username,
            "forward_count": row.forward_count,
            "avg_propagation_seconds": float(row.avg_propagation_seconds) if row.avg_propagation_seconds else None,
            "first_forward_at": row.first_forward_at.isoformat() if row.first_forward_at else None,
        })

    return {
        "channel_id": channel_id,
        "outgoing": outgoing_list,  # Channels this channel forwards TO
        "incoming": incoming_list,  # Channels that forward FROM this channel
        "metadata": {
            "outgoing_count": len(outgoing_list),
            "incoming_count": len(incoming_list),
            "total_outgoing_forwards": sum(r["forward_count"] for r in outgoing_list),
            "total_incoming_forwards": sum(r["forward_count"] for r in incoming_list),
        }
    }


@router.get("/influence-network")
async def get_influence_network(
    min_forward_count: int = Query(10, ge=1, description="Minimum forwards"),
    limit: int = Query(50, ge=1, le=200, description="Max channel pairs"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get platform-wide channel influence network ranked by influence score.

    Provides a bird's-eye view of information flow across the entire monitored Telegram
    ecosystem. Shows the most significant channel-to-channel forwarding relationships,
    ranked by a composite influence score that factors in forward count and propagation speed.

    Uses the channel_influence_network materialized view, which pre-computes influence
    metrics across all channel pairs. This view is periodically refreshed by the
    social graph enrichment task to maintain performance for this expensive aggregation.

    The influence score helps identify key information hubs, amplification nodes, and
    coordinated forwarding networks. High-influence relationships often indicate editorial
    alignment, coordination, or authoritative source relationships.

    This endpoint is particularly useful for:
    - Identifying coordinated information campaigns
    - Mapping propaganda distribution networks
    - Finding authoritative sources that drive narratives
    - Detecting bot networks through propagation timing patterns

    Args:
        min_forward_count: Minimum forwards to include a relationship (filters noise)
        limit: Maximum channel pairs to return (top N by influence score)
        db: Database session

    Returns:
        Dict containing:
        - relationships: List of source-target channel pairs with influence metrics
        - metadata: Total relationship count and minimum forward threshold

    Raises:
        HTTPException 500: Database tables not initialized or materialized view missing
    """
    try:
        network_query = text("""
            SELECT
                source_channel_id,
                source_channel_name,
                source_channel_username,
                target_channel_id,
                target_channel_name,
                target_channel_username,
                forward_count,
                avg_propagation_seconds,
                influence_score
            FROM channel_influence_network
            WHERE forward_count >= :min_forward_count
            ORDER BY influence_score DESC NULLS LAST
            LIMIT :limit
        """)
        network_result = await db.execute(
            network_query,
            {"min_forward_count": min_forward_count, "limit": limit}
        )
        network_data = list(network_result)
    except Exception as e:
        logger.error(f"Could not fetch influence network: {e}")
        raise HTTPException(
            status_code=500,
            detail="Could not fetch influence network. Please try again later."
        )

    # Format relationships
    relationships = []
    for row in network_data:
        relationships.append({
            "source": {
                "channel_id": row.source_channel_id,
                "channel_name": row.source_channel_name,
                "channel_username": row.source_channel_username,
            },
            "target": {
                "channel_id": row.target_channel_id,
                "channel_name": row.target_channel_name,
                "channel_username": row.target_channel_username,
            },
            "forward_count": row.forward_count,
            "avg_propagation_seconds": float(row.avg_propagation_seconds) if row.avg_propagation_seconds else None,
            "influence_score": float(row.influence_score) if row.influence_score else 0.0,
        })

    return {
        "relationships": relationships,
        "metadata": {
            "total_relationships": len(relationships),
            "min_forward_count": min_forward_count,
        }
    }


@router.get("/messages/{message_id}/engagement-timeline")
async def get_engagement_timeline(
    message_id: int,
    granularity: str = Query("hour", pattern="^(hour|day|week)$", description="Time granularity"),
    time_range_hours: int = Query(168, ge=1, le=720, description="Hours to look back (default 7 days)"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get time-series engagement data showing message virality evolution.

    Provides historical snapshots of message engagement metrics (views, forwards,
    reactions, comments) over time. This reveals how content spreads through the
    network, when it reaches peak virality, and whether engagement is organic or
    artificially inflated.

    Data comes from the message_engagement_timeline table, which is populated by
    periodic polling from the engagement metrics enrichment task. The task captures
    snapshots at regular intervals to track engagement growth curves.

    Engagement patterns can indicate:
    - Organic spread: Gradual view/forward growth over hours/days
    - Coordinated amplification: Sudden spikes in forwards with low view counts
    - Bot activity: Linear forward growth without corresponding view increases
    - Natural virality: Exponential growth followed by plateau

    If no historical data exists (e.g., new message or enrichment task not running),
    returns current snapshot only with empty data_points array.

    Args:
        message_id: Database message ID
        granularity: Time bucket granularity (hour/day/week) - currently informational only
        time_range_hours: Hours of history to return (default 7 days, max 30 days)
        db: Database session

    Returns:
        Dict containing:
        - message_id: The queried message ID
        - granularity: Requested time granularity
        - time_range_hours: Requested time range
        - data_points: List of timestamped engagement snapshots
        - current_snapshot: Latest engagement metrics from messages table
        - metadata: Total data points and timestamp range

    Raises:
        HTTPException 404: Message not found
    """
    # Get the message
    result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Query engagement timeline from table
    timeline_data = []
    try:
        timeline_query = text("""
            SELECT
                snapshot_time,
                views,
                forwards,
                reactions_total,
                comments_count
            FROM message_engagement_timeline
            WHERE message_id = :message_id
                AND snapshot_time >= NOW() - make_interval(hours => :hours)
            ORDER BY snapshot_time ASC
        """)

        timeline_result = await db.execute(
            timeline_query,
            {"message_id": message.id, "hours": time_range_hours}
        )
        timeline_data = list(timeline_result)
    except Exception as e:
        # Table doesn't exist yet - will return current snapshot below
        logger.warning("Could not fetch engagement timeline for message %d: %s", message.id, e)

    # If no timeline data, return current snapshot
    if not timeline_data:
        return {
            "message_id": message.id,
            "granularity": granularity,
            "time_range_hours": time_range_hours,
            "data_points": [],
            "current_snapshot": {
                "views": message.views,
                "forwards": message.forwards,
                "has_comments": message.has_comments,
                "comments_count": message.comments_count,
                "created_at": message.telegram_date.isoformat() if message.telegram_date else None,
            },
            "metadata": {
                "total_data_points": 0,
                "oldest_snapshot": None,
                "newest_snapshot": None,
            }
        }

    # Format timeline data
    data_points = []
    for row in timeline_data:
        data_points.append({
            "timestamp": row.snapshot_time.isoformat() if row.snapshot_time else None,
            "views": row.views,
            "forwards": row.forwards,
            "reactions_total": row.reactions_total,
            "comments_count": row.comments_count,
        })

    return {
        "message_id": message.id,
        "granularity": granularity,
        "time_range_hours": time_range_hours,
        "data_points": data_points,
        "current_snapshot": {
            "views": message.views,
            "forwards": message.forwards,
            "has_comments": message.has_comments,
            "comments_count": message.comments_count,
            "created_at": message.telegram_date.isoformat() if message.telegram_date else None,
        },
        "metadata": {
            "total_data_points": len(data_points),
            "oldest_snapshot": data_points[0]["timestamp"] if data_points else None,
            "newest_snapshot": data_points[-1]["timestamp"] if data_points else None,
        }
    }


@router.get("/messages/{message_id}/comments")
async def get_message_comments(
    message_id: int,
    limit: int = Query(50, ge=1, le=200, description="Max comments to return"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    sort: str = Query("asc", pattern="^(asc|desc)$", description="Sort by time"),
    include_replies: bool = Query(True, description="Include comment replies"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get paginated comment thread from linked Telegram discussion groups.

    Retrieves comments posted in a channel's linked discussion group for a specific
    message. Telegram channels can link to discussion groups where subscribers can
    comment on channel posts. These comments provide additional context, user
    sentiment, and discussion around the original message.

    Comments are stored in the message_comments table and include both original and
    translated content (via DeepL Pro). The linked_chat_id field on the parent message
    indicates which discussion group the comments came from.

    Comments can reveal:
    - User sentiment and reactions to channel content
    - Additional context or corrections from community members
    - Coordinated messaging or bot-generated responses
    - Genuine discussion vs astroturfing patterns

    Supports pagination for large comment threads and bi-directional sorting (oldest
    first for chronological reading, newest first for latest reactions).

    Args:
        message_id: Database message ID (parent message with linked discussion)
        limit: Maximum comments per page (default 50, max 200)
        offset: Pagination offset for fetching subsequent pages
        sort: Sort order by timestamp ('asc' for chronological, 'desc' for reverse)
        include_replies: Include nested comment replies (currently unused, reserved)
        db: Database session

    Returns:
        Dict containing:
        - message_id: The queried parent message ID
        - comments: List of comment objects with content, author, timestamps
        - pagination: Pagination metadata (total, limit, offset, has_more)
        - metadata: Parent message comment settings and linked chat info

    Raises:
        HTTPException 404: Message not found
    """
    # Get the message
    result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Query comments
    comments = []
    total_comments = 0
    try:
        sort_order = "ASC" if sort == "asc" else "DESC"
        comments_query = text(f"""
            SELECT
                id,
                content,
                translated_content,
                author_user_id,
                telegram_date as created_at,
                original_language,
                translation_method
            FROM message_comments
            WHERE parent_message_id = :message_id
            ORDER BY telegram_date {sort_order}
            LIMIT :limit OFFSET :offset
        """)

        comments_result = await db.execute(
            comments_query,
            {"message_id": message.id, "limit": limit, "offset": offset}
        )
        comments = list(comments_result)

        # Get total count
        count_query = text("""
            SELECT COUNT(*) as total
            FROM message_comments
            WHERE parent_message_id = :message_id
        """)
        count_result = await db.execute(count_query, {"message_id": message.id})
        total_comments = count_result.scalar() or 0
    except Exception as e:
        # Table doesn't exist yet - return empty list
        logger.warning("Could not fetch comments for message %d: %s", message.id, e)

    # Format comments
    comments_list = []
    for comment in comments:
        comments_list.append({
            "id": comment.id,
            "content": comment.content,
            "translated_content": comment.translated_content,
            "author_user_id": comment.author_user_id,
            "created_at": comment.created_at.isoformat() if comment.created_at else None,
            "original_language": comment.original_language,
            "translation_method": comment.translation_method,
        })

    return {
        "message_id": message.id,
        "comments": comments_list,
        "pagination": {
            "total": total_comments,
            "limit": limit,
            "offset": offset,
            "has_more": (offset + limit) < total_comments,
        },
        "metadata": {
            "has_comments": message.has_comments,
            "comments_count": message.comments_count,
            "linked_chat_id": message.linked_chat_id,
        }
    }


@router.get("/virality/top-forwarded")
async def get_top_forwarded_messages(
    limit: int = Query(20, ge=1, le=100, description="Max messages to return"),
    time_range_days: int = Query(7, ge=1, le=365, description="Days to look back"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get virality leaderboard showing most-forwarded messages.

    Identifies the most viral content in the platform by ranking messages by forward
    count within a specified time window. This reveals which narratives, claims, or
    media are spreading most rapidly through the Telegram network.

    Uses the top_forwarded_messages materialized view for performance. This view
    pre-aggregates forward counts, propagation timing, and engagement metrics across
    all messages. The view is refreshed periodically by the social graph enrichment task.

    Forward count is the primary virality metric, but additional context includes:
    - Fastest propagation time: How quickly the first forward occurred
    - Average propagation time: Mean time for all forwards
    - View count: Total reach of the original message

    High forward counts with fast propagation often indicate:
    - Breaking news or significant events
    - Coordinated information campaigns
    - Emotional or provocative content designed for maximum spread
    - Bot-amplified propaganda or disinformation

    This endpoint is critical for monitoring emerging narratives and identifying
    potential disinformation campaigns early in their propagation cycle.

    Args:
        limit: Maximum messages to return (top N by forward count)
        time_range_days: Only include messages with forwards in last N days
        db: Database session

    Returns:
        Dict containing:
        - messages: List of viral messages with forward metrics and content preview
        - metadata: Total message count and time range filter

    Raises:
        HTTPException 500: Database tables not initialized or materialized view missing
    """
    try:
        virality_query = text("""
            SELECT
                message_id,
                telegram_message_id,
                channel_id,
                channel_name,
                channel_username,
                content_preview,
                telegram_date,
                forward_count,
                fastest_propagation_seconds,
                avg_propagation_seconds,
                last_forward_date,
                views
            FROM top_forwarded_messages
            WHERE last_forward_date >= NOW() - make_interval(days => :days)
            ORDER BY forward_count DESC
            LIMIT :limit
        """)
        virality_result = await db.execute(
            virality_query,
            {"days": time_range_days, "limit": limit}
        )
        top_messages = list(virality_result)
    except Exception as e:
        logger.error(f"Could not fetch virality data: {e}")
        raise HTTPException(
            status_code=500,
            detail="Could not fetch virality data. Please try again later."
        )

    # Format messages
    messages_list = []
    for row in top_messages:
        messages_list.append({
            "message_id": row.message_id,
            "telegram_message_id": row.telegram_message_id,
            "channel": {
                "channel_id": row.channel_id,
                "channel_name": row.channel_name,
                "channel_username": row.channel_username,
            },
            "content_preview": row.content_preview,
            "telegram_date": row.telegram_date.isoformat() if row.telegram_date else None,
            "forward_count": row.forward_count,
            "fastest_propagation_seconds": row.fastest_propagation_seconds,
            "avg_propagation_seconds": float(row.avg_propagation_seconds) if row.avg_propagation_seconds else None,
            "last_forward_date": row.last_forward_date.isoformat() if row.last_forward_date else None,
            "views": row.views,
        })

    return {
        "messages": messages_list,
        "metadata": {
            "total_messages": len(messages_list),
            "time_range_days": time_range_days,
        }
    }
