"""
API Utilities

Common utilities for the API service.
"""

from .prometheus import PrometheusClient, get_prometheus_client, cleanup_prometheus_client
from .cache import (
    get_redis_client,
    close_redis_client,
    get_cached,
    set_cached,
    get_or_compute,
    make_cache_key,
    CacheTTL,
)
from .rate_limit import (
    RateLimiter,
    RateLimitInfo,
    rate_limit_dependency,
    add_rate_limit_headers,
    get_client_ip,
    get_rate_limiter,
    close_rate_limit_redis,
    # Rate limit configuration constants
    MAP_MESSAGES_RATE_LIMIT,
    MAP_CLUSTERS_RATE_LIMIT,
    MAP_EVENTS_RATE_LIMIT,
    MAP_HEATMAP_RATE_LIMIT,
    MAP_SUGGEST_RATE_LIMIT,
    MAP_REVERSE_RATE_LIMIT,
    MAP_CLUSTER_MESSAGES_RATE_LIMIT,
)
from .sql_safety import escape_ilike_pattern, escape_like_pattern
from .minio_client import (
    get_minio_client,
    close_minio_client,
    get_media_url,
    get_public_url,
    get_presigned_url,
    get_media_path,
    ensure_bucket_exists,
    check_object_exists,
    MINIO_BUCKET,
    MINIO_PUBLIC_URL,
)

__all__ = [
    # Prometheus
    "PrometheusClient",
    "get_prometheus_client",
    "cleanup_prometheus_client",
    # Cache
    "get_redis_client",
    "close_redis_client",
    "get_cached",
    "set_cached",
    "get_or_compute",
    "make_cache_key",
    "CacheTTL",
    # Rate Limiting
    "RateLimiter",
    "RateLimitInfo",
    "rate_limit_dependency",
    "add_rate_limit_headers",
    "get_client_ip",
    "get_rate_limiter",
    "close_rate_limit_redis",
    "MAP_MESSAGES_RATE_LIMIT",
    "MAP_CLUSTERS_RATE_LIMIT",
    "MAP_EVENTS_RATE_LIMIT",
    "MAP_HEATMAP_RATE_LIMIT",
    "MAP_SUGGEST_RATE_LIMIT",
    "MAP_REVERSE_RATE_LIMIT",
    "MAP_CLUSTER_MESSAGES_RATE_LIMIT",
    # SQL Safety
    "escape_ilike_pattern",
    "escape_like_pattern",
    # MinIO
    "get_minio_client",
    "close_minio_client",
    "get_media_url",
    "get_public_url",
    "get_presigned_url",
    "get_media_path",
    "ensure_bucket_exists",
    "check_object_exists",
    "MINIO_BUCKET",
    "MINIO_PUBLIC_URL",
]
