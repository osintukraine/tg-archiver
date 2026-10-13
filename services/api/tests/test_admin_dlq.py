"""
Tests for /api/admin/dlq.

Uses a REAL Redis (TEST_REDIS_URL; the database is flushed). Auth is faked by a
tiny middleware reading X-Test-Role (none / user / admin) so the real
require_admin dependency is exercised.
"""

import json
import os

import pytest
import pytest_asyncio
import redis.asyncio as redis
from fastapi import FastAPI, Request
from httpx import ASGITransport, AsyncClient

# Settings are validated on import; provide dummies before importing src.*
for _k, _v in {
    "JWT_SECRET_KEY": "x" * 48,
    "REDIS_PASSWORD": "x",
    "POSTGRES_PASSWORD": "x",
    "MINIO_ENDPOINT": "x:9000",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

from src.auth.models import AuthUser  # noqa: E402
from src.database import get_db  # noqa: E402
from src.routers.admin import dlq as dlq_module  # noqa: E402

pytestmark = pytest.mark.asyncio

REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")
DLQ = dlq_module.DLQ_STREAM_KEY
RT = "telegram:messages:realtime"
PAYLOAD = {"message_id": "42", "channel_id": "7", "content": "hello"}

ROLES = {
    "user": AuthUser(user_id=1, username="u", roles=["viewer"], is_authenticated=True),
    "admin": AuthUser(user_id=2, username="a", roles=["admin"], is_authenticated=True),
}


@pytest_asyncio.fixture
async def r():
    client = redis.from_url(REDIS_URL, decode_responses=True)
    await client.flushdb()
    dlq_module._redis_client = client
    yield client
    dlq_module._redis_client = None
    await client.flushdb()
    await client.aclose()


@pytest_asyncio.fixture
async def http(r):
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        role = request.headers.get("X-Test-Role")
        request.state.user = ROLES.get(role, AuthUser())  # anonymous otherwise
        return await call_next(request)

    async def no_db():
        yield None

    app.dependency_overrides[get_db] = no_db
    app.include_router(dlq_module.router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c


ADMIN = {"X-Test-Role": "admin"}


async def add_entry(r, stream=RT, fields=PAYLOAD, **extra) -> str:
    entry = {
        "original_stream_id": "1-0",
        "original_stream": stream,
        "fields": json.dumps(fields),
        "error": "boom",
        "retry_count": "3",
        "failed_at": "2026-01-01T00:00:00+00:00",
        **extra,
    }
    return await r.xadd(DLQ, entry)


async def test_requires_admin(http, r):
    dlq_id = await add_entry(r)
    calls = [
        ("GET", "/api/admin/dlq"),
        ("POST", f"/api/admin/dlq/{dlq_id}/replay"),
        ("DELETE", f"/api/admin/dlq/{dlq_id}"),
    ]
    for method, url in calls:
        assert (await http.request(method, url)).status_code == 401
        resp = await http.request(method, url, headers={"X-Test-Role": "user"})
        assert resp.status_code == 403
    assert await r.xlen(DLQ) == 1


async def test_list_returns_summary_newest_first_with_cursor(http, r):
    ids = [await add_entry(r, fields={**PAYLOAD, "message_id": str(i)}) for i in range(3)]

    page1 = (await http.get("/api/admin/dlq?limit=2", headers=ADMIN)).json()
    assert page1["total"] == 3
    assert [i["dlq_id"] for i in page1["items"]] == [ids[2], ids[1]]
    assert page1["items"][0] == {
        "dlq_id": ids[2],
        "original_stream": RT,
        "original_stream_id": "1-0",
        "error": "boom",
        "retry_count": 3,
        "failed_at": "2026-01-01T00:00:00+00:00",
        "message_id": 2,
        "channel_id": 7,
        "replayable": True,
    }

    page2 = (await http.get(f"/api/admin/dlq?limit=2&before={page1['next_before']}", headers=ADMIN)).json()
    assert [i["dlq_id"] for i in page2["items"]] == [ids[0]]
    assert page2["next_before"] is None


async def test_list_validates_params_and_tolerates_old_format(http, r):
    old = await r.xadd(DLQ, {"original_stream_id": "1-0", "message_data": json.dumps({"message_id": 5}), "error": "e"})

    assert (await http.get("/api/admin/dlq?limit=501", headers=ADMIN)).status_code == 422
    assert (await http.get("/api/admin/dlq?before=junk", headers=ADMIN)).status_code == 422
    (item,) = (await http.get("/api/admin/dlq", headers=ADMIN)).json()["items"]
    assert item["dlq_id"] == old and item["message_id"] == 5
    assert item["replayable"] is False and item["original_stream"] is None


async def test_replay_requeues_original_payload_and_removes_entry(http, r):
    dlq_id = await add_entry(r)

    resp = await http.post(f"/api/admin/dlq/{dlq_id}/replay", headers=ADMIN)

    assert resp.status_code == 200
    body = resp.json()
    assert body["stream"] == RT
    ((new_id, fields),) = await r.xrange(RT)
    assert new_id == body["new_stream_id"] and fields == PAYLOAD
    assert await r.xlen(DLQ) == 0


async def test_replay_missing_entry_is_404(http, r):
    assert (await http.post("/api/admin/dlq/1-1/replay", headers=ADMIN)).status_code == 404


async def test_replay_old_format_is_409_and_keeps_entry(http, r):
    dlq_id = await r.xadd(DLQ, {"original_stream_id": "1-0", "message_data": "{}", "error": "e"})
    assert (await http.post(f"/api/admin/dlq/{dlq_id}/replay", headers=ADMIN)).status_code == 409
    assert await r.xlen(DLQ) == 1


@pytest.mark.parametrize("stream", ["evil:stream", "telegram:messages:dlq", ""])
async def test_replay_rejects_unknown_stream(http, r, stream):
    dlq_id = await add_entry(r, stream=stream)
    assert (await http.post(f"/api/admin/dlq/{dlq_id}/replay", headers=ADMIN)).status_code == 422
    assert await r.xlen(DLQ) == 1
    assert not await r.exists("evil:stream")


async def test_replay_rejects_malformed_id(http, r):
    assert (await http.post("/api/admin/dlq/not-an-id/replay", headers=ADMIN)).status_code == 422


async def test_delete_discards_entry(http, r):
    dlq_id = await add_entry(r)
    assert (await http.delete(f"/api/admin/dlq/{dlq_id}", headers=ADMIN)).status_code == 200
    assert await r.xlen(DLQ) == 0
    assert (await http.delete(f"/api/admin/dlq/{dlq_id}", headers=ADMIN)).status_code == 404
