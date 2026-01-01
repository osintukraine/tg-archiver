"""
Prometheus Metrics for Telegram Listener Service

Tracks key operational metrics:
- Messages received/processed
- Active channels being monitored
- Channel discovery operations
- Translation usage
- Queue depth
- Error rates

Metrics are exposed on port 8001 (/metrics endpoint).
"""

import logging
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from threading import Thread
from typing import Optional

from prometheus_client import Counter, Gauge, Histogram, Info, start_http_server

logger = logging.getLogger(__name__)

# Activity tracking for health checks
_last_message_time: float = 0.0  # Unix timestamp of last message received
_listener_started_time: float = 0.0  # Unix timestamp when listener started
MESSAGE_STALE_THRESHOLD_SECONDS = 600  # 10 minutes - mark unhealthy if no messages

# Service information
service_info = Info("telegram_listener", "Telegram Listener Service Information")
service_info.info(
    {
        "version": "0.1.0",
        "service": "listener",
        "description": "Telegram message ingestion with folder-based discovery",
    }
)

# Message ingestion metrics
messages_received = Counter(
    "telegram_messages_received_total",
    "Total messages received from Telegram",
    ["channel_id", "channel_name", "has_media"],
)

messages_queued = Counter(
    "telegram_messages_queued_total",
    "Total messages pushed to Redis queue",
    ["channel_id"],
)

messages_failed = Counter(
    "telegram_messages_failed_total",
    "Total messages that failed to process",
    ["channel_id", "error_type"],
)

# Channel discovery metrics
channels_discovered = Gauge(
    "telegram_channels_discovered",
    "Number of channels discovered from folders",
    ["folder", "rule"],
)

channels_active = Gauge(
    "telegram_channels_active_total", "Total number of active channels being monitored"
)

discovery_operations = Counter(
    "telegram_discovery_operations_total",
    "Total channel discovery operations",
    ["status"],  # success, failed
)

discovery_duration = Histogram(
    "telegram_discovery_duration_seconds",
    "Time taken for channel discovery operation",
    buckets=[1, 5, 10, 30, 60, 120],  # seconds
)

# Translation metrics
translations_total = Counter(
    "translations_total",
    "Total translation operations",
    ["provider", "source_lang", "target_lang"],
)

translation_characters = Counter(
    "translation_characters_total",
    "Total characters translated",
    ["provider"],
)

translation_cost_usd = Counter(
    "translation_cost_usd_total",
    "Total translation cost in USD",
    ["provider"],
)

translation_duration = Histogram(
    "translation_duration_seconds",
    "Time taken for translation operation",
    ["provider"],
    buckets=[0.1, 0.5, 1, 2, 5, 10],  # seconds
)

# Queue metrics
queue_depth = Gauge(
    "redis_queue_depth", "Number of messages waiting in Redis queue"
)

queue_pending = Gauge(
    "redis_queue_pending", "Number of messages pending acknowledgment"
)

# Connection metrics
telegram_connections = Gauge(
    "telegram_connections_active",
    "Number of active Telegram connections",
)

redis_connections = Gauge(
    "redis_connections_active",
    "Number of active Redis connections",
)

# Health check metrics
last_message_timestamp = Gauge(
    "telegram_last_message_timestamp",
    "Unix timestamp of last message received (for health check)",
)

listener_started_timestamp = Gauge(
    "telegram_listener_started_timestamp",
    "Unix timestamp when listener started",
)

# Error metrics
flood_waits = Counter(
    "telegram_flood_waits_total",
    "Total number of Telegram flood-wait errors",
    ["wait_seconds_bucket"],  # 0-60, 60-300, 300-3600, 3600+
)

connection_errors = Counter(
    "connection_errors_total",
    "Total connection errors",
    ["service"],  # telegram, redis, postgres
)

# Backfill metrics
backfill_messages_total = Counter(
    "backfill_messages_total",
    "Total messages fetched during backfill operations",
    ["channel_id", "channel_name", "status"],  # status: fetched, stored, expired
)

backfill_duration_seconds = Histogram(
    "backfill_duration_seconds",
    "Time taken for backfill operation",
    ["channel_id", "status"],  # status: completed, failed, paused
    buckets=[60, 300, 600, 1800, 3600, 7200, 14400],  # 1min to 4 hours
)

backfill_status = Gauge(
    "backfill_status",
    "Current backfill status per channel (0=none, 1=pending, 2=in_progress, 3=completed, 4=failed, 5=paused)",
    ["channel_id", "channel_name"],
)

