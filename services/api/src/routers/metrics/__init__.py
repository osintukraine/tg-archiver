"""
Metrics API Router (admin only)

Operational metrics read from Prometheus (raw PromQL over the metrics the
services export; see utils/prometheus_metrics.py). Redis-cached for 15 s.

- /api/metrics/overview - headline numbers (admin dashboard banner)
- /api/metrics/pipeline - per-stage health
- /api/metrics/services - listener / processor / api up and throughput

Without a reachable Prometheus every endpoint answers prometheus_available=false.
"""

from fastapi import APIRouter

from .overview import router as overview_router
from .pipeline import router as pipeline_router
from .services import router as services_router

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

router.include_router(overview_router)
router.include_router(pipeline_router)
router.include_router(services_router)

__all__ = ["router"]
