"""
Admin API Routers

Centralized admin endpoints for platform management.
All endpoints require admin authentication.
"""

from .dashboard import router as dashboard_router
from .media import router as media_router
from .kanban import router as kanban_router
from .channels import router as channels_router
# Removed: entities_router, prompts_router (AI-related)
from .system import router as system_router
from .feeds import router as feeds_router
from .export import router as export_router
from .config import router as config_router
from .stats import router as stats_router
from .users import router as users_router
from .categories import router as categories_router
from .message_actions import router as message_actions_router
from .extraction import router as extraction_router
from .folders import router as folders_router
from .topics import router as topics_router

__all__ = [
    'dashboard_router',
    'media_router',
    'kanban_router',
    'channels_router',
    # Removed: 'entities_router', 'prompts_router' (AI-related)
    'system_router',
    'feeds_router',
    'export_router',
    'config_router',
    'stats_router',
    'users_router',
    'categories_router',
    'message_actions_router',
    'extraction_router',
    'folders_router',
    'topics_router',
]
