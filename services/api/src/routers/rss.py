"""
Feed Router - RSS, Atom, and JSON Feed

Dynamic feed generation from search queries.
Enables "subscribe to any search" functionality in three formats.

Features:
- Dynamic search-based feeds
- Channel-specific feeds
- Topic-based feeds
- Three output formats: RSS 2.0, Atom 1.0, JSON Feed 1.1
- Redis caching (5-15 min TTL)
- Feed autodiscovery

Specifications:
- RSS 2.0: https://cyber.harvard.edu/rss/rss.html
- Atom 1.0: RFC 4287
- JSON Feed 1.1: https://jsonfeed.org/version/1.1/
"""

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.channel import Channel
from models.message import Message
from models.media import MessageMedia

from ..auth.feed_auth import FeedAuthResult, verify_feed_token
from ..database import get_db
from ..feed_generator import FeedFormat, FeedGenerator, generate_feed_url
from ..services.feed_subscription_service import FeedSubscriptionService
from ..utils.sql_safety import escape_ilike_pattern

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/rss", tags=["feeds"])


@router.get("/search")
async def feed_search(
    request: Request,
    # Format parameter (new!)
    format: Optional[str] = Query(
        default="rss",
        description="Output format: rss (RSS 2.0), atom (Atom 1.0), or json (JSON Feed 1.1)",
        pattern="^(rss|atom|json)$",
    ),
    # Search parameters (same as /api/messages)
    q: Optional[str] = Query(None, description="Search query"),
    channel_id: Optional[int] = Query(None, description="Filter by channel ID"),
    channel_username: Optional[str] = Query(None, description="Filter by channel username"),
    channel_folder: Optional[str] = Query(None, max_length=64, description="Filter by channel folder pattern"),
    topic: Optional[str] = Query(None, description="Filter by topic"),
    has_media: Optional[bool] = Query(None, description="Filter messages with media"),
    media_type: Optional[str] = Query(None, description="Filter by specific media type"),
    language: Optional[str] = Query(None, description="Filter by language"),
    days: Optional[int] = Query(None, ge=1, le=365, description="Last N days"),
    date_from: Optional[str] = Query(None, description="Start date (ISO format)"),
    date_to: Optional[str] = Query(None, description="End date (ISO format)"),
    min_views: Optional[int] = Query(None, ge=0, description="Minimum view count"),
    min_forwards: Optional[int] = Query(None, ge=0, description="Minimum forward count"),
    # Feed-specific parameters
    limit: int = Query(default=50, ge=1, le=100, description="Max items in feed"),
    # Database
    db: AsyncSession = Depends(get_db),
    feed_auth: FeedAuthResult = Depends(verify_feed_token),
) -> Response:
    """
    Generate dynamic feed from search query.

    Core "subscribe to any search" functionality. Converts message search queries
    into RSS, Atom, or JSON feeds for consumption in feed readers. Supports the
    same comprehensive filter set as the /api/messages endpoint, enabling users
    to create highly specific feed subscriptions.

    The feed title and description are dynamically generated based on applied filters,
    and feed URLs include all parameters for proper autodiscovery.

    Args:
        request: FastAPI request object (for base URL construction)
        format: Output format - "rss" (RSS 2.0), "atom" (Atom 1.0), or "json" (JSON Feed 1.1)
        q: Full-text search query (searches content and translated content)
        channel_id: Filter by specific channel database ID
        channel_username: Filter by channel username (without @ prefix)
        channel_folder: Filter by Telegram folder name pattern (ILIKE match)
        topic: Filter by topic classification
        has_media: If True, only messages with media; if False, only text-only messages
        media_type: Filter by specific media type (photo, video, document, etc.)
        language: Filter by detected language code
        days: Show messages from last N days (1-365)
        date_from: Start date for date range filter (ISO format)
        date_to: End date for date range filter (ISO format)
        min_views: Minimum Telegram view count
        min_forwards: Minimum forward count
        limit: Maximum number of items in feed (1-100, default 50)
        db: Database session
        feed_auth: Feed authentication result (supports both token and anonymous access)

    Returns:
        Response with feed content in requested format and appropriate content-type header.
        RSS/Atom feeds use application/rss+xml or application/atom+xml.
        JSON feeds use application/feed+json.

    Examples:
        /rss/search?q=keyword&format=json
        /rss/search?channel_username=channel_name&days=7&format=atom
        /rss/search?topic=general&has_media=true&limit=100
    """
    # Parse format
    feed_format = FeedFormat(format.lower() if format else "rss")

    # Build feed title and description
    title_parts = ["Telegram Archive"]
    desc_parts = []

    if q:
        title_parts.append(f'Search: "{q}"')
        desc_parts.append(f'Keyword: "{q}"')

    if channel_username:
        title_parts.append(f"Channel: @{channel_username}")
        desc_parts.append(f"Channel: @{channel_username}")

    if channel_folder:
        folder_name = channel_folder.replace('%', '')
        title_parts.append(f"Folder: {folder_name}")
        desc_parts.append(f"Folder pattern: {folder_name}")

    if topic:
        title_parts.append(f"Topic: {topic}")
        desc_parts.append(f"Topic: {topic}")

    if has_media:
        title_parts.append("with Media")
        desc_parts.append("Messages with media only")

    if days:
        title_parts.append(f"Last {days} days")
        desc_parts.append(f"From last {days} days")

    title = " | ".join(title_parts)
    description = " - ".join(desc_parts) if desc_parts else "Dynamic feed from search query"

    # Build query with eager loading for media (including nested media_file)
    query_stmt = select(Message).options(
        selectinload(Message.media).selectinload(MessageMedia.media_file),
        selectinload(Message.channel),
    )

    # Apply filters (same logic as messages router)
    filters = []

    # Full-text search
    if q:
        # SECURITY: Escape ILIKE wildcards to prevent pattern injection
        q_escaped = escape_ilike_pattern(q)
        filters.append(
            or_(
                Message.content.ilike(f"%{q_escaped}%"),
                Message.content_translated.ilike(f"%{q_escaped}%") if Message.content_translated else False,
            )
        )

    # Channel filters
    if channel_id:
        filters.append(Message.channel_id == channel_id)

    if channel_username:
        query_stmt = query_stmt.join(Channel, Message.channel_id == Channel.id)
        filters.append(Channel.username == channel_username)

    if channel_folder:
        if not channel_username:  # Avoid double join
            query_stmt = query_stmt.join(Channel, Message.channel_id == Channel.id)
        # NOTE: % and _ wildcards are intentional for folder pattern matching
        # (e.g., "Archive%" matches "Archive-Russia", "Archive-Ukraine")
        # Escape backslashes to prevent ILIKE escape sequence injection
        folder_pattern = channel_folder.replace("\\", "\\\\")
        filters.append(Channel.folder.ilike(f"%{folder_pattern}%"))

    # Topic filter
    if topic:
        filters.append(Message.topic == topic)

    # Media filter
    if has_media is not None:
        if has_media:
            filters.append(Message.media_type.isnot(None))
        else:
            filters.append(Message.media_type.is_(None))

    if media_type:
        filters.append(Message.media_type == media_type)

    # Language filter
    if language:
        filters.append(Message.language_detected == language)

    # Engagement filters
    if min_views:
        filters.append(Message.views >= min_views)

    if min_forwards:
        filters.append(Message.forwards >= min_forwards)

    # Always exclude hidden messages in feeds
    filters.append(or_(Message.is_hidden == False, Message.is_hidden.is_(None)))

    # Date filters
    if days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        filters.append(Message.telegram_date >= cutoff)
    else:
        if date_from:
            try:
                from_dt = datetime.fromisoformat(date_from)
                filters.append(Message.telegram_date >= from_dt)
            except ValueError:
                pass

        if date_to:
            try:
                to_dt = datetime.fromisoformat(date_to)
                filters.append(Message.telegram_date <= to_dt)
            except ValueError:
                pass

    # Apply all filters
    if filters:
        query_stmt = query_stmt.where(and_(*filters))

    # Order by most recent first (NULLS LAST for proper chronological order)
    query_stmt = query_stmt.order_by(desc(Message.telegram_date).nulls_last()).limit(limit)

    # Execute query
    result = await db.execute(query_stmt)
    messages = result.scalars().unique().all()

    # Log authenticated vs anonymous access
    if feed_auth.authenticated:
        logger.debug(f"Authenticated feed access: user={feed_auth.user_id}, token={feed_auth.token.token_prefix}")

    # Generate feed URL for autodiscovery
    base_url = str(request.base_url).rstrip("/")
    feed_url = generate_feed_url(
        base_url,
        "/rss/search",
        {
            "format": format,
            "q": q,
            "channel_id": channel_id,
            "channel_username": channel_username,
            "channel_folder": channel_folder,
            "topic": topic,
            "language": language,
            "has_media": has_media,
            "media_type": media_type,
            "days": days,
            "date_from": date_from,
            "date_to": date_to,
            "min_views": min_views,
            "min_forwards": min_forwards,
            "limit": limit,
        },
    )

    # Generate feed
    generator = FeedGenerator(base_url)
    feed_content = generator.generate(
        messages=list(messages),
        title=title,
        description=description,
        feed_url=feed_url,
        format=feed_format,
    )

    # Record subscription for authenticated access
    if feed_auth.authenticated and feed_auth.token:
        try:
            sub_service = FeedSubscriptionService(db)
            await sub_service.upsert_subscription(
                token_id=feed_auth.token.id,
                feed_type="search",
                params={
                    "format": format,
                    "q": q,
                    "channel_id": channel_id,
                    "channel_username": channel_username,
                    "channel_folder": channel_folder,
                    "topic": topic,
                    "has_media": has_media,
                    "media_type": media_type,
                    "language": language,
                    "days": days,
                    "date_from": date_from,
                    "date_to": date_to,
                    "min_views": min_views,
                    "min_forwards": min_forwards,
                    "limit": limit,
                },
            )
        except Exception as e:
            # Don't fail the feed request for subscription tracking errors
            logger.warning(f"Failed to record subscription: {e}")

    # Return response with proper content type
    content_type = generator.get_content_type(feed_format)
    return Response(content=feed_content, media_type=content_type)


