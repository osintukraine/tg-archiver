"""
Admin RSS Feeds Management Router - Simplified

Basic CRUD operations for RSS feed sources.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models.rss_feed import RSSFeed
from models.external_news import ExternalNews

from ...database import get_db
from ...dependencies import AdminUser


router = APIRouter(prefix="/api/admin/feeds", tags=["Admin - Feeds"])


# =============================================================================
# SCHEMAS
# =============================================================================


class FeedCreate(BaseModel):
    """Schema for creating a new RSS feed."""
    name: str = Field(..., min_length=1, max_length=255)
    url: str = Field(..., description="RSS feed URL")
    category: Optional[str] = Field(None, description="Category")
    language: Optional[str] = Field("en", max_length=10)
    is_active: bool = Field(True)


class FeedUpdate(BaseModel):
    """Schema for updating an RSS feed."""
    name: Optional[str] = Field(None, max_length=255)
    url: Optional[str] = None
    category: Optional[str] = None
    language: Optional[str] = Field(None, max_length=10)
    is_active: Optional[bool] = None


class FeedResponse(BaseModel):
    """Schema for RSS feed response."""
    id: int
    name: str
    url: str
    category: Optional[str]
    language: Optional[str]
    is_active: bool
    last_fetched_at: Optional[str]
    fetch_interval_minutes: Optional[int]
    error_count: int
    last_error: Optional[str]
    created_at: Optional[str]


class FeedStats(BaseModel):
    """RSS feed statistics."""
    total_feeds: int
    active_feeds: int
    inactive_feeds: int
    by_category: Dict[str, int]
    total_articles: int
    failing_feeds: int


# =============================================================================
# LIST / STATS
# =============================================================================


@router.get("/rss")
async def list_feeds(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=10, le=100),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """List RSS feeds with pagination."""
    try:
        query = select(RSSFeed)

        if search:
            query = query.where(
                RSSFeed.name.ilike(f"%{search}%") |
                RSSFeed.url.ilike(f"%{search}%")
            )
        if category:
            query = query.where(RSSFeed.category == category)
        if is_active is not None:
            query = query.where(RSSFeed.is_active == is_active)

        # Count
        count_query = select(func.count(RSSFeed.id))
        if search:
            count_query = count_query.where(
                RSSFeed.name.ilike(f"%{search}%") |
                RSSFeed.url.ilike(f"%{search}%")
            )
        if category:
            count_query = count_query.where(RSSFeed.category == category)
        if is_active is not None:
            count_query = count_query.where(RSSFeed.is_active == is_active)

        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        # Paginate
        query = query.order_by(RSSFeed.name)
        query = query.limit(page_size).offset((page - 1) * page_size)

        result = await db.execute(query)
        feeds = result.scalars().all()

        items = [
            FeedResponse(
                id=f.id,
                name=f.name,
                url=f.url,
                category=f.category,
                language=f.language,
                is_active=f.is_active or False,
                last_fetched_at=f.last_fetched_at.isoformat() if f.last_fetched_at else None,
                fetch_interval_minutes=f.fetch_interval_minutes,
                error_count=f.error_count or 0,
                last_error=f.last_error,
                created_at=f.created_at.isoformat() if f.created_at else None,
            ).model_dump()
            for f in feeds
        ]

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size if total > 0 else 0,
        }

    except Exception as e:
        return {
            "error": str(e),
            "items": [],
            "total": 0,
            "page": 1,
            "page_size": page_size,
            "total_pages": 0,
        }


@router.get("/rss/stats")
async def get_feed_stats(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> FeedStats:
    """Get RSS feed statistics."""
    # Total counts
    total_result = await db.execute(select(func.count(RSSFeed.id)))
    total_feeds = total_result.scalar() or 0

    active_result = await db.execute(
        select(func.count(RSSFeed.id)).where(RSSFeed.is_active == True)
    )
    active_feeds = active_result.scalar() or 0

    # By category
    category_result = await db.execute(
        select(RSSFeed.category, func.count(RSSFeed.id))
        .group_by(RSSFeed.category)
    )
    by_category = {r[0] or "uncategorized": r[1] for r in category_result.fetchall()}

    # Articles count
    articles_result = await db.execute(select(func.count(ExternalNews.id)))
    total_articles = articles_result.scalar() or 0

    # Failing feeds (error_count > 0)
    failing_result = await db.execute(
        select(func.count(RSSFeed.id)).where(RSSFeed.error_count > 0)
    )
    failing_feeds = failing_result.scalar() or 0

    return FeedStats(
        total_feeds=total_feeds,
        active_feeds=active_feeds,
        inactive_feeds=total_feeds - active_feeds,
        by_category=by_category,
        total_articles=total_articles,
        failing_feeds=failing_feeds,
    )


@router.get("/rss/categories")
async def get_categories(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> List[Dict[str, Any]]:
    """Get available categories."""
    result = await db.execute(
        select(RSSFeed.category, func.count(RSSFeed.id))
        .where(RSSFeed.category.isnot(None))
        .group_by(RSSFeed.category)
        .order_by(func.count(RSSFeed.id).desc())
    )
    return [{"name": r[0], "count": r[1]} for r in result.fetchall()]


@router.get("/rss/{feed_id}")
async def get_feed(
    feed_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> FeedResponse:
    """Get a single RSS feed by ID."""
    result = await db.execute(select(RSSFeed).where(RSSFeed.id == feed_id))
    feed = result.scalar_one_or_none()

    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")

    return FeedResponse(
        id=feed.id,
        name=feed.name,
        url=feed.url,
        category=feed.category,
        language=feed.language,
        is_active=feed.is_active or False,
        last_fetched_at=feed.last_fetched_at.isoformat() if feed.last_fetched_at else None,
        fetch_interval_minutes=feed.fetch_interval_minutes,
        error_count=feed.error_count or 0,
        last_error=feed.last_error,
        created_at=feed.created_at.isoformat() if feed.created_at else None,
    )


@router.post("/rss")
async def create_feed(
    body: FeedCreate,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> FeedResponse:
    """Create a new RSS feed."""
    # Check for duplicate URL
    existing = await db.execute(select(RSSFeed).where(RSSFeed.url == body.url))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Feed with this URL already exists")

    feed = RSSFeed(
        name=body.name,
        url=body.url,
        category=body.category,
        language=body.language,
        is_active=body.is_active,
    )
    db.add(feed)
    await db.commit()
    await db.refresh(feed)

    return FeedResponse(
        id=feed.id,
        name=feed.name,
        url=feed.url,
        category=feed.category,
        language=feed.language,
        is_active=feed.is_active or False,
        last_fetched_at=None,
        fetch_interval_minutes=feed.fetch_interval_minutes,
        error_count=0,
        last_error=None,
        created_at=feed.created_at.isoformat() if feed.created_at else None,
    )


@router.put("/rss/{feed_id}")
async def update_feed(
    feed_id: int,
    body: FeedUpdate,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> FeedResponse:
    """Update an RSS feed."""
    result = await db.execute(select(RSSFeed).where(RSSFeed.id == feed_id))
    feed = result.scalar_one_or_none()

    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")

    # Update fields
    if body.name is not None:
        feed.name = body.name
    if body.url is not None:
        feed.url = body.url
    if body.category is not None:
        feed.category = body.category
    if body.language is not None:
        feed.language = body.language
    if body.is_active is not None:
        feed.is_active = body.is_active

    await db.commit()
    await db.refresh(feed)

    return FeedResponse(
        id=feed.id,
        name=feed.name,
        url=feed.url,
        category=feed.category,
        language=feed.language,
        is_active=feed.is_active or False,
        last_fetched_at=feed.last_fetched_at.isoformat() if feed.last_fetched_at else None,
        fetch_interval_minutes=feed.fetch_interval_minutes,
        error_count=feed.error_count or 0,
        last_error=feed.last_error,
        created_at=feed.created_at.isoformat() if feed.created_at else None,
    )


@router.delete("/rss/{feed_id}")
async def delete_feed(
    feed_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """Delete an RSS feed."""
    result = await db.execute(select(RSSFeed).where(RSSFeed.id == feed_id))
    feed = result.scalar_one_or_none()

    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")

    await db.delete(feed)
    await db.commit()

    return {"message": "Feed deleted", "id": feed_id}


class FeedTestResult(BaseModel):
    """Result of testing an RSS feed URL."""
    success: bool
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    item_count: int = 0
    sample_items: List[Dict[str, Any]] = []
    error: Optional[str] = None


@router.post("/rss/test")
async def test_feed(
    admin: AdminUser,
    url: str = Query(..., description="RSS feed URL to test"),
) -> FeedTestResult:
    """Test an RSS feed URL without saving it."""
    import httpx
    import xml.etree.ElementTree as ET

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url, follow_redirects=True)
            response.raise_for_status()
            content = response.text

        # Parse RSS/Atom feed
        root = ET.fromstring(content)

        # Handle different feed formats
        title = None
        description = None
        items = []

        # RSS 2.0
        channel = root.find("channel")
        if channel is not None:
            title = channel.findtext("title")
            description = channel.findtext("description")
            for item in channel.findall("item")[:5]:
                items.append({
                    "title": item.findtext("title") or "[No title]",
                    "link": item.findtext("link") or "",
                    "published": item.findtext("pubDate") or "",
                    "summary": (item.findtext("description") or "")[:200],
                })
        # Atom
        else:
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            title_el = root.find("atom:title", ns) or root.find("title")
            title = title_el.text if title_el is not None else None
            subtitle = root.find("atom:subtitle", ns) or root.find("subtitle")
            description = subtitle.text if subtitle is not None else None

            for entry in (root.findall("atom:entry", ns) or root.findall("entry"))[:5]:
                entry_title = entry.find("atom:title", ns) or entry.find("title")
                entry_link = entry.find("atom:link", ns) or entry.find("link")
                entry_published = entry.find("atom:published", ns) or entry.find("published") or entry.find("atom:updated", ns) or entry.find("updated")
                entry_summary = entry.find("atom:summary", ns) or entry.find("summary") or entry.find("atom:content", ns) or entry.find("content")

                link_href = entry_link.get("href") if entry_link is not None else ""

                items.append({
                    "title": entry_title.text if entry_title is not None else "[No title]",
                    "link": link_href,
                    "published": entry_published.text if entry_published is not None else "",
                    "summary": (entry_summary.text or "")[:200] if entry_summary is not None else "",
                })

        return FeedTestResult(
            success=True,
            url=url,
            title=title,
            description=description,
            item_count=len(items),
            sample_items=items,
        )

    except httpx.HTTPStatusError as e:
        return FeedTestResult(
            success=False,
            url=url,
            error=f"HTTP {e.response.status_code}: {e.response.reason_phrase}",
        )
    except ET.ParseError as e:
        return FeedTestResult(
            success=False,
            url=url,
            error=f"Invalid XML: {str(e)}",
        )
    except Exception as e:
        return FeedTestResult(
            success=False,
            url=url,
            error=str(e),
        )
