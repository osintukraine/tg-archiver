"""
Authentication provider factory.

Dynamically selects authentication provider based on configuration.
"""

import logging
import os
from enum import Enum
from typing import Callable, Optional
from fastapi import Request, Depends

from .models import AuthenticatedUser, AuthConfig
from .none import verify_no_auth
from .jwt import verify_jwt, verify_jwt_optional, init_jwt_auth

logger = logging.getLogger(__name__)


class AuthProvider(str, Enum):
    """Supported authentication providers."""

    NONE = "none"
    JWT = "jwt"


# Global auth configuration (initialized on startup)
_auth_config: Optional[AuthConfig] = None


def init_auth_config() -> AuthConfig:
    """
    Initialize authentication configuration from environment variables.

    Called once on application startup.

    Environment Variables:
        AUTH_PROVIDER: Authentication provider (none, jwt)
            - none: No authentication (development only)
            - jwt: Standalone JWT authentication
            Default: none

        AUTH_REQUIRED: Require authentication for all endpoints (default: false)
            - true: All endpoints require authentication
            - false: Authentication optional (endpoint-specific)

        JWT Configuration (if AUTH_PROVIDER=jwt):
            - JWT_SECRET_KEY: Secret key for JWT signing (required, min 32 chars)
            - JWT_ALGORITHM: Signing algorithm (default: HS256)
            - JWT_EXPIRATION_MINUTES: Token expiration in minutes (default: 60)
            - JWT_ADMIN_PASSWORD: Default admin user password (required)

    Returns:
        AuthConfig object
    """
    global _auth_config

    # Authentication provider selection
    # Environment variable: AUTH_PROVIDER (default: none)
    # Valid values: none, jwt
    provider = os.getenv("AUTH_PROVIDER", "none").lower()

    # Authentication requirement
    # Environment variable: AUTH_REQUIRED (default: false)
    # If true, all endpoints require authentication (returns 401 if not authenticated)
    required = os.getenv("AUTH_REQUIRED", "false").lower() == "true"

    # Validate provider
    try:
        AuthProvider(provider)
    except ValueError:
        logger.error(
            f"Invalid AUTH_PROVIDER: {provider}. "
            f"Must be one of: {', '.join([p.value for p in AuthProvider])}"
        )
        logger.warning("Falling back to AUTH_PROVIDER=none")
        provider = "none"

    _auth_config = AuthConfig(
        provider=provider,
        required=required,
    )

    # Initialize JWT provider if selected
    if provider == AuthProvider.JWT:
        try:
            init_jwt_auth()
        except RuntimeError as e:
            logger.error(f"JWT initialization failed: {e}")
            raise

    logger.info(
        f"Authentication configured: provider={provider}, required={required}"
    )

    return _auth_config


def get_auth_config() -> AuthConfig:
    """Get current authentication configuration."""
    if _auth_config is None:
        return init_auth_config()
    return _auth_config


def _get_auth_verifier(
    config: AuthConfig, optional: bool = False
) -> Callable:
    """
    Get the appropriate authentication verifier function.

    Args:
        config: Authentication configuration
        optional: If True, return optional verifier (doesn't raise on missing auth)

    Returns:
        Authentication verifier function
    """
    if config.provider == AuthProvider.NONE:
        return verify_no_auth

    elif config.provider == AuthProvider.JWT:
        if optional:
            return verify_jwt_optional
        return verify_jwt

    else:
        logger.error(f"Unknown auth provider: {config.provider}")
        logger.warning("Falling back to no authentication")
        return verify_no_auth


async def get_current_user(
    request: Request,
    config: AuthConfig = Depends(get_auth_config)
) -> Optional[AuthenticatedUser]:
    """
    Get current authenticated user (required).

    Use this dependency for endpoints that REQUIRE authentication.
    Will raise 401 Unauthorized if user is not authenticated.

    Example:
        @app.get("/api/admin/users")
        async def list_users(user: AuthenticatedUser = Depends(get_current_user)):
            if not user or not user.is_admin:
                raise HTTPException(403, "Admin access required")
            ...

    Args:
        request: FastAPI request object
        config: Authentication configuration (injected)

    Returns:
        AuthenticatedUser object or None (if AUTH_PROVIDER=none)

    Raises:
        HTTPException(401): If authentication required but not provided
    """
    verifier = _get_auth_verifier(config, optional=False)
    return await verifier(request)


async def get_current_user_optional(
    request: Request,
    config: AuthConfig = Depends(get_auth_config)
) -> Optional[AuthenticatedUser]:
    """
    Get current authenticated user (optional).

    Use this dependency for endpoints that work both authenticated and
    unauthenticated, but may provide additional features when authenticated.

    Example:
        @app.get("/api/messages")
        async def get_messages(user: Optional[AuthenticatedUser] = Depends(get_current_user_optional)):
            # Show all messages if authenticated, only public if not
            if user:
                return all_messages
            return public_messages

    Args:
        request: FastAPI request object
        config: Authentication configuration (injected)

    Returns:
        AuthenticatedUser object if authenticated, None otherwise
    """
    verifier = _get_auth_verifier(config, optional=True)
    return await verifier(request)


def get_auth_dependency(required: bool = True):
    """
    Get authentication dependency for route protection.

    Args:
        required: If True, require authentication. If False, optional.

    Returns:
        FastAPI dependency function

    Example:
        # Require authentication
        @app.get("/api/protected", dependencies=[Depends(get_auth_dependency())])

        # Optional authentication
        @app.get("/api/maybe-protected", dependencies=[Depends(get_auth_dependency(required=False))])
    """
    if required:
        return get_current_user
    return get_current_user_optional
