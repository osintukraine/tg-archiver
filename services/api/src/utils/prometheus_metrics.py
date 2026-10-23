"""
PromQL used by /api/metrics/*.

Raw PromQL over metrics the services really export (no recording rules).
Scrape job names (phase 1 scrape config): listener, processor, api.
tests/test_metrics_endpoints.py checks every metric name below against the exporters.
"""


class PrometheusMetrics:
    # Throughput (per second, summed over series)
    MESSAGES_RECEIVED_RATE = "sum(rate(telegram_messages_received_total[5m]))"
    MESSAGES_PROCESSED_RATE = "sum(rate(tg_messages_processed_total[5m]))"
    MESSAGES_ARCHIVED_RATE = "sum(rate(tg_messages_archived_total[5m]))"
    API_REQUESTS_RATE = "sum(rate(api_requests_total[5m]))"

    # Latency (seconds)
    PROCESSING_P95 = (
        "histogram_quantile(0.95, sum by (le) (rate(tg_processing_duration_seconds_bucket[5m])))"
    )
    API_P95 = "histogram_quantile(0.95, sum by (le) (rate(api_request_duration_seconds_bucket[5m])))"

    # Queue
    QUEUE_DEPTH = "sum(tg_queue_depth)"
    QUEUE_PENDING = "sum(tg_queue_messages_pending)"
    DLQ_MESSAGES = "sum(tg_dlq_messages)"

    # Freshness: seconds since the last message. `> 0` drops the 0 an unset gauge exports,
    # so the series is absent until the first message
    LISTENER_AGE = "time() - max(telegram_last_message_timestamp > 0)"
    ARCHIVE_AGE = "time() - max(tg_message_last_archived_timestamp > 0)"

    # Database pool (api)
    DB_POOL_CHECKED_OUT = "sum(db_pool_checked_out)"

    @staticmethod
    def up(job: str) -> str:
        return f"up{{job='{job}'}}"