backfill_media_status = Counter(
    "backfill_media_status_total",
    "Media availability status during backfill",
    ["channel_id", "status"],  # status: available, expired
)


class HealthCheckHandler(BaseHTTPRequestHandler):
    """HTTP handler for health check endpoint."""

    def log_message(self, format, *args):
        """Suppress default HTTP logging."""
        pass

    def do_GET(self):
        """Handle GET requests for health check."""
        if self.path == "/health" or self.path == "/healthz":
            is_healthy, message = check_message_activity()
            if is_healthy:
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(message.encode())
            else:
                self.send_response(503)
                self.send_header("Content-Type", "text/plain")
                self.end_headers()
                self.wfile.write(message.encode())
        else:
            self.send_response(404)
            self.end_headers()


def check_message_activity() -> tuple[bool, str]:
    """
    Check if the listener is receiving messages.

    Returns healthy if:
    - Listener started within grace period (first 10 minutes), OR
    - Last message received within threshold

    Returns:
        Tuple of (is_healthy: bool, message: str)
    """
    global _last_message_time, _listener_started_time

    now = time.time()

    # Grace period: don't fail health check in first 10 minutes after start
    # This allows time for Telegram to send initial messages
    if _listener_started_time > 0:
        uptime = now - _listener_started_time
        if uptime < MESSAGE_STALE_THRESHOLD_SECONDS:
            return True, f"OK: Listener started {int(uptime)}s ago (grace period)"

    # Check if we've received any messages
    if _last_message_time == 0:
        return False, f"UNHEALTHY: No messages received since startup"

    # Check message age
    message_age = now - _last_message_time
    if message_age > MESSAGE_STALE_THRESHOLD_SECONDS:
        return False, f"UNHEALTHY: No messages in {int(message_age)}s (threshold: {MESSAGE_STALE_THRESHOLD_SECONDS}s)"

    return True, f"OK: Last message {int(message_age)}s ago"


def mark_listener_started():
    """Mark the listener as started (for health check grace period)."""
    global _listener_started_time
    _listener_started_time = time.time()
    listener_started_timestamp.set(_listener_started_time)
    logger.info(f"Listener started at {_listener_started_time}, health check grace period: {MESSAGE_STALE_THRESHOLD_SECONDS}s")


class MetricsServer:
    """
    Prometheus metrics HTTP server with health check endpoint.

    Exposes:
    - /metrics: Prometheus metrics
    - /health: Health check (returns 503 if no messages in 10 minutes)
    """

    def __init__(self, port: int = 8001, health_port: int = 8002):
        """
        Initialize metrics server.

        Args:
            port: Port to expose metrics on (default: 8001)
            health_port: Port for health check endpoint (default: 8002)
        """
        self.port = port
        self.health_port = health_port
        self._server_started = False
        self._health_server = None
        self._health_thread = None

    def start(self):
        """Start Prometheus metrics HTTP server and health check server."""
        if self._server_started:
            logger.warning(f"Metrics server already running on port {self.port}")
            return

        try:
            # Start Prometheus metrics server
            start_http_server(self.port)
            logger.info(f"Prometheus metrics server started on port {self.port}")

            # Start health check server on separate port
            self._health_server = HTTPServer(("0.0.0.0", self.health_port), HealthCheckHandler)
            self._health_thread = Thread(target=self._health_server.serve_forever, daemon=True)
            self._health_thread.start()
            logger.info(f"Health check server started on port {self.health_port}")

            self._server_started = True
            logger.info(f"Metrics available at: http://localhost:{self.port}/metrics")
            logger.info(f"Health check at: http://localhost:{self.health_port}/health")
        except Exception as e:
            logger.error(f"Failed to start metrics server: {e}")
            raise


# Helper functions for common metric updates


def record_message_received(
    channel_id: int,
    channel_name: str,
    has_media: bool = False,
):
    """
    Record a message received from Telegram.

    Args:
        channel_id: Telegram channel ID
        channel_name: Channel name
        has_media: Whether message contains media
    """
    global _last_message_time
    _last_message_time = time.time()
    last_message_timestamp.set(_last_message_time)

    messages_received.labels(
        channel_id=str(channel_id),
        channel_name=channel_name,
        has_media="true" if has_media else "false",
    ).inc()


