"""
Regression test: logout must actually revoke the JWT.

POST /api/auth/logout writes the token to the Redis blacklist, but the unified
AuthMiddleware used to skip the blacklist check, so a logged-out token kept
working. Uses a REAL Redis (TEST_REDIS_URL; the database is flushed).
Self-contained: no shared conftest.
"""

import os

for _k, _v in {
    "POSTGRES_PASSWORD": "x",
    "REDIS_PASSWORD": "",
    "MINIO_ENDPOINT": "x:1",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
    "JWT_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
import redis.asyncio as redis  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.auth import jwt as jwt_module  # noqa: E402
from src.dependencies.auth import AuthenticatedUser  # noqa: E402
from src.middleware.auth_unified import AuthMiddleware  # noqa: E402

REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/12")


@pytest_asyncio.fixture
async def redis_client(monkeypatch):
    # AUTH_PROVIDER is read at import time; other test modules may import it first
    monkeypatch.setattr("src.middleware.auth_unified.AUTH_PROVIDER", "jwt")
    client = redis.from_url(REDIS_URL, decode_responses=True)
    await client.flushdb()
    jwt_module._redis_client = client
    yield client
    await client.flushdb()
    jwt_module._redis_client = None
    await client.aclose()


def _app() -> FastAPI:
    app = FastAPI()

    @app.get("/api/whoami")
    async def whoami(user: AuthenticatedUser):
        return {"username": user.username}

    app.add_middleware(AuthMiddleware)
    return app


@pytest.mark.asyncio
async def test_blacklisted_token_gets_401(redis_client):
    token = jwt_module.create_access_token({"sub": "alice", "user_id": 1, "is_admin": False})
    headers = {"Authorization": f"Bearer {token}"}

    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as client:
        assert (await client.get("/api/whoami", headers=headers)).status_code == 200

        assert await jwt_module.invalidate_token(token) is True

        assert (await client.get("/api/whoami", headers=headers)).status_code == 401
