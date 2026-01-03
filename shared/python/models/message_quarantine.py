"""
MessageQuarantine Model - Off-topic content holding table.

Messages failing relevance check are held here for human review.
7-day auto-expiry. Human decisions feed back to LLM as few-shot examples.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    BigInteger,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MessageQuarantine(Base):
    """
    Quarantined message awaiting human review.

    Off-topic messages are held here instead of going to the main messages
    table. Human review in NocoDB can:
    - Approve: Copy to messages table
    - Reject: Mark rejected, expires naturally
    - Expire: Auto-deleted after 7 days if no action

    Attributes:
        channel_id: Reference to channels table
        telegram_message_id: Original Telegram message ID
        quarantine_reason: Why quarantined (off_topic, low_confidence)
        review_status: pending, approved, rejected, expired
    """

    __tablename__ = "message_quarantine"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Original message data
    channel_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    telegram_message_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_translated: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    telegram_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    media_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    media_urls: Mapped[Optional[list[str]]] = mapped_column(ARRAY(Text), nullable=True)

    # Classification data
    quarantine_reason: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    quarantine_details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    llm_topic: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    llm_importance: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    llm_confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_ukraine_relevant: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Review workflow
    review_status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    reviewed_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    review_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Lifecycle
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("(NOW() + INTERVAL '7 days')"),
        nullable=False,
        index=True,
    )

    # LLM feedback
    feedback_sent_to_llm: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    feedback_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    channel: Mapped["Channel"] = relationship("Channel", back_populates="quarantined_messages")

    def __repr__(self) -> str:
        return (
            f"<MessageQuarantine(id={self.id}, channel_id={self.channel_id}, "
            f"reason={self.quarantine_reason}, status={self.review_status})>"
        )

    @property
    def is_expired(self) -> bool:
        """Check if this quarantine entry has expired."""
        if self.expires_at is None:
            return False
        return datetime.now(self.expires_at.tzinfo) > self.expires_at

    @property
    def days_until_expiry(self) -> int:
        """Days remaining until auto-expiry."""
        if self.expires_at is None:
            return 7
        delta = self.expires_at - datetime.now(self.expires_at.tzinfo)
        return max(0, delta.days)
