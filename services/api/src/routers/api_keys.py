"""
API Keys Router

CRUD operations for user API keys.
All endpoints require authentication.
"""

from datetime import datetime, timedelta
from typing import Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies.auth import AuthenticatedUser
from ..services.api_key_service import ApiKeyService

router = APIRouter(prefix="/api/api-keys", tags=["api-keys"])


# =============================================================================
# Request/Response Models
# =============================================================================

class ApiKeyCreateRequest(BaseModel):
    """Request to create a new API key."""
    name: str = Field(..., min_length=1, max_length=100, description="Friendly name for the key")
    description: Optional[str] = Field(None, max_length=500)
    scopes: List[str] = Field(default=["read"], description="Permission scopes")
    expires_in_days: Optional[int] = Field(None, ge=1, le=365, description="Days until expiration (null = never)")

    class Config:
        json_schema_extra = {
            "example": {
                "name": "Production API",
                "description": "Main API key for production server",
                "scopes": ["read", "write"],
                "expires_in_days": 90
            }
        }


class ApiKeyResponse(BaseModel):
    """API key info (without the actual key)."""
    id: str
    name: str
    description: Optional[str]
    prefix: str  # Frontend expects "prefix" not "key_prefix"
    scopes: List[str]
    created_at: str
    expires_at: Optional[str]
    revoked_at: Optional[str]
    revoked_reason: Optional[str]
    last_used_at: Optional[str]
    use_count: int
    rate_limit_tier: Optional[str] = None
    is_active: bool
    is_expired: bool = False


class ApiKeyCreateResponse(BaseModel):
    """Response after creating API key - includes plaintext key ONCE."""
    api_key: ApiKeyResponse
    plaintext_key: str = Field(..., description="Save this! It won't be shown again.")
    warning: str = "This is the only time you'll see this key. Store it securely."


class ApiKeyListResponse(BaseModel):
    """List of user's API keys."""
    keys: List[ApiKeyResponse]
    total: int
    active_count: int


class ApiKeyRevokeRequest(BaseModel):
    """Request to revoke an API key."""
    reason: Optional[str] = Field(None, max_length=255)


class ApiKeySummaryItem(BaseModel):
    """Minimal API key info for usage summary."""
    id: str
    name: str
    prefix: str
    use_count: int
    last_used_at: Optional[str]


class TierLimits(BaseModel):
    """Rate limits per category for a tier."""
    default: int
    media: int
    export: int
    map: int


class UsageSummaryResponse(BaseModel):
    """Usage summary across all API keys."""
    total_keys: int
    active_keys: int
    total_requests: int
    requests_today: int = 0
    requests_this_week: int = 0
    requests_this_month: int = 0
    rate_limit_tier: str
    tier_limits: TierLimits
    keys: List[ApiKeySummaryItem]


# =============================================================================
# Scope Validation
# =============================================================================

VALID_SCOPES = {"read", "write", "media", "export", "admin"}


def validate_scopes(scopes: List[str]) -> List[str]:
    """Validate and normalize scopes."""
    invalid = set(scopes) - VALID_SCOPES
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid scopes: {invalid}. Valid scopes: {VALID_SCOPES}"
        )
    return list(set(scopes))  # Dedupe


# =============================================================================
# Endpoints
# =============================================================================

