"""
Import Processor - Rate-limited channel joining for import jobs.

Joins channels from import jobs with strict rate limiting to avoid Telegram bans:
1. Processes one channel at a time with 30-60 second delays
2. Creates/updates Telegram folders as needed
3. Adds joined channels to appropriate folders
4. Updates channel table and import job records

Consumes from Redis stream 'import:start' or polls database directly.
"""

import asyncio
import logging
import random
from datetime import datetime
from typing import Optional

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    UserAlreadyParticipantError,
)
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.types import Channel as TelegramChannel

from models import Channel, ImportJob, ImportJobChannel, ImportJobLog
from .folder_manager import FolderManager

logger = logging.getLogger(__name__)


class ImportProcessor:
    """
    Processes import jobs by joining channels with rate limiting.

    Rate limits:
    - 30-60 seconds between channel joins (randomized)
    - Respects Telegram FloodWait errors
    - Maximum 50 channels per hour
    """

    # Rate limiting configuration
    MIN_DELAY_SECONDS = 30
    MAX_DELAY_SECONDS = 60
    FLOOD_BACKOFF_MULTIPLIER = 1.5

    def __init__(
        self,
        client: TelegramClient,
        db_session_factory,
        folder_manager: FolderManager,
    ):
        """
        Initialize ImportProcessor.

        Args:
            client: Authenticated Telethon client
            db_session_factory: Async session factory for database access
            folder_manager: FolderManager for folder creation/updates
        """
        self.client = client
        self.db_session_factory = db_session_factory
        self.folder_manager = folder_manager

    async def process_job(self, job_id: str) -> dict:
        """
        Process an import job - join all selected channels.

        Args:
            job_id: UUID of the import job

        Returns:
            Statistics dict with counts
        """
        stats = {
            "joined": 0,
            "failed": 0,
            "skipped": 0,
            "already_member": 0,
        }

        async with self.db_session_factory() as session:
            # Get job
            result = await session.execute(
                select(ImportJob).where(ImportJob.id == job_id)
            )
            job = result.scalar_one_or_none()

            if not job:
                logger.error(f"Import job {job_id} not found")
                return stats

            if job.status == "cancelled":
                logger.info(f"Job {job_id} was cancelled, skipping")
                return stats

            if job.status != "processing":
                logger.warning(f"Job {job_id} in unexpected state: {job.status}")
                # Update to processing
                await session.execute(
                    update(ImportJob)
                    .where(ImportJob.id == job_id)
                    .values(status="processing", started_at=datetime.utcnow())
                )
                await session.commit()

            # Get selected, validated channels
            result = await session.execute(
                select(ImportJobChannel).where(
                    and_(
                        ImportJobChannel.import_job_id == job_id,
                        ImportJobChannel.selected == True,
                        ImportJobChannel.status == "validated",
                    )
                )
            )
            channels = list(result.scalars().all())

            logger.info(f"Processing {len(channels)} channels for job {job_id}")

            for i, channel in enumerate(channels):
                # Check if job was cancelled
                job_check = await session.execute(
                    select(ImportJob.status).where(ImportJob.id == job_id)
                )
                current_status = job_check.scalar()
                if current_status == "cancelled":
                    logger.info(f"Job {job_id} cancelled, stopping processing")
                    await self._add_log(
                        session,
                        job_id,
                        "warning",
                        f"Processing stopped - job cancelled at channel {i+1}/{len(channels)}",
                        event_code="JOB_CANCELLED",
                    )
                    await session.commit()
                    break

                try:
                    result = await self._join_channel(channel, session, job_id)

                    if result == "joined":
                        stats["joined"] += 1
                        # Update job counter
                        await session.execute(
                            update(ImportJob)
                            .where(ImportJob.id == job_id)
                            .values(joined_channels=ImportJob.joined_channels + 1)
                        )
                    elif result == "already_member":
                        stats["already_member"] += 1
                        stats["joined"] += 1
                        await session.execute(
                            update(ImportJob)
                            .where(ImportJob.id == job_id)
                            .values(joined_channels=ImportJob.joined_channels + 1)
                        )
                    elif result == "skipped":
                        stats["skipped"] += 1
                    else:
                        stats["failed"] += 1
                        await session.execute(
                            update(ImportJob)
                            .where(ImportJob.id == job_id)
                            .values(failed_channels=ImportJob.failed_channels + 1)
                        )

                    await session.commit()

                except FloodWaitError as e:
                    wait_time = int(e.seconds * self.FLOOD_BACKOFF_MULTIPLIER)
                    logger.warning(f"FloodWait - waiting {wait_time}s")

                    await self._add_log(
                        session,
                        job_id,
                        "warning",
                        f"Rate limited by Telegram - waiting {wait_time}s "
                        f"(channel {i+1}/{len(channels)})",
                        event_code="FLOOD_WAIT",
                    )
                    await session.commit()

                    await asyncio.sleep(wait_time)

                    # Retry once
                    try:
                        result = await self._join_channel(channel, session, job_id)
                        if result in ("joined", "already_member"):
                            stats["joined"] += 1
                        else:
                            stats["failed"] += 1
                    except Exception:
                        stats["failed"] += 1

                    await session.commit()

                except Exception as e:
                    logger.error(f"Error processing channel: {e}")
                    stats["failed"] += 1

                    await session.execute(
                        update(ImportJob)
                        .where(ImportJob.id == job_id)
                        .values(failed_channels=ImportJob.failed_channels + 1)
                    )
                    await session.commit()

                # Rate limiting delay (except for last channel)
                if i < len(channels) - 1:
                    delay = random.randint(self.MIN_DELAY_SECONDS, self.MAX_DELAY_SECONDS)
                    logger.debug(f"Rate limit delay: {delay}s before next channel")
                    await asyncio.sleep(delay)

            # Update final job status
            await session.execute(
                update(ImportJob)
                .where(ImportJob.id == job_id)
                .values(
                    status="completed",
                    completed_at=datetime.utcnow(),
                )
            )

            await self._add_log(
                session,
                job_id,
                "success",
                f"Import complete: {stats['joined']} joined, "
                f"{stats['failed']} failed, {stats['skipped']} skipped",
                event_code="IMPORT_COMPLETE",
            )

            await session.commit()

            logger.info(
                f"Import complete for job {job_id}: "
                f"{stats['joined']} joined, {stats['failed']} failed"
            )

        return stats

    async def _join_channel(
        self,
        import_channel: ImportJobChannel,
        session: AsyncSession,
        job_id: str,
    ) -> str:
        """
        Join a single channel and add to folder.

        Returns:
            Status string: "joined", "already_member", "skipped", or "failed"
        """
        username = import_channel.channel_username
        target_folder = import_channel.target_folder
        validation_data = import_channel.validation_data or {}

        if not username:
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == import_channel.id)
                .values(
                    status="join_failed",
                    error_code="NO_USERNAME",
                    error_message="Channel has no username",
                )
            )
            return "failed"

        # Check if already member
        if validation_data.get("already_member"):
            telegram_id = validation_data.get("telegram_id")
            access_hash = validation_data.get("access_hash")

            # Still add to folder if target folder specified
            if target_folder and telegram_id and access_hash:
                folder_id = await self.folder_manager.get_or_create_folder(
                    target_folder
                )
                if folder_id:
                    await self.folder_manager.add_channel_to_folder(
                        folder_id, telegram_id, int(access_hash)
                    )

            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == import_channel.id)
                .values(
                    status="already_member",
                    joined_at=datetime.utcnow(),
                )
            )

            await self._add_log(
                session,
                job_id,
                "info",
                f"Already member of @{username}",
                event_code="ALREADY_MEMBER",
                channel_id=import_channel.id,
            )

            # Ensure channel exists in channels table
            await self._ensure_channel_in_db(
                session, username, validation_data, target_folder
            )

            return "already_member"

        try:
            # Join the channel
            entity = await self.client.get_entity(username)
            result = await self.client(JoinChannelRequest(entity))

            # Get full entity info after joining
            if isinstance(result.chats[0], TelegramChannel):
                joined_entity = result.chats[0]
                telegram_id = joined_entity.id
                access_hash = joined_entity.access_hash
            else:
                telegram_id = validation_data.get("telegram_id")
                access_hash = int(validation_data.get("access_hash", 0))

            # Add to folder if specified
            if target_folder and telegram_id and access_hash:
                folder_id = await self.folder_manager.get_or_create_folder(
                    target_folder
                )
                if folder_id:
                    await self.folder_manager.add_channel_to_folder(
                        folder_id, telegram_id, access_hash
                    )

            # Update import channel record
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == import_channel.id)
                .values(
                    status="joined",
                    joined_at=datetime.utcnow(),
                )
            )

            await self._add_log(
                session,
                job_id,
                "success",
                f"Joined @{username}",
                event_code="CHANNEL_JOINED",
                channel_id=import_channel.id,
            )

            # Add/update channel in channels table
            await self._ensure_channel_in_db(
                session, username, validation_data, target_folder
            )

            logger.info(f"Joined channel @{username}")
            return "joined"

        except UserAlreadyParticipantError:
            # Already a member (validation didn't catch this)
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == import_channel.id)
                .values(
                    status="already_member",
                    joined_at=datetime.utcnow(),
                )
            )

            await self._ensure_channel_in_db(
                session, username, validation_data, target_folder
            )

            return "already_member"

        except ChannelPrivateError:
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == import_channel.id)
                .values(
                    status="join_failed",
                    error_code="CHANNEL_PRIVATE",
                    error_message="Channel requires invite link to join",
                )
            )

            await self._add_log(
                session,
                job_id,
                "error",
                f"Cannot join @{username} - channel is private",
                event_code="JOIN_FAILED",
                channel_id=import_channel.id,
            )

            return "failed"

        except Exception as e:
            error_msg = str(e)[:200]
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == import_channel.id)
                .values(
                    status="join_failed",
                    error_code="JOIN_ERROR",
                    error_message=error_msg,
                )
            )

            await self._add_log(
                session,
                job_id,
                "error",
                f"Failed to join @{username}: {error_msg}",
                event_code="JOIN_FAILED",
                channel_id=import_channel.id,
            )

            logger.warning(f"Failed to join @{username}: {e}")
            return "failed"

    async def _ensure_channel_in_db(
        self,
        session: AsyncSession,
        username: str,
        validation_data: dict,
        folder_name: Optional[str],
    ) -> None:
        """
        Ensure channel exists in channels table.

        Creates or updates the channel record with metadata.
        """
        telegram_id = validation_data.get("telegram_id")
        if not telegram_id:
            return

        result = await session.execute(
            select(Channel).where(Channel.telegram_id == telegram_id)
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing channel
            await session.execute(
                update(Channel)
                .where(Channel.id == existing.id)
                .values(
                    username=username,
                    name=validation_data.get("title", existing.name),
                    folder=folder_name or existing.folder,
                    active=True,
                    source="import",
                )
            )
        else:
            # Create new channel
            new_channel = Channel(
                telegram_id=telegram_id,
                username=username,
                name=validation_data.get("title", username),
                folder=folder_name,
                active=True,
                rule="archive_all",
                source="import",
            )
            session.add(new_channel)

    async def _add_log(
        self,
        session: AsyncSession,
        job_id: str,
        event_type: str,
        message: str,
        event_code: Optional[str] = None,
        channel_id: Optional[str] = None,
    ) -> None:
        """Add a log entry to the import job."""
        log = ImportJobLog(
            import_job_id=job_id,
            channel_id=channel_id,
            event_type=event_type,
            event_code=event_code,
            message=message,
        )
        session.add(log)
