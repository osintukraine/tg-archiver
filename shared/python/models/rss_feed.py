"""
RSSFeed Model - RSS feed source configuration

Simplified model for tg-archiver.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class RSSFeed(Base):
    """RSS feed source configuration."""

    __tablename__ = "rss_feeds"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Feed metadata
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(String(500), nullable=False, unique=True)

    # Categorization
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    language: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    # Status
    is_active: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True, server_default="true", index=True
    )

    # Polling
    last_fetched_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    fetch_interval_minutes: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default="30"
    )

    # Error tracking
    error_count: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default="0"
    )
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

    # Relationships
    articles: Mapped[list["ExternalNews"]] = relationship(
        "ExternalNews", back_populates="feed", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<RSSFeed(id={self.id}, name={self.name}, is_active={self.is_active})>"
