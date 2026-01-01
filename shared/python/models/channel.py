"""
Channel Model - Telegram channels being monitored

Supports folder-based channel management - channels are discovered from
Telegram folders and automatically synced to the database.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, String, Text, func
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

    # Channel source categorization (human-managed via NocoDB)
    # source_type: What kind of source is this channel?
    #   state_media: Official government media (mod_russia, NSDC_ua)
    #   military_unit: Official military unit channels (specific brigades, battalions)
    #   military_official: Military officials/commanders (personal channels)
    #   government_official: Politicians, ministers (official accounts)
    #   journalist: Independent journalists, war correspondents
    #   osint_aggregator: OSINT analysis channels (DeepState, DefMon)
    #   news_aggregator: General news aggregators
    #   personality: Influencers, commentators, bloggers (Sternenko, etc.)
    #   regional: Regional/local news channels
    #   militant: Armed group channels (not official military)
    #   unknown: Uncategorized (default - work queue for NocoDB)
    source_type: Mapped[Optional[str]] = mapped_column(
        String(30), nullable=True, index=True
    )  # NULL = uncategorized (NocoDB work queue)

    # affiliation: Which side does this channel represent?
    #   russia: Pro-Russian sources
    #   ukraine: Pro-Ukrainian sources
    #   neutral: International/neutral observers
    #   unknown: Not yet categorized
    affiliation: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, index=True
    )  # NULL = uncategorized

    # Folder-based management (see TELEGRAM_FOLDER_BASED_CHANNEL_MANAGEMENT.md)
    folder: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True, index=True
    )  # Telegram folder name
    rule: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )  # 'archive_all', 'selective_archive', 'test', 'staging'

    # Multi-account session management
    # Tracks which Telegram account monitors this channel (for enrichment routing)
    source_account: Mapped[str] = mapped_column(
        String(50), nullable=False, default="default", index=True
    )  # 'default', 'russia', 'ukraine', etc.

    # Channel status
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    removed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Historical backfill tracking
    backfill_status: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, index=True
    )  # 'pending', 'in_progress', 'completed', 'failed'
    backfill_from_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    backfill_messages_fetched: Mapped[Optional[int]] = mapped_column(nullable=True, default=0)
    backfill_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Intelligent channel discovery (auto-join + quality evaluation)
    discovery_status: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, index=True
    )  # 'discovered', 'evaluating', 'promoted', 'rejected', null
    discovery_metadata: Mapped[Optional[dict]] = mapped_column(
        JSONB, nullable=True, default=dict
    )  # auto_joined_at, discovered_via_forward, probation dates
    quality_metrics: Mapped[Optional[dict]] = mapped_column(
        JSONB,
        nullable=True,
        default=lambda: {
            "total_messages_received": 0,
            "spam_messages": 0,
            "off_topic_messages": 0,
            "high_quality_messages": 0,
            "spam_rate": 0.0,
            "off_topic_rate": 0.0,
        },
    )

    # Retention policy (for discovered channels)
    retention_policy: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True, default="permanent", index=True
    )  # 'permanent', 'temporary', 'scheduled_removal'
    removal_scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    removal_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Disaster recovery (for private channel rejoin)
    invite_link: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # Telegram invite link for private channels (t.me/+ABC123)
    invite_link_updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )  # When the invite link was last validated

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    last_message_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    # Relationships
    messages: Mapped[list["Message"]] = relationship(
        "Message", back_populates="channel", cascade="all, delete-orphan"
    )
    quarantined_messages: Mapped[list["MessageQuarantine"]] = relationship(
        "MessageQuarantine", back_populates="channel", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Channel(id={self.id}, name={self.name}, source_type={self.source_type}, affiliation={self.affiliation})>"
