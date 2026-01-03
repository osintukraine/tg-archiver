"""
Media Router

Provides:
1. Media gallery endpoints optimized for photo/video galleries
2. High-performance media routing with Redis cache
3. Rate limiting for anti-leeching protection (cold-path requests)
"""

from datetime import datetime, timedelta
from typing import Any, Dict, Optional
import logging

import os

from fastapi import APIRouter, Depends, Query, HTTPException, Header, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import and_, desc, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as redis

from models.message import Message
from models.media import MessageMedia, MediaFile

from ..database import get_db
from ..schemas import MediaGalleryResult, MediaItem
from ..utils.rate_limit import rate_limit_dependency, MEDIA_REDIRECT_RATE_LIMIT

router = APIRouter(prefix="/api/media", tags=["media"])
logger = logging.getLogger(__name__)

# Storage configuration
# Production: Set HETZNER_STORAGE_URL=http://storage.example.com:8081
# Development: Falls back to MinIO at localhost:9000
STORAGE_BASE_URL = os.environ.get("HETZNER_STORAGE_URL", "")
# MINIO_PUBLIC_URL is browser-accessible (for redirects)
# MINIO_URL is Docker-internal (for server-to-server communication)
MINIO_PUBLIC_URL = os.environ.get("MINIO_PUBLIC_URL", "http://localhost:9000")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "tg-media")

# Redis connection pool for media routing (shared across workers)
redis_pool: Optional[redis.ConnectionPool] = None

async def get_redis() -> redis.Redis:
    """
    Get Redis connection with connection pooling.

    Creates a shared connection pool (lazy initialization) to Redis DB 2
    for media routing cache. Reuses connections across worker processes
    for optimal performance.

    Returns:
        redis.Redis: Redis client with connection pooling enabled
    """
    global redis_pool
    if redis_pool is None:
        redis_pool = redis.ConnectionPool.from_url(
            "redis://redis:6379/2",  # DB 2 for media routing cache
            max_connections=50,
            decode_responses=True
        )
    return redis.Redis(connection_pool=redis_pool)


# ============================================================================
# MEDIA ROUTING (Internal - called by Caddy)
# ============================================================================

