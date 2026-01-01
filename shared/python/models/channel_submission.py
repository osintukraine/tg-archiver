"""
Channel Submission Model - User-suggested channels for admin review.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import INET, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ChannelSubmission(Base):
    """
    User-submitted channel suggestion awaiting admin review.

    Workflow:
    - User submits via /suggest-channel form
    - Admin reviews in /admin/channels → Submissions tab
    - Accept: joins channel, assigns to folder
    - Reject: marks rejected with optional reason
    """

    __tablename__ = "channel_submissions"

    id: Mapped[int] = mapped_column(primary_key=True)

    # Submission data
    channel_link: Mapped[str] = mapped_column(String(255), nullable=False)
    channel_name: Mapped[str] = mapped_column(String(255), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    value_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_origin: Mapped[str] = mapped_column(String(20), nullable=False)  # ua, ru, unknown

    # Submitter info
    submitted_by_user_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    submitted_by_ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)

    # Review workflow
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, accepted, rejected
    assigned_folder: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    rejection_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_by_user_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Tracking
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Link to joined channel
    joined_channel_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    @property
    def default_folder(self) -> str:
        """Get default folder based on source origin."""
        folder_map = {
            'ua': 'Discover-UA',
            'ru': 'Discover-RU',
            'unknown': 'Discover-?',
        }
        return folder_map.get(self.source_origin, 'Discover-?')

    @property
    def target_folder(self) -> str:
        """Get assigned folder or default based on origin."""
        return self.assigned_folder or self.default_folder

    def __repr__(self) -> str:
        return f"<ChannelSubmission(id={self.id}, link={self.channel_link}, status={self.status})>"
