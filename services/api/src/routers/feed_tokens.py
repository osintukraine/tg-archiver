"""
Feed Token Management API

Endpoints for users to manage their feed tokens:
- Create new tokens
- List tokens
- Revoke tokens
- Generate signed feed URLs

Requires user authentication (Ory/Kratos).
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..dependencies.auth import AuthenticatedUser
from ..database import get_db
from ..services.feed_token_service import FeedTokenService
from ..services.feed_subscription_service import FeedSubscriptionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/feed-tokens", tags=["feed-tokens"])


# =============================================================================
# Schemas
# =============================================================================

class TokenCreateRequest(BaseModel):
    """Request to create a new feed token."""
    label: Optional[str] = Field(
        None,
        max_length=100,
        description="User-defined label (e.g., 'My Feedly', 'Work laptop')",
    )


class TokenCreateResponse(BaseModel):
    """Response after creating a token. Contains plaintext token (shown once!)."""
    id: str
    token: str = Field(description="Plaintext token - SAVE THIS NOW, it won't be shown again!")
    prefix: str
    label: Optional[str]
    created_at: str
    message: str = "Token created successfully. Save the token value - it cannot be retrieved later."


class TokenResponse(BaseModel):
    """Token info (without plaintext)."""
    id: str
    prefix: str
    label: Optional[str]
    created_at: str
    last_used_at: Optional[str]
    use_count: int
    is_active: bool


class TokenListResponse(BaseModel):
    """List of user's tokens."""
    tokens: list[TokenResponse]
    total: int


class TokenRevokeRequest(BaseModel):
    """Request to revoke a token."""
    reason: Optional[str] = Field(None, max_length=255)


class SignedUrlRequest(BaseModel):
    """Request to generate a signed feed URL."""
    endpoint: str = Field(description="Feed endpoint (e.g., /rss/search)")
    params: dict = Field(description="Query parameters for the feed")


class SignedUrlResponse(BaseModel):
    """Signed feed URL."""
    url: str
    token_id: str
    expires: Optional[str] = None  # For future use


class SubscriptionResponse(BaseModel):
    """Subscription info."""
    id: str
    feed_type: str
    summary: str
    label: Optional[str]
    params: dict
    status: str
    last_accessed_at: str
    access_count: int
    created_at: str


class SubscriptionListResponse(BaseModel):
    """List of subscriptions for a token."""
    subscriptions: list[SubscriptionResponse]
    counts: dict


class SubscriptionUpdateRequest(BaseModel):
    """Request to update subscription."""
    label: Optional[str] = Field(None, max_length=100)


class SubscriptionCloneRequest(BaseModel):
    """Request to clone subscription with modified params."""
    params: dict = Field(description="Modified query parameters")
    format: str = Field(default="rss", pattern="^(rss|atom|json)$")


class RegenerateUrlRequest(BaseModel):
    """Request to regenerate subscription URL."""
    format: str = Field(default="rss", pattern="^(rss|atom|json)$")


class RegenerateUrlResponse(BaseModel):
    """Regenerated URL response."""
    url: str
    subscription_id: str


# =============================================================================
# Endpoints
# =============================================================================

@router.post("", response_model=TokenCreateResponse)
async def create_token(
    request: Request,
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
        kratos_identity_id=user.user_id,
        label=body.label,
    )

    logger.info(f"Feed token created: user={user.user_id}, prefix={token.token_prefix}")

    return TokenCreateResponse(
        id=str(token.id),
        token=plaintext,
        prefix=token.token_prefix,
        label=token.label,
        created_at=token.created_at.isoformat(),
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
                id=str(t.id),
                prefix=t.token_prefix,
                label=t.label,
                created_at=t.created_at.isoformat(),
                last_used_at=t.last_used_at.isoformat() if t.last_used_at else None,
                use_count=t.use_count,
                is_active=t.is_active,
            )
            for t in tokens
        ],
        total=len(tokens),
    )


