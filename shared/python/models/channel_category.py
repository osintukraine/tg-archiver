"""
ChannelCategory Model - Categories for organizing channels

Simple categorization system for channels (e.g., "News", "Technology", "Community").
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class ChannelCategory(Base):
    """Category for organizing channels."""

    __tablename__ = "channel_categories"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Category info
    name: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    color: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, server_default="gray"
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[Optional[int]] = mapped_column(
        Integer, nullable=True, server_default="0"
    )

    # Timestamps
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

    # Relationships
    channels: Mapped[list["Channel"]] = relationship(
        "Channel", back_populates="category"
    )

    def __repr__(self) -> str:
        return f"<ChannelCategory(id={self.id}, name={self.name})>"
