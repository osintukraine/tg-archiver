"""POST /api/channels/{id}/backfill is admin-only (it drives Telegram API traffic). Self-contained."""

import os

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

from src.auth.models import AuthUser  # noqa: E402
from src.database import get_db  # noqa: E402
from src.routers import channels  # noqa: E402

pytestmark = pytest.mark.asyncio

ROLES = {"viewer": AuthUser(user_id=1, username="v", roles=["viewer"], is_authenticated=True)}


@pytest.fixture
def app():
    app = FastAPI()

    @app.middleware("http")
    async def fake_auth(request: Request, call_next):
        request.state.user = ROLES.get(request.headers.get("X-Test-Role"), AuthUser())
        return await call_next(request)

    async def no_db():
        yield None  # never reached: the admin check rejects first

    app.dependency_overrides[get_db] = no_db
    app.include_router(channels.router)
    return app


@pytest.mark.parametrize("role,status", [(None, 401), ("viewer", 403)])
async def test_backfill_requires_admin(app, role, status):
    headers = {"X-Test-Role": role} if role else {}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        resp = await c.post("/api/channels/1/backfill", json={}, headers=headers)
    assert resp.status_code == status
