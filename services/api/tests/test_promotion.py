"""
request_promotion: the channels:promote send-and-wait shared by discovered-channel
promotion and channel-submission approval. Real Redis (TEST_REDIS_URL); a task
plays the listener's promotion_worker. Self-contained: no shared conftest.
"""

import asyncio
import json
import os
from types import SimpleNamespace

import pytest
import redis.asyncio as redis
from fastapi import HTTPException

from config.settings import settings
from src.utils import promotion

REDIS_URL = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/14")


@pytest.fixture
async def r(monkeypatch):
    # REDIS_URL is a read-only property on Settings
    monkeypatch.setattr(promotion, "settings", SimpleNamespace(
        REDIS_URL=REDIS_URL, FOLDER_ARCHIVE_ALL_PATTERN=settings.FOLDER_ARCHIVE_ALL_PATTERN))
    client = redis.from_url(REDIS_URL, decode_responses=True)
    await client.delete("channels:promote", "channels:promote:result")
    yield client
    await client.delete("channels:promote", "channels:promote:result")
    await client.aclose()


async def fake_listener(client, result):
    for _ in range(50):
        entries = await client.xrange("channels:promote")
        if entries:
            data = entries[-1][1]
            await client.xadd("channels:promote:result", {
                "request_id": data["request_id"], "result": json.dumps(result)})
            return data
        await asyncio.sleep(0.1)


async def test_returns_listener_result_and_sends_request(r):
    listener = asyncio.create_task(
        fake_listener(r, {"success": True, "folder_name": "News"}))
    out = await promotion.request_promotion("chan_name", "News", discovered_channel_id=5)
    sent = await listener
    assert sent is not None
    assert out["folder_name"] == "News"
    assert (sent["username"], sent["folder"], sent["discovered_channel_id"]) == ("chan_name", "News", "5")


async def test_default_folder_and_no_discovered_id(r):
    listener = asyncio.create_task(fake_listener(r, {"success": True}))
    await promotion.request_promotion("chan_name", None)
    sent = await listener
    assert sent is not None
    assert sent["folder"] == settings.FOLDER_ARCHIVE_ALL_PATTERN
    assert "discovered_channel_id" not in sent


async def test_listener_failure_is_400(r):
    asyncio.create_task(fake_listener(r, {"success": False, "error": "no such channel"}))
    with pytest.raises(HTTPException) as e:
        await promotion.request_promotion("chan_name", None)
    assert e.value.status_code == 400 and "no such channel" in e.value.detail


async def test_timeout_is_504(r, monkeypatch):
    monkeypatch.setattr(promotion, "PROMOTE_TIMEOUT_SECONDS", 1)
    with pytest.raises(HTTPException) as e:
        await promotion.request_promotion("chan_name", None)
    assert e.value.status_code == 504
