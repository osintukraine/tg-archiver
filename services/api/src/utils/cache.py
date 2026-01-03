"""
Redis Caching Utilities

Server-side caching for API responses to reduce backend load.
Used by /api/metrics/* and /api/analytics/* endpoints.
"""

import json
import hashlib
from typing import Optional, Any, Callable, TypeVar
from datetime import datetime
from functools import wraps

import redis.asyncio as redis
from pydantic import BaseModel

from config.settings import settings
from observability import get_logger

logger = get_logger(__name__)

# Redis connection settings
REDIS_URL = getattr(settings, 'REDIS_URL', 'redis://redis:6379/0')

# Cache key prefix to avoid collisions
CACHE_PREFIX = "api:cache:"

# Singleton Redis client
_redis_client: Optional[redis.Redis] = None


async def get_redis_client() -> redis.Redis:
    """Get or create Redis client singleton."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


async def close_redis_client():
    """Close Redis client on shutdown."""
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None


def make_cache_key(prefix: str, *args, **kwargs) -> str:
    """
    Generate a cache key from prefix and arguments.

    Args:
        prefix: Cache key prefix (e.g., "metrics:overview")
        *args: Positional arguments to include in key
        **kwargs: Keyword arguments to include in key

    Returns:
        Cache key string
    """
    key_parts = [CACHE_PREFIX, prefix]

    if args:
        key_parts.extend(str(a) for a in args)

    if kwargs:
        # Sort kwargs for consistent key generation
        sorted_kwargs = sorted(kwargs.items())
        key_parts.extend(f"{k}={v}" for k, v in sorted_kwargs)

    return ":".join(key_parts)


async def get_cached(key: str) -> Optional[dict]:
    """
    Get cached value from Redis.

    Args:
        key: Cache key

    Returns:
        Cached dict or None if not found/expired
    """
    try:
        client = await get_redis_client()
        cached = await client.get(key)
        if cached:
            return json.loads(cached)
        return None
    except Exception as e:
        logger.warning(f"Redis cache get error: {e}")
        return None


async def set_cached(key: str, value: Any, ttl_seconds: int = 15) -> bool:
    """
    Set cached value in Redis with TTL.

    Args:
        key: Cache key
        value: Value to cache (must be JSON serializable or Pydantic model)
        ttl_seconds: Time-to-live in seconds

    Returns:
        True if cached successfully, False otherwise
    """
    try:
        client = await get_redis_client()

        # Handle Pydantic models
        if isinstance(value, BaseModel):
            json_value = value.model_dump_json()
        else:
            json_value = json.dumps(value, default=str)

        await client.setex(key, ttl_seconds, json_value)
        return True
    except Exception as e:
        logger.warning(f"Redis cache set error: {e}")
        return False


async def get_or_compute(
    cache_key: str,
    compute_fn: Callable,
    ttl_seconds: int = 15,
) -> tuple[Any, bool]:
    """
    Get from cache or compute and cache result.

    This is the primary caching pattern for metrics endpoints.

    Args:
        cache_key: Redis cache key
        compute_fn: Async function to compute value if not cached
        ttl_seconds: Cache TTL in seconds

    Returns:
        Tuple of (result, was_cached)
    """
    # Try cache first
    cached = await get_cached(cache_key)
    if cached is not None:
        return cached, True

    # Compute fresh value
    result = await compute_fn()

    # Cache for next request
    await set_cached(cache_key, result, ttl_seconds)

    return result, False


T = TypeVar('T')


def cached_endpoint(prefix: str, ttl_seconds: int = 15):
    """
    Decorator for caching endpoint responses in Redis.

    Usage:
        @router.get("/overview")
        @cached_endpoint("metrics:overview", ttl_seconds=15)
        async def get_overview():
            # expensive computation
            return result

    Args:
        prefix: Cache key prefix
        ttl_seconds: Cache TTL
    """
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Generate cache key from function name and arguments
            cache_key = make_cache_key(prefix)

            # Try cache
            cached = await get_cached(cache_key)
            if cached is not None:
                logger.debug(f"Cache hit: {cache_key}")
                return cached

            # Compute
            logger.debug(f"Cache miss: {cache_key}")
            result = await func(*args, **kwargs)

            # Cache result
            await set_cached(cache_key, result, ttl_seconds)

            return result

        return wrapper
    return decorator


# Cache TTL constants (in seconds)
class CacheTTL:
    """Standard cache TTLs by endpoint type."""
    METRICS = 15          # Real-time metrics (matches Prometheus scrape)
    ANALYTICS = 60        # Analytics aggregations
    DISTRIBUTIONS = 300   # Slow-changing distributions (5 min)
    ADMIN_STATS = 30      # Admin stats (need freshness)
    HEALTH = 10           # Service health checks
