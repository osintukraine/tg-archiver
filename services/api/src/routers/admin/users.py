"""
Admin Users API

User management endpoints powered by Ory Kratos Admin API.
Provides identity and session management for admin users.
"""

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ...dependencies import AdminUser
from ...kratos import get_kratos_client, KratosAdminClient
from ...kratos.admin_client import KratosAPIError, KratosConnectionError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-users"])


# =============================================================================
# Request/Response Models
# =============================================================================


class UserTraits(BaseModel):
    """User traits for display."""

    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    organization: Optional[str] = None


class UserResponse(BaseModel):
    """User response model."""

    id: str
    email: str
    display_name: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    organization: Optional[str] = None
    role: str = "viewer"
    state: str = "active"
    verified: bool = False
    created_at: str
    updated_at: str


class UserListResponse(BaseModel):
    """Response for user list."""

    users: List[UserResponse]
    total: int
    page: int
    per_page: int


class CreateUserRequest(BaseModel):
    """Request body for creating a user."""

    email: str  # Using str instead of EmailStr to allow .local domains
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    organization: Optional[str] = None
    role: str = Field(default="viewer", pattern="^(admin|analyst|viewer)$")


class UpdateUserRequest(BaseModel):
    """Request body for updating a user."""

    email: Optional[str] = None  # Using str instead of EmailStr to allow .local domains
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    organization: Optional[str] = None
    role: Optional[str] = Field(default=None, pattern="^(admin|analyst|viewer)$")
    state: Optional[str] = Field(default=None, pattern="^(active|inactive)$")


class SessionResponse(BaseModel):
    """Session response model."""

    id: str
    active: bool
    authenticated_at: Optional[str] = None
    expires_at: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None


class SessionListResponse(BaseModel):
    """Response for session list."""

    sessions: List[SessionResponse]
    total: int


class RecoveryLinkResponse(BaseModel):
    """Response for recovery link creation."""

    recovery_link: str
    expires_at: str


class MessageResponse(BaseModel):
    """Generic message response."""

    message: str
    success: bool = True


# =============================================================================
# Helper Functions
# =============================================================================


def identity_to_user_response(identity) -> UserResponse:
    """
    Convert Kratos Identity object to UserResponse schema.

    Extracts user traits including name components, email, organization, and
    verification status from Ory Kratos identity structure. Handles nested
    trait structures and verifiable address verification status.

    Args:
        identity: Ory Kratos Identity object containing user data

    Returns:
        UserResponse with normalized user data including verification status
    """
    traits = identity.traits
    name = traits.get("name", {}) or {}

    # Check verified status from verifiable_addresses
    verified = False
    if identity.verifiable_addresses:
        verified = any(
            addr.get("verified", False)
            for addr in identity.verifiable_addresses
        )

    return UserResponse(
        id=identity.id,
        email=traits.get("email", ""),
        display_name=identity.display_name,
        first_name=name.get("first"),
        last_name=name.get("last"),
        organization=traits.get("organization"),
        role=identity.role,
        state=identity.state,
        verified=verified,
        created_at=identity.created_at.isoformat(),
        updated_at=identity.updated_at.isoformat(),
    )


def session_to_response(session) -> SessionResponse:
    """
    Convert Kratos Session object to SessionResponse schema.

    Extracts session metadata including authentication timestamps, expiration,
    and device information (IP address, user agent) if available.

    Args:
        session: Ory Kratos Session object containing session data

    Returns:
        SessionResponse with session details and device information
    """
    # Extract device info if available
    ip_address = None
    user_agent = None
    if session.devices:
        device = session.devices[0] if session.devices else {}
        ip_address = device.get("ip_address")
        user_agent = device.get("user_agent")

    return SessionResponse(
        id=session.id,
        active=session.active,
        authenticated_at=session.authenticated_at.isoformat() if session.authenticated_at else None,
        expires_at=session.expires_at.isoformat() if session.expires_at else None,
        ip_address=ip_address,
        user_agent=user_agent,
    )


def get_kratos() -> KratosAdminClient:
    """
    FastAPI dependency for injecting Ory Kratos admin client.

    Provides a configured KratosAdminClient instance for interacting with
    the Ory Kratos Admin API for identity and session management.

    Returns:
        KratosAdminClient instance configured for admin operations
    """
    return get_kratos_client()


# =============================================================================
# User Endpoints
# =============================================================================


