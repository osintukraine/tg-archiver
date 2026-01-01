"""
Oathkeeper Role Check Endpoint

Internal endpoint for Oathkeeper's remote_json authorizer to validate
user roles for protected admin services (Grafana, Prometheus, etc.).

This endpoint is called by Oathkeeper AFTER session validation, so the
user_id is guaranteed to be a valid Kratos identity ID.

SECURITY: This endpoint is restricted to internal Docker network only.
External requests are rejected with 403 Forbidden.
"""

import ipaddress
import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from ...kratos import get_kratos_client
from ...kratos.admin_client import KratosAPIError, KratosConnectionError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin-role-check"])


def _is_internal_request(request: Request) -> bool:
    """Check if request comes from internal Docker network.

    SECURITY: Only allows requests from Docker networks (Oathkeeper).
    This prevents external attackers from probing user roles.
    """
    client_host = request.client.host if request.client else "unknown"

    # Check for Docker service names (resolved via Docker DNS)
    internal_hosts = {"oathkeeper", "localhost", "127.0.0.1", "::1"}
    if client_host in internal_hosts:
        return True

    # Check for Docker/private network ranges
    try:
        ip = ipaddress.ip_address(client_host)
        internal_networks = [
            ipaddress.ip_network("172.16.0.0/12"),  # Docker default
            ipaddress.ip_network("10.0.0.0/8"),      # Private
            ipaddress.ip_network("192.168.0.0/16"), # Private
            ipaddress.ip_network("127.0.0.0/8"),    # Loopback
            ipaddress.ip_network("::1/128"),        # IPv6 loopback
        ]
        return any(ip in net for net in internal_networks)
    except ValueError:
        return False


# Role hierarchy: admin > analyst > viewer
ROLE_HIERARCHY = {
    "admin": 3,
    "analyst": 2,
    "viewer": 1,
}


class RoleCheckRequest(BaseModel):
    """Request from Oathkeeper's remote_json authorizer."""

    user_id: str
    required_role: Optional[str] = None
    required_roles: Optional[List[str]] = None  # Alternative: any of these roles


class RoleCheckResponse(BaseModel):
    """Response for successful authorization."""

    authorized: bool
    user_id: str
    user_role: str
    required_role: Optional[str] = None


def role_meets_requirement(user_role: str, required_role: str) -> bool:
    """
    Check if user's role meets or exceeds the required role.

    Role hierarchy: admin > analyst > viewer
    - admin can access everything
    - analyst can access analyst + viewer resources
    - viewer can only access viewer resources
    """
    user_level = ROLE_HIERARCHY.get(user_role, 0)
    required_level = ROLE_HIERARCHY.get(required_role, 999)
    return user_level >= required_level


@router.post("/check-role")
async def check_role(body: RoleCheckRequest, request: Request):
    """
    Check if a user has the required role for accessing a protected resource.

    Called by Oathkeeper's remote_json authorizer after session validation.

    SECURITY: This endpoint is restricted to internal Docker network only.
    External requests will receive 403 Forbidden.

    Authorization logic:
    - If required_role is specified: user's role must meet or exceed it
    - If required_roles is specified: user's role must be in the list
    - Role hierarchy: admin > analyst > viewer

    Returns:
        200 with RoleCheckResponse if authorized
        403 if user doesn't have required role or external request
        404 if user not found in Kratos
        503 if Kratos is unavailable
    """
    # SECURITY: Only allow internal requests (from Oathkeeper)
    if not _is_internal_request(request):
        logger.warning(f"External request to check-role endpoint blocked: {request.client.host if request.client else 'unknown'}")
        raise HTTPException(
            status_code=403,
            detail="This endpoint is for internal use only"
        )

    kratos = get_kratos_client()

    try:
        # Get user's identity from Kratos
        identity = await kratos.get_identity(body.user_id)
        user_role = identity.role or "viewer"

        logger.debug(f"Role check: user={body.user_id}, role={user_role}, required={body.required_role or body.required_roles}")

        # Check authorization
        authorized = False

        if body.required_roles:
            # Any of the required roles (OR logic)
            for req_role in body.required_roles:
                if role_meets_requirement(user_role, req_role):
                    authorized = True
                    break
        elif body.required_role:
            # Single required role with hierarchy
            authorized = role_meets_requirement(user_role, body.required_role)
        else:
            # No role requirement = just need valid session (already validated by Oathkeeper)
            authorized = True

        if not authorized:
            logger.warning(f"Role check failed: user={body.user_id}, role={user_role}, required={body.required_role or body.required_roles}")
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permissions. Required: {body.required_role or body.required_roles}, User role: {user_role}",
            )

        logger.info(f"Role check passed: user={body.user_id}, role={user_role}")
        return RoleCheckResponse(
            authorized=True,
            user_id=body.user_id,
            user_role=user_role,
            required_role=body.required_role,
        )

    except KratosAPIError as e:
        if e.status_code == 404:
            logger.error(f"User not found in Kratos: {body.user_id}")
            raise HTTPException(status_code=404, detail="User not found")
        logger.error(f"Kratos API error: {e}")
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except KratosConnectionError as e:
        logger.error(f"Kratos connection error: {e}")
        raise HTTPException(status_code=503, detail="Identity service unavailable")
