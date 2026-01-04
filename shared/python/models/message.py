"""
Message Model - Telegram messages

Messages include:
- Language detection and translation
- Topic classification
- Entity extraction (regex-based)
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship
# Removed for tg-archiver (no embeddings)
# from pgvector.sqlalchemy import Vector

from .base import Base


class Message(Base):
    """
    Telegram messages with optional translation.

    Processing flow:
    1. Language detection
    2. Translation (if needed and enabled)
    3. Media archival (content-addressed storage)
    4. Topic classification
    5. Entity extraction
    """

    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint('channel_id', 'message_id', name='uq_messages_channel_message'),
    )

    # Primary key (auto-increment database ID)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Telegram identifiers
    message_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    channel_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Message content (original)
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    telegram_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    # Engagement metrics (from Telegram)
    views: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    forwards: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)

    # Language detection
    language_detected: Mapped[Optional[str]] = mapped_column(
        String(10), nullable=True
    )  # 'en', 'ru', 'uk', etc.

    # Translation (optional per message)
    content_translated: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    translation_target: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    translation_provider: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # 'deepl', 'google', 'manual'
    translation_timestamp: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    translation_cost_usd: Mapped[Optional[float]] = mapped_column(Numeric(10, 6), nullable=True)

    # Media handling
    media_type: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # 'photo', 'video', 'document', etc.
    media_url_telegram: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # Original Telegram URL (for debugging)

    # Grouped messages (media albums) - multiple photos/videos in one post
    grouped_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True, index=True
    )  # Telegram's grouped_id for media albums

    # Hidden messages (admin moderation)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    # Admin overrides
    admin_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Topic classification (references message_topics.name)
    topic: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )

    # Entity extraction (regex-based: hashtags, mentions, URLs)
    entities: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True
    )

    # Selective archival metadata
    archive_triggered_by: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    archive_triggered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    archive_priority: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Historical backfill tracking
    is_backfilled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", index=True
    )  # True if message came from backfill vs live
    media_was_available: Mapped[Optional[bool]] = mapped_column(
        Boolean, nullable=True
    )  # Track if media existed on Telegram (for ephemeral media)
    media_expired_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # When media URL expired (if known)

    # Social graph metadata (for network analysis)
    author_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )  # References telegram_users.telegram_id
    replied_to_message_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )  # Self-referential: parent message in thread
    forward_from_channel_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )  # Original channel if forwarded
    forward_from_message_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )  # Original message_id if forwarded
    forward_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # When original was posted

    # Comments/Discussion (Telegram's discussion feature)
    has_comments: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False
    )
    comments_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )
    linked_chat_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )  # Discussion group linked to this message
    comments_fetched_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # First time comments were fetched (one-time backfill)
    comments_refreshed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # Last time comments were re-polled (realtime refresh)

    # Full-text search vector (auto-populated by database trigger)
    search_vector: Mapped[Optional[str]] = mapped_column(TSVECTOR, nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Message Authenticity Hashing (Phase 3)
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    metadata_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    hash_algorithm: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    hash_generated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    hash_version: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Relationships
    channel: Mapped["Channel"] = relationship("Channel", back_populates="messages", lazy="selectin")
    media: Mapped[list["MessageMedia"]] = relationship(
        "MessageMedia", back_populates="message", cascade="all, delete-orphan"
    )
    tags: Mapped[list["MessageTag"]] = relationship(
        "MessageTag", back_populates="message", cascade="all, delete-orphan"
    )
    # Comments from discussion groups
    comments: Mapped[list["MessageComment"]] = relationship(
        "MessageComment", back_populates="parent_message", cascade="all, delete-orphan"
    )
    # Reactions (emoji counts)
    reactions: Mapped[list["MessageReaction"]] = relationship(
        "MessageReaction", back_populates="message", cascade="all, delete-orphan"
    )
    # Forward chain tracking (if this message was forwarded from another channel)
    forward_info: Mapped[Optional["MessageForward"]] = relationship(
        "MessageForward", back_populates="local_message", uselist=False, cascade="all, delete-orphan"
    )

    @property
    def media_files(self) -> list:
        """
        Get all media files for this message.
        Returns list of MediaFile objects via MessageMedia junction table.
        """
        return [mm.media_file for mm in self.media]

    @property
    def media_urls(self) -> list[str]:
        """
        Get all media file URLs (S3 keys) for this message.
        Returns list of S3 keys that can be used to construct URLs.
        """
        return [mm.media_file.s3_key for mm in self.media]

    @property
    def first_media_url(self) -> Optional[str]:
        """
        Get the first media file URL for this message (for preview/thumbnail).
        Returns None if message has no media.
        """
        if self.media:
            return self.media[0].media_file.s3_key
        return None

    def __repr__(self) -> str:
        return f"<Message(id={self.id}, channel_id={self.channel_id}, message_id={self.message_id})>"
