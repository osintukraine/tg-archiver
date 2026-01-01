"""
Authentication API endpoints.

Provides login endpoints for JWT authentication and user management.
"""

import logging
from datetime import timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.factory import get_auth_config, AuthProvider
from ..auth.models import AuthConfig, AuthUser
from ..dependencies import AdminUser, AuthenticatedUser  # Dependency versions
from ..auth.jwt import (
    authenticate_user,
    create_access_token,
    JWT_EXPIRATION_MINUTES,
    create_user,
    update_user_password,
    get_user,
    list_users,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class LoginRequest(BaseModel):
    """Login request with username and password."""
    username: str
    password: str


class TokenResponse(BaseModel):
    """JWT token response."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class UserCreateRequest(BaseModel):
    """Create user request."""
    username: str
    password: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    roles: Optional[list[str]] = None


class PasswordChangeRequest(BaseModel):
    """Change password request."""
    current_password: str
    new_password: str


class UserResponse(BaseModel):
    """User information response (without password)."""
    id: str
    username: str
    email: Optional[str] = None
    display_name: Optional[str] = None
    roles: list[str] = []


# ============================================
# LOGIN ENDPOINTS (JWT Provider Only)
# ============================================

@router.post("/login", response_model=TokenResponse)
async def login(
    credentials: LoginRequest,
    config: AuthConfig = Depends(get_auth_config)
):
    """
    Authenticate user and return JWT access token.

    This endpoint validates username/password credentials against the local JWT user
    database (users.json) and returns a signed JWT token for subsequent API requests.
    The token includes the username as the subject claim and is valid for JWT_EXPIRATION_MINUTES.

    Only available when AUTH_PROVIDER=jwt. Other providers (Cloudron, Ory) use their own
    authentication flows and do not use this endpoint.

    Example:
        ```bash
        curl -X POST http://localhost:8000/api/auth/login \\
          -H "Content-Type: application/json" \\
          -d '{"username": "admin", "password": "your-password"}'
        ```

    Use the returned access_token in subsequent requests:
        ```bash
        curl http://localhost:8000/api/messages \\
          -H "Authorization: Bearer YOUR_TOKEN_HERE"
        ```

    Args:
        credentials: LoginRequest containing username and password
        config: Authentication configuration (injected dependency)

    Returns:
        TokenResponse with access_token, token_type, and expires_in (seconds)

    Raises:
        HTTPException 400: If AUTH_PROVIDER is not 'jwt'
        HTTPException 401: If username or password is incorrect
    """
    # Only available for JWT provider
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Login endpoint only available with AUTH_PROVIDER=jwt. "
                   f"Current provider: {config.provider}. "
                   f"For Cloudron, use Cloudron's OAuth flow. "
                   f"For Ory, use Ory Kratos self-service UI."
        )

    # Authenticate user
    user = authenticate_user(credentials.username, credentials.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Create access token
    access_token_expires = timedelta(minutes=JWT_EXPIRATION_MINUTES)
    access_token = create_access_token(
        data={"sub": user["username"]},
        expires_delta=access_token_expires
    )

    logger.info(f"User {credentials.username} logged in successfully")

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=JWT_EXPIRATION_MINUTES * 60  # Convert minutes to seconds
    )


# ============================================
# USER MANAGEMENT ENDPOINTS (Admin Only)
# ============================================

@router.post("/users", response_model=UserResponse)
async def create_user_endpoint(
    user_data: UserCreateRequest,
    current_user: AdminUser,  # Requires admin role
    config: AuthConfig = Depends(get_auth_config)
):
    """
    Create a new user in the JWT user database.

    Adds a new user to the local users.json file with hashed password (bcrypt).
    The username must be unique. Default role is 'viewer' if not specified.

    Only available when AUTH_PROVIDER=jwt. Other providers manage users through
    their own systems (Cloudron admin panel, Ory Kratos identity management).

    Requires admin role to access this endpoint.

    Args:
        user_data: UserCreateRequest with username, password, email (optional),
                   display_name (optional), and roles (optional)
        current_user: Authenticated admin user (injected dependency)
        config: Authentication configuration (injected dependency)

    Returns:
        UserResponse with created user information (password excluded)

    Raises:
        HTTPException 400: If AUTH_PROVIDER is not 'jwt'
        HTTPException 401: If not authenticated
        HTTPException 403: If not admin role
        HTTPException 409: If username already exists in users.json
    """
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User management only available with AUTH_PROVIDER=jwt"
        )

    # Admin check is handled by AdminUser dependency

    try:
        user = create_user(
            username=user_data.username,
            password=user_data.password,
            email=user_data.email,
            display_name=user_data.display_name,
            roles=user_data.roles or ["viewer"]
        )
        logger.info(f"User {user_data.username} created successfully")
        return UserResponse(**user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )


@router.get("/users/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: AuthenticatedUser,  # Requires authentication
):
    """
    Get current authenticated user's profile information.

    Returns the authenticated user's profile including ID, username, email,
    display_name, and roles. Works with all authentication providers (JWT,
    Cloudron, Ory). The user information is extracted from the JWT token,
    Cloudron session, or Ory session depending on the active provider.

    Args:
        current_user: Authenticated user (injected by AuthenticatedUser dependency)

    Returns:
        UserResponse with current user's profile information (password excluded)

    Raises:
        HTTPException 401: If not authenticated or token is invalid/expired
    """
    # AuthenticatedUser dependency handles 401 if not authenticated

    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        display_name=current_user.display_name,
        roles=current_user.roles
    )


@router.get("/users", response_model=list[UserResponse])
async def list_users_endpoint(
    current_user: AdminUser,  # Requires admin role
    config: AuthConfig = Depends(get_auth_config)
):
    """
    List all users in the JWT user database.

    Retrieves all users from the local users.json file and returns their
    profile information (passwords excluded). Intended for admin user management.

    Only available when AUTH_PROVIDER=jwt. Other providers manage users through
    their own systems and do not expose user lists via this API.

    Requires admin role to access this endpoint.

    Args:
        current_user: Authenticated admin user (injected by AdminUser dependency)
        config: Authentication configuration (injected dependency)

    Returns:
        List of UserResponse objects with all users' information (passwords excluded)

    Raises:
        HTTPException 400: If AUTH_PROVIDER is not 'jwt'
        HTTPException 401: If not authenticated
        HTTPException 403: If not admin role
    """
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User management only available with AUTH_PROVIDER=jwt"
        )

    # Admin check is handled by AdminUser dependency

    users = list_users()
    return [UserResponse(**user) for user in users]


@router.post("/users/me/password")
async def change_password(
    password_data: PasswordChangeRequest,
    current_user: AuthenticatedUser,  # Requires authentication
    config: AuthConfig = Depends(get_auth_config)
) -> Dict[str, str]:
    """
    Change the current user's password.

    Validates the current password, then updates the user's password in the local
    users.json file with a new bcrypt hash. Requires the user to provide their
    current password for security verification before allowing the change.

    Only available when AUTH_PROVIDER=jwt. Other providers manage passwords through
    their own systems (Cloudron user settings, Ory Kratos self-service flows).

    Args:
        password_data: PasswordChangeRequest with current_password and new_password
        current_user: Authenticated user (injected dependency)
        config: Authentication configuration (injected dependency)

    Returns:
        Dictionary with success message: {"message": "Password updated successfully"}

    Raises:
        HTTPException 400: If AUTH_PROVIDER is not 'jwt'
        HTTPException 401: If not authenticated or current password is incorrect
        HTTPException 500: If password update fails (file write error)
    """
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password management only available with AUTH_PROVIDER=jwt"
        )

    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )

    # Verify current password
    user = authenticate_user(current_user.username, password_data.current_password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password incorrect"
        )

    # Update password
    success = update_user_password(current_user.username, password_data.new_password)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update password"
        )

    logger.info(f"User {current_user.username} changed password")

    return {"message": "Password updated successfully"}


# ============================================
# AUTH INFO ENDPOINT (All Providers)
# ============================================

@router.get("/info")
async def get_auth_info(config: AuthConfig = Depends(get_auth_config)) -> Dict[str, Any]:
    """
    Get authentication configuration information for the frontend.

    Returns the active authentication provider, whether authentication is required,
    and provider-specific endpoints/documentation. This allows the frontend to
    dynamically adapt its authentication flow based on the backend configuration.

    Works with all authentication providers (JWT, Cloudron, Ory, none).

    Args:
        config: Authentication configuration (injected dependency)

    Returns:
        Dictionary with provider, required flag, login_endpoint, and docs:
        - provider: 'jwt' | 'cloudron' | 'ory' | 'none'
        - required: boolean indicating if authentication is mandatory
        - login_endpoint: URL for authentication (provider-specific)
        - docs: Human-readable documentation string

    Example Response (JWT):
        ```json
        {
            "provider": "jwt",
            "required": true,
            "login_endpoint": "/api/auth/login",
            "docs": "Use POST /api/auth/login with username/password to get token"
        }
        ```

    Example Response (Cloudron):
        ```json
        {
            "provider": "cloudron",
            "required": true,
            "login_endpoint": "https://your-cloudron-domain/api/v1/oauth/dialog/authorize",
            "docs": "Cloudron handles authentication via OAuth2"
        }
        ```
    """
    info = {
        "provider": config.provider,
        "required": config.required,
    }

    # Add provider-specific info
    if config.provider == AuthProvider.JWT:
        info["login_endpoint"] = "/api/auth/login"
        info["docs"] = "Use POST /api/auth/login with username/password to get token"

    elif config.provider == AuthProvider.CLOUDRON:
        info["login_endpoint"] = "https://your-cloudron-domain/api/v1/oauth/dialog/authorize"
        info["docs"] = "Cloudron handles authentication via OAuth2"

    elif config.provider == AuthProvider.ORY:
        info["login_endpoint"] = f"{config.ory_kratos_public_url}/self-service/login/browser"
        info["docs"] = "Ory Kratos handles authentication via self-service flows"

    else:
        info["login_endpoint"] = None
        info["docs"] = "Authentication disabled (AUTH_PROVIDER=none)"

    return info
