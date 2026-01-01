"""
API Routers Package (tg-archiver - No AI)

Exports all API router modules for registration in main.py
Removed: analytics, channel_network, entities, events, map, network, search,
         semantic, similarity, validation, news_timeline, channel_submissions,
         admin/entities, admin/prompts
"""

from .about import router as about_router
from .api_keys import router as api_keys_router
from .auth import router as auth_router
from .health import router as health_router
from .bookmarks import router as bookmarks_router
from .channels import router as channels_router
from .comments import router as comments_router
from .feed_tokens import router as feed_tokens_router
from .flowsint_export import router as flowsint_export_router
from .media import router as media_router
from .messages import router as messages_router
from .models import router as models_router
from .rss import router as rss_router
from .social_graph import router as social_graph_router
from .stream import router as stream_router
from .system import router as system_router
from .timeline import router as timeline_router
from .user import router as user_router
from .docs import router as docs_router
from .admin.dashboard import router as admin_dashboard_router
from .admin.spam import router as admin_spam_router
from .admin.media import router as admin_media_router
from .admin.kanban import router as admin_kanban_router
from .admin.channels import router as admin_channels_router
from .admin.system import router as admin_system_router
from .admin.feeds import router as admin_feeds_router
from .admin.export import router as admin_export_router
from .admin.config import router as admin_config_router
from .admin.stats import router as admin_stats_router
from .admin.comments import router as admin_comments_router
from .admin.users import router as admin_users_router
from .admin.role_check import router as admin_role_check_router
from .admin.fact_check import router as admin_fact_check_router
from .admin.message_actions import router as admin_message_actions_router
from .metrics import router as metrics_router

__all__ = [
    "about_router",
    "api_keys_router",
    "auth_router",
    "health_router",
    "bookmarks_router",
    "channels_router",
    "comments_router",
    "feed_tokens_router",
    "flowsint_export_router",
    "media_router",
    "messages_router",
    "models_router",
    "rss_router",
    "social_graph_router",
    "stream_router",
    "system_router",
    "timeline_router",
    "user_router",
    "docs_router",
    "admin_dashboard_router",
    "admin_spam_router",
    "admin_media_router",
    "admin_kanban_router",
    "admin_channels_router",
    "admin_system_router",
    "admin_feeds_router",
    "admin_export_router",
    "admin_config_router",
    "admin_stats_router",
    "admin_comments_router",
    "admin_users_router",
    "admin_role_check_router",
    "admin_fact_check_router",
    "admin_message_actions_router",
    "metrics_router",
]
