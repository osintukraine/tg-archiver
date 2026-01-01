"""
Storage Models - Multi-Box Hetzner Storage Management

Tracks multiple Hetzner Storage Boxes for media storage with
region-based partitioning, capacity management, and MinIO endpoints.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Integer, BigInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class StorageBox(Base):
    """
    Hetzner Storage Box configuration and tracking.

    Each storage box maps to:
    - One Hetzner Storage Box (SSHFS mounted)
    - One MinIO container (S3 gateway to that mount)
    - One Caddy route (/minio-{id}/*)

    Example configurations:
        - storage-001: First box (default)
        - russia-1: Russian channels
        - ukraine-1: Ukrainian channels
    """

    __tablename__ = "storage_boxes"

    # Primary key - human-readable ID
    id: Mapped[str] = mapped_column(String(50), primary_key=True)

    # Hetzner connection details (for SSHFS mount)
    hetzner_host: Mapped[str] = mapped_column(String(255), nullable=False)
    hetzner_user: Mapped[str] = mapped_column(String(50), nullable=False)
    hetzner_port: Mapped[int] = mapped_column(Integer, default=23, nullable=False)
    mount_path: Mapped[str] = mapped_column(String(255), nullable=False)

    # MinIO endpoint (Docker service name)
    minio_endpoint: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    minio_port: Mapped[int] = mapped_column(Integer, default=9000, nullable=False)

    # Capacity tracking (bytes precision)
    capacity_gb: Mapped[int] = mapped_column(Integer, nullable=False)
    used_gb: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # Legacy
    used_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    reserved_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)

    # Write control
    high_water_mark: Mapped[int] = mapped_column(Integer, default=90, nullable=False)
    is_readonly: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Box selection
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)

    # Logical partitioning
    account_region: Mapped[str] = mapped_column(String(20), nullable=False)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_full: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Metadata
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    last_health_check: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    def __repr__(self) -> str:
        return f"<StorageBox(id={self.id}, region={self.account_region}, used={self.usage_percent:.1f}%)>"

    @property
    def capacity_bytes(self) -> int:
        """Total capacity in bytes."""
        return self.capacity_gb * 1024 * 1024 * 1024

    @property
    def usage_percent(self) -> float:
        """Calculate storage usage percentage."""
        if self.capacity_bytes == 0:
            return 0.0
        return (self.used_bytes / self.capacity_bytes) * 100

    @property
    def available_bytes(self) -> int:
        """Available bytes (excluding reserved). Clamped to 0 if over capacity."""
        return max(0, self.capacity_bytes - self.used_bytes - self.reserved_bytes)

    @property
    def is_above_water_mark(self) -> bool:
        """Check if storage is above high water mark."""
        return self.usage_percent >= self.high_water_mark

    @property
    def can_accept_writes(self) -> bool:
        """Check if box can accept new uploads."""
        return (
            self.is_active
            and not self.is_full
            and not self.is_readonly
            and not self.is_above_water_mark
        )

    @property
    def minio_url(self) -> str:
        """Full MinIO endpoint URL."""
        if not self.minio_endpoint:
            return ""
        return f"http://{self.minio_endpoint}:{self.minio_port}"
