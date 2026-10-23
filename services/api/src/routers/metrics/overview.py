"""
Metrics Overview Endpoint (admin only)

GET /api/metrics/overview - High-level operational metrics from Prometheus.
Feeds the admin dashboard banner. Cached in Redis for 15 s (the scrape interval).
"""

import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, Response
from pydantic import BaseModel

from ...dependencies import AdminUser
from ...utils.cache import CacheTTL, get_or_compute, make_cache_key
from ...utils.prometheus import get_prometheus_client
from ...utils.prometheus_metrics import PrometheusMetrics as PM

router = APIRouter()

SERVICE_JOBS = ("listener", "processor", "api")
# The pipeline counts as active if something was archived within this window
ACTIVE_WINDOW_SECONDS = 900
ABSENT = -1.0  # sentinel default: metric has no series (yet)


class OverviewMetrics(BaseModel):
    timestamp: str
    pipeline_active: bool
    messages_per_second: float
    messages_archived_per_second: float
    queue_depth: int
    dlq_messages: int
    archive_age_seconds: float | None = None
    database_connections: int
    services_healthy: int
    services_total: int
    prometheus_available: bool
    cached: bool = False
    cache_ttl_seconds: int = CacheTTL.METRICS


def _empty_metrics() -> dict:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pipeline_active": False,
        "messages_per_second": 0,
        "messages_archived_per_second": 0,
        "queue_depth": 0,
        "dlq_messages": 0,
        "archive_age_seconds": None,
        "database_connections": 0,
        "services_healthy": 0,
        "services_total": 0,
        "prometheus_available": False,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


async def _fetch_overview_from_prometheus() -> dict:
    prom = get_prometheus_client()
    if not await prom.is_healthy():
        return _empty_metrics()

    scalars = await asyncio.gather(
        prom.get_scalar(PM.MESSAGES_PROCESSED_RATE, 0),
        prom.get_scalar(PM.MESSAGES_ARCHIVED_RATE, 0),
        prom.get_scalar(PM.QUEUE_DEPTH, 0),
        prom.get_scalar(PM.DLQ_MESSAGES, 0),
        prom.get_scalar(PM.ARCHIVE_AGE, ABSENT),
        prom.get_scalar(PM.DB_POOL_CHECKED_OUT, 0),
        *(prom.get_scalar(PM.up(job), 0) for job in SERVICE_JOBS),
    )
    processed, archived, queue, dlq, archive_age, db_conns, *ups = scalars
    has_age = archive_age >= 0

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pipeline_active": has_age and archive_age < ACTIVE_WINDOW_SECONDS,
        "messages_per_second": round(processed, 2),
        "messages_archived_per_second": round(archived, 2),
        "queue_depth": int(queue),
        "dlq_messages": int(dlq),
        "archive_age_seconds": round(archive_age, 1) if has_age else None,
        "database_connections": int(db_conns),
        "services_healthy": sum(1 for u in ups if u == 1),
        "services_total": len(SERVICE_JOBS),
        "prometheus_available": True,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


def set_metrics_headers(response: Response, was_cached: bool) -> None:
    """Admin data: never let shared caches keep it."""
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Cached"] = "true" if was_cached else "false"


@router.get("/overview", response_model=OverviewMetrics)
async def get_metrics_overview(response: Response, admin: AdminUser):
    """High-level pipeline metrics (admin only)."""
    data, was_cached = await get_or_compute(
        cache_key=make_cache_key("metrics", "overview"),
        compute_fn=_fetch_overview_from_prometheus,
        ttl_seconds=CacheTTL.METRICS,
    )
    if was_cached:
        data["cached"] = True
    set_metrics_headers(response, was_cached)
    return OverviewMetrics(**data)
