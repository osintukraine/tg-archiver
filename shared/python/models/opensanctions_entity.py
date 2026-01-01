"""
OpenSanctions Entity Model - Entities as first-class intelligence objects
"""

from datetime import datetime, date
from typing import Optional, List

from sqlalchemy import (
    Integer,
    String,
    Text,
    DateTime,
    Date,
    CheckConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from .base import Base


class OpenSanctionsEntity(Base):
    """
    Entity from OpenSanctions API (people, organizations, vessels, etc.)

    Entities are first-class objects with:
    - Semantic embeddings for similarity search
    - Relationship graphs (family, business, ownership)
    - Activity tracking (mentions, timeline)
    """

    __tablename__ = "opensanctions_entities"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # External identifiers
    opensanctions_id: Mapped[str] = mapped_column(
        String(255), unique=True, nullable=False, index=True
    )
    external_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Entity classification
    entity_type: Mapped[str] = mapped_column(
        String(50), nullable=False, index=True
    )  # Person, Organization, Vessel
    schema_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Names
    name: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    aliases: Mapped[Optional[List[str]]] = mapped_column(ARRAY(Text), nullable=True)

    # Description and metadata
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    properties: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)

    # Risk classification
    risk_classification: Mapped[str] = mapped_column(
        String(20),
        CheckConstraint(
            "risk_classification IN ('sanctioned', 'pep', 'criminal', 'corporate')",
            name="risk_classification_check",
        ),
        nullable=False,
        index=True,
    )
    datasets: Mapped[List[str]] = mapped_column(ARRAY(Text), nullable=False)
    topics: Mapped[Optional[List[str]]] = mapped_column(ARRAY(Text), nullable=True)

    # Sanctions-specific
    sanctions_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sanctions_effective_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    sanctions_lifted_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Semantic search (pgvector)
    entity_embedding: Mapped[Optional[Vector]] = mapped_column(
        Vector(384), nullable=True
    )  # 384-dimensional embeddings
    embedding_model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    embedding_generated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Tracking metrics
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), index=True
    )
    mention_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1", index=True
    )

    # Data freshness
    data_updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    # NOTE: OpenSanctions entities use a separate junction table (opensanctions_message_entities)
    # message_entities is reserved for curated_entities only

    # Entity relationship graph navigation
    relationships_from: Mapped[List["EntityRelationship"]] = relationship(
        "EntityRelationship",
        foreign_keys="[EntityRelationship.from_entity_id]",
        back_populates="from_entity",
        cascade="all, delete-orphan"
    )
    relationships_to: Mapped[List["EntityRelationship"]] = relationship(
        "EntityRelationship",
        foreign_keys="[EntityRelationship.to_entity_id]",
        back_populates="to_entity",
        cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<OpenSanctionsEntity(id={self.id}, name='{self.name}', risk={self.risk_classification})>"
