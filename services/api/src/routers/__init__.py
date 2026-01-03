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
from .media import router as media_router
from .messages import router as messages_router
# Removed: models_router (AI/LLM model configuration)
from .rss import router as rss_router
from .social_graph import router as social_graph_router
from .stream import router as stream_router
from .system import router as system_router
from .user import router as user_router
from .docs import router as docs_router
from .admin.dashboard import router as admin_dashboard_router
from .admin.media import router as admin_media_router
from .admin.kanban import router as admin_kanban_router
from .admin.channels import router as admin_channels_router
from .admin.system import router as admin_system_router
from .admin.feeds import router as admin_feeds_router
from .admin.export import router as admin_export_router
from .admin.config import router as admin_config_router
from .admin.stats import router as admin_stats_router
from .admin.users import router as admin_users_router
from .admin.message_actions import router as admin_message_actions_router
from .admin.categories import router as admin_categories_router
from .admin.extraction import router as admin_extraction_router
from .admin.folders import router as admin_folders_router
from .admin.topics import router as admin_topics_router
from .admin.import_channels import router as admin_import_router
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
    "media_router",
    "messages_router",
    # Removed: "models_router" (AI/LLM)
    "rss_router",
    "social_graph_router",
    "stream_router",
    "system_router",
    "user_router",
    "docs_router",
    "admin_dashboard_router",
    "admin_media_router",
    "admin_kanban_router",
    "admin_channels_router",
    "admin_system_router",
    "admin_feeds_router",
    "admin_export_router",
    "admin_config_router",
    "admin_stats_router",
    "admin_users_router",
    "admin_message_actions_router",
    "admin_categories_router",
    "admin_extraction_router",
    "admin_folders_router",
    "admin_topics_router",
    "admin_import_router",
    "metrics_router",
]
