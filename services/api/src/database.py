"""
Database Session Management

Provides async database session dependency for FastAPI endpoints.
Uses SQLAlchemy 2.0 async session pattern with proper cleanup.
"""

from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession

from models.base import AsyncSessionLocal


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency for database sessions.

    Yields:
        AsyncSession for database operations

    Usage:
        @app.get("/endpoint")
        async def endpoint(db: AsyncSession = Depends(get_db)):
            result = await db.execute(select(Model))
            ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
