"""
User Model - LEGACY local authentication (deprecated)

NOTE: This model is deprecated. New features should use kratos_identity_id
directly (UUID) to reference users, as seen in:
- user_roles
- user_bookmarks
- user_comments
- api_keys
- feed_tokens

This table remains for backwards compatibility with any legacy data.
"""

from datetime import datetime

from sqlalchemy import Boolean, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class User(Base):
    """
    LEGACY: System users for local authentication.

    Deprecated - use kratos_identity_id (UUID) for new features.
    """

    __tablename__ = "users"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True)

    # Authentication (legacy local auth)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)

    # User status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    last_login: Mapped[datetime] = mapped_column(nullable=True)

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username={self.username}, is_admin={self.is_admin})>"
