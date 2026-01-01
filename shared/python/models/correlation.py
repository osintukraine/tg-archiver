"""
MessageNewsCorrelation Model - Cross-correlation between Telegram messages and RSS news

Correlations link Telegram messages with related external news articles based on
semantic similarity, entity overlap, and temporal proximity.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MessageNewsCorrelation(Base):
    """Cross-correlation between Telegram messages and RSS news."""

    __tablename__ = "message_news_correlations"
    __table_args__ = (
        UniqueConstraint("message_id", "news_id", name="uq_message_news_correlation"),
    )

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Relationship
    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    news_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("external_news.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Correlation strength
    similarity_score: Mapped[float] = mapped_column(
        Numeric, nullable=False, index=True
    )  # 0.0-1.0 semantic similarity
    entity_overlap_score: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True
    )  # 0-100 percentage
    time_proximity_hours: Mapped[Optional[float]] = mapped_column(
        Numeric, nullable=True
    )  # Hours between message and article

    # Correlation type
    correlation_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # 'same_event', 'related_topic', 'contradictory', 'verification'

    # Source comparison
    telegram_source_category: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )
    rss_source_category: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    perspective_difference: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True, index=True
    )  # True if sources have conflicting perspectives

    # Details
    matched_entities: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True
    )  # Entities that matched between sources

    # LLM Validation Analysis (RSS Validation Layer Phase 1)
    validation_type: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # confirms|contradicts|context|alternative
    relevance_explanation: Mapped[Optional[str]] = mapped_column(
        String, nullable=True
    )  # Why LLM classified it this way
    confidence: Mapped[Optional[float]] = mapped_column(
        Numeric, nullable=True
    )  # LLM confidence in classification (0-1)

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

    # Relationships
    message: Mapped["Message"] = relationship(
        "Message", foreign_keys=[message_id], backref="news_correlations"
    )
    news: Mapped["ExternalNews"] = relationship(
        "ExternalNews", back_populates="correlations", foreign_keys=[news_id]
    )

    def __repr__(self) -> str:
        return f"<MessageNewsCorrelation(id={self.id}, message_id={self.message_id}, news_id={self.news_id}, similarity={self.similarity_score})>"
