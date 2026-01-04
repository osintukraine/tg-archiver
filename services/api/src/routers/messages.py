"""
Messages Router

Provides endpoints for message retrieval and search.
Implements full-text search using PostgreSQL tsvector.
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, desc, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.message import Message
from models.channel import Channel
from models.media import MessageMedia, MediaFile
from models.tag import MessageTag

from ..database import get_db
from ..schemas import (
    MessageDetail,
    MessageList,
    SearchParams,
    SearchResult,
    AlbumMediaResponse,
    AlbumMediaItem,
    AdjacentMessages,
    MediaItemSimple,
)
from ..utils import get_media_url

router = APIRouter(prefix="/api/messages", tags=["messages"])


def _get_media_type_from_mime(mime_type: str) -> str:
    """
    Convert MIME type to semantic media type for HTML5 element rendering.

    Maps standard MIME types (e.g., 'image/jpeg') to simplified media types
    (e.g., 'image') used for frontend rendering with appropriate HTML5 elements.

    Args:
        mime_type: Standard MIME type string (e.g., 'image/jpeg', 'video/mp4')

    Returns:
        Semantic media type string: 'image', 'video', 'audio', or 'document'
    """
    if not mime_type:
        return "document"

    mime_lower = mime_type.lower()

    if mime_lower.startswith("image/"):
        return "image"
    if mime_lower.startswith("video/"):
        return "video"
    if mime_lower.startswith("audio/"):
        return "audio"

    return "document"


def _build_media_items(media_list: list) -> list[dict]:
    """
    Build structured media_items list from message.media relationship.

    Transforms MessageMedia ORM objects into serializable dictionaries with
    media URLs, MIME types, and semantic media types for frontend rendering.

    Args:
        media_list: List of MessageMedia ORM objects with loaded media_file relationships

    Returns:
        List of dicts containing url, mime_type, and media_type for each media item.
        Empty list if no media available.
    """
    if not media_list:
        return []

    return [
        {
            "url": mm.media_file.s3_key,
            "mime_type": mm.media_file.mime_type or "application/octet-stream",
            "media_type": _get_media_type_from_mime(mm.media_file.mime_type),
        }
        for mm in media_list
        if mm.media_file
    ]


# IMPORTANT: More specific routes must come BEFORE generic routes
# The album and adjacent endpoints MUST be before /{message_id} to avoid route collision
@router.get("/{message_id}/adjacent", response_model=AdjacentMessages)
async def get_adjacent_messages(
    message_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get previous and next message IDs for navigation.

    Returns the chronologically previous and next message IDs (by telegram_date).
    Used for prev/next navigation buttons on individual message pages.

    Args:
        message_id: Database message ID to find adjacent messages for
        db: Database session

    Returns:
        AdjacentMessages containing current_id, prev_id, and next_id.
        prev_id/next_id will be None if at the boundaries of the message history.

    Raises:
        HTTPException(404): Message not found
    """
    # Get the current message
    result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail=f"Message {message_id} not found")

    # Get previous message (older, earlier timestamp)
    prev_result = await db.execute(
        select(Message.id)
        .where(Message.telegram_date < message.telegram_date)
        .where(or_(Message.is_hidden == False, Message.is_hidden.is_(None)))  # Skip hidden messages
        .order_by(desc(Message.telegram_date))
        .limit(1)
    )
    prev_id = prev_result.scalar_one_or_none()

    # Get next message (newer, later timestamp)
    next_result = await db.execute(
        select(Message.id)
        .where(Message.telegram_date > message.telegram_date)
        .where(or_(Message.is_hidden == False, Message.is_hidden.is_(None)))  # Skip hidden messages
        .order_by(Message.telegram_date.asc())
        .limit(1)
    )
    next_id = next_result.scalar_one_or_none()

    return AdjacentMessages(
        current_id=message_id,
        prev_id=prev_id,
        next_id=next_id,
    )