@router.get("/users", response_model=UserListResponse)
async def list_users(
    admin: AdminUser,
    page: int = 1,
    per_page: int = 50,
    search: Optional[str] = None,
    role: Optional[str] = None,
    state: Optional[str] = None,
    kratos: KratosAdminClient = Depends(get_kratos),
):
    """
    List all users with optional filtering and pagination.

    Retrieves user identities from Ory Kratos with server-side pagination and
    email search. Role and state filtering is performed client-side after fetch
    due to Kratos API limitations.

    Note: Kratos only supports credentials_identifier (email) filtering on the
    server side. Role and state filters are applied after fetching results.

    Args:
        admin: Authenticated admin user (injected dependency)
        page: Page number (1-indexed)
        per_page: Items per page (max 100, default 50)
        search: Optional email search filter (partial match)
        role: Optional role filter (admin, analyst, viewer)
        state: Optional state filter (active, inactive)
        kratos: Kratos admin client (injected dependency)

    Returns:
        UserListResponse with paginated user list and total count

    Raises:
        HTTPException 503: Kratos identity service unavailable
        HTTPException 4xx: Kratos API error with original status code
    """
    try:
        # Kratos doesn't support role/state filtering, we filter client-side
        logger.info(f"Fetching identities from Kratos: page={page}, per_page={per_page}, search={search}")
        identities = await kratos.list_identities(
            page=page,
            per_page=min(per_page, 100),
            credentials_identifier=search,
        )
        logger.info(f"Got {len(identities)} identities from Kratos")

        users = [identity_to_user_response(i) for i in identities]
        logger.info(f"Returning {len(users)} users")

        # Client-side filtering for role and state
        if role:
            users = [u for u in users if u.role == role]
        if state:
            users = [u for u in users if u.state == state]

        return UserListResponse(
            users=users,
            total=len(users),
            page=page,
            per_page=per_page,
        )

    except KratosConnectionError as e:
        logger.error(f"Kratos connection error: {e}")
        raise HTTPException(
            status_code=503,
            detail="Identity service unavailable",
        )
    except KratosAPIError as e:
        logger.error(f"Kratos API error: {e}")
        raise HTTPException(
            status_code=e.status_code,
            detail=e.message,
        )


@router.get("/users/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    admin: AdminUser,
    kratos: KratosAdminClient = Depends(get_kratos),
):
    """
    Get detailed information about a specific user.

    Retrieves a single user identity from Ory Kratos by identity ID, including
    all traits, verification status, role, and state information.

    Args:
        user_id: Kratos identity ID (UUID)
        admin: Authenticated admin user (injected dependency)
        kratos: Kratos admin client (injected dependency)

    Returns:
        UserResponse with full user details

    Raises:
        HTTPException 404: User not found
        HTTPException 503: Kratos identity service unavailable
        HTTPException 4xx: Kratos API error with original status code
    """
    try:
        identity = await kratos.get_identity(user_id)
        return identity_to_user_response(identity)

    except KratosAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="User not found")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except KratosConnectionError:
        raise HTTPException(status_code=503, detail="Identity service unavailable")


@router.post("/users", response_model=UserResponse, status_code=201)
async def create_user(
    body: CreateUserRequest,
    admin: AdminUser,
    kratos: KratosAdminClient = Depends(get_kratos),
):
    """
    Create a new user identity in Ory Kratos.

    Creates a user with specified email, name, organization, and role. The user
    is created in unverified state and must complete email verification and
    password setup via the recovery flow (use create_recovery_link endpoint).

    Email domains including .local are supported for development/testing.

    Args:
        body: User creation request with email, name, organization, and role
        admin: Authenticated admin user (injected dependency)
        kratos: Kratos admin client (injected dependency)

    Returns:
        UserResponse with newly created user details (unverified state)

    Raises:
        HTTPException 409: User with this email already exists
        HTTPException 503: Kratos identity service unavailable
        HTTPException 4xx: Kratos API error with original status code
    """
    try:
        identity = await kratos.create_identity(
            email=body.email,
            first_name=body.first_name,
            last_name=body.last_name,
            organization=body.organization,
            role=body.role,
        )

        logger.info(f"User created: {body.email} by admin {admin.id}")
        return identity_to_user_response(identity)

    except KratosAPIError as e:
        if "already exists" in e.message.lower():
            raise HTTPException(
                status_code=409,
                detail="A user with this email already exists",
            )
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except KratosConnectionError:
        raise HTTPException(status_code=503, detail="Identity service unavailable")


