"""Curated Entity model - Entity Knowledge Graph."""

from datetime import datetime
from typing import Dict, List, Optional

from pgvector.sqlalchemy import Vector
from sqlalchemy import ARRAY, CheckConstraint, Computed, Float, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base


class CuratedEntity(Base):
    """
    Curated entities from various sources (CSV imports, analyst-created, etc.).

    This is the main entity knowledge graph table that stores:
    - Equipment (military hardware, weapons)
    - Individuals (sanctions, designations)
    - Organizations (companies, groups)
    - Locations (cities, regions, coordinates)
    - Events (battles, operations)
    - Military units (brigades, battalions)
    - Ships and aircraft

    All entities have:
    - Semantic search via pgvector embeddings
    - Full-text search via tsvector
    - Deduplication via content_hash
    - Source tracking for provenance
    """

    __tablename__ = "curated_entities"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    # Entity classification
    entity_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        index=True
    )

    # Core fields
    name: Mapped[str] = mapped_column(Text, nullable=False)
    aliases: Mapped[Optional[List[str]]] = mapped_column(ARRAY(Text), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Geolocation (for locations)
    latitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Source tracking (provenance)
    source_reference: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        index=True,
        comment="Source identifier: 'armyguide', 'odin_sanctions', 'root_nk_database', etc."
    )

    metadata_: Mapped[Dict] = mapped_column(
        "metadata",  # Column name in database
        JSONB,
        nullable=False,
        default=dict,
        server_default="'{}'::jsonb",
        comment="Original source data preserved as JSONB"
    )

    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Deduplication
    content_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
        comment="SHA-256 hash of name + source_reference for deduplication"
    )

    # Semantic search (384-dim embeddings)
    embedding: Mapped[Optional[List[float]]] = mapped_column(
        Vector(384),
        nullable=True,
        comment="384-dimensional embedding from sentence-transformers"
    )

    embedding_model: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
        comment="Model used to generate embedding (e.g., 'all-MiniLM-L6-v2')"
    )

    # Full-text search (generated column)
    search_vector: Mapped[Optional[str]] = mapped_column(
        TSVECTOR,
        Computed(
            """
            setweight(to_tsvector('english', name), 'A') ||
            setweight(to_tsvector('english', COALESCE(description, '')), 'B')
            """,
            persisted=True
        ),
        nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=func.now()
    )

    updated_at: Mapped[datetime] = mapped_column(
        nullable=False,
        server_default=func.now(),
        onupdate=func.now()
    )

    # Relationships
    message_matches: Mapped[list["MessageEntity"]] = relationship(
        "MessageEntity",
        back_populates="entity",
        cascade="all, delete-orphan"
    )

    # Check constraints
    __table_args__ = (
        CheckConstraint(
            entity_type.in_([
                'equipment', 'individual', 'organization', 'location',
                'event', 'military_unit', 'ship', 'aircraft'
            ]),
            name='valid_entity_type'
        ),
        Index('idx_curated_entities_search', 'search_vector', postgresql_using='gin'),
        Index(
            'idx_curated_entities_embedding',
            'embedding',
            postgresql_using='ivfflat',
            postgresql_with={'lists': 100},
            postgresql_ops={'embedding': 'vector_cosine_ops'}
        ),
    )

    def __repr__(self) -> str:
        return f"<CuratedEntity(id={self.id}, type={self.entity_type}, name='{self.name}')>"
