"""
ExternalNews Model - External news articles from RSS feeds

Articles are enriched with semantic embeddings, OSINT scores, and entity extraction
to enable cross-correlation with Telegram messages.
"""

from datetime import datetime
from typing import Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class ExternalNews(Base):
    """External news articles from RSS feeds."""

    __tablename__ = "external_news"
    __table_args__ = (
        UniqueConstraint("url", name="uq_external_news_url"),
    )

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Source
    feed_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("rss_feeds.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_type: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, server_default="rss"
    )

    # Content
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True, index=True)
    url_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Metadata
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )
    author: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Enrichment (importance_level replaced osint_score)
    importance_level: Mapped[Optional[str]] = mapped_column(String(20), nullable=True, index=True)
    tags: Mapped[Optional[list[str]]] = mapped_column(ARRAY(Text), nullable=True)
    entities: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    embedding: Mapped[Optional[Vector]] = mapped_column(
        Vector(384), nullable=True
    )  # 384-dimensional embeddings from sentence-transformers

    # Source context
    source_category: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )
    source_trust_level: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Individual source reference (extracted from URL domain)
    source_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("news_sources.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_domain: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)

    # Processing
    processed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    correlation_count: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default="0"
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

    # Relationships
    feed: Mapped[Optional["RSSFeed"]] = relationship("RSSFeed", back_populates="articles", lazy="selectin")
    source: Mapped[Optional["NewsSource"]] = relationship("NewsSource", back_populates="articles", lazy="selectin")
    correlations: Mapped[list["MessageNewsCorrelation"]] = relationship(
        "MessageNewsCorrelation", back_populates="news", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<ExternalNews(id={self.id}, title={self.title[:50]}..., source_category={self.source_category})>"
