"""
No authentication provider.

For development and private self-hosted deployments where authentication
is handled externally (e.g., VPN, firewall rules, reverse proxy).
"""

import logging
from typing import Optional
from fastapi import Request

from .models import AuthenticatedUser

logger = logging.getLogger(__name__)


async def verify_no_auth(request: Request) -> Optional[AuthenticatedUser]:
    """
    No authentication - allow all requests.

    Returns None to indicate no user authentication required.
    Used for:
    - Development environments
    - Private deployments behind VPN
    - Trusted network deployments

    Args:
        request: FastAPI request object

    Returns:
        None (no authentication required)
    """
    # Log for debugging (useful to see unauthenticated access)
    logger.debug(
        f"Unauthenticated access: {request.method} {request.url.path} "
        f"from {request.client.host if request.client else 'unknown'}"
    )

    return None  # No user object - authentication not required
