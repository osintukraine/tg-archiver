"""
Admin System Management Router

Provides endpoints for system administration:
- Worker status and scaling (via Redis consumer groups)
- Container logs viewer
- Audit trail (wraps /api/system/audit)
- Cache management
"""

import asyncio
from datetime import datetime
from typing import Any, Dict, List, Optional

import redis.asyncio as redis
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings

from ...database import get_db
from ...dependencies import AdminUser


router = APIRouter(prefix="/api/admin/system", tags=["Admin - System"])


# =============================================================================
# SCHEMAS
# =============================================================================


class WorkerInfo(BaseModel):
    """Worker/consumer information."""
    name: str
    pending: int
    idle_time_ms: Optional[int] = None
    last_delivered_id: Optional[str] = None


class ConsumerGroupInfo(BaseModel):
    """Redis consumer group information."""
    name: str
    stream: str
    consumers: int
    pending: int
    last_delivered_id: Optional[str] = None
    lag: int = 0
    workers: List[WorkerInfo] = []


class WorkersResponse(BaseModel):
    """Response for workers endpoint."""
    groups: List[ConsumerGroupInfo]
    total_consumers: int
    total_pending: int
    total_lag: int
    timestamp: str


class AuditEntry(BaseModel):
    """Audit trail entry."""
    id: int
    message_id: Optional[int]
    channel_name: Optional[str]
    decision_type: str
    decision_value: Dict[str, Any]
    decision_source: str
    llm_reasoning: Optional[str]
    processing_time_ms: Optional[int]
    verification_status: str
    created_at: str


class AuditResponse(BaseModel):
    """Response for audit endpoint."""
    items: List[AuditEntry]
    total: int
    page: int
    page_size: int
    total_pages: int


class AuditStats(BaseModel):
    """Audit statistics."""
    total_decisions: int
    decisions_last_hour: int
    decisions_last_24h: int
    verification: Dict[str, int]
    outcomes: Dict[str, int]
    performance: Dict[str, float]


# =============================================================================
# WORKERS ENDPOINTS
# =============================================================================


@router.get("/workers", response_model=WorkersResponse)
async def get_workers(admin: AdminUser):
    """
    Get status of all message processing workers.

    Returns Redis consumer group information including:
    - Active workers per group
    - Pending message counts
    - Processing lag
    - Individual consumer details
    """
    try:
        redis_client = redis.from_url(settings.REDIS_URL)
        groups: List[ConsumerGroupInfo] = []

        # Check multiple streams that might have consumer groups
        streams = ["telegram:messages", "telegram_messages"]

        for stream in streams:
            try:
                # Get consumer groups for this stream
                group_infos = await redis_client.xinfo_groups(stream)

                for group in group_infos:
                    group_name = group.get("name", "unknown")

                    # Get detailed consumer info
                    workers = []
                    try:
                        consumers = await redis_client.xinfo_consumers(stream, group_name)
                        for consumer in consumers:
                            workers.append(WorkerInfo(
                                name=consumer.get("name", "unknown"),
                                pending=consumer.get("pending", 0),
                                idle_time_ms=consumer.get("idle", 0),
                            ))
                    except Exception:
                        pass

                    groups.append(ConsumerGroupInfo(
                        name=group_name,
                        stream=stream,
                        consumers=group.get("consumers", 0),
                        pending=group.get("pending", 0),
                        lag=group.get("lag", 0),
                        last_delivered_id=group.get("last-delivered-id"),
                        workers=workers,
                    ))

            except Exception as e:
                # Stream might not exist or have no groups
                if "no such key" not in str(e).lower():
                    print(f"Error checking stream {stream}: {e}")
                continue

        await redis_client.close()

        total_consumers = sum(g.consumers for g in groups)
        total_pending = sum(g.pending for g in groups)
        total_lag = sum(g.lag for g in groups)

        return WorkersResponse(
            groups=groups,
            total_consumers=total_consumers,
            total_pending=total_pending,
            total_lag=total_lag,
            timestamp=datetime.utcnow().isoformat(),
        )

    except Exception as e:
        return WorkersResponse(
            groups=[],
            total_consumers=0,
            total_pending=0,
            total_lag=0,
            timestamp=datetime.utcnow().isoformat(),
        )


