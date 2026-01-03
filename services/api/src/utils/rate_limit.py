"""
Redis-based Rate Limiting for API Endpoints

Implements a sliding window rate limiter using Redis for distributed rate limiting.
Designed for expensive map API endpoints to prevent abuse.

Features:
- Redis-backed for distributed rate limiting across multiple API instances
- Sliding window algorithm for fair rate limiting
- Configurable per-endpoint limits
- Per-user/key tiered limits (anonymous, authenticated, premium, admin)
- Fail-open on Redis errors (logs warning, allows request)
- X-Forwarded-For support for clients behind proxies
- Response headers for rate limit information

Usage:
    from src.utils.rate_limit import RateLimiter, rate_limit_dependency

    # As a dependency with tier-based limits
    @router.get("/expensive")
    async def expensive_endpoint(
        request: Request,
        rate_limit: None = Depends(rate_limit_dependency(category="media"))
    ):
        ...

    # Or use the RateLimiter directly
    limiter = RateLimiter()
    allowed, info = await limiter.check_rate_limit(
        client_id="192.168.1.1",
        endpoint="map_messages",
        limit=30
    )
"""

import os
import time
from typing import Optional, Tuple

import redis.asyncio as redis
from fastapi import HTTPException, Request, Response
from starlette.responses import JSONResponse

from config.settings import settings
from observability import get_logger

logger = get_logger(__name__)

# =============================================================================
# Configuration (Environment Variables)
# =============================================================================

# Rate limits per minute for map endpoints (configurable via env vars)
# Higher limits for development - pan/zoom triggers many rapid requests
MAP_MESSAGES_RATE_LIMIT = int(os.getenv("MAP_MESSAGES_RATE_LIMIT", "120"))
MAP_CLUSTERS_RATE_LIMIT = int(os.getenv("MAP_CLUSTERS_RATE_LIMIT", "120"))
MAP_EVENTS_RATE_LIMIT = int(os.getenv("MAP_EVENTS_RATE_LIMIT", "60"))
MAP_HEATMAP_RATE_LIMIT = int(os.getenv("MAP_HEATMAP_RATE_LIMIT", "60"))
MAP_SUGGEST_RATE_LIMIT = int(os.getenv("MAP_SUGGEST_RATE_LIMIT", "60"))
MAP_REVERSE_RATE_LIMIT = int(os.getenv("MAP_REVERSE_RATE_LIMIT", "60"))
MAP_CLUSTER_MESSAGES_RATE_LIMIT = int(os.getenv("MAP_CLUSTER_MESSAGES_RATE_LIMIT", "60"))

# Rate limits for media endpoints (anti-leeching protection)
# These apply to cold-path requests (API redirect to storage)
# Hot-path requests (local buffer) bypass the API entirely
MEDIA_REDIRECT_RATE_LIMIT = int(os.getenv("MEDIA_REDIRECT_RATE_LIMIT", "300"))  # 300/min per IP (supports gallery loads)

# Rate limit tiers (requests per minute by category)
RATE_LIMIT_TIERS = {
    "anonymous": {"default": 60, "media": 30, "export": 10, "map": 120},
    "authenticated": {"default": 120, "media": 60, "export": 30, "map": 240},
    "premium": {"default": 300, "media": 150, "export": 100, "map": 600},
    "admin": {"default": 1000, "media": 500, "export": 500, "map": 1000},
}

# Redis connection
REDIS_URL = getattr(settings, 'REDIS_URL', 'redis://redis:6379/0')

# Rate limit key prefix
RATE_LIMIT_PREFIX = "rate_limit:map:"

# Window size in seconds
RATE_LIMIT_WINDOW = 60

# Singleton Redis client for rate limiting
_rate_limit_redis: Optional[redis.Redis] = None


async def get_rate_limit_redis() -> redis.Redis:
    """Get or create Redis client for rate limiting."""
    global _rate_limit_redis
    if _rate_limit_redis is None:
        _rate_limit_redis = redis.from_url(REDIS_URL, decode_responses=True)
    return _rate_limit_redis


async def close_rate_limit_redis():
    """Close Redis client on shutdown."""
    global _rate_limit_redis
    if _rate_limit_redis:
        await _rate_limit_redis.close()
        _rate_limit_redis = None


class RateLimitInfo:
    """Rate limit status information."""

    def __init__(
        self,
        allowed: bool,
        limit: int,
        remaining: int,
        reset_at: int,
        retry_after: Optional[int] = None
    ):
        self.allowed = allowed
        self.limit = limit
        self.remaining = remaining
        self.reset_at = reset_at
        self.retry_after = retry_after

    def add_headers(self, response: Response) -> None:
        """Add rate limit headers to response."""
        response.headers["X-RateLimit-Limit"] = str(self.limit)
        response.headers["X-RateLimit-Remaining"] = str(self.remaining)
        response.headers["X-RateLimit-Reset"] = str(self.reset_at)
        if self.retry_after is not None:
            response.headers["Retry-After"] = str(self.retry_after)


