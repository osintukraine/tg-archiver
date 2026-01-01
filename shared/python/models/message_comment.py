"""
MessageComment model - Telegram comment/reply storage.

Stores comments from discussion groups linked to channel posts.
Includes translation support (free via Google Translate).
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MessageComment(Base):
    """
    Telegram comment/reply to a channel post.

    Comments are fetched from discussion groups linked to channels.
    Each channel post can have many comments from different users.
    Translation is handled via Google Translate (free tier).
    """

    __tablename__ = "message_comments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    parent_message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    comment_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    author_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )  # Telegram user ID - no FK since users may not be in our telegram_users table
    content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    telegram_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # Translation (free via Google Translate)
    translated_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    original_language: Mapped[Optional[str]] = mapped_column(String(10), nullable=True)
    translation_method: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    translation_confidence: Mapped[Optional[float]] = mapped_column(Numeric(3, 2), nullable=True)
    translated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Metadata
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_edited: Mapped[bool] = mapped_column(Boolean, default=False)
    edit_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    views: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    reactions_count: Mapped[int] = mapped_column(Integer, default=0)
    replies_count: Mapped[int] = mapped_column(Integer, default=0)

    # Threading
    reply_to_comment_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Timestamps
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    # Relationships
    parent_message = relationship("Message", back_populates="comments")

    def __repr__(self) -> str:
        return f"<MessageComment id={self.id} parent={self.parent_message_id} comment_id={self.comment_id}>"
