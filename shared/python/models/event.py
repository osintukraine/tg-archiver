"""
Event Model - Represents a real-world event detected from RSS and Telegram.

Events are seeded from RSS articles and expanded by linking related Telegram messages.
Uses events and event_messages tables.
"""

from datetime import date, datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .message import Message


class Event(Base):
    """
    Event model for RSS-seeded event detection (V2 architecture).

    Events are created from RSS articles and linked to Telegram messages
    that discuss the same real-world incident.
    """

    __tablename__ = "events"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Event content
    title: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)

    # Location
    location_name: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # location_coords is POINT type - handled separately if needed

    # Temporal
    event_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Status
    tier_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="breaking"
    )
    is_major: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    archived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Aggregated statistics (trigger-maintained)
    rss_source_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    telegram_channel_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    telegram_message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Full-text search
    search_vector: Mapped[Optional[str]] = mapped_column(TSVECTOR, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    # Soft delete audit trail
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    deletion_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    message_links: Mapped[list["EventMessage"]] = relationship(
        "EventMessage",
        back_populates="event",
        cascade="all, delete-orphan",
    )
    source_links: Mapped[list["EventSource"]] = relationship(
        "EventSource",
        back_populates="event",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<Event(id={self.id}, title='{self.title[:50] if self.title else ''}', tier='{self.tier_status}')>"


class EventMessage(Base):
    """
    Junction table linking Telegram messages to events (V2).

    Created when a message is matched to an event via LLM verification.
    """

    __tablename__ = "event_messages"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Foreign keys
    event_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    message_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    channel_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("channels.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Match metadata
    match_confidence: Mapped[Optional[float]] = mapped_column(Numeric(4, 3), nullable=True)
    match_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Audit
    matched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Soft unlink audit trail
    unlinked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    unlinked_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    unlink_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    event: Mapped["Event"] = relationship("Event", back_populates="message_links")
    message: Mapped["Message"] = relationship("Message", back_populates="event_links")

    def __repr__(self) -> str:
        return f"<EventMessage(event_id={self.event_id}, message_id={self.message_id}, confidence={self.match_confidence})>"


class EventSource(Base):
    """
    Junction table linking RSS articles to events (V2).

    Created when an RSS article seeds or validates an event.
    """

    __tablename__ = "event_sources"

    # Primary key
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Foreign keys
    event_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("events.id", ondelete="CASCADE"),
        nullable=False,
    )
    rss_article_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("external_news.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Source metadata
    is_primary_source: Mapped[bool] = mapped_column(Boolean, default=False)

    # Audit
    linked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    # Soft unlink audit trail
    unlinked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    unlinked_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    unlink_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    event: Mapped["Event"] = relationship("Event", back_populates="source_links")

    def __repr__(self) -> str:
        return f"<EventSource(event_id={self.event_id}, article_id={self.rss_article_id}, primary={self.is_primary_source})>"
