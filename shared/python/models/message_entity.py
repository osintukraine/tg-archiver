"""Message-Entity Relationship Model - Junction table for entity matching."""

from datetime import datetime
from typing import Optional

from sqlalchemy import Float, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base


class MessageEntity(Base):
    """
    Many-to-many relationship between messages and curated entities.

    Links messages to curated entities via semantic matching (pgvector),
    exact string matching, alias matching, or hashtag matching.

    Used for:
    - Network graph visualization
    - Entity-based intelligence queries
    - Knowledge graph construction
    - Entity co-occurrence analysis
    """

    __tablename__ = "message_entities"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Foreign keys
    message_id: Mapped[int] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    entity_id: Mapped[int] = mapped_column(
        ForeignKey("curated_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Match metadata
    similarity_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        comment="Confidence score (0.0-1.0): semantic=cosine similarity, exact=1.0, alias=0.95, hashtag=0.90",
    )

    match_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="How entity was detected: semantic, exact_name, alias, or hashtag",
    )

    # Optional context
    context_snippet: Mapped[Optional[str]] = mapped_column(
        nullable=True, comment="Surrounding text where entity was found"
    )

    # Timestamp
    matched_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )

    # Relationships
    message: Mapped["Message"] = relationship("Message", back_populates="entity_matches")
    entity: Mapped["CuratedEntity"] = relationship("CuratedEntity", back_populates="message_matches")

    # Table constraints
    __table_args__ = (
        UniqueConstraint("message_id", "entity_id", name="uq_message_entity"),
        Index("idx_message_entities_message", "message_id"),
        Index("idx_message_entities_entity", "entity_id"),
        Index("idx_message_entities_similarity", "similarity_score"),
        Index("idx_message_entities_type", "match_type"),
        Index(
            "idx_message_entities_network",
            "message_id",
            "entity_id",
            "similarity_score",
        ),
    )

    def __repr__(self) -> str:
        return f"<MessageEntity(message_id={self.message_id}, entity_id={self.entity_id}, score={self.similarity_score:.2f}, type={self.match_type})>"
