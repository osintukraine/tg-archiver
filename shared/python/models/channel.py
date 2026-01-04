"""
Channel Model - Telegram channels being monitored

Supports folder-based channel management - channels are discovered from
Telegram folders and automatically synced to the database.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Channel(Base):
    """
    Telegram channels being monitored.

    Channels are discovered from Telegram folders using the ChannelDiscovery service.
    Folder names map to processing rules (archive_all, selective_archive, etc.).
    """

    __tablename__ = "channels"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True)

    # Telegram identifiers
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True, index=True)
    access_hash: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Channel metadata (from Telegram API)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Channel type and verification
    type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="source"
    )  # 'source', 'filtered', 'archive'
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    scam: Mapped[bool] = mapped_column(Boolean, default=False)
    fake: Mapped[bool] = mapped_column(Boolean, default=False)
    restricted: Mapped[bool] = mapped_column(Boolean, default=False)

    # Category reference
    category_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("channel_categories.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Folder-based management (see TELEGRAM_FOLDER_BASED_CHANNEL_MANAGEMENT.md)
    folder: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, index=True
    )  # Telegram folder name
    rule: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )  # 'archive_all', 'selective_archive', 'test', 'staging'

    # Multi-account session management
    source_account: Mapped[str] = mapped_column(
        String(50), nullable=False, default="default", index=True
    )

    # Channel status
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    removed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # How the channel was added
    source: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, default="folder_discovery", index=True
    )  # 'folder_discovery', 'admin_promotion', 'manual'

    # Historical backfill tracking
    backfill_status: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, index=True
    )  # 'pending', 'in_progress', 'completed', 'failed'
    backfill_from_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    backfill_messages_fetched: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=0)
    backfill_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Channel discovery tracking
    discovery_status: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )
    discovery_metadata: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, default=dict
    )
    quality_metrics: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, default=dict
    )

    # Retention policy
    retention_policy: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, default="permanent", index=True
    )
    removal_scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    removal_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Invite link for private channels
    invite_link: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    invite_link_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    # Relationships
    category: Mapped[Optional["ChannelCategory"]] = relationship(
        "ChannelCategory", back_populates="channels"
    )
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="channel", cascade="all, delete-orphan"
    )
    quarantined_messages: Mapped[list["MessageQuarantine"]] = relationship(
        "MessageQuarantine", back_populates="channel", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Channel(id={self.id}, name={self.name}, folder={self.folder}, rule={self.rule})>"
