"""
Admin Statistics API

Aggregated statistics for the platform dashboard.
Combines data from multiple sources for a unified view.

Tier 3: Admin Metrics (Prometheus + PostgreSQL)
Caching: 30s TTL for overview, 60s for quality
"""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime, timedelta
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

from ...database import get_db
from ...dependencies import AdminUser
from ...utils.cache import get_cached, set_cached, make_cache_key
from ...utils.prometheus import get_prometheus_client
from ...utils.formatting import format_bytes

router = APIRouter(prefix="/api/admin/stats", tags=["admin-stats"])

# Cache TTLs for admin endpoints
OVERVIEW_CACHE_TTL = 30   # 30 seconds
QUALITY_CACHE_TTL = 60    # 1 minute


# =============================================================================
# ACTIVE ENDPOINTS
# Note: /dashboard and /timeseries have been removed.
# Use /overview and /api/analytics/timeline instead.
# =============================================================================


@router.get("/processing")
async def get_processing_metrics(
    admin: AdminUser,
    hours: int = Query(24, ge=1, le=168),
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed processing metrics for the specified time window.
    Useful for monitoring processing performance.
    """
    since = datetime.utcnow() - timedelta(hours=hours)

    # Processing by hour
    hourly_result = await db.execute(text("""
        SELECT
            DATE_TRUNC('hour', telegram_date) as hour,
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE is_spam = true) as spam,
            COUNT(*) FILTER (WHERE osint_importance IS NOT NULL) as classified,
            AVG(classification_latency_ms) FILTER (WHERE classification_latency_ms IS NOT NULL) as avg_latency
        FROM messages
        WHERE telegram_date >= :since
        GROUP BY DATE_TRUNC('hour', telegram_date)
        ORDER BY hour
    """), {"since": since})

    hourly_data = [
        {
            "hour": row[0].isoformat() if row[0] else None,
            "total": row[1],
            "spam": row[2],
            "classified": row[3],
            "avg_latency_ms": round(row[4] or 0, 1),
        }
        for row in hourly_result.fetchall()
    ]

    # Summary stats
    summary_result = await db.execute(text("""
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE is_spam = true) as spam,
            COUNT(*) FILTER (WHERE osint_importance IS NOT NULL) as classified,
            AVG(classification_latency_ms) FILTER (WHERE classification_latency_ms IS NOT NULL) as avg_latency,
            MAX(telegram_date) as latest
        FROM messages
        WHERE telegram_date >= :since
    """), {"since": since})
    summary_row = summary_result.fetchone()

    return {
        "period_hours": hours,
        "since": since.isoformat(),
        "summary": {
            "total_messages": summary_row[0] or 0,
            "spam_messages": summary_row[1] or 0,
            "classified_messages": summary_row[2] or 0,
            "avg_latency_ms": round(summary_row[3] or 0, 1),
            "latest_message": summary_row[4].isoformat() if summary_row[4] else None,
            "messages_per_hour": round((summary_row[0] or 0) / hours, 1),
        },
        "hourly": hourly_data,
    }


@router.get("/storage")
async def get_storage_metrics(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """
    Get storage usage metrics.
    Tracks database and media storage usage.
    """
    # Database table sizes (PostgreSQL specific)
    table_result = await db.execute(text("""
        SELECT
            relname as table_name,
            n_live_tup as row_count
        FROM pg_stat_user_tables
        WHERE schemaname = 'public'
        ORDER BY n_live_tup DESC
        LIMIT 10
    """))
    table_sizes = [
        {"table": row[0], "rows": row[1]}
        for row in table_result.fetchall()
    ]

    # Media storage by type
    media_result = await db.execute(text("""
        SELECT
            CASE
                WHEN mime_type LIKE 'image/%' THEN 'image'
                WHEN mime_type LIKE 'video/%' THEN 'video'
                WHEN mime_type LIKE 'audio/%' THEN 'audio'
                WHEN mime_type LIKE 'application/%' THEN 'document'
                ELSE 'other'
            END as type,
            COUNT(*) as count,
            COALESCE(SUM(file_size), 0) as total_size
        FROM media_files
        GROUP BY type
        ORDER BY total_size DESC
    """))
    media_storage = [
        {
            "type": row[0],
            "count": row[1],
            "size_bytes": row[2],
            "size_human": format_bytes(row[2]),
        }
        for row in media_result.fetchall()
    ]

    # Total media size
    total_result = await db.execute(text("""
        SELECT COUNT(*), COALESCE(SUM(file_size), 0) FROM media_files
    """))
    total_row = total_result.fetchone()

    return {
        "database": {
            "tables": table_sizes,
        },
        "media": {
            "total_files": total_row[0] or 0,
            "total_size_bytes": total_row[1] or 0,
            "total_size_human": format_bytes(total_row[1] or 0),
            "by_type": media_storage,
        },
    }


class OverviewStats(BaseModel):
    """Platform overview combining Prometheus + PostgreSQL data."""

    # Pipeline health (from Prometheus)
    pipeline_active: bool
    messages_per_second: float
    archive_rate: float
    queue_depth: int

    # LLM performance (from Prometheus)
    llm_requests_per_minute: float
    llm_avg_latency_seconds: float
    llm_success_rate: float

    # Database totals (from PostgreSQL)
    total_messages: int
    total_channels: int
    total_entities: int
    total_media_files: int

    # Recent activity (from PostgreSQL)
    messages_today: int
    messages_this_week: int
    spam_rate: float

    # Service health summary
    services_healthy: int
    services_degraded: int
    services_down: int

    # Metadata
    timestamp: str
    prometheus_available: bool
    cached: bool = False


@router.get("/overview", response_model=OverviewStats)
async def get_overview_stats(
    admin: AdminUser,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Get comprehensive platform overview.

    Combines real-time metrics from Prometheus with database totals.
    Replaces /api/admin/stats/dashboard with a more efficient, cached version.

    Response cached for 30 seconds.
    """
    cache_key = make_cache_key("admin", "stats", "overview")

    # Try cache first
    cached = await get_cached(cache_key)
    if cached:
        response.headers["X-Cached"] = "true"
        response.headers["Cache-Control"] = f"public, max-age={OVERVIEW_CACHE_TTL}"
        return OverviewStats(**cached)

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)

    # Fetch Prometheus metrics
    prom = get_prometheus_client()
    prom_available = await prom.is_healthy()

    if prom_available:
        import asyncio
        prom_results = await asyncio.gather(
            prom.get_scalar("osint_pipeline_active", 0),
            prom.get_scalar("osint:messages_processed:rate5m", 0),
            prom.get_scalar("osint:messages_archived:rate5m", 0),
            prom.get_scalar("osint_queue_messages_pending", 0),
            prom.get_scalar("osint:llm_requests:rate5m", 0),
            prom.get_scalar("osint:llm_response:avg_duration_seconds", 0),
            prom.get_scalar("osint:llm_success_rate:5m", 100),
            return_exceptions=True
        )

        def safe(idx, default=0):
            v = prom_results[idx]
            if isinstance(v, (int, float)):
                import math
                if math.isnan(v) or math.isinf(v):
                    return default
                return v
            return default

        pipeline_active = safe(0) > 0
        messages_per_second = round(safe(1), 2)
        archive_rate = round(safe(2), 2)
        queue_depth = int(safe(3))
        llm_rpm = round(safe(4) * 60, 1)
        llm_latency = round(safe(5), 2)
        llm_success = round(safe(6), 1)

        # Count service health
        services_result = await prom.query("up")
        if isinstance(services_result, list):
            healthy = sum(1 for s in services_result if float(s.get("value", [0, 0])[1]) == 1)
            degraded = 0  # Would need more complex logic
            down = sum(1 for s in services_result if float(s.get("value", [0, 0])[1]) == 0)
        else:
            healthy, degraded, down = 0, 0, 0
    else:
        pipeline_active = False
        messages_per_second = 0
        archive_rate = 0
        queue_depth = 0
        llm_rpm = 0
        llm_latency = 0
        llm_success = 0
        healthy, degraded, down = 0, 0, 0

    # Database queries
    db_result = await db.execute(text("""
        SELECT
            (SELECT COUNT(*) FROM messages) as total_messages,
            (SELECT COUNT(*) FROM channels) as total_channels,
            (SELECT COUNT(*) FROM curated_entities) as total_entities,
            (SELECT COUNT(*) FROM media_files) as total_media,
            (SELECT COUNT(*) FROM messages WHERE telegram_date >= :today) as today,
            (SELECT COUNT(*) FROM messages WHERE telegram_date >= :week) as week,
            (SELECT COUNT(*) FROM messages WHERE is_spam = true) as spam_total
    """), {"today": today_start, "week": week_start})
    row = db_result.fetchone()

    total_messages = row[0] or 0
    spam_rate = round(((row[6] or 0) / max(total_messages, 1)) * 100, 2)

    result = OverviewStats(
        pipeline_active=pipeline_active,
        messages_per_second=messages_per_second,
        archive_rate=archive_rate,
        queue_depth=queue_depth,
        llm_requests_per_minute=llm_rpm,
        llm_avg_latency_seconds=llm_latency,
        llm_success_rate=llm_success,
        total_messages=total_messages,
        total_channels=row[1] or 0,
        total_entities=row[2] or 0,
        total_media_files=row[3] or 0,
        messages_today=row[4] or 0,
        messages_this_week=row[5] or 0,
        spam_rate=spam_rate,
        services_healthy=healthy,
        services_degraded=degraded,
        services_down=down,
        timestamp=now.isoformat(),
        prometheus_available=prom_available,
        cached=False
    )

    # Cache the result
    await set_cached(cache_key, result.model_dump(), OVERVIEW_CACHE_TTL)

    response.headers["X-Cached"] = "false"
    response.headers["Cache-Control"] = f"public, max-age={OVERVIEW_CACHE_TTL}"

    return result


