"""
Telegram Listener Service - Entry Point

This service is the critical first component in the Telegram Archiver's
message processing pipeline. It serves as the bridge between Telegram and the
archiver's processing infrastructure.

Core Responsibilities
--------------------
1. **Channel Discovery**: Automatically discovers and tracks channels from Telegram
   folders (Archive-*, Monitor-*, Discover-*) using the ChannelDiscovery component.

2. **Real-time Message Monitoring**: Continuously monitors all tracked channels for
   new messages using Telethon's event system.

3. **Message Queueing**: Pushes raw message data to Redis Streams for asynchronous
   processing by downstream services (processor, enrichment).

4. **Session Management**: Maintains persistent Telegram client connection with
   automatic reconnection and authentication handling.

5. **Backfill Coordination**: Optionally triggers historical message retrieval for
   new channels or detected gaps in the message history.

6. **Media Archival**: Archives media attachments to MinIO S3-compatible storage
   with content-addressed deduplication (SHA-256).

Architecture Position
--------------------
```
Telegram API → Listener → Redis Streams → Processor → PostgreSQL/MinIO → Enrichment
```

The listener is the only service that owns the Telegram client session. All other
services receive message data indirectly through Redis queues. This design ensures
a single point of Telegram authentication and rate limiting.

Key Components
--------------
- **TelegramClient (Telethon)**: Maintains authenticated connection to Telegram API
- **ChannelDiscovery**: Folder-based channel management and automatic discovery
- **TelegramListener**: Event handler for new/edited messages
- **BackfillService**: Historical message retrieval for gap filling
- **MediaArchiver**: S3-compatible media storage with deduplication
- **RedisQueue**: Message queue interface for downstream processing

Initialization Sequence
-----------------------
The service follows a strict 12-step initialization sequence to ensure proper
dependency resolution:

1. Start Prometheus metrics server (health monitoring)
2. Connect to Redis (message queue + pub/sub)
3. Initialize notification client (cross-service alerts)
4. Initialize Telegram client (session authentication)
5. Initialize MinIO client (S3-compatible storage)
6. Initialize MediaArchiver (content-addressed media storage)
7. Initialize BackfillService (if enabled)
8. Initialize ChannelDiscovery (folder-based management)
9. Perform initial channel discovery and database sync
   9b. Run startup gap detection (if enabled)
10. Start background folder sync task (5-minute interval)
11. Initialize TelegramListener (event handlers)
12. Start message monitoring (blocks until shutdown)

Shutdown Behavior
-----------------
On receiving SIGINT or SIGTERM, the service performs graceful shutdown:
1. Cancel background folder sync task
2. Stop message listener (disconnect event handlers)
3. Disconnect Telegram client
4. Disconnect Redis queue
5. Log shutdown completion

Dependencies
-----------
- **PostgreSQL**: Channel metadata, message tracking (via models.base)
- **Redis**: Message queue, pub/sub notifications, backfill coordination
- **MinIO**: S3-compatible object storage for media archival
- **Telegram API**: Message monitoring, channel discovery

Environment Variables
--------------------
Key configuration via config.settings:
- TELEGRAM_API_ID, TELEGRAM_API_HASH: Telegram authentication
- TELEGRAM_SESSION_PATH: Session file location
- REDIS_URL: Redis connection string
- MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY: S3 storage
- BACKFILL_ENABLED, BACKFILL_MODE: Historical message retrieval
- GAP_DETECTION_ENABLED: Automatic gap filling on startup

Error Handling
--------------
- **Missing Telegram session**: Exits with code 1, requires manual authentication
- **Redis/MinIO unavailable**: Raises ConnectionError, service stops
- **Telegram API errors**: Auto-reconnect via Telethon client
- **Fatal errors**: Logged with full traceback, service exits with code 1

Notes
-----
- This service OWNS the Telegram session. Never create standalone TelegramClient
  instances elsewhere in the codebase.
- Translation is handled by the processor service.
- Media archival happens in listener to ensure Telegram URLs don't expire before
  processing (URLs expire after ~1 hour).

See Also
--------
- ChannelDiscovery: Folder-based channel management
- TelegramListener: Event handler implementation
- BackfillService: Historical message retrieval
- RedisQueue: Message queue abstraction
"""

import asyncio
import signal
import sys
from typing import NoReturn

from minio import Minio
from telethon import TelegramClient

