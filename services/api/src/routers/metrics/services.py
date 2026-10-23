"""
Services Metrics Endpoint (admin only)

GET /api/metrics/services - up/down and throughput of listener, processor, api.
"""

import asyncio
import math
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from fastapi import APIRouter, Response
from pydantic import BaseModel

from ...dependencies import AdminUser
from ...utils.cache import CacheTTL, get_or_compute, make_cache_key
from ...utils.prometheus import get_prometheus_client
from ...utils.prometheus_metrics import PrometheusMetrics as PM
from .overview import set_metrics_headers

router = APIRouter()

QUEUE_DEGRADED_DEPTH = 1000


class ServiceStatus(str, Enum):
    healthy = "healthy"
    degraded = "degraded"
    down = "down"
    unknown = "unknown"


class ServiceMetric(BaseModel):
    name: str
    display_name: str
    status: ServiceStatus
    requests_per_second: float | None = None  # messages/s for listener and processor
    queue_depth: int | None = None
    up: bool = False


class ServicesMetrics(BaseModel):
    timestamp: str
    total_services: int
    healthy_count: int
    degraded_count: int
    down_count: int
    services: list[ServiceMetric]
    prometheus_available: bool
    cached: bool = False
    cache_ttl_seconds: int = CacheTTL.METRICS


# Prometheus scrape job == service name
SERVICE_DEFINITIONS = [
    {"name": "listener", "display": "Telegram Listener", "rate_metric": PM.MESSAGES_RECEIVED_RATE},
    {"name": "processor", "display": "Processor", "rate_metric": PM.MESSAGES_ARCHIVED_RATE,
     "queue_metric": PM.QUEUE_DEPTH},
    {"name": "api", "display": "REST API", "rate_metric": PM.API_REQUESTS_RATE},
]


async def _absent() -> None:
    return None


def _safe_metric(results: list[Any], idx: int) -> Any:
    """Value at `idx` of gathered Prometheus results; None for missing, errors, NaN or inf."""
    if idx >= len(results):
        return None
    value = results[idx]
    if isinstance(value, Exception):
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def _empty_services_metrics() -> dict:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_services": 0,
        "healthy_count": 0,
        "degraded_count": 0,
        "down_count": 0,
        "services": [],
        "prometheus_available": False,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


def _service_status(up: float | None, queue: float | None) -> ServiceStatus:
    """No `up` series = unknown, up == 0 = down, deep backlog = degraded."""
    if up is None:
        return ServiceStatus.unknown
    if up == 0:
        return ServiceStatus.down
    if queue is not None and queue > QUEUE_DEGRADED_DEPTH:
        return ServiceStatus.degraded
    return ServiceStatus.healthy


async def _fetch_services_metrics() -> dict:
    prom = get_prometheus_client()
    if not await prom.is_healthy():
        return _empty_services_metrics()

    services = []
    for svc in SERVICE_DEFINITIONS:
        queue_metric = svc.get("queue_metric")
        results = await asyncio.gather(
            prom.query(PM.up(svc["name"])),
            prom.get_scalar(svc["rate_metric"], 0),
            prom.get_scalar(queue_metric, 0) if queue_metric else _absent(),
            return_exceptions=True,
        )
        up_series = results[0] if isinstance(results[0], list) else []
        up = float(up_series[0]["value"][1]) if up_series else None
        rate = _safe_metric(results, 1)
        queue = _safe_metric(results, 2)
        services.append({
            "name": svc["name"],
            "display_name": svc["display"],
            "status": _service_status(up, queue).value,
            "requests_per_second": round(rate, 2) if rate is not None else None,
            "queue_depth": int(queue) if queue is not None else None,
            "up": up == 1,
        })

    def count(status: ServiceStatus) -> int:
        return sum(1 for s in services if s["status"] == status.value)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "total_services": len(services),
        "healthy_count": count(ServiceStatus.healthy),
        "degraded_count": count(ServiceStatus.degraded),
        "down_count": count(ServiceStatus.down),
        "services": services,
        "prometheus_available": True,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


@router.get("/services", response_model=ServicesMetrics)
async def get_services_metrics(response: Response, admin: AdminUser):
    """Per-service health (listener, processor, api) from Prometheus `up` (admin only)."""
    data, was_cached = await get_or_compute(
        cache_key=make_cache_key("metrics", "services"),
        compute_fn=_fetch_services_metrics,
        ttl_seconds=CacheTTL.METRICS,
    )
    if was_cached:
        data["cached"] = True
    set_metrics_headers(response, was_cached)
    return ServicesMetrics(**data)
