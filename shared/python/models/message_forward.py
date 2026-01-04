"""
MessageForward Model - Links archived messages to their original sources.

Enables tracking forward chains and fetching social data from original messages.
"""

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .message import Message
    from .discovered_channel import DiscoveredChannel


class MessageForward(Base):
    """
    Links a forwarded message in our archive to its original source.

    This enables:
    1. Forward chain tracking (where did this content come from?)
    2. Social data fetching (reactions/comments on the original)
    3. Propagation timing analysis (how fast did content spread?)
    """

    __tablename__ = "message_forwards"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # The message in our archive (the forwarded copy)
    local_message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    # The original message (in the source channel)
    original_channel_id: Mapped[int] = mapped_column(BigInteger, nullable=False, index=True)
    original_message_id: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Reference to discovered channel (if we're tracking it)
    discovered_channel_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("discovered_channels.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Propagation timing
    original_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    forward_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    propagation_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Cached engagement from original
    original_views: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    original_forwards: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    original_reactions_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    original_comments_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    social_data_fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    local_message: Mapped["Message"] = relationship("Message", back_populates="forward_info")
    discovered_channel: Mapped[Optional["DiscoveredChannel"]] = relationship(
        "DiscoveredChannel", back_populates="forwards"
    )
    original_message: Mapped[Optional["OriginalMessage"]] = relationship(
        "OriginalMessage", back_populates="forward", uselist=False
    )
    reactions: Mapped[list["ForwardReaction"]] = relationship(
        "ForwardReaction", back_populates="message_forward", cascade="all, delete-orphan"
    )
    comments: Mapped[list["ForwardComment"]] = relationship(
        "ForwardComment", back_populates="message_forward", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<MessageForward(id={self.id}, local={self.local_message_id}, original={self.original_channel_id}/{self.original_message_id})>"

    @property
    def needs_social_fetch(self) -> bool:
        """Check if social data needs to be fetched."""
        return self.social_data_fetched_at is None

    def calculate_propagation(self) -> Optional[int]:
        """Calculate propagation time in seconds."""
        if self.original_date and self.forward_date:
            delta = self.forward_date - self.original_date
            return int(delta.total_seconds())
        return None
