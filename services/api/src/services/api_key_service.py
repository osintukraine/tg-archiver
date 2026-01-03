"""
API Key Service - Token generation, verification, and lifecycle management.

Simplified version for tg-archiver (no Ory Kratos).

Provides:
- Secure API key generation with SHA-256 hashing
- Scope-based permissions
- Key CRUD operations
"""

import hashlib
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional, Tuple, List

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.api_key import ApiKey

logger = logging.getLogger(__name__)


class ApiKeyService:
    """Service for API key management."""

    PREFIX = "ak_"
    MAX_KEYS_PER_USER = 10
    KEY_BYTES = 32  # 256-bit key

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # Key Generation
    # =========================================================================

    @staticmethod
    def generate_key() -> Tuple[str, str]:
        """
        Generate a new API key.

        Returns:
            Tuple of (plaintext_key, key_hash)

        Security:
            - 32 bytes (256 bits) of cryptographic randomness
            - URL-safe encoding
            - Only hash is stored, plaintext shown once
        """
        # Generate random key
        raw_key = secrets.token_urlsafe(ApiKeyService.KEY_BYTES)

        # Create prefix for identification
        prefix_id = secrets.token_hex(4)
        plaintext = f"{ApiKeyService.PREFIX}{prefix_id}_{raw_key}"

        # Hash for storage
        key_hash = hashlib.sha256(plaintext.encode()).hexdigest()

        return plaintext, key_hash

    @staticmethod
    def hash_key(plaintext: str) -> str:
        """Hash a plaintext key for lookup."""
        return hashlib.sha256(plaintext.encode()).hexdigest()

    # =========================================================================
    # Key CRUD
    # =========================================================================

    async def create_key(
        self,
        user_id: int,
        name: str,
        scopes: Optional[List[str]] = None,
        expires_at: Optional[datetime] = None,
    ) -> Tuple[ApiKey, str]:
        """
        Create a new API key for a user.

        Args:
            user_id: Owner's user ID
            name: User-friendly name for the key
            scopes: List of permissions (default: ["read"])
            expires_at: Optional expiration datetime

        Returns:
            Tuple of (ApiKey object, plaintext_key)

        Raises:
            ValueError: If user has too many keys
        """
        # Check key limit
        count = await self.db.scalar(
            select(func.count(ApiKey.id))
            .where(ApiKey.user_id == user_id)
            .where(ApiKey.is_active == True)
        )
        if count and count >= ApiKeyService.MAX_KEYS_PER_USER:
            raise ValueError(
                f"Maximum {ApiKeyService.MAX_KEYS_PER_USER} active API keys allowed"
            )

        # Generate key
        plaintext, key_hash = ApiKeyService.generate_key()

        # Create record
        api_key = ApiKey(
            user_id=user_id,
            key_hash=key_hash,
            name=name,
            scopes=scopes or ["read"],
            expires_at=expires_at,
            is_active=True,
        )

        self.db.add(api_key)
        await self.db.commit()
        await self.db.refresh(api_key)

        return api_key, plaintext

    async def get_key_by_id(
        self,
        key_id: int,
        user_id: Optional[int] = None,
    ) -> Optional[ApiKey]:
        """
        Get an API key by ID, optionally filtering by owner.

        Args:
            key_id: Key ID
            user_id: Optional user ID to verify ownership

        Returns:
            ApiKey if found, None otherwise
        """
        query = select(ApiKey).where(ApiKey.id == key_id)

        if user_id is not None:
            query = query.where(ApiKey.user_id == user_id)

        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def get_user_keys(
        self,
        user_id: int,
        include_inactive: bool = True,
    ) -> List[ApiKey]:
        """
        Get all API keys for a user.

        Args:
            user_id: User ID
            include_inactive: Include inactive keys (default: True)

        Returns:
            List of ApiKey objects
        """
        query = select(ApiKey).where(ApiKey.user_id == user_id)

        if not include_inactive:
            query = query.where(ApiKey.is_active == True)

        query = query.order_by(ApiKey.created_at.desc())

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def revoke_key(
        self,
        key_id: int,
        user_id: int,
    ) -> bool:
        """
        Revoke an API key.

        Args:
            key_id: Key to revoke
            user_id: Owner's user ID (for authorization)

        Returns:
            True if key was revoked, False if not found or already revoked
        """
        result = await self.db.execute(
            update(ApiKey)
            .where(
                ApiKey.id == key_id,
                ApiKey.user_id == user_id,
                ApiKey.is_active == True,
            )
            .values(is_active=False)
            .returning(ApiKey.id)
        )

        revoked = result.scalar_one_or_none()
        if revoked:
            await self.db.commit()
            return True
        return False

    # =========================================================================
    # Key Validation
    # =========================================================================

    async def validate_key(
        self,
        key: str,
        required_scope: Optional[str] = None,
    ) -> Optional[ApiKey]:
        """
        Validate an API key and optionally check scope.

        Args:
            key: The plaintext API key
            required_scope: Optional scope to check

        Returns:
            ApiKey if valid, None otherwise
        """
        if not key or not key.startswith(ApiKeyService.PREFIX):
            return None

        # Hash the provided key
        key_hash = ApiKeyService.hash_key(key)

        # Look up by hash
        result = await self.db.execute(
            select(ApiKey)
            .where(
                ApiKey.key_hash == key_hash,
                ApiKey.is_active == True,
                or_(
                    ApiKey.expires_at.is_(None),
                    ApiKey.expires_at > func.now(),
                ),
            )
        )
        api_key = result.scalar_one_or_none()

        if not api_key:
            return None

        # Check scope if required
        if required_scope and api_key.scopes and required_scope not in api_key.scopes:
            return None

        return api_key

    # =========================================================================
    # Usage Tracking
    # =========================================================================

    async def update_usage(self, key_id: int) -> None:
        """
        Update usage statistics for an API key.

        Called on each successful API request.
        """
        try:
            await self.db.execute(
                update(ApiKey)
                .where(ApiKey.id == key_id)
                .values(last_used_at=datetime.now(timezone.utc))
            )
            await self.db.commit()
        except Exception as e:
            logger.warning(f"Failed to update API key usage stats for {key_id}: {e}")
            await self.db.rollback()

    # =========================================================================
    # Utility Methods
    # =========================================================================

    async def get_active_key_count(self, user_id: int) -> int:
        """Get count of active keys for a user."""
        count = await self.db.scalar(
            select(func.count(ApiKey.id))
            .where(ApiKey.user_id == user_id)
            .where(ApiKey.is_active == True)
        )
        return count or 0

    async def can_create_key(self, user_id: int) -> bool:
        """Check if user can create another API key."""
        count = await self.get_active_key_count(user_id)
        return count < ApiKeyService.MAX_KEYS_PER_USER
