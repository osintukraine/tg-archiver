"""
Health Check Endpoints

Provides system health information for Docker health checks.
"""

from fastapi import APIRouter

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
async def health_check():
    """
    Health check endpoint for Docker.

    Returns basic service health status.
    """
    return {
        "status": "healthy",
        "service": "tg-archiver-api",
        "version": "1.0.0"
    }
