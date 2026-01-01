"""
Admin RSS Feeds Management Router

Provides CRUD endpoints for RSS feed source management:
- List, create, update, delete RSS feeds
- Feed testing (validate URL)
- Feed statistics
- Batch operations
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select, update, delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from models.rss_feed import RSSFeed
from models.external_news import ExternalNews

from ...database import get_db
from ...dependencies import AdminUser
from ...utils.sql_safety import escape_ilike_pattern


router = APIRouter(prefix="/api/admin/feeds", tags=["Admin - Feeds"])


# =============================================================================
# SCHEMAS
# =============================================================================


class FeedCreate(BaseModel):
    """Schema for creating a new RSS feed."""
    name: str = Field(..., min_length=1, max_length=255)
    url: str = Field(..., description="RSS feed URL")
    website_url: Optional[str] = Field(None, description="Source website URL")
    category: str = Field(..., description="Category: ukraine, russia, neutral, international")
    trust_level: int = Field(..., ge=1, le=5, description="Trust level 1-5")
    language: Optional[str] = Field("en", max_length=10)
    country: Optional[str] = Field(None, max_length=10)
    description: Optional[str] = None
    active: bool = Field(True)


class FeedUpdate(BaseModel):
    """Schema for updating an RSS feed."""
    name: Optional[str] = Field(None, max_length=255)
    url: Optional[str] = None
    website_url: Optional[str] = None
    category: Optional[str] = None
    trust_level: Optional[int] = Field(None, ge=1, le=5)
    language: Optional[str] = Field(None, max_length=10)
    country: Optional[str] = Field(None, max_length=10)
    description: Optional[str] = None
    active: Optional[bool] = None


class FeedResponse(BaseModel):
    """Schema for RSS feed response."""
    id: int
    name: str
    url: str
    website_url: Optional[str]
    category: str
    trust_level: int
    language: Optional[str]
    country: Optional[str]
    description: Optional[str]
    active: bool
    last_polled_at: Optional[str]
    last_successful_poll_at: Optional[str]
    poll_failures_count: int
    articles_fetched_total: int
    created_at: Optional[str]
    updated_at: Optional[str]


class FeedStats(BaseModel):
    """RSS feed statistics."""
    total_feeds: int
    active_feeds: int
    inactive_feeds: int
    by_category: Dict[str, int]
    by_trust_level: Dict[str, int]
    total_articles: int
    articles_last_24h: int
    failing_feeds: int


class FeedTestResult(BaseModel):
    """Result of feed URL test."""
    success: bool
    url: str
    title: Optional[str]
    description: Optional[str]
    item_count: int
    sample_items: List[Dict[str, Any]]
    error: Optional[str]


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
    trust_level: Optional[int] = Query(None, ge=1, le=5),
    active: Optional[bool] = Query(None),
    sort_by: str = Query("name", description="Sort by: name, category, trust_level, articles_fetched_total, last_polled_at"),
    sort_order: str = Query("asc", description="Sort order: asc, desc"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    List RSS feeds with pagination and filters.

    Returns paginated list of RSS feeds with support for search, filtering,
    and sorting. Includes feed metadata, polling status, and article counts.

    Filters:
    - search: Search in feed name, URL, or description
    - category: Filter by category (ukraine, russia, neutral, international)
    - trust_level: Filter by trust level (1-5)
    - active: Show only active or inactive feeds
    - sort_by: Sort by name, category, trust_level, articles_fetched_total, or last_polled_at
    - sort_order: asc or desc

    Args:
        admin: Admin user (from dependency injection)
        page: Page number (default: 1)
        page_size: Items per page (10-100, default: 25)
        search: Search term for name, URL, or description
        category: Filter by category
        trust_level: Filter by trust level (1-5)
        active: Filter by active status
        sort_by: Column to sort by
        sort_order: Sort direction (asc or desc)
        db: Database session

    Returns:
        Dict containing:
        - items: List of feed objects with full metadata
        - total: Total number of matching feeds
        - page: Current page number
        - page_size: Items per page
        - total_pages: Total number of pages

    Raises:
        Returns error dict on exception (graceful degradation)
    """
    try:
        # Build query
        query = select(RSSFeed)

        # Apply filters
        if search:
            # SECURITY: Escape ILIKE wildcards to prevent pattern injection
            search_escaped = escape_ilike_pattern(search)
            query = query.where(
                RSSFeed.name.ilike(f"%{search_escaped}%") |
                RSSFeed.url.ilike(f"%{search_escaped}%") |
                RSSFeed.description.ilike(f"%{search_escaped}%")
            )
        if category:
            query = query.where(RSSFeed.category == category)
        if trust_level is not None:
            query = query.where(RSSFeed.trust_level == trust_level)
        if active is not None:
            query = query.where(RSSFeed.active == active)

        # Get total count
        count_query = select(func.count(RSSFeed.id))
        if search:
            # Use same escaped search from above
            count_query = count_query.where(
                RSSFeed.name.ilike(f"%{search_escaped}%") |
                RSSFeed.url.ilike(f"%{search_escaped}%") |
                RSSFeed.description.ilike(f"%{search_escaped}%")
            )
        if category:
            count_query = count_query.where(RSSFeed.category == category)
        if trust_level is not None:
            count_query = count_query.where(RSSFeed.trust_level == trust_level)
        if active is not None:
            count_query = count_query.where(RSSFeed.active == active)

        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        # Apply sorting
        sort_column = getattr(RSSFeed, sort_by, RSSFeed.name)
        if sort_order == "desc":
            query = query.order_by(desc(sort_column))
        else:
            query = query.order_by(sort_column)

        # Apply pagination
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        result = await db.execute(query)
        feeds = result.scalars().all()

        items = []
        for feed in feeds:
            items.append({
                "id": feed.id,
                "name": feed.name,
                "url": feed.url,
                "website_url": feed.website_url,
                "category": feed.category,
                "trust_level": feed.trust_level,
                "language": feed.language,
                "country": feed.country,
                "description": feed.description,
                "active": feed.active,
                "last_polled_at": feed.last_polled_at.isoformat() if feed.last_polled_at else None,
                "last_successful_poll_at": feed.last_successful_poll_at.isoformat() if feed.last_successful_poll_at else None,
                "poll_failures_count": feed.poll_failures_count or 0,
                "articles_fetched_total": feed.articles_fetched_total or 0,
                "created_at": feed.created_at.isoformat() if feed.created_at else None,
                "updated_at": feed.updated_at.isoformat() if feed.updated_at else None,
            })

        total_pages = (total + page_size - 1) // page_size

        return {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }

    except Exception as e:
        return {"error": str(e), "items": [], "total": 0, "page": page, "page_size": page_size, "total_pages": 0}


