"""
Media Archiver - Content-Addressed Storage with SHA-256 Deduplication

Archives Telegram media files using content-addressed storage with local buffer.
Saves 30-40% storage costs by storing each unique file only once.

Architecture (with local buffer for low-latency serving):
1. Download media from Telegram to local buffer .tmp/
2. Calculate SHA-256 hash
3. Check if file already exists (by hash)
4. If exists: increment reference_count, skip
5. If new: atomic move to local buffer, create MediaFile record, queue sync job
6. Background sync worker uploads to MinIO/Hetzner and updates synced_at

Storage Paths:
- Local buffer: /var/cache/tg-media-buffer/tg-media/media/{hash[:2]}/{hash[2:4]}/{hash}.ext
- MinIO/Hetzner: media/{hash[:2]}/{hash[2:4]}/{hash}.ext

Benefits:
- Low latency: Media available immediately in browser (local buffer)
- Durability: Async sync to Hetzner for permanent storage
- Deduplication: Same file posted multiple times = stored once
- Integrity: SHA-256 hash verifies file integrity
- Resilient: Works even when Hetzner mount is unavailable
"""

import asyncio
import hashlib
import json
import logging
import mimetypes
import os
import shutil
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, List

from config import Timeouts

import redis.asyncio as aioredis
from minio import Minio
from minio.error import S3Error
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.types import Message as TelegramMessage

from config.settings import settings
from models.media import MediaFile, MessageMedia
from models.message import Message

# Storage box selection simplified for tg-archiver
# (BoxSelector was removed - it was OSINT-specific multi-box routing)

# Local buffer paths (neutral naming, configurable bucket subfolder)
MEDIA_BUFFER_PATH = os.environ.get("MEDIA_BUFFER_PATH", "/var/cache/media-buffer")
BUFFER_BUCKET_NAME = os.environ.get("MINIO_BUCKET_NAME", "tg-archive-media")
LOCAL_BUFFER_ROOT = Path(MEDIA_BUFFER_PATH) / BUFFER_BUCKET_NAME
LOCAL_BUFFER_TMP = Path(MEDIA_BUFFER_PATH) / ".tmp"

# Redis sync queue
MEDIA_SYNC_QUEUE = "media:sync:pending"

# Import Prometheus metrics
from observability.metrics import (
    media_download_duration_seconds,
    media_storage_bytes_total,
    media_deduplication_saves_total,
    media_errors_total,
)

logger = logging.getLogger(__name__)


