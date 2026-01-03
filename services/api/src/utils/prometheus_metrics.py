"""
Prometheus Metric Names

Centralized constants for all Prometheus metric names used in the API.
This prevents typos and makes it easy to update metric names when
recording rules change.

Naming Convention:
- Recording rules: tg:<metric>:<aggregation>
- Raw metrics: tg_<metric_name>
"""


class PrometheusMetrics:
    """
    Centralized Prometheus metric name constants.

    Categories:
    - THROUGHPUT_*: Message processing rates
    - QUEUE_*: Queue depth and lag metrics
    - LLM_*: LLM performance metrics
    - RESOURCE_*: Database, Redis, etc.
    - ERROR_*: Error rates
    """

    # Throughput metrics (recording rules)
    THROUGHPUT_MESSAGES_PROCESSED = "tg:messages_processed:rate5m"
    THROUGHPUT_MESSAGES_ARCHIVED = "tg:messages_archived:rate5m"
    THROUGHPUT_MESSAGES_SKIPPED = "tg:messages_skipped:rate5m"

    # Queue metrics
    QUEUE_MESSAGES_PENDING = "tg_queue_messages_pending"
    QUEUE_ENRICHMENT_DEPTH = "sum(enrichment_queue_depth)"
    QUEUE_ENRICHMENT_LAG = "max(enrichment_queue_lag_seconds)"

    # LLM metrics (recording rules)
    LLM_REQUESTS_RATE = "tg:llm_requests:rate5m"
    LLM_AVG_LATENCY = "tg:llm_response:avg_duration_seconds"
    LLM_SUCCESS_RATE = "tg:llm_success_rate:5m"

    # Resource metrics
    RESOURCE_DB_CONNECTIONS = "tg_database_connections_active"
    RESOURCE_REDIS_MEMORY = "redis_memory_used_bytes"

    # Error metrics
    ERROR_ENRICHMENT_RATE = "rate(enrichment_errors_total[5m])"

    # Service health metrics
    SERVICE_LISTENER_UP = "up{job='listener'}"
    SERVICE_PROCESSOR_UP = "up{job='processor'}"
    SERVICE_ENRICHMENT_UP = "up{job='enrichment'}"
    SERVICE_API_UP = "up{job='api'}"

    # Pipeline stage metrics (recording rules from recording_rules.yml)
    PIPELINE_QUEUE_DEPTH = "tg:enrichment_queue:total_depth"
    PIPELINE_MAX_LAG = "tg:enrichment_queue:max_lag_seconds"
    PIPELINE_PROCESSING_P95 = "tg:processing_duration:p95_seconds"
