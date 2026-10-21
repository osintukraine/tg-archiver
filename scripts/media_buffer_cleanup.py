#!/usr/bin/env python3
"""Reconcile the local media buffer with S3 and the database (one-off cleanup).

The buffer (MEDIA_BUFFER_PATH) is transit only. Run this inside the processor container
(it has the S3 + DB config and PYTHONPATH). Dry run by default; prints counts and bytes only.

    docker compose exec processor python /app/scripts/media_buffer_cleanup.py            # dry run
    docker compose exec processor python /app/scripts/media_buffer_cleanup.py --apply
    docker compose exec processor python /app/scripts/media_buffer_cleanup.py --apply --delete-orphans
(the script is baked into the processor image; rebuild the image after pulling this change)

Every file under MEDIA_BUFFER_PATH (all top-level dirs) is classified:
  in_s3          object exists in S3 with the same size   -> delete local copy, mark row synced (--apply)
  db_not_in_s3   has a media_files row, no S3 object      -> upload, verify, delete, mark synced (--apply)
  orphan         no row and not in S3                     -> reported; deleted only with --delete-orphans
  tmp            .tmp files older than 1 h (partial downloads) -> deleted (--apply)
A local file is never deleted unless its S3 object was verified (HEAD) in the same run.
Files younger than 1 h are never treated as orphans (they may belong to an in-flight transaction).
Safe to re-run and to interrupt: each file is handled independently.
"""

import argparse
import asyncio
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from minio.error import S3Error
from sqlalchemy import select

from media_buffer import mark_synced
from models.media import MediaFile

BATCH = 500
YOUNG_SECONDS = 3600
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def iter_files(root: Path):
    """Yield (path, top_level_dir_name, size, mtime) for every file under root."""
    for top in sorted(p for p in root.iterdir() if p.is_dir()):
        for dirpath, _dirs, files in os.walk(top):
            for name in files:
                p = Path(dirpath) / name
                try:
                    st = p.stat()
                except OSError:
                    continue
                yield p, top.name, st.st_size, st.st_mtime


def _verified_in_s3(minio, bucket: str, key: str, size: int) -> bool:
    """HEAD the object; True only if it exists with the same size."""
    try:
        return minio.stat_object(bucket, key).size == size
    except S3Error as e:
        if e.code in {"NoSuchKey", "NoSuchObject", "NotFound"}:
            return False
        raise


def _upload_verify_release(minio, bucket: str, path: Path, row: MediaFile, size: int) -> None:
    minio.fput_object(bucket_name=bucket, object_name=row.s3_key, file_path=str(path),
                      content_type=row.mime_type)
    if not _verified_in_s3(minio, bucket, row.s3_key, size):
        raise RuntimeError("upload not verified by HEAD")
    path.unlink(missing_ok=True)


async def reconcile(session_factory, minio, bucket: str, root: Path, apply: bool = False,
                    delete_orphans: bool = False, now: float | None = None) -> dict:
    now = now if now is not None else time.time()
    apply = apply or delete_orphans
    stats: dict = {"counts": defaultdict(int), "bytes": defaultdict(int),
                   "orphans": defaultdict(lambda: [0, 0]), "errors": 0}

    def add(cls: str, size: int) -> None:
        stats["counts"][cls] += 1
        stats["bytes"][cls] += size

    async def handle_batch(batch: list) -> None:
        shas = {p.stem for p, *_ in batch if SHA_RE.match(p.stem)}
        async with session_factory() as session:
            rows = {}
            if shas:
                found = (await session.execute(select(MediaFile).where(MediaFile.sha256.in_(shas)))).scalars()
                rows = {r.sha256: r for r in found}
            for path, top, size, mtime in batch:
                row = rows.get(path.stem)
                if SHA_RE.match(path.stem):
                    key = row.s3_key if row else f"media/{path.stem[:2]}/{path.stem[2:4]}/{path.name}"
                else:
                    key = None
                try:
                    if key and await asyncio.to_thread(_verified_in_s3, minio, bucket, key, size):
                        add("in_s3", size)
                        if apply:
                            if row:
                                mark_synced(row)
                            path.unlink(missing_ok=True)
                    elif row:
                        add("db_not_in_s3", size)
                        if apply:
                            await asyncio.to_thread(_upload_verify_release, minio, bucket, path, row, size)
                            mark_synced(row)
                    else:
                        add("orphan", size)
                        month = datetime.fromtimestamp(mtime).strftime("%Y-%m")
                        g = stats["orphans"][(top, month)]
                        g[0] += 1
                        g[1] += size
                        if delete_orphans and now - mtime >= YOUNG_SECONDS:
                            path.unlink(missing_ok=True)
                except Exception as e:  # keep going; the file stays untouched
                    stats["errors"] += 1
                    print(f"error on {path.name}: {type(e).__name__}: {e}", file=sys.stderr)
            await session.commit()

    batch: list = []
    for item in iter_files(root):
        path, top, size, mtime = item
        if top == ".tmp":
            if now - mtime >= YOUNG_SECONDS:
                add("tmp_old", size)
                if apply:
                    path.unlink(missing_ok=True)
            else:
                add("tmp_young", size)
            continue
        batch.append(item)
        if len(batch) >= BATCH:
            await handle_batch(batch)
            batch = []
    if batch:
        await handle_batch(batch)
    return stats


def print_report(stats: dict, apply: bool, delete_orphans: bool) -> None:
    mode = "APPLIED" if (apply or delete_orphans) else "DRY RUN (nothing changed)"
    print(f"== media buffer reconcile: {mode} ==")
    for cls in ("in_s3", "db_not_in_s3", "orphan", "tmp_old", "tmp_young"):
        print(f"{cls:14s} files={stats['counts'][cls]:>8d} bytes={stats['bytes'][cls]:>15d}")
    if stats["orphans"]:
        print("orphans by top-level dir / month:")
        for (top, month), (n, size) in sorted(stats["orphans"].items()):
            print(f"  {top:20s} {month} files={n:>8d} bytes={size:>15d}")
    if stats["errors"]:
        print(f"errors: {stats['errors']} (see stderr)")
    if not (apply or delete_orphans):
        print("re-run with --apply (in_s3, db_not_in_s3, old .tmp) and --delete-orphans (orphans)")


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="delete verified files, upload db_not_in_s3, clean old .tmp")
    ap.add_argument("--delete-orphans", action="store_true", help="also delete orphans (implies --apply)")
    args = ap.parse_args()

    from minio import Minio

    from config.settings import settings
    from models.base import AsyncSessionLocal  # imported late: needs DB env

    root = Path(os.environ.get("MEDIA_BUFFER_PATH", "/var/cache/media-buffer"))
    minio = Minio(settings.MINIO_ENDPOINT, access_key=settings.MINIO_ACCESS_KEY,
                  secret_key=settings.MINIO_SECRET_KEY, secure=settings.MINIO_SECURE)
    stats = await reconcile(AsyncSessionLocal, minio, settings.MINIO_BUCKET_NAME, root,
                            apply=args.apply, delete_orphans=args.delete_orphans)
    print_report(stats, args.apply, args.delete_orphans)
    return 1 if stats["errors"] else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
