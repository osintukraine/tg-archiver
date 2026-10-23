"""Entity-extraction and media-archival metrics emitted by MessageProcessor.process.

Self-contained: the database session, router, archiver and Telegram client are stubs;
only the metric wiring is under test.
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from prometheus_client import REGISTRY

for _k, _v in {
    "JWT_SECRET_KEY": "x" * 48,
    "REDIS_PASSWORD": "x",
    "POSTGRES_PASSWORD": "x",
    "MINIO_ENDPOINT": "x:9000",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

from observability import metrics  # noqa: E402

from src import message_processor as mp  # noqa: E402
from src.redis_consumer import ProcessedMessage  # noqa: E402

CHANNEL = -1001234


def sample(name, **labels):
    return REGISTRY.get_sample_value(name, labels) or 0


class FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return False

    async def execute(self, *_a, **_k):
        return SimpleNamespace(first=lambda: ("chan", "archive_all", "Chan", "folder"))


def make_processor(monkeypatch, archiver="default", entities=None, media_override=None):
    async def get_override(key, session_factory=None):
        return media_override if key == "storage.media_enabled" else None

    monkeypatch.setattr(mp, "AsyncSessionLocal", lambda: FakeSession())
    monkeypatch.setattr(mp, "get_override", get_override)
    router = MagicMock()
    router.get_routing_decision = AsyncMock(return_value=SimpleNamespace(should_translate=False))
    extractor = MagicMock()
    extractor.extract.return_value = entities or {}
    if archiver == "default":
        archiver = MagicMock()
        archiver.archive_media = AsyncMock(return_value=None)
    client = MagicMock()
    client.get_messages = AsyncMock(return_value=[object()])
    proc = mp.MessageProcessor(router, extractor, archiver, client)
    proc._persist_message = AsyncMock()
    return proc


def message(media_type="photo", content="hello"):
    data = {"message_id": "5", "channel_id": str(CHANNEL), "content": content}
    if media_type:
        data["media_type"] = media_type
    return ProcessedMessage("1-0", data)


def failures(reason, media_type="photo"):
    return sample("tg_media_archival_failures_total", reason=reason, media_type=media_type)


async def test_entities_counted_per_type_and_duration_observed_once(monkeypatch):
    proc = make_processor(monkeypatch, entities={"hashtags": ["#a", "#b"], "urls": ["u"], "mentions": []})
    tags = sample("tg_entities_extracted_total", entity_type="hashtags", channel_id=str(CHANNEL))
    urls = sample("tg_entities_extracted_total", entity_type="urls", channel_id=str(CHANNEL))
    runs = sample("tg_entity_extraction_duration_seconds_count")

    assert await proc.process(message(media_type=None)) is True

    assert sample("tg_entities_extracted_total", entity_type="hashtags", channel_id=str(CHANNEL)) == tags + 2
    assert sample("tg_entities_extracted_total", entity_type="urls", channel_id=str(CHANNEL)) == urls + 1
    assert sample("tg_entity_extraction_duration_seconds_count") == runs + 1


async def test_media_without_archived_file_counts_no_file(monkeypatch):
    proc = make_processor(monkeypatch)
    before = failures("no_file")

    assert await proc.process(message()) is True

    assert failures("no_file") == before + 1


async def test_archiver_exception_counts_error(monkeypatch):
    archiver = MagicMock()
    archiver.archive_media = AsyncMock(side_effect=RuntimeError("boom"))
    proc = make_processor(monkeypatch, archiver=archiver)
    before = failures("error")

    assert await proc.process(message()) is True

    assert failures("error") == before + 1


async def test_missing_archiver_counts_unavailable(monkeypatch):
    proc = make_processor(monkeypatch, archiver=None)
    before = failures("unavailable")

    assert await proc.process(message()) is True

    assert failures("unavailable") == before + 1


async def test_media_disabled_by_admin_is_not_a_failure(monkeypatch):
    proc = make_processor(monkeypatch, media_override=False)
    before = sum(failures(r) for r in ("no_file", "error", "unavailable"))

    assert await proc.process(message()) is True

    assert sum(failures(r) for r in ("no_file", "error", "unavailable")) == before


async def test_archived_media_counts_once_without_touching_byte_counters(monkeypatch):
    archiver = MagicMock()
    archiver.archive_media = AsyncMock(return_value=42)
    proc = make_processor(monkeypatch, archiver=archiver)
    archived = sample("tg_media_archived_total", media_type="photo", channel_id=str(CHANNEL))
    stored = sample("tg_media_storage_bytes_total", media_type="photo")
    saved = sample("tg_media_deduplication_saves_total", media_type="photo")
    fail = failures("no_file")

    assert await proc.process(message()) is True

    assert sample("tg_media_archived_total", media_type="photo", channel_id=str(CHANNEL)) == archived + 1
    # bytes and dedup savings belong to MediaArchiver; the processor must not add to them
    assert sample("tg_media_storage_bytes_total", media_type="photo") == stored
    assert sample("tg_media_deduplication_saves_total", media_type="photo") == saved
    assert failures("no_file") == fail


def test_record_media_archived_takes_no_byte_arguments():
    with pytest.raises(TypeError):
        metrics.record_media_archived("photo", 1, 10, True)
