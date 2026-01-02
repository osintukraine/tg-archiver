"""
Monitored Folder Model - Extends folder-based channel discovery

Allows import feature to add folders beyond the env-configured pattern.
ChannelDiscovery queries this table alongside FOLDER_ARCHIVE_ALL_PATTERN.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class MonitoredFolder(Base):
    """
    Tracked Telegram folders for channel discovery.

    Extends the env-based FOLDER_ARCHIVE_ALL_PATTERN to support
    dynamically added folders from the import feature.
    """

    __tablename__ = "monitored_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Folder identification
    folder_name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    telegram_folder_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Processing rule
    rule: Mapped[str] = mapped_column(String(50), nullable=False, default="archive_all")

    # State
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Audit
    created_via: Mapped[str] = mapped_column(
        String(20), nullable=False, default="import"
    )  # env_config, import, manual
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<MonitoredFolder(id={self.id}, name='{self.folder_name}', rule='{self.rule}')>"
