"""
Feed Token Model - Authentication tokens for feed subscriptions.

Tokens enable authenticated access to RSS/Atom/JSON feeds without
requiring interactive login. Each token includes a signing secret
for HMAC-based URL signatures.

Security:
- Token stored as SHA-256 hash (plaintext shown once at creation)
- HMAC signing prevents URL tampering
- Per-token revocation without affecting other tokens
"""

from datetime import datetime
from typing import TYPE_CHECKING, List, Optional
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    DateTime,
    LargeBinary,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import INET, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .feed_subscription import FeedSubscription


class FeedToken(Base):
    """
    Authentication token for feed subscriptions.

    Users generate tokens to authenticate RSS/Atom/JSON feed access.
    Each feed URL includes the token_id and an HMAC signature of
    the query parameters, preventing URL tampering.
    """

    __tablename__ = "feed_tokens"

    # Primary key (UUID for unpredictable IDs)
    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    # Owner - Kratos identity UUID (matches user_roles, user_bookmarks pattern)
    kratos_identity_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
    )

    # Token authentication
    # We store hash, plaintext is shown once at creation
    token_hash: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False,
        unique=True,
    )
    token_prefix: Mapped[str] = mapped_column(
        String(8),
        nullable=False,
    )  # e.g., "ft_a1b2" for user identification in UI

    # HMAC signing secret (32 bytes)
    # Used to sign query parameters in feed URLs
    signing_secret: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False,
    )

    # Operational metadata
    label: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )  # User-defined: "My Feedly", "Work laptop"

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    revoked_reason: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )

    # Usage tracking for audit
    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    last_used_ip: Mapped[Optional[str]] = mapped_column(
        INET,
        nullable=True,
    )

    use_count: Mapped[int] = mapped_column(
        BigInteger,
        default=0,
        nullable=False,
    )

    subscriptions: Mapped[List["FeedSubscription"]] = relationship(
        "FeedSubscription",
        back_populates="token",
        cascade="all, delete-orphan",
    )

    @property
    def is_active(self) -> bool:
        """Check if token is active (not revoked)."""
        return self.revoked_at is None

    def __repr__(self) -> str:
        status = "active" if self.is_active else "revoked"
        return f"<FeedToken(id={self.id}, prefix={self.token_prefix}, status={status})>"
