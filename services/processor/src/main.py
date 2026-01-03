"""
Message Processor Service - Entry Point (Simplified, No AI)

This service:
1. Pulls messages from Redis queue
2. Downloads and archives media with content-addressed storage (SHA-256 deduplication)
3. Extracts entities (regex-based)
4. Detects language and translates if needed (DeepL Pro)
5. Stores messages in PostgreSQL

NO LLM classification - all messages from monitored channels are archived.
"""

import asyncio
import os
import signal
import sys
from typing import NoReturn

from minio import Minio
from telethon import TelegramClient

from config.settings import settings
from media_archiver import MediaArchiver

# Structured logging for Loki aggregation
from observability import setup_logging, get_logger, LogContext

from .entity_extractor import EntityExtractor
from .message_processor import MessageProcessor
from .message_router import MessageRouter
from .redis_consumer import RedisConsumer

# Import Prometheus metrics server
from observability.metrics import processor_metrics_server, record_queue_depth

# Import audit logger for platform events
from audit.audit_logger import AuditLogger
audit = AuditLogger("processor")

# Import translation service from shared modules
from translation import CommentTranslator as TranslationService

# Initialize structured logging
setup_logging(service_name="processor")
logger = get_logger(__name__)

# Shutdown event
shutdown_event = asyncio.Event()

# Queue depth update interval (seconds)
QUEUE_DEPTH_UPDATE_INTERVAL = 10


async def pattern_reload_listener(entity_extractor: EntityExtractor) -> None:
    """
    Background task to listen for pattern reload signals from Redis pub/sub.

    When patterns are updated via the admin API, a message is published to
    the 'extraction:reload' channel which triggers this handler to reload
    patterns from the database.
    """
    import redis.asyncio as aioredis
    from models.base import AsyncSessionLocal

    logger.info("Starting pattern reload listener on 'extraction:reload' channel")

    redis_url = settings.REDIS_URL
    pubsub = None

    try:
        r = aioredis.from_url(redis_url)
        pubsub = r.pubsub()
        await pubsub.subscribe("extraction:reload")

        while not shutdown_event.is_set():
            try:
                message = await asyncio.wait_for(
                    pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0),
                    timeout=5.0
                )
                if message:
                    logger.info("Received pattern reload signal")
                    async with AsyncSessionLocal() as db:
                        count = await entity_extractor.reload_patterns(db)
                        logger.info(f"Reloaded {count} extraction patterns")
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                logger.warning(f"Error in pattern reload listener: {e}")
                await asyncio.sleep(5)

    except Exception as e:
        logger.error(f"Pattern reload listener failed to start: {e}")
    finally:
        if pubsub:
            await pubsub.unsubscribe("extraction:reload")
            await pubsub.close()
        logger.info("Pattern reload listener stopped")


async def update_queue_depth(redis_consumer: RedisConsumer) -> None:
    """
    Background task to periodically update Redis queue depth metrics.

    Runs every QUEUE_DEPTH_UPDATE_INTERVAL seconds until shutdown is signaled.
    """
    logger.info("Starting queue depth metrics updater")

    while not shutdown_event.is_set():
        try:
            pending_count = await redis_consumer.get_pending_count()
            record_queue_depth(
                consumer_group=redis_consumer.CONSUMER_GROUP,
                pending_count=pending_count
            )
            logger.debug(f"Queue depth updated: {pending_count} pending messages")
        except Exception as e:
            logger.warning(f"Failed to update queue depth metric: {e}")

        # Wait for next update (or until shutdown)
        try:
            await asyncio.wait_for(
                shutdown_event.wait(),
                timeout=QUEUE_DEPTH_UPDATE_INTERVAL
            )
            # If we get here, shutdown was signaled
            break
        except asyncio.TimeoutError:
            # Normal timeout - continue to next update
            pass

    logger.info("Queue depth metrics updater stopped")


