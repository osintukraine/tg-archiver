"""
Admin Users API

User management endpoints for local JWT authentication.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

from models.base import get_db
from models.user import User
from ...dependencies import AdminUser
from ...auth.jwt import (
    create_user,
    list_users,
    delete_user,
    update_user_password,
    get_user_by_username,
    get_password_hash,
)
from sqlalchemy import select

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-users"])


# =============================================================================
# Request/Response Models
# =============================================================================


class UserResponse(BaseModel):
    """User response model."""

    id: int
    username: str
    email: str
    is_active: bool
    is_admin: bool
    created_at: str
    last_login: Optional[str] = None

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    """Response for user list."""

    users: List[UserResponse]
    total: int


class CreateUserRequest(BaseModel):
    """Request body for creating a user."""

    username: str
    email: EmailStr
    password: str
    is_admin: bool = False


class UpdateUserRequest(BaseModel):
    """Request body for updating a user."""

    email: Optional[EmailStr] = None
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None
    password: Optional[str] = None


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    success: bool = True


# =============================================================================
# User Endpoints
# =============================================================================


@router.get("/users", response_model=UserListResponse)
async def list_users_admin(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    List all users with pagination.

    Requires admin role.
    """
    users = await list_users(db)

    user_responses = [
        UserResponse(
            id=u.id,
            username=u.username,
            email=u.email,
            is_active=u.is_active,
            is_admin=u.is_admin,
            created_at=u.created_at.isoformat() if u.created_at else "",
            last_login=u.last_login.isoformat() if u.last_login else None,
        )
        for u in users
    ]

    return UserListResponse(
        users=user_responses,
        total=len(user_responses),
    )


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user_admin(
    user_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed information about a specific user.

    Requires admin role.
    """
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        is_active=user.is_active,
        is_admin=user.is_admin,
        created_at=user.created_at.isoformat() if user.created_at else "",
        last_login=user.last_login.isoformat() if user.last_login else None,
    )


@router.post("/users", response_model=UserResponse, status_code=201)
async def create_user_admin(
    body: CreateUserRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new user.

    Requires admin role.
    """
    try:
        user = await create_user(
            db=db,
            username=body.username,
            email=body.email,
            password=body.password,
            is_admin=body.is_admin,
        )

        logger.info(f"User created: {body.username} by admin {admin.username}")

        return UserResponse(
            id=user.id,
            username=user.username,
            email=user.email,
            is_active=user.is_active,
            is_admin=user.is_admin,
            created_at=user.created_at.isoformat() if user.created_at else "",
            last_login=None,
        )

    except ValueError as e:
        raise HTTPException(
            status_code=409,
            detail=str(e),
        )


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user_admin(
    user_id: int,
    body: UpdateUserRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Update user with partial field updates.

    Requires admin role. Admins cannot demote themselves.
    """
    # Prevent admin from demoting themselves
    if str(user_id) == admin.id and body.is_admin is False:
        raise HTTPException(
            status_code=400,
            detail="Cannot demote yourself. Ask another admin to change your role.",
        )

    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if demoting last admin
    if body.is_admin is False and user.is_admin:
        admin_count_result = await db.execute(
            select(User).where(User.is_admin == True)
        )
        admins = admin_count_result.scalars().all()
        if len(admins) <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot demote the last admin. Create another admin first.",
            )

    # Update fields
    if body.email is not None:
        user.email = body.email
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.password is not None:
        user.hashed_password = get_password_hash(body.password)

    await db.commit()
    await db.refresh(user)

    logger.info(f"User updated: {user_id} by admin {admin.username}")

    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        is_active=user.is_active,
        is_admin=user.is_admin,
        created_at=user.created_at.isoformat() if user.created_at else "",
        last_login=user.last_login.isoformat() if user.last_login else None,
    )


@router.delete("/users/{user_id}", response_model=MessageResponse)
async def delete_user_admin(
    user_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
):
    """
    Permanently delete a user.

    Requires admin role. Admins cannot delete themselves.
    """
    # Prevent admin from deleting themselves
    if str(user_id) == admin.id:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete yourself. Ask another admin to remove your account.",
        )

    # Check if deleting last admin
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.is_admin:
        admin_count_result = await db.execute(
            select(User).where(User.is_admin == True)
        )
        admins = admin_count_result.scalars().all()
        if len(admins) <= 1:
            raise HTTPException(
                status_code=400,
                detail="Cannot delete the last admin. Create another admin first.",
            )

    success = await delete_user(db, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="User not found")

    logger.info(f"User deleted: {user_id} by admin {admin.username}")
    return MessageResponse(message=f"User {user_id} deleted successfully")
