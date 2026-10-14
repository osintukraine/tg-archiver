"""
Tests for browser-facing media URLs (utils.minio_client.get_media_url) and feed enclosures.

Default: Caddy path <origin>/media/...; explicit MINIO_PUBLIC_URL: <url>/<bucket>/<key>.
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

from datetime import datetime, timezone  # noqa: E402
from types import SimpleNamespace  # noqa: E402

import pytest  # noqa: E402

from src.feed_generator import FeedFormat, FeedGenerator  # noqa: E402
from src.utils import minio_client  # noqa: E402
from src.utils.minio_client import get_media_path, get_media_url  # noqa: E402

KEY = "media/ab/cd/abcd.png"


@pytest.fixture(autouse=True)
def _defaults(monkeypatch):
    monkeypatch.setattr(minio_client, "MINIO_PUBLIC_URL", "")
    monkeypatch.setattr(minio_client, "PUBLIC_BASE_URL", "http://localhost")


def test_default_is_caddy_path_on_public_base_url():
    assert get_media_url(KEY) == "http://localhost/media/ab/cd/abcd.png"


def test_leading_slash_and_missing_prefix_are_normalised():
    assert get_media_url("/" + KEY) == "http://localhost/media/ab/cd/abcd.png"
    assert get_media_path("ab/cd/x.png") == "/media/ab/cd/x.png"


def test_request_derived_base_wins_over_public_base_url(monkeypatch):
    monkeypatch.setattr(minio_client, "PUBLIC_BASE_URL", "http://configured")
    assert get_media_url(KEY, "https://archive.example.org:8443/") == (
        "https://archive.example.org:8443/media/ab/cd/abcd.png"
    )
    assert get_media_url(KEY) == "http://configured/media/ab/cd/abcd.png"


def test_explicit_minio_public_url_uses_bucket_path(monkeypatch):
    monkeypatch.setattr(minio_client, "MINIO_PUBLIC_URL", "http://s3.example.org:8333")
    assert get_media_url(KEY, "http://ignored") == (
        f"http://s3.example.org:8333/{minio_client.MINIO_BUCKET}/{KEY}"
    )


def test_presigned_helpers_are_gone():
    assert not hasattr(minio_client, "get_presigned_url")
    assert not hasattr(minio_client, "USE_PRESIGNED_URLS")


@pytest.mark.parametrize("fmt", [FeedFormat.RSS, FeedFormat.ATOM, FeedFormat.JSON])
def test_feed_media_urls_are_absolute_caddy_urls(fmt):
    media_file = SimpleNamespace(
        s3_key=KEY, mime_type="image/png", file_size=12, duration=None, width=None, height=None
    )
    message = SimpleNamespace(
        id=1,
        message_id=1,
        content="hello",
        content_translated=None,
        telegram_date=datetime(2026, 10, 1, tzinfo=timezone.utc),
        media=[SimpleNamespace(media_file=media_file)],
        media_type="photo",
        media_url_telegram=None,
        channel=SimpleNamespace(username="chan", name="Chan", id=1),
        views=None,
        forwards=None,
        topic=None,
        entities=None,
        language_detected=None,
        channel_id=1,
        created_at=None,
        updated_at=None,
    )
    out = FeedGenerator("https://archive.example.org").generate(
        [message], "t", "d", "https://archive.example.org/rss/x", format=fmt
    )
    assert "https://archive.example.org/media/ab/cd/abcd.png" in out
    assert "localhost:9000" not in out
