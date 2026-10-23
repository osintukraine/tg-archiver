"""
System health and status endpoints.
Used by About page for live architecture visualization.
"""

import asyncio
from datetime import datetime
from typing import Any, Dict, List

import httpx
import redis.asyncio as redis
from fastapi import APIRouter, Depends
from redis.exceptions import ResponseError
from models.base import AsyncSessionLocal
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings

from ..database import get_db

router = APIRouter(prefix="/api/system", tags=["system"])

# Must match processor RedisConsumer (STREAM_* and CONSUMER_GROUP)
STREAMS = ("telegram:messages:realtime", "telegram:messages:backfill", "telegram:messages")
CONSUMER_GROUP = "processor-workers"


async def get_stream_backlog(client: redis.Redis) -> Dict[str, Any]:
    """Sum the processor group's lag/pending/consumers over the real streams."""
    total = {"found": False, "length": 0, "lag": 0, "pending": 0, "consumers": 0}
    for stream in STREAMS:
        try:
            groups = await client.xinfo_groups(stream)
            total["length"] += await client.xlen(stream)
        except ResponseError:
            continue  # stream does not exist yet
        for group in groups:
            if group.get("name") != CONSUMER_GROUP:
                continue
            total["found"] = True
            total["lag"] += group.get("lag") or 0
            total["pending"] += group.get("pending", 0)
            total["consumers"] += group.get("consumers", 0)
    return total


@router.get("/config")
async def get_public_config() -> Dict[str, Any]:
    """
    Returns public configuration settings for the frontend.

    These settings control UI behavior based on backend capabilities.
    """
    return {
        "translation_enabled": settings.TRANSLATION_ENABLED,
    }


