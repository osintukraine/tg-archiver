"""
Pipeline Metrics Endpoint (admin only)

GET /api/metrics/pipeline - one entry per pipeline stage (listener, queue,
processor, postgres, api) built from raw Prometheus queries.
"""

import asyncio
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from fastapi import APIRouter, Response
from pydantic import BaseModel

from ...dependencies import AdminUser
from ...utils.cache import CacheTTL, get_or_compute, make_cache_key
from ...utils.prometheus import get_prometheus_client
from ...utils.prometheus_metrics import PrometheusMetrics as PM
from .overview import ABSENT, ACTIVE_WINDOW_SECONDS, set_metrics_headers

router = APIRouter()

QUEUE_DEGRADED_DEPTH = 1000


class ServiceStatus(str, Enum):
    healthy = "healthy"
    degraded = "degraded"
    down = "down"
    unknown = "unknown"


class PipelineStage(BaseModel):
    id: str
    name: str
    status: ServiceStatus
    throughput: float  # messages/sec or requests/sec
    queue_depth: int | None = None
    latency_ms: float | None = None
    details: dict[str, Any] | None = None


class PipelineMetrics(BaseModel):
    timestamp: str
    pipeline_active: bool
    overall_status: ServiceStatus
    stages: list[PipelineStage]
    kpi: dict[str, Any]
    prometheus_available: bool
    cached: bool = False
    cache_ttl_seconds: int = CacheTTL.METRICS


def _freshness_status(age: float) -> ServiceStatus:
    """Status from seconds since the last message (ABSENT = never seen)."""
    if age < 0:
        return ServiceStatus.unknown
    return ServiceStatus.healthy if age < ACTIVE_WINDOW_SECONDS else ServiceStatus.degraded


def _up_status(up: float) -> ServiceStatus:
    if up == ABSENT:
        return ServiceStatus.unknown
    return ServiceStatus.healthy if up == 1 else ServiceStatus.down


def _stage_status(up: float, age: float) -> ServiceStatus:
    """A target that is up is judged by how fresh its data is; otherwise by `up`."""
    return _freshness_status(age) if up == 1 else _up_status(up)


def _overall(statuses: list[ServiceStatus]) -> ServiceStatus:
    for level in (ServiceStatus.down, ServiceStatus.degraded, ServiceStatus.unknown):
        if level in statuses:
            return level
    return ServiceStatus.healthy


def _empty_pipeline_dict() -> dict:
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pipeline_active": False,
        "overall_status": ServiceStatus.unknown.value,
        "stages": [],
        "kpi": {},
        "prometheus_available": False,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


def _ms(seconds: float) -> float | None:
    return round(seconds * 1000, 1) if seconds > 0 else None


def _age(seconds: float) -> float | None:
    return round(seconds, 1) if seconds >= 0 else None


def _stage(id_: str, name: str, status: ServiceStatus, throughput: float, **extra: Any) -> dict:
    return {"id": id_, "name": name, "status": status.value,
            "throughput": round(throughput, 2), **extra}


async def _fetch_pipeline_from_prometheus() -> dict:
    prom = get_prometheus_client()
    if not await prom.is_healthy():
        return _empty_pipeline_dict()

    (received, archived, queue, dlq, listener_age, archive_age, proc_p95,
     api_rate, api_p95, db_conns, listener_up, processor_up, api_up) = await asyncio.gather(
        prom.get_scalar(PM.MESSAGES_RECEIVED_RATE, 0),
        prom.get_scalar(PM.MESSAGES_ARCHIVED_RATE, 0),
        prom.get_scalar(PM.QUEUE_DEPTH, 0),
        prom.get_scalar(PM.DLQ_MESSAGES, 0),
        prom.get_scalar(PM.LISTENER_AGE, ABSENT),
        prom.get_scalar(PM.ARCHIVE_AGE, ABSENT),
        prom.get_scalar(PM.PROCESSING_P95, 0),
        prom.get_scalar(PM.API_REQUESTS_RATE, 0),
        prom.get_scalar(PM.API_P95, 0),
        prom.get_scalar(PM.DB_POOL_CHECKED_OUT, ABSENT),
        prom.get_scalar(PM.up("listener"), ABSENT),
        prom.get_scalar(PM.up("processor"), ABSENT),
        prom.get_scalar(PM.up("api"), ABSENT),
    )

    queue_status = ServiceStatus.degraded if queue > QUEUE_DEGRADED_DEPTH else ServiceStatus.healthy
    db_status = ServiceStatus.unknown if db_conns == ABSENT else ServiceStatus.healthy
    stages = [
        _stage("listener", "Telegram Listener", _stage_status(listener_up, listener_age), received,
               details={"seconds_since_last_message": _age(listener_age)}),
        _stage("redis-queue", "Redis Streams", queue_status, received,
               queue_depth=int(queue), details={"backlog": int(queue), "dlq": int(dlq)}),
        _stage("processor", "Processor", _stage_status(processor_up, archive_age), archived,
               latency_ms=_ms(proc_p95), details={"seconds_since_last_archive": _age(archive_age)}),
        _stage("postgres", "PostgreSQL", db_status, archived,
               details={"api_pool_checked_out": None if db_conns == ABSENT else int(db_conns)}),
        _stage("api", "REST API", _up_status(api_up), api_rate, latency_ms=_ms(api_p95),
               details={"requests_per_second": round(api_rate, 2)}),
    ]

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pipeline_active": 0 <= archive_age < ACTIVE_WINDOW_SECONDS,
        "overall_status": _overall([ServiceStatus(s["status"]) for s in stages]).value,
        "stages": stages,
        "kpi": {
            "messages_per_second": round(received, 2),
            "archive_rate": round(archived, 2),
            "queue_depth": int(queue),
            "dlq_messages": int(dlq),
        },
        "prometheus_available": True,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


@router.get("/pipeline", response_model=PipelineMetrics)
async def get_pipeline_metrics(response: Response, admin: AdminUser):
    """Per-stage pipeline health and throughput (admin only)."""
    data, was_cached = await get_or_compute(
        cache_key=make_cache_key("metrics", "pipeline"),
        compute_fn=_fetch_pipeline_from_prometheus,
        ttl_seconds=CacheTTL.METRICS,
    )
    if was_cached:
        data["cached"] = True
    set_metrics_headers(response, was_cached)
    return PipelineMetrics(**data)
