"""
Feed Token Service - Token generation and management.

Simplified version for tg-archiver (no Ory Kratos, no URL signing).

Provides:
- Secure token generation with SHA-256 hashing
- Token CRUD operations
"""

import hashlib
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional, Tuple, List

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models.feed_token import FeedToken

logger = logging.getLogger(__name__)


class FeedTokenService:
    """Service for feed token operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # Token Generation
    # =========================================================================

    @staticmethod
    def generate_token() -> Tuple[str, str]:
        """
        Generate a new feed token.

        Returns:
            Tuple of (plaintext_token, token_hash)

        Security:
            - 32 bytes (256 bits) of cryptographic randomness
            - URL-safe base64 encoding
            - Only hash is stored, plaintext shown once
        """
        # Generate 32 random bytes, encode as URL-safe base64
        raw_token = secrets.token_urlsafe(32)

        # Store hash, not plaintext
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        return raw_token, token_hash

    @staticmethod
    def hash_token(plaintext: str) -> str:
        """Hash a plaintext token for lookup."""
        return hashlib.sha256(plaintext.encode()).hexdigest()

    # =========================================================================
    # Token CRUD
    # =========================================================================

    async def create_token(
        self,
        user_id: int,
        name: Optional[str] = None,
    ) -> Tuple[FeedToken, str]:
        """
        Create a new feed token for a user.

        Args:
            user_id: Owner's user ID
            name: Optional user-defined label

        Returns:
            Tuple of (FeedToken object, plaintext_token)

        Note:
            The plaintext token is returned ONLY at creation time.
            It cannot be recovered later - only the hash is stored.
        """
        plaintext, token_hash = self.generate_token()

        token = FeedToken(
            user_id=user_id,
            token_hash=token_hash,
            name=name,
            is_active=True,
        )

        self.db.add(token)
        await self.db.commit()
        await self.db.refresh(token)

        return token, plaintext

    async def get_token_by_id(self, token_id: int) -> Optional[FeedToken]:
        """Get a token by its ID."""
        result = await self.db.execute(
            select(FeedToken).where(FeedToken.id == token_id)
        )
        return result.scalar_one_or_none()

    async def get_active_token_by_id(self, token_id: int) -> Optional[FeedToken]:
        """Get an active token by its ID."""
        result = await self.db.execute(
            select(FeedToken).where(
                FeedToken.id == token_id,
                FeedToken.is_active == True,
            )
        )
        return result.scalar_one_or_none()

    async def get_user_tokens(self, user_id: int) -> List[FeedToken]:
        """Get all tokens for a user."""
        result = await self.db.execute(
            select(FeedToken)
            .where(FeedToken.user_id == user_id)
            .order_by(FeedToken.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_user_active_tokens(self, user_id: int) -> List[FeedToken]:
        """Get active tokens for a user."""
        result = await self.db.execute(
            select(FeedToken)
            .where(
                FeedToken.user_id == user_id,
                FeedToken.is_active == True,
            )
            .order_by(FeedToken.created_at.desc())
        )
        return list(result.scalars().all())

    async def revoke_token(
        self,
        token_id: int,
        user_id: int,
    ) -> bool:
        """
        Revoke a token.

        Args:
            token_id: Token to revoke
            user_id: Owner's user ID (for authorization)

        Returns:
            True if token was revoked, False if not found or already revoked
        """
        result = await self.db.execute(
            update(FeedToken)
            .where(
                FeedToken.id == token_id,
                FeedToken.user_id == user_id,
                FeedToken.is_active == True,
            )
            .values(is_active=False)
            .returning(FeedToken.id)
        )

        revoked = result.scalar_one_or_none()
        if revoked:
            await self.db.commit()
            return True
        return False

    async def update_usage(self, token_id: int) -> None:
        """
        Update token usage statistics.

        Called on each successful feed request.
        """
        try:
            await self.db.execute(
                update(FeedToken)
                .where(FeedToken.id == token_id)
                .values(last_used_at=datetime.now(timezone.utc))
            )
            await self.db.commit()
        except Exception as e:
            logger.warning(f"Failed to update token usage stats for {token_id}: {e}")
            await self.db.rollback()

    async def verify_token(self, plaintext_token: str) -> Optional[FeedToken]:
        """
        Verify a token and return it if valid.

        Args:
            plaintext_token: The plaintext token to verify

        Returns:
            FeedToken if valid and active, None otherwise
        """
        token_hash = self.hash_token(plaintext_token)
        result = await self.db.execute(
            select(FeedToken).where(
                FeedToken.token_hash == token_hash,
                FeedToken.is_active == True,
            )
        )
        return result.scalar_one_or_none()
