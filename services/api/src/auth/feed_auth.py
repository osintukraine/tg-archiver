"""
Feed Authentication - Token-based auth for RSS/Atom/JSON feeds.

Provides FastAPI dependencies for:
- Optional feed auth (when FEED_AUTH_REQUIRED=false)
- Required feed auth (when FEED_AUTH_REQUIRED=true)
- Simple token verification (hash-based)

Feature Flag:
- FEED_AUTH_REQUIRED=false (default): Feeds are public
- FEED_AUTH_REQUIRED=true: Feeds require valid token
"""

import logging
import os
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from models.feed_token import FeedToken
from ..database import get_db
from ..services.feed_token_service import FeedTokenService

logger = logging.getLogger(__name__)


def is_feed_auth_required() -> bool:
    """Check if feed authentication is required."""
    return os.getenv("FEED_AUTH_REQUIRED", "false").lower() == "true"


class FeedAuthResult:
    """Result of feed authentication."""

    def __init__(
        self,
        authenticated: bool,
        token: Optional[FeedToken] = None,
        user_id: Optional[int] = None,
    ):
        self.authenticated = authenticated
        self.token = token
        self.user_id = user_id


async def verify_feed_token(
    request: Request,
    token: Optional[str] = Query(None, description="Feed token (plaintext)"),
    db: AsyncSession = Depends(get_db),
) -> FeedAuthResult:
    """
    Verify feed token.

    When FEED_AUTH_REQUIRED=true:
    - Token is required
    - Returns 401 if missing or invalid

    When FEED_AUTH_REQUIRED=false:
    - Token is optional
    - Returns unauthenticated result if missing
    - Still validates if provided

    Args:
        request: FastAPI request
        token: Plaintext token
        db: Database session

    Returns:
        FeedAuthResult with auth status and token info

    Raises:
        HTTPException(401): If auth required but invalid
    """
    auth_required = is_feed_auth_required()

    # If no token provided
    if not token:
        if auth_required:
            logger.warning(f"Feed auth required but no token provided: {request.url.path}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Feed authentication required. Generate a token in your account settings.",
            )
        return FeedAuthResult(authenticated=False)

    # Verify token by hashing and looking up
    service = FeedTokenService(db)
    feed_token = await service.verify_token(token)

    if not feed_token:
        logger.warning(f"Token not found or revoked")
        if auth_required:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or revoked token.",
            )
        return FeedAuthResult(authenticated=False)

    # Update usage stats
    await service.update_usage(feed_token.id)

    logger.debug(f"Feed authenticated: token_id={feed_token.id}, user={feed_token.user_id}")

    return FeedAuthResult(
        authenticated=True,
        token=feed_token,
        user_id=feed_token.user_id,
    )


async def require_feed_auth(
    auth_result: FeedAuthResult = Depends(verify_feed_token),
) -> FeedAuthResult:
    """
    Dependency that ALWAYS requires feed authentication.

    Use for endpoints that should never be public,
    regardless of FEED_AUTH_REQUIRED setting.
    """
    if not auth_result.authenticated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Feed authentication required.",
        )
    return auth_result


async def optional_feed_auth(
    auth_result: FeedAuthResult = Depends(verify_feed_token),
) -> FeedAuthResult:
    """
    Dependency for optional feed authentication.

    Returns auth result regardless of whether authenticated.
    Useful for endpoints that work both ways.
    """
    return auth_result
