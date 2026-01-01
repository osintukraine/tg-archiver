"""
Media Models - Content-addressed storage with deduplication

Media files are stored using SHA-256 hashing for deduplication.
Multiple messages can reference the same media file (many-to-many).

This saves 30-40% storage costs by storing each unique file only once.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class MediaFile(Base):
    """
    Content-addressed media storage with Hetzner multi-box support.

    Files are stored using SHA-256 hash as the identifier.
    Deduplication: If the same file is posted multiple times,
    it's only stored once with multiple references.

    Storage flow:
    1. Download to local buffer (.tmp/)
    2. Atomic move to buffer path
    3. Queue sync job to Redis
    4. Background worker uploads to Hetzner/MinIO
    5. Update synced_at, clear local_path

    Storage path: media/{sha256[:2]}/{sha256[2:4]}/{sha256}.ext
    Example: media/ab/cd/abcdef123...789.jpg
    """

    __tablename__ = "media_files"

    # Primary key
    id: Mapped[int] = mapped_column(primary_key=True)

    # Content addressing (deduplication key)
    sha256: Mapped[str] = mapped_column(
        String(64), unique=True, nullable=False, index=True
    )  # SHA-256 hash

    # Storage location
    s3_key: Mapped[str] = mapped_column(
        Text, nullable=False
    )  # MinIO/S3 object key

    # Storage box routing (for multi-box Hetzner setup)
    storage_box_id: Mapped[Optional[str]] = mapped_column(
        String(50), ForeignKey("storage_boxes.id"), nullable=True, index=True
    )

    # File metadata
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)

    # Telegram source (for debugging/verification)
    telegram_file_id: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    telegram_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Deduplication tracking
    reference_count: Mapped[int] = mapped_column(
        Integer, default=1, nullable=False
    )  # How many messages reference this
    first_seen: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)

    # Sync status tracking (for local buffer -> Hetzner flow)
    synced_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True
    )  # NULL = pending sync to Hetzner
    local_path: Mapped[Optional[str]] = mapped_column(
        Text, nullable=True
    )  # Path in local buffer (until synced)

    # Cache warming / popularity tracking
    last_accessed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime, nullable=True
    )
    access_count: Mapped[int] = mapped_column(
        Integer, default=0, nullable=False
    )

    # Relationships
    messages: Mapped[list["MessageMedia"]] = relationship(
        "MessageMedia", back_populates="media_file", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<MediaFile(id={self.id}, sha256={self.sha256[:16]}..., references={self.reference_count})>"


class MessageMedia(Base):
    """
    Many-to-many relationship between messages and media files.

    Multiple messages can share the same media file (deduplication).
    A message can have multiple media files (e.g., album).
    """

    __tablename__ = "message_media"

    # Composite primary key
    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True
    )
    media_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("media_files.id", ondelete="CASCADE"), primary_key=True
    )

    # Relationships
    message: Mapped["Message"] = relationship("Message", back_populates="media")
    media_file: Mapped["MediaFile"] = relationship("MediaFile", back_populates="messages")

    def __repr__(self) -> str:
        return f"<MessageMedia(message_id={self.message_id}, media_id={self.media_id})>"
