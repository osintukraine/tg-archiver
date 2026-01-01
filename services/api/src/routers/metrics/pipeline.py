"""
Pipeline Metrics Endpoint

GET /api/metrics/pipeline - Real-time pipeline health for About page graph
Designed to power the interactive architecture visualization.

Caching: Redis with 15s TTL (matches Prometheus scrape interval)
"""

import asyncio
import math
from fastapi import APIRouter, Response
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
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


class PipelineStage(BaseModel):
    """Metrics for a single pipeline stage."""
    id: str
    name: str
    status: ServiceStatus
    throughput: float  # messages/sec or items/sec
    queue_depth: Optional[int] = None
    latency_ms: Optional[float] = None
    error_rate: Optional[float] = None
    last_activity: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class EnrichmentWorker(BaseModel):
    """Metrics for an enrichment worker."""
    task: str
    status: ServiceStatus
    queue_depth: int
    queue_lag_seconds: float
    processed_total: int
    errors_total: int
    last_cycle_duration_seconds: Optional[float] = None


class PipelineMetrics(BaseModel):
    """Complete pipeline metrics for the About page architecture view."""
    timestamp: str

    # Overall pipeline health
    pipeline_active: bool
    overall_status: ServiceStatus

    # Core pipeline stages (matches architecture diagram nodes)
    stages: List[PipelineStage]

    # Enrichment workers detail
    enrichment_workers: List[EnrichmentWorker]

    # Key performance indicators
    kpi: Dict[str, Any]

    # Metadata
    prometheus_available: bool
    cached: bool = False
    cache_ttl_seconds: int = 15


