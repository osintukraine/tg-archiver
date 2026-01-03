"""Dependency modules for the API service."""

from .auth import (
    get_current_user,
    require_auth,
    require_admin,
    require_role,
    CurrentUser,
    AuthenticatedUser,
    AdminUser,
)
from .database import (
    execute_with_timeout,
    get_db_with_timeout,
    db_with_timeout,
)
from ..database import get_db

__all__ = [
    # Auth
    "get_current_user",
    "require_auth",
    "require_admin",
    "require_role",
    "CurrentUser",
    "AuthenticatedUser",
    "AdminUser",
    # Database
    "get_db",
    "execute_with_timeout",
    "get_db_with_timeout",
    "db_with_timeout",
]
