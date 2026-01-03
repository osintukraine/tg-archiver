"""
Authentication providers for tg-archiver API.

Supports authentication backends:
- none: No authentication (development, private deployments)
- jwt: Simple JWT authentication with PostgreSQL user storage

Configure via AUTH_PROVIDER environment variable.
"""

from .factory import get_auth_dependency, AuthProvider
from .feed_auth import (
    FeedAuthResult,
    is_feed_auth_required,
    verify_feed_token,
    require_feed_auth,
    optional_feed_auth,
)

__all__ = [
    "get_auth_dependency",
    "AuthProvider",
    "FeedAuthResult",
    "is_feed_auth_required",
    "verify_feed_token",
    "require_feed_auth",
    "optional_feed_auth",
]
