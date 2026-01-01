"""
REST API Service - Entry Point

This service provides:
1. REST API endpoints for messages, channels, entities, and search
2. Dynamic RSS feed generation (subscribe to any search)
3. JWT authentication
4. Rate limiting
5. OpenAPI documentation (Swagger/ReDoc)
6. Prometheus metrics at /metrics
"""

import time
import uuid

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from notifications import NotificationClient

# Structured logging for Loki aggregation
from observability import setup_logging, get_logger, LogContext

from config.settings import settings

# Initialize structured logging on module load
setup_logging(service_name="api")
logger = get_logger(__name__)

from .auth.factory import init_auth_config, get_auth_config
from .middleware.auth_unified import AuthMiddleware
from .dependencies import CurrentUser, AuthenticatedUser, AdminUser
from .routers import (
    about_router,
    analytics_router,
    api_keys_router,
    auth_router,
    health_router,
    bookmarks_router,
    channels_router,
    channel_submissions_router,
    comments_router,
    channel_network_router,
    entities_router,
    events_router,
    events_admin_router,
    feed_tokens_router,
    flowsint_export_router,
    map_router,
    media_router,
    vessels_router,
    messages_router,
    models_router,
    network_router,
    news_timeline_router,
    rss_router,
    search_router,
    semantic_router,
    similarity_router,
    social_graph_router,
    spam_router,
    stream_router,
    system_router,
    timeline_router,
    user_router,
    validation_router,
    admin_dashboard_router,
    admin_spam_router,
    admin_media_router,
    admin_kanban_router,
    admin_channels_router,
    admin_entities_router,
    admin_prompts_router,
    admin_system_router,
    admin_feeds_router,
    admin_export_router,
    admin_config_router,
    admin_stats_router,
    admin_comments_router,
    admin_users_router,
    admin_role_check_router,
    admin_fact_check_router,
    admin_message_actions_router,
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

# Initialize NotificationClient (global instance)
notifier = NotificationClient(service_name="api", redis_url=settings.REDIS_URL)

# =============================================================================
# OpenAPI Documentation Configuration
# =============================================================================

# API description with architecture overview, authentication guide, and usage info
# Note: This string is formatted at runtime to include PLATFORM_NAME
API_DESCRIPTION_TEMPLATE = """
REST API for Telegram intelligence archival and analysis.

## 🎯 Overview

{platform_name} provides real-time monitoring, AI enrichment, and analysis
of Telegram channels for open-source intelligence research. This API exposes all platform
functionality for programmatic access.

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| **Message Search** | Full-text search with 18+ filters (channel, importance level, topic, media type, spam status) |
| **Semantic Search** | AI-powered meaning-based search using 384-dimensional vector embeddings |
| **Social Graph** | Track forwards, replies, reactions, comments, and influence networks |
| **Network Graphs** | Entity relationship visualization (Flowsint-compatible export) |
| **RSS Feeds** | Subscribe to any search query, channel, or topic as RSS |
| **Multi-Model AI** | Runtime LLM model switching (6 models) without service restarts |
| **Validation Layer** | Cross-reference Telegram claims with external RSS news sources |

## 📊 Data Sources

- **Telegram Channels**: 254+ monitored channels (92 Ukrainian + 162 Russian sources)
- **RSS Feeds**: External news sources for cross-validation
- **Curated Entities**: 1,425 verified entities from ArmyGuide, Root.NK, ODIN sanctions
- **OpenSanctions**: Sanctioned individuals, PEPs, and organizations

## 🔐 Authentication

Three authentication modes are supported:

| Mode | Header | Use Case |
|------|--------|----------|
| **JWT** | `Authorization: Bearer <token>` | Direct API access via `/auth/login` |
| **Ory SSO** | `X-User-ID`, `X-User-Email`, `X-User-Role` | Ory Kratos/Oathkeeper integration |
| **Anonymous** | None | Development mode (`AUTH_REQUIRED=false`) |

## 📖 Pagination

All list endpoints support pagination:

```
GET /api/messages?page=1&page_size=50
```

| Parameter | Default | Maximum | Description |
|-----------|---------|---------|-------------|
| `page` | 1 | - | Page number (1-indexed) |
| `page_size` | 50 | 100 | Items per page |

Response includes pagination metadata:
```json
{{
  "items": [...],
  "total": 1234,
  "page": 1,
  "page_size": 50,
  "total_pages": 25,
  "has_next": true,
  "has_prev": false
}}
```

## 🚦 Response Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `202` | Accepted (async operation pending) |
| `400` | Bad request (invalid parameters) |
| `401` | Unauthorized (authentication required) |
| `403` | Forbidden (insufficient permissions) |
| `404` | Not found |
| `422` | Validation error (check error details) |
| `500` | Internal server error |

## 💡 Quick Start Examples

**Search recent high-importance messages:**
```bash
curl 'http://localhost:8000/api/messages?q=Bakhmut&days=7&importance_level=high'
```

**Semantic search (find by meaning):**
```bash
curl 'http://localhost:8000/api/semantic/search?q=civilian+casualties&similarity_threshold=0.7'
```

**Get message with social graph:**
```bash
curl 'http://localhost:8000/api/messages/123/social-graph'
```

**Subscribe to RSS feed:**
```bash
curl 'http://localhost:8000/rss/search?q=artillery&channel_folder=%25UA'
```
"""

# Tag metadata for better API documentation organization
OPENAPI_TAGS = [
    {
        "name": "messages",
        "description": "📨 **Message Search & Retrieval** - Core endpoints for accessing Telegram intelligence data. "
                      "Supports full-text search with 18+ filters, pagination, and sorting.",
    },
    {
        "name": "semantic-search",
        "description": "🧠 **AI-Powered Semantic Search** - Find messages by meaning, not just keywords. "
                      "Uses 384-dimensional vector embeddings (all-MiniLM-L6-v2) for similarity matching.",
    },
    {
        "name": "channels",
        "description": "📡 **Channel Management** - List, filter, and get statistics for monitored Telegram channels. "
                      "Includes folder-based filtering and network analysis.",
    },
    {
        "name": "social-graph",
        "description": "🕸️ **Social Interaction Analysis** - Track Telegram forwards, replies, reactions, comments, "
                      "and influence networks. Understand how information propagates.",
    },
    {
        "name": "analytics",
        "description": "📊 **Analytics & Visualization** - Aggregation endpoints for timelines, topic distributions, "
                      "engagement metrics, and trend analysis.",
    },
    {
        "name": "models",
        "description": "🤖 **Multi-Model AI Management** - View, configure, and health check LLM models. "
                      "Switch between 6 models (Qwen, Llama, Granite, Phi, Gemma, Mistral) at runtime.",
    },
    {
        "name": "network",
        "description": "🔗 **Entity Relationship Graphs** - Knowledge graph visualization for intelligence analysis. "
                      "Includes curated entities from ArmyGuide, Root.NK, and ODIN sanctions.",
    },
    {
        "name": "flowsint",
        "description": "🔄 **Flowsint Export** - Export network graph data to Flowsint format for advanced "
                      "OSINT investigation and visualization.",
    },
    {
        "name": "validation",
        "description": "✅ **RSS Validation Layer** - Cross-reference Telegram claims with external news sources. "
                      "Semantic matching against RSS articles for verification.",
    },
    {
        "name": "stream",
        "description": "🌊 **Unified Intelligence Stream** - Combined feed of Telegram messages and RSS articles "
                      "with correlation indicators.",
    },
    {
        "name": "rss",
        "description": "📰 **Dynamic RSS Feeds** - Generate RSS feeds from any search query, channel, or topic. "
                      "Subscribe in any RSS reader for real-time updates.",
    },
    {
        "name": "media",
        "description": "🖼️ **Media Gallery** - Photo and video filtering, gallery views, and media statistics. "
                      "Content-addressed storage with SHA-256 deduplication.",
    },
    {
        "name": "bookmarks",
        "description": "🔖 **User Bookmarks** - Save messages for later review. Requires authentication.",
    },
    {
        "name": "user",
        "description": "👤 **User Profile** - User preferences and settings management. Requires authentication.",
    },
    {
        "name": "spam",
        "description": "🚫 **Spam Management** - Review spam classifications, mark false positives, and trigger "
                      "reprocessing. Admin access recommended.",
    },
    {
        "name": "events",
        "description": "🎯 **Event Timeline** - Cluster related messages into real-world events. "
                      "Groups messages by entity overlap and semantic similarity for chronological event tracking.",
    },
    {
        "name": "timeline",
        "description": "📅 **Timeline Analysis** - Message distribution over time with hourly, daily, and monthly "
                      "aggregations for pattern detection.",
    },
    {
        "name": "system",
        "description": "⚙️ **System Health** - Health checks, service status, and operational metrics. "
                      "Use for monitoring and alerting integration.",
    },
    {
        "name": "Authentication",
        "description": "🔐 **Authentication** - JWT token generation and validation. Login to get access tokens.",
    },
]

# =============================================================================
# Security Headers Middleware
# =============================================================================
# OWASP Security Headers Reference: https://owasp.org/www-project-secure-headers/

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Middleware to add security headers to all API responses.

    Security headers implemented:
    - X-Content-Type-Options: Prevents MIME type sniffing (OWASP)
    - X-Frame-Options: Prevents clickjacking attacks
    - X-XSS-Protection: Legacy XSS protection for older browsers
    - Referrer-Policy: Controls referrer information leakage
    - Permissions-Policy: Disables unnecessary browser features
    - Cache-Control: Prevents caching of sensitive responses

    Note: Cache-Control is NOT added to /api/map/* endpoints as they
    have their own caching strategy for performance.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # X-Content-Type-Options: Prevent MIME type sniffing
        # Stops browsers from interpreting files as a different MIME type
        response.headers["X-Content-Type-Options"] = "nosniff"

        # X-Frame-Options: Prevent clickjacking
        # API responses should never be embedded in frames
        response.headers["X-Frame-Options"] = "DENY"

        # X-XSS-Protection: Legacy XSS filter for older browsers
        # Modern browsers use CSP, but this helps IE/older Edge
        response.headers["X-XSS-Protection"] = "1; mode=block"

        # Referrer-Policy: Control referrer information
        # strict-origin-when-cross-origin: Send origin only for cross-origin requests
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        # Permissions-Policy: Disable unnecessary browser features
        # API endpoints don't need geolocation, microphone, or camera access
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        # Cache-Control: Prevent caching of sensitive API responses
        # EXCEPTION: Map endpoints have their own caching strategy (60s-300s TTL)
        # See EVENT_DETECTION_V3.md for map caching architecture
        if not request.url.path.startswith("/api/map/"):
            response.headers["Cache-Control"] = "no-store"

        return response


# Format API description with platform name from settings
API_DESCRIPTION = API_DESCRIPTION_TEMPLATE.format(platform_name=settings.PLATFORM_NAME)

# Create FastAPI app with enhanced documentation
app = FastAPI(
    title=f"{settings.PLATFORM_NAME} API",
    description=API_DESCRIPTION,
    version="1.0.0",
    # Documentation disabled here - using role-filtered docs router instead
    # See services/api/src/routers/docs.py for implementation
    docs_url=None,
    redoc_url=None,
    openapi_url=None,  # Custom /openapi.json filters endpoints by user role
    openapi_tags=OPENAPI_TAGS,
    license_info={
        "name": "MIT License",
        "url": "https://opensource.org/licenses/MIT",
    },
    contact={
        "name": "OSINT Ukraine",
        "url": "https://github.com/osintukraine",
    },
)

# ProxyHeadersMiddleware makes FastAPI respect X-Forwarded-Proto and X-Forwarded-For
# This is essential for production behind Caddy/nginx so that:
# 1. Trailing slash redirects use https:// instead of http://
# 2. request.client.host shows real client IP, not proxy IP
#
# SECURITY: Trust all Docker network connections for X-Forwarded-* headers
# This is SAFE because:
#   1. API port 8000 is NOT exposed externally (only via Docker network)
#   2. All external traffic goes through Caddy → Oathkeeper → API
#   3. Header spoofing is blocked at Caddy level (X-User-* stripped)
#   4. ProxyHeadersMiddleware only reads X-Forwarded-Proto/For, not auth headers
# This ensures trailing slash redirects use https:// instead of http://
app.add_middleware(
    ProxyHeadersMiddleware,
    trusted_hosts=["*"]  # Safe: API not directly exposed to internet
)

# Add GZip compression for responses > 1KB
# Reduces bandwidth by 70-90% for large JSON responses (map GeoJSON, search results)
# Minimum size: 1000 bytes (avoids compression overhead for small responses)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Store notifier in app state for access in routers
app.state.notifier = notifier

# Initialize authentication on startup
@app.on_event("startup")
async def startup_auth():
    """Initialize authentication configuration on startup."""
    auth_config = init_auth_config()
    logger.info(
        f"API starting with AUTH_PROVIDER={auth_config.provider}, "
        f"AUTH_REQUIRED={auth_config.required}"
    )

# Unified Authentication Middleware
# Handles all auth methods: API keys, Ory Kratos sessions, Oathkeeper headers, JWT
# Always sets request.state.user to AuthUser (anonymous if not authenticated)
# IMPORTANT: Must be added BEFORE CORSMiddleware so CORS runs first (middleware executes in reverse order)
app.add_middleware(AuthMiddleware)

# Configure CORS
# IMPORTANT: Added AFTER AuthenticationMiddleware so it executes FIRST (handles OPTIONS preflight)
# Security: get_cors_origins() now validates and provides safe defaults (no wildcard fallback)
# See OWASP CORS guidance: https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/11-Client-side_Testing/07-Testing_Cross_Origin_Resource_Sharing
cors_origins = settings.get_cors_origins()

# Security validation: wildcard (*) with credentials is a severe vulnerability
# Block this combination rather than just warn
if "*" in cors_origins:
    logger.error(
        "CRITICAL SECURITY ISSUE: Wildcard (*) CORS origin cannot be used with "
        "allow_credentials=True. This is blocked per OWASP guidelines. "
        "Set explicit origins in API_CORS_ORIGINS or remove the wildcard."
    )
    # Remove wildcard and fall back to localhost only for safety
    cors_origins = [o for o in cors_origins if o != "*"]
    if not cors_origins:
        cors_origins = [
            "http://localhost:3000",
            "http://localhost:8000",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:8000",
        ]
        logger.warning("Falling back to localhost-only CORS origins for security")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security Headers Middleware
# IMPORTANT: Added AFTER CORSMiddleware to add security headers to all responses
# Middleware execution order: Security Headers -> CORS -> Ory Auth -> Authentication
# See OWASP Secure Headers: https://owasp.org/www-project-secure-headers/
app.add_middleware(SecurityHeadersMiddleware)

# Request tracing middleware - generates trace_id for distributed tracing
@app.middleware("http")
async def request_tracing_middleware(request: Request, call_next):
    """
    Middleware to set trace_id for request logging.

    This enables correlating all log entries for a single request across
    the API service. The trace_id is:
    1. Taken from X-Trace-ID header if provided (for upstream services)
    2. Generated as a new UUID if not provided
    """
    # Get or generate trace_id
    trace_id = request.headers.get("X-Trace-ID", str(uuid.uuid4())[:16])

    # Set trace_id in logging context for this request
    from observability import set_trace_id, clear_trace_id
    set_trace_id(trace_id)

    try:
        response = await call_next(request)
        # Add trace_id to response headers for client correlation
        response.headers["X-Trace-ID"] = trace_id
        return response
    finally:
        clear_trace_id()


# Prometheus metrics middleware
@app.middleware("http")
async def metrics_middleware(request: Request, call_next):
    """Middleware to track request counts and duration for Prometheus."""
    # Skip metrics for /metrics and /health endpoints to avoid recursion/noise
    if request.url.path in ["/metrics", "/health"]:
        return await call_next(request)

    # Extract endpoint path (normalize path params)
    endpoint = request.url.path
    # Normalize path parameters: /api/messages/123 -> /api/messages/{id}
    import re
    endpoint = re.sub(r'/\d+', '/{id}', endpoint)

    start_time = time.time()
    response = await call_next(request)
    duration = time.time() - start_time

    # Record metrics
    REQUEST_COUNT.labels(
        method=request.method,
        endpoint=endpoint,
        status=str(response.status_code)
    ).inc()

    REQUEST_DURATION.labels(
        method=request.method,
        endpoint=endpoint
    ).observe(duration)

    return response


# Error handling middleware
@app.middleware("http")
async def error_notification_middleware(request: Request, call_next):
    """Middleware to emit notifications for API errors."""
    try:
        response = await call_next(request)

        # Check for client errors (4xx)
        if 400 <= response.status_code < 500:
            await notifier.emit(
                "api.error_4xx",
                data={
                    "endpoint": str(request.url.path),
                    "method": request.method,
                    "status_code": response.status_code,
                },
                priority="low",  # Client errors are expected
                tags=["api", "client-error"]
            )

        # Check for server errors (5xx)
        elif response.status_code >= 500:
            await notifier.emit(
                "api.error_5xx",
                data={
                    "endpoint": str(request.url.path),
                    "method": request.method,
                    "status_code": response.status_code,
                    "error": "Internal server error",
                },
                priority="high",  # Server errors need attention
                tags=["api", "server-error"]
            )

        return response

    except Exception as e:
        # Unhandled exception - emit urgent notification
        await notifier.emit(
            "api.error_5xx",
            data={
                "endpoint": str(request.url.path),
                "method": request.method,
                "status_code": 500,
                "error": str(e),
                "error_type": type(e).__name__,
            },
            priority="urgent",  # Unhandled exceptions are critical
            tags=["api", "server-error", "exception"]
        )
        raise

# Register routers
# Documentation endpoints (role-filtered)
app.include_router(docs_router)  # /docs, /redoc, /openapi.json - filtered by user role

# Public endpoints (no authentication required)
app.include_router(about_router)  # About page stats (public)
app.include_router(health_router)  # Health check and hardware configuration (public)
app.include_router(metrics_router)  # Real-time metrics from Prometheus (public)
app.include_router(analytics_router)
app.include_router(media_router)
app.include_router(messages_router)
app.include_router(channels_router)
app.include_router(channel_submissions_router)  # Channel submissions (public + admin)
app.include_router(channel_network_router)  # Channel content network graphs
app.include_router(entities_router)  # Entity profile and search endpoints
app.include_router(events_router)  # Event timeline clustering
app.include_router(events_admin_router)  # Event admin operations (soft delete, audit)
app.include_router(models_router)  # Multi-model architecture management
app.include_router(flowsint_export_router)  # Flowsint graph data export
app.include_router(map_router)  # Map GeoJSON endpoints for geolocation
app.include_router(vessels_router)  # Vessel tracking (Shadow Fleet)
app.include_router(network_router)  # Network graph visualization
app.include_router(rss_router)
app.include_router(search_router)  # Unified search across all data sources
app.include_router(semantic_router)  # AI-powered semantic search
app.include_router(similarity_router)  # pgvector similarity search
app.include_router(social_graph_router)  # Social graph analysis (author, forwards, reactions, comments, influencers)
app.include_router(comments_router)  # Comment translation on-demand
app.include_router(stream_router)  # RSS intelligence stream
app.include_router(system_router)  # System health and status
app.include_router(timeline_router)  # Temporal context
app.include_router(news_timeline_router)  # News timeline (RSS + Telegram correlations)
app.include_router(validation_router)  # RSS validation layer (LLM-powered article classification)

# Authentication endpoints
app.include_router(auth_router)  # Authentication (login, user management)

# Authenticated user endpoints
app.include_router(api_keys_router)  # API key management (login required)
app.include_router(bookmarks_router)  # User bookmarks (login required)
app.include_router(feed_tokens_router)  # Feed token management (login required)
app.include_router(user_router)  # User profile and preferences (login required)

# Admin-only endpoints
app.include_router(spam_router)  # Spam management and reprocessing (admin only)
app.include_router(admin_dashboard_router)  # Admin dashboard and platform stats
app.include_router(admin_spam_router)  # Admin spam review queue
app.include_router(admin_media_router)  # Admin media gallery
app.include_router(admin_kanban_router)  # Admin urgency kanban
app.include_router(admin_channels_router)  # Admin channels management
app.include_router(admin_entities_router)  # Admin entities management
app.include_router(admin_prompts_router)  # Admin LLM prompts
app.include_router(admin_system_router)  # Admin system management (workers, logs, audit)
app.include_router(admin_feeds_router)  # Admin RSS feeds management
app.include_router(admin_export_router)  # Admin data export management
app.include_router(admin_config_router)  # Admin configuration management
app.include_router(admin_stats_router)  # Admin statistics dashboard
app.include_router(admin_comments_router)  # Admin comments management (on-demand fetch, viral tracking)
app.include_router(admin_users_router)  # Admin user management (Kratos integration)
app.include_router(admin_role_check_router)  # Oathkeeper role check endpoint (no auth required)
app.include_router(admin_fact_check_router)  # Admin fact-check review and discrepancy management
app.include_router(admin_message_actions_router)  # Admin message moderation actions (sidebar)


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup."""
    logger.info("Starting REST API Service v0.1.0")
    logger.info("Registered routers: messages, channels, rss, social-graph, bookmarks, user, spam")
    logger.info(f"CORS origins: {cors_origins}")
    logger.info("API documentation available at /docs (role-filtered)")
    logger.info("RSS feeds available at /rss/search, /rss/channel/{username}, /rss/topic/{topic}")
    logger.info("Social graph endpoints available at /api/social-graph/*")
    logger.info("User endpoints available at /api/user/* (authenticated)")
    logger.info("Bookmark endpoints available at /api/bookmarks/* (authenticated)")
    logger.info("Spam management available at /api/spam/* (admin only)")
    logger.info("Prometheus metrics available at /metrics")

    # Start export worker
    try:
        from .export_worker import start_export_worker
        from .database import AsyncSessionLocal
        from minio import Minio
        from config.settings import settings

        # Initialize MinIO client if configured
        minio_client = None
        if settings.MINIO_ENDPOINT:
            minio_client = Minio(
                settings.MINIO_ENDPOINT.replace("http://", "").replace("https://", ""),
                access_key=settings.MINIO_ACCESS_KEY,
                secret_key=settings.MINIO_SECRET_KEY,
                secure=settings.MINIO_ENDPOINT.startswith("https://"),
            )
            logger.info(f"MinIO client initialized for export worker: {settings.MINIO_ENDPOINT}")

        await start_export_worker(
            session_factory=AsyncSessionLocal,
            minio_client=minio_client,
            minio_bucket=settings.MINIO_BUCKET_NAME,
        )
        logger.info("Export worker started")
    except Exception as e:
        logger.warning(f"Failed to start export worker: {e}")

    # Start database pool monitoring
    try:
        from .utils.db_metrics import start_pool_monitoring
        from models.base import engine
        await start_pool_monitoring(engine)
        logger.info("Database pool monitoring started")
    except Exception as e:
        logger.warning(f"Failed to start database pool monitoring: {e}")

    # TODO: Future enhancements
    # 1. ✅ Rate limiting (Redis-backed sliding window for map endpoints)
    # 2. ✅ Prometheus metrics initialized
    # 3. ✅ Database pool monitoring
    # 4. Add authentication (JWT)
    # 5. Add Redis caching for RSS feeds


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down REST API Service")

    # Stop export worker
    try:
        from .export_worker import stop_export_worker
        await stop_export_worker()
        logger.info("Export worker stopped")
    except Exception as e:
        logger.warning(f"Error stopping export worker: {e}")

    # Close rate limiting Redis client
    try:
        from .utils.rate_limit import close_rate_limit_redis
        await close_rate_limit_redis()
        logger.info("Rate limit Redis client closed")
    except Exception as e:
        logger.warning(f"Error closing rate limit Redis client: {e}")

    # Close WebSocket Redis pool
    try:
        from .utils.ws_redis_pool import cleanup_ws_redis_pool
        await cleanup_ws_redis_pool()
        logger.info("WebSocket Redis pool closed")
    except Exception as e:
        logger.warning(f"Error closing WebSocket Redis pool: {e}")

    # Stop database pool monitoring
    try:
        from .utils.db_metrics import stop_pool_monitoring
        await stop_pool_monitoring()
        logger.info("Database pool monitoring stopped")
    except Exception as e:
        logger.warning(f"Error stopping database pool monitoring: {e}")


@app.get("/health")
async def health_check():
    """Health check endpoint for Docker/Kubernetes."""
    return {
        "status": "healthy",
        "service": "api",
        "version": "0.1.0"
    }


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint."""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "name": f"{settings.PLATFORM_NAME} API",
        "version": "0.1.0",
        "documentation": "/docs",
        "redoc": "/redoc",
        "health": "/health",
        "metrics": "/metrics",
    }
