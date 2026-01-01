"""
Unified Intelligence Stream Router

Provides endpoints for accessing mixed Telegram + RSS content.
Implements semantic cross-correlation and alternative viewpoint highlighting.
"""

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, desc, select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from shared.python.models import Channel, Message, ExternalNews, RSSFeed

from ..database import get_db
from ..schemas import UnifiedStreamItem, CorrelationResponse

router = APIRouter(prefix="/api/stream", tags=["Intelligence Stream"])


@router.get("/unified", response_model=List[UnifiedStreamItem])
async def get_unified_stream(
    limit: int = Query(50, ge=1, le=200),
    sources: List[str] = Query(["telegram"]),
    categories: Optional[List[str]] = Query(None),
    importance_level: Optional[str] = Query(None, description="Filter by importance level (high/medium/low)"),
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """
    Get unified intelligence stream mixing Telegram and RSS content.

    Returns chronologically sorted items from multiple sources with enrichment data.
    This endpoint provides a unified view of intelligence by merging Telegram messages
    and RSS articles into a single stream, enabling cross-source analysis and
    correlation detection.

    The stream filters out spam messages and allows filtering by source type,
    category (channel folder or RSS feed category), importance level, and time window.
    Results are sorted by published_at timestamp in descending order (newest first).

    Source-specific behavior:
    - Telegram: Joins with channels table to get folder/category, applies spam filter
    - RSS: Joins with rss_feeds table to get feed metadata and trust level
    - Both: Content is truncated to 100 chars for titles, full content available in response

    Args:
        limit: Maximum items to return (1-200, default: 50)
        sources: Source types to include (default: ['telegram'], options: 'telegram', 'rss')
        categories: Filter by categories (channel folders or RSS feed categories)
        importance_level: Filter by importance ('high', 'medium', 'low'), applies to Telegram only
        hours: Time window to query (1-168 hours, default: 24)
        db: Database session

    Returns:
        List of UnifiedStreamItem objects containing:
        - type: Source type ('telegram' or 'rss')
        - id: Message/article database ID
        - source_name: Channel name or RSS feed name
        - source_category: Folder name (Telegram) or category (RSS)
        - source_trust_level: RSS feed trust level (None for Telegram)
        - title: Truncated content (100 chars max)
        - content: Full message/article text
        - content_translated: Translated content (Telegram only)
        - importance_level: Intelligence importance (Telegram only)
        - tags: Empty list (TODO: implement tag loading)
        - published_at: Message/article timestamp
        - url: API endpoint or external URL
        - correlation_count: Always 0 (TODO: implement correlation counting)
    """
    time_start = datetime.utcnow() - timedelta(hours=hours)
    items = []

    # Fetch Telegram messages
    if "telegram" in sources:
        # Select both Message and Channel explicitly to avoid relationship loading issues
        query = (
            select(Message, Channel)
            .join(Channel, Message.channel_id == Channel.id)
            .where(
                and_(
                    Message.telegram_date >= time_start,  # Use telegram_date (actual message time), not created_at (insertion time)
                    Message.is_spam == False,
                )
            )
        )

        # Apply importance level filter
        if importance_level is not None:
            query = query.where(Message.importance_level == importance_level)

        # Apply category filter
        if categories:
            query = query.where(Channel.folder.in_(categories))

        result = await db.execute(
            query.order_by(desc(Message.telegram_date)).limit(limit)  # Sort by actual message time
        )

        telegram_results = result.all()
        for message, channel in telegram_results:
            # Truncate long content
            title = (
                message.content[:100] + "..."
                if len(message.content or "") > 100
                else message.content
            )

            items.append(
                UnifiedStreamItem(
                    type="telegram",
                    id=message.id,
                    source_name=channel.name or f"Channel {channel.telegram_id}",
                    source_category=channel.folder,
                    source_trust_level=None,
                    title=title or "[No text content]",
                    content=message.content or "",
                    content_translated=message.content_translated,
                    importance_level=message.importance_level,
                    tags=[],  # TODO: Load tags relationship properly
                    published_at=message.telegram_date or message.created_at,  # Use actual message time
                    url=f"/api/messages/{message.id}",
                    correlation_count=0,
                )
            )

    # Fetch RSS articles
    if "rss" in sources:
        # Select both ExternalNews and RSSFeed explicitly to avoid relationship loading issues
        query = (
            select(ExternalNews, RSSFeed)
            .join(RSSFeed, ExternalNews.feed_id == RSSFeed.id)
            .where(ExternalNews.published_at >= time_start)
        )

        # Apply category filter
        if categories:
            query = query.where(RSSFeed.category.in_(categories))

        # Note: RSS articles don't have importance_level field yet
        # This filter only applies to Telegram messages

        result = await db.execute(
            query.order_by(desc(ExternalNews.published_at)).limit(limit)
        )

        rss_results = result.all()
        for article, feed in rss_results:
            items.append(
                UnifiedStreamItem(
                    type="rss",
                    id=article.id,
                    source_name=feed.name,
                    source_category=feed.category,
                    source_trust_level=feed.trust_level,
                    title=article.title or "[No title]",
                    content=article.content or article.summary or "",
                    importance_level=None,  # RSS articles don't have importance_level yet
                    tags=[],  # No tags on RSS articles yet
                    published_at=article.published_at,
                    url=article.url,
                    correlation_count=0,  # Will be populated when correlations work
                )
            )

    # Sort by published_at descending (newest first)
    items.sort(key=lambda x: x.published_at, reverse=True)

    return items[:limit]


@router.get("/correlations/{message_id}", response_model=CorrelationResponse)
async def get_message_correlations(
    message_id: int,
    min_similarity: float = Query(0.70, ge=0.0, le=1.0),
    db: AsyncSession = Depends(get_db),
):
    """
    Get RSS articles correlated with a Telegram message via semantic similarity.

    Uses pgvector cosine similarity search to find RSS articles related to a
    Telegram message based on embedding vectors. Results are categorized into
    three groups based on similarity score and perspective analysis:

    1. Same Event (similarity >= 0.85): Articles covering the same event from
       similar perspectives
    2. Related (0.70 <= similarity < 0.85): Articles on related topics or events
    3. Alternative Viewpoints: Articles with opposing perspectives (identified
       via sentiment/stance analysis)

    This enables cross-source verification and detection of narrative differences
    across Telegram channels and mainstream media sources.

    Implementation Notes:
    - Requires pgvector extension enabled in PostgreSQL
    - Depends on embeddings computed by enrichment service
    - Currently returns empty response (TODO: implement when external_news
      and message_news_correlations tables are added)
    - Similarity threshold of 0.70 balances precision and recall for OSINT use cases

    Args:
        message_id: Telegram message database ID
        min_similarity: Minimum cosine similarity threshold (0.0-1.0, default: 0.70)
        db: Database session

    Returns:
        CorrelationResponse containing:
        - message_id: Source message ID
        - same_event: List of high-similarity articles (>= 0.85)
        - related: List of related articles (0.70-0.84)
        - alternative_viewpoints: Articles with opposing perspectives
        - total_correlations: Total count of correlated articles

    Raises:
        Currently no exceptions raised. Returns empty response if message not found.
        Future implementation may raise HTTPException 404 for missing messages.
    """
    # Get the message
    message_result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = message_result.scalar_one_or_none()

    if not message:
        return CorrelationResponse(
            message_id=message_id,
            same_event=[],
            related=[],
            alternative_viewpoints=[],
            total_correlations=0,
        )

    # Since we don't have external_news or correlations tables yet in this phase,
    # return empty response
    # TODO: Implement when external_news and message_news_correlations tables exist
    return CorrelationResponse(
        message_id=message_id,
        same_event=[],
        related=[],
        alternative_viewpoints=[],
        total_correlations=0,
    )
