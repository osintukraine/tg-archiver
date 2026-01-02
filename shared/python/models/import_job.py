"""
Import Job Models - Channel import job tracking

Import jobs support:
- CSV/JSON file upload with channel URLs
- Validation of channel accessibility
- Batch joining of channels via Telegram
- Progress tracking with detailed per-channel status
- Event logging for audit trail
"""

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Optional

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from typing import List


class ImportJob(Base):
    """
    Background import job for batch channel imports.

    Workflow:
    1. uploading: File being uploaded
    2. validating: Channels being validated for accessibility
    3. ready: Validation complete, awaiting user confirmation
    4. processing: Channels being joined
    5. completed: All channels processed
    6. failed: Job failed with error
    7. cancelled: Job cancelled by user
    """

    __tablename__ = "import_jobs"

    # Primary key
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    # Job identification
    filename: Mapped[str] = mapped_column(String(255), nullable=False)

    # Job state
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="uploading"
    )  # uploading, validating, ready, processing, completed, failed, cancelled

    # Progress tracking
    total_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    validated_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    joined_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Timing
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Audit
    created_by_ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Relationships
    channels: Mapped["List[ImportJobChannel]"] = relationship(
        "ImportJobChannel",
        back_populates="import_job",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    logs: Mapped["List[ImportJobLog]"] = relationship(
        "ImportJobLog",
        back_populates="import_job",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return (
            f"<ImportJob(id={self.id}, filename={self.filename}, "
            f"status={self.status}, progress={self.progress_percent:.1f}%)>"
        )

    @property
    def progress_percent(self) -> float:
        """Calculate progress as percentage of processed channels."""
        if self.total_channels == 0:
            return 0.0
        processed = self.joined_channels + self.failed_channels + self.skipped_channels
        return (processed / self.total_channels) * 100


class ImportJobChannel(Base):
    """
    Individual channel within an import job.

    Status workflow:
    1. pending: Initial state after parsing
    2. validating: Being checked for accessibility
    3. validated: Validation successful
    4. queued: Selected for joining, waiting in queue
    5. joining: Currently being joined
    6. joined: Successfully joined
    7. failed: Failed to join (with error details)
    8. skipped: User chose to skip or already exists
    """

    __tablename__ = "import_job_channels"

    # Primary key
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    # Foreign key to import job
    import_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("import_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Channel identification
    channel_url: Mapped[str] = mapped_column(String(255), nullable=False)
    channel_username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    channel_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Target configuration
    target_folder: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Channel state
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )  # pending, validating, validated, queued, joining, joined, failed, skipped

    # Validation results (populated during validation phase)
    validation_data: Mapped[Optional[dict[str, Any]]] = mapped_column(
        JSONB, nullable=True
    )
    # Example validation_data:
    # {
    #     "telegram_id": 123456789,
    #     "title": "Channel Name",
    #     "username": "channelname",
    #     "subscribers_count": 50000,
    #     "is_public": true,
    #     "already_member": false,
    #     "already_in_db": false
    # }

    # Error handling
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    # Selection (user can deselect channels before processing)
    selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Timing
    queued_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    joined_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Retry tracking
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Created timestamp
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )

    # Relationships
    import_job: Mapped["ImportJob"] = relationship(
        "ImportJob", back_populates="channels"
    )

    def __repr__(self) -> str:
        return (
            f"<ImportJobChannel(id={self.id}, url={self.channel_url}, "
            f"status={self.status})>"
        )


class ImportJobLog(Base):
    """
    Event log entry for import job operations.

    Provides audit trail for:
    - Job lifecycle events (created, started, completed)
    - Per-channel events (validation, joining, errors)
    - System events (rate limits, retries)
    """

    __tablename__ = "import_job_logs"

    # Primary key (BigInteger for high-volume logging)
    id: Mapped[int] = mapped_column(
        BigInteger, primary_key=True, autoincrement=True
    )

    # Foreign key to import job
    import_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("import_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Optional foreign key to specific channel
    channel_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("import_job_channels.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Event details
    event_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # info, warning, error, success

    event_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # Example event codes:
    # - JOB_CREATED, JOB_STARTED, JOB_COMPLETED
    # - CHANNEL_VALIDATED, CHANNEL_JOINED, CHANNEL_FAILED
    # - RATE_LIMITED, RETRY_SCHEDULED

    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )

    # Relationships
    import_job: Mapped["ImportJob"] = relationship(
        "ImportJob", back_populates="logs"
    )

    def __repr__(self) -> str:
        return (
            f"<ImportJobLog(id={self.id}, type={self.event_type}, "
            f"code={self.event_code})>"
        )