@router.delete("/{token_id}")
async def revoke_token(
    token_id: UUID,
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
    reason = body.reason if body else None

    revoked = await service.revoke_token(
        token_id=token_id,
        kratos_identity_id=user.user_id,
        reason=reason,
    )

    if not revoked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token not found or already revoked.",
        )

    logger.info(f"Feed token revoked: user={user.user_id}, token={token_id}")

    return {"message": "Token revoked successfully.", "token_id": str(token_id)}


@router.post("/{token_id}/sign-url", response_model=SignedUrlResponse)
async def sign_feed_url(
    request: Request,
    token_id: UUID,
    body: SignedUrlRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a signed feed URL.

    Creates a feed URL with the token and HMAC signature.
    The URL can be used in feed readers without additional authentication.

    Requires authentication. User can only use their own tokens.
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    service = FeedTokenService(db)
    token = await service.get_active_token_by_id(token_id)

    if not token or token.kratos_identity_id != user.user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Token not found or not owned by you.",
        )

    # Build base URL
    base_url = str(request.base_url).rstrip("/")

    # Generate signed URL
    signed_url = service.build_signed_feed_url(
        base_url=base_url,
        endpoint=body.endpoint,
        params=body.params,
        token_id=str(token_id),
        signing_secret=token.signing_secret,
    )

    return SignedUrlResponse(
        url=signed_url,
        token_id=str(token_id),
    )


@router.get("/auth-status")
async def get_auth_status():
    """
    Get feed authentication status.

    Returns whether feed authentication is currently required.
    No authentication needed for this endpoint.
    """
    from ..auth.feed_auth import is_feed_auth_required

    return {
        "auth_required": is_feed_auth_required(),
        "message": (
            "Feed authentication is required. Generate a token to access feeds."
            if is_feed_auth_required()
            else "Feed authentication is optional. Feeds are publicly accessible."
        ),
    }


@router.get("/{token_id}/subscriptions", response_model=SubscriptionListResponse)
async def list_subscriptions(
    token_id: UUID,
    include_archived: bool = False,
    user: AuthenticatedUser = ...,
    db: AsyncSession = Depends(get_db),
):
    """List subscriptions for a token."""
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")

    token_service = FeedTokenService(db)
    token = await token_service.get_token_by_id(token_id)

    if not token or token.kratos_identity_id != user.user_id:
        raise HTTPException(status_code=404, detail="Token not found.")

    sub_service = FeedSubscriptionService(db)
    subscriptions = await sub_service.get_token_subscriptions(
        token_id=token_id,
        include_archived=include_archived,
    )

    counts = {"active": 0, "stale": 0, "archived": 0}
    for s in subscriptions:
        counts[s.status] = counts.get(s.status, 0) + 1

    return SubscriptionListResponse(
        subscriptions=[
            SubscriptionResponse(
                id=str(s.id),
                feed_type=s.feed_type,
                summary=s.summary,
                label=s.label,
                params=s.feed_params,
                status=s.status,
                last_accessed_at=s.last_accessed_at.isoformat(),
                access_count=s.access_count,
                created_at=s.created_at.isoformat(),
            )
            for s in subscriptions
        ],
        counts=counts,
    )


@router.patch("/{token_id}/subscriptions/{subscription_id}")
async def update_subscription(
    token_id: UUID,
    subscription_id: UUID,
    body: SubscriptionUpdateRequest,
    user: AuthenticatedUser = ...,
    db: AsyncSession = Depends(get_db),
):
    """Update subscription label."""
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")

    token_service = FeedTokenService(db)
    token = await token_service.get_token_by_id(token_id)

    if not token or token.kratos_identity_id != user.user_id:
        raise HTTPException(status_code=404, detail="Token not found.")

    sub_service = FeedSubscriptionService(db)
    updated = await sub_service.update_label(
        subscription_id=subscription_id,
        token_id=token_id,
        label=body.label,
    )

    if not updated:
        raise HTTPException(status_code=404, detail="Subscription not found.")

    return {"message": "Subscription updated.", "subscription_id": str(subscription_id)}


