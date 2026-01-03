"""
JWT Authentication Provider.

Implements standalone JWT (JSON Web Token) authentication with PostgreSQL user storage.
Uses PyJWT library (actively maintained, replacing python-jose).

Features:
- JWT token generation and validation
- Password hashing with bcrypt
- Token expiration and refresh
- User management stored in PostgreSQL
- Initial admin user from environment variables
- Token invalidation via Redis blacklist
- Configurable fail mode for token blacklist

Security:
- Passwords hashed with bcrypt (cost factor 12)
- JWT tokens signed with HS256
- Token expiration enforced
- Secure password validation
- Logout invalidates tokens via Redis blacklist
"""

import logging
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import HTTPException, Request, status
import jwt
from jwt.exceptions import InvalidTokenError, ExpiredSignatureError
from passlib.context import CryptContext
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as aioredis

from .models import AuthenticatedUser
from config.settings import settings

logger = logging.getLogger(__name__)

# Password hashing context (bcrypt)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# =============================================================================
# JWT Configuration (from environment variables)
# =============================================================================

# Secret key for JWT token signing (required for production)
# Generate with: openssl rand -hex 64
# Minimum length: 32 characters
# Environment variable: JWT_SECRET_KEY (required if AUTH_PROVIDER=jwt)
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")

# JWT signing algorithm (HS256 recommended for symmetric keys)
# Environment variable: JWT_ALGORITHM (default: HS256)
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

# Token expiration time in minutes
# Environment variable: JWT_EXPIRATION_MINUTES (default: 60)
JWT_EXPIRATION_MINUTES = int(os.getenv("JWT_EXPIRATION_MINUTES", "60"))

# Default admin credentials from environment
# Environment variable: JWT_ADMIN_EMAIL (default: admin@tg-archiver.local)
JWT_ADMIN_EMAIL = os.getenv("JWT_ADMIN_EMAIL", "admin@tg-archiver.local")
# Environment variable: JWT_ADMIN_PASSWORD (required for admin access)
JWT_ADMIN_PASSWORD = os.getenv("JWT_ADMIN_PASSWORD", "")

# Token blacklist key prefix
TOKEN_BLACKLIST_PREFIX = "jwt:blacklist:"

# Token blacklist fail mode: "open" (allow if Redis down) or "closed" (deny if Redis down)
# "open" prioritizes availability, "closed" prioritizes security
TOKEN_BLACKLIST_FAIL_MODE = os.getenv("TOKEN_BLACKLIST_FAIL_MODE", "open").lower()

# Redis client for token blacklist
_redis_client: Optional[aioredis.Redis] = None


async def get_redis_client() -> Optional[aioredis.Redis]:
    """Get or create Redis client for token blacklist."""
    global _redis_client
    if _redis_client is None:
        try:
            _redis_client = aioredis.from_url(
                settings.redis_url,
                password=settings.redis_password or None,
                decode_responses=True,
                socket_timeout=1.0,
            )
            await _redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis connection failed for token blacklist: {e}")
            _redis_client = None
    return _redis_client


async def invalidate_token(token: str) -> bool:
    """
    Add a token to the blacklist.

    Args:
        token: JWT token to invalidate

    Returns:
        True if successfully blacklisted, False if Redis unavailable
    """
    try:
        # Decode token to get expiration time
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        exp = payload.get("exp")
        if not exp:
            return False

        # Calculate TTL (time until token expires naturally)
        ttl = int(exp - datetime.utcnow().timestamp())
        if ttl <= 0:
            return True  # Already expired, no need to blacklist

        redis_client = await get_redis_client()
        if redis_client is None:
            logger.warning("Cannot invalidate token: Redis unavailable")
            return False

        # Store token JTI or hash in blacklist with expiration
        # Use token itself as key (or could use JTI claim if added)
        import hashlib
        token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
        await redis_client.setex(
            f"{TOKEN_BLACKLIST_PREFIX}{token_hash}",
            ttl,
            "1"
        )
        return True
    except (InvalidTokenError, ExpiredSignatureError):
        return False
    except Exception as e:
        logger.error(f"Token invalidation failed: {e}")
        return False


async def is_token_blacklisted(token: str) -> bool:
    """
    Check if a token is blacklisted.

    Args:
        token: JWT token to check

    Returns:
        True if blacklisted or (Redis unavailable and fail_mode=closed)
        False otherwise

    Behavior controlled by TOKEN_BLACKLIST_FAIL_MODE:
        - "open": Allow requests if Redis unavailable (availability)
        - "closed": Deny requests if Redis unavailable (security)
    """
    fail_closed = TOKEN_BLACKLIST_FAIL_MODE == "closed"

    try:
        redis_client = await get_redis_client()
        if redis_client is None:
            if fail_closed:
                logger.warning("Redis unavailable, denying request (fail-closed mode)")
                return True  # Treat as blacklisted
            return False  # Fail open

        import hashlib
        token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
        result = await redis_client.get(f"{TOKEN_BLACKLIST_PREFIX}{token_hash}")
        return result is not None
    except Exception as e:
        logger.error(f"Token blacklist check failed: {e}")
        if fail_closed:
            return True  # Treat as blacklisted
        return False  # Fail open


