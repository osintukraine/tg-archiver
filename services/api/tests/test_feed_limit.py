"""feed_limit: requested limit or default, clamped to max; admin overrides win. Self-contained."""

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

from src.routers import rss  # noqa: E402


def overrides(monkeypatch, values):
    async def fake(key, session_factory=None):
        return values.get(key)

    monkeypatch.setattr(rss, "get_override", fake)


async def test_defaults_without_overrides(monkeypatch):
    overrides(monkeypatch, {})
    assert await rss.feed_limit(None) == 50
    assert await rss.feed_limit(30) == 30
    assert await rss.feed_limit(500) == 100  # clamped to max


async def test_admin_overrides_apply(monkeypatch):
    overrides(monkeypatch, {"feed.default_limit": 20, "feed.max_limit": 200})
    assert await rss.feed_limit(None) == 20
    assert await rss.feed_limit(150) == 150
    assert await rss.feed_limit(500) == 200


async def test_nonsense_override_falls_back(monkeypatch):
    overrides(monkeypatch, {"feed.default_limit": 0, "feed.max_limit": "x"})
    assert await rss.feed_limit(None) == 50
