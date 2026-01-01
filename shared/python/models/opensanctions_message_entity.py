"""OpenSanctions Message-Entity Junction Table Model."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base


class OpenSanctionsMessageEntity(Base):
    """
    Junction table linking messages to OpenSanctions entities.

    Tracks entity matches from the OpenSanctions API enrichment service.
    Separate from message_entities (which is for curated_entities only).

    Match methods:
    - real_time: Matched during message ingestion
    - async_enrichment: Matched by background enrichment service
    - manual: Human-verified match
    """

    __tablename__ = "opensanctions_message_entities"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Foreign keys
    message_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    entity_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("opensanctions_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Match quality
    match_score: Mapped[float] = mapped_column(
        Float,
        CheckConstraint("match_score >= 0 AND match_score <= 1", name="match_score_range"),
        nullable=False,
        index=True,
        comment="Confidence score from OpenSanctions API (0.0-1.0)",
    )

    match_method: Mapped[str] = mapped_column(
        String(20),
        CheckConstraint(
            "match_method IN ('real_time', 'async_enrichment', 'manual')",
            name="match_method_check",
        ),
        nullable=False,
        index=True,
        comment="How the entity was matched",
    )

    # Context
    context_snippet: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
        comment="Text excerpt showing where entity was mentioned",
    )

    extraction_method: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
        comment="How entity was extracted: spacy_ner, regex_pattern, manual",
    )

    # OpenSanctions API match features
    match_features: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        comment="Features from OpenSanctions API response",
    )

    # Timestamp
    matched_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    # Relationships
    message: Mapped["Message"] = relationship(
        "Message",
        foreign_keys=[message_id],
    )

    entity: Mapped["OpenSanctionsEntity"] = relationship(
        "OpenSanctionsEntity",
        foreign_keys=[entity_id],
    )

    # Table constraints
    __table_args__ = (
        UniqueConstraint("message_id", "entity_id", name="uq_opensanctions_message_entity"),
    )

    def __repr__(self) -> str:
        return (
            f"<OpenSanctionsMessageEntity("
            f"message_id={self.message_id}, "
            f"entity_id={self.entity_id}, "
            f"score={self.match_score:.2f}, "
            f"method={self.match_method}"
            f")>"
        )
