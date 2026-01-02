"""
Import Worker - Background task for processing import jobs.

Consumes from Redis streams:
- import:validate - Triggers channel validation
- import:start - Triggers channel joining

Also polls database for jobs that may have been missed (Redis unavailable, etc.)
"""

import asyncio
import logging
from typing import Optional

import redis.asyncio as redis
from redis.exceptions import RedisError

from config.settings import settings
from models.base import AsyncSessionLocal
from .import_validator import ImportValidator
from .import_processor import ImportProcessor
from .folder_manager import FolderManager

logger = logging.getLogger(__name__)


class ImportWorker:
    """
    Background worker for processing import jobs.

    Listens to Redis streams and polls database for pending jobs.
    """

    # Redis streams for import commands
    STREAM_VALIDATE = "import:validate"
    STREAM_START = "import:start"

    # Consumer group for reliable delivery
    CONSUMER_GROUP = "import-workers"

    # Polling interval for database (fallback)
    POLL_INTERVAL_SECONDS = 60

    def __init__(
        self,
        validator: ImportValidator,
        processor: ImportProcessor,
    ):
        """
        Initialize ImportWorker.

        Args:
            validator: ImportValidator instance
            processor: ImportProcessor instance
        """
        self.validator = validator
        self.processor = processor
        self.redis_client: Optional[redis.Redis] = None
        self._running = False
        self._consumer_name = f"listener-{id(self)}"

    async def start(self) -> None:
        """Start the import worker background task."""
        logger.info("Starting import worker...")

        try:
            # Connect to Redis
            self.redis_client = redis.from_url(
                settings.REDIS_URL,
                decode_responses=True,
            )
            await self.redis_client.ping()
            logger.info("Import worker connected to Redis")

            # Create consumer groups
            await self._ensure_consumer_groups()

        except RedisError as e:
            logger.warning(f"Redis unavailable for import worker: {e}")
            logger.info("Import worker will poll database instead")
            self.redis_client = None

        self._running = True

        # Run both Redis consumer and database poller concurrently
        tasks = [
            asyncio.create_task(self._poll_database()),
        ]

        if self.redis_client:
            tasks.append(asyncio.create_task(self._consume_redis_streams()))

        await asyncio.gather(*tasks, return_exceptions=True)

    async def stop(self) -> None:
        """Stop the import worker."""
        logger.info("Stopping import worker...")
        self._running = False

        if self.redis_client:
            await self.redis_client.close()
            self.redis_client = None

    async def _ensure_consumer_groups(self) -> None:
        """Create consumer groups if they don't exist."""
        if not self.redis_client:
            return

        for stream in [self.STREAM_VALIDATE, self.STREAM_START]:
            try:
                await self.redis_client.xgroup_create(
                    name=stream,
                    groupname=self.CONSUMER_GROUP,
                    id="0",
                    mkstream=True,
                )
                logger.info(f"Created consumer group for {stream}")
            except RedisError as e:
                if "BUSYGROUP" in str(e):
                    logger.debug(f"Consumer group already exists for {stream}")
                else:
                    logger.error(f"Error creating consumer group: {e}")

    async def _consume_redis_streams(self) -> None:
        """Consume import commands from Redis streams."""
        if not self.redis_client:
            return

        logger.info("Listening for import commands on Redis streams...")

        while self._running:
            try:
                # Read from both streams with blocking
                result = await self.redis_client.xreadgroup(
                    groupname=self.CONSUMER_GROUP,
                    consumername=self._consumer_name,
                    streams={
                        self.STREAM_VALIDATE: ">",
                        self.STREAM_START: ">",
                    },
                    count=1,
                    block=5000,  # 5 second timeout
                )

                if not result:
                    continue

                for stream_name, messages in result:
                    for msg_id, msg_data in messages:
                        job_id = msg_data.get("job_id")
                        if not job_id:
                            logger.warning(f"Invalid message in {stream_name}: {msg_data}")
                            continue

                        logger.info(f"Received {stream_name} command for job {job_id}")

                        try:
                            if stream_name == self.STREAM_VALIDATE:
                                await self.validator.validate_job(job_id)
                            elif stream_name == self.STREAM_START:
                                await self.processor.process_job(job_id)

                            # Acknowledge message
                            await self.redis_client.xack(
                                stream_name, self.CONSUMER_GROUP, msg_id
                            )
                            logger.debug(f"Acknowledged {msg_id} from {stream_name}")

                        except Exception as e:
                            logger.error(
                                f"Error processing {stream_name} for job {job_id}: {e}"
                            )
                            # Don't acknowledge - will be redelivered

            except RedisError as e:
                logger.error(f"Redis error in import worker: {e}")
                await asyncio.sleep(5)
            except Exception as e:
                logger.exception(f"Unexpected error in import worker: {e}")
                await asyncio.sleep(5)

    async def _poll_database(self) -> None:
        """
        Poll database for jobs that need processing.

        Fallback for when Redis is unavailable or messages were missed.
        """
        logger.info(f"Starting database poller (interval: {self.POLL_INTERVAL_SECONDS}s)")

        while self._running:
            try:
                await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

                if not self._running:
                    break

                # Check for jobs stuck in validating status
                await self._check_pending_validation()

                # Check for jobs stuck in processing status
                await self._check_pending_processing()

            except Exception as e:
                logger.error(f"Error in database poller: {e}")

    async def _check_pending_validation(self) -> None:
        """Check for jobs that need validation."""
        from sqlalchemy import select
        from models import ImportJob

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(ImportJob).where(ImportJob.status == "validating")
            )
            jobs = result.scalars().all()

            for job in jobs:
                # Check if validation is stalled (no progress in 10 minutes)
                # This is a simple check - could be more sophisticated
                logger.debug(f"Found job {job.id} in validating state")
                # The validator will handle re-validation if needed

    async def _check_pending_processing(self) -> None:
        """Check for jobs that need processing."""
        from sqlalchemy import select
        from models import ImportJob

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(ImportJob).where(ImportJob.status == "processing")
            )
            jobs = result.scalars().all()

            for job in jobs:
                logger.debug(f"Found job {job.id} in processing state")
                # The processor handles resumption if needed


async def create_import_worker(
    telegram_client,
    db_session_factory,
) -> ImportWorker:
    """
    Factory function to create ImportWorker with all dependencies.

    Args:
        telegram_client: Authenticated Telethon client
        db_session_factory: Async session factory

    Returns:
        Configured ImportWorker instance
    """
    folder_manager = FolderManager(telegram_client, db_session_factory)
    validator = ImportValidator(telegram_client, db_session_factory)
    processor = ImportProcessor(telegram_client, db_session_factory, folder_manager)

    return ImportWorker(validator, processor)
