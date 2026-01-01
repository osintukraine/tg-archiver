"""
RSSFeed Model - RSS feed source configuration

Each RSS feed represents a news source that provides articles to be ingested
and cross-correlated with Telegram messages.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class RSSFeed(Base):
    """RSS feed source configuration."""

    __tablename__ = "rss_feeds"
    __table_args__ = (
        CheckConstraint(
            "trust_level >= 1 AND trust_level <= 5", name="check_trust_level"
        ),
    )

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Feed metadata
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True, index=True)
    website_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Categorization
    category: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # 'ukraine', 'russia', 'neutral', 'international'
    trust_level: Mapped[int] = mapped_column(
        Integer, nullable=False
    )  # 1-5 scale

    # Metadata
    language: Mapped[Optional[str]] = mapped_column(
        String(10), nullable=True, server_default="en"
    )
    country: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Status
    active: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True, server_default="true", index=True
    )
    last_polled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    last_successful_poll_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    poll_failures_count: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default="0"
    )

    # Metrics
    articles_fetched_total: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default="0"
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True
    )

    # Relationships
    articles: Mapped[list["ExternalNews"]] = relationship(
        "ExternalNews", back_populates="feed", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<RSSFeed(id={self.id}, name={self.name}, category={self.category}, trust_level={self.trust_level})>"