class RateLimiter:
    """
    Redis-based rate limiter using sliding window algorithm.

    Uses Redis sorted sets to track requests with timestamps.
    This provides accurate rate limiting across distributed instances.
    """

    def __init__(self, redis_client: Optional[redis.Redis] = None):
        self._redis = redis_client

    async def _get_redis(self) -> redis.Redis:
        """Get Redis client, using provided or singleton."""
        if self._redis:
            return self._redis
        return await get_rate_limit_redis()

    async def check_rate_limit(
        self,
        client_id: str,
        endpoint: str,
        limit: int,
        window_seconds: int = RATE_LIMIT_WINDOW
    ) -> Tuple[bool, RateLimitInfo]:
        """
        Check if request is allowed under rate limit.

        Uses Redis sorted set with timestamps as scores.
        Removes expired entries and counts remaining in window.

        Args:
            client_id: Client identifier (IP address or API key)
            endpoint: Endpoint name for separate limits
            limit: Maximum requests per window
            window_seconds: Time window in seconds (default 60)

        Returns:
            Tuple of (allowed: bool, info: RateLimitInfo)
        """
        now = time.time()
        window_start = now - window_seconds
        reset_at = int(now) + window_seconds
        key = f"{RATE_LIMIT_PREFIX}{endpoint}:{client_id}"

        try:
            client = await self._get_redis()

            # Use pipeline for atomic operations
            pipe = client.pipeline()

            # Remove expired entries (outside window)
            pipe.zremrangebyscore(key, "-inf", window_start)

            # Count current requests in window
            pipe.zcard(key)

            # Add current request
            pipe.zadd(key, {f"{now}": now})

            # Set expiry on key (cleanup)
            pipe.expire(key, window_seconds + 1)

            results = await pipe.execute()

            # results[1] is the count before adding current request
            current_count = results[1]

            if current_count >= limit:
                # Rate limit exceeded
                remaining = 0
                retry_after = window_seconds

                logger.warning(
                    f"Rate limit exceeded",
                    extra={
                        "client_id": client_id,
                        "endpoint": endpoint,
                        "limit": limit,
                        "current_count": current_count
                    }
                )

                return False, RateLimitInfo(
                    allowed=False,
                    limit=limit,
                    remaining=remaining,
                    reset_at=reset_at,
                    retry_after=retry_after
                )

            # Request allowed
            remaining = max(0, limit - current_count - 1)

            return True, RateLimitInfo(
                allowed=True,
                limit=limit,
                remaining=remaining,
                reset_at=reset_at
            )

        except redis.RedisError as e:
            # Fail open on Redis errors - log warning but allow request
            logger.warning(
                f"Rate limit Redis error (failing open)",
                extra={"error": str(e), "client_id": client_id, "endpoint": endpoint}
            )

            return True, RateLimitInfo(
                allowed=True,
                limit=limit,
                remaining=limit,  # Unknown, report full limit
                reset_at=reset_at
            )
        except Exception as e:
            # Unexpected error - fail open
            logger.error(
                f"Rate limit unexpected error",
                extra={"error": str(e), "client_id": client_id, "endpoint": endpoint}
            )

            return True, RateLimitInfo(
                allowed=True,
                limit=limit,
                remaining=limit,
                reset_at=reset_at
            )


def _is_internal_network(ip_str: str) -> bool:
    """Check if IP is from Docker/internal network."""
    import ipaddress
    try:
        ip = ipaddress.ip_address(ip_str)
        # Docker and internal networks
        internal_networks = [
            ipaddress.ip_network("172.16.0.0/12"),  # Docker default
            ipaddress.ip_network("10.0.0.0/8"),      # Private
            ipaddress.ip_network("192.168.0.0/16"), # Private
            ipaddress.ip_network("127.0.0.0/8"),    # Loopback
            ipaddress.ip_network("::1/128"),        # IPv6 loopback
        ]
        return any(ip in net for net in internal_networks)
    except ValueError:
        return False