@router.post("", response_model=ApiKeyCreateResponse, status_code=status.HTTP_201_CREATED)
async def create_api_key(
    body: ApiKeyCreateRequest,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new API key.

    **IMPORTANT**: The plaintext key is only returned ONCE. Store it securely!

    Scopes:
    - `read`: Read-only access to data
    - `write`: Create/update data
    - `media`: Access media files
    - `export`: Export data
    - `admin`: Administrative operations (requires admin user)
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to create API keys.",
        )

    # Validate scopes
    scopes = validate_scopes(body.scopes)

    # Non-admins can't create admin-scoped keys
    if "admin" in scopes and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can create keys with 'admin' scope"
        )

    # Calculate expiration
    expires_at = None
    if body.expires_in_days:
        expires_at = datetime.utcnow() + timedelta(days=body.expires_in_days)

    service = ApiKeyService(db)

    try:
        api_key, plaintext = await service.create_key(
            kratos_identity_id=user.user_id,
            name=body.name,
            scopes=scopes,
            description=body.description,
            expires_at=expires_at,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

    return ApiKeyCreateResponse(
        api_key=ApiKeyResponse(
            id=str(api_key.id),
            name=api_key.name,
            description=api_key.description,
            prefix=api_key.key_prefix,
            scopes=api_key.scopes,
            created_at=api_key.created_at.isoformat(),
            expires_at=api_key.expires_at.isoformat() if api_key.expires_at else None,
            revoked_at=api_key.revoked_at.isoformat() if api_key.revoked_at else None,
            revoked_reason=api_key.revoked_reason,
            last_used_at=api_key.last_used_at.isoformat() if api_key.last_used_at else None,
            use_count=api_key.use_count or 0,
            rate_limit_tier=api_key.rate_limit_tier,
            is_active=api_key.is_active,
            is_expired=api_key.is_expired,
        ),
        plaintext_key=plaintext,
    )


@router.get("", response_model=ApiKeyListResponse)
async def list_api_keys(
    user: AuthenticatedUser,
    include_revoked: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """
    List all API keys for the authenticated user.

    Includes both active and revoked keys by default.
    Set `include_revoked=false` to only show active keys.
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    service = ApiKeyService(db)
    keys = await service.get_user_keys(
        kratos_identity_id=user.user_id,
        include_revoked=include_revoked,
    )

    active_count = sum(1 for k in keys if k.is_active)

    return ApiKeyListResponse(
        keys=[
            ApiKeyResponse(
                id=str(k.id),
                name=k.name,
                description=k.description,
                prefix=k.key_prefix,
                scopes=k.scopes,
                created_at=k.created_at.isoformat(),
                expires_at=k.expires_at.isoformat() if k.expires_at else None,
                revoked_at=k.revoked_at.isoformat() if k.revoked_at else None,
                revoked_reason=k.revoked_reason,
                last_used_at=k.last_used_at.isoformat() if k.last_used_at else None,
                use_count=k.use_count or 0,
                rate_limit_tier=k.rate_limit_tier,
                is_active=k.is_active,
                is_expired=k.is_expired,
            )
            for k in keys
        ],
        total=len(keys),
        active_count=active_count,
    )


@router.get("/usage/summary", response_model=UsageSummaryResponse)
async def get_usage_summary(
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Get usage summary across all API keys.

    Shows total keys, active keys, total requests, rate limit tier, and key list.
    """
    from ..utils.rate_limit import RATE_LIMIT_TIERS

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    service = ApiKeyService(db)
    keys = await service.get_user_keys(
        kratos_identity_id=user.user_id,
        include_revoked=False,  # Only active keys for usage
    )

    total_requests = sum(k.use_count or 0 for k in keys)
    active_keys = len(keys)

    # Determine user's rate limit tier
    tier = "admin" if user.is_admin else "authenticated"
    tier_limits_data = RATE_LIMIT_TIERS.get(tier, RATE_LIMIT_TIERS["authenticated"])

    # Build key summary list
    key_summaries = [
        ApiKeySummaryItem(
            id=str(k.id),
            name=k.name,
            prefix=k.key_prefix,
            use_count=k.use_count or 0,
            last_used_at=k.last_used_at.isoformat() if k.last_used_at else None,
        )
        for k in keys
    ]

    return UsageSummaryResponse(
        total_keys=len(keys),
        active_keys=active_keys,
        total_requests=total_requests,
        requests_today=0,  # TODO: Implement daily tracking
        requests_this_week=0,  # TODO: Implement weekly tracking
        requests_this_month=0,  # TODO: Implement monthly tracking
        rate_limit_tier=tier,
        tier_limits=TierLimits(
            default=tier_limits_data.get("default", 60),
            media=tier_limits_data.get("media", 30),
            export=tier_limits_data.get("export", 10),
            map=tier_limits_data.get("map", 120),
        ),
        keys=key_summaries,
    )


@router.get("/{key_id}", response_model=ApiKeyResponse)
async def get_api_key(
    key_id: UUID,
    user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Get details for a specific API key.

    User can only access their own API keys.
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    service = ApiKeyService(db)
    api_key = await service.get_key_by_id(
        key_id=key_id,
        kratos_identity_id=user.user_id,
    )

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found"
        )

    return ApiKeyResponse(
        id=str(api_key.id),
        name=api_key.name,
        description=api_key.description,
        prefix=api_key.key_prefix,
        scopes=api_key.scopes,
        created_at=api_key.created_at.isoformat(),
        expires_at=api_key.expires_at.isoformat() if api_key.expires_at else None,
        revoked_at=api_key.revoked_at.isoformat() if api_key.revoked_at else None,
        revoked_reason=api_key.revoked_reason,
        last_used_at=api_key.last_used_at.isoformat() if api_key.last_used_at else None,
        use_count=api_key.use_count or 0,
        rate_limit_tier=api_key.rate_limit_tier,
        is_active=api_key.is_active,
        is_expired=api_key.is_expired,
    )


@router.delete("/{key_id}", status_code=status.HTTP_200_OK)
async def revoke_api_key(
    key_id: UUID,
    user: AuthenticatedUser,
    body: Optional[ApiKeyRevokeRequest] = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Revoke an API key.

    Once revoked, the key cannot be used and this action cannot be undone.
    User can only revoke their own keys.
    """
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    service = ApiKeyService(db)
    reason = body.reason if body else None

    revoked = await service.revoke_key(
        key_id=key_id,
        kratos_identity_id=user.user_id,
        reason=reason,
    )

    if not revoked:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="API key not found or already revoked.",
        )

    return {"message": "API key revoked successfully", "key_id": str(key_id)}