@router.put("/users/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    body: UpdateUserRequest,
    admin: AdminUser,
    request: Request,
    kratos: KratosAdminClient = Depends(get_kratos),
):
    """
    Update user identity with partial field updates.

    Supports partial updates - only provided fields are changed. Includes
    safety checks to prevent admins from demoting themselves or demoting/
    deleting the last admin account.

    Business Logic:
    - Admins cannot demote themselves (must ask another admin)
    - Cannot demote last remaining admin (must create another admin first)
    - All other fields support partial updates

    Args:
        user_id: Kratos identity ID (UUID)
        body: Update request with optional fields to change
        admin: Authenticated admin user (injected dependency)
        request: FastAPI request object for extracting current user ID
        kratos: Kratos admin client (injected dependency)

    Returns:
        UserResponse with updated user details

    Raises:
        HTTPException 400: Cannot demote self or last admin
        HTTPException 404: User not found
        HTTPException 503: Kratos identity service unavailable
        HTTPException 4xx: Kratos API error with original status code
    """
    # Prevent admin from demoting themselves
    current_user_id = getattr(request.state, "user", {})
    if hasattr(current_user_id, "id"):
        current_user_id = current_user_id.id

    if user_id == str(current_user_id) and body.role and body.role != "admin":
        raise HTTPException(
            status_code=400,
            detail="Cannot demote yourself. Ask another admin to change your role.",
        )

    try:
        # Check if demoting last admin
        if body.role and body.role != "admin":
            current_identity = await kratos.get_identity(user_id)
            if current_identity.role == "admin":
                # Count admins
                all_identities = await kratos.list_identities(per_page=1000)
                admin_count = sum(
                    1 for i in all_identities
                    if i.metadata_public and i.metadata_public.get("role") == "admin"
                )
                if admin_count <= 1:
                    raise HTTPException(
                        status_code=400,
                        detail="Cannot demote the last admin. Create another admin first.",
                    )

        identity = await kratos.update_identity(
            identity_id=user_id,
            email=body.email,
            first_name=body.first_name,
            last_name=body.last_name,
            organization=body.organization,
            role=body.role,
            state=body.state,
        )

        logger.info(f"User updated: {user_id} by admin {admin.id}")
        return identity_to_user_response(identity)

    except KratosAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="User not found")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except KratosConnectionError:
        raise HTTPException(status_code=503, detail="Identity service unavailable")


@router.delete("/users/{user_id}", response_model=MessageResponse)
async def delete_user(
    user_id: str,
    admin: AdminUser,
    request: Request,
    kratos: KratosAdminClient = Depends(get_kratos),
):
    """
    Permanently delete a user identity and all associated sessions.

    Removes the user from Ory Kratos, invalidating all active sessions.
    Includes safety checks to prevent admins from deleting themselves or
    deleting the last admin account.

    Warning: This operation is permanent and cannot be undone.

    Business Logic:
    - Admins cannot delete themselves (must ask another admin)
    - Cannot delete last remaining admin (must create another admin first)

    Args:
        user_id: Kratos identity ID (UUID)
        admin: Authenticated admin user (injected dependency)
        request: FastAPI request object for extracting current user ID
        kratos: Kratos admin client (injected dependency)

    Returns:
        MessageResponse confirming successful deletion

    Raises:
        HTTPException 400: Cannot delete self or last admin
        HTTPException 404: User not found
        HTTPException 503: Kratos identity service unavailable
        HTTPException 4xx: Kratos API error with original status code
    """
    # Prevent admin from deleting themselves
    current_user_id = getattr(request.state, "user", {})
    if hasattr(current_user_id, "id"):
        current_user_id = current_user_id.id

    if user_id == str(current_user_id):
        raise HTTPException(
            status_code=400,
            detail="Cannot delete yourself. Ask another admin to remove your account.",
        )

    try:
        # Check if deleting last admin
        identity = await kratos.get_identity(user_id)
        if identity.role == "admin":
            all_identities = await kratos.list_identities(per_page=1000)
            admin_count = sum(
                1 for i in all_identities
                if i.metadata_public and i.metadata_public.get("role") == "admin"
            )
            if admin_count <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot delete the last admin. Create another admin first.",
                )

        await kratos.delete_identity(user_id)

        logger.info(f"User deleted: {user_id} by admin {admin.id}")
        return MessageResponse(message=f"User {user_id} deleted successfully")

    except KratosAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="User not found")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except KratosConnectionError:
        raise HTTPException(status_code=503, detail="Identity service unavailable")


# =============================================================================
# Session Endpoints
# =============================================================================