@router.get("/channel/{username}")
async def feed_channel(
    request: Request,
    username: str,
    format: Optional[str] = Query(
        default="rss",
        description="Output format: rss, atom, or json",
        pattern="^(rss|atom|json)$",
    ),
    days: Optional[int] = Query(default=30, ge=1, le=365, description="Last N days"),
    limit: int = Query(default=50, ge=1, le=100, description="Max items in feed"),
    db: AsyncSession = Depends(get_db),
    feed_auth: FeedAuthResult = Depends(verify_feed_token),
) -> Response:
    """
    Generate feed for a specific channel.

    Static channel-specific feed endpoint providing a simple way to subscribe to
    all messages from a single Telegram channel. The feed title uses the channel's
    display name and username, while the description comes from the channel's
    Telegram bio.

    This endpoint maintains compatibility with production systems that rely on
    channel-specific feed URLs.

    Args:
        request: FastAPI request object (for base URL construction)
        username: Channel username (without @ prefix)
        format: Output format - "rss" (RSS 2.0), "atom" (Atom 1.0), or "json" (JSON Feed 1.1)
        days: Show messages from last N days (default 30, range 1-365)
        limit: Maximum number of items in feed (1-100, default 50)
        db: Database session
        feed_auth: Feed authentication result (supports both token and anonymous access)

    Returns:
        Response with feed content in requested format. Returns 404 error with
        appropriate format (XML or JSON) if channel is not found in database.

    Raises:
        404: Channel with specified username not found (returned as formatted error)

    Examples:
        /rss/channel/channel_name
        /rss/channel/channel_name?format=json
        /rss/channel/my_channel?format=atom
    """
    feed_format = FeedFormat(format.lower() if format else "rss")

    # Verify channel exists
    channel_result = await db.execute(select(Channel).where(Channel.username == username))
    channel = channel_result.scalar_one_or_none()

    if not channel:
        error_content = f'<?xml version="1.0"?><error>Channel @{username} not found</error>'
        if feed_format == FeedFormat.JSON:
            error_content = f'{{"error": "Channel @{username} not found"}}'
        return Response(
            content=error_content,
            media_type="application/xml" if feed_format != FeedFormat.JSON else "application/json",
            status_code=404,
        )

    # Build query with eager loading (including nested media_file)
    query_stmt = select(Message).options(
        selectinload(Message.media).selectinload(MessageMedia.media_file),
        selectinload(Message.channel),
    ).where(Message.channel_id == channel.id)

    # Apply filters
    filters = [
        or_(Message.is_hidden == False, Message.is_hidden.is_(None))  # Exclude hidden messages
    ]

    if days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        filters.append(Message.telegram_date >= cutoff)

    query_stmt = query_stmt.where(and_(*filters))
    query_stmt = query_stmt.order_by(desc(Message.telegram_date).nulls_last()).limit(limit)

    # Execute query
    result = await db.execute(query_stmt)
    messages = result.scalars().unique().all()

    # Generate feed
    base_url = str(request.base_url).rstrip("/")
    feed_url = f"{base_url}/rss/channel/{username}?format={format}"

    title = f"@{username}"
    if channel.name:
        title = f"{channel.name} (@{username})"

    description = channel.description or f"Feed for Telegram channel @{username}"

    generator = FeedGenerator(base_url)
    feed_content = generator.generate(
        messages=list(messages),
        title=title,
        description=description,
        feed_url=feed_url,
        format=feed_format,
    )

    # Record subscription for authenticated access
    if feed_auth.authenticated and feed_auth.token:
        try:
            sub_service = FeedSubscriptionService(db)
            await sub_service.upsert_subscription(
                token_id=feed_auth.token.id,
                feed_type="channel",
                params={
                    "format": format,
                    "username": username,
                    "days": days,
                    "limit": limit,
                },
            )
        except Exception as e:
            logger.warning(f"Failed to record subscription: {e}")

    content_type = generator.get_content_type(feed_format)
    return Response(content=feed_content, media_type=content_type)