from config.settings import settings
from media_archiver import MediaArchiver

# Structured logging for Loki aggregation
from observability import setup_logging, get_logger

from .backfill_service import BackfillService
from .channel_discovery import ChannelDiscovery
from .import_worker import create_import_worker
from .metrics import metrics_server, mark_listener_started
from .redis_queue import redis_queue
from .telegram_listener import TelegramListener

# Translation service removed - now in processor
# from .translation import TranslationService

# Import audit logger for platform events
from audit.audit_logger import AuditLogger
audit = AuditLogger("listener")

# Initialize structured logging
setup_logging(service_name="listener")
logger = get_logger(__name__)

# Shutdown event
shutdown_event = asyncio.Event()


async def main() -> NoReturn:
    """
    Main entry point for the Telegram listener service.

    Initializes and runs the Telegram message monitoring pipeline with a strict
    12-step initialization sequence. The service runs indefinitely until interrupted
    by SIGINT/SIGTERM signals, at which point it performs graceful shutdown.

    Initialization Sequence
    -----------------------
    The order is critical to ensure proper dependency resolution:

    1. **Prometheus Metrics Server**: Start HTTP server for /metrics endpoint.
       Health monitoring and observability foundation.

    2. **Redis Connection**: Establish connection to Redis for message queueing
       and pub/sub notifications. All downstream services depend on this.

    3. **NotificationClient**: Initialize cross-service notification system for
       alerts, errors, and status updates via Redis pub/sub.

    4. **Telegram Client (Telethon)**: Initialize authenticated connection to
       Telegram API with auto-reconnect. Verifies user authorization.
       CRITICAL: This service OWNS the Telegram session - no other service
       should create standalone TelegramClient instances.

    5. **MinIO Client**: Initialize S3-compatible object storage client for
       media archival with content addressing (SHA-256 deduplication).

    6. **MediaArchiver**: Wrapper around MinIO for content-addressed media storage.
       Ensures Telegram media URLs don't expire before processing.

    7. **BackfillService** (optional): Historical message retrieval for new channels
       or gap filling. Only initialized if BACKFILL_ENABLED=true in config.
       Creates its own database sessions via AsyncSessionLocal().

    8. **ChannelDiscovery**: Folder-based channel management. Discovers channels
       from Telegram folders (Archive-*, Monitor-*, Discover-*) and maps them
       to archival rules in the database.

    9. **Initial Channel Discovery**: Synchronous discovery of all channels from
       Telegram folders and sync to database. Returns channel metadata for
       monitoring setup.

       9b. **Startup Gap Detection** (optional): On first startup or after downtime,
       detect gaps in message history by comparing latest database message ID
       with Telegram channel state. Queue backfill tasks if gaps found.

    10. **Background Folder Sync**: Start async task to re-sync Telegram folders
        every 5 minutes (300 seconds). Detects new channels, removed channels,
        and folder moves without restarting the service.

    11. **TelegramListener**: Initialize event handler for new/edited messages.
        Connects to Redis queue for message publishing.

    12. **Start Message Monitoring**: Begin listening for Telegram events.
        This blocks until shutdown signal received.

    The service then waits on the shutdown_event until SIGINT/SIGTERM received.

    Error Handling Strategy
    -----------------------
    - **Missing Telegram Authorization**: If telegram_client.is_user_authorized()
      returns False, service exits with code 1. User must run authentication
      script manually to create session file.

    - **Connection Errors**: Redis/MinIO connection failures raise exceptions
      that are caught by outer try/except. Service logs error and exits with
      code 1.

    - **Telegram API Errors**: Handled by Telethon's auto-reconnect mechanism.
      Connection retries=5, retry_delay=5 seconds. Temporary network issues
      are tolerated.

    - **Fatal Errors**: Any unhandled exception is caught by outer try/except,
      logged with full traceback via logger.exception(), and service exits
      with code 1.

    Shutdown Behavior
    -----------------
    On receiving shutdown signal (SIGINT/SIGTERM via handle_shutdown()):

    1. Cancel background folder sync task (if still running)
    2. Stop TelegramListener (disconnect event handlers)
    3. Disconnect Telegram client (close API connection)
    4. Disconnect Redis queue (flush pending messages)
    5. Log shutdown completion

    The shutdown is graceful - in-flight operations complete before exit.

    Dependencies on Other Services
    ------------------------------
    **Required (must be running)**:
    - PostgreSQL: Channel metadata, message tracking (schema via init.sql)
    - Redis: Message queue, pub/sub, backfill coordination
    - MinIO: S3-compatible storage for media archival

    **External (API)**:
    - Telegram API: Message monitoring, channel discovery

    **Downstream (optional)**:
    - Processor: Consumes messages from Redis queue
    - Enrichment: Consumes enrichment tasks from Redis

    The listener can start independently but is useless without processor
    to consume queued messages. Redis queue will fill up if processor is down.

    Returns
    -------
    NoReturn
        Function runs indefinitely until shutdown signal received.

    Raises
    ------
    SystemExit
        Exit code 1 if Telegram not authorized or fatal error occurs.

    ConnectionError
        If Redis or MinIO unavailable during initialization.

    RuntimeError
        If Telegram credentials missing from environment.

    Notes
    -----
    - Service version is hardcoded in startup log message. Update when releasing.
    - Translation was removed from listener in v0.1.0 (moved to processor).
    - Media archival happens in listener because Telegram URLs expire after ~1 hour.
    - BackfillService creates its own database sessions - we pass db=None to avoid
      session lifecycle issues.

    See Also
    --------
    handle_shutdown : Signal handler for graceful shutdown
    ChannelDiscovery.discover_channels : Telegram folder discovery
    TelegramListener.start : Event handler registration
    BackfillService : Historical message retrieval
    """
    logger.info("Starting Telegram Listener Service v0.1.0")

    # Initialize components
    telegram_client = None
    listener = None
    discovery_task = None
    import_worker = None
    import_worker_task = None

    try:
        # 1. Start Prometheus metrics server
        logger.info("Starting Prometheus metrics server...")
        metrics_server.start()

        # 2. Connect to Redis
        logger.info("Connecting to Redis queue...")
        await redis_queue.connect()

        # Translation handled by processor service
        logger.info("Translation handled by processor service")

        # 3. Initialize Telethon client for ChannelDiscovery
        logger.info("Initializing Telegram client for channel discovery...")
        telegram_client = TelegramClient(
            session=str(settings.TELEGRAM_SESSION_PATH / settings.TELEGRAM_SESSION_NAME),
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
                "Telegram not authorized. Please run authentication script first."
            )
            sys.exit(1)

        logger.info("Telegram client connected successfully")

        # 4. Initialize MinIO client for media archival
        logger.info("Initializing MinIO client...")
        minio_client = Minio(
            endpoint=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_SECURE,
        )

        # 5. Initialize media archiver
        media_archiver = MediaArchiver(minio_client)
        logger.info("MediaArchiver initialized")

        # 6. Initialize BackfillService (if enabled)
        backfill_service = None
        if settings.BACKFILL_ENABLED:
            logger.info("Initializing backfill service...")
            from models.base import AsyncSessionLocal
            # BackfillService creates its own database sessions as needed
            # We pass None since it doesn't need a persistent session
            backfill_service = BackfillService(
                client=telegram_client,
                db=None,  # Creates own sessions via AsyncSessionLocal()
                redis_queue=redis_queue,
                media_archiver=media_archiver,  # Enable media download during backfill
            )
            logger.info(f"Backfill service initialized (mode: {settings.BACKFILL_MODE})")
        else:
            logger.info("Backfill disabled")

        # 7. Initialize ChannelDiscovery
        logger.info("Initializing channel discovery...")
        channel_discovery = ChannelDiscovery(
            client=telegram_client,
            backfill_service=backfill_service,
        )

        # 8. Perform initial channel discovery
        logger.info("Performing initial channel discovery...")
        channels = await channel_discovery.discover_channels()

        # Sync to database
        from models.base import AsyncSessionLocal

        async with AsyncSessionLocal() as session:
            stats = await channel_discovery.sync_to_database(channels, session)
            logger.info(
                f"Initial sync complete: {stats['total_active']} active channels"
            )

            # 9b. On-startup gap detection - fill any gaps from downtime
            if settings.GAP_DETECTION_ENABLED and backfill_service:
                logger.info("Running startup gap detection...")
                gap_stats = await channel_discovery.fill_detected_gaps(session)
                if gap_stats["gaps_detected"] > 0:
                    logger.info(
                        f"Startup gap detection: {gap_stats['gaps_detected']} gaps found, "
                        f"{gap_stats['backfills_triggered']} backfills queued"
                    )
                else:
                    logger.info("Startup gap detection: no gaps found - all channels up to date")
            else:
                logger.info("Startup gap detection: disabled or backfill service unavailable")

        # 9. Start background folder sync task (every 5 minutes)
        logger.info("Starting background folder sync task...")
        discovery_task = asyncio.create_task(
            channel_discovery.start_background_sync(interval_seconds=300)
        )

        # 9b. Initialize and start import worker (channel import from CSV)
        logger.info("Initializing import worker...")
        import_worker = await create_import_worker(
            telegram_client=telegram_client,
            db_session_factory=AsyncSessionLocal,
        )
        import_worker_task = asyncio.create_task(import_worker.start())
        logger.info("Import worker started (listening for import jobs)")

        # 10. Initialize TelegramListener (share the existing telegram_client to avoid session lock)
        logger.info("Initializing Telegram Listener...")
        listener = TelegramListener(
            redis_queue=redis_queue,
            telegram_client=telegram_client,
        )

        # 11. Start listening for messages
        logger.info("Starting message monitoring...")

        # Mark listener as started for health check grace period
        mark_listener_started()

        await listener.start()

        # Service is now running - wait for shutdown signal
        logger.info("Telegram Listener Service running - press Ctrl+C to stop")

        # Log service startup to audit
        async with AsyncSessionLocal() as session:
            await audit.log_service_started(
                session=session,
                version="1.0.0",
                config={
                    "backfill_enabled": settings.BACKFILL_ENABLED,
                    "gap_detection_enabled": settings.GAP_DETECTION_ENABLED,
                    "active_channels": stats["total_active"],
                },
            )

        await shutdown_event.wait()

    except KeyboardInterrupt:
        logger.info("Received keyboard interrupt, shutting down...")
    except Exception as e:
        logger.exception(f"Fatal error in listener service: {e}")
        sys.exit(1)
    finally:
        # Graceful shutdown
        logger.info("Shutting down gracefully...")

        if import_worker_task and not import_worker_task.done():
            import_worker_task.cancel()

        if import_worker:
            await import_worker.stop()

        if discovery_task and not discovery_task.done():
            discovery_task.cancel()

        if listener:
            await listener.stop()

        if telegram_client:
            await telegram_client.disconnect()

        await redis_queue.disconnect()

        logger.info("Shutdown complete")


