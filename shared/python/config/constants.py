"""
Shared configuration constants for Telegram Archiver.

This module centralizes magic numbers and default values that are used
across multiple services. Services can override these via environment
variables in their own config modules.

Usage:
    from config.constants import Timeouts, RetryConfig, RateLimits

    async with httpx.AsyncClient(timeout=Timeouts.HTTP_DEFAULT) as client:
        ...
"""

import os


class Timeouts:
    """HTTP and operation timeout constants (in seconds)."""

    # HTTP client timeouts
    HTTP_DEFAULT = float(os.getenv("HTTP_TIMEOUT_DEFAULT", "30.0"))
    """Default timeout for HTTP requests."""

    HTTP_SHORT = float(os.getenv("HTTP_TIMEOUT_SHORT", "10.0"))
    """Short timeout for quick API calls (health checks, auth validation)."""

    HTTP_LONG = float(os.getenv("HTTP_TIMEOUT_LONG", "60.0"))
    """Long timeout for slow operations (LLM inference, large downloads)."""

    # Socket timeouts
    SOCKET_CONNECT = float(os.getenv("SOCKET_CONNECT_TIMEOUT", "5.0"))
    """Timeout for establishing socket connections."""

    # Redis timeouts
    REDIS_BRPOP = int(os.getenv("REDIS_BRPOP_TIMEOUT", "5"))
    """Timeout for Redis blocking pop operations."""

    # Processing timeouts
    FFMPEG_PROCESS = int(os.getenv("FFMPEG_TIMEOUT", "300"))
    """Timeout for FFmpeg video processing (5 minutes)."""

    LLM_INFERENCE = float(os.getenv("LLM_INFERENCE_TIMEOUT", "300.0"))
    """Timeout for LLM inference calls (5 minutes for CPU)."""

    RSS_VALIDATION = float(os.getenv("RSS_VALIDATION_TIMEOUT", "180.0"))
    """Timeout for RSS validation with multiple articles."""

    # Database timeouts
    DB_QUERY = float(os.getenv("DB_QUERY_TIMEOUT", "10.0"))
    """Default database query timeout."""

    DB_QUERY_LONG = float(os.getenv("DB_QUERY_TIMEOUT_LONG", "60.0"))
    """Long database query timeout for analytics."""

    # WebSocket timeouts
    WEBSOCKET_HEARTBEAT = int(os.getenv("WEBSOCKET_HEARTBEAT", "30"))
    """WebSocket heartbeat interval."""


class RetryConfig:
    """Retry and backoff configuration."""

    # Sleep durations between retries (in seconds)
    RETRY_SHORT = float(os.getenv("RETRY_SLEEP_SHORT", "1.0"))
    """Short retry sleep for quick operations."""

    RETRY_MEDIUM = float(os.getenv("RETRY_SLEEP_MEDIUM", "2.0"))
    """Medium retry sleep for API rate limiting."""

    RETRY_LONG = float(os.getenv("RETRY_SLEEP_LONG", "5.0"))
    """Long retry sleep for error recovery."""

    # Retry counts
    MAX_RETRIES = int(os.getenv("MAX_RETRIES", "3"))
    """Default maximum retry attempts."""

    # Polling intervals
    POLL_INTERVAL_FAST = float(os.getenv("POLL_INTERVAL_FAST", "1.0"))
    """Fast polling interval for real-time features."""

    POLL_INTERVAL_NORMAL = float(os.getenv("POLL_INTERVAL_NORMAL", "60.0"))
    """Normal polling interval for background tasks."""


class RateLimits:
    """Rate limiting defaults."""

    # API rate limits (requests per minute)
    API_DEFAULT = int(os.getenv("RATE_LIMIT_API", "60"))
    """Default API rate limit per IP."""

    API_AUTH = int(os.getenv("RATE_LIMIT_AUTH", "10"))
    """Auth endpoint rate limit (strict)."""

    API_SEARCH = int(os.getenv("RATE_LIMIT_SEARCH", "30"))
    """Search endpoint rate limit."""

    # Telegram rate limits
    TELEGRAM_REQUESTS_PER_SECOND = float(os.getenv("TELEGRAM_RPS", "0.5"))
    """Telegram API requests per second (conservative)."""

    TELEGRAM_SLEEP_BETWEEN = float(os.getenv("TELEGRAM_SLEEP", "2.0"))
    """Sleep between Telegram API calls."""


class QueryLimits:
    """Database query limit defaults."""

    DEFAULT = int(os.getenv("QUERY_LIMIT_DEFAULT", "50"))
    """Default query result limit."""

    SMALL = int(os.getenv("QUERY_LIMIT_SMALL", "10"))
    """Small query limit for suggestions/autocomplete."""

    MEDIUM = int(os.getenv("QUERY_LIMIT_MEDIUM", "100"))
    """Medium query limit for listings."""

    LARGE = int(os.getenv("QUERY_LIMIT_LARGE", "500"))
    """Large query limit for exports."""

    MAX = int(os.getenv("QUERY_LIMIT_MAX", "1000"))
    """Maximum allowed query limit."""


class CacheConfig:
    """Cache TTL configuration (in seconds)."""

    SHORT = int(os.getenv("CACHE_TTL_SHORT", "60"))
    """Short-lived cache (1 minute)."""

    MEDIUM = int(os.getenv("CACHE_TTL_MEDIUM", "300"))
    """Medium-lived cache (5 minutes)."""

    LONG = int(os.getenv("CACHE_TTL_LONG", "3600"))
    """Long-lived cache (1 hour)."""

    # Map-specific cache TTLs
    MAP_MESSAGES = int(os.getenv("MAP_CACHE_TTL_MESSAGES", "60"))
    """Cache TTL for map message queries."""

    MAP_CLUSTERS = int(os.getenv("MAP_CACHE_TTL_CLUSTERS", "300"))
    """Cache TTL for map cluster queries."""

    MAP_HEATMAP = int(os.getenv("MAP_CACHE_TTL_HEATMAP", "180"))
    """Cache TTL for map heatmap queries."""


class MediaConfig:
    """Media processing configuration."""

    MAX_FILE_SIZE_MB = int(os.getenv("MAX_MEDIA_SIZE_MB", "100"))
    """Maximum media file size in megabytes."""

    THUMBNAIL_SIZE = int(os.getenv("THUMBNAIL_SIZE", "200"))
    """Thumbnail dimension in pixels."""

    VIDEO_THUMBNAIL_SECOND = int(os.getenv("VIDEO_THUMB_SECOND", "1"))
    """Second to extract thumbnail from video."""
