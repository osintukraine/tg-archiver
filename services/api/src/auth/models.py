"""Unified authentication model for all providers."""

from typing import Optional, Union
from uuid import UUID
from pydantic import BaseModel


class AuthUser(BaseModel):
    """
    Unified user authentication context.

    Used consistently across all auth providers:
    - JWT tokens
    - API keys
    - Anonymous access

    This single model replaces both UserContext and AuthenticatedUser,
    eliminating type mismatches across middlewares and dependencies.
    """

    # Core identity - can be UUID (for API keys) or integer (for JWT users)
    user_id: Optional[Union[UUID, int]] = None
    username: Optional[str] = None
    email: Optional[str] = None  # Plain string to allow .local domains in dev
    display_name: Optional[str] = None

    # Roles (list for flexibility, supports "admin", "analyst", "viewer", etc.)
    roles: list[str] = []

    # Authentication status
    is_authenticated: bool = False

    # Auth method for logging/debugging
    auth_method: str = "anonymous"  # "ory", "jwt", "api_key", "anonymous"

    class Config:
        frozen = True  # Immutable for security

    @property
    def id(self) -> str:
        """String ID for compatibility."""
        return str(self.user_id) if self.user_id else "anonymous"

    @property
    def is_admin(self) -> bool:
        """Check if user has admin role."""
        return "admin" in self.roles or "administrator" in self.roles

    @property
    def is_analyst(self) -> bool:
        """Check if user has analyst role."""
        return self.is_admin or "analyst" in self.roles

    @property
    def is_viewer(self) -> bool:
        """All authenticated users can view."""
        return self.is_authenticated

    @property
    def role(self) -> str:
        """Primary role for backwards compatibility."""
        if self.is_admin:
            return "admin"
        elif self.roles:
            return self.roles[0]
        return "anonymous"

    @classmethod
    def anonymous(cls) -> "AuthUser":
        """Create anonymous user context."""
        return cls(
            is_authenticated=False,
            auth_method="anonymous",
        )

    @classmethod
    def from_jwt(
        cls,
        user_id: Union[str, int],
        username: str,
        email: Optional[str],
        display_name: Optional[str],
        roles: list[str],
    ) -> "AuthUser":
        """Create from JWT token payload."""
        # User ID can be integer (local users) or UUID string (external providers)
        parsed_user_id: Optional[Union[UUID, int]] = None
        if user_id is not None:
            if isinstance(user_id, int):
                parsed_user_id = user_id
            elif isinstance(user_id, str) and user_id.isdigit():
                parsed_user_id = int(user_id)
            elif isinstance(user_id, str):
                try:
                    parsed_user_id = UUID(user_id)
                except ValueError:
                    parsed_user_id = None

        return cls(
            user_id=parsed_user_id,
            username=username,
            email=email,
            display_name=display_name,
            roles=roles,
            is_authenticated=True,
            auth_method="jwt",
        )

    @classmethod
    def from_api_key(
        cls,
        user_id: Optional[int],
        email: Optional[str],
        is_admin: bool,
    ) -> "AuthUser":
        """Create from API key."""
        roles = ["admin"] if is_admin else ["api_user"]
        return cls(
            user_id=user_id,
            username=email,
            email=email,
            roles=roles,
            is_authenticated=True,
            auth_method="api_key",
        )


# Backwards compatibility aliases
AuthenticatedUser = AuthUser
UserContext = AuthUser


class AuthConfig(BaseModel):
    """Authentication configuration."""
    provider: str = "none"  # none, jwt
    required: bool = False  # If True, reject unauthenticated requests
