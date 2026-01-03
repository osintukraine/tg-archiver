"""
ExternalNews Model - External news articles from RSS feeds
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class ExternalNews(Base):
    """External news articles from RSS feeds."""

    __tablename__ = "external_news"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Source
    feed_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("rss_feeds.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Content
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_translated: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    author: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    language_detected: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    categories: Mapped[Optional[list[str]]] = mapped_column(ARRAY(Text), nullable=True)

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

    # Relationships
    feed: Mapped[Optional["RSSFeed"]] = relationship("RSSFeed", back_populates="articles", lazy="selectin")

    def __repr__(self) -> str:
        return f"<ExternalNews(id={self.id}, title={self.title[:50] if self.title else ''}...)>"
