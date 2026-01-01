"""
Feed Subscription Model - Tracks active RSS feed subscriptions per token.

Records which specific feeds are being polled by each token,
enabling the "Your Subscriptions" view in user profile.
"""

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Optional
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, ForeignKey, LargeBinary, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .feed_token import FeedToken


class FeedSubscription(Base):
    """
    Tracks an active feed subscription tied to a token.

    Created/updated when authenticated RSS endpoints are accessed.
    Deduplicated by hash of normalized params per token.
    """

    __tablename__ = "feed_subscriptions"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
    )

    feed_token_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("feed_tokens.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    params_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    feed_type: Mapped[str] = mapped_column(String(20), nullable=False)
    feed_params: Mapped[dict] = mapped_column(JSONB, nullable=False)
    summary: Mapped[str] = mapped_column(String(255), nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    access_count: Mapped[int] = mapped_column(BigInteger, default=1, nullable=False)

    token: Mapped["FeedToken"] = relationship("FeedToken", back_populates="subscriptions")

    @property
    def status(self) -> str:
        """Compute status: 'active' (0-14 days), 'stale' (15-30), 'archived' (31+)."""
        now = datetime.now(timezone.utc)
        last = self.last_accessed_at
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        days = (now - last).days
        if days <= 14:
            return "active"
        elif days <= 30:
            return "stale"
        return "archived"

    @property
    def display_name(self) -> str:
        return self.label or self.summary

    def __repr__(self) -> str:
        return f"<FeedSubscription(id={self.id}, type={self.feed_type}, status={self.status})>"