def get_client_ip(request: Request) -> str:
    """
    Extract client IP from request, handling proxies securely.

    SECURITY: Only trusts X-Forwarded-For/X-Real-IP headers if the direct
    connection comes from an internal/Docker network (trusted proxy).
    External connections use direct client IP to prevent spoofing.

    Note: Strips port if present (e.g., "192.168.1.1:54321" → "192.168.1.1")
    This is important for rate limiting - all requests from same IP should
    share the same rate limit bucket regardless of ephemeral port.

    Args:
        request: FastAPI Request object

    Returns:
        Client IP address string (without port)
    """
    def strip_port(ip_str: str) -> str:
        """Strip port from IP:port or [IPv6]:port format."""
        if not ip_str:
            return ip_str
        # Handle IPv6 with port: [::1]:54321
        if ip_str.startswith("["):
            bracket_end = ip_str.find("]")
            if bracket_end > 0:
                return ip_str[1:bracket_end]
        # Handle IPv4 with port: 192.168.1.1:54321
        if ":" in ip_str and ip_str.count(":") == 1:
            return ip_str.split(":")[0]
        return ip_str

    # Get direct connection IP
    direct_ip = request.client.host if request.client else "unknown"

    # Only trust forwarded headers if connection is from internal network
    # This prevents external attackers from spoofing their IP
    if _is_internal_network(direct_ip):
        # Check X-Forwarded-For (reverse proxy - Caddy sets this)
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            # X-Forwarded-For format: client, proxy1, proxy2, ...
            # First entry is the original client
            client_ip = forwarded_for.split(",")[0].strip()
            return strip_port(client_ip)

        # Check X-Real-IP (nginx style)
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return strip_port(real_ip.strip())

    # Direct client connection or untrusted proxy headers
    return strip_port(direct_ip) if direct_ip != "unknown" else "unknown"


def get_rate_limit_key_and_tier(request: Request) -> tuple[str, str]:
    """
    Get rate limit key and tier based on authentication.

    Priority:
    1. API key auth -> use key ID, tier from key or "authenticated"
    2. Session auth -> use user ID, tier based on role
    3. Anonymous -> use IP, tier "anonymous"

    Returns:
        Tuple of (key_identifier, tier_name)
    """
    # API key auth
    if hasattr(request.state, 'api_key') and request.state.api_key:
        api_key = request.state.api_key
        tier = getattr(api_key, 'rate_limit_tier', None) or "authenticated"
        return f"apikey:{api_key.id}", tier

    # Session/JWT auth
    if hasattr(request.state, 'user') and request.state.user:
        user = request.state.user
        if user.is_authenticated:
            tier = "admin" if user.is_admin else "authenticated"
            return f"user:{user.user_id}", tier

    # Anonymous - use IP
    return f"ip:{get_client_ip(request)}", "anonymous"


# Global rate limiter instance
_rate_limiter: Optional[RateLimiter] = None


def get_rate_limiter() -> RateLimiter:
    """Get or create global rate limiter instance."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter


def rate_limit_dependency(
    requests_per_minute: int = None,  # Legacy support
    endpoint_name: Optional[str] = None,
    category: str = "default",  # New: category for tiered limits
):
    """
    Create a FastAPI dependency for rate limiting with per-user/key tiered limits.

    Usage:
        # Tier-based limits (recommended)
        @router.get("/expensive")
        async def expensive_endpoint(
            request: Request,
            rate_limit: None = Depends(rate_limit_dependency(category="media"))
        ):
            ...

        # Fixed limit (legacy support)
        @router.get("/expensive")
        async def expensive_endpoint(
            request: Request,
            rate_limit: None = Depends(rate_limit_dependency(30, "expensive"))
        ):
            ...

    Args:
        requests_per_minute: Fixed limit (legacy, overrides tier)
        endpoint_name: Override endpoint name (defaults to route path)
        category: Category for tier-based limits (default, media, export, map)

    Returns:
        FastAPI dependency function
    """
    async def dependency(request: Request):
        key, tier = get_rate_limit_key_and_tier(request)

        # Use fixed limit if provided (legacy support)
        if requests_per_minute is not None:
            limit = requests_per_minute
        else:
            # Get limit from tier
            tier_limits = RATE_LIMIT_TIERS.get(tier, RATE_LIMIT_TIERS["anonymous"])
            limit = tier_limits.get(category, tier_limits.get("default", 60))

        endpoint = endpoint_name or request.url.path

        limiter = get_rate_limiter()
        allowed, info = await limiter.check_rate_limit(
            client_id=key,
            endpoint=endpoint,
            limit=limit
        )

        if not allowed:
            raise HTTPException(
                status_code=429,
                detail="Rate limit exceeded. Please try again later.",
                headers={
                    "X-RateLimit-Limit": str(info.limit),
                    "X-RateLimit-Remaining": str(info.remaining),
                    "X-RateLimit-Reset": str(info.reset_at),
                    "Retry-After": str(info.retry_after),
                }
            )

        # Store rate limit info in request state for response headers
        request.state.rate_limit_info = info

        return None

    return dependency


async def add_rate_limit_headers(request: Request, response: Response):
    """
    Add rate limit headers to response.

    Call this in endpoint if you want to include rate limit headers
    in successful responses (not just 429 errors).

    Usage:
        @router.get("/expensive")
        async def expensive_endpoint(request: Request, response: Response):
            await add_rate_limit_headers(request, response)
            return {"data": ...}
    """
    if hasattr(request.state, 'rate_limit_info'):
        request.state.rate_limit_info.add_headers(response)
