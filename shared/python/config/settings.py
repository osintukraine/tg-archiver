"""
Configuration Management Module

Environment-based configuration with validation using Pydantic Settings.
Prevents PITFALLS #3: Hardcoded Paths by making all paths configurable.

All services load settings from environment variables defined in .env file.
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

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
    LOG_FORMAT: str = Field(default="json", description="Logging format: json or text")

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
    REDIS_STREAM_NAME: str = Field(
        default="telegram_messages", description="Redis stream name"
    )
    REDIS_CONSUMER_GROUP: str = Field(
        default="processor_group", description="Consumer group name"
    )
    REDIS_MAX_STREAM_LENGTH: int = Field(
        default=100000, description="Max messages in stream"
    )

    # =============================================================================
    # MINIO (Object Storage)
    # =============================================================================
    MINIO_ENDPOINT: str = Field(..., description="MinIO endpoint (host:port)")
    MINIO_ACCESS_KEY: str = Field(..., description="MinIO access key")
    MINIO_SECRET_KEY: str = Field(..., description="MinIO secret key")
    MINIO_BUCKET_NAME: str = Field(
        default="tg-media", description="MinIO bucket name"
    )
    MINIO_SECURE: bool = Field(default=False, description="Use HTTPS for MinIO")
    MINIO_PUBLIC_URL: str = Field(
        default="http://localhost:9000", description="Public URL for media access"
    )

    # =============================================================================
    # TELEGRAM
    # =============================================================================
    TELEGRAM_API_ID: Optional[int] = Field(None, description="Telegram API ID")
    TELEGRAM_API_HASH: Optional[str] = Field(None, description="Telegram API hash")
    TELEGRAM_PHONE: Optional[str] = Field(None, description="Phone number for auth")
    TELEGRAM_SESSION_PATH: Path = Field(
        default=Path("/data/sessions"), description="Session file directory"
    )
    TELEGRAM_SESSION_NAME: str = Field(
        default="tg_archiver", description="Session file name"
    )
    TELEGRAM_RATE_LIMIT_PER_CHANNEL: int = Field(
        default=20, description="Messages per minute per channel"
    )

    # Multi-account support: identifies which account this listener represents
    # Used for enrichment routing (each account monitors different channels)
    SOURCE_ACCOUNT: str = Field(
        default="default", description="Account name (default, account_1, account_2)"
    )

    # =============================================================================
    # TELEGRAM MULTI-ACCOUNT SUPPORT (Optional)
    # =============================================================================
    # If these are set, enrichment service can use multiple Telegram clients
    # for different accounts (doubles rate limits, isolates risk)
    TELEGRAM_API_ID_ACCOUNT_1: Optional[int] = Field(
        None, description="Telegram API ID (Account 1)"
    )
    TELEGRAM_API_HASH_ACCOUNT_1: Optional[str] = Field(
        None, description="Telegram API hash (Account 1)"
    )
    TELEGRAM_PHONE_ACCOUNT_1: Optional[str] = Field(
        None, description="Phone number (Account 1)"
    )

    TELEGRAM_API_ID_ACCOUNT_2: Optional[int] = Field(
        None, description="Telegram API ID (Account 2)"
    )
    TELEGRAM_API_HASH_ACCOUNT_2: Optional[str] = Field(
        None, description="Telegram API hash (Account 2)"
    )
    TELEGRAM_PHONE_ACCOUNT_2: Optional[str] = Field(
        None, description="Phone number (Account 2)"
    )

    # =============================================================================
    # FOLDER-BASED CHANNEL MANAGEMENT
    # Note: Telegram folder names limited to 12 characters
    # =============================================================================
    FOLDER_SYNC_INTERVAL: int = Field(
        default=300, description="Seconds between folder syncs (5 minutes)"
    )
    FOLDER_ARCHIVE_ALL_PATTERN: str = Field(
        default="Archive", description="Folder pattern for archive_all rule (7 chars, e.g. 'Archive-1')"
    )
    FOLDER_MONITORING_PATTERN: str = Field(
        default="Monitor", description="Folder pattern for selective_archive rule (7 chars, e.g. 'Monitor-1')"
    )
    FOLDER_TEST_PATTERN: str = Field(
        default="Test", description="Folder pattern for test environment (4 chars)"
    )
    FOLDER_STAGING_PATTERN: str = Field(
        default="Staging", description="Folder pattern for staging environment (7 chars)"
    )
    MONITORING_RELEVANCE_THRESHOLD: int = Field(
        default=70, description="Min relevance score for selective archival"
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
    BACKFILL_PRIORITY: str = Field(
        default="lower", description="Backfill priority: lower, normal, or higher"
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
    # LLM (Self-hosted Ollama)
    # =============================================================================
    LLM_ENABLED: bool = Field(default=True, description="Enable LLM features")
    LLM_PROVIDER: str = Field(default="ollama", description="LLM provider: ollama or none")
    OLLAMA_BASE_URL: str = Field(
        default="http://ollama:11434", description="Ollama API endpoint"
    )
    OLLAMA_MODEL: str = Field(
        default="qwen2.5:3b", description="Ollama model to use (qwen2.5:3b recommended for multilingual content)"
    )
    OLLAMA_TIMEOUT: int = Field(default=30, description="LLM request timeout (seconds)")
    OLLAMA_NUM_PREDICT: int = Field(
        default=250, description="Max tokens to generate (lower = faster, 250 typically enough for analysis+JSON)"
    )
    LLM_FALLBACK_TO_RULES: bool = Field(
        default=True, description="Use rule-based scoring if LLM fails"
    )
    # Classifier mode: "unified" (default) or "modular"
    LLM_CLASSIFIER_MODE: str = Field(
        default="unified",
        description="Classifier mode: unified (one call) or modular (sequential task prompts)"
    )
    # External LLM Endpoint Support
    # Enable these settings to use a remote Ollama instance (e.g., Contabo hosted DeepSeek)
    OLLAMA_API_KEY: Optional[str] = Field(
        default=None,
        description="API key for external Ollama endpoints (optional, for authenticated access)"
    )
    OLLAMA_EXTERNAL_MODE: bool = Field(
        default=False,
        description="Enable external endpoint mode (adds retry logic, longer timeouts)"
    )
    OLLAMA_MAX_RETRIES: int = Field(
        default=3,
        description="Max retries for external endpoint failures"
    )
    OLLAMA_RETRY_DELAY: float = Field(
        default=1.0,
        description="Base delay between retries in seconds (uses exponential backoff)"
    )

    # =============================================================================
    # EMBEDDING-BASED FAST CLASSIFICATION (Backfill Mode)
    # =============================================================================
    # Fast classification using sentence-transformers embeddings for backfill
    # processing. Provides ~200x speedup over LLM while maintaining accuracy.
    # When BACKFILL_FAST_MODE=true, uses embedding similarity instead of LLM.
    BACKFILL_FAST_MODE: bool = Field(
        default=False,
        description="Use fast embedding-based classification for backfill (skips LLM)"
    )
    EMBEDDING_MODEL: str = Field(
        default="all-MiniLM-L6-v2",
        description="Sentence-transformers model for embedding-based classification"
    )
    EMBEDDING_OFF_TOPIC_THRESHOLD: float = Field(
        default=0.70,
        description="Cosine similarity threshold for off-topic detection (0.0-1.0)"
    )
    EMBEDDING_TOPIC_KEYWORD_CHECK: bool = Field(
        default=True,
        description="Check for topic-related keywords (adds relevance signal)"
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
        default="https://api-free.deepl.com/v2", description="DeepL API endpoint"
    )
    GOOGLE_TRANSLATE_API_KEY: Optional[str] = Field(None, description="Google Translate API key")
    TRANSLATION_DAILY_BUDGET_USD: float = Field(
        default=999999.0, description="Daily translation budget (effectively unlimited for free)"
    )

    # =============================================================================
    # WORKER CONFIGURATION
    # =============================================================================
    WORKER_COUNT: int = Field(default=4, description="Number of processor workers")
    WORKER_BATCH_SIZE: int = Field(default=50, description="Messages per batch")
    WORKER_TIMEOUT: int = Field(default=300, description="Worker timeout (seconds)")
    PROCESSOR_BATCH_SIZE: int = Field(default=10, description="Messages per XREADGROUP call")
    ENTITY_EXTRACTION_ENABLED: bool = Field(default=True, description="Enable entity extraction")

    # =============================================================================
    # API CONFIGURATION
    # =============================================================================
    API_HOST: str = Field(default="0.0.0.0", description="API server host")
    API_PORT: int = Field(default=8000, description="API server port")
    API_WORKERS: int = Field(default=4, description="Uvicorn workers")
    API_RELOAD: bool = Field(default=False, description="Auto-reload on code changes")
    JWT_SECRET_KEY: str = Field(..., description="JWT signing key")
    JWT_ALGORITHM: str = Field(default="HS256", description="JWT algorithm")
    JWT_EXPIRATION_MINUTES: int = Field(default=60, description="JWT token expiration")
    API_RATE_LIMIT_PER_MINUTE: int = Field(default=60, description="API rate limit per user")
    API_CORS_ORIGINS: str = Field(
        default="http://localhost:3000", description="CORS allowed origins (comma-separated)"
    )

    # =============================================================================
    # PATHS (All Configurable - No Hardcoding!)
    # =============================================================================
    MEDIA_STORAGE_PATH: Path = Field(
        default=Path("/data/media"), description="Media storage directory"
    )
    LOG_PATH: Path = Field(
        default=Path("/var/log/tg-archiver"), description="Log directory"
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

    @field_validator("TELEGRAM_API_ID_ACCOUNT_1", "TELEGRAM_API_ID_ACCOUNT_2", mode="before")
    @classmethod
    def parse_multi_account_api_ids(cls, v):
        """Parse multi-account Telegram API IDs, allowing None/placeholder values."""
        if v is None:
            return None
        if isinstance(v, str) and ("YOUR_" in v or "CHANGE_" in v or v.strip() == ""):
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

    # =============================================================================
    # MULTI-ACCOUNT HELPER METHODS
    # =============================================================================

    def has_multi_account_support(self) -> bool:
        """
        Check if multi-account credentials are configured.

        Returns:
            True if at least one additional account is configured
        """
        has_account_1 = all([
            self.TELEGRAM_API_ID_ACCOUNT_1,
            self.TELEGRAM_API_HASH_ACCOUNT_1,
        ])
        has_account_2 = all([
            self.TELEGRAM_API_ID_ACCOUNT_2,
            self.TELEGRAM_API_HASH_ACCOUNT_2,
        ])
        return has_account_1 or has_account_2

    def get_available_accounts(self) -> list[str]:
        """
        Get list of available Telegram accounts based on configuration.

        Returns:
            List of account names (e.g., ['default'], ['default', 'account_1', 'account_2'])
        """
        accounts = []

        # Default account (backward compatible)
        if self.TELEGRAM_API_ID and self.TELEGRAM_API_HASH:
            accounts.append("default")

        # Account 1
        if self.TELEGRAM_API_ID_ACCOUNT_1 and self.TELEGRAM_API_HASH_ACCOUNT_1:
            accounts.append("account_1")

        # Account 2
        if self.TELEGRAM_API_ID_ACCOUNT_2 and self.TELEGRAM_API_HASH_ACCOUNT_2:
            accounts.append("account_2")

        return accounts

    def get_account_credentials(self, account_name: str) -> Optional[dict]:
        """
        Get credentials for a specific Telegram account.

        Args:
            account_name: "default", "account_1", or "account_2"

        Returns:
            Dict with api_id, api_hash, phone or None if not configured

        Example:
            >>> settings.get_account_credentials("account_1")
            {"api_id": 12345, "api_hash": "abc123", "phone": "+1234567890"}
        """
        if account_name == "default":
            if self.TELEGRAM_API_ID and self.TELEGRAM_API_HASH:
                return {
                    "api_id": self.TELEGRAM_API_ID,
                    "api_hash": self.TELEGRAM_API_HASH,
                    "phone": self.TELEGRAM_PHONE,
                }
        elif account_name == "account_1":
            if self.TELEGRAM_API_ID_ACCOUNT_1 and self.TELEGRAM_API_HASH_ACCOUNT_1:
                return {
                    "api_id": self.TELEGRAM_API_ID_ACCOUNT_1,
                    "api_hash": self.TELEGRAM_API_HASH_ACCOUNT_1,
                    "phone": self.TELEGRAM_PHONE_ACCOUNT_1,
                }
        elif account_name == "account_2":
            if self.TELEGRAM_API_ID_ACCOUNT_2 and self.TELEGRAM_API_HASH_ACCOUNT_2:
                return {
                    "api_id": self.TELEGRAM_API_ID_ACCOUNT_2,
                    "api_hash": self.TELEGRAM_API_HASH_ACCOUNT_2,
                    "phone": self.TELEGRAM_PHONE_ACCOUNT_2,
                }

        return None

    def get_all_account_credentials(self) -> dict[str, dict]:
        """
        Get credentials for all configured Telegram accounts.

        Returns:
            Dict of account_name -> credentials

        Example:
            >>> settings.get_all_account_credentials()
            {
                "default": {"api_id": 123, "api_hash": "abc", "phone": "+123"},
                "account_1": {"api_id": 456, "api_hash": "def", "phone": "+456"},
            }
        """
        accounts = {}
        for account_name in ["default", "account_1", "account_2"]:
            creds = self.get_account_credentials(account_name)
            if creds:
                accounts[account_name] = creds
        return accounts

    def model_post_init(self, __context) -> None:
        """Post-initialization: Create directories if they don't exist."""
        for path_field in [self.TELEGRAM_SESSION_PATH, self.MEDIA_STORAGE_PATH, self.LOG_PATH]:
            try:
                path_field.mkdir(parents=True, exist_ok=True)
            except (PermissionError, OSError):
                # Directories will be created in Docker containers
                # This allows settings to load in development/testing
                pass


# Global settings instance (singleton)
# All services import and use this instance
settings = Settings()
