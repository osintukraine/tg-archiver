"""
OriginalMessage Model - Cached content of original messages.

Stores the original message content as a leaf node in the social graph.
This is NOT a full archive - just the content for graph context.
"""

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .message_forward import MessageForward


class OriginalMessage(Base):
    """
    Cached content of an original message from a forward source channel.

    This stores just enough information to display the original message
    in the social graph context, without being a full archive entry.
    """

    __tablename__ = "original_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    # Link to forward tracking
    message_forward_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("message_forwards.id", ondelete="CASCADE"), nullable=False, unique=True
    )

    # Original message content
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_translated: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    language_detected: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    # Media summary (not the actual files - we don't download media from originals)
    has_media: Mapped[bool] = mapped_column(Boolean, default=False)
    media_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # photo, video, document
    media_count: Mapped[int] = mapped_column(Integer, default=0)

    # Author info
    author_user_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    author_username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Message metadata
    original_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    edit_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)

    # Engagement at fetch time
    views: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    forwards: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    has_comments: Mapped[bool] = mapped_column(Boolean, default=False)
    comments_count: Mapped[int] = mapped_column(Integer, default=0)

    # Fetch tracking
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    forward: Mapped["MessageForward"] = relationship("MessageForward", back_populates="original_message")

    def __repr__(self) -> str:
        return f"<OriginalMessage(id={self.id}, forward_id={self.message_forward_id})>"

    @property
    def display_content(self) -> str:
        """Get the best content for display (translated if available)."""
        return self.content_translated or self.content or ""

    @property
    def content_preview(self) -> str:
        """Get a short preview of the content."""
        content = self.display_content
        if len(content) > 100:
            return content[:100] + "..."
        return content
