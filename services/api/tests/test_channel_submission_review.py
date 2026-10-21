"""
Admin review of channel suggestions: list filter, approve (reuses the promotion
helper), reject, audit rows, auth.

Runs against a real PostgreSQL (init.sql + migrations through 006). The listener
round trip (request_promotion) is monkeypatched.
Self-contained: no shared conftest.

Run: python -m pytest tests/test_channel_submission_review.py -c tests/pytest-approval.ini
"""

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException, Request
from sqlalchemy import text

from models.base import AsyncSessionLocal, engine
from src.auth.models import AuthUser
from src.routers import channel_submissions as mod
from src.routers.channel_submissions import router

pytestmark = pytest.mark.asyncio(loop_scope="module")

ADMIN = AuthUser(user_id=7001, username="reviewer", roles=["admin"],
                 is_authenticated=True, auth_method="jwt")
VIEWER = AuthUser(user_id=7002, username="viewer", roles=["viewer"],
                  is_authenticated=True, auth_method="jwt")
ADMIN_H = {"x-test-role": "admin"}


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
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=build_app()), base_url="http://test"
    ) as c:
        yield c


@pytest_asyncio.fixture(loop_scope="module", autouse=True)
async def clean_db():
    engine.sync_engine.dispose(close=False)
    async with AsyncSessionLocal() as s:
        await s.execute(text("TRUNCATE channel_submissions RESTART IDENTITY"))
        await s.execute(text("DELETE FROM users WHERE id IN (7001, 7002)"))
        await s.execute(text("""
            INSERT INTO users (id, username, email, hashed_password)
            VALUES (7001, 'reviewer', 'reviewer@example.test', 'x')
        """))
        await s.execute(text("DELETE FROM admin_actions WHERE resource_type = 'submission'"))
        await s.commit()


@pytest.fixture
def promotion(monkeypatch):
    """Replace the listener round trip; records calls, returns/raises as configured."""
    state = {"calls": [], "raises": None}

    async def fake(username, folder, discovered_channel_id=None):
        state["calls"].append((username, folder))
        if state["raises"]:
            raise state["raises"]
        return {"success": True, "folder_name": folder or "Archive", "already_existed": False}

    monkeypatch.setattr(mod, "request_promotion", fake)
    return state


async def insert(link="@some_channel", username="some_channel", status="pending") -> int:
    async with AsyncSessionLocal() as s:
        row = await s.execute(text("""
            INSERT INTO channel_submissions
                (channel_link, channel_name, telegram_username, reason, status, submitted_by_ip)
            VALUES (:l, 'Name', :u, 'a good reason here', :s, CAST('203.0.113.9' AS inet))
            RETURNING id
        """), {"l": link, "u": username, "s": status})
        await s.commit()
        return row.scalar_one()


async def fetch(sub_id: int) -> dict:
    async with AsyncSessionLocal() as s:
        row = await s.execute(text("SELECT * FROM channel_submissions WHERE id = :i"), {"i": sub_id})
        return dict(row.one()._mapping)


async def audit(sub_id: int) -> list:
    async with AsyncSessionLocal() as s:
        rows = await s.execute(text("""
            SELECT action, details FROM admin_actions
            WHERE resource_type = 'submission' AND resource_id = :i
        """), {"i": sub_id})
        return [dict(r._mapping) for r in rows]


@pytest.mark.parametrize("action", ["approve", "reject"])
@pytest.mark.parametrize("role,code", [("anonymous", 401), ("viewer", 403)])
async def test_review_requires_admin(http, action, role, code):
    sub = await insert()
    r = await http.post(f"/api/admin/channel-submissions/{sub}/{action}",
                        headers={"x-test-role": role})
    assert r.status_code == code
    assert (await fetch(sub))["status"] == "pending"


async def test_list_filters_by_status_hides_ip_and_orders_newest_first(http):
    a = await insert(status="pending")
    b = await insert(status="rejected")
    c = await insert(status="pending")
    r = await http.get("/api/admin/channel-submissions?status=pending", headers=ADMIN_H)
    assert r.status_code == 200
    body = r.json()
    assert [i["id"] for i in body["items"]] == [c, a] and body["total"] == 2
    assert "submitted_by_ip" not in body["items"][0]
    r = await http.get("/api/admin/channel-submissions?status=all", headers=ADMIN_H)
    assert r.json()["total"] == 3
    r = await http.get("/api/admin/channel-submissions?status=rejected", headers=ADMIN_H)
    assert [i["id"] for i in r.json()["items"]] == [b]
    r = await http.get("/api/admin/channel-submissions?status=pending&limit=1&offset=1",
                       headers=ADMIN_H)
    assert [i["id"] for i in r.json()["items"]] == [a]


