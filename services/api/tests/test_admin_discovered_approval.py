"""
Approve / unapprove endpoints of /api/admin/discovered.

Runs against a real PostgreSQL (init.sql + migrations 003 + 004 applied,
POSTGRES_* env vars). Self-contained: no shared conftest.

Run (inside the api image, see commit message):
    python -m pytest tests/test_admin_discovered_approval.py -c tests/pytest-approval.ini
"""

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, Request
from sqlalchemy import text

from config.settings import settings
from models.base import AsyncSessionLocal
from src.auth.models import AuthUser
from src.routers.admin.discovered import router

pytestmark = pytest.mark.asyncio(loop_scope="module")

ADMIN = AuthUser(user_id=1, username="admin", roles=["admin"],
                 is_authenticated=True, auth_method="jwt")
VIEWER = AuthUser(user_id=2, username="viewer", roles=["viewer"],
                  is_authenticated=True, auth_method="jwt")


def build_app() -> FastAPI:
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        role = request.headers.get("x-test-role", "anonymous")
        request.state.user = {"admin": ADMIN, "viewer": VIEWER}.get(role, AuthUser())
        return await call_next(request)

    app.include_router(router)
    return app


@pytest_asyncio.fixture(loop_scope="module")
async def http():
    transport = httpx.ASGITransport(app=build_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(loop_scope="module", autouse=True)
async def clean_db():
    async with AsyncSessionLocal() as s:
        await s.execute(text("TRUNCATE discovered_channels RESTART IDENTITY CASCADE"))
        await s.execute(text("DELETE FROM users WHERE id IN (1, 2)"))
        await s.execute(text("""
            INSERT INTO users (id, username, email, hashed_password)
            VALUES (1, 'admin', 'admin@example.test', 'x')
        """))
        await s.commit()


async def insert(telegram_id: int, join_status="pending", admin_action=None) -> int:
    async with AsyncSessionLocal() as s:
        row = await s.execute(text("""
            INSERT INTO discovered_channels (telegram_id, join_status, admin_action)
            VALUES (:t, :s, :a) RETURNING id
        """), {"t": telegram_id, "s": join_status, "a": admin_action})
        await s.commit()
        return row.scalar_one()


async def fetch(db_id: int) -> dict:
    async with AsyncSessionLocal() as s:
        row = await s.execute(
            text("SELECT * FROM discovered_channels WHERE id = :i"), {"i": db_id}
        )
        return dict(row.one()._mapping)


ADMIN_H = {"x-test-role": "admin"}


@pytest.mark.parametrize("action", ["approve", "unapprove"])
@pytest.mark.parametrize("role,code", [("anonymous", 401), ("viewer", 403)])
async def test_admin_only(http, action, role, code):
    db_id = await insert(100)
    resp = await http.post(f"/api/admin/discovered/{db_id}/{action}",
                           headers={"x-test-role": role})
    assert resp.status_code == code
    assert (await fetch(db_id))["join_approved_at"] is None


@pytest.mark.parametrize("action", ["approve", "unapprove"])
async def test_missing_channel_is_404(http, action):
    resp = await http.post(f"/api/admin/discovered/99999/{action}", headers=ADMIN_H)
    assert resp.status_code == 404


async def test_approve_pending_then_unapprove(http):
    db_id = await insert(101)
    resp = await http.post(f"/api/admin/discovered/{db_id}/approve", headers=ADMIN_H)
    assert resp.status_code == 200
    row = await fetch(db_id)
    assert row["join_approved_at"] is not None and row["join_approved_by"] == 1
    assert row["join_status"] == "pending" and row["admin_action"] is None

    resp = await http.post(f"/api/admin/discovered/{db_id}/unapprove", headers=ADMIN_H)
    assert resp.status_code == 200
    row = await fetch(db_id)
    assert row["join_approved_at"] is None and row["join_approved_by"] is None


async def test_approve_failed_resets_to_eligible(http):
    db_id = await insert(102, join_status="failed")
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            UPDATE discovered_channels
            SET join_retry_count = 3, join_retry_after = NOW() + interval '1 day',
                join_error = 'boom'
            WHERE id = :i
        """), {"i": db_id})
        await s.commit()

    resp = await http.post(f"/api/admin/discovered/{db_id}/approve", headers=ADMIN_H)
    assert resp.status_code == 200
    row = await fetch(db_id)
    assert row["join_status"] == "pending"
    assert row["join_retry_count"] == 0
    assert row["join_retry_after"] is None and row["join_error"] is None


@pytest.mark.parametrize("tid,status,action", [
    (201, "joined", None),
    (202, "joining", None),
    (203, "private", None),
    (204, "ignored", "ignored"),
    (205, "pending", "ignored"),
    (206, "pending", "promoted"),
])
async def test_approve_rejected_in_wrong_state(http, tid, status, action):
    db_id = await insert(tid, status, action)
    resp = await http.post(f"/api/admin/discovered/{db_id}/approve", headers=ADMIN_H)
    assert resp.status_code == 400
    assert (await fetch(db_id))["join_approved_at"] is None


async def test_unapprove_rejected_once_joined(http):
    db_id = await insert(103, join_status="joined")
    async with AsyncSessionLocal() as s:
        await s.execute(text(
            "UPDATE discovered_channels SET join_approved_at = NOW() WHERE id = :i"
        ), {"i": db_id})
        await s.commit()
    resp = await http.post(f"/api/admin/discovered/{db_id}/unapprove", headers=ADMIN_H)
    assert resp.status_code == 400
    assert (await fetch(db_id))["join_approved_at"] is not None


@pytest.mark.parametrize("mode,enabled,expected", [
    ("approval", True, "approval"),
    ("auto", True, "auto"),
    ("off", True, "off"),
    ("approval", False, "off"),
])
async def test_stats_report_join_mode_and_awaiting(http, monkeypatch, mode, enabled, expected):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MODE", mode)
    monkeypatch.setattr(settings, "CHANNEL_JOIN_ENABLED", enabled)
    await insert(301)
    approved = await insert(302)
    await http.post(f"/api/admin/discovered/{approved}/approve", headers=ADMIN_H)

    resp = await http.get("/api/admin/discovered/stats", headers=ADMIN_H)
    assert resp.status_code == 200
    body = resp.json()
    assert body["join_mode"] == expected
    assert body["awaiting_approval"] == 1


async def test_list_and_detail_expose_approval_state(http, monkeypatch):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MODE", "approval")
    monkeypatch.setattr(settings, "CHANNEL_JOIN_ENABLED", True)
    waiting = await insert(401)
    approved = await insert(402)
    await http.post(f"/api/admin/discovered/{approved}/approve", headers=ADMIN_H)

    resp = await http.get("/api/admin/discovered/", headers=ADMIN_H)
    assert resp.status_code == 200
    items = {i["id"]: i for i in resp.json()["items"]}
    assert items[waiting]["awaiting_approval"] is True
    assert items[waiting]["join_approved_at"] is None
    assert items[approved]["awaiting_approval"] is False
    assert items[approved]["join_approved_at"] is not None

    detail = (await http.get(f"/api/admin/discovered/{waiting}", headers=ADMIN_H)).json()
    assert detail["awaiting_approval"] is True and detail["join_mode"] == "approval"


async def test_not_awaiting_outside_approval_mode(http, monkeypatch):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MODE", "auto")
    monkeypatch.setattr(settings, "CHANNEL_JOIN_ENABLED", True)
    await insert(501)
    items = (await http.get("/api/admin/discovered/", headers=ADMIN_H)).json()["items"]
    assert items[0]["awaiting_approval"] is False
