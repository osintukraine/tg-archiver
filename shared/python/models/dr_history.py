"""
Disaster Recovery History Models - Audit trail for backups and failovers.

Tracks all backup operations and failover events for compliance and debugging.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class DRBackupHistory(Base):
    """
    Audit trail of channel state backups to MinIO.

    Backup Types:
    - scheduled: Daily cron job backup
    - manual: Operator-triggered backup
    - pre_failover: Automatic backup before failover

    Status:
    - in_progress: Backup is running
    - completed: Backup succeeded
    - failed: Backup failed (see error_message)
    """

    __tablename__ = "dr_backup_history"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True)

    # Backup details
    backup_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # 'scheduled', 'manual', 'pre_failover'
    storage_path: Mapped[str] = mapped_column(
        String(255), nullable=False
    )  # MinIO path: channel-state/2025/12/20/...
    channels_exported: Mapped[int] = mapped_column(Integer, nullable=False)
    accounts_exported: Mapped[int] = mapped_column(Integer, nullable=False)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Timing
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    duration_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Status
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="in_progress", index=True
    )  # 'in_progress', 'completed', 'failed'
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Metadata
    triggered_by: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )  # 'cron', 'api', 'failover'
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:
        return f"<DRBackupHistory(id={self.id}, type={self.backup_type}, status={self.status})>"

    @property
    def is_complete(self) -> bool:
        """Check if backup completed successfully."""
        return self.status == "completed"

    @property
    def is_failed(self) -> bool:
        """Check if backup failed."""
        return self.status == "failed"


class DRFailoverHistory(Base):
    """
    Audit trail of account failover events.

    Trigger Types:
    - auto: Automatic failover from health monitor
    - manual: Operator-triggered failover
    - test: Test failover (no actual switch)

    Status:
    - initiated: Failover started
    - completed: Failover succeeded
    - failed: Failover failed (see error_message)
    - rolled_back: Failover was rolled back
    """

    __tablename__ = "dr_failover_history"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True)

    # Cluster
    cluster: Mapped[str] = mapped_column(
        String(20), nullable=False, index=True
    )  # 'russia', 'ukraine', 'default'

    # Account transition
    from_account: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # Account being replaced
    to_account: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # Account taking over

    # Trigger info
    trigger_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # 'auto', 'manual', 'test'
    trigger_reason: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # 'ban_detected', 'health_check_failed', etc.

    # Timing
    initiated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Status
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="initiated", index=True
    )  # 'initiated', 'completed', 'failed', 'rolled_back'
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Context
    channels_affected: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    backup_created: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    backup_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Who triggered it
    triggered_by: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )  # 'system', 'user:rick', etc.

    def __repr__(self) -> str:
        return f"<DRFailoverHistory(id={self.id}, cluster={self.cluster}, {self.from_account} -> {self.to_account}, status={self.status})>"

    @property
    def is_complete(self) -> bool:
        """Check if failover completed successfully."""
        return self.status == "completed"

    @property
    def is_failed(self) -> bool:
        """Check if failover failed."""
        return self.status == "failed"

    @property
    def was_rolled_back(self) -> bool:
        """Check if failover was rolled back."""
        return self.status == "rolled_back"
