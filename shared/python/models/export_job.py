"""
Export Job Model - Background data export job tracking

Export jobs support:
- Multiple export types: messages, channels, entities, audit_log
- Multiple formats: json, csv, jsonl
- Column profiles: minimal, standard, full, custom
- Tiered processing: direct streaming (<10K), background job (10K+)
- Secure download tokens with expiration and download limits
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import BigInteger, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class ExportJob(Base):
    """
    Background export job for large data exports.

    Supports tiered processing:
    - < 10K rows: Direct streaming response
    - 10K-100K rows: Background job with webhook notification
    - > 100K rows: Background job with chunked files

    Files are stored in MinIO and accessible via presigned download tokens.
    """

    __tablename__ = "export_jobs"

    # Primary key
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    # Job identification
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Job configuration
    export_type: Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # messages, channels, entities, audit_log
    format: Mapped[str] = mapped_column(
        String(20), nullable=False, default="json"
    )  # json, csv, jsonl
    profile: Mapped[str] = mapped_column(
        String(20), nullable=False, default="standard"
    )  # minimal, standard, full, custom

    # Filters (JSONB for flexible filter combinations)
    filters: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict
    )
    # Example filters:
    # {"channel_ids": [1, 2, 3], "date_from": "2024-01-01", "date_to": "2024-12-31"}
    # {"importance_level": "high", "topics": ["combat", "equipment"]}
    # {"is_spam": false, "has_media": true}

    # Column selection (for custom profile)
    columns: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)

    # Job state
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending"
    )  # pending, processing, completed, failed, cancelled

    # Progress tracking
    total_rows: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    processed_rows: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_percent: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, default=0
    )

    # Result file (stored in MinIO)
    s3_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    file_checksum: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True
    )  # SHA-256

    # Download token
    download_token: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), unique=True, server_default=func.gen_random_uuid()
    )
    download_token_expires_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    download_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_downloads: Mapped[int] = mapped_column(Integer, nullable=False, default=10)

    # Timing
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        nullable=True
    )  # Auto-cleanup

    # Error handling
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_details: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    # Audit
    created_by_ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Relationships
    user = relationship("User", lazy="selectin")

    def __repr__(self) -> str:
        return (
            f"<ExportJob(id={self.id}, type={self.export_type}, "
            f"status={self.status}, progress={self.progress_percent}%)>"
        )

    @property
    def is_downloadable(self) -> bool:
        """Check if the export is ready for download."""
        if self.status != "completed":
            return False
        if not self.s3_key:
            return False
        if self.download_count >= self.max_downloads:
            return False
        if self.download_token_expires_at and datetime.now(timezone.utc) > self.download_token_expires_at:
            return False
        return True

    @property
    def duration_seconds(self) -> Optional[float]:
        """Get job duration in seconds."""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None


# Column profiles for message exports
MESSAGE_EXPORT_PROFILES = {
    "minimal": [
        "id",
        "message_id",
        "channel_id",
        "content",
        "telegram_date",
    ],
    "standard": [
        "id",
        "message_id",
        "channel_id",
        "content",
        "content_translated",
        "telegram_date",
        "views",
        "forwards",
        "osint_topic",
        "importance_level",
        "is_spam",
        "language_detected",
        "media_type",
    ],
    "full": [
        "id",
        "message_id",
        "channel_id",
        "content",
        "content_translated",
        "telegram_date",
        "author_user_id",
        "replied_to_message_id",
        "forward_from_channel_id",
        "forward_from_message_id",
        "forward_date",
        "has_comments",
        "comments_count",
        "views",
        "forwards",
        "language_detected",
        "translation_target",
        "translation_provider",
        "media_type",
        "media_url_telegram",
        "grouped_id",
        "is_spam",
        "spam_confidence",
        "spam_reason",
        "spam_type",
        "osint_topic",
        "importance_level",
        "needs_human_review",
        "reviewed_by",
        "reviewed_at",
        "entities",
        "content_sentiment",
        "content_urgency_level",
        "content_complexity",
        "key_phrases",
        "summary",
        "created_at",
        "updated_at",
    ],
}

# Columns that should NEVER be exported (heavyweight data)
EXPORT_EXCLUDED_COLUMNS = [
    "content_embedding",  # ~6KB per row, useless outside vector search
    "search_vector",  # tsvector for search, internal use only
    "embedding_model",  # Internal tracking
    "embedding_generated_at",  # Internal tracking
    "hash_algorithm",  # Internal tracking
    "hash_generated_at",  # Internal tracking
    "hash_version",  # Internal tracking
    "content_hash",  # Deduplication hash
    "metadata_hash",  # Deduplication hash
]
