"""
Feed Token Model - Authentication tokens for feed subscriptions.

Tokens enable authenticated access to RSS/Atom/JSON feeds without
requiring interactive login.

Simplified version for tg-archiver (no Ory Kratos).
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class FeedToken(Base):
    """
    Authentication token for feed subscriptions.

    Users generate tokens to authenticate RSS/Atom/JSON feed access.
    Simplified schema without Kratos dependencies.
    """

    __tablename__ = "feed_tokens"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Owner - simple user_id reference
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # Token authentication - we store hash, plaintext shown once
    token_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
        index=True,
    )

    # User-defined label
    name: Mapped[Optional[str]] = mapped_column(
        String(100),
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
    user = relationship("User", back_populates="feed_tokens")

    def __repr__(self) -> str:
        status = "active" if self.is_active else "inactive"
        return f"<FeedToken(id={self.id}, name={self.name}, status={status})>"
