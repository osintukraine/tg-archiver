"""Spam Reference Example model - Embedding-based classification."""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, CheckConstraint, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from .base import Base


class SpamReferenceExample(Base):
    """
    Reference examples for embedding-based spam/relevance classification.

    Used by EmbeddingSpamFilter to classify messages via cosine similarity
    against these pre-defined examples. Categories:
    - spam: High similarity = message is spam
    - ukraine_relevant: High similarity = on-topic content
    - off_topic: High similarity = quarantine for review

    Examples are loaded into memory at startup and refreshed periodically.
    Sysadmins can add/modify examples via admin UI without restart.
    """

    __tablename__ = "spam_reference_examples"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Category determines classification behavior
    category: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True,
    )

    # Language for organization (EN, RU, UK, multi)
    # Model is multilingual, so all examples are compared together
    language: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
    )

    # The example text that will be embedded
    example_text: Mapped[str] = mapped_column(Text, nullable=False)

    # Human-readable description for admin UI
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Subcategory for filtering/organization
    # e.g., 'crypto_scam', 'channel_promo', 'combat_report', 'political'
    subcategory: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Priority weight (future: weighted similarity)
    weight: Mapped[float] = mapped_column(Float, default=1.0)

    # Active flag for soft disable without deleting
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    # Audit fields
    created_at: Mapped[datetime] = mapped_column(
        default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    created_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Table constraints
    __table_args__ = (
        CheckConstraint(
            "category IN ('spam', 'ukraine_relevant', 'off_topic')",
            name="check_spam_example_category"
        ),
        CheckConstraint(
            "language IN ('en', 'ru', 'uk', 'multi')",
            name="check_spam_example_language"
        ),
    )

    def __repr__(self) -> str:
        return (
            f"<SpamReferenceExample(id={self.id}, category='{self.category}', "
            f"language='{self.language}', text='{self.example_text[:30]}...')>"
        )