async def main() -> NoReturn:
    """Main entry point for the processor service."""
    logger.info("Starting Message Processor Service v1.0.0 (No AI - Archives Everything)")

    # Start Prometheus metrics server on port 8002
    try:
        processor_metrics_server.start()
        logger.info("Prometheus metrics server started on port 8002")
    except Exception as e:
        logger.error(f"Failed to start metrics server: {e}")

    # Initialize components
    redis_consumer = None
    telegram_client = None
    processor = None
    queue_depth_task = None
    pattern_reload_task = None

    try:
        # 1. Initialize Redis consumer
        logger.info("Initializing Redis consumer...")
        redis_consumer = RedisConsumer()
        await redis_consumer.connect()

        # 2. Initialize message router
        logger.info("Initializing message router...")
        message_router = MessageRouter()

        # 3. Initialize entity extractor (regex-based, fast)
        logger.info("Initializing entity extractor...")
        entity_extractor = EntityExtractor()

        # Load extraction patterns from database
        from models.base import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            pattern_count = await entity_extractor.load_patterns_from_db(db)
            logger.info(f"Loaded {pattern_count} extraction patterns from database")

        # 4. Initialize Telegram client for media download
        import socket
        import shutil

        worker_id = socket.gethostname()
        session_name = f"processor-{worker_id}"
        session_path = settings.TELEGRAM_SESSION_PATH / f"{session_name}.session"

        # Copy listener session to worker session if doesn't exist
        listener_session = settings.TELEGRAM_SESSION_PATH / "listener.session"
        if not session_path.exists() and listener_session.exists():
            logger.info(f"Copying listener session to {session_name}...")
            shutil.copy(listener_session, session_path)

        logger.info(f"Initializing Telegram client for media download (session: {session_name})...")
        telegram_client = TelegramClient(
            session=str(settings.TELEGRAM_SESSION_PATH / session_name),
            api_id=settings.TELEGRAM_API_ID,
            api_hash=settings.TELEGRAM_API_HASH,
            connection_retries=5,
            retry_delay=5,
            auto_reconnect=True,
        )

        await telegram_client.connect()

        # Authenticate if needed
        if not await telegram_client.is_user_authorized():
            logger.error(
                f"Telegram not authorized. Session file not found or invalid. "
                f"Make sure listener session exists at {listener_session}"
            )
            sys.exit(1)

        logger.info("Telegram client connected successfully (processor session)")

        # 5. Initialize MinIO client for media archival
        logger.info("Initializing MinIO client...")
        minio_client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )

        # 6. Initialize media archiver with Redis for sync queue
        media_archiver = MediaArchiver(
            minio_client=minio_client,
            redis_client=redis_consumer.client,
            storage_box_id="default",
        )

        # 7. Initialize translation service
        translation_service = None
        if settings.TRANSLATION_ENABLED:
            logger.info("Initializing translation service (DeepL + Google fallback)...")
            translation_service = TranslationService()
            logger.info("Translation service initialized")
        else:
            logger.info("Translation disabled in processor")

        # 8. Initialize MessageProcessor (simplified - no LLM)
        logger.info("Initializing message processor...")
        processor = MessageProcessor(
            message_router=message_router,
            entity_extractor=entity_extractor,
            media_archiver=media_archiver,
            telegram_client=telegram_client,
            translation_service=translation_service,
        )

        logger.info("All components initialized successfully")
        logger.info("Note: No AI classification - all messages will be archived")

        # Log service startup to audit
        async with AsyncSessionLocal() as db:
            await audit.log_service_started(
                session=db,
                version="1.0.0",
                config={
                    "translation_enabled": settings.TRANSLATION_ENABLED,
                    "media_archival_enabled": True,
                },
            )

        # 9. Start background queue depth metrics updater
        queue_depth_task = asyncio.create_task(update_queue_depth(redis_consumer))

        # 10. Start pattern reload listener (for admin API updates)
        pattern_reload_task = asyncio.create_task(pattern_reload_listener(entity_extractor))

        # 11. Start processing messages
        logger.info("Starting message processing...")

        async for message in redis_consumer.consume_messages():
            try:
                # Process message
                success = await processor.process(message)

                if success:
                    # Acknowledge message
                    await redis_consumer.acknowledge(message.stream_id)
                else:
                    # Reject message (failed processing)
                    await redis_consumer.reject(
                        message.stream_id,
                        "Processing failed",
                        message
                    )

            except Exception as e:
                logger.exception(f"Error processing message {message.stream_id}: {e}")

                # Reject message
                await redis_consumer.reject(
                    message.stream_id,
                    f"Exception: {type(e).__name__}",
                    message
                )

            # Check for shutdown
            if shutdown_event.is_set():
                logger.info("Shutdown requested, stopping message processing")
                break

        logger.info("Message processing stopped")

    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt, shutting down...")
    except Exception as e:
        logger.exception(f"Fatal error in processor service: {e}")
        sys.exit(1)
    finally:
        # Graceful shutdown
        logger.info("Shutting down gracefully...")

        # Cancel background tasks
        if queue_depth_task and not queue_depth_task.done():
            queue_depth_task.cancel()
            try:
                await queue_depth_task
            except asyncio.CancelledError:
                pass

        if pattern_reload_task and not pattern_reload_task.done():
            pattern_reload_task.cancel()
            try:
                await pattern_reload_task
            except asyncio.CancelledError:
                pass

        if redis_consumer:
            redis_consumer.shutdown()
            await redis_consumer.disconnect()

        if telegram_client and telegram_client.is_connected():
            logger.info("Disconnecting Telegram client...")
            await telegram_client.disconnect()

        # Print statistics and log to audit
        if processor:
            stats = processor.get_stats()
            logger.info(f"Processing statistics: {stats}")

            # Log batch stats to audit trail
            if stats.get("messages_archived", 0) > 0:
                try:
                    async with AsyncSessionLocal() as db:
                        await audit.log_messages_archived(
                            session=db,
                            count=stats.get("messages_archived", 0),
                            batch_id=f"session-{shutdown_event._loop.time() if hasattr(shutdown_event, '_loop') else 'unknown'}",
                        )
                except Exception as e:
                    logger.warning(f"Failed to log shutdown stats to audit: {e}")

        logger.info("Shutdown complete")


def handle_shutdown(signum: int, frame) -> None:
    """Handle shutdown signals gracefully."""
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    shutdown_event.set()


if __name__ == "__main__":
    # Setup signal handlers
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    # Run the service
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Service interrupted by user")
    except Exception as e:
        logger.exception(f"Fatal error in processor service: {e}")
        sys.exit(1)
