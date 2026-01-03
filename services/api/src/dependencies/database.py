"""Database utilities with timeout support."""

import asyncio
import logging
from typing import Any, Callable, Optional, TypeVar

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

T = TypeVar('T')


async def execute_with_timeout(
    query_fn: Callable[[AsyncSession], T],
    timeout: float = 5.0,
    session: Optional[AsyncSession] = None,
) -> T:
    """
    Execute a database operation with a timeout.

    Wraps async database operations with asyncio.wait_for to prevent
    queries from hanging indefinitely. Useful for expensive spatial
    queries that could block API responses.

    Args:
        query_fn: Async function that takes session and executes query
        timeout: Maximum execution time in seconds (default: 5.0)
        session: Optional existing session (creates new if not provided)

    Returns:
        Query result

    Raises:
        asyncio.TimeoutError: If query exceeds timeout

    Example:
        async def get_messages(session):
            result = await session.execute(expensive_query)
            return result.fetchall()

        try:
            data = await execute_with_timeout(get_messages, timeout=10.0, session=db)
        except asyncio.TimeoutError:
            raise HTTPException(504, "Query timeout")
    """
    async def run_query():
        if session:
            return await query_fn(session)
        else:
            # Lazy import - only needed when no session provided
            from models.base import async_session_factory
            async with async_session_factory() as new_session:
                return await query_fn(new_session)

    try:
        return await asyncio.wait_for(run_query(), timeout=timeout)
    except asyncio.TimeoutError:
        logger.error(f"Query timeout after {timeout}s")
        raise


async def get_db_with_timeout(timeout_ms: int = 5000):
    """
    Dependency that provides a session with PostgreSQL statement timeout.

    Sets PostgreSQL's statement_timeout parameter which causes the database
    server itself to cancel queries that exceed the timeout. This is more
    reliable than client-side timeouts as it works even if the client
    connection is blocked.

    Args:
        timeout_ms: Statement timeout in milliseconds (default: 5000ms = 5s)

    Yields:
        AsyncSession with statement timeout configured

    Usage:
        @app.get("/endpoint")
        async def endpoint(db: AsyncSession = Depends(get_db_with_timeout(5000))):
            # Queries will timeout after 5 seconds
            ...
    """
    from models.base import async_session_factory

    async with async_session_factory() as session:
        # Set PostgreSQL statement timeout for this session
        await session.execute(text(f"SET statement_timeout = {timeout_ms}"))
        yield session


def db_with_timeout(timeout_ms: int = 5000):
    """
    Factory function to create a get_db dependency with custom timeout.

    This is a convenience wrapper around get_db_with_timeout that can be
    used directly in FastAPI Depends().

    Args:
        timeout_ms: Statement timeout in milliseconds

    Returns:
        Async generator function suitable for Depends()

    Usage:
        @app.get("/slow-endpoint")
        async def slow_endpoint(db: AsyncSession = Depends(db_with_timeout(10000))):
            # 10 second timeout for this endpoint
            ...
    """
    async def _get_db():
        async for session in get_db_with_timeout(timeout_ms):
            yield session
    return _get_db