class DataQualityStats(BaseModel):
    """Data quality metrics for monitoring coverage and completeness."""

    # Translation coverage
    messages_with_translation: int
    messages_needing_translation: int
    translation_coverage_percent: float

    # Embedding coverage
    messages_with_embedding: int
    messages_needing_embedding: int
    embedding_coverage_percent: float

    # Classification coverage
    messages_classified: int
    messages_unclassified: int
    classification_coverage_percent: float

    # Media archival
    media_archived: int
    media_missing: int  # Messages with media_type but no media_file
    media_archive_rate: float

    # Entity extraction
    messages_with_entities: int
    entity_coverage_percent: float

    # Geolocation coverage
    messages_with_geolocation: int
    geolocation_coverage_percent: float

    # Event clusters
    total_event_clusters: int

    # Data freshness
    oldest_unprocessed_message: Optional[str] = None
    enrichment_backlog_size: int

    # Metadata
    timestamp: str
    cached: bool = False


@router.get("/quality", response_model=DataQualityStats)
async def get_quality_stats(
    admin: AdminUser,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Get data quality metrics.

    Monitors coverage of translations, embeddings, classifications,
    media archival, and entity extraction.

    Response cached for 60 seconds.
    """
    cache_key = make_cache_key("admin", "stats", "quality")

    # Try cache first
    cached = await get_cached(cache_key)
    if cached:
        response.headers["X-Cached"] = "true"
        response.headers["Cache-Control"] = f"public, max-age={QUALITY_CACHE_TTL}"
        return DataQualityStats(**cached)

    now = datetime.utcnow()

    # Translation coverage (non-spam messages only)
    trans_result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE content_translated IS NOT NULL AND content_translated != '') as with_translation,
            COUNT(*) FILTER (WHERE content_translated IS NULL OR content_translated = '') as without_translation
        FROM messages
        WHERE is_spam = false AND content IS NOT NULL AND content != ''
    """))
    trans_row = trans_result.fetchone()
    with_trans = trans_row[0] or 0
    without_trans = trans_row[1] or 0
    total_translatable = with_trans + without_trans
    trans_coverage = round((with_trans / max(total_translatable, 1)) * 100, 2)

    # Embedding coverage
    embed_result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE content_embedding IS NOT NULL) as with_embedding,
            COUNT(*) FILTER (WHERE content_embedding IS NULL) as without_embedding
        FROM messages
        WHERE is_spam = false
    """))
    embed_row = embed_result.fetchone()
    with_embed = embed_row[0] or 0
    without_embed = embed_row[1] or 0
    total_embeddable = with_embed + without_embed
    embed_coverage = round((with_embed / max(total_embeddable, 1)) * 100, 2)

    # Classification coverage
    class_result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE importance_level IS NOT NULL) as classified,
            COUNT(*) FILTER (WHERE importance_level IS NULL) as unclassified
        FROM messages
        WHERE is_spam = false
    """))
    class_row = class_result.fetchone()
    classified = class_row[0] or 0
    unclassified = class_row[1] or 0
    total_classifiable = classified + unclassified
    class_coverage = round((classified / max(total_classifiable, 1)) * 100, 2)

    # Media archival (messages with media_type should have media_file via message_media)
    media_result = await db.execute(text("""
        SELECT
            COUNT(*) FILTER (WHERE mm.media_id IS NOT NULL) as archived,
            COUNT(*) FILTER (WHERE mm.media_id IS NULL) as missing
        FROM messages m
        LEFT JOIN message_media mm ON m.id = mm.message_id
        WHERE m.media_type IS NOT NULL AND m.is_spam = false
    """))
    media_row = media_result.fetchone()
    media_archived = media_row[0] or 0
    media_missing = media_row[1] or 0
    total_with_media = media_archived + media_missing
    media_rate = round((media_archived / max(total_with_media, 1)) * 100, 2)

    # Entity coverage
    entity_result = await db.execute(text("""
        SELECT
            COUNT(DISTINCT m.id) as with_entities
        FROM messages m
        INNER JOIN message_entities me ON m.id = me.message_id
        WHERE m.is_spam = false
    """))
    with_entities = entity_result.scalar() or 0
    entity_coverage = round((with_entities / max(total_classifiable, 1)) * 100, 2)

    # Geolocation coverage
    geo_result = await db.execute(text("""
        SELECT COUNT(DISTINCT message_id)
        FROM message_locations
    """))
    with_geolocation = geo_result.scalar() or 0
    geo_coverage = round((with_geolocation / max(total_classifiable, 1)) * 100, 2)

    # Event clusters
    cluster_result = await db.execute(text("""
        SELECT COUNT(*) FROM telegram_event_clusters
    """))
    total_clusters = cluster_result.scalar() or 0

    # Enrichment backlog (from enrichment_tasks table if exists)
    backlog_result = await db.execute(text("""
        SELECT COUNT(*)
        FROM messages
        WHERE is_spam = false
          AND content_embedding IS NULL
          AND created_at > NOW() - INTERVAL '7 days'
    """))
    backlog_size = backlog_result.scalar() or 0

    # Oldest unprocessed (missing embedding)
    oldest_result = await db.execute(text("""
        SELECT MIN(telegram_date)
        FROM messages
        WHERE is_spam = false AND content_embedding IS NULL
    """))
    oldest = oldest_result.scalar()
    oldest_str = oldest.isoformat() if oldest else None

    result = DataQualityStats(
        messages_with_translation=with_trans,
        messages_needing_translation=without_trans,
        translation_coverage_percent=trans_coverage,
        messages_with_embedding=with_embed,
        messages_needing_embedding=without_embed,
        embedding_coverage_percent=embed_coverage,
        messages_classified=classified,
        messages_unclassified=unclassified,
        classification_coverage_percent=class_coverage,
        media_archived=media_archived,
        media_missing=media_missing,
        media_archive_rate=media_rate,
        messages_with_entities=with_entities,
        entity_coverage_percent=entity_coverage,
        messages_with_geolocation=with_geolocation,
        geolocation_coverage_percent=geo_coverage,
        total_event_clusters=total_clusters,
        oldest_unprocessed_message=oldest_str,
        enrichment_backlog_size=backlog_size,
        timestamp=now.isoformat(),
        cached=False
    )

    # Cache the result
    await set_cached(cache_key, result.model_dump(mode='json'), QUALITY_CACHE_TTL)

    response.headers["X-Cached"] = "false"
    response.headers["Cache-Control"] = f"public, max-age={QUALITY_CACHE_TTL}"

    return result