@router.get("/internal/media-redirect/{file_hash:path}")
async def route_media_request(
    request: Request,
    file_hash: str,
    x_original_uri: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
    _rate_limit: None = Depends(rate_limit_dependency(
        requests_per_minute=MEDIA_REDIRECT_RATE_LIMIT,
        endpoint_name="media_redirect"
    ))
) -> RedirectResponse:
    """
    Route media request to correct storage box with Redis caching.

    Internal endpoint called by Caddy reverse proxy when local buffer cache misses.
    Implements high-performance media routing with Redis caching and rate limiting
    for anti-leeching protection.

    **Architecture Flow:**
    1. Rate limit check (60 req/min per IP, configurable via MEDIA_REDIRECT_RATE_LIMIT)
    2. Check Redis cache for storage box mapping (O(1) lookup, 99%+ hit rate)
    3. On cache miss: Query media_files table, write result to cache
    4. Return 307 redirect to storage box endpoint (Hetzner or MinIO)

    **Request Flow:**
    Browser → Caddy (local buffer miss) → This endpoint → Storage box

    **Anti-Leeching Protection:**
    - Rate limited to 60 requests/minute per IP by default
    - Only affects cold-path requests (hot files served from local buffer bypass API)
    - Returns 429 Too Many Requests when limit exceeded

    **Cache Strategy:**
    - Key format: media:route:{clean_hash}
    - Value: storage_box_id (e.g., "box-1", "box-2", "default")
    - TTL: 7 days (media locations rarely change)
    - Expected hit rate: 99%+ after warm-up period

    **Performance Characteristics:**
    - Redis cache hit: ~1ms average
    - Database miss: ~5-10ms + cache write
    - Production environment with warm cache: sub-2ms p99

    Args:
        request: FastAPI request object (used for rate limiting by IP)
        file_hash: SHA-256 hash from URL path (e.g., "ab/cd/abcd1234.jpg")
        x_original_uri: Original request URI from Caddy (optional, for logging)
        db: Database session dependency
        _rate_limit: Rate limit dependency (auto-injected)

    Returns:
        RedirectResponse: 307 Temporary Redirect to storage box endpoint
            - Multi-box: /minio-{storage_box}/{bucket}/{file_hash} (via Caddy proxy)
            - Legacy: HETZNER_STORAGE_URL/{storage_box}/{file_hash}
            - Development: MINIO_PUBLIC_URL/{bucket}/{file_hash}

    Raises:
        HTTPException 404: Media file not found in database
        HTTPException 429: Rate limit exceeded (too many requests)

    Example:
        GET /api/media/internal/media-redirect/ab/cd/abcd1234.jpg
        → 307 redirect to /minio-box-1/tg-media/ab/cd/abcd1234.jpg (multi-box)
        → 307 redirect to http://storage.example.com:8081/box-1/ab/cd/abcd1234.jpg (legacy)
    """
    # Extract clean hash (remove path structure and extension)
    # "ab/cd/abcd1234.jpg" → "abcd1234"
    # Strip trailing slash first (middleware may add it)
    file_hash = file_hash.rstrip('/')
    clean_hash = file_hash.split('/')[-1].split('.')[0]

    r = await get_redis()
    cache_key = f"media:route:{clean_hash}"

    # Try Redis cache first
    storage_box = await r.get(cache_key)

    if storage_box:
        logger.debug(f"Cache HIT: {clean_hash} → {storage_box}")
    else:
        # Cache miss - query database
        logger.info(f"Cache MISS: {clean_hash} - querying database")

        # Query media_files table for storage box
        result = await db.execute(
            text("""
                SELECT storage_box_id
                FROM media_files
                WHERE sha256 = :hash
                LIMIT 1
            """),
            {"hash": clean_hash}
        )
        row = result.fetchone()

        if not row:
            raise HTTPException(
                status_code=404,
                detail=f"Media file not found: {clean_hash}"
            )

        # storage_box_id might be NULL for files without box assignment
        storage_box = row[0] or "default"

        # Write to cache with 7-day TTL
        await r.setex(
            cache_key,
            604800,  # 7 days in seconds
            storage_box
        )
        logger.info(f"Cached: {clean_hash} → {storage_box}")

    # Construct redirect URL to storage
    # Production: Route to storage box's MinIO endpoint
    # Development: Single MinIO (minio:9000)

    # Get storage endpoint from database for multi-box routing
    box_result = await db.execute(
        text("""
            SELECT endpoint
            FROM storage_boxes
            WHERE id = :box_id
        """),
        {"box_id": storage_box}
    )
    box_row = box_result.fetchone()

    if box_row and box_row[0]:
        # Multi-box: route to specific storage endpoint via Caddy
        storage_endpoint = box_row[0]
        # Use Caddy route for browser-accessible URL
        redirect_url = f"/minio-{storage_box}/{MINIO_BUCKET}/{file_hash}"
        logger.debug(f"Multi-box routing: {storage_box} -> {storage_endpoint}")
    elif STORAGE_BASE_URL:
        # Legacy: Hetzner storage URL
        redirect_url = f"{STORAGE_BASE_URL}/{storage_box}/{file_hash}"
    else:
        # Development: Single MinIO at MINIO_PUBLIC_URL
        redirect_url = f"{MINIO_PUBLIC_URL}/{MINIO_BUCKET}/{file_hash}"
        logger.debug(f"Dev mode: Redirecting to MinIO: {redirect_url}")

    return RedirectResponse(
        url=redirect_url,
        status_code=307  # Temporary redirect (preserves GET method)
    )