def record_message_queued(channel_id: int):
    """
    Record a message pushed to Redis queue.

    Args:
        channel_id: Telegram channel ID
    """
    messages_queued.labels(channel_id=str(channel_id)).inc()


def record_message_failed(channel_id: int, error_type: str):
    """
    Record a failed message.

    Args:
        channel_id: Telegram channel ID
        error_type: Type of error (e.g., "redis_error", "encoding_error")
    """
    messages_failed.labels(
        channel_id=str(channel_id),
        error_type=error_type,
    ).inc()


def record_discovery_operation(
    status: str,
    duration_seconds: float,
    channels_found: int = 0,
):
    """
    Record a channel discovery operation.

    Args:
        status: Operation status ("success" or "failed")
        duration_seconds: Time taken in seconds
        channels_found: Number of channels discovered
    """
    discovery_operations.labels(status=status).inc()
    discovery_duration.observe(duration_seconds)

    if status == "success":
        channels_active.set(channels_found)


def record_translation(
    provider: str,
    source_lang: str,
    target_lang: str,
    character_count: int,
    cost_usd: float,
    duration_seconds: float,
):
    """
    Record a translation operation.

    Args:
        provider: Translation provider (deepl, google)
        source_lang: Source language code
        target_lang: Target language code
        character_count: Number of characters translated
        cost_usd: Cost in USD
        duration_seconds: Time taken in seconds
    """
    translations_total.labels(
        provider=provider,
        source_lang=source_lang,
        target_lang=target_lang,
    ).inc()

    translation_characters.labels(provider=provider).inc(character_count)
    translation_cost_usd.labels(provider=provider).inc(cost_usd)
    translation_duration.labels(provider=provider).observe(duration_seconds)


def record_flood_wait(wait_seconds: int):
    """
    Record a Telegram flood-wait error.

    Args:
        wait_seconds: Number of seconds to wait
    """
    # Bucket flood-wait times for better visualization
    if wait_seconds <= 60:
        bucket = "0-60"
    elif wait_seconds <= 300:
        bucket = "60-300"
    elif wait_seconds <= 3600:
        bucket = "300-3600"
    else:
        bucket = "3600+"

    flood_waits.labels(wait_seconds_bucket=bucket).inc()


def update_queue_metrics(depth: int, pending: int):
    """
    Update queue depth metrics.

    Args:
        depth: Number of messages in queue
        pending: Number of pending acknowledgments
    """
    queue_depth.set(depth)
    queue_pending.set(pending)


def record_connection_error(service: str):
    """
    Record a connection error.

    Args:
        service: Service name (telegram, redis, postgres)
    """
    connection_errors.labels(service=service).inc()


def record_backfill_message(
    channel_id: int,
    channel_name: str,
    status: str,
):
    """
    Record a message during backfill operation.

    Args:
        channel_id: Telegram channel ID
        channel_name: Channel name
        status: Message status (fetched, stored, expired)
    """
    backfill_messages_total.labels(
        channel_id=str(channel_id),
        channel_name=channel_name,
        status=status,
    ).inc()


def record_backfill_complete(
    channel_id: int,
    duration_seconds: float,
    status: str,
):
    """
    Record completion of backfill operation.

    Args:
        channel_id: Telegram channel ID
        duration_seconds: Time taken in seconds
        status: Backfill outcome (completed, failed, paused)
    """
    backfill_duration_seconds.labels(
        channel_id=str(channel_id),
        status=status,
    ).observe(duration_seconds)


def update_backfill_status(
    channel_id: int,
    channel_name: str,
    status: str,
):
    """
    Update backfill status gauge for a channel.

    Args:
        channel_id: Telegram channel ID
        channel_name: Channel name
        status: Backfill status (pending, in_progress, completed, failed, paused, none)
    """
    # Map status strings to numeric values for Prometheus gauge
    status_map = {
        "none": 0,
        "pending": 1,
        "in_progress": 2,
        "completed": 3,
        "failed": 4,
        "paused": 5,
    }

    status_value = status_map.get(status, 0)

    backfill_status.labels(
        channel_id=str(channel_id),
        channel_name=channel_name,
    ).set(status_value)


def record_backfill_media(
    channel_id: int,
    status: str,
):
    """
    Record media availability during backfill.

    Args:
        channel_id: Telegram channel ID
        status: Media status (available, expired)
    """
    backfill_media_status.labels(
        channel_id=str(channel_id),
        status=status,
    ).inc()


# Global metrics server instance
metrics_server = MetricsServer()
