"""
MessageReaction model - Telegram message reactions.

Stores reaction data (emoji + count) for messages.
Supports both standard emoji and custom emoji reactions.
Historical snapshots allow tracking reaction changes over time.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MessageReaction(Base):
    """
    Telegram reaction on a message.

    Each row represents a reaction type (emoji) with its count at a point in time.
    Multiple rows per message allow tracking different emoji types.
    Historical snapshots (same message_id + emoji, different timestamps) track changes.

    Telegram reaction types:
    - Standard emoji: "👍", "❤️", "🔥", etc.
    - Custom emoji: stored as "custom:document_id"
    - Paid reactions (Stars): stored as "⭐" with count = star amount
    """

    __tablename__ = "message_reactions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Foreign key to message
    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Reaction data
    emoji: Mapped[str] = mapped_column(
        String(100), nullable=False
    )  # Emoji string or "custom:doc_id"
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # For custom emoji reactions
    custom_emoji_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Tracking
    last_updated: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    first_seen: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    message: Mapped["Message"] = relationship("Message", back_populates="reactions")

    def __repr__(self) -> str:
        return f"<MessageReaction message_id={self.message_id} emoji={self.emoji} count={self.count}>"