@router.get("/users/{user_id}/sessions", response_model=SessionListResponse)
async def list_user_sessions(
    user_id: str,
    admin: AdminUser,
    kratos: KratosAdminClient = Depends(get_kratos),
):
    """
    List all active and expired sessions for a user.

    Retrieves session information including authentication timestamps,
    expiration times, IP addresses, and user agents for audit and security
    monitoring purposes.

    Args:
        user_id: Kratos identity ID (UUID)
        admin: Authenticated admin user (injected dependency)
        kratos: Kratos admin client (injected dependency)

    Returns:
        SessionListResponse with list of sessions and total count

    Raises:
        HTTPException 404: User not found
        HTTPException 503: Kratos identity service unavailable
        HTTPException 4xx: Kratos API error with original status code
    """
    try:
        sessions = await kratos.list_sessions(identity_id=user_id)
        return SessionListResponse(
            sessions=[session_to_response(s) for s in sessions],
            total=len(sessions),
        )

    except KratosAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="User not found")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except KratosConnectionError:
        raise HTTPException(status_code=503, detail="Identity service unavailable")


@router.delete(
    "/users/{user_id}/sessions/{session_id}",
    response_model=MessageResponse,
)
async def revoke_session(
    user_id: str,
    session_id: str,
    admin: AdminUser,
    kratos: KratosAdminClient = Depends(get_kratos),
):
    """
    Revoke a specific user session, forcing logout.

    Immediately invalidates the specified session, logging the user out from
    that device/browser. Useful for security responses or remote logout.

    Args:
        user_id: Kratos identity ID (UUID) - used for audit logging
        session_id: Kratos session ID to revoke
        admin: Authenticated admin user (injected dependency)
        kratos: Kratos admin client (injected dependency)

    Returns:
        MessageResponse confirming session revocation

    Raises:
        HTTPException 404: Session not found
        HTTPException 503: Kratos identity service unavailable
        HTTPException 4xx: Kratos API error with original status code
    """
    try:
        await kratos.revoke_session(session_id)

        logger.info(
            f"Session revoked: {session_id} for user {user_id} by admin {admin.id}"
        )
        return MessageResponse(message="Session revoked successfully")

    except KratosAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="Session not found")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except KratosConnectionError:
        raise HTTPException(status_code=503, detail="Identity service unavailable")


@router.delete("/users/{user_id}/sessions", response_model=MessageResponse)
async def revoke_all_sessions(
    user_id: str,
    admin: AdminUser,
    kratos: KratosAdminClient = Depends(get_kratos),
):
    """
    Revoke all sessions for a user, forcing logout from all devices.

    Immediately invalidates all active and expired sessions for the specified
    user, logging them out from all browsers and devices. Useful for security
    incidents, password resets, or account compromise responses.

    Args:
        user_id: Kratos identity ID (UUID)
        admin: Authenticated admin user (injected dependency)
        kratos: Kratos admin client (injected dependency)

    Returns:
        MessageResponse confirming all sessions revoked

    Raises:
        HTTPException 404: User not found
        HTTPException 503: Kratos identity service unavailable
        HTTPException 4xx: Kratos API error with original status code
    """
    try:
        await kratos.revoke_identity_sessions(user_id)

        logger.info(
            f"All sessions revoked for user {user_id} by admin {admin.id}"
        )
        return MessageResponse(message="All sessions revoked successfully")

    except KratosAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="User not found")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except KratosConnectionError:
        raise HTTPException(status_code=503, detail="Identity service unavailable")


# =============================================================================
# Recovery Endpoints
# =============================================================================


@router.post(
    "/users/{user_id}/recovery-link",
    response_model=RecoveryLinkResponse,
)
async def create_recovery_link(
    user_id: str,
    admin: AdminUser,
    kratos: KratosAdminClient = Depends(get_kratos),
):
    """
    Create a password recovery link for initial password setup or reset.

    Generates a one-time recovery link that allows the user to set/reset their
    password via the Ory Kratos recovery flow. This is the standard method for
    new user onboarding (admins create accounts without passwords, then send
    recovery links).

    The recovery link expires in 1 hour by default (configurable in Kratos).

    Use Cases:
    - New user onboarding: Create user, then send recovery link for password setup
    - Password reset: Generate link for users who forgot their password
    - Account recovery: Reset access for locked accounts

    Args:
        user_id: Kratos identity ID (UUID)
        admin: Authenticated admin user (injected dependency)
        kratos: Kratos admin client (injected dependency)

    Returns:
        RecoveryLinkResponse with recovery URL and expiration timestamp

    Raises:
        HTTPException 404: User not found
        HTTPException 503: Kratos identity service unavailable
        HTTPException 4xx: Kratos API error with original status code
    """
    try:
        result = await kratos.create_recovery_link(user_id)

        logger.info(
            f"Recovery link created for user {user_id} by admin {admin.id}"
        )
        return RecoveryLinkResponse(
            recovery_link=result.recovery_link,
            expires_at=result.expires_at.isoformat(),
        )

    except KratosAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="User not found")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except KratosConnectionError:
        raise HTTPException(status_code=503, detail="Identity service unavailable")
