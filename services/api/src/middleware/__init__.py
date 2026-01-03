"""
API Middleware

Global middleware for cross-cutting concerns like authentication,
CORS, rate limiting, and request logging.
"""

from .auth_unified import AuthMiddleware
from ..auth.models import AuthUser

# Backwards compatibility aliases
UserContext = AuthUser
AuthenticatedUser = AuthUser

__all__ = [
    "AuthMiddleware",
    "AuthUser",
    "UserContext",
    "AuthenticatedUser",
]