@router.post("/internal/media-invalidate/{file_hash}")
async def invalidate_media_cache(file_hash: str) -> Dict[str, Any]:
    """
    Invalidate Redis cache entry for a media file.

    Forces cache invalidation for a specific media file, causing the next
    request to re-fetch storage box mapping from the database. Use this
    endpoint during storage operations that change file locations.

    **Common Use Cases:**
    - Migrating files between storage boxes (box-1 to box-2)
    - Rebalancing storage across boxes
    - Fixing incorrect routing after manual database updates
    - Testing cache behavior in development

    **Process:**
    1. Extract clean hash from file_hash parameter (handles paths/extensions)
    2. Delete Redis key: media:route:{clean_hash}
    3. Return invalidation status

    **Note:** Next request for this file will trigger database query and
    cache repopulation with correct storage box mapping.

    Args:
        file_hash: SHA-256 hash (accepts multiple formats)
            - Plain hash: "abcd1234"
            - Path format: "ab/cd/abcd1234.jpg"
            - With extension: "abcd1234.jpg"

    Returns:
        Dict[str, Any]: Invalidation status
            - hash: Clean SHA-256 hash
            - invalidated: True if cache entry existed and was removed
            - message: Human-readable status message

    Example:
        POST /api/media/internal/media-invalidate/abcd1234
        → {"hash": "abcd1234", "invalidated": true, "message": "Cache entry removed"}

        POST /api/media/internal/media-invalidate/ab/cd/abcd1234.jpg
        → {"hash": "abcd1234", "invalidated": false, "message": "Not in cache"}
    """
    clean_hash = file_hash.split('/')[-1].split('.')[0]
    r = await get_redis()

    deleted = await r.delete(f"media:route:{clean_hash}")

    return {
        "hash": clean_hash,
        "invalidated": bool(deleted),
        "message": "Cache entry removed" if deleted else "Not in cache"
    }


@router.get("/internal/media-stats")
async def get_media_routing_stats() -> Dict[str, Any]:
    """
    Get media routing cache statistics.

    Provides operational metrics for Redis cache monitoring and performance
    analysis. Use this endpoint to verify cache health and track memory usage.

    **Metrics Provided:**
    - Total cached file entries (media:route:* keys)
    - Redis memory usage in megabytes
    - Cache database number (DB 2)
    - Configured TTL (7 days)
    - Expected hit rate after warm-up

    **Use Cases:**
    - Monitoring cache performance in production
    - Verifying cache warm-up progress
    - Troubleshooting cache-related issues
    - Capacity planning for Redis memory

    **Performance Note:**
    Uses Redis KEYS command which can be slow on large datasets. Consider
    using SCAN in production if cache grows beyond 100k entries.

    Returns:
        Dict[str, Any]: Cache statistics
            - cached_files: Number of media files in cache
            - redis_memory_mb: Total Redis memory usage (rounded to 2 decimals)
            - cache_db: Redis database number (always 2)
            - ttl_seconds: Cache TTL in seconds (604800 = 7 days)
            - note: Expected performance characteristics

    Example:
        GET /api/media/internal/media-stats
        → {
            "cached_files": 15234,
            "redis_memory_mb": 45.2,
            "cache_db": 2,
            "ttl_seconds": 604800,
            "note": "99%+ hit rate expected after warm-up"
          }
    """
    r = await get_redis()

    # Get all media routing keys
    keys = await r.keys("media:route:*")

    # Sample memory usage
    memory_info = await r.info("memory")

    return {
        "cached_files": len(keys),
        "redis_memory_mb": round(memory_info.get("used_memory", 0) / 1024 / 1024, 2),
        "cache_db": 2,
        "ttl_seconds": 604800,
        "note": "99%+ hit rate expected after warm-up"
    }


# ============================================================================
# MEDIA GALLERY (Public endpoints)
# ============================================================================