@router.get("/{message_id}/album", response_model=AlbumMediaResponse)
async def get_message_album(
    message_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all media files for a message's album for lightbox display.

    Telegram messages can be grouped into albums (multiple photos/videos sent together).
    This endpoint retrieves all media in an album for gallery/lightbox navigation.

    Behavior:
    - If message has grouped_id: Returns all media from all messages in that album
    - If no grouped_id: Returns just that message's media
    - Ordered by message_id ASC (chronological order within album)

    Use case: User clicks album card in gallery, lightbox shows all photos with navigation.

    Args:
        message_id: Database message ID to retrieve album for
        db: Database session

    Returns:
        AlbumMediaResponse containing grouped_id, album_size, current_index,
        and list of AlbumMediaItem objects with media URLs and metadata.

    Raises:
        HTTPException(404): Message not found
    """
    # Get the message
    result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail=f"Message {message_id} not found")

    # Build query for album media
    if message.grouped_id:
        # Part of album: get all messages in this grouped album
        query = (
            select(Message, MediaFile)
            .join(MessageMedia, Message.id == MessageMedia.message_id)
            .join(MediaFile, MessageMedia.media_id == MediaFile.id)
            .where(Message.grouped_id == message.grouped_id)
            .where(or_(Message.is_hidden == False, Message.is_hidden.is_(None)))  # Skip hidden messages
            .order_by(Message.id.asc())  # Chronological within album
        )
    else:
        # Single message: just return its media
        query = (
            select(Message, MediaFile)
            .join(MessageMedia, Message.id == MessageMedia.message_id)
            .join(MediaFile, MessageMedia.media_id == MediaFile.id)
            .where(Message.id == message_id)
            .where(or_(Message.is_hidden == False, Message.is_hidden.is_(None)))  # Skip hidden messages
        )

    result = await db.execute(query)
    rows = result.all()

    # Build response
    media_items = []
    current_index = 0

    for idx, (msg, media) in enumerate(rows):
        # Track which media item corresponds to the clicked message
        if msg.id == message_id:
            current_index = idx

        media_items.append(AlbumMediaItem(
            message_id=msg.id,
            media_id=media.id,
            media_url=get_media_url(media.s3_key),
            media_type=msg.media_type or "unknown",
            mime_type=media.mime_type,
            file_size=media.file_size,
            sha256=media.sha256,
            content=msg.content,
            telegram_date=msg.telegram_date,
        ))

    return AlbumMediaResponse(
        grouped_id=message.grouped_id,
        album_size=len(media_items),
        current_index=current_index,
        media=media_items,
    )


@router.get("/{message_id}/forward-context")
async def get_forward_context(message_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get forward chain context for a message.

    If this message was forwarded from another channel, returns:
    - Original source channel info
    - Original message stats (views, forwards)
    - Reactions from original message
    - Comments from original message
    - Propagation timing
    """
    # Check if message has forward chain data
    result = await db.execute(text("""
        SELECT
            mf.id as forward_id,
            mf.original_message_id,
            mf.propagation_seconds,
            mf.social_data_fetched_at,
            dc.id as discovered_channel_id,
            dc.telegram_id as source_telegram_id,
            dc.name as source_name,
            dc.username as source_username,
            dc.participant_count as source_subscribers,
            dc.verified as source_verified,
            dc.join_status,
            om.content as original_content,
            om.views as original_views,
            om.forwards as original_forwards,
            om.comments_count as original_comments_count,
            om.original_date,
            om.has_media as original_has_media
        FROM message_forwards mf
        JOIN discovered_channels dc ON dc.id = mf.discovered_channel_id
        LEFT JOIN original_messages om ON om.message_forward_id = mf.id
        WHERE mf.local_message_id = :message_id
    """), {"message_id": message_id})

    row = result.fetchone()
    if not row:
        return {"has_forward_context": False}

    forward_data = dict(row._mapping)

    # Get reactions
    reactions_result = await db.execute(text("""
        SELECT emoji, count, custom_emoji_id
        FROM forward_reactions
        WHERE message_forward_id = :forward_id
        ORDER BY count DESC
    """), {"forward_id": forward_data["forward_id"]})

    reactions = [
        {"emoji": r[0], "count": r[1], "custom_emoji_id": r[2]}
        for r in reactions_result.fetchall()
    ]

    # Get sample comments (most recent 10)
    comments_result = await db.execute(text("""
        SELECT
            author_username,
            author_first_name,
            content,
            comment_date
        FROM forward_comments
        WHERE message_forward_id = :forward_id
        ORDER BY comment_date DESC
        LIMIT 10
    """), {"forward_id": forward_data["forward_id"]})

    comments = [
        {
            "author": r[0] or r[1] or "Anonymous",
            "content": r[2],
            "date": r[3].isoformat() if r[3] else None
        }
        for r in comments_result.fetchall()
    ]

    return {
        "has_forward_context": True,
        "source": {
            "name": forward_data["source_name"],
            "username": forward_data["source_username"],
            "subscribers": forward_data["source_subscribers"],
            "verified": forward_data["source_verified"],
            "telegram_id": forward_data["source_telegram_id"],
            "join_status": forward_data["join_status"],
        },
        "original": {
            "message_id": forward_data["original_message_id"],
            "content": forward_data["original_content"],
            "views": forward_data["original_views"],
            "forwards": forward_data["original_forwards"],
            "comments_count": forward_data["original_comments_count"],
            "date": forward_data["original_date"].isoformat() if forward_data["original_date"] else None,
            "has_media": forward_data["original_has_media"],
        },
        "propagation_seconds": forward_data["propagation_seconds"],
        "social_fetched_at": forward_data["social_data_fetched_at"].isoformat() if forward_data["social_data_fetched_at"] else None,
        "reactions": reactions,
        "reactions_total": sum(r["count"] for r in reactions),
        "comments": comments,
        "comments_fetched": len(comments),
    }


@router.get("/{message_id}", response_model=MessageDetail)
async def get_message(message_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get detailed information about a specific message.

    Retrieves complete message data including:
    - Message content (original and translated)
    - Media files and attachments
    - Tags and classifications
    - Channel metadata for source verification

    Uses eager loading for optimal performance with related entities.

    Args:
        message_id: Database message ID (not Telegram message ID)
        db: Database session

    Returns:
        MessageDetail with full message data, media URLs, entity matches,
        locations, tags, and channel information.

    Raises:
        HTTPException(404): Message not found
    """
    # Eagerly load media, channel, and tags relationships
    result = await db.execute(
        select(Message)
        .where(Message.id == message_id)
        .where(or_(Message.is_hidden == False, Message.is_hidden.is_(None)))  # Skip hidden messages
        .options(
            selectinload(Message.media).selectinload(MessageMedia.media_file),
            selectinload(Message.channel),
            selectinload(Message.tags)
        )
    )
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail=f"Message {message_id} not found")

    # Convert to dict and add media URLs, tags, and channel manually
    msg_dict = {c.name: getattr(message, c.name) for c in message.__table__.columns}
    msg_dict['media_urls'] = [mm.media_file.s3_key for mm in message.media] if message.media else []
    msg_dict['media_items'] = _build_media_items(message.media)
    msg_dict['first_media_url'] = msg_dict['media_urls'][0] if msg_dict['media_urls'] else None

    # Add AI-generated tags
    msg_dict['tags'] = [
        {
            'id': tag.id,
            'message_id': tag.message_id,
            'tag': tag.tag,
            'tag_type': tag.tag_type,
            'confidence': float(tag.confidence) if tag.confidence else 0.0,
            'generated_by': tag.generated_by,
            'created_at': tag.created_at,
        }
        for tag in message.tags
    ] if message.tags else []

    # Geolocation not implemented in tg-archiver
    msg_dict['locations'] = []
    msg_dict['location'] = None

    # Add channel info for Telegram URL generation and country indicators
    if message.channel:
        msg_dict['channel'] = {
            'id': message.channel.id,
            'telegram_id': message.channel.telegram_id,
            'username': message.channel.username,
            'name': message.channel.name,
            'folder': message.channel.folder,  # CRITICAL: For country indicators in frontend
            'verified': message.channel.verified,
            'scam': message.channel.scam,
            'fake': message.channel.fake,
            'restricted': message.channel.restricted,
        }

    return MessageDetail.model_validate(msg_dict)


@router.get("/", response_model=SearchResult)
async def search_messages(
    # Text search
    q: Optional[str] = Query(None, description="Search query (full-text)"),
    # Filters
    channel_id: Optional[int] = Query(None, description="Filter by channel ID"),
    channel_username: Optional[str] = Query(None, description="Filter by channel username"),
    channel_folder: Optional[str] = Query(None, description="Filter by channel folder pattern (e.g., '%Category', 'Archive-%')"),
    topic: Optional[str] = Query(
        None, description="Filter by topic (news/discussion/media/announcement/other)"
    ),
    has_media: Optional[bool] = Query(None, description="Filter messages with media"),
    media_type: Optional[str] = Query(
        None, description="Filter by media type (photo/video/document/audio/voice/sticker/animation)"
    ),
    # Filters
    language: Optional[str] = Query(
        None, description="Filter by detected language (e.g., 'uk', 'ru', 'en')"
    ),
    needs_human_review: Optional[bool] = Query(
        None, description="Filter messages flagged for human review"
    ),
    has_comments: Optional[bool] = Query(
        None, description="Filter messages with discussion threads"
    ),
    min_views: Optional[int] = Query(
        None, ge=0, description="Minimum view count"
    ),
    min_forwards: Optional[int] = Query(
        None, ge=0, description="Minimum forward count"
    ),
    # Date range
    date_from: Optional[datetime] = Query(None, description="Start date (inclusive)"),
    date_to: Optional[datetime] = Query(None, description="End date (inclusive)"),
    days: Optional[int] = Query(None, ge=1, le=365, description="Last N days"),
    # Pagination
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(default=50, ge=1, le=100, description="Items per page"),
    # Sorting
    sort_by: str = Query(default="telegram_date", description="Sort field (telegram_date=message time, created_at=insertion time)"),
    sort_order: str = Query(default="desc", description="Sort order (asc/desc)"),
    # Database
    db: AsyncSession = Depends(get_db),
):
    """
    Search and filter messages with advanced full-text search.

    This is the primary message search endpoint, providing comprehensive filtering
    capabilities for message analysis. Uses PostgreSQL full-text search with
    GIN indexes for high-performance text queries (10-100x faster than ILIKE).

    Search Features:
    - Full-text search on message content (original + translated, weighted)
    - PostgreSQL tsvector with GIN indexing for performance
    - 25+ filter parameters across content, metadata, and filtering dimensions
    - Batch entity and location fetching for optimal performance
    - Folder-based source filtering (e.g., '%Category' for category-based organization)

    Content Filters:
    - language: Filter by detected language (uk/ru/en)
    - needs_human_review: Messages flagged for manual verification
    - topic: Topic classification (news/discussion/media/announcement/other)

    Engagement Filters:
    - min_views: Minimum view count threshold
    - min_forwards: Minimum forward count threshold
    - has_comments: Messages with discussion threads

    Example Queries:
    - /api/messages?q=keyword&topic=news
    - /api/messages?channel_username=channel_name&days=7
    - /api/messages?channel_folder=%Category (category-based filter)
    - /api/messages?channel_folder=Archive-% (archive folder filter)
    - /api/messages?topic=discussion&has_media=true&page=2
    - /api/messages?language=en&needs_human_review=true
    - /api/messages?min_views=1000&min_forwards=100

    Args:
        q: Full-text search query (searches content and translations)
        channel_id: Filter by channel database ID
        channel_username: Filter by channel username
        channel_folder: Filter by folder pattern (supports SQL LIKE, e.g., '%Category')
        topic: Filter by topic classification
        has_media: Filter messages with/without media
        media_type: Filter by specific media type
        language: Filter by detected language code
        needs_human_review: Filter messages flagged for review
        has_comments: Filter messages with discussion threads
        min_views: Minimum view count threshold
        min_forwards: Minimum forward count threshold
        date_from: Start date for time range filter (inclusive)
        date_to: End date for time range filter (inclusive)
        days: Shortcut for last N days (alternative to date_from/date_to)
        page: Page number (1-indexed)
        page_size: Items per page (max 100)
        sort_by: Field to sort by (default: created_at)
        sort_order: Sort direction (asc/desc, default: desc)
        db: Database session

    Returns:
        SearchResult containing:
        - items: List of MessageList objects with full metadata
        - total: Total matching messages (pre-pagination)
        - page: Current page number
        - page_size: Items per page
        - total_pages: Total number of pages
        - has_next: Boolean indicating if next page exists
        - has_prev: Boolean indicating if previous page exists

    Raises:
        No exceptions raised (empty results return SearchResult with items=[])
    """
    # Build query with eager loading of media, channel, and tags relationships
    query = select(Message).options(
        selectinload(Message.media).selectinload(MessageMedia.media_file),
        selectinload(Message.channel),
        selectinload(Message.tags)
    )

    # Apply filters
    filters = []

    # Track if we need to join Channel table
    needs_channel_join = bool(channel_username or channel_folder)

    # Full-text search
    if q:
        # PostgreSQL full-text search using tsvector + GIN index
        # This is 10-100x faster than ILIKE for text search
        # The search_vector column uses 'simple' config (no language-specific stemming)
        # which is better for multilingual content
        #
        # websearch_to_tsquery supports advanced syntax:
        # - "quoted phrase" for exact phrases
        # - word1 OR word2 for alternatives
        # - -word to exclude terms
        # Example: "keyword" OR "term" -exclude
        filters.append(
            Message.search_vector.op('@@')(func.websearch_to_tsquery('simple', q))
        )

    # Channel filters
    if channel_id:
        filters.append(Message.channel_id == channel_id)

    if channel_username or channel_folder:
        # Join with Channel to filter by username or folder
        # Message.channel_id is FK to Channel.id (not Channel.telegram_id)
        query = query.join(Channel, Message.channel_id == Channel.id)

        if channel_username:
            filters.append(Channel.username == channel_username)

        if channel_folder:
            # Support SQL LIKE patterns (e.g., '%Category', 'Archive-%')
            filters.append(Channel.folder.like(channel_folder))

    # Topic filter
    if topic:
        filters.append(Message.topic == topic)

    # Media filter
    if has_media is not None:
        if has_media:
            filters.append(Message.media_type.isnot(None))
        else:
            filters.append(Message.media_type.is_(None))

    # Media type filter (specific type)
    if media_type:
        filters.append(Message.media_type == media_type)

    # Hidden messages filter (always exclude from public search)
    filters.append(or_(Message.is_hidden == False, Message.is_hidden.is_(None)))

    # Language filter
    if language:
        filters.append(Message.language_detected == language)

    # Human review filter
    if needs_human_review is not None:
        filters.append(Message.needs_human_review == needs_human_review)

    # Has comments filter
    if has_comments is not None:
        filters.append(Message.has_comments == has_comments)

    # Engagement filters
    if min_views is not None:
        filters.append(Message.views >= min_views)

    if min_forwards is not None:
        filters.append(Message.forwards >= min_forwards)

    # Date filters - Use telegram_date (actual message time), not created_at (insertion time)
    # This is critical for backfilled messages which may have recent created_at but old telegram_date
    if days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        filters.append(Message.telegram_date >= cutoff)
    elif date_from or date_to:
        if date_from:
            filters.append(Message.telegram_date >= date_from)
        if date_to:
            filters.append(Message.telegram_date <= date_to)

    # Apply all filters
    if filters:
        query = query.where(and_(*filters))

    # Count total results (before pagination)
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Apply sorting - default fallback to telegram_date (actual message time)
    # Use NULLS LAST to ensure messages with NULL dates don't appear at top
    sort_column = getattr(Message, sort_by, Message.telegram_date)
    if sort_order == "desc":
        query = query.order_by(desc(sort_column).nulls_last())
    else:
        query = query.order_by(sort_column.nulls_last())

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.limit(page_size).offset(offset)

    # Execute query
    result = await db.execute(query)
    messages = result.unique().scalars().all()  # .unique() needed for eager loading in SQLAlchemy 2.0

    # Calculate pagination metadata
    total_pages = (total + page_size - 1) // page_size
    has_next = page < total_pages
    has_prev = page > 1

    # Entity matching removed in tg-archiver (no AI)

    # Convert messages to dict and add media URLs, tags, channel
    items = []
    for msg in messages:
        msg_dict = {c.name: getattr(msg, c.name) for c in msg.__table__.columns}
        msg_dict['media_urls'] = [mm.media_file.s3_key for mm in msg.media] if msg.media else []
        msg_dict['media_items'] = _build_media_items(msg.media)
        msg_dict['first_media_url'] = msg_dict['media_urls'][0] if msg_dict['media_urls'] else None

        # Add AI-generated tags
        msg_dict['tags'] = [
            {
                'id': tag.id,
                'message_id': tag.message_id,
                'tag': tag.tag,
                'tag_type': tag.tag_type,
                'confidence': float(tag.confidence) if tag.confidence else 0.0,
                'generated_by': tag.generated_by,
                'created_at': tag.created_at,
            }
            for tag in msg.tags
        ] if msg.tags else []

        # Geolocation not implemented in tg-archiver
        msg_dict['location'] = None

        # Add channel info for country indicators and metadata
        if msg.channel:
            msg_dict['channel'] = {
                'id': msg.channel.id,
                'telegram_id': msg.channel.telegram_id,
                'username': msg.channel.username,
                'name': msg.channel.name,
                'folder': msg.channel.folder,
                'verified': msg.channel.verified,
                'scam': msg.channel.scam,
                'fake': msg.channel.fake,
                'restricted': msg.channel.restricted,
            }

        items.append(MessageList.model_validate(msg_dict))

    return SearchResult(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=has_next,
        has_prev=has_prev,
    )
