"""
Entity Relationship Model - Entity graphs (family, business, ownership)
"""

from datetime import datetime
from typing import Optional, List

from sqlalchemy import (
    Integer,
    String,
    Numeric,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class EntityRelationship(Base):
    """
    Relationships between OpenSanctions entities

    Types:
    - family: Family relationships (spouse, child, parent)
    - business: Business relationships (director, shareholder, partner)
    - ownership: Ownership relationships (owns, controlled_by)
    - associate: Known associates
    """

    __tablename__ = "entity_relationships"
    __table_args__ = (
        UniqueConstraint(
            "from_entity_id",
            "to_entity_id",
            "relationship_type",
            name="uq_entity_relationship",
        ),
    )

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Foreign keys
    from_entity_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("opensanctions_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    to_entity_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("opensanctions_entities.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Relationship classification
    relationship_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # family, business, ownership, associate
    relationship_subtype: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Relationship metadata
    relationship_properties: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    confidence: Mapped[Optional[float]] = mapped_column(
        Numeric(3, 2), nullable=True, index=True
    )

    # Source attribution
    source_datasets: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(TEXT), nullable=True
    )

    # Timestamps
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Relationships
    from_entity: Mapped["OpenSanctionsEntity"] = relationship(
        "OpenSanctionsEntity",
        foreign_keys=[from_entity_id],
        back_populates="relationships_from"
    )
    to_entity: Mapped["OpenSanctionsEntity"] = relationship(
        "OpenSanctionsEntity",
        foreign_keys=[to_entity_id],
        back_populates="relationships_to"
    )

    def __repr__(self) -> str:
        return f"<EntityRelationship(from={self.from_entity_id}, to={self.to_entity_id}, type={self.relationship_type})>"
