"""
Prometheus Metrics for Processor and API Services

Centralized metrics definitions for:
- Message processing pipeline
- Media archival
- API endpoints

All services import metrics from this module to ensure consistency.
"""

import logging
from prometheus_client import Counter, Gauge, Histogram, Info, start_http_server

logger = logging.getLogger(__name__)

# =============================================================================
# SERVICE INFORMATION
# =============================================================================

processor_service_info = Info("tg_processor", "Message Processor Service Information")
processor_service_info.info(
    {
        "version": "0.1.0",
        "service": "processor",
        "description": "Message processing pipeline (no AI)",
    }
)

api_service_info = Info("tg_api", "API Service Information")
api_service_info.info(
    {
        "version": "0.1.0",
        "service": "api",
        "description": "REST API with dynamic RSS feeds",
    }
)

# =============================================================================
# MESSAGE PROCESSING METRICS
# =============================================================================

# Message pipeline counters
messages_processed_total = Counter(
    "tg_messages_processed_total",
    "Total messages processed through pipeline",
    ["worker_id", "channel_id"],
)

messages_archived_total = Counter(
    "tg_messages_archived_total",
    "Total messages archived to database",
    ["channel_id", "routing_rule"],
)

# Processing pipeline stages duration
processing_duration_seconds = Histogram(
    "tg_processing_duration_seconds",
    "Time taken for complete message processing",
    ["stage"],  # only "total" is observed today
    buckets=[0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
)

# Topic classification
topics_total = Counter(
    "tg_topics_total",
    "Messages classified by topic",
    ["topic"],  # news, announcement, discussion, media, important, archive, offtopic, other
)

# =============================================================================
# ENTITY EXTRACTION METRICS
# =============================================================================

entities_extracted_total = Counter(
    "tg_entities_extracted_total",
    "Total entities extracted",
    ["entity_type", "channel_id"],  # hashtags, mentions, urls, coordinates, custom
)

entity_extraction_duration_seconds = Histogram(
    "tg_entity_extraction_duration_seconds",
    "Time taken for entity extraction",
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
)

# =============================================================================
# MEDIA ARCHIVAL METRICS
# =============================================================================

media_archived_total = Counter(
    "tg_media_archived_total",
    "Total media files archived",
    ["media_type", "channel_id"],  # photo, video, document, audio
)

media_download_duration_seconds = Histogram(
    "tg_media_download_duration_seconds",
    "Time taken to download media",
    ["media_type"],
    buckets=[0.5, 1, 5, 10, 30, 60, 120],
)

media_storage_bytes_total = Counter(
    "tg_media_storage_bytes_total",
    "Total bytes stored in MinIO",
    ["media_type"],
)

media_deduplication_saves_total = Counter(
    "tg_media_deduplication_saves_total",
    "Storage saved via SHA-256 deduplication",
    ["media_type"],
)

media_errors_total = Counter(
    "tg_media_errors_total",
    "Media archival errors",
    ["error_type"],  # download_failed, upload_failed, expired
)

media_archival_failures_total = Counter(
    "tg_media_archival_failures_total",
    "Messages with media_type but no media archived (silent failures)",
    ["channel_id", "media_type"],
)

# =============================================================================
# TRANSLATION METRICS
# =============================================================================

translation_operations_total = Counter(
    "tg_translation_operations_total",
    "Total translation operations",
    ["provider", "source_lang", "target_lang"],
)

translation_characters_total = Counter(
    "tg_translation_characters_total",
    "Total characters translated",
    ["provider"],
)

translation_cost_usd_total = Counter(
    "tg_translation_cost_usd_total",
    "Total translation cost in USD",
    ["provider"],
)

translation_errors_total = Counter(
    "tg_translation_errors_total",
    "Translation errors",
    ["provider", "error_type"],
)

# =============================================================================
# API METRICS
# =============================================================================

# Search operations
search_operations_total = Counter(
    "tg_search_operations_total",
    "Total search operations",
    ["search_type"],  # text, channel, topic, entity
)

search_results_count = Histogram(
    "tg_search_results_count",
    "Number of results returned per search",
    buckets=[0, 1, 10, 50, 100, 500, 1000, 5000],
)

# RSS feed generation
rss_feeds_generated_total = Counter(
    "tg_rss_feeds_generated_total",
    "Total RSS feeds generated",
    ["feed_type"],  # search, channel, topic
)

rss_generation_duration_seconds = Histogram(
    "tg_rss_generation_duration_seconds",
    "RSS feed generation time",
    ["feed_type"],
    buckets=[0.1, 0.5, 1, 2, 5, 10],
)

# =============================================================================
# DATABASE METRICS (via PostgreSQL Exporter)
# =============================================================================

database_query_duration_seconds = Histogram(
    "tg_database_query_duration_seconds",
    "Database query duration",
    ["query_type"],  # select, insert, update, delete
    buckets=[0.001, 0.01, 0.05, 0.1, 0.5, 1, 5],
)

# =============================================================================
# QUEUE METRICS (Redis)
# =============================================================================

queue_messages_pending = Gauge(
    "tg_queue_messages_pending",
    "Messages pending in Redis queue",
    ["consumer_group"],
)

# Backlog per stream (unread + delivered-but-unacked), label: realtime|backfill|legacy
queue_depth = Gauge(
    "tg_queue_depth",
    "Messages waiting in a stream (not yet acknowledged)",
    ["stream"],
)

dlq_messages = Gauge(
    "tg_dlq_messages",
    "Messages in the dead letter queue",
)

processed_total = Counter(
    "tg_processed_total",
    "Messages archived, by source stream",
    ["stream"],
)

# =============================================================================
# DATA FRESHNESS SLI METRICS
# =============================================================================

# Data freshness SLI - tracks when the last message was archived
# Used by alerting rules to detect stale data (no new messages archived)
message_last_archived_timestamp = Gauge(
    "tg_message_last_archived_timestamp",
    "Unix timestamp of the last message archived (for data freshness SLI)",
)

# Characters sent to DeepL today (UTC), from the shared Redis counter
translation_deepl_chars_today = Gauge(
    "tg_translation_deepl_chars_today",
    "Characters sent to DeepL today (UTC day), as counted against the daily cap",
)

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def record_message_processed(worker_id: str, channel_id: int, duration_seconds: float) -> None:
    """Record a processed message."""
    messages_processed_total.labels(
        worker_id=worker_id,
        channel_id=str(channel_id),
    ).inc()
    processing_duration_seconds.labels(stage="total").observe(duration_seconds)


def record_topic(topic: str) -> None:
    """Record topic classification."""
    topics_total.labels(topic=topic).inc()


def record_entity_extraction(
    entity_type: str, channel_id: int, count: int, duration_seconds: float
) -> None:
    """Record entity extraction."""
    entities_extracted_total.labels(
        entity_type=entity_type,
        channel_id=str(channel_id),
    ).inc(count)
    entity_extraction_duration_seconds.observe(duration_seconds)


def record_media_archived(
    media_type: str, channel_id: int, size_bytes: int, deduplicated: bool
) -> None:
    """Record media archival."""
    media_archived_total.labels(
        media_type=media_type,
        channel_id=str(channel_id),
    ).inc()
    media_storage_bytes_total.labels(media_type=media_type).inc(size_bytes)

    if deduplicated:
        media_deduplication_saves_total.labels(media_type=media_type).inc(size_bytes)


def record_media_archival_failure(channel_id: int, media_type: str) -> None:
    """Record a media archival failure (message has media_type but no files archived)."""
    media_archival_failures_total.labels(
        channel_id=str(channel_id),
        media_type=media_type,
    ).inc()


def record_search_operation(search_type: str, result_count: int) -> None:
    """Record search operation."""
    search_operations_total.labels(search_type=search_type).inc()
    search_results_count.observe(result_count)


def record_rss_generation(feed_type: str, duration_seconds: float) -> None:
    """Record RSS feed generation."""
    rss_feeds_generated_total.labels(feed_type=feed_type).inc()
    rss_generation_duration_seconds.labels(feed_type=feed_type).observe(
        duration_seconds
    )


def record_queue_depth(consumer_group: str, pending_count: int) -> None:
    """
    Record Redis queue depth for a consumer group.

    Args:
        consumer_group: Name of the consumer group (e.g., 'processor-workers')
        pending_count: Number of messages pending in the queue
    """
    queue_messages_pending.labels(consumer_group=consumer_group).set(pending_count)


def stream_label(stream_name: str) -> str:
    """Short metric label for a Redis stream name: realtime, backfill or legacy."""
    if "realtime" in stream_name:
        return "realtime"
    if "backfill" in stream_name:
        return "backfill"
    return "legacy"


def record_message_processed_by_stream(stream_name: str) -> None:
    """Count an archived message against the stream it came from."""
    processed_total.labels(stream=stream_label(stream_name)).inc()


def record_message_archived_timestamp() -> None:
    """
    Update the data freshness SLI with current Unix timestamp.

    Call this whenever a message is successfully archived to the database.
    Used by alerting rules to detect stale data (no new messages archived).
    """
    import time

    message_last_archived_timestamp.set(time.time())


class MetricsServer:
    """
    Prometheus metrics HTTP server.

    Exposes metrics on /metrics endpoint.
    """

    def __init__(self, port: int = 8002) -> None:
        """
        Initialize metrics server.

        Args:
            port: Port to expose metrics on (default: 8002 for processor, 8003 for API)
        """
        self.port = port
        self._server_started = False

    def start(self) -> None:
        """Start Prometheus metrics HTTP server."""
        if self._server_started:
            logger.warning(f"Metrics server already running on port {self.port}")
            return

        try:
            start_http_server(self.port)
            self._server_started = True
            logger.info(f"Prometheus metrics server started on port {self.port}")
            logger.info(f"Metrics available at: http://localhost:{self.port}/metrics")
        except Exception as e:
            logger.error(f"Failed to start metrics server: {e}")
            raise


# Global metrics server instances
processor_metrics_server = MetricsServer(port=8002)
api_metrics_server = MetricsServer(port=8003)