@router.get("/workers/stats")
async def get_worker_stats(admin: AdminUser):
    """
    Get aggregated worker statistics for dashboard cards.
    """
    try:
        redis_client = redis.from_url(settings.REDIS_URL)

        # Get stream info
        try:
            stream_info = await redis_client.xinfo_stream("telegram:messages")
            queue_length = stream_info.get("length", 0)
            first_entry = stream_info.get("first-entry")
            last_entry = stream_info.get("last-entry")
        except Exception:
            queue_length = 0
            first_entry = None
            last_entry = None

        # Get consumer groups
        total_consumers = 0
        total_pending = 0
        total_lag = 0

        try:
            groups = await redis_client.xinfo_groups("telegram:messages")
            for group in groups:
                total_consumers += group.get("consumers", 0)
                total_pending += group.get("pending", 0)
                total_lag += group.get("lag", 0)
        except Exception:
            pass

        await redis_client.close()

        return {
            "queue_length": queue_length,
            "total_consumers": total_consumers,
            "total_pending": total_pending,
            "total_lag": total_lag,
            "status": "healthy" if total_lag < 100 else "degraded" if total_lag < 1000 else "overloaded",
            "first_entry_id": first_entry[0] if first_entry else None,
            "last_entry_id": last_entry[0] if last_entry else None,
        }

    except Exception as e:
        return {
            "error": str(e),
            "queue_length": 0,
            "total_consumers": 0,
            "status": "unknown",
        }


# =============================================================================
# AUDIT ENDPOINTS
# =============================================================================


