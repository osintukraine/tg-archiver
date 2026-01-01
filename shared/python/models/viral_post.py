"""
ViralPost model - Tracks high-engagement posts for enhanced comment polling.

Viral posts are detected based on:
- Views > 3x channel average
- Forward count > 50
- Comments count > 20
- Engagement velocity > 1000 views/hour

Viral posts get "hot tier" comment polling (every 4h) regardless of age.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class ViralPost(Base):
    """
    Tracks high-engagement posts for enhanced comment polling.

    When a post exceeds viral thresholds, it's added here and gets
    priority comment polling until deactivated (30 days or engagement plateau).
    """

    __tablename__ = "viral_posts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    # Detection metadata
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    viral_reason: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # 'high_views', 'high_forwards', 'high_comments', 'velocity'
    viral_score: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Threshold values at detection time (audit trail)
    views_at_detection: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    forwards_at_detection: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    comments_at_detection: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    channel_avg_views: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Polling tracking
    last_comment_check: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    comment_check_count: Mapped[int] = mapped_column(Integer, default=0)

    # Lifecycle
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    deactivated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deactivation_reason: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # 'age_limit', 'engagement_plateau', 'manual'

    # Relationships
    message = relationship("Message", back_populates="viral_tracking")

    def __repr__(self) -> str:
        return f"<ViralPost id={self.id} message_id={self.message_id} reason={self.viral_reason} active={self.is_active}>"

    def deactivate(self, reason: str) -> None:
        """Deactivate viral tracking for this post."""
        self.is_active = False
        self.deactivated_at = datetime.utcnow()
        self.deactivation_reason = reason

    def record_comment_check(self) -> None:
        """Record that a comment check was performed."""
        self.last_comment_check = datetime.utcnow()
        self.comment_check_count += 1
