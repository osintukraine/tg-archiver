"""
User-specific endpoints (profile, preferences, etc.).

Provides endpoints for user profile information and preferences.
"""

from typing import Dict, Any
from fastapi import APIRouter
from pydantic import BaseModel

from ..dependencies import CurrentUser, AuthenticatedUser

router = APIRouter(prefix="/api/user", tags=["user"])


class UserInfo(BaseModel):
    """User information response model."""
    user_id: str | None
    email: str | None
    role: str
    is_authenticated: bool
    is_admin: bool


class UserPreferences(BaseModel):
    """User preferences response model."""
    user_id: str
    preferences: Dict[str, Any]


@router.get("/me", response_model=UserInfo)
async def get_current_user_info(user: CurrentUser):
    """
    Get current user information.

    Works for both anonymous and authenticated users.
    Anonymous users will have user_id=None, is_authenticated=False.

    Args:
        user: Current user context (injected, works for anonymous)

    Returns:
        UserInfo with user details and authentication status
    """
    return UserInfo(
        user_id=str(user.user_id) if user.user_id else None,
        email=user.email,
        role=user.role,
        is_authenticated=user.is_authenticated,
        is_admin=user.is_admin,
    )


@router.get("/preferences", response_model=UserPreferences)
async def get_preferences(user: AuthenticatedUser):
    """
    Get user preferences.

    Requires authentication.

    Args:
        user: Current authenticated user (injected)

    Returns:
        User preferences object

    TODO: Implement database query when user_preferences table exists
    Currently returns empty preferences
    """
    # TODO: Implement database query
    # from models.user import UserPreference
    #
    # result = await db.execute(
    #     select(UserPreference).where(UserPreference.user_id == user.user_id)
    # )
    # prefs = result.scalar_one_or_none()
    #
    # return UserPreferences(
    #     user_id=str(user.user_id),
    #     preferences=prefs.preferences if prefs else {}
    # )

    return UserPreferences(
        user_id=str(user.user_id),
        preferences={
            "note": "Placeholder implementation - database schema not yet created"
        },
    )


@router.put("/preferences", response_model=UserPreferences)
async def update_preferences(
    preferences: Dict[str, Any],
    user: AuthenticatedUser,
):
    """
    Update user preferences.

    Requires authentication.

    Args:
        preferences: Dictionary of preference key-value pairs
        user: Current authenticated user (injected)

    Returns:
        Updated user preferences

    TODO: Implement database update when user_preferences table exists
    Currently returns the input preferences without persisting
    """
    # TODO: Implement database update
    # from models.user import UserPreference
    #
    # result = await db.execute(
    #     select(UserPreference).where(UserPreference.user_id == user.user_id)
    # )
    # user_pref = result.scalar_one_or_none()
    #
    # if not user_pref:
    #     user_pref = UserPreference(
    #         user_id=user.user_id,
    #         preferences=preferences
    #     )
    #     db.add(user_pref)
    # else:
    #     user_pref.preferences = preferences
    #
    # await db.commit()
    # await db.refresh(user_pref)

    return UserPreferences(
        user_id=str(user.user_id),
        preferences={
            **preferences,
            "note": "Placeholder implementation - not persisted to database"
        },
    )