def handle_shutdown(signum: int, frame) -> None:
    """
    Signal handler for graceful shutdown of the listener service.

    This function is registered to handle SIGINT (Ctrl+C) and SIGTERM (Docker stop,
    systemd stop) signals. When invoked, it sets the global shutdown_event, which
    causes the main() function to exit its wait loop and begin graceful shutdown.

    The handler itself does NOT perform cleanup - it only signals the intent to
    shutdown. The actual cleanup happens in the main() function's finally block.

    Signal Flow
    -----------
    1. User presses Ctrl+C or Docker sends SIGTERM
    2. OS invokes this handler with signal number
    3. Handler logs signal receipt and sets shutdown_event
    4. main() function wakes from shutdown_event.wait()
    5. main() enters finally block for cleanup
    6. Service shuts down gracefully

    Parameters
    ----------
    signum : int
        Signal number received (signal.SIGINT=2, signal.SIGTERM=15).

    frame : frame object
        Current stack frame at time of signal. Not used but required by
        signal.signal() API.

    Notes
    -----
    - This handler is synchronous (not async) because signal handlers must be
      regular functions, not coroutines.
    - The handler is non-blocking - it only sets an event flag.
    - Actual cleanup (closing connections, stopping tasks) happens in main().
    - If called multiple times (repeated Ctrl+C), subsequent calls are no-ops
      because shutdown_event.set() is idempotent.

    See Also
    --------
    main : Performs actual cleanup in finally block
    asyncio.Event : Async-safe event signaling mechanism
    """
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    shutdown_event.set()


if __name__ == "__main__":
    # Note: Structured logging already configured at module import via setup_logging()
    # No need for logging.basicConfig() - the observability module handles it

    # Setup signal handlers
    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    # Run the service
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Service interrupted by user")
    except Exception as e:
        logger.exception(f"Fatal error in listener service: {e}")
        sys.exit(1)
