"""tg_rss_* and tg_search_* metrics. Self-contained: fake DB session, no real Postgres/Redis."""

import os
from types import SimpleNamespace

for _k, _v in {
    "POSTGRES_PASSWORD": "x",
    "REDIS_PASSWORD": "",
    "MINIO_ENDPOINT": "x:1",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
    "JWT_SECRET_KEY": "x" * 48,
}.items():
    os.environ.setdefault(_k, _v)

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from observability import metrics  # noqa: E402
from prometheus_client import REGISTRY  # noqa: E402

from src.auth.feed_auth import FeedAuthResult, verify_feed_token  # noqa: E402
from src.database import get_db  # noqa: E402
from src.routers import rss  # noqa: E402


def sample(name, **labels):
    return REGISTRY.get_sample_value(name, labels) or 0


class FakeResult:
    channel = SimpleNamespace(id=1, name="Chan", description="d", username="chan")

    def scalar_one_or_none(self):
        return self.channel

    def scalars(self):
        return self

    def unique(self):
        return self

    def all(self):
        return []


class NoChannelResult(FakeResult):
    channel = None


def fake_db(result):
    class Db:
        async def execute(self, *_a, **_k):
            return result

    return Db()


@pytest_asyncio.fixture
async def app(monkeypatch):
    async def no_override(key, session_factory=None):
        return None

    monkeypatch.setattr(rss, "get_override", no_override)
    app = FastAPI()
    app.include_router(rss.router)
    app.dependency_overrides[get_db] = lambda: fake_db(FakeResult())
    app.dependency_overrides[verify_feed_token] = lambda: FeedAuthResult(authenticated=False)
    return app


@pytest_asyncio.fixture
async def http(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.parametrize(
    "path,fmt,kind",
    [
        ("/api/rss/search?q=x", "rss", "search"),
        ("/api/rss/search?format=json", "json", "search"),
        ("/api/rss/channel/chan?format=atom", "atom", "channel"),
        ("/api/rss/topic/news", "rss", "topic"),
    ],
)
async def test_feed_generation_is_counted_by_format_and_kind(http, path, fmt, kind):
    labels = {"format": fmt, "kind": kind}
    count = sample("tg_rss_feeds_generated_total", **labels)
    observed = sample("tg_rss_generation_duration_seconds_count", **labels)

    resp = await http.get(path)

    assert resp.status_code == 200, resp.text
    assert sample("tg_rss_feeds_generated_total", **labels) == count + 1
    assert sample("tg_rss_generation_duration_seconds_count", **labels) == observed + 1


async def test_unknown_channel_is_not_counted(app, http):
    app.dependency_overrides[get_db] = lambda: fake_db(NoChannelResult())
    before = sample("tg_rss_feeds_generated_total", format="rss", kind="channel")

    assert (await http.get("/api/rss/channel/nope")).status_code == 404
    assert sample("tg_rss_feeds_generated_total", format="rss", kind="channel") == before


def test_search_operation_ok_records_result_size():
    ops = sample("tg_search_operations_total", kind="fulltext", status="ok")
    obs = sample("tg_search_results_count_count")
    total = sample("tg_search_results_count_sum")

    metrics.record_search_operation("fulltext", "ok", 7)

    assert sample("tg_search_operations_total", kind="fulltext", status="ok") == ops + 1
    assert sample("tg_search_results_count_count") == obs + 1
    assert sample("tg_search_results_count_sum") == total + 7


def test_search_operation_error_records_no_result_size():
    obs = sample("tg_search_results_count_count")
    errors = sample("tg_search_operations_total", kind="filters", status="error")

    metrics.record_search_operation("filters", "error")

    assert sample("tg_search_operations_total", kind="filters", status="error") == errors + 1
    assert sample("tg_search_results_count_count") == obs
