"""
ExtractionPattern Model - Configurable entity extraction patterns

Operators can define custom regex patterns or keyword lists for entity extraction.
Patterns are loaded by the processor's EntityExtractor at startup and can be
reloaded at runtime via Redis pub/sub.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ExtractionPattern(Base):
    """
    Configurable extraction pattern for entity detection.

    Pattern types:
    - regex: Regular expression pattern
    - keyword_list: JSON array of keywords to match

    Entity types:
    - hashtag, mention, url, telegram_link (built-in, core patterns)
    - coordinate (location-based patterns)
    - custom (user-defined patterns)
    """

    __tablename__ = "extraction_patterns"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Pattern identification
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    entity_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # 'hashtag', 'mention', 'url', 'coordinate', 'custom', etc.

    # Pattern definition
    pattern: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # Regex pattern or JSON array for keyword_list
    pattern_type: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="regex"
    )  # 'regex', 'keyword_list'

    # Pattern behavior
    case_sensitive: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", index=True
    )

    # Metadata
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    color: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, server_default="gray"
    )  # For UI display
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<ExtractionPattern(id={self.id}, name='{self.name}', type='{self.entity_type}', enabled={self.enabled})>"
