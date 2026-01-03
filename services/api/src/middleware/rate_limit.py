"""
Rate limiting middleware for authentication endpoints.

Uses Redis sliding window algorithm to prevent brute force attacks on login.
"""

import time
from typing import Optional
from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
import redis.asyncio as redis

from observability import get_logger
from config.settings import settings

logger = get_logger(__name__)

# Rate limit configuration
AUTH_RATE_LIMIT = 5  # Max attempts per window
AUTH_RATE_WINDOW = 60  # Window in seconds (1 minute)

# Paths to rate limit (login and password-related endpoints)
RATE_LIMITED_PATHS = {
    "/api/auth/login": (AUTH_RATE_LIMIT, AUTH_RATE_WINDOW),
    "/api/auth/users/me/password": (3, 60),  # Stricter for password changes
}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Redis-based rate limiting middleware.

    Uses sliding window counter algorithm for accurate rate limiting.
    Falls back to allowing requests if Redis is unavailable.
    """

    def __init__(self, app, redis_url: Optional[str] = None):
        super().__init__(app)
        self.redis_url = redis_url or settings.redis_url
        self._redis: Optional[redis.Redis] = None

    async def get_redis(self) -> Optional[redis.Redis]:
        """Lazy Redis connection with connection pooling."""
        if self._redis is None:
            try:
                self._redis = redis.from_url(
                    self.redis_url,
                    password=settings.redis_password or None,
                    decode_responses=True,
                    socket_timeout=1.0,
                    socket_connect_timeout=1.0,
                )
                # Test connection
                await self._redis.ping()
            except Exception as e:
                logger.warning(f"Redis connection failed for rate limiting: {e}")
                self._redis = None
        return self._redis

    def get_client_ip(self, request: Request) -> str:
        """Extract client IP, considering X-Forwarded-For header."""
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            # Take first IP (original client)
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def check_rate_limit(
        self,
        key: str,
        max_requests: int,
        window_seconds: int
    ) -> tuple[bool, int, int]:
        """
        Check rate limit using sliding window counter.

        Returns:
            (allowed: bool, remaining: int, retry_after: int)
        """
        r = await self.get_redis()
        if r is None:
            # Fail open if Redis unavailable
            return True, max_requests, 0

        try:
            now = int(time.time())
            window_start = now - window_seconds

            pipe = r.pipeline()
            # Remove old entries outside window
            pipe.zremrangebyscore(key, 0, window_start)
            # Add current request
            pipe.zadd(key, {str(now): now})
            # Count requests in window
            pipe.zcard(key)
            # Set expiry to clean up old keys
            pipe.expire(key, window_seconds + 1)

            results = await pipe.execute()
            request_count = results[2]

            if request_count > max_requests:
                # Get oldest entry to calculate retry-after
                oldest = await r.zrange(key, 0, 0, withscores=True)
                if oldest:
                    retry_after = int(oldest[0][1]) + window_seconds - now
                else:
                    retry_after = window_seconds
                return False, 0, max(1, retry_after)

            remaining = max_requests - request_count
            return True, remaining, 0

        except Exception as e:
            logger.error(f"Rate limit check failed: {e}")
            # Fail open
            return True, max_requests, 0

    async def dispatch(self, request: Request, call_next):
        """Check rate limit for protected paths."""
        path = request.url.path

        # Only rate limit specific paths
        if path not in RATE_LIMITED_PATHS:
            return await call_next(request)

        max_requests, window = RATE_LIMITED_PATHS[path]
        client_ip = self.get_client_ip(request)
        rate_key = f"rate_limit:{path}:{client_ip}"

        allowed, remaining, retry_after = await self.check_rate_limit(
            rate_key, max_requests, window
        )

        if not allowed:
            logger.warning(
                f"Rate limit exceeded for {path} from {client_ip}",
                extra={"path": path, "client_ip": client_ip}
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests. Try again in {retry_after} seconds.",
                headers={
                    "Retry-After": str(retry_after),
                    "X-RateLimit-Limit": str(max_requests),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(time.time()) + retry_after),
                }
            )

        response = await call_next(request)

        # Add rate limit headers to response
        response.headers["X-RateLimit-Limit"] = str(max_requests)
        response.headers["X-RateLimit-Remaining"] = str(remaining)

        return response
