"""
Admin API Routers

Centralized admin endpoints for platform management.
All endpoints require admin authentication.
"""

from .dashboard import router as dashboard_router
from .spam import router as spam_router
from .media import router as media_router
from .kanban import router as kanban_router
from .channels import router as channels_router
from .entities import router as entities_router
from .prompts import router as prompts_router
from .system import router as system_router
from .feeds import router as feeds_router
from .export import router as export_router
from .config import router as config_router
from .stats import router as stats_router
from .comments import router as comments_router
from .users import router as users_router
from .role_check import router as role_check_router
from .fact_check import router as fact_check_router

__all__ = [
    'dashboard_router',
    'spam_router',
    'media_router',
    'kanban_router',
    'channels_router',
    'entities_router',
    'prompts_router',
    'system_router',
    'feeds_router',
    'export_router',
    'config_router',
    'stats_router',
    'comments_router',
    'users_router',
    'role_check_router',
    'fact_check_router',
]