@router.get("/rss/stats")
async def get_feed_stats(admin: AdminUser, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Get RSS feed statistics for dashboard.

    Provides aggregated statistics about RSS feeds and articles including:
    - Feed counts (total, active, inactive, failing)
    - Distribution by category and trust level
    - Article counts (total, last 24 hours)

    Args:
        admin: Admin user (from dependency injection)
        db: Database session

    Returns:
        Dict containing:
        - total_feeds: Total number of feeds
        - active_feeds: Number of active feeds
        - inactive_feeds: Number of inactive feeds
        - failing_feeds: Number of feeds with >3 consecutive failures
        - by_category: Dict mapping category names to counts
        - by_trust_level: Dict mapping trust levels to counts
        - total_articles: Total articles across all feeds
        - articles_last_24h: Articles published in last 24 hours

    Raises:
        Returns error dict on exception (graceful degradation)
    """
    try:
        # Get feed counts
        feeds_result = await db.execute(select(RSSFeed))
        feeds = feeds_result.scalars().all()

        total_feeds = len(feeds)
        active_feeds = sum(1 for f in feeds if f.active)
        inactive_feeds = total_feeds - active_feeds
        failing_feeds = sum(1 for f in feeds if (f.poll_failures_count or 0) > 3)

        by_category = {}
        by_trust_level = {}

        for feed in feeds:
            cat = feed.category or "unknown"
            by_category[cat] = by_category.get(cat, 0) + 1

            trust = str(feed.trust_level)
            by_trust_level[trust] = by_trust_level.get(trust, 0) + 1

        # Get article counts
        articles_result = await db.execute(select(func.count(ExternalNews.id)))
        total_articles = articles_result.scalar() or 0

        # Use text() for interval syntax
        articles_24h_result = await db.execute(
            select(func.count(ExternalNews.id))
            .where(ExternalNews.published_at >= text("NOW() - INTERVAL '24 hours'"))
        )
        articles_last_24h = articles_24h_result.scalar() or 0

        return {
            "total_feeds": total_feeds,
            "active_feeds": active_feeds,
            "inactive_feeds": inactive_feeds,
            "failing_feeds": failing_feeds,
            "by_category": by_category,
            "by_trust_level": by_trust_level,
            "total_articles": total_articles,
            "articles_last_24h": articles_last_24h,
        }

    except Exception as e:
        return {"error": str(e)}


@router.get("/rss/categories")
async def get_feed_categories(admin: AdminUser, db: AsyncSession = Depends(get_db)) -> List[Dict[str, Any]]:
    """
    Get list of feed categories with counts.

    Returns all unique feed categories with the number of feeds in each category.
    Useful for populating category filters in the UI.

    Args:
        admin: Admin user (from dependency injection)
        db: Database session

    Returns:
        List of dicts, each containing:
        - category: Category name (ukraine, russia, neutral, international)
        - count: Number of feeds in this category

    Raises:
        Returns empty list on exception (graceful degradation)
    """
    try:
        result = await db.execute(
            select(RSSFeed.category, func.count(RSSFeed.id))
            .group_by(RSSFeed.category)
            .order_by(RSSFeed.category)
        )
        rows = result.all()

        return [{"category": row[0], "count": row[1]} for row in rows]

    except Exception as e:
        return []


# =============================================================================
# CRUD OPERATIONS
# =============================================================================


@router.get("/rss/{feed_id}")
async def get_feed(feed_id: int, admin: AdminUser, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Get a single RSS feed by ID.

    Returns detailed information about a specific RSS feed including full metadata,
    polling status, and the 10 most recent articles from this feed.

    Args:
        feed_id: RSS feed database ID
        admin: Admin user (from dependency injection)
        db: Database session

    Returns:
        Dict containing:
        - id: Feed database ID
        - name: Feed name
        - url: RSS feed URL
        - website_url: Source website URL
        - category: Feed category
        - trust_level: Trust level (1-5)
        - language: Feed language code
        - country: Country code
        - description: Feed description
        - active: Active status
        - last_polled_at: Last poll attempt timestamp
        - last_successful_poll_at: Last successful poll timestamp
        - poll_failures_count: Consecutive poll failures
        - articles_fetched_total: Total articles fetched
        - created_at: Feed creation timestamp
        - updated_at: Last update timestamp
        - recent_articles: List of 10 most recent articles

    Raises:
        Returns error dict if feed not found or on exception
    """
    try:
        result = await db.execute(select(RSSFeed).where(RSSFeed.id == feed_id))
        feed = result.scalar_one_or_none()

        if not feed:
            return {"error": f"Feed {feed_id} not found"}

        # Get recent articles
        articles_result = await db.execute(
            select(ExternalNews)
            .where(ExternalNews.feed_id == feed_id)
            .order_by(desc(ExternalNews.published_at))
            .limit(10)
        )
        articles = articles_result.scalars().all()

        return {
            "id": feed.id,
            "name": feed.name,
            "url": feed.url,
            "website_url": feed.website_url,
            "category": feed.category,
            "trust_level": feed.trust_level,
            "language": feed.language,
            "country": feed.country,
            "description": feed.description,
            "active": feed.active,
            "last_polled_at": feed.last_polled_at.isoformat() if feed.last_polled_at else None,
            "last_successful_poll_at": feed.last_successful_poll_at.isoformat() if feed.last_successful_poll_at else None,
            "poll_failures_count": feed.poll_failures_count or 0,
            "articles_fetched_total": feed.articles_fetched_total or 0,
            "created_at": feed.created_at.isoformat() if feed.created_at else None,
            "updated_at": feed.updated_at.isoformat() if feed.updated_at else None,
            "recent_articles": [
                {
                    "id": a.id,
                    "title": a.title,
                    "url": a.url,
                    "published_at": a.published_at.isoformat() if a.published_at else None,
                }
                for a in articles
            ],
        }

    except Exception as e:
        return {"error": str(e)}


@router.post("/rss")
async def create_feed(feed: FeedCreate, admin: AdminUser, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Create a new RSS feed.

    Adds a new RSS feed to the system for monitoring and article ingestion.
    The rss-ingestor service will automatically poll this feed based on
    the configured polling interval.

    Validates that the feed URL is unique before creation.

    Args:
        feed: FeedCreate schema with required fields:
            - name: Feed display name (1-255 chars)
            - url: RSS feed URL (must be unique)
            - website_url: Source website URL (optional)
            - category: Category (ukraine, russia, neutral, international)
            - trust_level: Trust level 1-5
            - language: Language code (default: "en")
            - country: Country code (optional)
            - description: Feed description (optional)
            - active: Active status (default: True)
        admin: Admin user (from dependency injection)
        db: Database session

    Returns:
        Dict containing:
        - success: True if created
        - id: New feed database ID
        - message: Success message

    Raises:
        Returns error dict if URL already exists or on database error
    """
    try:
        # Check for duplicate URL
        existing = await db.execute(select(RSSFeed).where(RSSFeed.url == feed.url))
        if existing.scalar_one_or_none():
            return {"error": "Feed with this URL already exists"}

        new_feed = RSSFeed(
            name=feed.name,
            url=feed.url,
            website_url=feed.website_url,
            category=feed.category,
            trust_level=feed.trust_level,
            language=feed.language,
            country=feed.country,
            description=feed.description,
            active=feed.active,
            poll_failures_count=0,
            articles_fetched_total=0,
        )

        db.add(new_feed)
        await db.commit()
        await db.refresh(new_feed)

        return {
            "success": True,
            "id": new_feed.id,
            "message": f"Feed '{feed.name}' created successfully",
        }

    except Exception as e:
        await db.rollback()
        return {"error": str(e)}


@router.put("/rss/{feed_id}")
async def update_feed(feed_id: int, feed: FeedUpdate, admin: AdminUser, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Update an RSS feed.

    Updates one or more fields of an existing RSS feed. All fields in the
    FeedUpdate schema are optional - only provided fields will be updated.

    Validates URL uniqueness if URL is being changed.

    Args:
        feed_id: RSS feed database ID
        feed: FeedUpdate schema with optional fields:
            - name: Feed display name
            - url: RSS feed URL (validated for uniqueness)
            - website_url: Source website URL
            - category: Category
            - trust_level: Trust level 1-5
            - language: Language code
            - country: Country code
            - description: Feed description
            - active: Active status
        admin: Admin user (from dependency injection)
        db: Database session

    Returns:
        Dict containing:
        - success: True if updated
        - id: Feed database ID
        - message: Success message

    Raises:
        Returns error dict if feed not found, URL conflict, or database error
    """
    try:
        # Check feed exists
        result = await db.execute(select(RSSFeed).where(RSSFeed.id == feed_id))
        existing = result.scalar_one_or_none()

        if not existing:
            return {"error": f"Feed {feed_id} not found"}

        # Build update dict
        update_data = {}
        if feed.name is not None:
            update_data["name"] = feed.name
        if feed.url is not None:
            # Check URL not already used by another feed
            url_check = await db.execute(
                select(RSSFeed).where(RSSFeed.url == feed.url, RSSFeed.id != feed_id)
            )
            if url_check.scalar_one_or_none():
                return {"error": "Another feed with this URL already exists"}
            update_data["url"] = feed.url
        if feed.website_url is not None:
            update_data["website_url"] = feed.website_url
        if feed.category is not None:
            update_data["category"] = feed.category
        if feed.trust_level is not None:
            update_data["trust_level"] = feed.trust_level
        if feed.language is not None:
            update_data["language"] = feed.language
        if feed.country is not None:
            update_data["country"] = feed.country
        if feed.description is not None:
            update_data["description"] = feed.description
        if feed.active is not None:
            update_data["active"] = feed.active

        if update_data:
            update_data["updated_at"] = datetime.utcnow()
            await db.execute(
                update(RSSFeed).where(RSSFeed.id == feed_id).values(**update_data)
            )
            await db.commit()

        return {
            "success": True,
            "id": feed_id,
            "message": "Feed updated successfully",
        }

    except Exception as e:
        await db.rollback()
        return {"error": str(e)}


@router.delete("/rss/{feed_id}")
async def delete_feed(feed_id: int, admin: AdminUser, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Delete an RSS feed.

    Permanently removes an RSS feed from the system. Due to CASCADE constraints,
    this will also delete all articles (external_news records) associated with
    this feed. Use with caution.

    Args:
        feed_id: RSS feed database ID
        admin: Admin user (from dependency injection)
        db: Database session

    Returns:
        Dict containing:
        - success: True if deleted
        - id: Deleted feed ID
        - message: Success message with feed name

    Raises:
        Returns error dict if feed not found or database error
    """
    try:
        # Check feed exists
        result = await db.execute(select(RSSFeed).where(RSSFeed.id == feed_id))
        existing = result.scalar_one_or_none()

        if not existing:
            return {"error": f"Feed {feed_id} not found"}

        feed_name = existing.name

        # Delete feed (cascade deletes articles)
        await db.execute(delete(RSSFeed).where(RSSFeed.id == feed_id))
        await db.commit()

        return {
            "success": True,
            "id": feed_id,
            "message": f"Feed '{feed_name}' deleted successfully",
        }

    except Exception as e:
        await db.rollback()
        return {"error": str(e)}


# =============================================================================
# FEED TESTING
# =============================================================================


@router.post("/rss/test")
async def test_feed_url(admin: AdminUser, url: str = Query(..., description="RSS feed URL to test")) -> FeedTestResult:
    """
    Test an RSS feed URL and return sample content.

    Validates that a URL can be successfully fetched and parsed as an RSS or
    Atom feed. Returns feed metadata and sample items for preview before
    adding the feed to the system.

    This endpoint is useful for validating feed URLs before creating a new
    RSS feed record.

    Args:
        admin: Admin user (from dependency injection)
        url: RSS feed URL to test
        db: Database session (implicit from Depends)

    Returns:
        FeedTestResult containing:
        - success: True if feed was successfully parsed
        - url: The tested URL
        - title: Feed title (if successful)
        - description: Feed description (if successful)
        - item_count: Total number of items in feed
        - sample_items: List of up to 5 sample items with title, link, published date, and summary
        - error: Error message (if failed)

    Raises:
        Returns FeedTestResult with success=False on network errors or parse failures
    """
    try:
        import feedparser

        # Fetch feed with timeout
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(url, follow_redirects=True)
            response.raise_for_status()
            content = response.text

        # Parse feed
        feed = feedparser.parse(content)

        if feed.bozo and feed.bozo_exception:
            return FeedTestResult(
                success=False,
                url=url,
                title=None,
                description=None,
                item_count=0,
                sample_items=[],
                error=f"Parse error: {str(feed.bozo_exception)}",
            )

        # Extract feed info
        title = feed.feed.get("title", "Unknown")
        description = feed.feed.get("description", feed.feed.get("subtitle", ""))

        # Get sample items
        sample_items = []
        for entry in feed.entries[:5]:
            sample_items.append({
                "title": entry.get("title", "No title"),
                "link": entry.get("link", ""),
                "published": entry.get("published", entry.get("updated", "")),
                "summary": (entry.get("summary", "")[:200] + "...")
                if len(entry.get("summary", "")) > 200 else entry.get("summary", ""),
            })

        return FeedTestResult(
            success=True,
            url=url,
            title=title,
            description=description,
            item_count=len(feed.entries),
            sample_items=sample_items,
            error=None,
        )

    except httpx.RequestError as e:
        return FeedTestResult(
            success=False,
            url=url,
            title=None,
            description=None,
            item_count=0,
            sample_items=[],
            error=f"Network error: {str(e)}",
        )
    except Exception as e:
        return FeedTestResult(
            success=False,
            url=url,
            title=None,
            description=None,
            item_count=0,
            sample_items=[],
            error=str(e),
        )


@router.post("/rss/{feed_id}/poll")
async def trigger_feed_poll(feed_id: int, admin: AdminUser, db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Trigger immediate poll of a specific feed.

    Forces a feed to be prioritized for polling by the rss-ingestor service.
    Sets the feed's last_polled_at timestamp to a far past date (2000-01-01),
    which causes the ingestor to treat it as highest priority for the next
    polling cycle.

    This is an asynchronous operation - the actual polling happens in the
    rss-ingestor service, not in this API call. The feed will be polled
    within seconds to minutes depending on the ingestor's polling interval.

    Args:
        feed_id: RSS feed database ID
        admin: Admin user (from dependency injection)
        db: Database session

    Returns:
        Dict containing:
        - success: True if poll was queued
        - message: Status message indicating poll will happen shortly

    Raises:
        Returns error dict if feed not found or database error
    """
    try:
        # Check feed exists
        result = await db.execute(select(RSSFeed).where(RSSFeed.id == feed_id))
        feed = result.scalar_one_or_none()

        if not feed:
            return {"error": f"Feed {feed_id} not found"}

        # Update last_polled_at to far past to trigger priority
        await db.execute(
            update(RSSFeed)
            .where(RSSFeed.id == feed_id)
            .values(last_polled_at=datetime(2000, 1, 1))
        )
        await db.commit()

        return {
            "success": True,
            "message": f"Poll triggered for feed '{feed.name}'. Will be processed by rss-ingestor shortly.",
        }

    except Exception as e:
        await db.rollback()
        return {"error": str(e)}


# =============================================================================
# BATCH OPERATIONS
# =============================================================================


@router.post("/rss/batch/activate")
async def batch_activate_feeds(
    feed_ids: List[int],
    admin: AdminUser,
    active: bool = True,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Batch activate or deactivate multiple feeds.

    Updates the active status for multiple feeds in a single database transaction.
    Inactive feeds will not be polled by the rss-ingestor service.

    Useful for bulk management operations like pausing multiple failing feeds
    or reactivating feeds after maintenance.

    Args:
        feed_ids: List of RSS feed database IDs to update
        admin: Admin user (from dependency injection)
        active: True to activate feeds, False to deactivate (default: True)
        db: Database session

    Returns:
        Dict containing:
        - success: True if batch operation completed
        - message: Status message with count and action
        - feed_ids: List of updated feed IDs

    Raises:
        Returns error dict on database error
    """
    try:
        await db.execute(
            update(RSSFeed)
            .where(RSSFeed.id.in_(feed_ids))
            .values(active=active, updated_at=datetime.utcnow())
        )
        await db.commit()

        action = "activated" if active else "deactivated"
        return {
            "success": True,
            "message": f"{len(feed_ids)} feeds {action}",
            "feed_ids": feed_ids,
        }

    except Exception as e:
        await db.rollback()
        return {"error": str(e)}
