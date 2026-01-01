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
from notifications import NotificationClient

# Structured logging for Loki aggregation
from observability import setup_logging, get_logger, LogContext

from .entity_extractor import EntityExtractor
from .message_processor import MessageProcessor
from .message_router import MessageRouter
from .redis_consumer import RedisConsumer

# Import Prometheus metrics server
from observability.metrics import processor_metrics_server, record_queue_depth

# Import translation service from shared modules
import importlib.util
spec = importlib.util.spec_from_file_location("translation_service_module", "/app/shared/python/translation.py")
translation_service_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(translation_service_module)
TranslationService = translation_service_module.TranslationService

# Initialize structured logging
setup_logging(service_name="processor")
logger = get_logger(__name__)

# Shutdown event
shutdown_event = asyncio.Event()

# Queue depth update interval (seconds)
QUEUE_DEPTH_UPDATE_INTERVAL = 10


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

    try:
        # 1. Initialize Redis consumer
        logger.info("Initializing Redis consumer...")
        redis_consumer = RedisConsumer()
        await redis_consumer.connect()

        # 2. Initialize NotificationClient
        logger.info("Initializing notification client...")
        notifier = NotificationClient(service_name="processor", redis_url=settings.REDIS_URL)

        # 3. Initialize message router
        logger.info("Initializing message router...")
        message_router = MessageRouter()

        # 4. Initialize entity extractor (regex-based, fast)
        logger.info("Initializing entity extractor...")
        entity_extractor = EntityExtractor()

        # 5. Initialize Telegram client for media download
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

        # 6. Initialize MinIO client for media archival
        logger.info("Initializing MinIO client...")
        minio_client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )

        # 7. Initialize media archiver with Redis for sync queue
        media_archiver = MediaArchiver(
            minio_client=minio_client,
            redis_client=redis_consumer.client,
            storage_box_id="default",
        )

        # 8. Initialize translation service
        translation_service = None
        if settings.TRANSLATION_ENABLED:
            logger.info("Initializing translation service (DeepL + Google fallback)...")
            translation_service = TranslationService()
            logger.info("Translation service initialized")
        else:
            logger.info("Translation disabled in processor")

        # 9. Initialize MessageProcessor (simplified - no LLM)
        logger.info("Initializing message processor...")
        processor = MessageProcessor(
            message_router=message_router,
            entity_extractor=entity_extractor,
            media_archiver=media_archiver,
            telegram_client=telegram_client,
            translation_service=translation_service,
            notifier=notifier,
        )

        logger.info("All components initialized successfully")
        logger.info("Note: No AI classification - all messages will be archived")

        # 10. Start background queue depth metrics updater
        queue_depth_task = asyncio.create_task(update_queue_depth(redis_consumer))

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

        # Cancel the queue depth updater task
        if queue_depth_task and not queue_depth_task.done():
            queue_depth_task.cancel()
            try:
                await queue_depth_task
            except asyncio.CancelledError:
                pass

        if redis_consumer:
            redis_consumer.shutdown()
            await redis_consumer.disconnect()

        if telegram_client and telegram_client.is_connected():
            logger.info("Disconnecting Telegram client...")
            await telegram_client.disconnect()

        # Print statistics
        if processor:
            stats = processor.get_stats()
            logger.info(f"Processing statistics: {stats}")

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
