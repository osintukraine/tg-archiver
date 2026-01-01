"""News Source model - individual news sources with configurable trust levels."""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.orm import relationship

from .base import Base


class NewsSource(Base):
    """
    Individual news sources with configurable trust levels.

    An aggregator RSS feed (like OSINT Ukraine Aggregator) may contain articles
    from many different sources (censor.net, kyivindependent.com, youtube.com).
    Each source has its own trust level, managed via NocoDB.

    Trust Level Scale:
        5 = Highest trust (established news agencies: Reuters, AP, Kyiv Independent)
        4 = High trust (reputable national media: BBC, The Guardian)
        3 = Medium trust (regional media, known bias but factual)
        2 = Low trust (propaganda outlets tracked for perspective: RT, TASS, YouTube)
        1 = Minimal trust (unverified sources, requires cross-checking)
    """

    __tablename__ = "news_sources"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Domain identification (e.g., "censor.net", "kyivindependent.com")
    domain = Column(String(255), nullable=False, unique=True, index=True)

    # Human-readable name (e.g., "Censor.NET", "Kyiv Independent")
    name = Column(String(255), nullable=False)

    # Website URL for reference
    website_url = Column(Text, nullable=True)

    # Trust level (1-5 scale)
    trust_level = Column(Integer, nullable=False, default=3)

    # Category for grouping/filtering
    category = Column(String(50), nullable=False, default="neutral")

    # Primary language of this source
    language = Column(String(10), nullable=True, default="en")

    # Country of origin (ISO 2-letter code)
    country = Column(String(10), nullable=True)

    # Editorial description/notes
    description = Column(Text, nullable=True)

    # Bias assessment (pro_ukraine, pro_russia, neutral, mixed)
    bias = Column(String(50), nullable=True, default="neutral")

    # Is this a verified/known source or auto-discovered?
    verified = Column(Boolean, nullable=False, default=False)

    # Should articles from this source be processed?
    active = Column(Boolean, nullable=False, default=True)

    # Statistics
    articles_count = Column(Integer, nullable=False, default=0)
    first_seen_at = Column(DateTime(timezone=True), nullable=True, default=datetime.utcnow)
    last_article_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), nullable=True, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=True, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship to articles
    articles = relationship("ExternalNews", back_populates="source", lazy="dynamic")

    def __repr__(self) -> str:
        return f"<NewsSource(id={self.id}, domain='{self.domain}', trust={self.trust_level})>"

    @property
    def trust_label(self) -> str:
        """Human-readable trust level label."""
        labels = {
            5: "Highest",
            4: "High",
            3: "Medium",
            2: "Low",
            1: "Minimal",
        }
        return labels.get(self.trust_level, "Unknown")
