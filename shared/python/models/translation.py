"""
Translation Configuration and Usage Tracking

Supports per-channel or global translation configuration.
Tracks translation API usage and costs.
"""

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class TranslationConfig(Base):
    """
    Translation configuration (per-channel or global).

    If channel_id is NULL, this is the global default configuration.
    Channel-specific configs override the global default.
    """

    __tablename__ = "translation_config"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True)

    # Scope (NULL = global default, otherwise channel-specific)
    channel_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("channels.id", ondelete="CASCADE"),
        nullable=True,
        unique=True,  # One config per channel
    )

    # Translation settings
    enabled: Mapped[bool] = mapped_column(default=False, nullable=False)
    provider: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # 'google', 'deepl', 'manual'
    target_language: Mapped[str] = mapped_column(String(10), default="en", nullable=False)

    # Provider authentication (encrypted in production)
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=True)
    daily_budget_usd: Mapped[float] = mapped_column(Numeric(10, 2), nullable=True)

    # Language filtering (NULL = translate all)
    translate_from_languages: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=True
    )  # ['ru', 'uk']

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        scope = f"channel_{self.channel_id}" if self.channel_id else "global"
        return f"<TranslationConfig({scope}, provider={self.provider}, enabled={self.enabled})>"


class TranslationUsage(Base):
    """
    Daily translation API usage and cost tracking.

    Helps monitor translation costs and stay within budget.
    """

    __tablename__ = "translation_usage"
    __table_args__ = (UniqueConstraint("date", "provider", name="uq_usage_date_provider"),)

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True)

    # Usage date and provider
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(20), nullable=False, index=True)

    # Usage metrics
    characters_translated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 4), nullable=True)
    message_count: Mapped[int] = mapped_column(Integer, nullable=True)

    def __repr__(self) -> str:
        return f"<TranslationUsage(date={self.date}, provider={self.provider}, chars={self.characters_translated}, cost=${self.cost_usd})>"