def init_jwt_auth():
    """
    Initialize JWT authentication.

    - Validates JWT_SECRET_KEY is configured
    - Logs configuration status

    Called once on application startup.
    Admin user is created lazily on first login attempt if not exists.

    Raises:
        RuntimeError: If JWT_SECRET_KEY not configured
    """
    # Validate JWT_SECRET_KEY
    if not JWT_SECRET_KEY or len(JWT_SECRET_KEY) < 32:
        raise RuntimeError(
            "JWT_SECRET_KEY not configured or too short. "
            "Generate with: openssl rand -hex 64"
        )

    if not JWT_ADMIN_PASSWORD:
        logger.warning(
            "JWT_ADMIN_PASSWORD not set. Admin user will not be usable. "
            "Set JWT_ADMIN_PASSWORD in environment to enable admin login."
        )
    else:
        logger.info("JWT auth initialized with admin credentials from environment")

    logger.info(
        f"JWT authentication initialized: "
        f"algorithm={JWT_ALGORITHM}, expiration={JWT_EXPIRATION_MINUTES}m"
    )


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a password against its hash.

    Args:
        plain_password: Plain text password from user
        hashed_password: Bcrypt hash from database

    Returns:
        True if password matches, False otherwise
    """
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """
    Hash a password with bcrypt.

    Args:
        password: Plain text password

    Returns:
        Bcrypt hash
    """
    return pwd_context.hash(password)


async def get_user_by_username(db: AsyncSession, username: str):
    """
    Get user by username from database.

    Args:
        db: Database session
        username: Username to look up

    Returns:
        User model or None if not found
    """
    # Import here to avoid circular imports
    from models.user import User

    result = await db.execute(
        select(User).where(User.username == username)
    )
    return result.scalar_one_or_none()


async def get_user_by_email(db: AsyncSession, email: str):
    """
    Get user by email from database.

    Args:
        db: Database session
        email: Email to look up

    Returns:
        User model or None if not found
    """
    from models.user import User

    result = await db.execute(
        select(User).where(User.email == email)
    )
    return result.scalar_one_or_none()


async def ensure_admin_user(db: AsyncSession) -> None:
    """
    Ensure admin user exists in database.

    Creates admin user from environment variables if it doesn't exist.
    Updates password if it has changed.

    Args:
        db: Database session
    """
    from models.user import User

    if not JWT_ADMIN_PASSWORD:
        return

    # Check if admin exists by username first (most common case)
    admin = await get_user_by_username(db, "admin")

    if not admin:
        # Also check by email
        admin = await get_user_by_email(db, JWT_ADMIN_EMAIL)

    if not admin:
        # Create admin user
        admin = User(
            username="admin",
            email=JWT_ADMIN_EMAIL,
            hashed_password=get_password_hash(JWT_ADMIN_PASSWORD),
            is_active=True,
            is_admin=True,
        )
        db.add(admin)
        await db.commit()
        logger.info(f"Created admin user: {JWT_ADMIN_EMAIL}")
    else:
        # Ensure admin is actually an admin and update password if needed
        updated = False
        if not admin.is_admin:
            admin.is_admin = True
            updated = True
        if not verify_password(JWT_ADMIN_PASSWORD, admin.hashed_password):
            admin.hashed_password = get_password_hash(JWT_ADMIN_PASSWORD)
            updated = True
        if admin.email != JWT_ADMIN_EMAIL:
            admin.email = JWT_ADMIN_EMAIL
            updated = True
        if updated:
            await db.commit()
            logger.info("Updated admin user from environment")


async def authenticate_user(db: AsyncSession, username: str, password: str):
    """
    Authenticate a user with username/email and password.

    Args:
        db: Database session
        username: Username or email
        password: Plain text password

    Returns:
        User model if authenticated, None otherwise
    """
    # Try username first, then email
    user = await get_user_by_username(db, username)
    if not user:
        user = await get_user_by_email(db, username)

    if not user:
        # Run password verification anyway to prevent timing attacks
        pwd_context.hash("dummy")
        return None

    if not user.is_active:
        logger.warning(f"Login attempt for inactive user: {username}")
        return None

    if not verify_password(password, user.hashed_password):
        return None

    # Update last login time
    user.last_login = datetime.utcnow()
    await db.commit()

    return user


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a JWT access token.

    Args:
        data: Payload data to encode (must include 'sub' claim)
        expires_delta: Optional expiration time delta

    Returns:
        JWT token string
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=JWT_EXPIRATION_MINUTES)

    to_encode.update({
        "exp": expire,
        "iat": datetime.utcnow(),
    })

    encoded_jwt = jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Optional[dict]:
    """
    Decode and validate a JWT access token.

    Args:
        token: JWT token string

    Returns:
        Decoded payload if valid, None if invalid or expired
    """
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
        return payload
    except (InvalidTokenError, ExpiredSignatureError) as e:
        logger.debug(f"JWT decode error: {e}")
        return None


def extract_token_from_request(request: Request) -> Optional[str]:
    """
    Extract JWT token from request.

    Looks for token in (priority order):
    1. Authorization: Bearer <token> header
    2. access_token query parameter (for WebSocket compatibility)
    3. access_token cookie (for /docs and /redoc browser access)

    Args:
        request: FastAPI request object

    Returns:
        Token string if found, None otherwise
    """
    # Check Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]  # Remove "Bearer " prefix

    # Check query parameter (for WebSocket)
    token = request.query_params.get("access_token")
    if token:
        return token

    # Check cookie (for /docs and /redoc browser access)
    token = request.cookies.get("access_token")
    if token:
        return token

    return None


async def verify_jwt(request: Request) -> Optional[AuthenticatedUser]:
    """
    Verify JWT token and return authenticated user (required).

    Used when authentication is REQUIRED.

    Args:
        request: FastAPI request object

    Returns:
        AuthenticatedUser object

    Raises:
        HTTPException(401): If token invalid, expired, blacklisted, or missing
    """
    token = extract_token_from_request(request)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Provide JWT token in Authorization: Bearer <token> header.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if token has been invalidated (logout)
    if await is_token_blacklisted(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been invalidated. Please login again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Extract user info from token payload
    user_id = payload.get("user_id")
    username = payload.get("sub")
    email = payload.get("email")
    is_admin = payload.get("is_admin", False)

    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token: missing subject claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Build roles from is_admin flag
    roles = ["admin"] if is_admin else ["user"]

    # Return normalized user model
    return AuthenticatedUser(
        id=str(user_id),
        username=username,
        email=email,
        display_name=username,
        roles=roles,
    )


async def verify_jwt_optional(request: Request) -> Optional[AuthenticatedUser]:
    """
    Verify JWT token and return authenticated user (optional).

    Used when authentication is OPTIONAL - doesn't raise error if missing.

    Args:
        request: FastAPI request object

    Returns:
        AuthenticatedUser if token valid, None if no token, invalid, or blacklisted
    """
    token = extract_token_from_request(request)

    if not token:
        return None

    payload = decode_access_token(token)
    if not payload:
        logger.debug("Invalid or expired token in optional auth")
        return None

    # Check if token has been invalidated (logout)
    if await is_token_blacklisted(token):
        logger.debug("Blacklisted token in optional auth")
        return None

    user_id = payload.get("user_id")
    username = payload.get("sub")
    email = payload.get("email")
    is_admin = payload.get("is_admin", False)

    if not username:
        return None

    roles = ["admin"] if is_admin else ["user"]

    return AuthenticatedUser(
        id=str(user_id),
        username=username,
        email=email,
        display_name=username,
        roles=roles,
    )


# =============================================================================
# User management functions (for admin API)
# =============================================================================


async def create_user(
    db: AsyncSession,
    username: str,
    email: str,
    password: str,
    is_admin: bool = False,
):
    """
    Create a new user.

    Args:
        db: Database session
        username: Unique username
        email: User email
        password: Plain text password (will be hashed)
        is_admin: Whether user has admin privileges

    Returns:
        Created User model

    Raises:
        ValueError: If username or email already exists
    """
    from models.user import User

    # Check for existing user
    existing = await get_user_by_username(db, username)
    if existing:
        raise ValueError(f"Username {username} already exists")

    existing = await get_user_by_email(db, email)
    if existing:
        raise ValueError(f"Email {email} already exists")

    user = User(
        username=username,
        email=email,
        hashed_password=get_password_hash(password),
        is_active=True,
        is_admin=is_admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return user


async def update_user_password(db: AsyncSession, user_id: int, new_password: str) -> bool:
    """
    Update user password.

    Args:
        db: Database session
        user_id: User ID
        new_password: New plain text password (will be hashed)

    Returns:
        True if successful, False if user not found
    """
    from models.user import User

    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        return False

    user.hashed_password = get_password_hash(new_password)
    await db.commit()
    return True


async def list_users(db: AsyncSession):
    """
    List all users.

    Args:
        db: Database session

    Returns:
        List of User models
    """
    from models.user import User

    result = await db.execute(
        select(User).order_by(User.id)
    )
    return result.scalars().all()


async def delete_user(db: AsyncSession, user_id: int) -> bool:
    """
    Delete a user.

    Args:
        db: Database session
        user_id: User ID to delete

    Returns:
        True if deleted, False if not found
    """
    from models.user import User

    result = await db.execute(
        select(User).where(User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        return False

    await db.delete(user)
    await db.commit()
    return True