@router.get("/audit")
async def get_audit_log(
    admin: AdminUser,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=200),
    decision_type: Optional[str] = Query(None),
    verification_status: Optional[str] = Query(None),
    channel_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Get decision audit log with pagination and filters.

    Provides full audit trail of LLM classification decisions.
    """
    from models.decision_log import DecisionLog
    from models.channel import Channel
    from models.message import Message
    from sqlalchemy import select, desc, func

    try:
        # Build base query
        query = (
            select(
                DecisionLog,
                Channel.name.label("channel_name"),
                Channel.username.label("channel_username"),
            )
            .outerjoin(Channel, DecisionLog.channel_id == Channel.id)
            .order_by(desc(DecisionLog.created_at))
        )

        # Apply filters
        if decision_type:
            query = query.where(DecisionLog.decision_type == decision_type)
        if verification_status:
            query = query.where(DecisionLog.verification_status == verification_status)
        if channel_id:
            query = query.where(DecisionLog.channel_id == channel_id)

        # Get total count
        count_query = select(func.count(DecisionLog.id))
        if decision_type:
            count_query = count_query.where(DecisionLog.decision_type == decision_type)
        if verification_status:
            count_query = count_query.where(DecisionLog.verification_status == verification_status)
        if channel_id:
            count_query = count_query.where(DecisionLog.channel_id == channel_id)

        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        # Apply pagination
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        result = await db.execute(query)
        rows = result.all()

        items = []
        for row in rows:
            decision = row[0]
            items.append({
                "id": decision.id,
                "message_id": decision.message_id,
                "channel_id": decision.channel_id,
                "channel_name": row.channel_name or row.channel_username,
                "decision_type": decision.decision_type,
                "decision_value": decision.decision_value,
                "decision_source": decision.decision_source,
                "llm_reasoning": decision.llm_reasoning,
                "processing_time_ms": decision.processing_time_ms,
                "model_used": decision.model_used,
                "prompt_version": decision.prompt_version,
                "verification_status": decision.verification_status,
                "verified_by": decision.verified_by,
                "verified_at": decision.verified_at.isoformat() if decision.verified_at else None,
                "created_at": decision.created_at.isoformat() if decision.created_at else None,
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


@router.get("/audit/stats")
async def get_audit_stats(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """
    Get decision audit statistics for dashboard.
    """
    try:
        result = await db.execute(text("""
            SELECT
                COUNT(*) as total_decisions,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as decisions_last_hour,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as decisions_last_24h,
                COUNT(*) FILTER (WHERE verification_status = 'unverified') as unverified,
                COUNT(*) FILTER (WHERE verification_status = 'verified_correct') as verified_correct,
                COUNT(*) FILTER (WHERE verification_status = 'verified_incorrect') as verified_incorrect,
                COUNT(*) FILTER (WHERE verification_status = 'flagged') as flagged,
                COUNT(*) FILTER (WHERE reprocess_requested = true) as pending_reprocess,
                AVG(processing_time_ms) FILTER (WHERE processing_time_ms > 0) as avg_processing_ms,
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY processing_time_ms)
                    FILTER (WHERE processing_time_ms > 0) as p95_processing_ms
            FROM decision_log
        """))

        row = result.fetchone()

        return {
            "total_decisions": row[0] or 0,
            "decisions_last_hour": row[1] or 0,
            "decisions_last_24h": row[2] or 0,
            "verification": {
                "unverified": row[3] or 0,
                "verified_correct": row[4] or 0,
                "verified_incorrect": row[5] or 0,
                "flagged": row[6] or 0,
                "pending_reprocess": row[7] or 0,
            },
            "performance": {
                "avg_ms": round(row[8] or 0, 1),
                "p95_ms": round(row[9] or 0, 1),
            },
        }

    except Exception as e:
        return {"error": str(e)}


@router.post("/audit/{decision_id}/verify")
async def verify_audit_decision(
    decision_id: int,
    admin: AdminUser,
    status: str = Query(..., description="New status (verified_correct, verified_incorrect, flagged)"),
    notes: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """
    Mark a decision as verified or flagged.
    """
    from sqlalchemy import update
    from models.decision_log import DecisionLog

    valid_statuses = ["verified_correct", "verified_incorrect", "flagged", "reprocessed"]
    if status not in valid_statuses:
        return {"error": f"Invalid status. Must be one of: {valid_statuses}"}

    try:
        result = await db.execute(
            update(DecisionLog)
            .where(DecisionLog.id == decision_id)
            .values(
                verification_status=status,
                verified_by="admin:user",
                verified_at=datetime.utcnow(),
                verification_notes=notes,
                reprocess_requested=(status in ["flagged", "verified_incorrect"]),
            )
            .returning(DecisionLog.id)
        )

        updated_id = result.scalar_one_or_none()
        if not updated_id:
            return {"error": f"Decision {decision_id} not found"}

        await db.commit()

        return {
            "success": True,
            "decision_id": decision_id,
            "new_status": status,
        }

    except Exception as e:
        await db.rollback()
        return {"error": str(e)}


# =============================================================================
# CACHE MANAGEMENT
# =============================================================================


@router.get("/cache/stats")
async def get_cache_stats(admin: AdminUser):
    """
    Get Redis cache statistics.
    """
    try:
        redis_client = redis.from_url(settings.REDIS_URL)
        info = await redis_client.info()

        # Get key counts by prefix
        # Note: KEYS is expensive, so we use INFO memory instead

        await redis_client.close()

        return {
            "used_memory": info.get("used_memory_human", "unknown"),
            "used_memory_peak": info.get("used_memory_peak_human", "unknown"),
            "connected_clients": info.get("connected_clients", 0),
            "total_connections_received": info.get("total_connections_received", 0),
            "total_commands_processed": info.get("total_commands_processed", 0),
            "keyspace_hits": info.get("keyspace_hits", 0),
            "keyspace_misses": info.get("keyspace_misses", 0),
            "hit_rate": round(
                info.get("keyspace_hits", 0) /
                max(info.get("keyspace_hits", 0) + info.get("keyspace_misses", 0), 1) * 100,
                1
            ),
            "uptime_seconds": info.get("uptime_in_seconds", 0),
            "redis_version": info.get("redis_version", "unknown"),
        }

    except Exception as e:
        return {"error": str(e)}


@router.post("/cache/clear")
async def clear_cache(
    admin: AdminUser,
    pattern: Optional[str] = Query(None, description="Key pattern to clear (e.g., 'feed:*')"),
):
    """
    Clear cache keys matching pattern.

    Use with caution - clearing all keys can impact performance.
    """
    try:
        redis_client = redis.from_url(settings.REDIS_URL)

        if pattern:
            # Find and delete matching keys
            cursor = 0
            deleted = 0
            while True:
                cursor, keys = await redis_client.scan(cursor, match=pattern, count=100)
                if keys:
                    deleted += await redis_client.delete(*keys)
                if cursor == 0:
                    break

            await redis_client.close()
            return {"success": True, "deleted_keys": deleted, "pattern": pattern}
        else:
            # Don't allow clearing all keys without pattern
            await redis_client.close()
            return {"error": "Pattern required. Use pattern='*' to clear all (dangerous)."}

    except Exception as e:
        return {"error": str(e)}


# =============================================================================
# ENRICHMENT TASKS STATUS
# =============================================================================


class EnrichmentTaskInfo(BaseModel):
    """Enrichment task information with runtime status."""
    name: str
    description: str
    requires_llm: bool
    requires_telegram: bool
    worker: str  # Which worker runs this task
    queue: Optional[str] = None  # Redis queue name (if queue-based)
    status: str  # "running", "idle", "stalled", "not_deployed", "unknown"
    consumers: int = 0  # Active consumers for this queue
    pending: int = 0  # Messages waiting in queue
    last_activity: Optional[str] = None  # Last processing timestamp


class EnrichmentStats(BaseModel):
    """Enrichment task statistics from database."""
    task_name: str
    total_processed: int
    processed_today: int
    avg_items_per_batch: float
    last_activity: Optional[str] = None


class EnrichmentStatusResponse(BaseModel):
    """Complete enrichment status response."""
    tasks: List[EnrichmentTaskInfo]
    stats: List[EnrichmentStats]
    summary: Dict[str, Any]
    timestamp: str


# =============================================================================
# Enrichment Task Definitions
# =============================================================================
# All enrichment tasks with their metadata. Each task maps to a worker service.
#
# Workers and their tasks:
#   fast_worker (enrichment-fast-pool):
#     - translation, embedding, entity_matching, geolocation, rss_correlation
#   telegram_worker (enrichment-telegram):
#     - engagement_polling, social_graph_extraction, comment_fetcher,
#       comment_realtime, comment_backfill, forward_discovery,
#       discovery_metrics_collector, discovery_evaluator
#   maintenance_worker (enrichment-maintenance):
#     - channel_cleanup, quarantine_processor, wikidata_enrichment,
#       wikidata_opensanctions
#   event_detection_worker (enrichment-event-detection):
#     - rss_event_creator, telegram_event_matcher, event_status_updater
#   decision_worker (enrichment-decision):
#     - decision_verifier, decision_reprocessor
#   ai_tagging_worker (enrichment-ai-tagging):
#     - ai_tagging
#   rss_validation_worker (enrichment-rss-validation):
#     - rss_validation
#   geolocation_llm_worker (enrichment-geolocation-llm):
#     - geolocation_llm
#   cluster_detection_worker (enrichment-cluster-detection):
#     - cluster_detection, cluster_archiver, cluster_tier_updater
#   cluster_validation_worker (enrichment-cluster-validation):
#     - cluster_validation
# =============================================================================

ENRICHMENT_TASK_DEFINITIONS = {
    # =========================================================================
    # Fast Worker Tasks (enrichment-fast-pool) - CPU-bound, no external deps
    # =========================================================================
    "translation": {
        "description": "Translate messages to English using DeepL Pro",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "fast_worker",
    },
    "embedding": {
        "description": "Generate 384-dim embeddings using sentence-transformers for semantic search",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "fast_worker",
    },
    "entity_matching": {
        "description": "Match messages to 1,425 curated entities using pgvector semantic similarity",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "fast_worker",
    },
    "geolocation": {
        "description": "Extract coordinates from location names (gazetteer + Nominatim)",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "fast_worker",
    },
    "rss_correlation": {
        "description": "Correlate Telegram messages with RSS articles by embedding similarity",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "fast_worker",
    },

    # =========================================================================
    # Telegram Worker Tasks (enrichment-telegram) - Requires Telegram client
    # =========================================================================
    "engagement_polling": {
        "description": "Poll Telegram for views, forwards, and reactions",
        "requires_llm": False,
        "requires_telegram": True,
        "worker": "telegram_worker",
    },
    "social_graph_extraction": {
        "description": "Extract forward chains and channel relationships from Telegram",
        "requires_llm": False,
        "requires_telegram": True,
        "worker": "telegram_worker",
    },
    "comment_fetcher": {
        "description": "Fetch comments from Telegram discussion groups",
        "requires_llm": False,
        "requires_telegram": True,
        "worker": "telegram_worker",
    },
    "comment_realtime": {
        "description": "Real-time comment streaming from active discussions",
        "requires_llm": False,
        "requires_telegram": True,
        "worker": "telegram_worker",
    },
    "comment_backfill": {
        "description": "Backfill historical comments from discussions",
        "requires_llm": False,
        "requires_telegram": True,
        "worker": "telegram_worker",
    },
    "forward_discovery": {
        "description": "Discover new channels from message forwards",
        "requires_llm": False,
        "requires_telegram": True,
        "worker": "telegram_worker",
    },
    "discovery_metrics_collector": {
        "description": "Collect metrics for channel discovery evaluation",
        "requires_llm": False,
        "requires_telegram": True,
        "worker": "telegram_worker",
    },
    "discovery_evaluator": {
        "description": "Evaluate discovered channels for auto-join based on activity",
        "requires_llm": False,
        "requires_telegram": True,
        "worker": "telegram_worker",
    },

    # =========================================================================
    # Maintenance Worker Tasks (enrichment-maintenance) - Periodic cleanup
    # =========================================================================
    "channel_cleanup": {
        "description": "Clean up inactive or spam channels",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "maintenance_worker",
    },
    "quarantine_processor": {
        "description": "Process quarantined channels after probation period",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "maintenance_worker",
    },
    "wikidata_enrichment": {
        "description": "Enrich entities with Wikidata images and descriptions",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "maintenance_worker",
    },
    "wikidata_opensanctions": {
        "description": "Enrich OpenSanctions entities with Wikidata data",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "maintenance_worker",
    },

    # =========================================================================
    # Event Detection Worker Tasks (enrichment-event-detection) - RSS→Events
    # =========================================================================
    "rss_event_creator": {
        "description": "Create events from RSS news articles using LLM extraction",
        "requires_llm": True,
        "requires_telegram": False,
        "worker": "event_detection_worker",
    },
    "telegram_event_matcher": {
        "description": "Match Telegram messages to existing events using LLM",
        "requires_llm": True,
        "requires_telegram": False,
        "worker": "event_detection_worker",
    },
    "event_status_updater": {
        "description": "Update event lifecycle (tier progression, archival)",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "event_detection_worker",
    },

    # =========================================================================
    # Decision Worker Tasks (enrichment-decision) - LLM decision management
    # =========================================================================
    "decision_verifier": {
        "description": "Sample-verify LLM classification decisions",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "decision_worker",
    },
    "decision_reprocessor": {
        "description": "Reprocess flagged decisions through normal pipeline",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "decision_worker",
    },

    # =========================================================================
    # Dedicated LLM Worker Tasks - Single-task workers for heavy LLM work
    # =========================================================================
    "ai_tagging": {
        "description": "Generate AI-powered tags using Ollama LLM (qwen2.5:3b)",
        "requires_llm": True,
        "requires_telegram": False,
        "worker": "ai_tagging_worker",
    },
    "rss_validation": {
        "description": "Cross-validate Telegram messages against RSS news using LLM",
        "requires_llm": True,
        "requires_telegram": False,
        "worker": "rss_validation_worker",
    },
    "geolocation_llm": {
        "description": "LLM-based relative location resolution (Stage 2 geocoding)",
        "requires_llm": True,
        "requires_telegram": False,
        "worker": "geolocation_llm_worker",
    },

    # =========================================================================
    # Cluster Detection Worker Tasks (enrichment-cluster-detection) - Event V3
    # =========================================================================
    "cluster_detection": {
        "description": "Detect event clusters from message velocity spikes",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "cluster_detection_worker",
    },
    "cluster_archiver": {
        "description": "Archive old clusters after inactivity period",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "cluster_detection_worker",
    },
    "cluster_tier_updater": {
        "description": "Update cluster verification tiers based on source count",
        "requires_llm": False,
        "requires_telegram": False,
        "worker": "cluster_detection_worker",
    },
    # =========================================================================
    # Cluster Validation Worker Task (enrichment-cluster-validation) - Event V3
    # =========================================================================
    "cluster_validation": {
        "description": "Validate detected clusters using LLM claim analysis (factual/rumor/propaganda)",
        "requires_llm": True,
        "requires_telegram": False,
        "worker": "cluster_validation_worker",
    },
}


# Task to Redis queue mapping (must match services/enrichment/src/redis_queue.py)
TASK_TO_QUEUE = {
    # LLM tasks (dedicated queues)
    "ai_tagging": "enrich:ai_tagging",
    "rss_validation": "enrich:rss_validation",
    "geolocation_llm": "enrich:geolocation_llm",
    "cluster_validation": "enrich:cluster_validation",
    # CPU tasks (shared fast queue)
    "embedding": "enrich:fast",
    "translation": "enrich:fast",
    "entity_matching": "enrich:fast",
    "geolocation": "enrich:fast",
    "rss_correlation": "enrich:fast",
    # Telegram API tasks (rate-limited queue)
    "engagement_polling": "enrich:telegram",
    "social_graph_extraction": "enrich:telegram",
    "comment_fetcher": "enrich:telegram",
    "comment_realtime": "enrich:telegram",
    "comment_backfill": "enrich:telegram",
    "forward_discovery": "enrich:telegram",
    "discovery_metrics_collector": "enrich:telegram",
    "discovery_evaluator": "enrich:telegram",
    # Decision tasks
    "decision_verifier": "enrich:decision",
    "decision_reprocessor": "enrich:decision",
    # Maintenance tasks
    "channel_cleanup": "enrich:maintenance",
    "quarantine_processor": "enrich:maintenance",
    "wikidata_enrichment": "enrich:maintenance",
    "wikidata_opensanctions": "enrich:maintenance",
    # Event detection (pipeline, not queue-based)
    "rss_event_creator": None,  # Pipeline mode
    "telegram_event_matcher": None,
    "event_status_updater": None,
    # Cluster detection (dedicated queues)
    "cluster_detection": "enrich:cluster_detection",
    "cluster_archiver": None,  # Runs as auxiliary in cluster_detection_worker
    "cluster_tier_updater": None,  # Runs as auxiliary in cluster_detection_worker
}


@router.get("/enrichment/tasks")
async def get_enrichment_tasks(admin: AdminUser, db: AsyncSession = Depends(get_db)):
    """
    Get enrichment task status based on actual runtime health.

    Status values:
    - running: Recent activity (last hour) or active consumers processing
    - idle: Has consumers but no pending work
    - stalled: Has pending work but no recent processing (possible issue)
    - not_deployed: No consumers found (worker not running)
    - unknown: Cannot determine status

    Returns:
    - Task definitions with runtime status
    - Database statistics for each task
    - Summary of enrichment health
    """
    import os
    from datetime import timedelta

    # Query Redis for queue health
    queue_health: Dict[str, Dict[str, Any]] = {}
    try:
        redis_client = redis.from_url(settings.REDIS_URL)

        # Get unique queues
        unique_queues = set(q for q in TASK_TO_QUEUE.values() if q)

        for queue_name in unique_queues:
            try:
                # Get consumer group info
                groups = await redis_client.xinfo_groups(queue_name)
                total_consumers = sum(g.get("consumers", 0) for g in groups)
                total_pending = sum(g.get("pending", 0) for g in groups)
                total_lag = sum(g.get("lag", 0) for g in groups)

                queue_health[queue_name] = {
                    "consumers": total_consumers,
                    "pending": total_pending,
                    "lag": total_lag,
                    "exists": True,
                }
            except Exception:
                # Queue doesn't exist or no consumer groups
                queue_health[queue_name] = {
                    "consumers": 0,
                    "pending": 0,
                    "lag": 0,
                    "exists": False,
                }

        await redis_client.close()
    except Exception as e:
        print(f"Error querying Redis: {e}")

    # Query database for last activity per task
    task_activity: Dict[str, Optional[datetime]] = {}
    try:
        # Translation - check content_translated column
        result = await db.execute(text("""
            SELECT MAX(telegram_date) FROM messages WHERE content_translated IS NOT NULL
        """))
        task_activity["translation"] = result.scalar()

        # Embedding - check content_embedding column
        result = await db.execute(text("""
            SELECT MAX(telegram_date) FROM messages WHERE content_embedding IS NOT NULL
        """))
        task_activity["embedding"] = result.scalar()

        # Entity matching
        result = await db.execute(text("SELECT MAX(matched_at) FROM message_entities"))
        task_activity["entity_matching"] = result.scalar()

        # AI tagging
        result = await db.execute(text("""
            SELECT MAX(created_at) FROM message_tags WHERE generated_by = 'ai_tagging'
        """))
        task_activity["ai_tagging"] = result.scalar()

        # RSS validation
        result = await db.execute(text("SELECT MAX(created_at) FROM message_validations"))
        task_activity["rss_validation"] = result.scalar()

        # Social graph
        result = await db.execute(text("SELECT MAX(last_updated) FROM entity_relationships"))
        task_activity["social_graph_extraction"] = result.scalar()

        # Events (for event detection tasks)
        result = await db.execute(text("SELECT MAX(created_at) FROM events"))
        event_activity = result.scalar()
        task_activity["rss_event_creator"] = event_activity
        task_activity["telegram_event_matcher"] = event_activity
        task_activity["event_status_updater"] = event_activity

        # Cluster detection
        result = await db.execute(text("SELECT MAX(created_at) FROM telegram_event_clusters"))
        cluster_activity = result.scalar()
        task_activity["cluster_detection"] = cluster_activity
        task_activity["cluster_archiver"] = cluster_activity
        task_activity["cluster_tier_updater"] = cluster_activity
        task_activity["cluster_validation"] = cluster_activity

        # Geolocation
        result = await db.execute(text("SELECT MAX(created_at) FROM message_locations"))
        geo_activity = result.scalar()
        task_activity["geolocation"] = geo_activity
        task_activity["geolocation_llm"] = geo_activity

    except Exception as e:
        print(f"Error querying task activity: {e}")

    # Build task list with runtime status
    tasks = []
    from datetime import timezone
    now = datetime.now(timezone.utc)
    one_hour_ago = now - timedelta(hours=1)

    for task_name, task_def in ENRICHMENT_TASK_DEFINITIONS.items():
        queue_name = TASK_TO_QUEUE.get(task_name)
        queue_info = queue_health.get(queue_name, {}) if queue_name else {}

        consumers = queue_info.get("consumers", 0)
        pending = queue_info.get("pending", 0)
        queue_exists = queue_info.get("exists", False)

        last_activity = task_activity.get(task_name)
        last_activity_str = last_activity.isoformat() if last_activity else None

        # Determine status based on runtime health
        # Make last_activity timezone-aware if it's naive
        if last_activity and last_activity.tzinfo is None:
            last_activity = last_activity.replace(tzinfo=timezone.utc)

        is_recent = last_activity and last_activity > one_hour_ago

        if queue_name:
            # Queue-based task
            if consumers > 0:
                if is_recent:
                    status = "running"  # Active consumers + recent activity
                elif pending > 0:
                    status = "stalled"  # Has work but no recent processing
                else:
                    status = "idle"  # Consumers present but no work
            elif queue_exists:
                status = "idle"  # Queue exists but no consumers (might be scaling down)
            else:
                status = "not_deployed"  # No queue, no consumers
        else:
            # Pipeline/auxiliary task (no queue) - check activity only
            if is_recent:
                status = "running"
            elif last_activity:
                status = "idle"  # Has historical activity
            else:
                status = "unknown"  # No data available

        tasks.append(EnrichmentTaskInfo(
            name=task_name,
            description=task_def["description"],
            requires_llm=task_def["requires_llm"],
            requires_telegram=task_def["requires_telegram"],
            worker=task_def["worker"],
            queue=queue_name,
            status=status,
            consumers=consumers,
            pending=pending,
            last_activity=last_activity_str,
        ))

    # Query database for enrichment statistics
    stats = []
    try:
        # Translation stats (column is content_translated)
        trans_result = await db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE content_translated IS NOT NULL) as total,
                COUNT(*) FILTER (WHERE content_translated IS NOT NULL AND telegram_date >= CURRENT_DATE) as today
            FROM messages
        """))
        row = trans_result.fetchone()
        stats.append(EnrichmentStats(
            task_name="translation",
            total_processed=row[0] or 0,
            processed_today=row[1] or 0,
            avg_items_per_batch=50.0,
        ))

        # Entity matching stats
        entity_result = await db.execute(text("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE matched_at >= CURRENT_DATE) as today,
                MAX(matched_at) as last_activity
            FROM message_entities
        """))
        row = entity_result.fetchone()
        stats.append(EnrichmentStats(
            task_name="entity_matching",
            total_processed=row[0] or 0,
            processed_today=row[1] or 0,
            avg_items_per_batch=100.0,
            last_activity=row[2].isoformat() if row[2] else None,
        ))

        # Embedding stats (column is content_embedding)
        embed_result = await db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE content_embedding IS NOT NULL) as total,
                COUNT(*) FILTER (WHERE content_embedding IS NOT NULL AND telegram_date >= CURRENT_DATE) as today
            FROM messages
        """))
        row = embed_result.fetchone()
        stats.append(EnrichmentStats(
            task_name="embedding",
            total_processed=row[0] or 0,
            processed_today=row[1] or 0,
            avg_items_per_batch=100.0,
        ))

        # AI tagging stats
        tag_result = await db.execute(text("""
            SELECT
                COUNT(DISTINCT message_id) as total,
                COUNT(DISTINCT message_id) FILTER (WHERE created_at >= CURRENT_DATE) as today,
                MAX(created_at) as last_activity
            FROM message_tags
            WHERE generated_by = 'ai_tagging'
        """))
        row = tag_result.fetchone()
        stats.append(EnrichmentStats(
            task_name="ai_tagging",
            total_processed=row[0] or 0,
            processed_today=row[1] or 0,
            avg_items_per_batch=50.0,
            last_activity=row[2].isoformat() if row[2] else None,
        ))

        # Event detection stats
        event_result = await db.execute(text("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today,
                MAX(created_at) as last_activity
            FROM events
        """))
        row = event_result.fetchone()
        stats.append(EnrichmentStats(
            task_name="event_detection",
            total_processed=row[0] or 0,
            processed_today=row[1] or 0,
            avg_items_per_batch=10.0,
            last_activity=row[2].isoformat() if row[2] else None,
        ))

        # RSS validation stats
        rss_result = await db.execute(text("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) as today,
                MAX(created_at) as last_activity
            FROM message_validations
        """))
        row = rss_result.fetchone()
        stats.append(EnrichmentStats(
            task_name="rss_validation",
            total_processed=row[0] or 0,
            processed_today=row[1] or 0,
            avg_items_per_batch=10.0,
            last_activity=row[2].isoformat() if row[2] else None,
        ))

        # Social graph stats (entity relationships from knowledge graph)
        graph_result = await db.execute(text("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE first_seen >= CURRENT_DATE) as today,
                MAX(last_updated) as last_activity
            FROM entity_relationships
        """))
        row = graph_result.fetchone()
        stats.append(EnrichmentStats(
            task_name="social_graph_extraction",
            total_processed=row[0] or 0,
            processed_today=row[1] or 0,
            avg_items_per_batch=20.0,
            last_activity=row[2].isoformat() if row[2] else None,
        ))

    except Exception as e:
        print(f"Error fetching enrichment stats: {e}")

    # Build summary with new status model
    running_count = len([t for t in tasks if t.status == "running"])
    idle_count = len([t for t in tasks if t.status == "idle"])
    stalled_count = len([t for t in tasks if t.status == "stalled"])
    not_deployed_count = len([t for t in tasks if t.status == "not_deployed"])
    unknown_count = len([t for t in tasks if t.status == "unknown"])
    llm_tasks = [t.name for t in tasks if t.requires_llm]

    # Check if Telegram is available
    telegram_available = bool(os.getenv("TELEGRAM_API_ID"))

    summary = {
        "total_tasks": len(ENRICHMENT_TASK_DEFINITIONS),
        "running_tasks": running_count,
        "idle_tasks": idle_count,
        "stalled_tasks": stalled_count,
        "not_deployed_tasks": not_deployed_count,
        "unknown_tasks": unknown_count,
        "llm_tasks": llm_tasks,
        "telegram_available": telegram_available,
        "total_consumers": sum(t.consumers for t in tasks),
        "total_pending": sum(t.pending for t in tasks),
    }

    return {
        "tasks": [t.model_dump() for t in tasks],
        "stats": [s.model_dump() for s in stats],
        "summary": summary,
        "timestamp": datetime.utcnow().isoformat(),
    }
