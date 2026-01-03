"""
Authentication dependencies for FastAPI route protection.

These dependencies read AuthUser from request.state.user (set by AuthMiddleware)
and enforce access control requirements.
"""

import asyncio
import logging
from typing import Annotated, Optional

from fastapi import Request, HTTPException, status, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.models import AuthUser
from ..database import get_db

logger = logging.getLogger(__name__)


async def _resolve_api_key(request: Request, db: AsyncSession) -> Optional[AuthUser]:
    """
    Resolve pending API key to AuthUser.

    The middleware marks API keys for validation but doesn't validate them
    (since it doesn't have DB access). This function does the actual validation.
    """
    pending_key = getattr(request.state, "pending_api_key", None)
    if not pending_key:
        return None

    from ..services.api_key_service import ApiKeyService

    api_key_service = ApiKeyService(db)
    api_key = await api_key_service.validate_key(pending_key)

    if not api_key:
        logger.debug(f"Invalid API key attempted")
        return None

    # Store validated key for rate limiting
    request.state.api_key = api_key

    # Fire-and-forget usage tracking (uses its own session to avoid race conditions)
    asyncio.create_task(
        _update_usage_background(api_key.id)
    )

    # ApiKey has user_id property and scopes for permissions
    return AuthUser.from_api_key(
        user_id=api_key.user_id,
        email=None,
        is_admin="admin" in (api_key.scopes or []),
    )


async def _update_usage_background(key_id: int):
    """
    Background task to update API key usage.

    IMPORTANT: Creates its own database session because background tasks
    outlive the request - the request's session may be closed before
    this task completes, causing IllegalStateChangeError.
    """
    try:
        from models.base import AsyncSessionLocal
        from ..services.api_key_service import ApiKeyService

        async with AsyncSessionLocal() as db:
            api_key_service = ApiKeyService(db)
            await api_key_service.update_usage(key_id)
            await db.commit()
    except Exception:
        pass  # Fire-and-forget


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AuthUser:
    """
    Get current user from request state.

    Returns AuthUser regardless of authentication status.
    Use require_auth() when authentication is required.

    Also resolves pending API keys (middleware marks them, we validate here).

    Returns:
        AuthUser: User context (may be anonymous)
    """
    # Check for pending API key first (needs DB validation)
    api_key_user = await _resolve_api_key(request, db)
    if api_key_user:
        request.state.user = api_key_user
        return api_key_user

    user = getattr(request.state, "user", None)

    if user is None:
        logger.error("AuthMiddleware did not attach user to request.state")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication middleware not configured correctly"
        )

    return user


async def require_auth(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AuthUser:
    """
    Require authenticated user.

    Raises 401 if not authenticated.

    Returns:
        AuthUser: Authenticated user context
    """
    # Check for pending API key - if provided but invalid, reject
    pending_key = getattr(request.state, "pending_api_key", None)
    if pending_key:
        api_key_user = await _resolve_api_key(request, db)
        if api_key_user:
            request.state.user = api_key_user
            return api_key_user
        else:
            # API key was provided but invalid
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API key",
                headers={"WWW-Authenticate": "Bearer"},
            )

    user = getattr(request.state, "user", None)

    if user is None:
        logger.error("AuthMiddleware did not attach user to request.state")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication middleware not configured correctly"
        )

    if not user.is_authenticated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def require_admin(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AuthUser:
    """
    Require admin role.

    Raises 401 if not authenticated, 403 if not admin.

    Returns:
        AuthUser: Admin user context
    """
    user = await require_auth(request, db)

    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    return user


def require_role(required_role: str):
    """
    Factory for role-specific dependencies.

    Usage:
        @router.get("/analysts")
        async def analyst_only(user: AuthUser = Depends(require_role("analyst"))):
            ...
    """
    async def role_checker(
        request: Request,
        db: AsyncSession = Depends(get_db),
    ) -> AuthUser:
        user = await require_auth(request, db)

        if required_role not in user.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{required_role}' required",
            )

        return user

    return role_checker


# Type aliases for cleaner route signatures
CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
AuthenticatedUser = Annotated[AuthUser, Depends(require_auth)]
AdminUser = Annotated[AuthUser, Depends(require_admin)]

# Backwards compatibility - UserContext is now AuthUser
UserContext = AuthUser
