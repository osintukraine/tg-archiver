"""
Shared Redis connection pool for WebSocket connections.

Prevents creating a new Redis client per WebSocket, which would exhaust
Redis connections with 100+ concurrent WebSocket clients.
"""

import logging
from typing import Optional

import redis.asyncio as redis
from config.settings import settings

logger = logging.getLogger(__name__)

# Module-level singleton
_ws_redis_pool: Optional[redis.ConnectionPool] = None


async def get_ws_redis_pool() -> redis.ConnectionPool:
    """
    Get or create the shared Redis connection pool for WebSockets.

    Returns:
        Shared ConnectionPool instance
    """
    global _ws_redis_pool

    if _ws_redis_pool is None:
        _ws_redis_pool = redis.ConnectionPool.from_url(
            settings.REDIS_URL,
            max_connections=50,  # Limit concurrent WebSocket Redis connections
            decode_responses=True,
        )
        logger.info("Created WebSocket Redis connection pool (max_connections=50)")

    return _ws_redis_pool


async def get_ws_redis_client() -> redis.Redis:
    """
    Get a Redis client from the shared pool.

    Returns:
        Redis client using the shared pool
    """
    pool = await get_ws_redis_pool()
    return redis.Redis(connection_pool=pool)


async def cleanup_ws_redis_pool() -> None:
    """Cleanup the Redis pool on application shutdown."""
    global _ws_redis_pool

    if _ws_redis_pool is not None:
        await _ws_redis_pool.disconnect()
        _ws_redis_pool = None
        logger.info("Closed WebSocket Redis connection pool")