async def _fetch_pipeline_from_prometheus() -> dict:
    """Fetch pipeline metrics from Prometheus."""
    prom = get_prometheus_client()
    prom_healthy = await prom.is_healthy()

    if not prom_healthy:
        return _empty_pipeline_dict()

    # Fetch all metrics in parallel
    raw = await asyncio.gather(
        # Pipeline active
        prom.get_scalar("osint_pipeline_active", 0),

        # Listener metrics
        prom.get_scalar("osint:messages_processed:rate5m", 0),

        # Queue metrics
        prom.get_scalar("osint_queue_messages_pending", 0),
        prom.get_scalar("redis_queue_depth", 0),

        # Processor metrics
        prom.get_scalar("osint:messages_archived:rate5m", 0),
        prom.get_scalar("histogram_quantile(0.95, rate(osint_processing_duration_seconds_bucket[5m]))", 0),
        prom.get_scalar("osint_messages_spam_total", 0),
        prom.get_scalar("osint_messages_archived_total", 0),

        # Database
        prom.get_scalar("osint_database_connections_active", 0),

        # API
        prom.get_scalar("rate(api_requests_total[5m])", 0),
        prom.get_scalar("histogram_quantile(0.95, rate(api_request_duration_seconds_bucket[5m]))", 0),

        # Enrichment by task
        prom.query('enrichment_queue_depth'),
        prom.query('enrichment_queue_lag_seconds'),
        prom.query('enrichment_messages_processed_total'),
        prom.query('enrichment_errors_total'),
        prom.query('enrichment_task_status'),

        # LLM
        prom.get_scalar("osint:llm_requests:rate5m", 0),
        prom.get_scalar("osint:llm_response:avg_duration_seconds", 0),

        return_exceptions=True
    )

    def safe(idx, default=0):
        v = raw[idx]
        if isinstance(v, (int, float)):
            if math.isnan(v) or math.isinf(v):
                return default
            return v
        return default

    def safe_list(idx):
        v = raw[idx]
        return v if isinstance(v, list) else []

    # Build pipeline stages
    stages = []

    # 1. Telegram Listener
    listener_throughput = safe(1)
    stages.append({
        "id": "listener",
        "name": "Telegram Listener",
        "status": _status_from_throughput(listener_throughput, threshold=0.01).value,
        "throughput": round(listener_throughput, 2),
        "details": {"messages_per_second": round(listener_throughput, 2)}
    })

    # 2. Redis Queue
    queue_depth = int(safe(2)) or int(safe(3))
    stages.append({
        "id": "redis-queue",
        "name": "Redis Queue",
        "status": ServiceStatus.healthy.value if queue_depth < 1000 else ServiceStatus.degraded.value,
        "throughput": listener_throughput,
        "queue_depth": queue_depth,
        "details": {"pending_messages": queue_depth}
    })

    # 3. Processor Workers
    processor_throughput = safe(4)
    processor_latency = safe(5) * 1000
    stages.append({
        "id": "processor",
        "name": "Processor Workers",
        "status": _status_from_throughput(processor_throughput, threshold=0.01).value,
        "throughput": round(processor_throughput, 2),
        "latency_ms": round(processor_latency, 1) if processor_latency > 0 else None,
        "details": {
            "spam_total": int(safe(6)),
            "archived_total": int(safe(7))
        }
    })

    # 4. PostgreSQL
    db_connections = int(safe(8))
    stages.append({
        "id": "postgres",
        "name": "PostgreSQL",
        "status": ServiceStatus.healthy.value if db_connections > 0 else ServiceStatus.down.value,
        "throughput": processor_throughput,
        "details": {"active_connections": db_connections}
    })

    # 5. API Service
    api_rps = safe(9)
    api_latency = safe(10) * 1000
    stages.append({
        "id": "api",
        "name": "API Service",
        "status": ServiceStatus.healthy.value if api_rps >= 0 else ServiceStatus.unknown.value,
        "throughput": round(api_rps, 2),
        "latency_ms": round(api_latency, 1) if api_latency > 0 else None,
        "details": {"requests_per_second": round(api_rps, 2)}
    })

    # Build enrichment workers from vector results
    enrichment_workers = _build_enrichment_workers_dicts(
        queue_depths=safe_list(11),
        queue_lags=safe_list(12),
        processed=safe_list(13),
        errors=safe_list(14),
        status=safe_list(15)
    )

    # Add enrichment as a stage
    total_enrich_queue = sum(w["queue_depth"] for w in enrichment_workers)
    max_lag = max((w["queue_lag_seconds"] for w in enrichment_workers), default=0)
    enrich_status = ServiceStatus.healthy
    if max_lag > 300:
        enrich_status = ServiceStatus.degraded
    if max_lag > 3600:
        enrich_status = ServiceStatus.down

    stages.append({
        "id": "enrichment",
        "name": "Enrichment Pipeline",
        "status": enrich_status.value,
        "throughput": sum(w["processed_total"] for w in enrichment_workers) / 3600,
        "queue_depth": total_enrich_queue,
        "details": {
            "workers": len(enrichment_workers),
            "max_lag_seconds": round(max_lag, 1)
        }
    })

    # KPIs for the dashboard
    llm_rate = safe(16)
    llm_latency = safe(17)
    kpi = {
        "messages_per_second": round(listener_throughput, 2),
        "archive_rate": round(processor_throughput, 2),
        "total_queue_depth": queue_depth + total_enrich_queue,
        "llm_requests_per_minute": round(llm_rate * 60, 1),
        "llm_avg_latency_seconds": round(llm_latency, 2),
        "enrichment_lag_seconds": round(max_lag, 1),
    }

    # Determine overall status
    stage_statuses = [s["status"] for s in stages]
    if ServiceStatus.down.value in stage_statuses:
        overall = ServiceStatus.down.value
    elif ServiceStatus.degraded.value in stage_statuses:
        overall = ServiceStatus.degraded.value
    elif ServiceStatus.unknown.value in stage_statuses:
        overall = ServiceStatus.unknown.value
    else:
        overall = ServiceStatus.healthy.value

    return {
        "timestamp": datetime.utcnow().isoformat(),
        "pipeline_active": safe(0) > 0,
        "overall_status": overall,
        "stages": stages,
        "enrichment_workers": enrichment_workers,
        "kpi": kpi,
        "prometheus_available": True,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


@router.get("/pipeline", response_model=PipelineMetrics)
async def get_pipeline_metrics(response: Response):
    """
    Get real-time pipeline metrics for the About page architecture view.

    Returns metrics structured to match the pipeline diagram stages:
    - Telegram Listener (ingestion)
    - Redis Queue
    - Processor Workers
    - PostgreSQL Storage
    - Enrichment Workers (ai-tagging, telegram, rss-validation, etc.)
    - API Service

    Response is cached in Redis for 15 seconds (matches Prometheus scrape interval).

    Use this endpoint to:
    - Power live architecture diagrams
    - Show real-time throughput on pipeline edges
    - Indicate service health via node colors
    """
    cache_key = make_cache_key("metrics", "pipeline")

    # Get from cache or compute fresh
    data, was_cached = await get_or_compute(
        cache_key=cache_key,
        compute_fn=_fetch_pipeline_from_prometheus,
        ttl_seconds=CacheTTL.METRICS,
    )

    # Update cached flag
    if was_cached:
        data["cached"] = True

    # Set response headers
    response.headers["Cache-Control"] = f"public, max-age={CacheTTL.METRICS}"
    response.headers["X-Cache-TTL"] = str(CacheTTL.METRICS)
    response.headers["X-Cached"] = "true" if was_cached else "false"
    response.headers["X-Prometheus-Available"] = str(data.get("prometheus_available", False)).lower()

    return PipelineMetrics(**data)


def _status_from_throughput(throughput: float, threshold: float = 0.1) -> ServiceStatus:
    """Determine service status from throughput."""
    if throughput > threshold:
        return ServiceStatus.healthy
    elif throughput > 0:
        return ServiceStatus.degraded
    else:
        return ServiceStatus.unknown


def _build_enrichment_workers(
    queue_depths: list,
    queue_lags: list,
    processed: list,
    errors: list,
    status: list
) -> List[EnrichmentWorker]:
    """Build enrichment worker metrics from Prometheus vectors."""
    workers = {}

    # Extract by task label
    for item in queue_depths:
        task = item.get("metric", {}).get("task", "unknown")
        value = float(item.get("value", [0, 0])[1])
        if task not in workers:
            workers[task] = {"task": task, "queue_depth": 0, "queue_lag": 0, "processed": 0, "errors": 0}
        workers[task]["queue_depth"] = int(value)

    for item in queue_lags:
        task = item.get("metric", {}).get("task", "unknown")
        value = float(item.get("value", [0, 0])[1])
        if task in workers:
            workers[task]["queue_lag"] = value

    for item in processed:
        task = item.get("metric", {}).get("task", "unknown")
        value = float(item.get("value", [0, 0])[1])
        if task in workers:
            workers[task]["processed"] = int(value)

    for item in errors:
        task = item.get("metric", {}).get("task", "unknown")
        value = float(item.get("value", [0, 0])[1])
        if task in workers:
            workers[task]["errors"] = int(value)

    # Convert to EnrichmentWorker models
    result = []
    for task, data in workers.items():
        lag = data.get("queue_lag", 0)
        if lag > 3600:
            status = ServiceStatus.down
        elif lag > 300:
            status = ServiceStatus.degraded
        else:
            status = ServiceStatus.healthy

        result.append(EnrichmentWorker(
            task=task,
            status=status,
            queue_depth=data.get("queue_depth", 0),
            queue_lag_seconds=round(data.get("queue_lag", 0), 1),
            processed_total=data.get("processed", 0),
            errors_total=data.get("errors", 0),
        ))

    # Sort by task name
    result.sort(key=lambda w: w.task)
    return result


def _build_enrichment_workers_dicts(
    queue_depths: list,
    queue_lags: list,
    processed: list,
    errors: list,
    status: list
) -> List[dict]:
    """Build enrichment worker metrics as dicts (for JSON caching)."""
    workers = {}

    # Extract by task label
    for item in queue_depths:
        task = item.get("metric", {}).get("task", "unknown")
        value = float(item.get("value", [0, 0])[1])
        if task not in workers:
            workers[task] = {"task": task, "queue_depth": 0, "queue_lag": 0, "processed": 0, "errors": 0}
        workers[task]["queue_depth"] = int(value)

    for item in queue_lags:
        task = item.get("metric", {}).get("task", "unknown")
        value = float(item.get("value", [0, 0])[1])
        if task in workers:
            workers[task]["queue_lag"] = value

    for item in processed:
        task = item.get("metric", {}).get("task", "unknown")
        value = float(item.get("value", [0, 0])[1])
        if task in workers:
            workers[task]["processed"] = int(value)

    for item in errors:
        task = item.get("metric", {}).get("task", "unknown")
        value = float(item.get("value", [0, 0])[1])
        if task in workers:
            workers[task]["errors"] = int(value)

    # Convert to dicts
    result = []
    for task, data in workers.items():
        lag = data.get("queue_lag", 0)
        if lag > 3600:
            worker_status = ServiceStatus.down.value
        elif lag > 300:
            worker_status = ServiceStatus.degraded.value
        else:
            worker_status = ServiceStatus.healthy.value

        result.append({
            "task": task,
            "status": worker_status,
            "queue_depth": data.get("queue_depth", 0),
            "queue_lag_seconds": round(data.get("queue_lag", 0), 1),
            "processed_total": data.get("processed", 0),
            "errors_total": data.get("errors", 0),
        })

    # Sort by task name
    result.sort(key=lambda w: w["task"])
    return result


def _empty_pipeline_dict() -> dict:
    """Return empty pipeline dict when Prometheus unavailable."""
    return {
        "timestamp": datetime.utcnow().isoformat(),
        "pipeline_active": False,
        "overall_status": ServiceStatus.unknown.value,
        "stages": [],
        "enrichment_workers": [],
        "kpi": {},
        "prometheus_available": False,
        "cached": False,
        "cache_ttl_seconds": CacheTTL.METRICS,
    }


def _empty_pipeline_response() -> PipelineMetrics:
    """Return empty pipeline response when Prometheus unavailable."""
    return PipelineMetrics(**_empty_pipeline_dict())
