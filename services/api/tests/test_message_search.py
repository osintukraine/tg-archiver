"""
Full-text search on /api/messages/ (q=...): stemmed matching (migration 009).

Runs against a real PostgreSQL (init.sql + migrations applied, POSTGRES_* env vars),
like test_admin_discovered_approval.py. Self-contained: no shared conftest.
"""

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from prometheus_client import REGISTRY
from sqlalchemy import text

from models.base import AsyncSessionLocal, engine
from src.routers.messages import router

pytestmark = pytest.mark.asyncio(loop_scope="module")

CHANNEL_ID = 990_001
CHANNEL_TG_ID = 990_000_001
MESSAGES = {
    1: ("Войска Украины продвигаются", None),
    2: ("Новости об Украине", "News about Ukraine"),
    3: ("Атака дронов", "Drone attack on Ukraine"),
    4: ("Погода", "The weather is fine"),
}


@pytest_asyncio.fixture(loop_scope="module")
async def http():
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(loop_scope="module", autouse=True)
async def seed():
    # Pooled connections from other test modules belong to their event loops
    await engine.dispose()
    async with AsyncSessionLocal() as s:
        # Fixed id: other suites insert channels with explicit ids without advancing the sequence
        await s.execute(text("DELETE FROM messages WHERE channel_id = :id"), {"id": CHANNEL_ID})
        await s.execute(text("DELETE FROM channels WHERE id = :id OR telegram_id = :t"),
                        {"id": CHANNEL_ID, "t": CHANNEL_TG_ID})
        channel_id = (await s.execute(text(
            "INSERT INTO channels (id, telegram_id, name) VALUES (:id, :t, 'search-test') RETURNING id"
        ), {"id": CHANNEL_ID, "t": CHANNEL_TG_ID})).scalar_one()
        for msg_id, (content, translated) in MESSAGES.items():
            await s.execute(text("""
                INSERT INTO messages (channel_id, message_id, content, content_translated)
                VALUES (:c, :m, :content, :tr)
            """), {"c": channel_id, "m": msg_id, "content": content, "tr": translated})
        await s.commit()
    yield channel_id


async def found(http, seed, q) -> set[int]:
    resp = await http.get("/api/messages/", params={"q": q, "channel_id": seed, "page_size": 100})
    assert resp.status_code == 200, resp.text
    return {item["message_id"] for item in resp.json()["items"]}


async def test_russian_inflections_match_each_other(http, seed):
    # nominative query finds genitive (Украины) and prepositional (Украине) forms
    assert await found(http, seed, "Украина") == {1, 2}
    assert await found(http, seed, "Украину") == {1, 2}
    assert await found(http, seed, "дрон") == {3}


async def test_english_translation_is_stemmed(http, seed):
    assert await found(http, seed, "drones") == {3}
    assert await found(http, seed, "Ukraine") == {2, 3}


async def test_exclusion_and_or(http, seed):
    assert await found(http, seed, "Ukraine -drones") == {2}
    assert await found(http, seed, "погода OR дроны") == {3, 4}


async def test_whitespace_query_is_no_query(http, seed):
    assert await found(http, seed, "   ") == {1, 2, 3, 4}


def ops(kind, status="ok"):
    return REGISTRY.get_sample_value("tg_search_operations_total", {"kind": kind, "status": status}) or 0


async def test_search_metrics_split_fulltext_and_filters(http, seed):
    fulltext, filters = ops("fulltext"), ops("filters")
    results = REGISTRY.get_sample_value("tg_search_results_count_sum") or 0

    await found(http, seed, "Ukraine")  # 2 hits
    resp = await http.get("/api/messages/", params={"channel_id": seed, "page_size": 100})
    assert resp.status_code == 200  # 4 hits

    assert ops("fulltext") == fulltext + 1
    assert ops("filters") == filters + 1
    assert REGISTRY.get_sample_value("tg_search_results_count_sum") == results + 2 + 4
