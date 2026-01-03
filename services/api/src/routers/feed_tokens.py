"""
Feed Token Management API

Endpoints for users to manage their feed tokens:
- Create new tokens
- List tokens
- Revoke tokens

Simplified version for tg-archiver (no URL signing).
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies.auth import AuthenticatedUser
from ..database import get_db
from ..services.feed_token_service import FeedTokenService
from ..services.feed_subscription_service import FeedSubscriptionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/feed-tokens", tags=["feed-tokens"])


# =============================================================================
# Auth Status (public endpoint)
# =============================================================================

@router.get("/auth-status")
async def auth_status():
    """
    Check if authentication is required for feed tokens.

    Public endpoint for frontend to determine if login is needed.
    """
    from ..auth.factory import get_auth_config, AuthProvider

    config = get_auth_config()
    return {
        "auth_required": config.provider != AuthProvider.NONE,
        "provider": config.provider,
    }


# =============================================================================
# Schemas
# =============================================================================

class TokenCreateRequest(BaseModel):
    """Request to create a new feed token."""
    name: Optional[str] = Field(
        None,
        max_length=100,
        description="User-defined label (e.g., 'My Feedly', 'Work laptop')",
    )


class TokenCreateResponse(BaseModel):
    """Response after creating a token. Contains plaintext token (shown once!)."""
    id: int
    token: str = Field(description="Plaintext token - SAVE THIS NOW, it won't be shown again!")
    name: Optional[str]
    created_at: str
    message: str = "Token created successfully. Save the token value - it cannot be retrieved later."


class TokenResponse(BaseModel):
    """Token info (without plaintext)."""
    id: int
    name: Optional[str]
    created_at: str
    last_used_at: Optional[str]
    is_active: bool


class TokenListResponse(BaseModel):
    """List of user's tokens."""
    tokens: list[TokenResponse]
    total: int


class TokenRevokeRequest(BaseModel):
    """Request to revoke a token."""
    reason: Optional[str] = Field(None, max_length=255)


class SubscriptionResponse(BaseModel):
    """Feed subscription info."""
    id: str
    feed_type: str
    summary: str
    label: Optional[str]
    feed_params: dict
    created_at: str
    last_accessed_at: Optional[str]
    access_count: int


class SubscriptionListResponse(BaseModel):
    """List of subscriptions for a token."""
    subscriptions: list[SubscriptionResponse]
    total: int


# =============================================================================
# Endpoints
# =============================================================================

@router.post("", response_model=TokenCreateResponse)
async def create_token(
    body: TokenCreateRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new feed token.

    The plaintext token is returned ONLY in this response.
    Save it immediately - it cannot be retrieved later.

    Requires authentication.
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to create feed tokens.",
        )

    service = FeedTokenService(db)

    # Check token limit (max 10 active tokens per user)
    existing = await service.get_user_active_tokens(user.user_id)
    if len(existing) >= 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 10 active tokens allowed. Revoke an existing token first.",
        )

    token, plaintext = await service.create_token(
        user_id=user.user_id,
        name=body.name,
    )

    logger.info(f"Feed token created: user={user.user_id}, token_id={token.id}")

    return TokenCreateResponse(
        id=token.id,
        token=plaintext,
        name=token.name,
        created_at=token.created_at.isoformat() if token.created_at else "",
    )


@router.get("", response_model=TokenListResponse)
async def list_tokens(
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
):
    """
    List all feed tokens for the current user.

    Includes both active and revoked tokens.
    Requires authentication.
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    service = FeedTokenService(db)
    tokens = await service.get_user_tokens(user.user_id)

    return TokenListResponse(
        tokens=[
            TokenResponse(
                id=t.id,
                name=t.name,
                created_at=t.created_at.isoformat() if t.created_at else "",
                last_used_at=t.last_used_at.isoformat() if t.last_used_at else None,
                is_active=t.is_active if t.is_active is not None else True,
            )
            for t in tokens
        ],
        total=len(tokens),
    )


@router.delete("/{token_id}")
async def revoke_token(
    token_id: int,
    body: Optional[TokenRevokeRequest] = None,
    user: AuthenticatedUser = ...,
    db: AsyncSession = Depends(get_db),
):
    """
    Revoke a feed token.

    This immediately invalidates the token. All feed URLs using this token
    will stop working.

    Requires authentication. User can only revoke their own tokens.
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    service = FeedTokenService(db)

    revoked = await service.revoke_token(
        token_id=token_id,
        user_id=user.user_id,
    )

    if not revoked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token not found or already revoked.",
        )

    logger.info(f"Feed token revoked: user={user.user_id}, token={token_id}")

    return {"message": "Token revoked successfully.", "token_id": token_id}


@router.get("/{token_id}/subscriptions", response_model=SubscriptionListResponse)
async def list_token_subscriptions(
    token_id: int,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
):
    """
    List feed subscriptions for a specific token.

    Shows all RSS/Atom/JSON feeds the user has accessed with this token.
    Subscriptions are auto-created when feed URLs are accessed.

    Requires authentication. User can only view their own token subscriptions.
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    # Verify token belongs to user
    token_service = FeedTokenService(db)
    token = await token_service.get_token_by_id(token_id)

    if not token or token.user_id != user.user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token not found.",
        )

    # Get subscriptions
    sub_service = FeedSubscriptionService(db)
    subscriptions = await sub_service.get_token_subscriptions(token.id)

    return SubscriptionListResponse(
        subscriptions=[
            SubscriptionResponse(
                id=str(s.id),
                feed_type=s.feed_type or "search",
                summary=s.summary or "",
                label=s.label,
                feed_params=s.feed_params or {},
                created_at=s.created_at.isoformat() if s.created_at else "",
                last_accessed_at=s.last_accessed_at.isoformat() if s.last_accessed_at else None,
                access_count=s.access_count or 0,
            )
            for s in subscriptions
        ],
        total=len(subscriptions),
    )