class MediaArchiver:
    """
    Archives Telegram media with content-addressed storage.

    Uses SHA-256 hashing for deduplication.
    Writes to local buffer first, then queues async sync to Hetzner.
    """

    def __init__(
        self,
        minio_client: Optional[Minio] = None,
        redis_client: Optional[aioredis.Redis] = None,
        storage_box_id: Optional[str] = None,
    ):
        """
        Initialize media archiver.

        Args:
            minio_client: MinIO client for object storage
            redis_client: Redis client for queuing sync jobs
            storage_box_id: Storage box identifier (default: "default")
        """
        self.minio = minio_client
        self.redis = redis_client
        self.storage_box_id = storage_box_id or "default"
        self.bucket_name = settings.MINIO_BUCKET_NAME

        # Ensure local buffer directories exist
        self._ensure_local_buffer()

        # Ensure MinIO bucket exists (if client provided)
        if self.minio:
            self._ensure_bucket()

        # Statistics
        self.files_downloaded = 0
        self.files_uploaded = 0
        self.files_deduplicated = 0
        self.files_queued_for_sync = 0
        self.bytes_saved = 0

    def _ensure_local_buffer(self):
        """Ensure local buffer directories exist."""
        try:
            LOCAL_BUFFER_ROOT.mkdir(parents=True, exist_ok=True)
            (LOCAL_BUFFER_ROOT / "media").mkdir(parents=True, exist_ok=True)
            LOCAL_BUFFER_TMP.mkdir(parents=True, exist_ok=True)
            logger.debug(f"Local buffer directories ready: {LOCAL_BUFFER_ROOT}")
        except Exception as e:
            logger.error(f"Failed to create local buffer directories: {e}")
            raise

    def _ensure_bucket(self):
        """Ensure MinIO bucket exists."""
        try:
            if not self.minio.bucket_exists(self.bucket_name):
                self.minio.make_bucket(self.bucket_name)
                logger.info(f"Created MinIO bucket: {self.bucket_name}")
        except S3Error as e:
            logger.error(f"Failed to create bucket: {e}")
            raise

    def _get_local_buffer_path(self, sha256: str, extension: str) -> Path:
        """
        Get the local buffer path for a media file.

        Args:
            sha256: File hash
            extension: File extension (e.g., ".jpg")

        Returns:
            Full path in local buffer
        """
        return LOCAL_BUFFER_ROOT / "media" / sha256[:2] / sha256[2:4] / f"{sha256}{extension}"

    async def _queue_sync_job(
        self, sha256: str, s3_key: str, local_path: str, file_size: int, storage_box_id: str
    ):
        """
        Queue a sync job to Redis for background upload to Hetzner.

        Args:
            sha256: File hash
            s3_key: S3 object key
            local_path: Path in local buffer
            file_size: File size in bytes
            storage_box_id: Target storage box ID for sync
        """
        if not self.redis:
            logger.warning("Redis not configured, skipping sync job queue")
            return

        job = {
            "sha256": sha256,
            "s3_key": s3_key,
            "local_path": local_path,
            "storage_box_id": storage_box_id,
            "file_size": file_size,
            "queued_at": datetime.utcnow().isoformat(),
        }

        try:
            await self.redis.lpush(MEDIA_SYNC_QUEUE, json.dumps(job))
            self.files_queued_for_sync += 1
            logger.debug(f"Queued sync job for {sha256[:16]}... to {storage_box_id}")
        except Exception as e:
            logger.error(f"Failed to queue sync job: {e}")
            # Don't raise - file is still in local buffer and accessible

    def _select_storage_box(self) -> str:
        """
        Get storage box ID for media files.

        Returns:
            Storage box ID string (always returns self.storage_box_id)
        """
        return self.storage_box_id

    async def archive_media(
        self,
        telegram_client: TelegramClient,
        telegram_message: TelegramMessage,
        message_db_id: int,
        session: AsyncSession,
    ) -> Optional[int]:
        """
        Archive media from Telegram message.

        Args:
            telegram_client: Telethon client for downloading
            telegram_message: Telegram message with media
            message_db_id: Database message ID (can be None if message not yet persisted)
            session: Database session

        Returns:
            MediaFile ID if successful, None if no media or failure

        Raises:
            Exception: If download or upload fails
        """
        if not telegram_message.media:
            return None

        try:
            # Download media to temp file
            temp_path = await self._download_media(telegram_client, telegram_message)

            if not temp_path:
                logger.warning("Failed to download media")
                return None

            # Calculate SHA-256 hash
            sha256 = self._calculate_hash(temp_path)

            # Check if file already exists (deduplication)
            result = await session.execute(
                select(MediaFile).where(MediaFile.sha256 == sha256)
            )
            existing_file = result.scalar_one_or_none()

            if existing_file:
                # File already archived - just increment reference count
                existing_file.reference_count += 1
                media_file_id = existing_file.id

                self.files_deduplicated += 1
                self.bytes_saved += existing_file.file_size

                # Record deduplication metrics
                mime_type = self._get_mime_type(temp_path)
                media_type_label = mime_type.split('/')[0] if '/' in mime_type else "unknown"
                media_deduplication_saves_total.labels(
                    media_type=media_type_label
                ).inc(existing_file.file_size)

                logger.info(
                    f"Media deduplicated: {sha256[:16]}... "
                    f"(references: {existing_file.reference_count}, "
                    f"saved {existing_file.file_size} bytes)"
                )

            else:
                # New file - write to local buffer, queue sync to Hetzner
                s3_key = self._get_s3_key(sha256, temp_path)
                file_size = temp_path.stat().st_size
                mime_type = self._get_mime_type(temp_path)
                extension = temp_path.suffix or ".bin"

                # Select storage box (dynamic or fixed)
                selected_box_id = self._select_storage_box()

                # Move to local buffer (atomic operation)
                local_buffer_path = self._get_local_buffer_path(sha256, extension)
                local_buffer_path.parent.mkdir(parents=True, exist_ok=True)

                # Atomic move from temp to final location
                shutil.move(str(temp_path), str(local_buffer_path))
                temp_path = None  # Mark as moved (don't delete later)

                logger.info(f"Media written to local buffer: {local_buffer_path}")

                # Create MediaFile record with local_path (synced_at=NULL means pending sync)
                media_file = MediaFile(
                    sha256=sha256,
                    s3_key=s3_key,
                    file_size=file_size,
                    mime_type=mime_type,
                    storage_box_id=selected_box_id,
                    local_path=str(local_buffer_path),
                    synced_at=None,  # Will be set when sync worker uploads to Hetzner
                    telegram_file_id=getattr(telegram_message.media, 'file_id', None),
                    telegram_url=None,  # Telegram URLs expire
                    reference_count=1,
                )

                session.add(media_file)
                await session.flush()  # Get the ID

                media_file_id = media_file.id

                # Upload directly to MinIO
                # Note: For remote storage with Hetzner SSHFS, use media-sync worker instead
                if self.minio:
                    try:
                        await self._upload_to_minio(local_buffer_path, s3_key, mime_type)
                        logger.info(f"Uploaded to MinIO: {s3_key}")
                    except Exception as e:
                        logger.error(f"MinIO upload failed: {e}", exc_info=True)
                        # Queue sync job as fallback
                        await self._queue_sync_job(
                            sha256, s3_key, str(local_buffer_path), file_size, selected_box_id
                        )
                else:
                    logger.warning("MinIO client not available, queuing for sync")
                    # Queue sync job as fallback
                    await self._queue_sync_job(
                        sha256, s3_key, str(local_buffer_path), file_size, selected_box_id
                    )

                self.files_uploaded += 1

                # Record storage metrics
                media_type_label = mime_type.split('/')[0] if '/' in mime_type else "unknown"
                media_storage_bytes_total.labels(
                    media_type=media_type_label
                ).inc(file_size)

                logger.info(
                    f"Media archived to local buffer: {sha256[:16]}... "
                    f"({file_size} bytes, {mime_type}, box={selected_box_id})"
                )

            # Return media_file_id so caller can create MessageMedia relationship
            # AFTER the message is persisted to the database
            # NOTE: session.flush() was called above to get the media_file.id
            # but we don't commit here - let the caller commit atomically

            # Clean up temp file (if not moved to buffer)
            if temp_path:
                temp_path.unlink(missing_ok=True)

            return media_file_id

        except FloodWaitError as e:
            logger.warning(f"Flood wait during media download: {e.seconds} seconds")
            raise
        except Exception as e:
            logger.exception(f"Failed to archive media: {e}")
            raise

    async def archive_album(
        self,
        telegram_client: TelegramClient,
        channel_id: int,
        message_ids: List[int],
        session: AsyncSession,
    ) -> List[int]:
        """
        Archive all media files from a Telegram album (grouped messages).

        This downloads ALL media files from all messages in the album and stores
        them with deduplication.

        Args:
            telegram_client: Telethon client for downloading
            channel_id: Telegram channel ID
            message_ids: List of ALL message IDs in the album
            session: Database session

        Returns:
            List of MediaFile IDs (one per media file successfully archived)

        Raises:
            Exception: If any download or upload fails
        """
        media_file_ids = []

        logger.info(
            f"Archiving album with {len(message_ids)} media files from channel {channel_id}"
        )

        for msg_id in message_ids:
            try:
                # Fetch the message from Telegram
                telegram_msg = await telegram_client.get_messages(channel_id, ids=msg_id)

                if not telegram_msg:
                    logger.warning(
                        f"Message {msg_id} not found in channel {channel_id}, skipping"
                    )
                    continue

                if not telegram_msg.media:
                    logger.warning(
                        f"Message {msg_id} has no media, skipping"
                    )
                    continue

                # Archive this media file (same logic as archive_media but without message_db_id)
                media_file_id = await self._archive_single_media(
                    telegram_client, telegram_msg, session
                )

                if media_file_id:
                    media_file_ids.append(media_file_id)
                    logger.debug(
                        f"Archived media from message {msg_id}: media_file_id={media_file_id}"
                    )

            except Exception as e:
                logger.error(
                    f"Failed to archive media from message {msg_id} in album: {e}"
                )
                # Continue with next media file instead of failing entire album
                continue

        logger.info(
            f"Album archived: {len(media_file_ids)}/{len(message_ids)} media files successful"
        )

        return media_file_ids

    async def _archive_single_media(
        self,
        telegram_client: TelegramClient,
        telegram_message: TelegramMessage,
        session: AsyncSession,
    ) -> Optional[int]:
        """
        Archive a single media file (extracted from archive_media for reuse).

        Args:
            telegram_client: Telethon client
            telegram_message: Telegram message with media
            session: Database session

        Returns:
            MediaFile ID or None if failed
        """
        if not telegram_message.media:
            return None

        try:
            # Download media to temp file
            temp_path = await self._download_media(telegram_client, telegram_message)

            if not temp_path:
                logger.warning("Failed to download media")
                return None

            # Calculate SHA-256 hash
            sha256 = self._calculate_hash(temp_path)

            # Check if file already exists (deduplication)
            result = await session.execute(
                select(MediaFile).where(MediaFile.sha256 == sha256)
            )
            existing_file = result.scalar_one_or_none()

            if existing_file:
                # File already archived - just increment reference count
                existing_file.reference_count += 1
                media_file_id = existing_file.id

                self.files_deduplicated += 1
                self.bytes_saved += existing_file.file_size

                # Record deduplication metrics
                mime_type = self._get_mime_type(temp_path)
                media_type_label = mime_type.split('/')[0] if '/' in mime_type else "unknown"
                media_deduplication_saves_total.labels(
                    media_type=media_type_label
                ).inc(existing_file.file_size)

                logger.info(
                    f"Media deduplicated: {sha256[:16]}... "
                    f"(references: {existing_file.reference_count}, "
                    f"saved {existing_file.file_size} bytes)"
                )

            else:
                # New file - write to local buffer, queue sync to Hetzner
                s3_key = self._get_s3_key(sha256, temp_path)
                file_size = temp_path.stat().st_size
                mime_type = self._get_mime_type(temp_path)
                extension = temp_path.suffix or ".bin"

                # Select storage box (dynamic or fixed)
                selected_box_id = self._select_storage_box()

                # Move to local buffer (atomic operation)
                local_buffer_path = self._get_local_buffer_path(sha256, extension)
                local_buffer_path.parent.mkdir(parents=True, exist_ok=True)

                # Atomic move from temp to final location
                shutil.move(str(temp_path), str(local_buffer_path))
                temp_path = None  # Mark as moved

                # Create MediaFile record with local_path
                media_file = MediaFile(
                    sha256=sha256,
                    s3_key=s3_key,
                    file_size=file_size,
                    mime_type=mime_type,
                    storage_box_id=selected_box_id,
                    local_path=str(local_buffer_path),
                    synced_at=None,
                    telegram_file_id=getattr(telegram_message.media, 'file_id', None),
                    telegram_url=None,  # Telegram URLs expire
                    reference_count=1,
                )

                session.add(media_file)
                await session.flush()  # Get the ID

                media_file_id = media_file.id

                # Upload directly to MinIO (tg-archiver simplified mode)
                if self.minio:
                    try:
                        await self._upload_to_minio(local_buffer_path, s3_key, mime_type)
                        logger.info(f"Uploaded to MinIO: {s3_key}")
                    except Exception as e:
                        logger.error(f"MinIO upload failed: {e}", exc_info=True)
                        await self._queue_sync_job(
                            sha256, s3_key, str(local_buffer_path), file_size, selected_box_id
                        )
                else:
                    logger.warning("MinIO client not available, queuing for sync")
                    await self._queue_sync_job(
                        sha256, s3_key, str(local_buffer_path), file_size, selected_box_id
                    )

                self.files_uploaded += 1

                # Record storage metrics
                media_type_label = mime_type.split('/')[0] if '/' in mime_type else "unknown"
                media_storage_bytes_total.labels(
                    media_type=media_type_label
                ).inc(file_size)

                logger.info(
                    f"Media archived to local buffer: {sha256[:16]}... "
                    f"({file_size} bytes, {mime_type}, box={selected_box_id})"
                )

            # Clean up temp file (if not moved to buffer)
            if temp_path:
                temp_path.unlink(missing_ok=True)

            return media_file_id

        except Exception as e:
            logger.exception(f"Failed to archive single media: {e}")
            return None

    async def _download_media(
        self, client: TelegramClient, message: TelegramMessage
    ) -> Optional[Path]:
        """
        Download media from Telegram message.

        Handles special cases:
        - MessageMediaWebPage: Downloads the OpenGraph thumbnail from webpage.photo
        - Other media: Uses standard Telethon download

        Args:
            client: Telethon client
            message: Telegram message

        Returns:
            Path to downloaded file or None if failed
        """
        download_start = time.time()
        media_type = self._get_media_type_label(message)

        try:
            # Download to local buffer's .tmp directory (same filesystem for atomic moves)
            LOCAL_BUFFER_TMP.mkdir(parents=True, exist_ok=True)

            # Special handling for webpage previews (OpenGraph thumbnails)
            # Telethon's download_media() returns None for MessageMediaWebPage,
            # so we need to explicitly extract and download the thumbnail photo
            if hasattr(message.media, 'webpage') and message.media.webpage:
                webpage = message.media.webpage
                if hasattr(webpage, 'photo') and webpage.photo:
                    # Download the webpage's OpenGraph thumbnail
                    logger.debug(f"Downloading webpage thumbnail for {getattr(webpage, 'url', 'unknown URL')}")
                    file_path = await client.download_media(webpage.photo, file=str(LOCAL_BUFFER_TMP))
                    if file_path:
                        path = Path(file_path)
                        download_duration = time.time() - download_start
                        media_download_duration_seconds.labels(
                            media_type="webpage_thumb"
                        ).observe(download_duration)
                        self.files_downloaded += 1
                        logger.info(f"Downloaded webpage thumbnail: {path.name}")
                        return path
                # No downloadable thumbnail in webpage
                logger.debug("Webpage has no downloadable photo thumbnail")
                return None

            # Download (Telethon handles the actual download)
            file_path = await client.download_media(message, file=str(LOCAL_BUFFER_TMP))

            if file_path:
                self.files_downloaded += 1
                path = Path(file_path)

                # Record download duration metric
                download_duration = time.time() - download_start
                media_download_duration_seconds.labels(
                    media_type=media_type
                ).observe(download_duration)

                # Process video files for web streaming (move moov atom to start)
                if path.suffix.lower() in ('.mp4', '.mov', '.m4v'):
                    processed_path = await self._process_video_for_streaming(path)
                    if processed_path:
                        return processed_path
                    # If processing failed, return original file

                return path

            # Record error if no file downloaded
            media_errors_total.labels(error_type="download_empty").inc()
            return None

        except Exception as e:
            # Record download error metric
            media_errors_total.labels(error_type="download_failed").inc()
            logger.error(f"Failed to download media: {e}")
            return None

    def _get_media_type_label(self, message: TelegramMessage) -> str:
        """Get a label for the media type from a Telegram message."""
        if hasattr(message, 'photo') and message.photo:
            return "photo"
        elif hasattr(message, 'video') and message.video:
            return "video"
        elif hasattr(message, 'document') and message.document:
            return "document"
        elif hasattr(message, 'audio') and message.audio:
            return "audio"
        elif hasattr(message, 'voice') and message.voice:
            return "voice"
        elif hasattr(message, 'video_note') and message.video_note:
            return "video_note"
        else:
            return "unknown"

    async def _process_video_for_streaming(self, video_path: Path) -> Optional[Path]:
        """
        Process video file for web streaming by moving moov atom to the start.

        Telegram videos have the moov atom at the END of the file, which prevents
        progressive playback in browsers. This uses ffmpeg to move the moov atom
        to the start (faststart) without re-encoding.

        Args:
            video_path: Path to the original video file

        Returns:
            Path to processed video file, or None if processing failed
        """
        # Check if ffmpeg is available
        if not shutil.which('ffmpeg'):
            logger.warning("ffmpeg not found, skipping video faststart processing")
            return None

        try:
            # Create output path
            output_path = video_path.with_suffix('.faststart' + video_path.suffix)

            # Run ffmpeg to move moov atom to start (faststart)
            # -movflags +faststart moves the moov atom to the beginning
            # -c copy avoids re-encoding (very fast, no quality loss)
            # Using create_subprocess_exec (safe - no shell, args as list)
            cmd = [
                'ffmpeg',
                '-y',  # Overwrite output
                '-i', str(video_path),
                '-c', 'copy',  # No re-encoding
                '-movflags', '+faststart',
                str(output_path),
            ]

            # Run ffmpeg in subprocess (safe: no shell execution)
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )

            _, stderr = await asyncio.wait_for(process.communicate(), timeout=Timeouts.FFMPEG_PROCESS)

            if process.returncode != 0:
                logger.warning(
                    f"ffmpeg faststart failed (code {process.returncode}): "
                    f"{stderr.decode()[:200] if stderr else 'no error output'}"
                )
                # Clean up failed output
                output_path.unlink(missing_ok=True)
                return None

            # Replace original with processed file
            video_path.unlink(missing_ok=True)
            output_path.rename(video_path)

            logger.info(f"Video processed for streaming: {video_path.name}")
            return video_path

        except asyncio.TimeoutError:
            logger.warning(f"ffmpeg faststart timed out for {video_path.name}")
            return None
        except Exception as e:
            logger.warning(f"Video faststart processing failed: {e}")
            return None

    def _calculate_hash(self, file_path: Path) -> str:
        """
        Calculate SHA-256 hash of file.

        Args:
            file_path: Path to file

        Returns:
            Hex-encoded SHA-256 hash
        """
        sha256_hash = hashlib.sha256()

        with open(file_path, "rb") as f:
            # Read in chunks to handle large files
            for chunk in iter(lambda: f.read(4096), b""):
                sha256_hash.update(chunk)

        return sha256_hash.hexdigest()

    def _get_s3_key(self, sha256: str, file_path: Path) -> str:
        """
        Generate S3 key using nested directory structure.

        Args:
            sha256: SHA-256 hash
            file_path: Original file path (for extension)

        Returns:
            S3 key path

        Example:
            media/ab/cd/abcdef123...789.jpg
        """
        # Get file extension
        ext = file_path.suffix or ".bin"

        # Create nested path: first 2 chars / next 2 chars / full hash
        return f"media/{sha256[:2]}/{sha256[2:4]}/{sha256}{ext}"

    def _get_mime_type(self, file_path: Path) -> str:
        """
        Detect MIME type from file.

        Args:
            file_path: Path to file

        Returns:
            MIME type string
        """
        mime_type, _ = mimetypes.guess_type(str(file_path))
        return mime_type or "application/octet-stream"

    async def _upload_to_minio(self, file_path: Path, s3_key: str, mime_type: str):
        """
        Upload file to MinIO.

        Args:
            file_path: Local file path
            s3_key: S3 object key
            mime_type: MIME type

        Raises:
            S3Error: If upload fails
        """
        try:
            self.minio.fput_object(
                bucket_name=self.bucket_name,
                object_name=s3_key,
                file_path=str(file_path),
                content_type=mime_type,
            )

            logger.debug(f"Uploaded to MinIO: {s3_key} ({mime_type})")

        except S3Error as e:
            logger.error(f"Failed to upload to MinIO: {e}")
            raise

    def get_stats(self) -> dict:
        """
        Get media archiver statistics.

        Returns:
            Dictionary with stats
        """
        dedup_rate = (
            self.files_deduplicated / (self.files_uploaded + self.files_deduplicated)
            if (self.files_uploaded + self.files_deduplicated) > 0
            else 0.0
        )

        return {
            "files_downloaded": self.files_downloaded,
            "files_uploaded": self.files_uploaded,
            "files_deduplicated": self.files_deduplicated,
            "deduplication_rate": dedup_rate,
            "bytes_saved": self.bytes_saved,
            "bytes_saved_mb": self.bytes_saved / (1024 * 1024),
        }
