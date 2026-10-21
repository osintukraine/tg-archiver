"""
Tests for the transit-only media buffer: upload-then-delete, retry worker, .tmp cleanup,
the reconcile script and dev retention. Need a REAL Postgres (POSTGRES_* env, schema applied);
S3 is a fake in-memory client. Rows created here use random shas and are removed afterwards.
"""

import importlib.util
import os
import time
import uuid
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
import pytest_asyncio
from minio.error import S3Error
from sqlalchemy import delete, select, text

for _k, _v in {
    "JWT_SECRET_KEY": "x" * 48,
    "REDIS_PASSWORD": "x",
    "POSTGRES_PASSWORD": "x",
    "MINIO_ENDPOINT": "x:9000",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

import media_archiver  # noqa: E402
import media_buffer  # noqa: E402
from models.base import AsyncSessionLocal, engine  # noqa: E402
from models.media import MediaFile  # noqa: E402

pytestmark = pytest.mark.asyncio
BUCKET = "test-bucket"


class FakeS3:
    def __init__(self, fail_uploads=False):
        self.objects: dict[str, bytes] = {}
        self.fail_uploads = fail_uploads

    def fput_object(self, bucket_name, object_name, file_path, content_type=None):
        if self.fail_uploads:
            raise RuntimeError("s3 down")
        self.objects[object_name] = Path(file_path).read_bytes()

    def stat_object(self, bucket, key):
        if key not in self.objects:
            raise S3Error(None, "NoSuchKey", "missing", key, "rid", "hid")
        return SimpleNamespace(size=len(self.objects[key]))

    def remove_object(self, bucket, key):
        self.objects.pop(key, None)


def new_sha() -> str:
    return uuid.uuid4().hex * 2


@pytest_asyncio.fixture
async def shas():
    created: list[str] = []
    yield created
    async with AsyncSessionLocal() as s:
        await s.execute(delete(MediaFile).where(MediaFile.sha256.in_(created)))
        await s.commit()
    await engine.dispose()  # pooled connections are bound to this test's event loop


@pytest.fixture
def buffer(tmp_path, monkeypatch):
    monkeypatch.setattr(media_archiver, "LOCAL_BUFFER_ROOT", tmp_path / BUCKET)
    monkeypatch.setattr(media_archiver, "LOCAL_BUFFER_TMP", tmp_path / ".tmp")
    return tmp_path


async def add_row(shas, buffer, s3=None, content=b"data", in_buffer=True, first_seen=None):
    """A media_files row (unsynced) with its buffer file; optionally already in S3."""
    sha = new_sha()
    shas.append(sha)
    key = f"media/{sha[:2]}/{sha[2:4]}/{sha}.jpg"
    path = buffer / BUCKET / key
    path.parent.mkdir(parents=True, exist_ok=True)
    if in_buffer:
        path.write_bytes(content)
    if s3 is not None:
        s3.objects[key] = content
    async with AsyncSessionLocal() as s:
        row = MediaFile(sha256=sha, s3_key=key, file_size=len(content), mime_type="image/jpeg",
                        storage_box_id="default", local_path=str(path), reference_count=1)
        if first_seen:
            row.first_seen = first_seen
        s.add(row)
        await s.commit()
    return sha, key, path


async def get_row(sha) -> MediaFile:
    async with AsyncSessionLocal() as s:
        return (await s.execute(select(MediaFile).where(MediaFile.sha256 == sha))).scalar_one()


async def store(shas, buffer, s3, content=b"hello"):
    arch = media_archiver.MediaArchiver(minio_client=None)
    arch.minio = s3
    arch.bucket_name = BUCKET
    tmp = buffer / ".tmp" / "dl.jpg"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_bytes(content)
    sha = new_sha()
    shas.append(sha)
    async with AsyncSessionLocal() as s:
        mid = await arch._store_new_file(s, SimpleNamespace(media=SimpleNamespace(file_id="f")), tmp, sha)
        await s.commit()
    return sha, mid


async def test_successful_upload_releases_buffer(shas, buffer):
    s3 = FakeS3()
    sha, _ = await store(shas, buffer, s3)
    row = await get_row(sha)
    assert row.synced_at is not None and row.local_path is None
    assert list(s3.objects) == [row.s3_key]
    assert not list((buffer / BUCKET).rglob("*.jpg"))


async def test_failed_upload_keeps_file_then_retry_worker_syncs(shas, buffer):
    sha, _ = await store(shas, buffer, FakeS3(fail_uploads=True))
    row = await get_row(sha)
    path = Path(row.local_path)
    assert row.synced_at is None and path.is_file()

    s3 = FakeS3()
    await media_buffer.sync_pending_once(AsyncSessionLocal, s3, BUCKET)
    row = await get_row(sha)
    assert row.synced_at is not None and row.local_path is None
    assert row.s3_key in s3.objects and not path.exists()


async def test_retry_never_deletes_before_successful_upload(shas, buffer):
    sha, key, path = await add_row(shas, buffer)
    await media_buffer.sync_pending_once(AsyncSessionLocal, FakeS3(fail_uploads=True), BUCKET)
    assert path.is_file()
    assert (await get_row(sha)).synced_at is None


async def test_retry_missing_file_marks_synced_only_if_in_s3(shas, buffer):
    s3 = FakeS3()
    in_s3 = await add_row(shas, buffer, s3=s3, in_buffer=False)
    gone = await add_row(shas, buffer, in_buffer=False)
    await media_buffer.sync_pending_once(AsyncSessionLocal, s3, BUCKET, limit=1000)
    assert (await get_row(in_s3[0])).synced_at is not None
    assert (await get_row(gone[0])).synced_at is None


async def test_clean_tmp_removes_only_old_files(tmp_path):
    old, young = tmp_path / "old.part", tmp_path / "young.part"
    old.write_bytes(b"x")
    young.write_bytes(b"x")
    past = time.time() - 2 * 3600
    os.utime(old, (past, past))
    assert media_buffer.clean_tmp(tmp_path)[0] == 1
    assert not old.exists() and young.exists()


def load_script():
    for p in (Path("/app/scripts/media_buffer_cleanup.py"),
              Path(__file__).resolve().parents[min(3, len(Path(__file__).resolve().parents) - 1)] / "scripts" / "media_buffer_cleanup.py"):
        if p.is_file():
            spec = importlib.util.spec_from_file_location("media_buffer_cleanup", p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise FileNotFoundError("media_buffer_cleanup.py")


async def test_reconcile_dry_run_classifies_and_changes_nothing(shas, buffer):
    script = load_script()
    s3 = FakeS3()
    _, _, p_in = await add_row(shas, buffer, s3=s3, content=b"in-s3")
    _, _, p_db = await add_row(shas, buffer, content=b"db-only")
    orphan = buffer / "osint-media" / "media" / "aa" / "bb" / (new_sha() + ".jpg")
    orphan.parent.mkdir(parents=True)
    orphan.write_bytes(b"orphan")
    tmp_old = buffer / ".tmp" / "old.part"
    tmp_old.parent.mkdir(exist_ok=True)
    tmp_old.write_bytes(b"x")
    past = time.time() - 7200
    os.utime(tmp_old, (past, past))

    stats = await script.reconcile(AsyncSessionLocal, s3, BUCKET, buffer)
    assert stats["counts"]["in_s3"] == 1
    assert stats["counts"]["db_not_in_s3"] == 1
    assert stats["counts"]["orphan"] == 1
    assert stats["counts"]["tmp_old"] == 1
    assert all(p.exists() for p in (p_in, p_db, orphan, tmp_old))
    assert len(s3.objects) == 1


async def test_reconcile_apply_deletes_only_verified_files(shas, buffer):
    script = load_script()
    s3 = FakeS3()
    sha_in, _, p_in = await add_row(shas, buffer, s3=s3, content=b"in-s3")
    sha_db, key_db, p_db = await add_row(shas, buffer, content=b"db-only")
    orphan = buffer / "osint-media" / "media" / "aa" / "bb" / (new_sha() + ".jpg")
    orphan.parent.mkdir(parents=True)
    orphan.write_bytes(b"orphan")
    old = time.time() - 7200
    os.utime(orphan, (old, old))

    await script.reconcile(AsyncSessionLocal, s3, BUCKET, buffer, apply=True)
    assert not p_in.exists() and not p_db.exists()
    assert key_db in s3.objects
    assert (await get_row(sha_in)).synced_at is not None
    row_db = await get_row(sha_db)
    assert row_db.synced_at is not None and row_db.local_path is None
    assert orphan.exists()  # not without --delete-orphans

    await script.reconcile(AsyncSessionLocal, s3, BUCKET, buffer, delete_orphans=True)
    assert not orphan.exists()


async def test_reconcile_keeps_file_when_upload_fails(shas, buffer):
    script = load_script()
    _, _, p_db = await add_row(shas, buffer, content=b"db-only")
    stats = await script.reconcile(AsyncSessionLocal, FakeS3(fail_uploads=True), BUCKET, buffer, apply=True)
    assert p_db.exists() and stats["errors"] == 1


async def test_retention_deletes_old_media_but_keeps_messages(shas, buffer):
    s3 = FakeS3()
    old_sha, old_key, _ = await add_row(
        shas, buffer, s3=s3, first_seen=media_buffer.utcnow_naive() - timedelta(days=10))
    new_sha_, new_key, _ = await add_row(shas, buffer, s3=s3)
    tg_id = -int(uuid.uuid4().int % 10**12)
    async with AsyncSessionLocal() as s:
        ch = (await s.execute(text(
            "INSERT INTO channels (id, telegram_id, name) VALUES (910001, :t, 'tgmb') RETURNING id"),
            {"t": tg_id})).scalar_one()
        msg = (await s.execute(text(
            "INSERT INTO messages (message_id, channel_id, content) VALUES (1, :c, 'kept') RETURNING id"),
            {"c": ch})).scalar_one()
        old_id = (await s.execute(select(MediaFile.id).where(MediaFile.sha256 == old_sha))).scalar_one()
        await s.execute(text("INSERT INTO message_media (message_id, media_file_id) VALUES (:m, :f)"),
                        {"m": msg, "f": old_id})
        await s.commit()
    try:
        assert await media_buffer.purge_old_media_once(AsyncSessionLocal, s3, BUCKET, 3, limit=1000) >= 1
        assert old_key not in s3.objects and new_key in s3.objects
        async with AsyncSessionLocal() as s:
            assert (await s.execute(select(MediaFile.id).where(MediaFile.sha256 == old_sha))).first() is None
            assert (await s.execute(select(MediaFile.id).where(MediaFile.sha256 == new_sha_))).first()
            assert (await s.execute(text("SELECT count(*) FROM message_media WHERE message_id=:m"),
                                    {"m": msg})).scalar_one() == 0
            assert (await s.execute(text("SELECT content FROM messages WHERE id=:m"), {"m": msg})).scalar_one() == "kept"
    finally:
        async with AsyncSessionLocal() as s:
            await s.execute(text("DELETE FROM channels WHERE id=:c"), {"c": ch})
            await s.commit()
