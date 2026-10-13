"""
JWTs must only be accepted from the Authorization header (or the access_token
cookie used by /docs), never from an ``?access_token=`` query parameter
(URLs leak into proxy logs and browser history).

Self-contained: no DB or Redis needed.
Run: python -m pytest tests/test_query_param_token_rejected.py -c tests/pytest-approval.ini
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
from fastapi import FastAPI, Request  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.auth.jwt import create_access_token, extract_token_from_request  # noqa: E402
from src.middleware.auth_unified import AuthMiddleware  # noqa: E402


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(AuthMiddleware)

    @app.get("/whoami")
    async def whoami(request: Request):
        return {"authenticated": request.state.user.is_authenticated}

    @app.get("/extract")
    async def extract(request: Request):
        return {"token": extract_token_from_request(request)}

    return app


@pytest_asyncio.fixture
async def client(monkeypatch):
    # AUTH_PROVIDER is read at import time; other test modules may have imported it first
    monkeypatch.setattr("src.middleware.auth_unified.AUTH_PROVIDER", "jwt")
    async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://test") as c:
        yield c


@pytest.fixture
def token() -> str:
    return create_access_token({"sub": "admin", "user_id": 1, "is_admin": True})


async def test_query_param_token_is_not_authenticated(client, token):
    r = await client.get("/whoami", params={"access_token": token})
    assert r.json() == {"authenticated": False}


async def test_query_param_token_is_not_extracted(client, token):
    r = await client.get("/extract", params={"access_token": token})
    assert r.json() == {"token": None}


async def test_bearer_header_still_authenticates(client, token):
    r = await client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
    assert r.json() == {"authenticated": True}


async def test_bearer_header_and_cookie_are_extracted(client, token):
    r = await client.get("/extract", headers={"Authorization": f"Bearer {token}"})
    assert r.json() == {"token": token}
    client.cookies.set("access_token", token)
    r = await client.get("/extract")
    assert r.json() == {"token": token}
