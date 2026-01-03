"""
API Key Model - Authentication keys for programmatic REST API access.

API keys enable authenticated programmatic access to the REST API with
granular scoped permissions.

Simplified version for tg-archiver (no Ory Kratos).
"""

from datetime import datetime, timezone as tz
from typing import Optional, List

from sqlalchemy import (
    ARRAY,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class ApiKey(Base):
    """
    Authentication key for programmatic REST API access.

    Users generate API keys to authenticate programmatic API requests.
    Each key has scoped permissions (read, write, media, export, admin).
    Simplified schema without Kratos dependencies.
    """

    __tablename__ = "api_keys"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Owner - simple user_id reference
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Security - we store hash, plaintext is shown once at creation
    key_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
    )

    # Metadata
    name: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )

    # Permissions/Scopes
    scopes: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(Text),
        nullable=True,
    )

    # Status
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=True,
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=True,
    )

    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    last_used_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationship
    user = relationship("User", back_populates="api_keys")

    @property
    def is_expired(self) -> bool:
        """Check if API key has expired."""
        if self.expires_at is None:
            return False
        return datetime.now(tz.utc) > self.expires_at

    def has_scope(self, scope: str) -> bool:
        """Check if API key has a specific scope."""
        return self.scopes and scope in self.scopes

    def __repr__(self) -> str:
        status = "active" if self.is_active and not self.is_expired else "inactive"
        scopes_str = ",".join(self.scopes) if self.scopes else "none"
        return f"<ApiKey(id={self.id}, name={self.name}, scopes={scopes_str}, status={status})>"
