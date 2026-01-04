"""
ForwardComment Model - Comments on original messages.

Stores comments fetched from the original message in a forward source channel.
"""

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .message_forward import MessageForward


class ForwardComment(Base):
    """
    Comment on an original message (from forward source channel).

    Similar to MessageComment but for original messages we don't archive.
    """

    __tablename__ = "forward_comments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    message_forward_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("message_forwards.id", ondelete="CASCADE"), nullable=False, index=True
    )

    comment_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    discussion_chat_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    author_user_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    author_username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    author_first_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    content_translated: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    language_detected: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)

    reply_to_comment_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    comment_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    message_forward: Mapped["MessageForward"] = relationship(
        "MessageForward", back_populates="comments"
    )

    def __repr__(self) -> str:
        content_preview = (self.content or "")[:30]
        return f"<ForwardComment(id={self.comment_id}, content='{content_preview}...')>"

    @property
    def display_content(self) -> str:
        """Get the best content for display (translated if available)."""
        return self.content_translated or self.content or ""

    @property
    def author_display_name(self) -> str:
        """Get a display name for the author."""
        if self.author_username:
            return f"@{self.author_username}"
        if self.author_first_name:
            return self.author_first_name
        if self.author_user_id:
            return f"User {self.author_user_id}"
        return "Anonymous"