@router.get("/topic/{topic}")
async def feed_topic(
    request: Request,
    topic: str,
    format: Optional[str] = Query(
        default="rss",
        description="Output format: rss, atom, or json",
        pattern="^(rss|atom|json)$",
    ),
    days: Optional[int] = Query(default=7, ge=1, le=365, description="Last N days"),
    limit: int = Query(default=50, ge=1, le=100, description="Max items in feed"),
    db: AsyncSession = Depends(get_db),
    feed_auth: FeedAuthResult = Depends(verify_feed_token),
) -> Response:
    """
    Generate feed for a specific topic.

    Topic-based feed aggregating messages across all channels that have been
    classified into a specific category. Topics are assigned during message
    processing based on content analysis.

    Valid topics are validated against a hardcoded list. Invalid topics return
    a 400 error with the complete list of valid options.

    Args:
        request: FastAPI request object (for base URL construction)
        topic: Topic slug (must be one of the valid topics listed below)
        format: Output format - "rss" (RSS 2.0), "atom" (Atom 1.0), or "json" (JSON Feed 1.1)
        days: Show messages from last N days (default 7, range 1-365)
        limit: Maximum number of items in feed (1-100, default 50)
        db: Database session
        feed_auth: Feed authentication result (supports both token and anonymous access)

    Returns:
        Response with feed content in requested format. Returns 400 error with
        appropriate format (XML or JSON) if topic is invalid.

    Raises:
        400: Invalid topic provided (returned as formatted error with valid topic list)

    Valid Topics:
        news, announcement, discussion, media, important,
        archive, offtopic, other

    Examples:
        /rss/topic/news
        /rss/topic/news?format=json
        /rss/topic/discussion?format=atom
        /rss/topic/media?days=14
    """
    feed_format = FeedFormat(format.lower() if format else "rss")

    # Validate topic - generic categories for any Telegram archive
    valid_topics = [
        "news", "announcement", "discussion", "media", "important",
        "archive", "offtopic", "other"
    ]
    if topic not in valid_topics:
        error_msg = f"Invalid topic. Valid topics: {', '.join(valid_topics)}"
        if feed_format == FeedFormat.JSON:
            error_content = f'{{"error": "{error_msg}"}}'
        else:
            error_content = f'<?xml version="1.0"?><error>{error_msg}</error>'
        return Response(
            content=error_content,
            media_type="application/xml" if feed_format != FeedFormat.JSON else "application/json",
            status_code=400,
        )

    # Build query with eager loading
    filters = [
        or_(Message.is_hidden == False, Message.is_hidden.is_(None)),  # Exclude hidden messages
        Message.topic == topic,
    ]

    if days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        filters.append(Message.telegram_date >= cutoff)

    query_stmt = (
        select(Message)
        .options(
            selectinload(Message.media).selectinload(MessageMedia.media_file),
            selectinload(Message.channel),
        )
        .where(and_(*filters))
        .order_by(desc(Message.telegram_date).nulls_last())
        .limit(limit)
    )

    # Execute query
    result = await db.execute(query_stmt)
    messages = result.scalars().unique().all()

    # Generate feed
    base_url = str(request.base_url).rstrip("/")
    feed_url = f"{base_url}/rss/topic/{topic}?format={format}"

    title = f"Telegram Archive | Topic: {topic.title()}"
    description = f"Messages classified as '{topic}' from last {days} days"

    generator = FeedGenerator(base_url)
    feed_content = generator.generate(
        messages=list(messages),
        title=title,
        description=description,
        feed_url=feed_url,
        format=feed_format,
    )

    # Record subscription for authenticated access
    if feed_auth.authenticated and feed_auth.token:
        try:
            sub_service = FeedSubscriptionService(db)
            await sub_service.upsert_subscription(
                token_id=feed_auth.token.id,
                feed_type="topic",
                params={
                    "format": format,
                    "topic": topic,
                    "days": days,
                    "limit": limit,
                },
            )
        except Exception as e:
            logger.warning(f"Failed to record subscription: {e}")

    content_type = generator.get_content_type(feed_format)
    return Response(content=feed_content, media_type=content_type)


