"""
API Key Model - Authentication keys for programmatic REST API access.

API keys enable authenticated programmatic access to the REST API with
granular scoped permissions. Each key includes a hash for secure storage
and tracks usage for audit purposes.

Security:
- Key stored as SHA-256 hash (plaintext shown once at creation)
- Scoped permissions (read, write, media, export, admin)
- Per-key revocation without affecting other keys
- Optional expiration dates
- Rate limit tier overrides
"""

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    ARRAY,
    BigInteger,
    DateTime,
    LargeBinary,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import INET, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ApiKey(Base):
    """
    Authentication key for programmatic REST API access.

    Users generate API keys to authenticate programmatic API requests.
    Each key has scoped permissions (read, write, media, export, admin)
    and can optionally expire or have custom rate limits.
    """

    __tablename__ = "api_keys"

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

    # Security - we store hash, plaintext is shown once at creation
    key_hash: Mapped[bytes] = mapped_column(
        LargeBinary,
        nullable=False,
        unique=True,
    )
    key_prefix: Mapped[str] = mapped_column(
        String(12),
        nullable=False,
    )  # e.g., "ak_a1b2c3d4" for user identification in UI

    # Metadata
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )  # User-defined: "Production API", "CI/CD Pipeline"

    description: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )

    # Permissions/Scopes
    scopes: Mapped[list[str]] = mapped_column(
        ARRAY(Text),
        server_default="ARRAY['read']",
        nullable=False,
    )  # read, write, media, export, admin

    # Lifecycle
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
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

    # Rate limit tier override
    rate_limit_tier: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
    )  # standard, premium, unlimited

    @property
    def is_active(self) -> bool:
        """Check if API key is active (not revoked and not expired)."""
        if self.revoked_at is not None:
            return False
        if self.expires_at is not None and datetime.now(timezone.utc) > self.expires_at:
            return False
        return True

    @property
    def is_expired(self) -> bool:
        """Check if API key has expired."""
        if self.expires_at is None:
            return False
        return datetime.now(timezone.utc) > self.expires_at

    def has_scope(self, scope: str) -> bool:
        """Check if API key has a specific scope."""
        return scope in self.scopes

    def __repr__(self) -> str:
        status = "active" if self.is_active else ("expired" if self.is_expired else "revoked")
        scopes_str = ",".join(self.scopes) if self.scopes else "none"
        return f"<ApiKey(id={self.id}, name={self.name}, prefix={self.key_prefix}, scopes={scopes_str}, status={status})>"
