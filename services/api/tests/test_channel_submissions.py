"""
POST /api/channel-submissions (public) and GET /api/admin/channel-submissions.

Runs against a real PostgreSQL (init.sql + migrations through 006, POSTGRES_*
env vars). Redis is not needed (rate limiter is stubbed here; the limiter
itself is covered elsewhere). Self-contained: no shared conftest.

Run: python -m pytest tests/test_channel_submissions.py -c tests/pytest-approval.ini
"""

from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from sqlalchemy import text

from models.base import AsyncSessionLocal, engine
from src.auth.models import AuthUser
from src.middleware.csrf import CSRFMiddleware
from src.routers import channel_submissions as mod
from src.routers.channel_submissions import normalize_channel_link, router

pytestmark = pytest.mark.asyncio(loop_scope="module")

ADMIN = AuthUser(user_id=1, username="admin", roles=["admin"],
                 is_authenticated=True, auth_method="jwt")
GOOD = {
    "channel_link": "t.me/some_channel",
    "channel_name": "Some Channel",
    "source_origin": "ua",
    "reason": "Primary source of frontline reports",
    "value_description": "Timely",
    "turnstile_token": "",
}


def build_app(with_csrf: bool = False) -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        is_admin = request.headers.get("x-test-role") == "admin"
        request.state.user = ADMIN if is_admin else AuthUser()
        return await call_next(request)

    if with_csrf:
        app.add_middleware(CSRFMiddleware)
    app.include_router(router)
    return app


@pytest_asyncio.fixture(loop_scope="module")
async def http():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=build_app()), base_url="http://test"
    ) as c:
        yield c


@pytest_asyncio.fixture(loop_scope="module", autouse=True)
async def clean_db():
    # other test modules run on other event loops; drop their pooled connections
    engine.sync_engine.dispose(close=False)
    async with AsyncSessionLocal() as s:
        await s.execute(text("TRUNCATE channel_submissions RESTART IDENTITY"))
        await s.commit()


@pytest.fixture(autouse=True)
def no_rate_limit(monkeypatch):
    class Allow:
        async def check_rate_limit(self, **kw):
            return True, SimpleNamespace(limit=1, remaining=1, reset_at=0, retry_after=0)

    monkeypatch.setattr("src.utils.rate_limit.get_rate_limiter", lambda: Allow())
    monkeypatch.delenv("TURNSTILE_SECRET_KEY", raising=False)


@pytest.mark.parametrize("raw,expected", [
    ("@some_channel", "@some_channel"),
    ("some_channel", "@some_channel"),
    ("https://t.me/some_channel", "@some_channel"),
    ("telegram.me/some_channel", "@some_channel"),
    ("+AbCdEf123456", "+AbCdEf123456"),
    ("t.me/+AbCdEf123456", "+AbCdEf123456"),
])
async def test_normalize_valid(raw, expected):
    assert normalize_channel_link(raw) == expected


@pytest.mark.parametrize("raw", [
    "", "abc", "a" * 40, "1abcdef", "t.me/a/b", "t.me/some_channel?x=1",
    "javascript:alert(1)", "@bad name", "'; DROP TABLE channel_submissions;--",
    "https://evil.com/some_channel",
])
async def test_normalize_invalid(raw):
    with pytest.raises(ValueError):
        normalize_channel_link(raw)


async def test_happy_path_persists_normalized_row(http):
    r = await http.post("/api/channel-submissions", json=GOOD)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    async with AsyncSessionLocal() as s:
        row = (await s.execute(text(
            "SELECT channel_link, telegram_username, source_origin, status "
            "FROM channel_submissions WHERE id = :i"), {"i": body["id"]})).one()
    assert tuple(row) == ("@some_channel", "some_channel", "ua", "pending")


async def test_sql_metacharacters_are_stored_verbatim(http):
    payload = {**GOOD, "channel_name": "x'); DROP TABLE users;--"}
    r = await http.post("/api/channel-submissions", json=payload)
    assert r.status_code == 201
    async with AsyncSessionLocal() as s:
        name = (await s.execute(text(
            "SELECT channel_name FROM channel_submissions WHERE id = :i"),
            {"i": r.json()["id"]})).scalar_one()
    assert name == payload["channel_name"]


@pytest.mark.parametrize("patch", [
    {"channel_link": "not a link!"},
    {"channel_name": "   "},
    {"reason": "short"},
    {"reason": "x" * 2001},
    {"source_origin": "mars"},
    {"channel_name": "n" * 256},
    {"value_description": "v" * 2001},
])
async def test_invalid_input_rejected(http, patch):
    r = await http.post("/api/channel-submissions", json={**GOOD, **patch})
    assert r.status_code == 422


async def test_turnstile_required_when_secret_configured(http, monkeypatch):
    monkeypatch.setenv("TURNSTILE_SECRET_KEY", "secret")
    r = await http.post("/api/channel-submissions", json=GOOD)
    assert r.status_code == 400

    class FakeClient:
        def __init__(self, *a, **k): ...
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False

        async def post(self, url, data):
            assert data["response"] == "tok"
            return httpx.Response(200, json={"success": True})

    monkeypatch.setattr(mod.httpx, "AsyncClient", FakeClient)
    r = await http.post("/api/channel-submissions", json={**GOOD, "turnstile_token": "tok"})
    assert r.status_code == 201


async def test_csrf_enforced_on_submission():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=build_app(with_csrf=True)), base_url="http://test"
    ) as c:
        assert (await c.post("/api/channel-submissions", json=GOOD)).status_code == 403
        csrf = (await c.get("/api/admin/channel-submissions")).cookies.get("csrf_token")
        assert csrf
        r = await c.post("/api/channel-submissions", json=GOOD, headers={"X-CSRF-Token": csrf})
        assert r.status_code == 201


async def test_admin_list_requires_admin_and_returns_rows(http):
    await http.post("/api/channel-submissions", json=GOOD)
    assert (await http.get("/api/admin/channel-submissions")).status_code in (401, 403)
    r = await http.get("/api/admin/channel-submissions", headers={"x-test-role": "admin"})
    assert r.status_code == 200
    items = r.json()["items"]
    assert items and items[0]["channel_link"] == "@some_channel"
