"""
Services Metrics Endpoint

GET /api/metrics/services - Per-service health and performance metrics
Shows status of all platform services from Prometheus.

Caching: Redis with 15s TTL
"""

import asyncio
import math
from fastapi import APIRouter, Response
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum

from ...utils.prometheus import get_prometheus_client
from ...utils.cache import get_or_compute, make_cache_key, CacheTTL

router = APIRouter()


class ServiceStatus(str, Enum):
    healthy = "healthy"
    degraded = "degraded"
    down = "down"
    unknown = "unknown"


class ServiceMetric(BaseModel):
    """Metrics for a single service."""
    name: str
    display_name: str
    status: ServiceStatus
    category: str  # core, enrichment, monitoring, infrastructure

    # Optional metrics (service-specific)
    requests_per_second: Optional[float] = None
    latency_ms: Optional[float] = None
    queue_depth: Optional[int] = None
    connections: Optional[int] = None
    memory_mb: Optional[float] = None
    error_rate: Optional[float] = None

    # Uptime
    up: bool = True


class ServicesMetrics(BaseModel):
    """All services metrics."""
    timestamp: str

    # Summary
    total_services: int
    healthy_count: int
    degraded_count: int
    down_count: int

    # Services by category
    services: List[ServiceMetric]

    # Metadata
    prometheus_available: bool
    cached: bool = False
    cache_ttl_seconds: int = 15


# Service definitions with their Prometheus metrics
SERVICE_DEFINITIONS = [
    # Core services
    {"name": "listener", "display": "Telegram Listener", "category": "core",
     "up_metric": "up{job='listener'}", "rate_metric": "tg:messages_processed:rate5m"},
    {"name": "processor", "display": "Processor Workers", "category": "core",
     "up_metric": "up{job='processor'}", "rate_metric": "tg:messages_archived:rate5m"},
    {"name": "api", "display": "REST API", "category": "core",
     "up_metric": "up{job='api'}", "rate_metric": "rate(tg_api_requests_total[5m])"},
    {"name": "frontend", "display": "Next.js Frontend", "category": "core",
     "up_metric": "up{job='frontend'}"},

    # Data stores
    {"name": "postgres", "display": "PostgreSQL", "category": "infrastructure",
     "up_metric": "pg_up", "conn_metric": "pg_stat_activity_count"},
    {"name": "redis", "display": "Redis", "category": "infrastructure",
     "up_metric": "redis_up", "mem_metric": "redis_memory_used_bytes"},
    {"name": "minio", "display": "MinIO Storage", "category": "infrastructure",
     "up_metric": "minio_cluster_health_status"},

    # Enrichment
    {"name": "enrichment", "display": "Enrichment Workers", "category": "enrichment",
     "up_metric": "up{job='enrichment'}", "queue_metric": "sum(enrichment_queue_depth)"},
    {"name": "ollama", "display": "Ollama LLM", "category": "enrichment",
     "up_metric": "up{job='ollama'}"},

    # Monitoring
    {"name": "prometheus", "display": "Prometheus", "category": "monitoring",
     "up_metric": "up{job='prometheus'}"},
    {"name": "grafana", "display": "Grafana", "category": "monitoring",
     "up_metric": "up{job='grafana'}"},
]


async def _async_none():
    """Return None as an async coroutine."""
    return None


def _empty_services_metrics() -> dict:
    """Return empty services metrics when Prometheus unavailable."""
    return {
        "timestamp": datetime.utcnow().isoformat(),
        "total_services": 0,
        "healthy_count": 0,
        "degraded_count": 0,
        "down_count": 0,
        "services": [],
        "prometheus_available": False,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


async def _fetch_services_metrics() -> dict:
    """Fetch per-service metrics from Prometheus."""
    prom = get_prometheus_client()

    if not await prom.is_healthy():
        return _empty_services_metrics()

    services = []
    healthy = 0
    degraded = 0
    down = 0

    for svc in SERVICE_DEFINITIONS:
        # Fetch metrics for this service
        up_metric = svc.get("up_metric")
        rate_metric = svc.get("rate_metric")
        queue_metric = svc.get("queue_metric")
        mem_metric = svc.get("mem_metric")
        conn_metric = svc.get("conn_metric")

        # Build queries - only for metrics that exist
        queries = [
            prom.get_scalar(up_metric, 0) if up_metric else _async_none(),
            prom.get_scalar(rate_metric, 0) if rate_metric else _async_none(),
            prom.get_scalar(queue_metric, 0) if queue_metric else _async_none(),
            prom.get_scalar(mem_metric, 0) if mem_metric else _async_none(),
            prom.get_scalar(conn_metric, 0) if conn_metric else _async_none(),
        ]

        results = await asyncio.gather(*queries, return_exceptions=True)

        def safe_val(idx):
            if idx >= len(results):
                return None
            v = results[idx]
            if isinstance(v, Exception):
                return None
            if isinstance(v, (int, float)):
                if math.isnan(v) or math.isinf(v):
                    return None
                return v
            return v

        is_up = safe_val(0)
        rate = safe_val(1)
        queue = safe_val(2)
        memory = safe_val(3)
        conns = safe_val(4)

        # Determine status
        if is_up is None or is_up == 0:
            status = ServiceStatus.unknown
        elif is_up == 1:
            status = ServiceStatus.healthy
        else:
            status = ServiceStatus.degraded

        # Special case: if we have queue depth, check for backpressure
        if queue is not None and queue > 1000:
            status = ServiceStatus.degraded

        if status == ServiceStatus.healthy:
            healthy += 1
        elif status == ServiceStatus.degraded:
            degraded += 1
        elif status == ServiceStatus.down:
            down += 1

        services.append({
            "name": svc["name"],
            "display_name": svc["display"],
            "status": status.value,
            "category": svc["category"],
            "requests_per_second": round(rate, 2) if rate else None,
            "queue_depth": int(queue) if queue else None,
            "memory_mb": round(memory / (1024 * 1024), 1) if memory else None,
            "connections": int(conns) if conns else None,
            "up": is_up == 1 if is_up is not None else False,
        })

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "total_services": len(services),
        "healthy_count": healthy,
        "degraded_count": degraded,
        "down_count": down,
        "services": services,
        "prometheus_available": True,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


@router.get("/services", response_model=ServicesMetrics)
async def get_services_metrics(response: Response):
    """
    Get per-service health and performance metrics.

    Returns status for all platform services including:
    - Core: listener, processor, api, frontend
    - Infrastructure: postgres, redis, minio
    - Enrichment: enrichment workers, ollama
    - Monitoring: prometheus, grafana

    Response is cached in Redis for 15 seconds.

    Use this endpoint for:
    - Service health dashboards
    - Infrastructure monitoring
    - Alerting on service status
    """
    cache_key = make_cache_key("metrics", "services")

    data, was_cached = await get_or_compute(
        cache_key=cache_key,
        compute_fn=_fetch_services_metrics,
        ttl_seconds=CacheTTL.METRICS,
    )

    if was_cached:
        data["cached"] = True

    response.headers["Cache-Control"] = f"public, max-age={CacheTTL.METRICS}"
    response.headers["X-Cache-TTL"] = str(CacheTTL.METRICS)
    response.headers["X-Cached"] = "true" if was_cached else "false"

    return ServicesMetrics(**data)
