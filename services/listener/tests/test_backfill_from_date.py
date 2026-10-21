"""A manual backfill starts from the channel's backfill_from_date (set by the API), not the global default."""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src import channel_discovery
from src.channel_discovery import ChannelDiscovery

REQUESTED = datetime(2026, 10, 10, tzinfo=timezone.utc)


class FakeResult:
    def __init__(self, row):
        self.row = row

    def scalar_one_or_none(self):
        return self.row


class FakeSession:
    def __init__(self, row):
        self.row = row

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, _stmt):
        return FakeResult(self.row)


class FakeBackfill:
    def __init__(self):
        self.calls = []

    async def backfill_channel(self, channel, from_date=None, session=None):
        self.calls.append(from_date)
        return {"messages_fetched": 0}


@pytest.mark.asyncio
@pytest.mark.parametrize("stored,expected", [(REQUESTED, REQUESTED), (None, None)])
async def test_backfill_uses_channel_from_date(monkeypatch, stored, expected):
    row = SimpleNamespace(telegram_id=1, name="c", backfill_from_date=stored)
    monkeypatch.setattr(channel_discovery, "AsyncSessionLocal", lambda: FakeSession(row))
    discovery = ChannelDiscovery.__new__(ChannelDiscovery)  # only backfill_service is used
    discovery.backfill_service = FakeBackfill()

    await discovery._run_backfill_with_error_handling(SimpleNamespace(telegram_id=1, name="c"))

    # None means "use BACKFILL_START_DATE" inside backfill_channel
    assert discovery.backfill_service.calls == [expected]
