"""
API Key Authentication Provider

Validates API keys from:
1. Authorization: Bearer ak_xxx header
2. ?api_key=ak_xxx query parameter

Usage:
    user = await get_user_from_api_key(request, db)
    if user:
        # Valid API key, user context available
"""

import asyncio
from typing import Optional

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.api_key_service import ApiKeyService
from src.auth.models import AuthUser
from src.utils.rate_limit import get_client_ip


def has_api_key(request: Request) -> bool:
    """Check if request contains an API key."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer ak_"):
        return True
    if "api_key" in request.query_params:
        api_key = request.query_params.get("api_key", "")
        return api_key.startswith("ak_")
    return False


def extract_api_key(request: Request) -> Optional[str]:
    """Extract API key from request headers or query params."""
    # Check Authorization header first
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer ak_"):
        return auth_header[7:]  # Remove "Bearer "

    # Check query parameter
    api_key = request.query_params.get("api_key")
    if api_key and api_key.startswith("ak_"):
        return api_key

    return None


async def get_user_from_api_key(
    request: Request,
    db: AsyncSession,
    required_scope: str = None,
) -> Optional[AuthUser]:
    """
    Authenticate request via API key and return user context.

    Args:
        request: FastAPI request
        db: Database session
        required_scope: Optional scope to require

    Returns:
        AuthUser if valid API key, None otherwise
    """
    api_key_str = extract_api_key(request)
    if not api_key_str:
        return None

    # Validate key
    api_key_service = ApiKeyService(db)
    api_key = await api_key_service.validate_key(api_key_str, required_scope)
    if not api_key:
        return None

    # Store API key in request state for rate limiting
    request.state.api_key = api_key

    # Fire-and-forget usage tracking
    client_ip = get_client_ip(request)
    asyncio.create_task(
        _update_usage_background(db, api_key.id, client_ip)
    )

    # Build user context
    is_admin = api_key.has_scope("admin")
    return AuthUser.from_api_key(
        user_id=api_key.user_id,
        email=None,
        is_admin=is_admin,
    )


async def _update_usage_background(db: AsyncSession, key_id, client_ip: str):
    """Background task to update API key usage."""
    try:
        api_key_service = ApiKeyService(db)
        await api_key_service.update_usage(key_id, client_ip)
    except Exception:
        pass  # Fire-and-forget, don't fail the request
