"""
Role-Filtered OpenAPI Documentation

Filters the OpenAPI schema based on user role:
- Anonymous: Public endpoints only (site browsing works, but API docs limited)
- User: Public + user endpoints (bookmarks, feed tokens, preferences)
- Analyst: + analyst endpoints (events, entities, map, analytics)
- Admin: All endpoints including /api/admin/*

Security: Prevents information disclosure of admin API structure to non-admins.
"""

import logging
from typing import Optional
from fastapi import APIRouter, Depends, Request
from fastapi.openapi.utils import get_openapi
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.responses import HTMLResponse, JSONResponse

from ..auth.models import AuthUser
from ..auth.factory import get_current_user_optional

logger = logging.getLogger(__name__)

router = APIRouter(tags=["documentation"])

# ReDoc version pinning - DO NOT use @latest or @next
# Version 2.1.0 has a bug: "is(...).replace is not a function" when parsing
# docstrings with markdown bullet lists or code blocks.
# Version 2.1.5 fixes this. Test /redoc after any ReDoc version change.
# See: https://github.com/Redocly/redoc/issues/2122
REDOC_VERSION = "2.1.5"
REDOC_JS_URL = f"https://cdn.jsdelivr.net/npm/redoc@{REDOC_VERSION}/bundles/redoc.standalone.js"

# =============================================================================
# Role → Endpoint Visibility Mapping
# =============================================================================
# Endpoints are cumulative: each role sees their own + all lower roles
# Order matters: anonymous < user < analyst < admin

ROLE_ENDPOINTS = {
    # Anonymous users can see public endpoints that power the site
    "anonymous": [
        "/api/health",
        "/api/about/",
        "/api/messages",      # Public message browsing
        "/api/search",        # Public search
        "/api/channels",      # Public channel list
        "/api/events",        # Public events (not admin events)
        "/api/semantic",      # Semantic search
        "/api/timeline",      # Timeline view
        "/api/map/",          # Map endpoints
        "/api/stream/",       # Unified stream
        "/api/analytics/",    # Public analytics
        "/api/models/",       # Model info (not config)
        "/api/metrics/",      # Public metrics
        "/api/comments/",     # Comment viewing
        "/rss/",              # RSS feeds (require token but visible)
        "/auth/",             # Auth endpoints
        "/health",            # Health check
    ],
    # Authenticated users can also see user-specific endpoints
    "user": [
        "/api/user/",         # User profile
        "/api/bookmarks",     # User bookmarks
        "/api/feed-tokens",   # Feed token management
        "/api/api-keys",      # API key management
        "/api/spam/",         # Spam reporting (mark as spam/not spam)
    ],
    # Analysts can see investigation-focused endpoints
    "analyst": [
        "/api/entities/",     # Entity management
        "/api/social-graph/", # Social graph analysis
    ],
    # Admins see everything (including admin endpoints)
    "admin": [
        "/api/admin/",        # All admin endpoints
        "/api/system/",       # System endpoints
        "/metrics",           # Prometheus metrics
    ],
}

# Paths to always exclude from docs (internal only)
EXCLUDED_PATHS = [
    "/api/media/internal/",   # Internal media routing
]


def get_user_role(user: Optional[AuthUser]) -> str:
    """Get the effective role for a user."""
    if not user or not user.is_authenticated:
        return "anonymous"
    if user.is_admin:
        return "admin"
    if user.is_analyst:
        return "analyst"
    return "user"


def get_visible_prefixes(role: str) -> set:
    """Get all endpoint prefixes visible to a role (cumulative)."""
    prefixes = set()
    role_hierarchy = ["anonymous", "user", "analyst", "admin"]

    for r in role_hierarchy:
        prefixes.update(ROLE_ENDPOINTS.get(r, []))
        if r == role:
            break

    return prefixes


def is_path_visible(path: str, role: str) -> bool:
    """Check if a path should be visible to a role."""
    # Always exclude internal paths
    for excluded in EXCLUDED_PATHS:
        if path.startswith(excluded):
            return False

    # Admin sees everything
    if role == "admin":
        return True

    # Check if path matches any visible prefix
    visible_prefixes = get_visible_prefixes(role)
    for prefix in visible_prefixes:
        if path.startswith(prefix):
            return True

    return False


def filter_openapi_schema(schema: dict, role: str) -> dict:
    """Filter OpenAPI schema paths based on role."""
    filtered_paths = {}

    for path, methods in schema.get("paths", {}).items():
        if is_path_visible(path, role):
            filtered_paths[path] = methods

    # Create filtered schema
    filtered_schema = schema.copy()
    filtered_schema["paths"] = filtered_paths

    # Update info to indicate filtering
    if role != "admin":
        filtered_schema["info"] = schema.get("info", {}).copy()
        filtered_schema["info"]["description"] = (
            f"{schema.get('info', {}).get('description', '')}\n\n"
            f"*Showing endpoints for role: {role}. "
            f"Some endpoints may be hidden based on your access level.*"
        )

    return filtered_schema


# =============================================================================
# Custom Documentation Endpoints
# =============================================================================

@router.get("/openapi.json", include_in_schema=False)
async def get_filtered_openapi(
    request: Request,
    user: Optional[AuthUser] = Depends(get_current_user_optional),
) -> JSONResponse:
    """
    Get OpenAPI schema filtered by user role.

    - Anonymous: See public endpoints only
    - User: See public + user endpoints
    - Analyst: See public + user + analyst endpoints
    - Admin: See all endpoints
    """
    # Get the FastAPI app from request
    app = request.app

    # Get user role
    role = get_user_role(user)

    # Generate base OpenAPI schema
    base_schema = get_openapi(
        title=app.title,
        version=app.version,
        description=app.description,
        routes=app.routes,
        servers=app.servers if hasattr(app, 'servers') else None,
    )

    # Filter based on role
    filtered_schema = filter_openapi_schema(base_schema, role)

    # Log access
    user_id = user.id if user else "anonymous"
    visible_count = len(filtered_schema.get("paths", {}))
    total_count = len(base_schema.get("paths", {}))
    logger.debug(
        f"OpenAPI schema requested: user={user_id}, role={role}, "
        f"visible={visible_count}/{total_count} endpoints"
    )

    return JSONResponse(content=filtered_schema)


@router.get("/docs", include_in_schema=False)
async def get_swagger_docs(
    request: Request,
    user: Optional[AuthUser] = Depends(get_current_user_optional),
) -> HTMLResponse:
    """
    Swagger UI documentation filtered by user role.
    """
    role = get_user_role(user)

    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title=f"{request.app.title} - API Docs ({role})",
        swagger_favicon_url="https://fastapi.tiangolo.com/img/favicon.png",
    )


@router.get("/redoc", include_in_schema=False)
async def get_redoc_docs(
    request: Request,
    user: Optional[AuthUser] = Depends(get_current_user_optional),
) -> HTMLResponse:
    """
    ReDoc documentation filtered by user role.

    Uses pinned ReDoc version to avoid bugs in @next/@latest.
    See REDOC_VERSION constant for rationale.
    """
    role = get_user_role(user)

    return get_redoc_html(
        openapi_url="/openapi.json",
        title=f"{request.app.title} - API Reference ({role})",
        redoc_favicon_url="https://fastapi.tiangolo.com/img/favicon.png",
        redoc_js_url=REDOC_JS_URL,
    )
