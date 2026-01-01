"""
Telegram Account Model - Multi-account management for disaster recovery.

Tracks all Telegram accounts (primary + shadow) across clusters.
Supports automatic failover when primary accounts are banned.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .shadow_account_state import ShadowAccountState


class TelegramAccount(Base):
    """
    Registry of all Telegram accounts (primary + shadow) for disaster recovery.

    Account Roles:
    - active: Currently archiving messages for its cluster
    - standby: Ready to take over if active is banned (shadow accounts)
    - banned: Account has been banned by Telegram
    - disabled: Manually disabled by operator

    Clusters:
    - russia: Monitors Russian-language channels
    - ukraine: Monitors Ukrainian-language channels
    - default: Single-account mode (legacy/simple setups)
    """

    __tablename__ = "telegram_accounts"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True)

    # Account identification
    name: Mapped[str] = mapped_column(
        String(50), unique=True, nullable=False
    )  # 'russia-primary', 'russia-shadow', etc.
    cluster: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )  # 'russia', 'ukraine', 'default'
    phone: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # Phone number (for reference)

    # Telegram API credentials (stored in DB for convenience, but .session file is primary)
    api_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    api_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    session_file: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # Path to .session file

    # Role and priority
    role: Mapped[str] = mapped_column(
        String(20), nullable=False, default="standby", index=True
    )  # 'active', 'standby', 'banned', 'disabled'
    priority: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )  # Failover order within cluster (lower = higher priority)

    # Health tracking
    last_health_check: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    health_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="unknown"
    )  # 'healthy', 'unhealthy', 'banned'
    banned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ban_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Sync tracking (for shadow accounts)
    channels_synced: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_sync_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sync_errors: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    shadow_states: Mapped[list["ShadowAccountState"]] = relationship(
        "ShadowAccountState",
        back_populates="account",
        cascade="all, delete-orphan",
        foreign_keys="ShadowAccountState.shadow_account",
        primaryjoin="TelegramAccount.name == foreign(ShadowAccountState.shadow_account)",
    )

    def __repr__(self) -> str:
        return f"<TelegramAccount(name={self.name}, cluster={self.cluster}, role={self.role}, health={self.health_status})>"

    @property
    def is_active(self) -> bool:
        """Check if this account is the active one for its cluster."""
        return self.role == "active"

    @property
    def is_healthy(self) -> bool:
        """Check if this account is healthy and available for failover."""
        return self.health_status == "healthy" and self.role in ("active", "standby")

    @property
    def is_banned(self) -> bool:
        """Check if this account has been banned."""
        return self.role == "banned" or self.health_status == "banned"
