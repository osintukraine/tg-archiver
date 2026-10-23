"""/api/system/health: the two DB checks share one AsyncSession and must not run concurrently.

Runs against a real PostgreSQL (init.sql + migrations, POSTGRES_* env vars). Self-contained.
"""

import pytest
from sqlalchemy import text

from models.base import AsyncSessionLocal, engine
from src.routers import system

pytestmark = pytest.mark.asyncio(loop_scope="module")

CHANNEL_ID = 990_101


async def _stub(name):
    return {"name": name, "status": "healthy"}


async def test_db_checks_do_not_collide_and_listener_reports_age(monkeypatch):
    for fn, name in [("check_redis_health", "redis"), ("check_minio_health", "seaweedfs"),
                     ("check_processor_health", "processor"), ("check_api_health", "api"),
                     ("check_frontend_health", "frontend")]:
        monkeypatch.setattr(system, fn, lambda name=name: _stub(name))
    await engine.dispose()  # pooled connections from other modules belong to other event loops
    async with AsyncSessionLocal() as s:
        await s.execute(text("DELETE FROM messages WHERE channel_id = :c"), {"c": CHANNEL_ID})
        await s.execute(text("DELETE FROM channels WHERE id = :c"), {"c": CHANNEL_ID})
        await s.execute(text("INSERT INTO channels (id, telegram_id, name) VALUES (:c, :t, 'health')"),
                        {"c": CHANNEL_ID, "t": CHANNEL_ID})
        await s.execute(text("INSERT INTO messages (channel_id, message_id, content) VALUES (:c, 1, 'x')"),
                        {"c": CHANNEL_ID})
        await s.commit()

    async with AsyncSessionLocal() as db:
        result = await system.get_system_health(db=db)

    by_name = {s["name"]: s for s in result["services"]}
    assert by_name["postgresql"]["status"] != "down", by_name["postgresql"]
    listener = by_name["listener"]
    assert listener["status"] == "healthy", listener
    assert 0 <= listener["metrics"]["last_message_age_seconds"] < 60
