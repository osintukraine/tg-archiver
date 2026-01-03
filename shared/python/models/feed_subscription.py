"""
Feed Subscription Model - Tracks user's feed subscriptions.

Simplified version for tg-archiver.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class FeedSubscription(Base):
    """
    Tracks a user's feed subscription.

    Simplified model - just stores feed type and filters per user.
    """

    __tablename__ = "feed_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    user_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    feed_type: Mapped[str] = mapped_column(String(50), nullable=False)
    filters: Mapped[Optional[dict]] = mapped_column(JSONB, default={}, nullable=True)

    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=True,
    )

    def __repr__(self) -> str:
        return f"<FeedSubscription(id={self.id}, type={self.feed_type})>"
