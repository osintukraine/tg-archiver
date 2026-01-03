"""
Authentication API endpoints.

Provides login endpoints for JWT authentication and user management.
"""

import logging
import os
from datetime import timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from models.base import get_db
from ..auth.factory import get_auth_config, AuthProvider
from ..auth.models import AuthConfig, AuthUser
from ..dependencies import AdminUser, AuthenticatedUser  # Dependency versions
from ..auth.jwt import (
    authenticate_user,
    create_access_token,
    ensure_admin_user,
    JWT_EXPIRATION_MINUTES,
    create_user,
    update_user_password,
    list_users,
    delete_user,
    invalidate_token,
    extract_token_from_request,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class LoginRequest(BaseModel):
    """Login request with username and password."""
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    """JWT token response."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class UserCreateRequest(BaseModel):
    """Create user request."""
    username: str = Field(..., min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    is_admin: bool = False


class PasswordChangeRequest(BaseModel):
    """Change password request."""
    current_password: str = Field(..., min_length=1, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class UserResponse(BaseModel):
    """User information response (without password)."""
    id: int
    username: str
    email: str
    is_active: bool
    is_admin: bool

    class Config:
        from_attributes = True


# ============================================
# LOGIN ENDPOINTS
# ============================================

@router.post("/login", response_model=TokenResponse)
async def login(
    credentials: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    config: AuthConfig = Depends(get_auth_config)
):
    """
    Authenticate user and return JWT access token.

    This endpoint validates username/password credentials against the PostgreSQL
    users table and returns a signed JWT token for subsequent API requests.

    Only available when AUTH_PROVIDER=jwt.

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
    """
    # Only available for JWT provider
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Login endpoint only available with AUTH_PROVIDER=jwt. "
                   f"Current provider: {config.provider}."
        )

    # Ensure admin user exists (creates from env vars if not)
    await ensure_admin_user(db)

    # Authenticate user
    user = await authenticate_user(db, credentials.username, credentials.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Create access token with user info
    access_token_expires = timedelta(minutes=JWT_EXPIRATION_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user.username,
            "user_id": user.id,
            "email": user.email,
            "is_admin": user.is_admin,
        },
        expires_delta=access_token_expires
    )

    logger.info(f"User {credentials.username} logged in successfully")

    # Set cookie for /docs and /redoc browser access
    # Secure flag: True in production (HTTPS), False in development
    is_production = os.getenv("ENVIRONMENT", "development") == "production"
    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=JWT_EXPIRATION_MINUTES * 60,
        httponly=True,
        samesite="strict",  # Strict prevents CSRF attacks
        secure=is_production,  # Only send over HTTPS in production
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=JWT_EXPIRATION_MINUTES * 60  # Convert minutes to seconds
    )


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    current_user: AuthenticatedUser,
    config: AuthConfig = Depends(get_auth_config)
) -> Dict[str, str]:
    """
    Logout and invalidate the current JWT token.

    The token is added to a Redis blacklist until it expires naturally.
    Only available when AUTH_PROVIDER=jwt.
    """
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Logout only available with AUTH_PROVIDER=jwt"
        )

    # Get the token from the request
    token = extract_token_from_request(request)
    if token:
        success = await invalidate_token(token)
        if not success:
            logger.warning(f"Failed to invalidate token for user {current_user.username}")

    # Clear the cookie
    response.delete_cookie(key="access_token")

    logger.info(f"User {current_user.username} logged out")
    return {"message": "Logged out successfully"}


# ============================================
# USER MANAGEMENT ENDPOINTS (Admin Only)
# ============================================

@router.post("/users", response_model=UserResponse)
async def create_user_endpoint(
    user_data: UserCreateRequest,
    current_user: AdminUser,  # Requires admin role
    db: AsyncSession = Depends(get_db),
    config: AuthConfig = Depends(get_auth_config)
):
    """
    Create a new user.

    Requires admin role to access this endpoint.
    Only available when AUTH_PROVIDER=jwt.
    """
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User management only available with AUTH_PROVIDER=jwt"
        )

    try:
        user = await create_user(
            db=db,
            username=user_data.username,
            email=user_data.email,
            password=user_data.password,
            is_admin=user_data.is_admin,
        )
        logger.info(f"User {user_data.username} created by {current_user.username}")
        return UserResponse.model_validate(user)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )


@router.get("/users/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Get current authenticated user's profile information.
    """
    from ..auth.jwt import get_user_by_username

    user = await get_user_by_username(db, current_user.username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    return UserResponse.model_validate(user)


@router.get("/users", response_model=list[UserResponse])
async def list_users_endpoint(
    current_user: AdminUser,  # Requires admin role
    db: AsyncSession = Depends(get_db),
    config: AuthConfig = Depends(get_auth_config)
):
    """
    List all users.

    Requires admin role to access this endpoint.
    Only available when AUTH_PROVIDER=jwt.
    """
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User management only available with AUTH_PROVIDER=jwt"
        )

    users = await list_users(db)
    return [UserResponse.model_validate(user) for user in users]


@router.delete("/users/{user_id}")
async def delete_user_endpoint(
    user_id: int,
    current_user: AdminUser,  # Requires admin role
    db: AsyncSession = Depends(get_db),
    config: AuthConfig = Depends(get_auth_config)
) -> Dict[str, str]:
    """
    Delete a user.

    Requires admin role. Cannot delete yourself.
    Only available when AUTH_PROVIDER=jwt.
    """
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User management only available with AUTH_PROVIDER=jwt"
        )

    # Prevent self-deletion
    if str(user_id) == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )

    success = await delete_user(db, user_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    logger.info(f"User {user_id} deleted by {current_user.username}")
    return {"message": "User deleted successfully"}


@router.post("/users/me/password")
async def change_password(
    password_data: PasswordChangeRequest,
    current_user: AuthenticatedUser,
    db: AsyncSession = Depends(get_db),
    config: AuthConfig = Depends(get_auth_config)
) -> Dict[str, str]:
    """
    Change the current user's password.

    Requires providing the current password for verification.
    Only available when AUTH_PROVIDER=jwt.
    """
    if config.provider != AuthProvider.JWT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password management only available with AUTH_PROVIDER=jwt"
        )

    # Verify current password
    user = await authenticate_user(db, current_user.username, password_data.current_password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password incorrect"
        )

    # Update password
    success = await update_user_password(db, int(current_user.id), password_data.new_password)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update password"
        )

    logger.info(f"User {current_user.username} changed password")

    return {"message": "Password updated successfully"}


# ============================================
# AUTH INFO ENDPOINT
# ============================================

@router.get("/info")
async def get_auth_info(config: AuthConfig = Depends(get_auth_config)) -> Dict[str, Any]:
    """
    Get authentication configuration information for the frontend.

    Returns the active authentication provider and login endpoint.
    """
    info = {
        "provider": config.provider,
        "required": config.required,
    }

    if config.provider == AuthProvider.JWT:
        info["login_endpoint"] = "/api/auth/login"
        info["docs"] = "Use POST /api/auth/login with username/password to get token"
    else:
        info["login_endpoint"] = None
        info["docs"] = "Authentication disabled (AUTH_PROVIDER=none)"

    return info
