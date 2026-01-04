"""
ForwardReaction Model - Reactions on original messages.

Stores reactions fetched from the original message in a forward source channel.
"""

from datetime import datetime
from typing import Optional, TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base

if TYPE_CHECKING:
    from .message_forward import MessageForward


class ForwardReaction(Base):
    """
    Reaction on an original message (from forward source channel).

    Similar to MessageReaction but for original messages we don't archive.
    """

    __tablename__ = "forward_reactions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)

    message_forward_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("message_forwards.id", ondelete="CASCADE"), nullable=False, index=True
    )

    emoji: Mapped[str] = mapped_column(String(100), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    custom_emoji_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    message_forward: Mapped["MessageForward"] = relationship(
        "MessageForward", back_populates="reactions"
    )

    def __repr__(self) -> str:
        return f"<ForwardReaction(emoji={self.emoji}, count={self.count})>"