@router.get("/formats")
async def get_supported_formats() -> Dict[str, Any]:
    """
    Get information about supported feed formats.

    Returns metadata about all supported feed formats for UI integration and
    documentation. Provides format identifiers, display names, descriptions,
    content types, and specification URLs for RSS 2.0, Atom 1.0, and JSON Feed 1.1.

    This endpoint is primarily used by frontend applications to dynamically build
    format selection interfaces and provide format documentation to users.

    Returns:
        Dict containing:
        - formats: List of format metadata objects with id, name, description,
          content_type, icon, and spec_url fields
        - default: Default format identifier ("rss")

    Examples:
        GET /rss/formats
    """
    return {
        "formats": [
            {
                "id": "rss",
                "name": "RSS 2.0",
                "description": "Most compatible format, supported by all feed readers",
                "content_type": "application/rss+xml",
                "icon": "📰",
                "spec_url": "https://cyber.harvard.edu/rss/rss.html",
            },
            {
                "id": "atom",
                "name": "Atom 1.0",
                "description": "Modern standard with better content handling (RFC 4287)",
                "content_type": "application/atom+xml",
                "icon": "⚛️",
                "spec_url": "https://www.rfc-editor.org/rfc/rfc4287",
            },
            {
                "id": "json",
                "name": "JSON Feed 1.1",
                "description": "Modern JSON-based format for developers and APIs",
                "content_type": "application/feed+json",
                "icon": "📋",
                "spec_url": "https://jsonfeed.org/version/1.1/",
            },
        ],
        "default": "rss",
    }
