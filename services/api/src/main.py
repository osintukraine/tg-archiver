"""
tg-archiver REST API Service - Entry Point

Simplified API for Telegram archiving without AI dependencies.
Provides: Message search, media gallery, social graph, RSS feeds.
"""

import os
import time
import uuid

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST

# Structured logging for Loki aggregation
from observability import setup_logging, get_logger

from config.settings import settings

# Initialize structured logging on module load
setup_logging(service_name="api")
logger = get_logger(__name__)

from .auth.factory import init_auth_config, get_auth_config
from .middleware.auth_unified import AuthMiddleware
from .middleware.rate_limit import RateLimitMiddleware
from .middleware.csrf import CSRFMiddleware, CSRF_ENABLED
from .dependencies import CurrentUser, AuthenticatedUser, AdminUser
from .routers import (
    about_router,
    api_keys_router,
    auth_router,
    health_router,
    bookmarks_router,
    channels_router,
    comments_router,
    feed_tokens_router,
    media_router,
    messages_router,
    rss_router,
    social_graph_router,
    stream_router,
    system_router,
    user_router,
    admin_dashboard_router,
    admin_media_router,
    admin_kanban_router,
    admin_channels_router,
    admin_system_router,
    admin_feeds_router,
    admin_export_router,
    admin_config_router,
    admin_stats_router,
    admin_users_router,
    admin_message_actions_router,
    admin_categories_router,
    admin_extraction_router,
    admin_folders_router,
    admin_topics_router,
    admin_import_router,
    metrics_router,
)
from .routers.docs import router as docs_router

# Prometheus metrics
REQUEST_COUNT = Counter(
    'api_requests_total',
    'Total API requests',
    ['method', 'endpoint', 'status']
)

REQUEST_DURATION = Histogram(
    'api_request_duration_seconds',
    'API request duration in seconds',
    ['method', 'endpoint']
)

# API description
API_DESCRIPTION = """
REST API for tg-archiver - Self-hosted Telegram channel archiver.

## Key Features

- **Message Search**: Full-text search with filters (channel, date, media type)
- **Social Graph**: Track forwards, replies, and author attribution
- **RSS Feeds**: Subscribe to any channel or search query as RSS
- **Media Gallery**: Browse archived photos and videos

## No AI Dependencies

This is a surgical extraction focused on archiving without AI:
- No LLM classification
- No semantic search (embeddings)
- No event detection
- No entity matching

Just reliable Telegram archiving with SHA-256 media deduplication.
"""

# OpenAPI tags
OPENAPI_TAGS = [
    {"name": "messages", "description": "Message search and retrieval"},
    {"name": "channels", "description": "Channel management and statistics"},
    {"name": "social-graph", "description": "Forward/reply tracking and influence analysis"},
    {"name": "media", "description": "Media gallery and deduplication"},
    {"name": "rss", "description": "Dynamic RSS feed generation"},
    {"name": "health", "description": "System health checks"},
]


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all API responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        # CSP for API - restrictive since we serve JSON, not HTML
        # Allow 'self' for Swagger/ReDoc UI resources
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "img-src 'self' data: https:; "
            "font-src 'self' https://fonts.gstatic.com; "
            "frame-ancestors 'none'"
        )
        return response


# Create FastAPI app
app = FastAPI(
    title="tg-archiver API",
    description=API_DESCRIPTION,
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    openapi_tags=OPENAPI_TAGS,
    license_info={"name": "MIT License", "url": "https://opensource.org/licenses/MIT"},
)

# Middleware
# Trusted hosts for proxy headers (X-Forwarded-For, X-Forwarded-Proto)
# In production, restrict to actual proxy IPs/hostnames
TRUSTED_PROXY_HOSTS = os.getenv("TRUSTED_PROXY_HOSTS", "caddy,127.0.0.1,localhost").split(",")
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=TRUSTED_PROXY_HOSTS)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Initialize authentication on startup
@app.on_event("startup")
async def startup_auth():
    """Initialize authentication configuration and ensure admin user exists."""
    from models.base import AsyncSessionLocal
    from .auth.jwt import ensure_admin_user

    auth_config = init_auth_config()
    logger.info(f"API starting with AUTH_PROVIDER={auth_config.provider}")

    # Create admin user from env vars if using JWT auth
    if auth_config.provider == "jwt":
        async with AsyncSessionLocal() as db:
            await ensure_admin_user(db)
            await db.commit()

# Rate limiting for auth endpoints (before auth middleware)
app.add_middleware(RateLimitMiddleware)

# CSRF protection (optional, controlled by CSRF_ENABLED env var)
if CSRF_ENABLED:
    app.add_middleware(CSRFMiddleware)
    logger.info("CSRF protection enabled")

# Auth middleware
app.add_middleware(AuthMiddleware)

# CORS configuration
cors_origins = settings.get_cors_origins()
if "*" in cors_origins:
    cors_origins = ["http://localhost", "http://localhost:3000", "http://localhost:8000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(SecurityHeadersMiddleware)


@app.middleware("http")
async def request_tracing_middleware(request: Request, call_next):
    """Add trace_id to all requests for logging correlation."""
    trace_id = request.headers.get("X-Trace-ID", str(uuid.uuid4())[:16])
    from observability import set_trace_id, clear_trace_id
    set_trace_id(trace_id)
    try:
        response = await call_next(request)
        response.headers["X-Trace-ID"] = trace_id
        return response
    finally:
        clear_trace_id()


@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    """Track request metrics for Prometheus."""
    if request.url.path in ["/metrics", "/health"]:
        return await call_next(request)

    import re
    endpoint = re.sub(r'/\d+', '/{id}', request.url.path)
    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time

    REQUEST_COUNT.labels(method=request.method, endpoint=endpoint, status=str(response.status_code)).inc()
    REQUEST_DURATION.labels(method=request.method, endpoint=endpoint).observe(duration)
    return response


# Register routers
app.include_router(docs_router)
app.include_router(about_router)
app.include_router(health_router)
app.include_router(metrics_router)
app.include_router(media_router)
app.include_router(messages_router)
app.include_router(channels_router)
app.include_router(rss_router)
app.include_router(social_graph_router)
app.include_router(comments_router)
app.include_router(stream_router)
app.include_router(system_router)

# Auth endpoints
app.include_router(auth_router)
app.include_router(api_keys_router)
app.include_router(bookmarks_router)
app.include_router(feed_tokens_router)
app.include_router(user_router)

# Admin endpoints
app.include_router(admin_dashboard_router)
app.include_router(admin_media_router)
app.include_router(admin_kanban_router)
app.include_router(admin_channels_router)
app.include_router(admin_system_router)
app.include_router(admin_feeds_router)
app.include_router(admin_export_router)
app.include_router(admin_config_router)
app.include_router(admin_stats_router)
app.include_router(admin_users_router)
app.include_router(admin_message_actions_router)
app.include_router(admin_categories_router)
app.include_router(admin_extraction_router)
app.include_router(admin_folders_router)
app.include_router(admin_topics_router)
app.include_router(admin_import_router)


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup."""
    logger.info("Starting tg-archiver API v1.0.0")
    logger.info(f"CORS origins: {cors_origins}")
    logger.info("API documentation available at /docs")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down tg-archiver API")


@app.get("/health")
async def health_check():
    """Health check endpoint for Docker."""
    return {"status": "healthy", "service": "tg-archiver-api", "version": "1.0.0"}


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": "tg-archiver API",
        "version": "1.0.0",
        "documentation": "/docs",
        "health": "/health",
        "metrics": "/metrics",
    }