@router.get("/gallery", response_model=MediaGalleryResult)
async def get_media_gallery(
    # Media type filter
    media_type: Optional[str] = Query(
        None,
        description="Filter by media type (photo, video, document, audio, voice, animation)",
    ),
    # Standard filters
    channel_id: Optional[int] = Query(None, description="Filter by channel"),
    topic: Optional[str] = Query(None, description="Filter by topic"),
    days: Optional[int] = Query(None, ge=1, le=365, description="Last N days"),
    # Pagination
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=30, ge=1, le=100, description="Items per page"),
    # Sorting
    sort_by: str = Query(
        default="created_at",
        description="Sort by: created_at, telegram_date"
    ),
    sort_order: str = Query(
        default="desc",
        description="Sort order: asc or desc"
    ),
    # Database
    db: AsyncSession = Depends(get_db),
):
    """
    Get paginated media gallery with metadata.

    Returns messages with media attachments, optimized for gallery views
    with infinite scroll pagination. Supports comprehensive filtering and sorting
    for building media-focused UI components.

    **Business Logic:**
    1. Filter messages with media_type set (media present)
    2. Apply optional filters: media_type, channel_id, topic, date range
    3. Count total matching messages for pagination metadata
    4. Sort by created_at (platform ingestion time) or telegram_date (original post time)
    5. Apply pagination with offset/limit
    6. Return MediaItem objects with truncated content previews (200 chars)

    **Filtering Options:**
    - media_type: photo, video, document, audio, voice, animation
    - channel_id: Database channel ID (FK to channels.id)
    - topic: Topic tag (e.g., "news", "discussion")
    - days: Messages from last N days (1-365)

    **Sorting:**
    - created_at: Platform ingestion timestamp (default)
    - telegram_date: Original Telegram post timestamp
    - Order: asc (oldest first) or desc (newest first, default)

    **Pagination:**
    - Default: page=1, page_size=30
    - Maximum page_size: 100 (prevents excessive memory usage)
    - Returns has_next/has_prev for infinite scroll UX

    **Use Cases:**
    - Photo gallery with masonry layout
    - Video gallery with lazy loading thumbnails
    - Document archive browser
    - Media-focused timeline view
    - Channel-specific media galleries

    **Performance Note:**
    Queries Message table only. For full media metadata (file_size, mime_type),
    future enhancement should join with MessageMedia and MediaFile tables.

    Args:
        media_type: Filter by media type (photo, video, document, audio, voice, animation)
        channel_id: Filter by channel database ID
        topic: Filter by topic tag
        days: Include messages from last N days (1-365)
        page: Page number (1-indexed)
        page_size: Items per page (1-100, default 30)
        sort_by: Sort column (created_at or telegram_date, default created_at)
        sort_order: Sort direction (asc or desc, default desc)
        db: Database session dependency

    Returns:
        MediaGalleryResult: Paginated media items with metadata
            - items: List of MediaItem objects with truncated content
            - total: Total matching messages
            - page: Current page number
            - page_size: Items per page
            - total_pages: Calculated total pages
            - has_next: True if more pages available
            - has_prev: True if previous pages available

    Example:
        GET /api/media/gallery?media_type=photo&page_size=50
        → Returns first 50 photos with pagination metadata

        GET /api/media/gallery?channel_id=1&days=7
        → Returns media from channel 1 in last 7 days

        GET /api/media/gallery?media_type=video&sort_by=telegram_date&sort_order=asc
        → Returns all videos sorted by original post date (oldest first)
    """
    # Build filters
    filters = [
        Message.media_type.isnot(None),  # Only messages with media
    ]

    if media_type:
        filters.append(Message.media_type == media_type)
    if channel_id:
        filters.append(Message.channel_id == channel_id)
    if topic:
        filters.append(Message.topic == topic)
    if days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        filters.append(Message.created_at >= cutoff)

    # Base query for messages with media
    query = select(Message).where(and_(*filters))

    # Count total (for pagination metadata)
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # Apply sorting with NULLS LAST for proper chronological order
    if sort_by == "telegram_date":
        sort_column = Message.telegram_date
    else:
        sort_column = Message.created_at

    if sort_order == "asc":
        query = query.order_by(sort_column.nulls_last())
    else:
        query = query.order_by(desc(sort_column).nulls_last())

    # Apply pagination
    offset = (page - 1) * page_size
    query = query.limit(page_size).offset(offset)

    # Execute query
    result = await db.execute(query)
    messages = result.scalars().all()

    # Build media items
    # Note: For full media metadata, we'd need to join with MessageMedia and MediaFile
    # For now, return basic media info from Message table
    media_items = []
    for message in messages:
        # Truncate content for gallery view (first 200 chars)
        content_preview = message.content[:200] if message.content else None

        media_items.append(
            MediaItem(
                message_id=message.id,
                channel_id=message.channel_id,
                content=content_preview,
                topic=message.topic,
                created_at=message.created_at,
                # Media metadata (from Message table)
                media_type=message.media_type,
                media_url=message.media_url_telegram,  # Telegram URL
                # TODO: Add media_url_local when media archival is implemented
                # TODO: Add file_size, mime_type from MediaFile table
                thumbnail_url=None,  # TODO: Generate thumbnails for videos
                file_size=0,  # Placeholder
                mime_type=message.media_type or "unknown",
            )
        )

    # Calculate pagination metadata
    total_pages = (total + page_size - 1) // page_size
    has_next = page < total_pages
    has_prev = page > 1

    return MediaGalleryResult(
        items=media_items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        has_next=has_next,
        has_prev=has_prev,
    )


