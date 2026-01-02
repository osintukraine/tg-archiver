"""
Import Validator - Channel validation for import jobs.

Validates channels from import jobs by:
1. Resolving usernames to Telegram entities
2. Checking channel accessibility
3. Extracting metadata (title, subscribers, verified status)
4. Detecting already-joined channels

Consumes from Redis stream 'import:validate' or polls database directly.
"""

import asyncio
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
)
from telethon.tl.types import Channel as TelegramChannel

from models import ImportJob, ImportJobChannel, ImportJobLog

logger = logging.getLogger(__name__)


class ImportValidator:
    """
    Validates channels in import jobs via Telegram API.

    Designed for batch validation with rate limiting to avoid Telegram bans.
    Updates ImportJobChannel records with validation results.
    """

    # Rate limiting: process N channels, then pause
    BATCH_SIZE = 10
    BATCH_DELAY_SECONDS = 5  # Pause between batches
    FLOOD_BACKOFF_MULTIPLIER = 1.5  # Extra safety margin on FloodWait

    def __init__(self, client: TelegramClient, db_session_factory):
        """
        Initialize ImportValidator.

        Args:
            client: Authenticated Telethon client
            db_session_factory: Async session factory for database access
        """
        self.client = client
        self.db_session_factory = db_session_factory

    async def validate_job(self, job_id: str) -> dict:
        """
        Validate all pending channels in an import job.

        Args:
            job_id: UUID of the import job

        Returns:
            Statistics dict with counts of validated, failed, skipped channels
        """
        stats = {
            "validated": 0,
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

            if job.status not in ("uploading", "validating"):
                logger.warning(
                    f"Job {job_id} in unexpected state: {job.status}"
                )
                return stats

            # Update status to validating
            await session.execute(
                update(ImportJob)
                .where(ImportJob.id == job_id)
                .values(status="validating")
            )
            await session.commit()

            # Get pending channels
            result = await session.execute(
                select(ImportJobChannel).where(
                    and_(
                        ImportJobChannel.import_job_id == job_id,
                        ImportJobChannel.status == "pending",
                    )
                )
            )
            channels = list(result.scalars().all())

            logger.info(
                f"Validating {len(channels)} channels for job {job_id}"
            )

            # Process in batches
            for i in range(0, len(channels), self.BATCH_SIZE):
                batch = channels[i : i + self.BATCH_SIZE]
                batch_num = (i // self.BATCH_SIZE) + 1
                total_batches = (len(channels) + self.BATCH_SIZE - 1) // self.BATCH_SIZE

                logger.info(
                    f"Processing batch {batch_num}/{total_batches} "
                    f"({len(batch)} channels)"
                )

                for channel in batch:
                    try:
                        result = await self._validate_channel(channel, session)
                        if result == "validated":
                            stats["validated"] += 1
                        elif result == "already_member":
                            stats["already_member"] += 1
                            stats["validated"] += 1
                        elif result == "skipped":
                            stats["skipped"] += 1
                        else:
                            stats["failed"] += 1

                    except FloodWaitError as e:
                        # Telegram rate limit - back off
                        wait_time = int(e.seconds * self.FLOOD_BACKOFF_MULTIPLIER)
                        logger.warning(
                            f"FloodWait during validation - waiting {wait_time}s"
                        )

                        await self._add_log(
                            session,
                            job_id,
                            "warning",
                            f"Rate limited by Telegram - waiting {wait_time}s",
                            event_code="FLOOD_WAIT",
                        )
                        await session.commit()

                        await asyncio.sleep(wait_time)

                        # Retry this channel
                        try:
                            result = await self._validate_channel(channel, session)
                            if result == "validated":
                                stats["validated"] += 1
                            else:
                                stats["failed"] += 1
                        except Exception as retry_error:
                            logger.error(f"Retry failed: {retry_error}")
                            stats["failed"] += 1

                    except Exception as e:
                        logger.error(f"Validation error: {e}")
                        stats["failed"] += 1

                await session.commit()

                # Pause between batches
                if i + self.BATCH_SIZE < len(channels):
                    logger.debug(f"Batch complete, pausing {self.BATCH_DELAY_SECONDS}s")
                    await asyncio.sleep(self.BATCH_DELAY_SECONDS)

            # Update job counters and status
            total = stats["validated"] + stats["failed"] + stats["skipped"]
            await session.execute(
                update(ImportJob)
                .where(ImportJob.id == job_id)
                .values(
                    status="ready",
                    validated_channels=stats["validated"],
                    failed_channels=stats["failed"],
                    skipped_channels=stats["skipped"],
                )
            )

            await self._add_log(
                session,
                job_id,
                "success",
                f"Validation complete: {stats['validated']} valid, "
                f"{stats['failed']} failed, {stats['skipped']} skipped",
                event_code="VALIDATION_COMPLETE",
            )

            await session.commit()

            logger.info(
                f"Validation complete for job {job_id}: "
                f"{stats['validated']} valid, {stats['failed']} failed"
            )

        return stats

    async def _validate_channel(
        self, channel: ImportJobChannel, session: AsyncSession
    ) -> str:
        """
        Validate a single channel via Telegram API.

        Returns:
            Status string: "validated", "already_member", "skipped", or "failed"
        """
        username = channel.channel_username

        if not username:
            # No username extracted - mark as failed
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == channel.id)
                .values(
                    status="validation_failed",
                    error_code="INVALID_URL",
                    error_message="Could not extract username from URL",
                )
            )
            return "failed"

        try:
            # Resolve username to entity
            entity = await self.client.get_entity(username)

            if not isinstance(entity, TelegramChannel):
                # Not a channel (could be a user or group)
                await session.execute(
                    update(ImportJobChannel)
                    .where(ImportJobChannel.id == channel.id)
                    .values(
                        status="validation_failed",
                        error_code="NOT_A_CHANNEL",
                        error_message="URL points to a user or group, not a channel",
                    )
                )
                return "failed"

            # Extract metadata
            validation_data = {
                "telegram_id": entity.id,
                "title": entity.title,
                "username": entity.username,
                "verified": getattr(entity, "verified", False),
                "participants_count": getattr(entity, "participants_count", None),
                "is_broadcast": getattr(entity, "broadcast", False),
                "is_megagroup": getattr(entity, "megagroup", False),
                "access_hash": str(entity.access_hash) if entity.access_hash else None,
            }

            # Check if we're already a member
            try:
                full_entity = await self.client.get_entity(entity.id)
                validation_data["already_member"] = True
            except ChannelPrivateError:
                validation_data["already_member"] = False

            # Update channel record
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == channel.id)
                .values(
                    status="validated",
                    channel_name=entity.title,
                    channel_username=entity.username,
                    validation_data=validation_data,
                    error_code=None,
                    error_message=None,
                )
            )

            logger.debug(
                f"Validated: @{username} -> {entity.title} "
                f"({validation_data.get('participants_count', '?')} members)"
            )

            if validation_data.get("already_member"):
                return "already_member"
            return "validated"

        except UsernameNotOccupiedError:
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == channel.id)
                .values(
                    status="validation_failed",
                    error_code="USERNAME_NOT_FOUND",
                    error_message=f"Username @{username} does not exist",
                )
            )
            return "failed"

        except UsernameInvalidError:
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == channel.id)
                .values(
                    status="validation_failed",
                    error_code="USERNAME_INVALID",
                    error_message=f"Username @{username} is invalid",
                )
            )
            return "failed"

        except ChannelPrivateError:
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == channel.id)
                .values(
                    status="validation_failed",
                    error_code="CHANNEL_PRIVATE",
                    error_message="Channel is private and requires an invite link",
                )
            )
            return "failed"

        except Exception as e:
            error_msg = str(e)[:200]  # Truncate long errors
            await session.execute(
                update(ImportJobChannel)
                .where(ImportJobChannel.id == channel.id)
                .values(
                    status="validation_failed",
                    error_code="TELEGRAM_ERROR",
                    error_message=error_msg,
                )
            )
            logger.warning(f"Validation failed for @{username}: {e}")
            return "failed"

    async def _add_log(
        self,
        session: AsyncSession,
        job_id: str,
        event_type: str,
        message: str,
        event_code: Optional[str] = None,
    ) -> None:
        """Add a log entry to the import job."""
        log = ImportJobLog(
            import_job_id=job_id,
            event_type=event_type,
            event_code=event_code,
            message=message,
        )
        session.add(log)