@router.delete("/{token_id}/subscriptions/{subscription_id}")
async def delete_subscription(
    token_id: UUID,
    subscription_id: UUID,
    user: AuthenticatedUser = ...,
    db: AsyncSession = Depends(get_db),
):
    """Delete a subscription."""
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")

    token_service = FeedTokenService(db)
    token = await token_service.get_token_by_id(token_id)

    if not token or token.kratos_identity_id != user.user_id:
        raise HTTPException(status_code=404, detail="Token not found.")

    sub_service = FeedSubscriptionService(db)
    deleted = await sub_service.delete_subscription(
        subscription_id=subscription_id,
        token_id=token_id,
    )

    if not deleted:
        raise HTTPException(status_code=404, detail="Subscription not found.")

    return {"message": "Subscription deleted.", "subscription_id": str(subscription_id)}


@router.post("/{token_id}/subscriptions/{subscription_id}/regenerate-url", response_model=RegenerateUrlResponse)
async def regenerate_subscription_url(
    request: Request,
    token_id: UUID,
    subscription_id: UUID,
    body: RegenerateUrlRequest,
    user: AuthenticatedUser = ...,
    db: AsyncSession = Depends(get_db),
):
    """Regenerate signed URL for a subscription."""
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")

    token_service = FeedTokenService(db)
    token = await token_service.get_active_token_by_id(token_id)

    if not token or token.kratos_identity_id != user.user_id:
        raise HTTPException(status_code=404, detail="Token not found or revoked.")

    sub_service = FeedSubscriptionService(db)
    subscription = await sub_service.get_subscription_by_id(
        subscription_id=subscription_id,
        token_id=token_id,
    )

    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found.")

    endpoint_map = {
        "search": "/rss/search",
        "channel": f"/rss/channel/{subscription.feed_params.get('username', '')}",
        "topic": f"/rss/topic/{subscription.feed_params.get('topic', '')}",
    }
    endpoint = endpoint_map.get(subscription.feed_type, "/rss/search")

    params = dict(subscription.feed_params)
    params["format"] = body.format

    base_url = str(request.base_url).rstrip("/")
    signed_url = token_service.build_signed_feed_url(
        base_url=base_url,
        endpoint=endpoint,
        params=params,
        token_id=str(token_id),
        signing_secret=token.signing_secret,
    )

    return RegenerateUrlResponse(url=signed_url, subscription_id=str(subscription_id))


@router.post("/{token_id}/subscriptions/{subscription_id}/clone", response_model=RegenerateUrlResponse)
async def clone_subscription(
    request: Request,
    token_id: UUID,
    subscription_id: UUID,
    body: SubscriptionCloneRequest,
    user: AuthenticatedUser = ...,
    db: AsyncSession = Depends(get_db),
):
    """Clone subscription with modified params, return new signed URL."""
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")

    token_service = FeedTokenService(db)
    token = await token_service.get_active_token_by_id(token_id)

    if not token or token.kratos_identity_id != user.user_id:
        raise HTTPException(status_code=404, detail="Token not found or revoked.")

    sub_service = FeedSubscriptionService(db)
    original = await sub_service.get_subscription_by_id(
        subscription_id=subscription_id,
        token_id=token_id,
    )

    if not original:
        raise HTTPException(status_code=404, detail="Subscription not found.")

    merged_params = dict(original.feed_params)
    merged_params.update(body.params)
    merged_params["format"] = body.format

    new_sub_id = await sub_service.upsert_subscription(
        token_id=token_id,
        feed_type=original.feed_type,
        params=merged_params,
    )

    endpoint_map = {
        "search": "/rss/search",
        "channel": f"/rss/channel/{merged_params.get('username', '')}",
        "topic": f"/rss/topic/{merged_params.get('topic', '')}",
    }
    endpoint = endpoint_map.get(original.feed_type, "/rss/search")

    base_url = str(request.base_url).rstrip("/")
    signed_url = token_service.build_signed_feed_url(
        base_url=base_url,
        endpoint=endpoint,
        params=merged_params,
        token_id=str(token_id),
        signing_secret=token.signing_secret,
    )

    logger.info(f"Cloned subscription {subscription_id} -> {new_sub_id}")

    return RegenerateUrlResponse(url=signed_url, subscription_id=str(new_sub_id))
