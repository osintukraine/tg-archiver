"""
Metrics Overview Endpoint

GET /api/metrics/overview - High-level platform operational metrics
Fast endpoint for dashboards and monitoring.

Caching: Redis with 15s TTL (matches Prometheus scrape interval)
"""

import asyncio
import math
from fastapi import APIRouter, Response
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from ...utils.prometheus import get_prometheus_client
from ...utils.cache import get_or_compute, make_cache_key, CacheTTL
from ...utils.prometheus_metrics import PrometheusMetrics

router = APIRouter()


class ServiceHealth(BaseModel):
    """Health status of a single service."""
    name: str
    status: str  # healthy, degraded, down, unknown
    metric_value: Optional[float] = None


class OverviewMetrics(BaseModel):
    """High-level platform metrics summary."""
    timestamp: str

    # Pipeline throughput
    messages_per_second: float
    messages_archived_per_second: float
    messages_skipped_per_second: float

    # Queue health
    queue_depth: int
    enrichment_queue_depth: int
    queue_lag_seconds: float

    # LLM performance
    llm_requests_per_minute: float
    llm_avg_latency_seconds: float
    llm_success_rate_percent: float

    # Resource usage
    database_connections: int
    redis_memory_mb: float

    # Error rates
    enrichment_error_rate: float

    # Service health summary
    services_healthy: int
    services_total: int

    # Metadata
    prometheus_available: bool
    cached: bool = False
    cache_ttl_seconds: int = 15


def _empty_metrics(cached: bool = False) -> dict:
    """Return empty metrics when Prometheus unavailable."""
    return {
        "timestamp": datetime.utcnow().isoformat(),
        "messages_per_second": 0,
        "messages_archived_per_second": 0,
        "messages_skipped_per_second": 0,
        "queue_depth": 0,
        "enrichment_queue_depth": 0,
        "queue_lag_seconds": 0,
        "llm_requests_per_minute": 0,
        "llm_avg_latency_seconds": 0,
        "llm_success_rate_percent": 0,
        "database_connections": 0,
        "redis_memory_mb": 0,
        "enrichment_error_rate": 0,
        "services_healthy": 0,
        "services_total": 0,
        "prometheus_available": False,
        "cached": cached,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


async def _fetch_overview_from_prometheus() -> dict:
    """Fetch overview metrics from Prometheus."""
    prom = get_prometheus_client()

    # Check Prometheus availability
    prom_healthy = await prom.is_healthy()
    if not prom_healthy:
        return _empty_metrics()

    # Fetch all metrics in parallel for speed
    # Using centralized metric names for consistency and maintainability
    results = await asyncio.gather(
        # Throughput (using recording rules where available)
        prom.get_scalar(PrometheusMetrics.THROUGHPUT_MESSAGES_PROCESSED, 0),
        prom.get_scalar(PrometheusMetrics.THROUGHPUT_MESSAGES_ARCHIVED, 0),
        prom.get_scalar(PrometheusMetrics.THROUGHPUT_MESSAGES_SKIPPED, 0),

        # Queue metrics
        prom.get_scalar(PrometheusMetrics.QUEUE_MESSAGES_PENDING, 0),
        prom.get_scalar(PrometheusMetrics.QUEUE_ENRICHMENT_DEPTH, 0),
        prom.get_scalar(PrometheusMetrics.QUEUE_ENRICHMENT_LAG, 0),

        # LLM metrics
        prom.get_scalar(PrometheusMetrics.LLM_REQUESTS_RATE, 0),
        prom.get_scalar(PrometheusMetrics.LLM_AVG_LATENCY, 0),
        prom.get_scalar(PrometheusMetrics.LLM_SUCCESS_RATE, 100),

        # Resources
        prom.get_scalar(PrometheusMetrics.RESOURCE_DB_CONNECTIONS, 0),
        prom.get_scalar(PrometheusMetrics.RESOURCE_REDIS_MEMORY, 0),

        # Error rates
        prom.get_scalar(PrometheusMetrics.ERROR_ENRICHMENT_RATE, 0),

        return_exceptions=True
    )

    def safe_get(idx: int, default: float = 0) -> float:
        val = results[idx]
        if isinstance(val, (int, float)):
            if math.isnan(val) or math.isinf(val):
                return default
            return val
        return default

    messages_per_sec = safe_get(0)
    archived_per_sec = safe_get(1)
    skipped_per_sec = safe_get(2)
    queue_depth = int(safe_get(3))
    enrich_queue = int(safe_get(4))
    queue_lag = safe_get(5)
    llm_rate = safe_get(6)
    llm_latency = safe_get(7)
    llm_success = safe_get(8, 100)
    db_conns = int(safe_get(9))
    redis_mem = safe_get(10)
    error_rate = safe_get(11)

    # Calculate services health
    services_healthy = sum([
        1 if messages_per_sec > 0 or queue_depth >= 0 else 0,
        1 if enrich_queue >= 0 else 0,
        1 if db_conns > 0 else 0,
        1 if redis_mem > 0 else 0,
    ])

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "messages_per_second": round(messages_per_sec, 2),
        "messages_archived_per_second": round(archived_per_sec, 2),
        "messages_skipped_per_second": round(skipped_per_sec, 2),
        "queue_depth": queue_depth,
        "enrichment_queue_depth": enrich_queue,
        "queue_lag_seconds": round(queue_lag, 1),
        "llm_requests_per_minute": round(llm_rate * 60, 1),
        "llm_avg_latency_seconds": round(llm_latency, 2),
        "llm_success_rate_percent": round(llm_success, 1),
        "database_connections": db_conns,
        "redis_memory_mb": round(redis_mem / (1024 * 1024), 1),
        "enrichment_error_rate": round(error_rate, 4),
        "services_healthy": services_healthy,
        "services_total": 4,
        "prometheus_available": True,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


@router.get("/overview", response_model=OverviewMetrics)
async def get_metrics_overview(response: Response):
    """
    Get high-level platform operational metrics.

    Returns real-time metrics from Prometheus for dashboards and monitoring.
    Response is cached in Redis for 15 seconds (matches Prometheus scrape interval).

    Use this endpoint for:
    - Operational dashboards
    - Health monitoring
    - Capacity planning alerts
    """
    cache_key = make_cache_key("metrics", "overview")

    # Get from cache or compute fresh
    data, was_cached = await get_or_compute(
        cache_key=cache_key,
        compute_fn=_fetch_overview_from_prometheus,
        ttl_seconds=CacheTTL.METRICS,
    )

    # Update cached flag in response
    if was_cached:
        data["cached"] = True

    # Set response headers
    response.headers["Cache-Control"] = f"public, max-age={CacheTTL.METRICS}"
    response.headers["X-Cache-TTL"] = str(CacheTTL.METRICS)
    response.headers["X-Cached"] = "true" if was_cached else "false"
    response.headers["X-Prometheus-Available"] = str(data.get("prometheus_available", False)).lower()

    return OverviewMetrics(**data)
