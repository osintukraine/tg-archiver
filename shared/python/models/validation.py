"""
MessageValidation Model - LLM-generated validation summaries for Telegram messages

Stores cached validation results to avoid repeated LLM API calls.
Implements TTL-based cache invalidation strategy.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MessageValidation(Base):
    """LLM-generated validation summary for a Telegram message.

    Caches validation results with TTL-based expiration:
    - Messages <1hr: No cache (always fresh)
    - Messages 1-24hr: Cache 6 hours
    - Messages >24hr: Cache 24 hours
    """

    __tablename__ = "message_validations"
    __table_args__ = (
        UniqueConstraint("message_id", name="uq_message_validation"),
    )

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Foreign key to message
    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # LLM-generated validation summary
    summary: Mapped[Optional[str]] = mapped_column(
        String, nullable=True
    )  # 2-3 sentence summary of validation landscape
    confidence_score: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )  # Overall LLM confidence (0-1)

    # Metadata
    total_articles_found: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Number of correlated RSS articles
    processing_time_ms: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # Time taken to process validation

    # Cache management
    cached_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # When this validation was cached
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )  # When cache expires (TTL)

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True
    )

    # Relationships
    message: Mapped["Message"] = relationship(
        "Message", foreign_keys=[message_id], backref="validation"
    )

    def __repr__(self) -> str:
        return f"<MessageValidation(id={self.id}, message_id={self.message_id}, articles={self.total_articles_found})>"

    @property
    def is_expired(self) -> bool:
        """Check if cached validation has expired."""
        if not self.expires_at:
            return True
        return datetime.now(self.expires_at.tzinfo) > self.expires_at

    @property
    def is_fresh(self) -> bool:
        """Check if cached validation is still fresh."""
        return not self.is_expired