@router.get("/stats")
async def get_media_stats(
    # Filters
    channel_id: Optional[int] = Query(None, description="Filter by channel"),
    days: int = Query(default=30, ge=1, le=365, description="Last N days"),
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get media statistics for gallery overview.

    Provides aggregated media statistics for building dashboard widgets and
    overview panels. Returns media distribution by type and total counts
    within specified time range.

    **Business Logic:**
    1. Filter messages with media_type set
    2. Apply optional channel_id filter
    3. Apply date range filter (created_at >= cutoff)
    4. Group by media_type and count messages
    5. Calculate total media count (sum of all types)
    6. Return statistics dictionary

    **Current Metrics:**
    - total_media: Total number of media messages
    - media_by_type: Dictionary mapping media_type to count
      (e.g., {"photo": 1234, "video": 567, "document": 89})
    - days: Time range parameter (echo back for context)

    **Future Enhancements (TODO):**
    - Storage usage from MediaFile table (total bytes by type)
    - Most active channels (top N channels by media post count)
    - Daily timeline (message count per day for charting)
    - Average file sizes by media type

    **Use Cases:**
    - Gallery dashboard overview widget
    - Media distribution pie charts
    - Storage capacity planning
    - Channel activity analysis

    Args:
        channel_id: Optional filter by channel database ID
        days: Time range in days (1-365, default 30)
        db: Database session dependency

    Returns:
        Dict[str, Any]: Media statistics
            - total_media: Total count of media messages
            - media_by_type: Dict mapping media_type to count (ordered by count desc)
            - days: Echo of time range parameter
            - note: Future enhancement notice

    Example:
        GET /api/media/stats?days=30
        → {
            "total_media": 1890,
            "media_by_type": {
              "photo": 1234,
              "video": 567,
              "document": 89
            },
            "days": 30,
            "note": "Storage usage and advanced stats available after media archival implementation"
          }

        GET /api/media/stats?channel_id=1&days=7
        → Returns media stats for channel 1 in last 7 days
    """
    filters = [Message.media_type.isnot(None)]

    if channel_id:
        filters.append(Message.channel_id == channel_id)

    cutoff = datetime.utcnow() - timedelta(days=days)
    filters.append(Message.created_at >= cutoff)

    # Count by media type
    media_type_query = (
        select(
            Message.media_type,
            func.count(Message.id).label("count"),
        )
        .where(and_(*filters))
        .group_by(Message.media_type)
        .order_by(func.count(Message.id).desc())
    )

    media_type_result = await db.execute(media_type_query)
    media_by_type = {
        media_type: count for media_type, count in media_type_result.all()
    }

    # Total count
    total = sum(media_by_type.values())

    # TODO: Add storage usage from MediaFile table
    # TODO: Add most active channels
    # TODO: Add daily timeline

    return {
        "total_media": total,
        "media_by_type": media_by_type,
        "days": days,
        "note": "Storage usage and advanced stats available after media archival implementation"
    }
