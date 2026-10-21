"""
Configuration Management Module

Environment-based configuration with validation using Pydantic Settings.
Prevents PITFALLS #3: Hardcoded Paths by making all paths configurable.

All services load settings from environment variables defined in .env file.
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    All configuration is centralized here to prevent hardcoded values
    scattered throughout the codebase.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",  # Ignore extra environment variables
    )

    # =============================================================================
    # PLATFORM IDENTITY
    # =============================================================================
    PLATFORM_NAME: str = Field(default="Telegram Archiver", description="Platform name for UI and API")

    # =============================================================================
    # ENVIRONMENT
    # =============================================================================
    ENVIRONMENT: str = Field(default="development", description="Environment name")
    DEBUG: bool = Field(default=False, description="Debug mode")
    LOG_LEVEL: str = Field(default="INFO", description="Logging level")
    LOG_FORMAT: str = Field(default="json", description="Logging format: json (default) or console")

    # =============================================================================
    # DATABASE (PostgreSQL)
    # =============================================================================
    POSTGRES_HOST: str = Field(default="postgres", description="PostgreSQL host")
    POSTGRES_PORT: int = Field(default=5432, description="PostgreSQL port")
    POSTGRES_DB: str = Field(default="tg_archiver", description="PostgreSQL database")
    POSTGRES_USER: str = Field(default="tg_user", description="PostgreSQL user")
    POSTGRES_PASSWORD: str = Field(..., description="PostgreSQL password")
    POSTGRES_POOL_SIZE: int = Field(default=40, description="Connection pool size (increased for 500+ channels)")
    POSTGRES_MAX_OVERFLOW: int = Field(default=40, description="Max pool overflow (100% overflow for burst traffic)")
    POSTGRES_POOL_TIMEOUT: int = Field(default=30, description="Pool timeout (seconds)")
    POSTGRES_POOL_RECYCLE: int = Field(default=3600, description="Connection recycle time")

    # =============================================================================
    # REDIS (Message Queue & Cache)
    # =============================================================================
    REDIS_HOST: str = Field(default="redis", description="Redis host")
    REDIS_PORT: int = Field(default=6379, description="Redis port")
    REDIS_PASSWORD: str = Field(..., description="Redis password")
    REDIS_DB: int = Field(default=0, description="Redis database number")

    # =============================================================================
    # MINIO (Object Storage)
    # =============================================================================
    MINIO_ENDPOINT: str = Field(..., description="MinIO endpoint (host:port)")
    MINIO_ACCESS_KEY: str = Field(..., description="MinIO access key")
    MINIO_SECRET_KEY: str = Field(..., description="MinIO secret key")
    MINIO_BUCKET_NAME: str = Field(
        default="tg-archive-media", description="S3 bucket name"
    )
    MINIO_SECURE: bool = Field(default=False, description="Use HTTPS for MinIO")
    MEDIA_RETENTION_DAYS: int = Field(
        default=0, ge=0, description="Delete media older than N days (0 = keep forever; dev only)"
    )

    # =============================================================================
    # TELEGRAM
    # =============================================================================
    TELEGRAM_API_ID: Optional[int] = Field(None, description="Telegram API ID")
    TELEGRAM_API_HASH: Optional[str] = Field(None, description="Telegram API hash")
    TELEGRAM_SESSION_PATH: Path = Field(
        default=Path("/data/sessions"), description="Session file directory"
    )
    TELEGRAM_SESSION_NAME: str = Field(
        default="tg_archiver", description="Session file name"
    )

    # Stored on each message as source_account (identifies this listener's account)
    SOURCE_ACCOUNT: str = Field(
        default="default", description="Account name recorded on archived messages"
    )

    # =============================================================================
    # FOLDER-BASED CHANNEL MANAGEMENT
    # Note: Telegram folder names limited to 12 characters
    # =============================================================================
    FOLDER_ARCHIVE_ALL_PATTERN: str = Field(
        default="Archive", description="Folder pattern for archive_all rule (7 chars, e.g. 'Archive-1')"
    )

    # =============================================================================
    # SOCIAL DATA FETCHING (Comments & Reactions)
    # =============================================================================
    SOCIAL_FETCH_ENABLED: bool = Field(
        default=True, description="Enable fetching comments and reactions from Telegram"
    )
    SOCIAL_FETCH_PERIOD_DAYS: int = Field(
        default=7, description="Fetch social data for messages from the last N days"
    )
    SOCIAL_FETCH_INTERVAL_SECONDS: int = Field(
        default=300, description="Interval between social data fetch cycles (5 minutes)"
    )
    SOCIAL_FETCH_BATCH_SIZE: int = Field(
        default=50, description="Messages to process per fetch cycle"
    )
    SOCIAL_REACTION_POLL_INTERVAL: int = Field(
        default=30, description="Seconds between reaction polls for visible messages (Telegram recommends 15-30s)"
    )

    # =============================================================================
    # DISCOVERED CHANNEL JOIN WORKER
    # =============================================================================
    CHANNEL_JOIN_MODE: Literal["approval", "auto", "off"] = Field(
        default="approval",
        description="approval: join only admin-approved channels; auto: join every discovered channel; off: never join",
    )
    CHANNEL_JOIN_ENABLED: bool = Field(
        default=True, description="Deprecated: use CHANNEL_JOIN_MODE. false is treated as CHANNEL_JOIN_MODE=off"
    )
    CHANNEL_JOIN_INTERVAL_SECONDS: int = Field(
        default=60, description="Interval between channel join cycles"
    )
    CHANNEL_JOIN_BATCH_SIZE: int = Field(
        default=5, description="Max channels to attempt joining per cycle"
    )
    CHANNEL_JOIN_MAX_RETRIES: int = Field(
        default=3, description="Max join retries before marking as failed"
    )
    CHANNEL_JOIN_RETRY_DELAY_HOURS: int = Field(
        default=24, description="Hours to wait before retrying a failed join"
    )
    CHANNEL_JOIN_DAILY_CAP: int = Field(
        default=20, description="Max successful joins per rolling 24 hours"
    )
    CHANNEL_JOIN_LIMIT_PAUSE_HOURS: int = Field(
        default=24, description="Hours to pause joining after Telegram reports too many channels"
    )

    # =============================================================================
    # HISTORICAL BACKFILL CONFIGURATION
    # =============================================================================
    BACKFILL_ENABLED: bool = Field(
        default=False, description="Enable automatic backfill of historical messages"
    )
    BACKFILL_START_DATE: Optional[str] = Field(
        default="2024-01-01", description="Start date for backfill (ISO format: YYYY-MM-DD)"
    )
    BACKFILL_MODE: str = Field(
        default="manual",
        description="Backfill mode: manual, on_discovery, or scheduled",
    )
    BACKFILL_BATCH_SIZE: int = Field(
        default=100, description="Messages per batch (rate-limit friendly)"
    )
    BACKFILL_DELAY_MS: int = Field(
        default=1000, description="Delay between batches in milliseconds"
    )
    BACKFILL_MEDIA_STRATEGY: str = Field(
        default="download_available",
        description="Media handling: download_available, skip, or download_all",
    )

    # =============================================================================
    # GAP DETECTION (Automatic Resilience)
    # =============================================================================
    GAP_DETECTION_ENABLED: bool = Field(
        default=True, description="Enable automatic gap detection for missed messages"
    )
    GAP_THRESHOLD_HOURS: float = Field(
        default=1.0, description="Hours of silence before considering it a gap (1.0 = 1 hour)"
    )
    GAP_CHECK_INTERVAL_SECONDS: int = Field(
        default=600, description="Seconds between periodic gap checks (600 = 10 minutes)"
    )
    GAP_MAX_CHANNELS_PER_CHECK: int = Field(
        default=10, description="Max channels to backfill per gap check (rate-limit friendly)"
    )

    # =============================================================================
    # OLLAMA (read by the API system router)
    # =============================================================================
    OLLAMA_BASE_URL: str = Field(
        default="http://ollama:11434", description="Ollama API endpoint"
    )
    OLLAMA_MODEL: str = Field(
        default="qwen2.5:3b", description="Ollama model to use (qwen2.5:3b recommended for multilingual content)"
    )
    OLLAMA_TIMEOUT: int = Field(default=30, description="LLM request timeout (seconds)")
    # External LLM Endpoint Support
    OLLAMA_API_KEY: Optional[str] = Field(
        default=None,
        description="API key for external Ollama endpoints (optional, for authenticated access)"
    )
    OLLAMA_EXTERNAL_MODE: bool = Field(
        default=False,
        description="Enable external endpoint mode (adds retry logic, longer timeouts)"
    )

    # =============================================================================
    # TRANSLATION (DeepL Pro - Free API)
    # =============================================================================
    TRANSLATION_ENABLED: bool = Field(default=True, description="Enable translation")
    TRANSLATION_PROVIDER: str = Field(
        default="deepl", description="Translation provider: deepl, google, or none"
    )
    TRANSLATION_TARGET_LANG: str = Field(default="en", description="Target language code")
    TRANSLATION_FROM_LANGUAGES: str = Field(
        default="ru,uk", description="Source languages to translate (comma-separated)"
    )
    DEEPL_API_KEY: Optional[str] = Field(None, description="DeepL API key")
    DEEPL_API_URL: str = Field(
        default="",
        description="DeepL API endpoint; empty = let the deepl library pick it from the key",
    )
    # Characters sent to DeepL per UTC day (shared across instances via Redis); 0 = no cap.
    # Replaces the unused TRANSLATION_DAILY_BUDGET_USD (characters are what DeepL bills).
    TRANSLATION_DAILY_CHAR_LIMIT: int = Field(default=500_000, ge=0)
    # Messages older than this are skipped instead of translated
    TRANSLATION_MAX_AGE_HOURS: int = Field(default=48, ge=1)
    TRANSLATION_BATCH_SIZE: int = Field(default=10, ge=1)
    TRANSLATION_POLL_INTERVAL_SECONDS: float = Field(default=5.0, gt=0)
    TRANSLATION_MAX_ATTEMPTS: int = Field(default=8, ge=1)
    # Google (deep-translator scraping) pacing and rate-limit backoff
    GOOGLE_MIN_INTERVAL_SECONDS: float = Field(default=2.0, ge=0)
    GOOGLE_BACKOFF_BASE_SECONDS: float = Field(default=30.0, gt=0)
    GOOGLE_BACKOFF_MAX_SECONDS: float = Field(default=900.0, gt=0)

    # =============================================================================
    # PROCESSOR
    # =============================================================================
    PROCESSOR_BATCH_SIZE: int = Field(default=10, description="Messages per XREADGROUP call")
    PROCESSOR_RETRY_IDLE_MS: int = Field(
        default=300000,
        description="Idle time (ms) before a failed/unacked message is redelivered (XAUTOCLAIM)",
    )

    # =============================================================================
    # API CONFIGURATION
    # =============================================================================
    JWT_SECRET_KEY: str = Field(..., description="JWT signing key")
    JWT_ALGORITHM: str = Field(default="HS256", description="JWT algorithm")
    JWT_EXPIRATION_MINUTES: int = Field(default=60, description="JWT token expiration")
    API_CORS_ORIGINS: str = Field(
        default="http://localhost:3000", description="CORS allowed origins (comma-separated)"
    )

    # =============================================================================
    # VALIDATORS
    # =============================================================================

    @field_validator("TELEGRAM_API_ID", mode="before")
    @classmethod
    def parse_telegram_api_id(cls, v):
        """Parse Telegram API ID, allowing placeholder values."""
        if isinstance(v, str) and ("YOUR_" in v or "CHANGE_" in v):
            return None
        if isinstance(v, str):
            try:
                return int(v)
            except ValueError:
                return None
        return v

    @property
    def DATABASE_URL(self) -> str:
        """Construct PostgreSQL connection URL from components."""
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"

    @property
    def REDIS_URL(self) -> str:
        """Construct Redis connection URL from components."""
        return f"redis://:{self.REDIS_PASSWORD}@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    # Lowercase aliases for backwards compatibility with middleware
    @property
    def redis_url(self) -> str:
        """Alias for REDIS_URL (lowercase for middleware compatibility)."""
        return self.REDIS_URL

    @property
    def redis_password(self) -> str:
        """Alias for REDIS_PASSWORD (lowercase for middleware compatibility)."""
        return self.REDIS_PASSWORD

    def get_translation_languages(self) -> list[str]:
        """Get translation languages as a list."""
        return [lang.strip() for lang in self.TRANSLATION_FROM_LANGUAGES.split(",") if lang.strip()]

    def get_cors_origins(self) -> list[str]:
        """
        Get CORS origins as a list with security validation.

        Security considerations:
        - Never returns empty list (falls back to localhost defaults)
        - Logs warning if wildcard (*) is detected
        - OWASP: Wildcard + credentials is a severe vulnerability

        Returns:
            List of allowed origins
        """
        import logging
        logger = logging.getLogger(__name__)

        origins = [origin.strip() for origin in self.API_CORS_ORIGINS.split(",") if origin.strip()]

        if not origins:
            # Safe development defaults - localhost only
            logger.warning(
                "CORS_ORIGINS not set or empty, using localhost defaults. "
                "Set API_CORS_ORIGINS env var for production."
            )
            return [
                "http://localhost:3000",
                "http://localhost:8000",
                "http://127.0.0.1:3000",
                "http://127.0.0.1:8000",
            ]

        # Security check: warn if wildcard is used
        if "*" in origins:
            logger.error(
                "SECURITY WARNING: Wildcard (*) CORS origin detected in API_CORS_ORIGINS. "
                "This allows any website to make requests to your API. "
                "Combined with allow_credentials=True, this is a severe security vulnerability. "
                "Remove '*' and specify explicit origins. See OWASP CORS guidance."
            )

        return origins

    def get_backfill_start_date(self) -> Optional[datetime]:
        """
        Parse BACKFILL_START_DATE into a datetime object.

        Returns:
            Datetime with UTC timezone, or None if not set or invalid.
        """
        if not self.BACKFILL_START_DATE:
            return None

        try:
            # Parse ISO date string (YYYY-MM-DD)
            parsed = datetime.fromisoformat(self.BACKFILL_START_DATE)

            # Ensure timezone-aware (UTC)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)

            return parsed
        except (ValueError, AttributeError):
            # Invalid date format - log warning and return None
            return None

    @property
    def effective_channel_join_mode(self) -> str:
        """Join mode after applying the deprecated CHANNEL_JOIN_ENABLED=false override."""
        return "off" if not self.CHANNEL_JOIN_ENABLED else self.CHANNEL_JOIN_MODE

    def model_post_init(self, __context) -> None:
        """Post-initialization: Create directories if they don't exist."""
        try:
            self.TELEGRAM_SESSION_PATH.mkdir(parents=True, exist_ok=True)
        except (PermissionError, OSError):
            # Created by the Docker volume; lets settings load in development/testing
            pass


# Global settings instance (singleton)
# All services import and use this instance
settings = Settings()
