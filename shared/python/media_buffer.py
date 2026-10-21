"""
Media buffer housekeeping.

The local buffer (MEDIA_BUFFER_PATH) is transit only: a file lives there until it is
safely in S3, then it is deleted. The database (media_files.synced_at IS NULL AND
local_path IS NOT NULL) is the retry queue. Rule: never delete a local file before the
upload succeeded or the object was verified to exist in S3 (HEAD).

Blocking minio calls are wrapped with asyncio.to_thread by the async callers.
"""

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from minio.error import S3Error
from sqlalchemy import delete, select

from models.media import MediaFile

logger = logging.getLogger(__name__)

TMP_MAX_AGE_SECONDS = 3600
SYNC_BATCH_SIZE = 20
SYNC_INTERVAL_SECONDS = 60
RETENTION_BATCH_SIZE = 200
RETENTION_INTERVAL_SECONDS = 3600
_MISSING_CODES = {"NoSuchKey", "NoSuchObject", "NotFound"}


def utcnow_naive() -> datetime:
    """media_files timestamps are `timestamp without time zone`, stored as UTC."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def s3_exists(minio, bucket: str, key: str) -> bool:
    """HEAD the object. False only when S3 says it is missing; other errors raise."""
    try:
        minio.stat_object(bucket, key)
        return True
    except S3Error as e:
        if e.code in _MISSING_CODES:
            return False
        raise


def upload_and_release(minio, bucket: str, path: Path, key: str, mime_type: str) -> None:
    """Upload, and only after fput_object returned, delete the local copy."""
    minio.fput_object(bucket_name=bucket, object_name=key, file_path=str(path), content_type=mime_type)
    path.unlink(missing_ok=True)


def mark_synced(media_file: MediaFile) -> None:
    media_file.synced_at = utcnow_naive()
    media_file.local_path = None


def clean_tmp(tmp_dir: Path, max_age_seconds: int = TMP_MAX_AGE_SECONDS) -> tuple[int, int]:
    """Delete files in tmp_dir older than max_age_seconds (partial downloads). Returns (count, bytes)."""
    count = size = 0
    cutoff = time.time() - max_age_seconds
    if not tmp_dir.is_dir():
        return 0, 0
    for root, _dirs, files in os.walk(tmp_dir):
        for name in files:
            p = Path(root) / name
            try:
                st = p.stat()
                if st.st_mtime < cutoff:
                    p.unlink()
                    count += 1
                    size += st.st_size
            except OSError as e:
                logger.warning("tmp cleanup skipped %s: %s", p.name, e)
    return count, size


async def sync_pending_once(session_factory, minio, bucket: str, after_id: int = 0,
                            limit: int = SYNC_BATCH_SIZE) -> int:
    """
    Retry one batch of unsynced rows with id > after_id. Returns the last id seen
    (0 when the batch was empty, so the caller wraps around). The cursor keeps one
    permanently failing row from blocking the rest.
    """
    async with session_factory() as session:
        rows = (await session.execute(
            select(MediaFile)
            .where(MediaFile.synced_at.is_(None), MediaFile.local_path.is_not(None), MediaFile.id > after_id)
            .order_by(MediaFile.id).limit(limit)
        )).scalars().all()
        for mf in rows:
            path = Path(mf.local_path)
            try:
                if path.is_file():
                    await asyncio.to_thread(upload_and_release, minio, bucket, path, mf.s3_key, mf.mime_type)
                    mark_synced(mf)
                    logger.info("Media sync retry uploaded %s", mf.s3_key)
                elif await asyncio.to_thread(s3_exists, minio, bucket, mf.s3_key):
                    mark_synced(mf)
                else:
                    logger.warning("Media %s: local file missing and not in S3 (id=%s)", mf.s3_key, mf.id)
            except Exception as e:
                logger.warning("Media sync retry failed for id=%s: %s", mf.id, e)
        await session.commit()
        return rows[-1].id if rows else 0


async def housekeeping_loop(session_factory, minio, bucket: str, tmp_dir: Path,
                            shutdown_event: asyncio.Event, interval: float = SYNC_INTERVAL_SECONDS) -> None:
    """Background task: retry unsynced uploads and clean old .tmp files."""
    cursor = 0
    while not shutdown_event.is_set():
        try:
            await asyncio.to_thread(clean_tmp, tmp_dir)
            cursor = await sync_pending_once(session_factory, minio, bucket, cursor)
        except Exception as e:
            logger.warning("Media housekeeping error: %s", e)
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass


async def purge_old_media_once(session_factory, minio, bucket: str, days: int,
                               limit: int = RETENTION_BATCH_SIZE) -> int:
    """Delete media first seen more than `days` ago (S3 object, buffer file, rows). Messages stay."""
    cutoff = utcnow_naive() - timedelta(days=days)
    deleted = 0
    async with session_factory() as session:
        rows = (await session.execute(
            select(MediaFile).where(MediaFile.first_seen < cutoff).order_by(MediaFile.id).limit(limit)
        )).scalars().all()
        done_ids = []
        for mf in rows:
            try:
                await asyncio.to_thread(minio.remove_object, bucket, mf.s3_key)
                if mf.local_path:
                    Path(mf.local_path).unlink(missing_ok=True)
                done_ids.append(mf.id)
            except Exception as e:
                logger.warning("Retention: could not remove %s: %s", mf.s3_key, e)
        if done_ids:
            # message_media rows go via ON DELETE CASCADE
            await session.execute(delete(MediaFile).where(MediaFile.id.in_(done_ids)))
            await session.commit()
            deleted = len(done_ids)
    if deleted:
        logger.info("Retention removed %d media files older than %d days", deleted, days)
    return deleted


async def retention_loop(session_factory, minio, bucket: str, days: int, shutdown_event: asyncio.Event,
                         interval: float = RETENTION_INTERVAL_SECONDS) -> None:
    """Background task (dev): hourly purge, repeated within a run while batches come back full."""
    while not shutdown_event.is_set():
        try:
            while await purge_old_media_once(session_factory, minio, bucket, days) >= RETENTION_BATCH_SIZE:
                pass
        except Exception as e:
            logger.warning("Media retention error: %s", e)
        try:
            await asyncio.wait_for(shutdown_event.wait(), timeout=interval)
        except asyncio.TimeoutError:
            pass
