"""
Prometheus Metrics for Processor and API Services

Centralized metrics definitions for:
- Message processing pipeline (routing, entities, scoring)
- RuleEngine performance
- LLM processing (Ollama)
- Media archival
- API endpoints

All services import metrics from this module to ensure consistency.
"""

import logging
from typing import Optional

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
        "description": "Message enrichment pipeline with rule-based and LLM scoring",
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

messages_skipped_total = Counter(
    "tg_messages_skipped_total",
    "Total messages skipped (low relevance score)",
    ["channel_id", "skip_reason"],
)

# Processing pipeline stages duration
processing_duration_seconds = Histogram(
    "tg_processing_duration_seconds",
    "Time taken for complete message processing",
    ["stage"],  # routing, extraction, scoring, persistence
    buckets=[0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
)

# =============================================================================
# RULEENGINE METRICS (Phase 2B)
# =============================================================================

rule_evaluations_total = Counter(
    "tg_rule_evaluations_total",
    "Total rule-based evaluations",
    ["channel_id"],
)

rule_matches_total = Counter(
    "tg_rule_matches_total",
    "Total rule pattern matches",
    ["rule_name", "channel_id"],
)

rule_evaluation_duration_ms = Histogram(
    "tg_rule_evaluation_duration_ms",
    "Time taken for rule evaluation (milliseconds)",
    buckets=[1, 5, 10, 20, 50, 100, 200],
)

llm_calls_skipped_total = Counter(
    "tg_llm_calls_skipped_total",
    "LLM calls skipped due to rule-based scoring",
    ["channel_id", "skip_reason"],  # force_archive, skip_llm, threshold_met
)

rule_coverage_rate = Gauge(
    "tg_rule_coverage_rate",
    "Percentage of messages matched by rules (0-100)",
)

rule_force_archive_total = Counter(
    "tg_rule_force_archive_total",
    "Messages archived via force_archive rules",
    ["rule_name", "channel_id"],
)

# =============================================================================
# LLM PROCESSING METRICS (Ollama)
# =============================================================================

llm_requests_total = Counter(
    "tg_llm_requests_total",
    "Total LLM scoring requests",
    ["model", "status"],  # status: success, failed, timeout
)

llm_response_duration_seconds = Histogram(
    "tg_llm_response_duration_seconds",
    "LLM response time in seconds",
    ["model"],
    # Updated 2025-11-30: Old buckets maxed at 30s but actual LLM latency is 50-270s
    buckets=[1, 5, 10, 30, 60, 120, 180, 300],  # Up to 5 minutes
)

llm_errors_total = Counter(
    "tg_llm_errors_total",
    "Total LLM errors",
    ["error_type"],  # connection_error, timeout, invalid_response
)

llm_tokens_total = Counter(
    "tg_llm_tokens_total",
    "Total tokens processed by LLM",
    ["model", "token_type"],  # prompt, completion
)

# Classifier mode metrics
classifier_mode_total = Counter(
    "tg_classifier_mode_total",
    "Classifications by mode",
    ["mode"],  # unified, modular
)

classifier_early_exit_total = Counter(
    "tg_classifier_early_exit_total",
    "Early exits in modular mode",
)

classifier_fallback_total = Counter(
    "tg_classifier_fallback_total",
    "Fallbacks from modular to unified",
    ["failed_task"],  # topic_classify, etc.
)

classifier_task_duration_seconds = Histogram(
    "tg_classifier_task_duration_seconds",
    "Per-task latency in modular mode",
    ["task"],  # topic_classify, importance_score, archive_decision
    buckets=[0.1, 0.5, 1, 2, 5, 10, 30, 60],
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

# HTTP requests
api_requests_total = Counter(
    "tg_api_requests_total",
    "Total API requests",
    ["method", "endpoint", "status_code"],
)

api_request_duration_seconds = Histogram(
    "tg_api_request_duration_seconds",
    "API request duration",
    ["method", "endpoint"],
    buckets=[0.01, 0.05, 0.1, 0.5, 1, 2, 5],
)

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

database_connections_active = Gauge(
    "tg_database_connections_active",
    "Active database connections",
)

# =============================================================================
# QUEUE METRICS (Redis)
# =============================================================================

queue_messages_pending = Gauge(
    "tg_queue_messages_pending",
    "Messages pending in Redis queue",
    ["consumer_group"],
)

queue_consumer_lag_seconds = Gauge(
    "tg_queue_consumer_lag_seconds",
    "Consumer lag in seconds",
    ["consumer_group", "consumer_id"],
)

# Priority queue metrics (realtime vs backfill streams)
queue_depth_realtime = Gauge(
    "tg_queue_depth_realtime",
    "Messages waiting in realtime priority queue",
)

queue_depth_backfill = Gauge(
    "tg_queue_depth_backfill",
    "Messages waiting in backfill priority queue",
)

queue_depth_legacy = Gauge(
    "tg_queue_depth_legacy",
    "Messages waiting in legacy queue (migration drain)",
)

processed_realtime_total = Counter(
    "tg_processed_realtime_total",
    "Total realtime messages processed",
)

processed_backfill_total = Counter(
    "tg_processed_backfill_total",
    "Total backfill messages processed",
)

processed_legacy_total = Counter(
    "tg_processed_legacy_total",
    "Total legacy queue messages processed (migration drain)",
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

# Pipeline activity gauge - tracks overall pipeline health
pipeline_active = Gauge(
    "tg_pipeline_active",
    "Whether the pipeline is actively processing (1=active, 0=inactive)",
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


def record_rule_evaluation(
    channel_id: int,
    rule_name: Optional[str],
    matched: bool,
    duration_ms: float,
    skip_llm: bool = False,
) -> None:
    """Record rule engine evaluation."""
    rule_evaluations_total.labels(channel_id=str(channel_id)).inc()
    rule_evaluation_duration_ms.observe(duration_ms)

    if matched and rule_name:
        rule_matches_total.labels(
            rule_name=rule_name,
            channel_id=str(channel_id),
        ).inc()

    if skip_llm:
        llm_calls_skipped_total.labels(
            channel_id=str(channel_id),
            skip_reason="rule_matched",
        ).inc()


def record_llm_request(
    model: str, status: str, duration_seconds: float, tokens: int = 0
) -> None:
    """Record LLM scoring request."""
    llm_requests_total.labels(model=model, status=status).inc()
    llm_response_duration_seconds.labels(model=model).observe(duration_seconds)

    if tokens > 0:
        llm_tokens_total.labels(model=model, token_type="total").inc(tokens)


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


def record_api_request(
    method: str, endpoint: str, status_code: int, duration_seconds: float
) -> None:
    """Record API request."""
    api_requests_total.labels(
        method=method,
        endpoint=endpoint,
        status_code=str(status_code),
    ).inc()
    api_request_duration_seconds.labels(
        method=method,
        endpoint=endpoint,
    ).observe(duration_seconds)


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


def record_priority_queue_depths(
    realtime: int = 0,
    backfill: int = 0,
    legacy: int = 0
) -> None:
    """
    Record queue depths for each priority stream.

    Args:
        realtime: Messages in realtime queue
        backfill: Messages in backfill queue
        legacy: Messages in legacy queue (migration drain)
    """
    queue_depth_realtime.set(realtime)
    queue_depth_backfill.set(backfill)
    queue_depth_legacy.set(legacy)


def record_message_processed_by_stream(stream_name: str) -> None:
    """
    Record a processed message by source stream.

    Args:
        stream_name: Redis stream name (realtime, backfill, or legacy)
    """
    if "realtime" in stream_name:
        processed_realtime_total.inc()
    elif "backfill" in stream_name:
        processed_backfill_total.inc()
    else:
        processed_legacy_total.inc()


def record_message_archived_timestamp() -> None:
    """
    Update the data freshness SLI with current Unix timestamp.

    Call this whenever a message is successfully archived to the database.
    Used by alerting rules to detect stale data (no new messages archived).
    """
    import time

    message_last_archived_timestamp.set(time.time())
    pipeline_active.set(1)


def mark_pipeline_inactive() -> None:
    """
    Mark the pipeline as inactive (e.g., during shutdown or when no messages are being processed).
    """
    pipeline_active.set(0)


def record_classifier_mode(mode: str) -> None:
    """Record which classifier mode was used."""
    classifier_mode_total.labels(mode=mode).inc()


def record_classifier_early_exit() -> None:
    """Record early exit in modular classifier."""
    classifier_early_exit_total.inc()


def record_classifier_fallback(failed_task: str) -> None:
    """Record fallback from modular to unified."""
    classifier_fallback_total.labels(failed_task=failed_task).inc()


def record_classifier_task_duration(task: str, duration_seconds: float) -> None:
    """Record per-task duration in modular mode."""
    classifier_task_duration_seconds.labels(task=task).observe(duration_seconds)


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
