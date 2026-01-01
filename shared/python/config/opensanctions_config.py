"""
OpenSanctions configuration from environment variables

Supports two backend modes:
1. API mode (OPENSANCTIONS_BACKEND=api) - Use OpenSanctions public API
   - Simpler setup, no infrastructure needed
   - Subject to rate limits
   - Requires API key from opensanctions.org

2. Yente mode (OPENSANCTIONS_BACKEND=yente) - Self-hosted via Yente
   - No rate limits
   - Works offline after initial sync
   - Full control over data updates
   - Requires running yente + elasticsearch containers
"""

import os
from typing import Optional, Literal


class OpenSanctionsConfig:
    """OpenSanctions enrichment layer configuration"""

    # Allowed dataset values (must match OpenSanctions API)
    # See: https://www.opensanctions.org/docs/api/matching/
    ALLOWED_DATASETS = {"default", "sanctions", "peps"}

    # Allowed backend modes
    ALLOWED_BACKENDS = {"api", "yente"}

    def __init__(self):
        # Core settings
        self.enabled = os.getenv("OPENSANCTIONS_ENABLED", "false").lower() == "true"
        self.api_key = os.getenv("OPENSANCTIONS_API_KEY")

        # Backend mode: "api" (public API) or "yente" (self-hosted)
        backend_raw = os.getenv("OPENSANCTIONS_BACKEND", "api").lower()
        if backend_raw not in self.ALLOWED_BACKENDS:
            raise ValueError(
                f"Invalid OPENSANCTIONS_BACKEND '{backend_raw}'. "
                f"Must be one of: {', '.join(sorted(self.ALLOWED_BACKENDS))}"
            )
        self.backend: Literal["api", "yente"] = backend_raw

        # Base URL depends on backend mode
        # Handle empty string as "not set" (docker-compose passes empty strings)
        base_url_env = os.getenv("OPENSANCTIONS_BASE_URL", "").strip()
        if base_url_env:
            # User explicitly set a custom URL
            self.base_url = base_url_env
        elif self.backend == "yente":
            # Self-hosted yente (default Docker service name)
            self.base_url = "http://yente:8000"
        else:
            # Public OpenSanctions API
            self.base_url = "https://api.opensanctions.org"

        # Validate dataset at initialization
        # "default" is the combined sanctions+peps+crime dataset
        dataset_raw = os.getenv("OPENSANCTIONS_DATASET", "default")
        if dataset_raw not in self.ALLOWED_DATASETS:
            raise ValueError(
                f"Invalid OPENSANCTIONS_DATASET '{dataset_raw}'. "
                f"Must be one of: {', '.join(sorted(self.ALLOWED_DATASETS))}"
            )
        self.dataset = dataset_raw

        # Matching configuration
        self.match_threshold = float(os.getenv("OPENSANCTIONS_MATCH_THRESHOLD", "0.7"))
        self.realtime_enabled = (
            os.getenv("OPENSANCTIONS_REALTIME_ENABLED", "true").lower() == "true"
        )
        self.realtime_threshold = float(
            os.getenv("OPENSANCTIONS_REALTIME_THRESHOLD", "0.8")
        )
        self.async_enabled = (
            os.getenv("OPENSANCTIONS_ASYNC_ENABLED", "true").lower() == "true"
        )
        self.async_batch_size = int(os.getenv("OPENSANCTIONS_ASYNC_BATCH_SIZE", "50"))
        self.async_interval_minutes = int(
            os.getenv("OPENSANCTIONS_ASYNC_INTERVAL_MINUTES", "5")
        )

        # Caching and rate limiting
        self.cache_ttl_hours = int(os.getenv("OPENSANCTIONS_CACHE_TTL_HOURS", "24"))
        self.cache_size = int(os.getenv("OPENSANCTIONS_CACHE_SIZE", "10000"))
        self.rate_limit_per_minute = int(
            os.getenv("OPENSANCTIONS_RATE_LIMIT_PER_MINUTE", "100")
        )

        # Entity embeddings
        self.generate_embeddings = (
            os.getenv("OPENSANCTIONS_GENERATE_EMBEDDINGS", "true").lower() == "true"
        )
        self.embedding_model = os.getenv(
            "OPENSANCTIONS_EMBEDDING_MODEL", "all-MiniLM-L6-v2"
        )

        # Entity clustering
        self.clustering_enabled = (
            os.getenv("OPENSANCTIONS_CLUSTERING_ENABLED", "true").lower() == "true"
        )
        self.clustering_schedule = os.getenv(
            "OPENSANCTIONS_CLUSTERING_SCHEDULE", "weekly"
        )

        # Yente-specific settings (only used when backend=yente)
        self.yente_update_token = os.getenv("YENTE_UPDATE_TOKEN")

    @property
    def is_yente_mode(self) -> bool:
        """Check if using self-hosted yente backend"""
        return self.backend == "yente"

    @property
    def is_api_mode(self) -> bool:
        """Check if using public API backend"""
        return self.backend == "api"

    def validate(self) -> tuple[bool, Optional[str]]:
        """
        Validate configuration

        Returns:
            (is_valid, error_message)
        """
        if not self.enabled:
            return True, None

        # API mode requires API key
        if self.is_api_mode and not self.api_key:
            return False, (
                "OPENSANCTIONS_API_KEY required when using API mode. "
                "Get one at https://www.opensanctions.org/api/ or use OPENSANCTIONS_BACKEND=yente"
            )

        # Yente mode: API key optional but recommended for bulk data access
        if self.is_yente_mode and not self.api_key:
            # This is a warning, not an error - yente can work without API key
            # using public data.opensanctions.org endpoint
            pass

        if self.match_threshold < 0.0 or self.match_threshold > 1.0:
            return False, "OPENSANCTIONS_MATCH_THRESHOLD must be 0.0-1.0"

        if self.realtime_threshold < 0.0 or self.realtime_threshold > 1.0:
            return False, "OPENSANCTIONS_REALTIME_THRESHOLD must be 0.0-1.0"

        # Dataset validation now happens at initialization
        return True, None

    def get_mode_description(self) -> str:
        """Get human-readable description of current mode"""
        if self.is_yente_mode:
            return f"Self-hosted Yente at {self.base_url}"
        else:
            return f"OpenSanctions API at {self.base_url}"


# Global instance
opensanctions_config = OpenSanctionsConfig()
