"""
RSS Stream Router

Provides endpoint for accessing RSS feed content in chronological order.
"""

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ExternalNews, RSSFeed

from ..database import get_db
from ..schemas import RSSStreamItem

router = APIRouter(prefix="/api/stream", tags=["stream"])


@router.get("/rss", response_model=List[RSSStreamItem])
async def get_rss_stream(
    limit: int = Query(50, ge=1, le=200),
    categories: Optional[List[str]] = Query(None),
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db),
):
    """
    Get RSS feed articles in chronological order.

    Returns articles from subscribed RSS feeds, sorted by published date.

    Args:
        limit: Maximum items to return (1-200, default: 50)
        categories: Filter by RSS feed categories
        hours: Time window to query (1-168 hours, default: 24)
        db: Database session

    Returns:
        List of RSSStreamItem with feed info, content, and timestamps.
    """
    time_start = datetime.utcnow() - timedelta(hours=hours)

    query = (
        select(ExternalNews, RSSFeed)
        .join(RSSFeed, ExternalNews.feed_id == RSSFeed.id)
        .where(ExternalNews.published_at >= time_start)
    )

    if categories:
        query = query.where(RSSFeed.category.in_(categories))

    result = await db.execute(
        query.order_by(desc(ExternalNews.published_at)).limit(limit)
    )

    items = []
    for article, feed in result.all():
        items.append(
            RSSStreamItem(
                id=article.id,
                feed_name=feed.name,
                feed_category=feed.category,
                trust_level=feed.trust_level,
                title=article.title or "[No title]",
                summary=article.summary,
                content=article.content or article.summary or "",
                author=article.author,
                published_at=article.published_at,
                url=article.url,
            )
        )

    return items
