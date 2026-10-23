"""/api/metrics/* : admin-only, PromQL only over exported metrics, graceful without Prometheus.

Self-contained: no shared conftest, no real Prometheus/Redis (fake client, cache bypassed).
"""

import os
import re

import pytest
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

for _k, _v in {
    "JWT_SECRET_KEY": "x" * 48,
    "REDIS_PASSWORD": "x",
    "POSTGRES_PASSWORD": "x",
    "MINIO_ENDPOINT": "x:9000",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

from observability import metrics as shared_metrics  # noqa: E402,F401  (registers tg_* metrics)
from prometheus_client import REGISTRY  # noqa: E402

from src.auth.models import AuthUser  # noqa: E402
from src.routers.metrics import overview, pipeline, router, services  # noqa: E402
from src.utils import cache  # noqa: E402
from src.utils import db_metrics  # noqa: E402,F401  (registers db_pool_*)
from src.utils.prometheus_metrics import PrometheusMetrics as PM  # noqa: E402

ENDPOINTS = ["/api/metrics/overview", "/api/metrics/pipeline", "/api/metrics/services"]
ROLES = {
    "viewer": AuthUser(user_id=1, username="v", roles=["viewer"], is_authenticated=True),
    "admin": AuthUser(user_id=2, username="a", roles=["admin"], is_authenticated=True),
}

# Exported outside the shared registry: listener (services/listener/src/metrics.py), api
# (src/main.py) and Prometheus itself. Keep in sync when those change.
EXTERNAL_METRICS = {
    "telegram_messages_received_total",
    "telegram_last_message_timestamp",
    "api_requests_total",
    "api_request_duration_seconds_bucket",
    "up",
}


class FakePrometheus:
    """Answers each PromQL string from `values`; anything else counts as 'no series'."""

    def __init__(self, values=None, healthy=True):
        self.values = values or {}
        self.healthy = healthy
        self.asked = []

    async def is_healthy(self):
        return self.healthy

    async def get_scalar(self, promql, default=0.0):
        self.asked.append(promql)
        return self.values.get(promql, default)

    async def query(self, promql):
        self.asked.append(promql)
        if promql in self.values:
            return [{"metric": {}, "value": [0, str(self.values[promql])]}]
        return []


@pytest.fixture
def app(monkeypatch):
    async def no_cache(key):
        return None

    async def no_store(key, value, ttl):
        return True

    monkeypatch.setattr(cache, "get_cached", no_cache)
    monkeypatch.setattr(cache, "set_cached", no_store)

    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        request.state.user = ROLES.get(request.headers.get("X-Test-Role"), AuthUser())
        return await call_next(request)

    app.include_router(router)
    return app


def use_prometheus(monkeypatch, fake):
    for module in (overview, pipeline, services):
        monkeypatch.setattr(module, "get_prometheus_client", lambda fake=fake: fake)


async def get(app, path, role="admin"):
    headers = {"X-Test-Role": role} if role else {}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        return await c.get(path, headers=headers)


@pytest.mark.parametrize("path", ENDPOINTS)
@pytest.mark.parametrize(("role", "status"), [(None, 401), ("viewer", 403)])
async def test_requires_admin(app, path, role, status):
    assert (await get(app, path, role)).status_code == status


@pytest.mark.parametrize("path", ENDPOINTS)
async def test_prometheus_unavailable_is_graceful(app, monkeypatch, path):
    use_prometheus(monkeypatch, FakePrometheus(healthy=False))
    resp = await get(app, path)
    assert resp.status_code == 200
    assert resp.json()["prometheus_available"] is False
    assert resp.headers["cache-control"] == "private, no-store"


async def test_overview_values(app, monkeypatch):
    fake = FakePrometheus({
        PM.MESSAGES_PROCESSED_RATE: 1.234,
        PM.MESSAGES_ARCHIVED_RATE: 1.2,
        PM.QUEUE_DEPTH: 7,
        PM.DLQ_MESSAGES: 2,
        PM.ARCHIVE_AGE: 30,
        PM.up("listener"): 1,
        PM.up("processor"): 1,
        PM.up("api"): 0,
    })
    use_prometheus(monkeypatch, fake)
    data = (await get(app, "/api/metrics/overview")).json()
    assert data["prometheus_available"] is True
    assert data["pipeline_active"] is True
    assert (data["messages_per_second"], data["queue_depth"], data["dlq_messages"]) == (1.23, 7, 2)
    assert (data["services_healthy"], data["services_total"]) == (2, 3)


async def test_overview_idle_without_recent_archive(app, monkeypatch):
    use_prometheus(monkeypatch, FakePrometheus({PM.ARCHIVE_AGE: 5000}))
    assert (await get(app, "/api/metrics/overview")).json()["pipeline_active"] is False
    use_prometheus(monkeypatch, FakePrometheus())  # no series at all
    data = (await get(app, "/api/metrics/overview")).json()
    assert data["pipeline_active"] is False
    assert data["archive_age_seconds"] is None


async def test_services_up_zero_is_down_and_missing_is_unknown(app, monkeypatch):
    use_prometheus(monkeypatch, FakePrometheus({PM.up("listener"): 1, PM.up("processor"): 0}))
    data = (await get(app, "/api/metrics/services")).json()
    assert {s["name"]: s["status"] for s in data["services"]} == {
        "listener": "healthy",
        "processor": "down",
        "api": "unknown",
    }
    assert (data["healthy_count"], data["down_count"]) == (1, 1)


async def test_pipeline_stages(app, monkeypatch):
    use_prometheus(monkeypatch, FakePrometheus({
        PM.up("listener"): 1, PM.up("processor"): 1, PM.up("api"): 1,
        PM.LISTENER_AGE: 10, PM.ARCHIVE_AGE: 20, PM.QUEUE_DEPTH: 5, PM.DB_POOL_CHECKED_OUT: 1,
    }))
    data = (await get(app, "/api/metrics/pipeline")).json()
    assert [s["id"] for s in data["stages"]] == ["listener", "redis-queue", "processor", "postgres", "api"]
    assert data["overall_status"] == "healthy"
    assert data["pipeline_active"] is True


def _promql_constants():
    return {n: v for n, v in vars(PM).items() if isinstance(v, str) and not n.startswith("_")}


def test_promql_uses_only_exported_metrics():
    exported = {name for name in REGISTRY._names_to_collectors} | EXTERNAL_METRICS
    for const, promql in _promql_constants().items():
        names = re.findall(r"\b((?:tg|telegram|api|db_pool|up)[a-z_]*)\b", promql)
        assert names, const
        for name in names:
            assert name in exported, f"{const} uses unknown metric {name}"
    # parametrised builder
    assert PM.up("listener") == "up{job='listener'}"


def test_promql_quantile_sums_buckets_by_le():
    for promql in (PM.PROCESSING_P95, PM.API_P95):
        assert "sum by (le) (rate(" in promql


def test_removed_osint_names_stay_gone():
    text = " ".join(_promql_constants().values())
    for gone in ("tg:", "enrichment", "llm", "ollama", "tg_api_requests", "tg_database_connections"):
        assert gone not in text
