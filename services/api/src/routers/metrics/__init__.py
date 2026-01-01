"""
Metrics API Router (tg-archiver - No AI)

Operational Metrics - Real-time metrics from Prometheus
Used for monitoring dashboards, alerting, and the About page architecture view.

Performance target: <50ms (Prometheus-backed, in-memory)
Caching: Redis with 15s TTL

Endpoints:
- /api/metrics/overview - High-level platform stats
- /api/metrics/pipeline - Pipeline stages for architecture diagram
- /api/metrics/services - Per-service health and performance

NOTE: LLM metrics removed (no AI in tg-archiver)
"""

from fastapi import APIRouter

from .overview import router as overview_router
from .pipeline import router as pipeline_router
from .services import router as services_router

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

# Include sub-routers (LLM router removed)
router.include_router(overview_router)
router.include_router(pipeline_router)
router.include_router(services_router)

__all__ = ["router"]
