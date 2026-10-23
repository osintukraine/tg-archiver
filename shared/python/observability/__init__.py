"""
Observability module for Telegram Archiver.

Provides:
- Prometheus metrics (metrics.py)
- Structured JSON logging (logging.py)
- Future: OpenTelemetry tracing
"""

from .logging import (
    setup_logging,
    get_logger,
    LogContext,
    set_trace_id,
    get_trace_id,
    clear_trace_id,
    redact_url,
)

from .metrics import (
    # Metrics servers
    api_metrics_server,
    processor_metrics_server,
    # Helper functions
    record_entity_extraction,
    record_media_archived,
    record_message_processed,
    record_topic,
    record_rss_generation,
    record_search_operation,
)

__all__ = [
    # Logging
    "setup_logging",
    "get_logger",
    "LogContext",
    "set_trace_id",
    "get_trace_id",
    "clear_trace_id",
    "redact_url",
    # Metrics servers
    "processor_metrics_server",
    "api_metrics_server",
    # Helper functions
    "record_message_processed",
    "record_topic",
    "record_entity_extraction",
    "record_media_archived",
    "record_search_operation",
    "record_rss_generation",
]