async def test_approve_promotes_sets_fields_and_audits(http, promotion):
    sub = await insert()
    r = await http.post(f"/api/admin/channel-submissions/{sub}/approve",
                        json={"folder": "News"}, headers=ADMIN_H)
    assert r.status_code == 200, r.text
    assert promotion["calls"] == [("some_channel", "News")]
    row = await fetch(sub)
    assert row["status"] == "approved" and row["reviewed_by"] == 7001
    assert row["reviewed_at"] is not None and row["assigned_folder"] == "News"
    rows = await audit(sub)
    assert [x["action"] for x in rows] == ["submission.approved"]
    assert rows[0]["details"] == {"username": "some_channel", "folder": "News"}
    listed = (await http.get("/api/admin/channel-submissions?status=approved",
                             headers=ADMIN_H)).json()["items"][0]
    assert listed["reviewed_by"] == "reviewer"


async def test_approve_without_body_uses_default_folder(http, promotion):
    sub = await insert()
    r = await http.post(f"/api/admin/channel-submissions/{sub}/approve", headers=ADMIN_H)
    assert r.status_code == 200
    assert promotion["calls"] == [("some_channel", None)]
    assert (await fetch(sub))["assigned_folder"] == "Archive"


async def test_approve_parses_username_from_link_when_column_empty(http, promotion):
    sub = await insert(link="@from_link", username=None)
    r = await http.post(f"/api/admin/channel-submissions/{sub}/approve", headers=ADMIN_H)
    assert r.status_code == 200 and promotion["calls"][0][0] == "from_link"


@pytest.mark.parametrize("exc,code", [
    (HTTPException(status_code=504, detail="timed out"), 504),
    (HTTPException(status_code=400, detail="Promotion failed: boom"), 400),
])
async def test_approve_listener_failure_leaves_pending(http, promotion, exc, code):
    promotion["raises"] = exc
    sub = await insert()
    r = await http.post(f"/api/admin/channel-submissions/{sub}/approve", headers=ADMIN_H)
    assert r.status_code == code
    row = await fetch(sub)
    assert row["status"] == "pending" and row["reviewed_at"] is None
    assert await audit(sub) == []


async def test_approve_invite_link_is_400_and_listener_untouched(http, promotion):
    sub = await insert(link="+AbCdEfGhIjK", username=None)
    r = await http.post(f"/api/admin/channel-submissions/{sub}/approve", headers=ADMIN_H)
    assert r.status_code == 400 and "invite" in r.json()["detail"]
    assert promotion["calls"] == [] and (await fetch(sub))["status"] == "pending"


@pytest.mark.parametrize("status", ["approved", "rejected"])
@pytest.mark.parametrize("action", ["approve", "reject"])
async def test_already_reviewed_is_409(http, promotion, status, action):
    sub = await insert(status=status)
    r = await http.post(f"/api/admin/channel-submissions/{sub}/{action}", headers=ADMIN_H)
    assert r.status_code == 409
    assert promotion["calls"] == []


async def test_missing_submission_is_404(http, promotion):
    r = await http.post("/api/admin/channel-submissions/99999/approve", headers=ADMIN_H)
    assert r.status_code == 404


async def test_reject_sets_fields_and_audits(http):
    sub = await insert()
    r = await http.post(f"/api/admin/channel-submissions/{sub}/reject",
                        json={"reason": " off topic "}, headers=ADMIN_H)
    assert r.status_code == 200
    row = await fetch(sub)
    assert row["status"] == "rejected" and row["reviewed_by"] == 7001
    assert row["reviewed_at"] is not None and row["rejection_reason"] == "off topic"
    assert row["assigned_folder"] is None
    rows = await audit(sub)
    assert [x["action"] for x in rows] == ["submission.rejected"]
    assert rows[0]["details"]["reason"] == "off topic"


async def test_reject_without_reason(http):
    sub = await insert()
    r = await http.post(f"/api/admin/channel-submissions/{sub}/reject", headers=ADMIN_H)
    assert r.status_code == 200 and (await fetch(sub))["rejection_reason"] is None
