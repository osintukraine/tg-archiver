"""
Regression tests: middleware rejections must be real HTTP responses.

Raising HTTPException inside a Starlette BaseHTTPMiddleware is not handled by
FastAPI's exception handlers: it surfaces as a 500 and resets the connection,
which made the reverse proxy fail the *next* request on that pooled
connection with a 502. CSRF (403) and login rate limiting (429) must return
proper JSON responses instead.

The rate-limit test uses a REAL Redis (TEST_REDIS_URL; the database is flushed).
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
import redis.asyncio as redis  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.middleware.csrf import CSRF_COOKIE_NAME, CSRF_HEADER_NAME, CSRFMiddleware  # noqa: E402
from src.middleware.rate_limit import AUTH_RATE_LIMIT, RateLimitMiddleware  # noqa: E402

REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/13")


def _app_with(middleware_cls, **kwargs) -> FastAPI:
    app = FastAPI()

    @app.post("/api/things")
    async def create_thing():
        return {"ok": True}

    @app.post("/api/auth/login")
    async def login():
        return {"ok": True}

    app.add_middleware(middleware_cls, **kwargs)
    return app


async def _client(app: FastAPI) -> AsyncClient:
    # raise_app_exceptions=False makes an unhandled middleware exception show up
    # as the 500 a real client would get, instead of raising in the test.
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_csrf_missing_header_returns_403_json():
    async with await _client(_app_with(CSRFMiddleware)) as client:
        client.cookies.set(CSRF_COOKIE_NAME, "cookie-token")
        response = await client.post("/api/things")

    assert response.status_code == 403
    assert "CSRF token missing" in response.json()["detail"]


@pytest.mark.asyncio
async def test_csrf_mismatched_header_returns_403_json():
    async with await _client(_app_with(CSRFMiddleware)) as client:
        client.cookies.set(CSRF_COOKIE_NAME, "cookie-token")
        response = await client.post("/api/things", headers={CSRF_HEADER_NAME: "other-token"})

    assert response.status_code == 403
    assert response.json()["detail"] == "CSRF token invalid."


@pytest.mark.asyncio
async def test_csrf_valid_header_passes_through():
    async with await _client(_app_with(CSRFMiddleware)) as client:
        client.cookies.set(CSRF_COOKIE_NAME, "cookie-token")
        response = await client.post("/api/things", headers={CSRF_HEADER_NAME: "cookie-token"})

    assert response.status_code == 200


@pytest.mark.asyncio
async def test_login_rate_limit_returns_429_with_retry_headers():
    flush = redis.from_url(REDIS_URL)
    await flush.flushdb()
    await flush.aclose()

    app = _app_with(RateLimitMiddleware, redis_url=REDIS_URL)
    async with await _client(app) as client:
        for _ in range(AUTH_RATE_LIMIT):
            assert (await client.post("/api/auth/login")).status_code == 200
        response = await client.post("/api/auth/login")

    assert response.status_code == 429
    assert "Too many requests" in response.json()["detail"]
    assert int(response.headers["Retry-After"]) > 0
    assert response.headers["X-RateLimit-Remaining"] == "0"
