"""Channel join worker: mode selection, eligibility, and safety handling."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from telethon.errors import ChannelsTooMuchError, FloodWaitError

from config.settings import Settings, settings
from src.channel_join_worker import MAX_FLOOD_WAIT_SECONDS, ChannelJoinWorker

from .conftest import get_row, hours_ago, insert_channel


def make_flood_wait(seconds: int) -> FloodWaitError:
    return FloodWaitError(request=None, capture=seconds)


def joined_full_channel() -> MagicMock:
    full = MagicMock()
    full.chats = []
    full.full_chat.about = "about"
    full.full_chat.participants_count = 10
    full.full_chat.linked_chat_id = None
    return full


# --------------------------------------------------------------------------
# Mode selection
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "mode,enabled,expected",
    [
        ("approval", True, "approval"),
        ("auto", True, "auto"),
        ("off", True, "off"),
        ("approval", False, "off"),  # deprecated flag wins
        ("auto", False, "off"),
    ],
)
def test_effective_mode(mode, enabled, expected):
    cfg = Settings(CHANNEL_JOIN_MODE=mode, CHANNEL_JOIN_ENABLED=enabled)
    assert cfg.effective_channel_join_mode == expected


def test_default_mode_is_approval():
    assert Settings.model_fields["CHANNEL_JOIN_MODE"].default == "approval"


def test_invalid_mode_rejected():
    with pytest.raises(ValueError):
        Settings(CHANNEL_JOIN_MODE="yolo")


async def test_start_off_does_not_run(client, monkeypatch):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MODE", "off")
    worker = ChannelJoinWorker(client)
    await worker.start()
    assert worker._join_task is None and not worker.running


async def test_start_enabled_false_is_off_and_warns(client, monkeypatch, caplog):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_ENABLED", False)
    worker = ChannelJoinWorker(client)
    await worker.start()
    assert worker._join_task is None
    assert "deprecated" in caplog.text


async def test_start_approval_runs(client, monkeypatch):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MODE", "approval")
    worker = ChannelJoinWorker(client)
    await worker.start()
    try:
        assert worker._join_task is not None and worker.running
    finally:
        await worker.stop()


# --------------------------------------------------------------------------
# Eligibility query
# --------------------------------------------------------------------------

async def eligible_ids(worker) -> set[int]:
    return {row["telegram_id"] for row in await worker._get_pending_channels()}


async def test_approval_mode_selects_only_approved(client, monkeypatch):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MODE", "approval")
    await insert_channel(1, approved=True)
    await insert_channel(2, approved=False)
    await insert_channel(3, approved=True, admin_action="ignored", join_status="ignored")
    await insert_channel(4, approved=True, admin_action="promoted")
    await insert_channel(5, approved=True, join_status="joined")
    assert await eligible_ids(ChannelJoinWorker(client)) == {1}


async def test_auto_mode_selects_unapproved_too(client, monkeypatch):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MODE", "auto")
    await insert_channel(1, approved=True)
    await insert_channel(2, approved=False)
    await insert_channel(3, admin_action="ignored", join_status="ignored")
    await insert_channel(4, admin_action="promoted")
    assert await eligible_ids(ChannelJoinWorker(client)) == {1, 2}


async def test_failed_rows_respect_retry_rules(client, monkeypatch):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_MODE", "approval")
    due = hours_ago(1)
    future = datetime.now(timezone.utc) + timedelta(hours=5)
    await insert_channel(1, approved=True, join_status="failed", join_retry_after=due)
    await insert_channel(2, approved=True, join_status="failed", join_retry_after=future)
    await insert_channel(3, approved=True, join_status="failed", join_retry_after=due, join_retry_count=3)
    await insert_channel(4, approved=False, join_status="failed", join_retry_after=due)
    assert await eligible_ids(ChannelJoinWorker(client)) == {1}


async def test_limit_caps_batch(client):
    for i in range(1, 6):
        await insert_channel(i)
    rows = await ChannelJoinWorker(client)._get_pending_channels(limit=2)
    assert len(rows) == 2


# --------------------------------------------------------------------------
# Safety handling
# --------------------------------------------------------------------------

async def test_successful_join_marks_joined(client, sleeps):
    db_id = await insert_channel(1)
    client.side_effect = [None, joined_full_channel()]  # JoinChannel, GetFullChannel
    await ChannelJoinWorker(client)._join_cycle()
    row = await get_row(db_id)
    assert row["join_status"] == "joined" and row["joined_at"] is not None


async def test_floodwait_returns_row_to_pending_and_ends_cycle(client, sleeps):
    first = await insert_channel(1)
    second = await insert_channel(2)
    client.side_effect = make_flood_wait(120)
    await ChannelJoinWorker(client)._join_cycle()

    row = await get_row(first)
    assert row["join_status"] == "pending"
    assert row["join_retry_count"] == 0
    assert (await get_row(second))["join_status"] == "pending"
    assert client.await_count == 1  # cycle ended after the first FloodWait
    assert 120 in sleeps


async def test_floodwait_sleep_is_capped(client, sleeps):
    await insert_channel(1)
    client.side_effect = make_flood_wait(MAX_FLOOD_WAIT_SECONDS * 10)
    await ChannelJoinWorker(client)._join_cycle()
    assert MAX_FLOOD_WAIT_SECONDS in sleeps
    assert max(sleeps) == MAX_FLOOD_WAIT_SECONDS


async def test_channels_too_much_pauses_without_retry_bump(client, sleeps, caplog):
    first = await insert_channel(1)
    await insert_channel(2)
    client.side_effect = ChannelsTooMuchError(request=None)
    worker = ChannelJoinWorker(client)
    await worker._join_cycle()

    row = await get_row(first)
    assert row["join_status"] == "pending" and row["join_retry_count"] == 0
    assert worker._is_paused()
    assert client.await_count == 1
    assert caplog.text.count("channel limit reached") == 1

    # Next cycles do nothing while paused (and do not log again)
    await worker._join_cycle()
    assert client.await_count == 1
    assert caplog.text.count("channel limit reached") == 1


async def test_pause_expires(client):
    worker = ChannelJoinWorker(client)
    worker._paused_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    assert not worker._is_paused()


async def test_daily_cap_blocks_cycle(client, sleeps, monkeypatch):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_DAILY_CAP", 2)
    await insert_channel(10, join_status="joined", joined_at=hours_ago(1))
    await insert_channel(11, join_status="joined", joined_at=hours_ago(23))
    waiting = await insert_channel(1)
    await ChannelJoinWorker(client)._join_cycle()
    assert client.await_count == 0
    assert (await get_row(waiting))["join_status"] == "pending"


async def test_daily_cap_ignores_old_joins_and_limits_batch(client, sleeps, monkeypatch):
    monkeypatch.setattr(settings, "CHANNEL_JOIN_DAILY_CAP", 2)
    await insert_channel(10, join_status="joined", joined_at=hours_ago(25))  # outside window
    await insert_channel(11, join_status="joined", joined_at=hours_ago(1))
    ids = [await insert_channel(i) for i in (1, 2, 3)]
    client.side_effect = [None, joined_full_channel()] * 3
    await ChannelJoinWorker(client)._join_cycle()
    statuses = [(await get_row(i))["join_status"] for i in ids]
    assert statuses.count("joined") == 1  # only 1 slot left under the cap


async def test_stuck_joining_rows_reset(client, sleeps):
    stuck = await insert_channel(1, join_status="joining", join_attempted_at=hours_ago(1))
    fresh = await insert_channel(2, join_status="joining",
                                 join_attempted_at=datetime.now(timezone.utc))
    worker = ChannelJoinWorker(client)
    await worker._reset_stuck_joining()
    assert (await get_row(stuck))["join_status"] == "pending"
    assert (await get_row(fresh))["join_status"] == "joining"


async def test_cycle_recovers_stuck_row_and_joins_it(client, sleeps):
    db_id = await insert_channel(1, join_status="joining", approved=True,
                                 join_attempted_at=hours_ago(1))
    client.side_effect = [None, joined_full_channel()]
    await ChannelJoinWorker(client)._join_cycle()
    assert (await get_row(db_id))["join_status"] == "joined"