@router.get("/health")
async def get_system_health(
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Returns health status of all tg-archiver services.

    Checks services from docker-compose.yml:
    - Core Infrastructure: postgres, redis, minio
    - Application Services: listener, processor, api, frontend

    Returns:
        dict: Service statuses and metrics
    """
    services: List[Dict[str, Any]] = []

    # The two DB checks share one AsyncSession, which forbids concurrent use: run them in turn.
    # The others don't touch the session and run concurrently.
    postgres = await check_postgres_health(db)
    listener = await check_listener_health(db)
    redis_, minio, processor, api, frontend = await asyncio.gather(
        check_redis_health(),
        check_minio_health(),
        check_processor_health(),
        check_api_health(),
        check_frontend_health(),
        return_exceptions=True,
    )
    results = [postgres, redis_, minio, listener, processor, api, frontend]

    # Filter out exceptions and add to services list
    for result in results:
        if isinstance(result, dict):
            services.append(result)
        elif isinstance(result, Exception):
            # Log exception but don't fail the entire health check
            print(f"Health check error: {result}")

    return {
        "services": services,
        "timestamp": datetime.utcnow().isoformat()
    }


@router.get("/health/llm")
async def get_llm_health() -> Dict[str, Any]:
    """
    Detailed LLM endpoint health check.

    Returns configuration and connectivity status for the Ollama endpoint,
    including support for external endpoints (e.g., Contabo hosted DeepSeek).

    Returns:
        dict: LLM endpoint status, configuration, and available models
    """
    result = {
        "endpoint": settings.OLLAMA_BASE_URL,
        "external_mode": settings.OLLAMA_EXTERNAL_MODE,
        "configured_model": settings.OLLAMA_MODEL,
        "timeout_seconds": settings.OLLAMA_TIMEOUT,
        "auth_configured": bool(settings.OLLAMA_API_KEY),
        "timestamp": datetime.utcnow().isoformat()
    }

    try:
        # Build headers for authenticated requests
        headers = {}
        if settings.OLLAMA_API_KEY:
            headers['Authorization'] = f'Bearer {settings.OLLAMA_API_KEY}'

        async with httpx.AsyncClient(timeout=5.0, headers=headers) as client:
            # Check connectivity and list models
            response = await client.get(f"{settings.OLLAMA_BASE_URL}/api/tags")

            if response.status_code == 200:
                data = response.json()
                models = data.get("models", [])
                model_names = [m.get("name", m.get("model", "unknown")) for m in models]

                result.update({
                    "status": "healthy",
                    "models_available": model_names,
                    "model_count": len(models),
                    "configured_model_available": any(
                        settings.OLLAMA_MODEL in name for name in model_names
                    )
                })
            elif response.status_code == 401:
                result.update({
                    "status": "auth_failed",
                    "error": "Authentication failed - check OLLAMA_API_KEY"
                })
            else:
                result.update({
                    "status": "degraded",
                    "error": f"Unexpected status code: {response.status_code}"
                })

    except httpx.ConnectError as e:
        result.update({
            "status": "unreachable",
            "error": f"Connection failed: {e}"
        })
    except httpx.TimeoutException:
        result.update({
            "status": "timeout",
            "error": "Request timed out after 5 seconds"
        })
    except Exception as e:
        result.update({
            "status": "error",
            "error": str(e)
        })

    return result


async def check_redis_health() -> Dict[str, Any]:
    """Check Redis connection and queue depth."""
    try:
        redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        await redis_client.ping()

        # Backlog = not yet delivered + delivered but unacknowledged
        try:
            backlog = await get_stream_backlog(redis_client)
            queue_depth = backlog["lag"] + backlog["pending"]
        except Exception:
            queue_depth = 0

        await redis_client.close()

        return {
            "name": "redis",
            "status": "healthy",
            "uptime_percent": 99.9,
            "metrics": {
                "queue_depth": queue_depth
            }
        }
    except Exception as e:
        return {
            "name": "redis",
            "status": "down",
            "error": str(e)
        }


async def check_postgres_health(db: AsyncSession) -> Dict[str, Any]:
    """Check PostgreSQL connection and get message count."""
    try:
        result = await db.execute(text("SELECT COUNT(*) FROM messages"))
        message_count = result.scalar()

        # Get connection count
        conn_result = await db.execute(
            text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()")
        )
        connection_count = conn_result.scalar()

        return {
            "name": "postgresql",
            "status": "healthy",
            "uptime_percent": 99.9,
            "metrics": {
                "total_messages": message_count,
                "connections": connection_count
            }
        }
    except Exception as e:
        return {
            "name": "postgresql",
            "status": "down",
            "error": str(e)
        }


async def check_listener_health(db: AsyncSession) -> Dict[str, Any]:
    """Check listener health via recent message timestamps."""
    try:
        # Age of the newest archived message: healthy under 5 minutes, degraded above
        result = await db.execute(
            text("SELECT EXTRACT(EPOCH FROM NOW() - MAX(created_at)) FROM messages")
        )
        age = result.scalar()
        if age is None:
            age_seconds, status = None, "degraded"  # nothing archived yet
        else:
            age_seconds = max(0, int(age))
            status = "healthy" if age_seconds < 300 else "degraded"

        return {
            "name": "listener",
            "status": status,
            "metrics": {
                "last_message_age_seconds": age_seconds
            }
        }
    except Exception as e:
        return {
            "name": "listener",
            "status": "down",
            "error": str(e)
        }


async def check_processor_health() -> Dict[str, Any]:
    """Check processor health via Redis consumer group lag."""
    try:
        redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

        try:
            backlog = await get_stream_backlog(redis_client)
            workers_active = backlog["consumers"]
            total_lag = backlog["lag"]
            if not backlog["found"]:
                status = "unknown"
            else:
                status = "healthy" if total_lag < 100 else "degraded"
        except Exception:
            workers_active = 0
            total_lag = 0
            status = "unknown"

        await redis_client.close()

        return {
            "name": "processor",
            "status": status,
            "metrics": {
                "workers_active": workers_active,
                "queue_lag": total_lag
            }
        }
    except Exception as e:
        return {
            "name": "processor",
            "status": "down",
            "error": str(e)
        }


# HTTP-based health checks for external services
async def _check_http_health(
    name: str,
    url: str,
    timeout: float = 2.0,
    expected_status: int = 200
) -> Dict[str, Any]:
    """Generic HTTP health check helper."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url)
            if response.status_code == expected_status:
                return {"name": name, "status": "healthy"}
            else:
                return {
                    "name": name,
                    "status": "degraded",
                    "error": f"HTTP {response.status_code}"
                }
    except httpx.ConnectError:
        return {"name": name, "status": "down", "error": "Connection refused"}
    except httpx.TimeoutException:
        return {"name": name, "status": "degraded", "error": "Timeout"}
    except Exception as e:
        return {"name": name, "status": "unknown", "error": str(e)}


# Core Infrastructure
async def check_minio_health() -> Dict[str, Any]:
    """Check S3 object storage (SeaweedFS) health."""
    return await _check_http_health("seaweedfs", "http://seaweedfs:8333/healthz")


# Application Services
async def check_api_health() -> Dict[str, Any]:
    """Check API service health."""
    return await _check_http_health("api", "http://localhost:8000/health")


async def check_frontend_health() -> Dict[str, Any]:
    """Check Next.js frontend health."""
    return await _check_http_health("frontend", "http://frontend:3000/", expected_status=200)


# =============================================================================
# Pipeline Status Endpoint - Operational Health Metrics
# =============================================================================

@router.get("/pipeline")
async def get_pipeline_status() -> Dict[str, Any]:
    """
    Returns operational pipeline status with boolean health flags.

    Answers key operational questions:
    - Are all messages processed? (queue lag)
    - Are translations complete?
    - Is media being archived?

    Returns:
        dict: Pipeline status with boolean flags and metrics
    """
    # Run checks sequentially to avoid SQLAlchemy session conflicts
    # Each check creates its own session as needed
    queue = await check_queue_status()
    processing = await check_processing_status_standalone()
    translation = await check_translation_status_standalone()
    media = await check_media_status_standalone()

    # Calculate overall health
    all_ok = all([
        queue.get("ok", False),
        processing.get("ok", False),
        translation.get("ok", False),
        media.get("ok", False),
    ])

    return {
        "ok": all_ok,
        "timestamp": datetime.utcnow().isoformat(),
        "checks": {
            "queue": queue,
            "processing": processing,
            "translation": translation,
            "media": media,
        },
        "summary": {
            "queue_lag": queue.get("lag", 0),
            "messages_last_hour": processing.get("last_hour", 0),
            "pending_translation": translation.get("pending", 0),
            "media_missing": media.get("missing", 0),
        }
    }


async def check_queue_status() -> Dict[str, Any]:
    """Check if message queue is caught up."""
    try:
        redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)

        backlog = await get_stream_backlog(redis_client)
        queue_length = backlog["length"]
        lag = backlog["lag"]
        pending = backlog["pending"]
        consumers = backlog["consumers"]

        await redis_client.close()

        # Queue is healthy if lag < 100
        ok = lag < 100

        return {
            "ok": ok,
            "lag": lag,
            "queue_length": queue_length,
            "pending": pending,
            "consumers": consumers,
            "description": "caught up" if ok else f"{lag} messages behind"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def check_processing_status(db: AsyncSession) -> Dict[str, Any]:
    """Check if messages are being processed."""
    try:
        result = await db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour,
                COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '10 minutes') as last_10min,
                MAX(created_at) as latest
            FROM messages
        """))
        row = result.fetchone()

        last_hour = row[0] or 0
        last_10min = row[1] or 0
        latest = row[2]

        # Calculate age of latest message
        if latest:
            age_seconds = (datetime.utcnow() - latest.replace(tzinfo=None)).total_seconds()
        else:
            age_seconds = 9999

        # Processing is OK if we have messages in last 10 minutes
        ok = last_10min > 0 and age_seconds < 600

        return {
            "ok": ok,
            "last_hour": last_hour,
            "last_10min": last_10min,
            "latest_age_seconds": int(age_seconds),
            "description": f"{last_hour} archived in last hour" if ok else "no recent processing"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def check_translation_status(db: AsyncSession) -> Dict[str, Any]:
    """Check translation backlog."""
    try:
        result = await db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE content_translated IS NULL AND content IS NOT NULL) as pending,
                COUNT(*) FILTER (WHERE content_translated IS NOT NULL) as completed,
                COUNT(*) as total
            FROM messages
            WHERE created_at > NOW() - INTERVAL '24 hours'
        """))
        row = result.fetchone()

        pending = row[0] or 0
        completed = row[1] or 0
        total = row[2] or 0

        # OK if less than 10% pending translations
        pct_complete = (completed / total * 100) if total > 0 else 100
        ok = pending < 50 or pct_complete > 90

        return {
            "ok": ok,
            "pending": pending,
            "completed": completed,
            "total_24h": total,
            "percent_complete": round(pct_complete, 1),
            "description": f"{pending} pending" if pending > 0 else "all translated"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def check_media_status(db: AsyncSession) -> Dict[str, Any]:
    """Check media archival status."""
    try:
        result = await db.execute(text("""
            SELECT
                COUNT(*) FILTER (WHERE media_type IS NOT NULL AND media_archived = false) as not_archived,
                COUNT(*) FILTER (WHERE media_type IS NOT NULL AND media_archived = true) as archived,
                COUNT(*) FILTER (WHERE media_type IS NOT NULL) as total_with_media
            FROM messages
            WHERE created_at > NOW() - INTERVAL '24 hours'
        """))
        row = result.fetchone()

        not_archived = row[0] or 0
        archived = row[1] or 0
        total = row[2] or 0

        # OK if less than 5% media not archived
        pct_archived = (archived / total * 100) if total > 0 else 100
        ok = not_archived < 10 or pct_archived > 95

        return {
            "ok": ok,
            "missing": not_archived,
            "archived": archived,
            "total_with_media": total,
            "percent_archived": round(pct_archived, 1),
            "description": f"{not_archived} not archived" if not_archived > 0 else "all media archived"
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}






# =============================================================================
# Standalone versions that create their own DB sessions (for pipeline endpoint)
# =============================================================================


async def check_processing_status_standalone() -> Dict[str, Any]:
    """Check if messages are being processed (standalone version)."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(text("""
                SELECT
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour') as last_hour,
                    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '10 minutes') as last_10min,
                    MAX(created_at) as latest
                FROM messages
            """))
            row = result.fetchone()

            last_hour = row[0] or 0
            last_10min = row[1] or 0
            latest = row[2]

            if latest:
                age_seconds = (datetime.utcnow() - latest.replace(tzinfo=None)).total_seconds()
            else:
                age_seconds = 9999

            ok = last_10min > 0 and age_seconds < 600

            return {
                "ok": ok,
                "last_hour": last_hour,
                "last_10min": last_10min,
                "latest_age_seconds": int(age_seconds),
                "description": f"{last_hour} archived in last hour" if ok else "no recent processing"
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def check_translation_status_standalone() -> Dict[str, Any]:
    """Check translation backlog (standalone version)."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(text("""
                SELECT
                    COUNT(*) FILTER (WHERE content_translated IS NULL AND content IS NOT NULL) as pending,
                    COUNT(*) FILTER (WHERE content_translated IS NOT NULL) as completed,
                    COUNT(*) as total
                FROM messages
                WHERE created_at > NOW() - INTERVAL '24 hours'
            """))
            row = result.fetchone()

            pending = row[0] or 0
            completed = row[1] or 0
            total = row[2] or 0

            pct_complete = (completed / total * 100) if total > 0 else 100
            ok = pending < 50 or pct_complete > 90

            return {
                "ok": ok,
                "pending": pending,
                "completed": completed,
                "total_24h": total,
                "percent_complete": round(pct_complete, 1),
                "description": f"{pending} pending" if pending > 0 else "all translated"
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def check_media_status_standalone() -> Dict[str, Any]:
    """Check media archival status (standalone version)."""
    try:
        async with AsyncSessionLocal() as db:
            # Check messages with media_type that have entries in message_media junction
            result = await db.execute(text("""
                SELECT
                    COUNT(*) FILTER (WHERE m.media_type IS NOT NULL AND mm.media_file_id IS NULL) as not_archived,
                    COUNT(*) FILTER (WHERE m.media_type IS NOT NULL AND mm.media_file_id IS NOT NULL) as archived,
                    COUNT(*) FILTER (WHERE m.media_type IS NOT NULL) as total_with_media
                FROM messages m
                LEFT JOIN message_media mm ON m.id = mm.message_id
                WHERE m.created_at > NOW() - INTERVAL '24 hours'
            """))
            row = result.fetchone()

            not_archived = row[0] or 0
            archived = row[1] or 0
            total = row[2] or 0

            pct_archived = (archived / total * 100) if total > 0 else 100
            ok = not_archived < 10 or pct_archived > 95

            return {
                "ok": ok,
                "missing": not_archived,
                "archived": archived,
                "total_with_media": total,
                "percent_archived": round(pct_archived, 1),
                "description": f"{not_archived} not archived" if not_archived > 0 else "all media archived"
            }
    except Exception as e:
        return {"ok": False, "error": str(e)}


# =============================================================================
# Public Lookup Endpoints - No authentication required
# =============================================================================

@router.get("/topics")
async def get_topics(
    db: AsyncSession = Depends(get_db)
) -> List[Dict[str, Any]]:
    """
    Get all active message topics for filtering.

    Public endpoint - no authentication required.
    Used by search filters to populate topic dropdown.
    """
    result = await db.execute(text("""
        SELECT
            mt.id, mt.name, mt.label, mt.color, mt.description,
            COUNT(m.id) as message_count
        FROM message_topics mt
        LEFT JOIN messages m ON m.topic = mt.name
        WHERE mt.is_active = true
        GROUP BY mt.id, mt.name, mt.label, mt.color, mt.description, mt.sort_order
        ORDER BY mt.sort_order, mt.label
    """))

    return [
        {
            "id": row[0],
            "name": row[1],
            "label": row[2],
            "color": row[3],
            "description": row[4],
            "message_count": row[5] or 0
        }
        for row in result.fetchall()
    ]


@router.get("/categories")
async def get_categories(
    db: AsyncSession = Depends(get_db)
) -> List[Dict[str, Any]]:
    """
    Get all channel categories for filtering.

    Public endpoint - no authentication required.
    Used by search filters to populate category dropdown.
    """
    result = await db.execute(text("""
        SELECT
            cc.id, cc.name, cc.color, cc.description,
            COUNT(c.id) as channel_count
        FROM channel_categories cc
        LEFT JOIN channels c ON c.category_id = cc.id AND c.active = true
        GROUP BY cc.id, cc.name, cc.color, cc.description, cc.sort_order
        ORDER BY cc.sort_order, cc.name
    """))

    return [
        {
            "id": row[0],
            "name": row[1],
            "color": row[2],
            "description": row[3],
            "channel_count": row[4] or 0
        }
        for row in result.fetchall()
    ]


@router.get("/folders")
async def get_folders(
    db: AsyncSession = Depends(get_db)
) -> List[Dict[str, Any]]:
    """
    Get all unique Telegram folders with channel counts.

    Public endpoint - no authentication required.
    Telegram folders are used to organize monitored channels.
    """
    result = await db.execute(text("""
        SELECT
            folder,
            COUNT(*) as channel_count
        FROM channels
        WHERE folder IS NOT NULL AND active = true
        GROUP BY folder
        ORDER BY folder
    """))

    return [
        {
            "name": row[0],
            "channel_count": row[1] or 0
        }
        for row in result.fetchall()
    ]






