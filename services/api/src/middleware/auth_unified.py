"""
Unified Authentication Middleware

Single middleware that handles all authentication methods:
1. API keys (Authorization: Bearer ak_*)
2. JWT tokens (Authorization: Bearer <jwt>)
3. Anonymous access (fallback)

Always sets request.state.user to an AuthUser instance.
Route handlers use dependencies to enforce auth requirements.
"""

import os
import logging
from typing import Optional

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from ..auth.models import AuthUser

logger = logging.getLogger(__name__)

AUTH_PROVIDER = os.getenv("AUTH_PROVIDER", "none")


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Unified authentication middleware.

    Authentication priority:
    1. API key (Bearer ak_* or ?api_key=ak_*)
    2. JWT token (Bearer <token>)
    3. Anonymous (default)

    Always sets request.state.user to an AuthUser instance.
    Route handlers can then use dependencies to enforce auth requirements.
    """

    async def dispatch(self, request: Request, call_next):
        """Process request and attach user context."""

        # Try authentication methods in priority order
        user = await self._try_api_key_marker(request)

        if not user and AUTH_PROVIDER == "jwt":
            user = await self._try_jwt(request)

        # Default to anonymous
        if not user:
            user = AuthUser.anonymous()

        # Attach to request state
        request.state.user = user

        if user.is_authenticated:
            logger.debug(
                f"Authenticated: user_id={user.user_id}, "
                f"method={user.auth_method}, path={request.url.path}"
            )

        return await call_next(request)

    async def _try_api_key_marker(self, request: Request) -> Optional[AuthUser]:
        """
        Check for API key and mark for later validation.

        We don't validate API keys here (requires DB access).
        Instead, we mark the request so the dependency can validate it.
        """
        auth_header = request.headers.get("Authorization", "")
        api_key = None

        if auth_header.startswith("Bearer ak_"):
            api_key = auth_header[7:]
        elif "api_key" in request.query_params:
            api_key = request.query_params.get("api_key", "")
            if not api_key.startswith("ak_"):
                api_key = None

        if api_key:
            # Store for validation by dependency (which has DB access)
            request.state.pending_api_key = api_key
            # Return None so we continue checking other auth methods
            # The dependency will validate and set the real user

        return None

    async def _try_jwt(self, request: Request) -> Optional[AuthUser]:
        """Try to authenticate via JWT token."""
        auth_header = request.headers.get("Authorization", "")

        # Skip if it's an API key
        if auth_header.startswith("Bearer ak_"):
            return None

        if not auth_header.startswith("Bearer "):
            token = request.query_params.get("access_token")
            if not token:
                return None
        else:
            token = auth_header[7:]

        try:
            from ..auth.jwt import decode_access_token

            payload = decode_access_token(token)
            if not payload:
                return None

            # Extract user info from JWT payload
            user_id = payload.get("user_id")
            username = payload.get("sub")
            email = payload.get("email")
            is_admin = payload.get("is_admin", False)

            if not username:
                return None

            roles = ["admin"] if is_admin else ["user"]

            return AuthUser.from_jwt(
                user_id=str(user_id) if user_id else "0",
                username=username,
                email=email,
                display_name=username,
                roles=roles,
            )
        except Exception as e:
            logger.debug(f"JWT validation failed: {e}")
            return None
