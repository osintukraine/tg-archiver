"""
CSRF Protection Middleware.

Implements double-submit cookie pattern for CSRF protection.
Works alongside JWT authentication for state-changing requests.
"""

import logging
import os
import secrets
from typing import Optional, Set

from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger(__name__)

# CSRF configuration
CSRF_COOKIE_NAME = "csrf_token"
CSRF_HEADER_NAME = "X-CSRF-Token"
CSRF_TOKEN_LENGTH = 32

# Methods that require CSRF validation
CSRF_PROTECTED_METHODS: Set[str] = {"POST", "PUT", "PATCH", "DELETE"}

# Paths exempt from CSRF (login needs to work without existing token)
CSRF_EXEMPT_PATHS: Set[str] = {
    "/api/auth/login",
    "/api/auth/info",
    "/health",
    "/metrics",
}

# Enable/disable CSRF protection via environment
CSRF_ENABLED = os.getenv("CSRF_ENABLED", "true").lower() == "true"


def generate_csrf_token() -> str:
    """Generate a cryptographically secure CSRF token."""
    return secrets.token_urlsafe(CSRF_TOKEN_LENGTH)


class CSRFMiddleware(BaseHTTPMiddleware):
    """
    CSRF protection using double-submit cookie pattern.

    How it works:
    1. On any request, if no CSRF cookie exists, set one
    2. On state-changing requests (POST/PUT/PATCH/DELETE):
       - Require X-CSRF-Token header
       - Header value must match cookie value
    3. Exempt paths (like /login) don't require the header

    Frontend integration:
    - Read csrf_token cookie value
    - Include X-CSRF-Token header on all state-changing requests
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # Skip if CSRF protection is disabled
        if not CSRF_ENABLED:
            return await call_next(request)

        # Get or generate CSRF token
        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
        new_token = None

        if not csrf_cookie:
            new_token = generate_csrf_token()
            csrf_cookie = new_token

        # Check if this request needs CSRF validation
        if request.method in CSRF_PROTECTED_METHODS:
            path = request.url.path

            # Check exempt paths
            if not any(path.startswith(exempt) for exempt in CSRF_EXEMPT_PATHS):
                # Validate CSRF token
                csrf_header = request.headers.get(CSRF_HEADER_NAME)

                if not csrf_header:
                    logger.warning(
                        f"CSRF token missing for {request.method} {path}",
                        extra={"path": path, "method": request.method}
                    )
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="CSRF token missing. Include X-CSRF-Token header.",
                    )

                if not secrets.compare_digest(csrf_header, csrf_cookie):
                    logger.warning(
                        f"CSRF token mismatch for {request.method} {path}",
                        extra={"path": path, "method": request.method}
                    )
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="CSRF token invalid.",
                    )

        # Process request
        response = await call_next(request)

        # Set CSRF cookie if new
        if new_token:
            is_production = os.getenv("ENVIRONMENT", "development") == "production"
            response.set_cookie(
                key=CSRF_COOKIE_NAME,
                value=new_token,
                max_age=86400,  # 24 hours
                httponly=False,  # Must be readable by JavaScript
                samesite="strict",
                secure=is_production,
                path="/",
            )

        return response
