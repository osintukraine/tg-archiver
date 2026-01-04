"""
DiscoveredChannel Model - Channels discovered via message forwards.

These channels are auto-joined for social data fetching but NOT archived.
Admin can promote them to full archiving via the admin UI.
"""

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .user import User
    from .channel import Channel


class DiscoveredChannel(Base):
    """
    Channel discovered via message forwards.

    Workflow:
    1. Message forwarded from Channel X arrives in monitored channel
    2. Channel X is inserted into discovered_channels (status: pending)
    3. ChannelJoinWorker attempts to join Channel X
    4. If joined, SocialFetcher can fetch reactions/comments from originals
    5. Admin can promote to full archiving or mark as ignored
    """

    __tablename__ = "discovered_channels"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Telegram identifiers
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    access_hash: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Channel metadata (fetched when joining)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    participant_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    photo_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Channel flags
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    scam: Mapped[bool] = mapped_column(Boolean, default=False)
    fake: Mapped[bool] = mapped_column(Boolean, default=False)
    restricted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_private: Mapped[bool] = mapped_column(Boolean, default=False)
    has_link: Mapped[bool] = mapped_column(Boolean, default=False)

    # Discovery tracking
    discovered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    discovered_via_message_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    discovery_count: Mapped[int] = mapped_column(Integer, default=1)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Join status
    join_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )  # pending, joining, joined, private, failed, ignored
    join_attempted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    joined_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    join_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    join_retry_count: Mapped[int] = mapped_column(Integer, default=0)
    join_retry_after: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Social fetching
    social_fetch_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    social_fetch_last_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    social_messages_fetched: Mapped[int] = mapped_column(Integer, default=0)

    # Admin actions
    admin_action: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # promoted, ignored
    admin_action_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    admin_action_by: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=True
    )
    promoted_to_channel_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("channels.id"), nullable=True
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    admin_user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[admin_action_by])
    promoted_channel: Mapped[Optional["Channel"]] = relationship("Channel", foreign_keys=[promoted_to_channel_id])
    forwards: Mapped[list["MessageForward"]] = relationship(
        "MessageForward", back_populates="discovered_channel"
    )

    def __repr__(self) -> str:
        return f"<DiscoveredChannel(id={self.id}, name={self.name}, status={self.join_status})>"

    @property
    def can_fetch_social(self) -> bool:
        """Check if we can fetch social data from this channel."""
        return self.join_status == "joined" and self.social_fetch_enabled

    @property
    def display_name(self) -> str:
        """Human-readable channel name."""
        return self.name or self.username or f"Channel {self.telegram_id}"
