"""
Shared database session utilities for all services.

This module provides centralized database connection management to eliminate
duplication across 10+ services that create engines independently.

Usage:
    from shared.python.database import create_session_factory, get_database_url

    # Get database URL from environment
    database_url = get_database_url()

    # Create session factory with custom pool settings
    async_session, engine = create_session_factory(
        database_url,
        pool_size=10,
        max_overflow=20
    )

    # Use in FastAPI dependency
    async def get_db():
        async with async_session() as session:
            yield session
"""

import os
from typing import Tuple

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def get_database_url() -> str:
    """
    Build database URL from environment variables.

    Expected environment variables:
    - POSTGRES_USER: Database username (default: osint_user)
    - POSTGRES_PASSWORD: Database password (required)
    - POSTGRES_HOST: Database host (default: postgres)
    - POSTGRES_PORT: Database port (default: 5432)
    - POSTGRES_DB: Database name (default: osint_platform)

    Returns:
        str: PostgreSQL async connection URL

    Raises:
        ValueError: If POSTGRES_PASSWORD is not set
    """
    user = os.getenv("POSTGRES_USER", "osint_user")
    password = os.getenv("POSTGRES_PASSWORD")
    host = os.getenv("POSTGRES_HOST", "postgres")
    port = os.getenv("POSTGRES_PORT", "5432")
    database = os.getenv("POSTGRES_DB", "osint_platform")

    if not password:
        raise ValueError("POSTGRES_PASSWORD environment variable is required")

    return f"postgresql+asyncpg://{user}:{password}@{host}:{port}/{database}"


def create_session_factory(
    database_url: str,
    pool_size: int = 5,
    max_overflow: int = 10,
    pool_pre_ping: bool = True,
    echo: bool = False,
) -> Tuple[async_sessionmaker[AsyncSession], AsyncEngine]:
    """
    Create async engine and session factory with configurable pool settings.

    This function creates a properly configured SQLAlchemy async engine
    with connection pooling and returns both the session factory and engine.

    Args:
        database_url: PostgreSQL async connection URL
        pool_size: Number of connections to keep in pool (default: 5)
        max_overflow: Max connections above pool_size (default: 10)
        pool_pre_ping: Test connections before use (default: True)
        echo: Log all SQL statements (default: False)

    Returns:
        Tuple containing:
        - async_sessionmaker: Factory for creating async sessions
        - AsyncEngine: The underlying async engine (for shutdown cleanup)

    Example:
        async_session, engine = create_session_factory(
            get_database_url(),
            pool_size=10,
            max_overflow=20
        )

        # Use session
        async with async_session() as session:
            result = await session.execute(select(Message))

        # Cleanup on shutdown
        await engine.dispose()
    """
    engine = create_async_engine(
        database_url,
        pool_size=pool_size,
        max_overflow=max_overflow,
        pool_pre_ping=pool_pre_ping,
        echo=echo,
    )

    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    return session_factory, engine
