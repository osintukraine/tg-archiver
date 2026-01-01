"""
Shadow Account State Model - Tracks channel sync state for shadow accounts.

Each shadow account mirrors the channel subscriptions of its primary account.
This table tracks which channels each shadow account has joined.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .channel import Channel
    from .telegram_account import TelegramAccount


class ShadowAccountState(Base):
    """
    Tracks which channels each shadow account has joined.

    Sync Status:
    - pending: Channel needs to be joined on shadow account
    - synced: Channel is joined and in the correct folder
    - failed: Join attempt failed (see error_message)

    The shadow sync service uses this table to:
    1. Detect channels that need to be joined (pending)
    2. Track successful syncs (synced)
    3. Retry failed joins with exponential backoff (failed + retry_count)
    """

    __tablename__ = "shadow_account_state"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True)

    # Foreign keys
    channel_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True
    )
    shadow_account: Mapped[str] = mapped_column(
        String(50),
        ForeignKey("telegram_accounts.name", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Sync state
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    folder_synced: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # Last synced folder name
    sync_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )  # 'synced', 'pending', 'failed'
    last_sync_attempt: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Unique constraint: one record per channel per shadow account
    __table_args__ = (
        UniqueConstraint("channel_id", "shadow_account", name="uq_shadow_state_channel_account"),
    )

    # Relationships
    channel: Mapped["Channel"] = relationship("Channel", foreign_keys=[channel_id])
    account: Mapped["TelegramAccount"] = relationship(
        "TelegramAccount",
        back_populates="shadow_states",
        foreign_keys=[shadow_account],
        primaryjoin="ShadowAccountState.shadow_account == TelegramAccount.name",
    )

    def __repr__(self) -> str:
        return f"<ShadowAccountState(channel_id={self.channel_id}, shadow_account={self.shadow_account}, status={self.sync_status})>"

    @property
    def needs_sync(self) -> bool:
        """Check if this channel needs to be synced to the shadow account."""
        return self.sync_status == "pending"

    @property
    def is_synced(self) -> bool:
        """Check if this channel is fully synced."""
        return self.sync_status == "synced"

    @property
    def has_failed(self) -> bool:
        """Check if sync has failed."""
        return self.sync_status == "failed"
