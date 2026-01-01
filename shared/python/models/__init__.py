"""Database models module."""

from .base import AsyncSessionLocal, Base, engine, get_db
from .api_key import ApiKey
from .channel import Channel
from .channel_submission import ChannelSubmission
from .correlation import MessageNewsCorrelation
from .curated_entity import CuratedEntity
from .decision_log import DecisionLog
from .dr_history import DRBackupHistory, DRFailoverHistory
from .entity_relationship import EntityRelationship
from .export_job import ExportJob, MESSAGE_EXPORT_PROFILES, EXPORT_EXCLUDED_COLUMNS
from .event import Event, EventMessage
from .external_news import ExternalNews
from .feed_token import FeedToken
from .feed_subscription import FeedSubscription
from .llm_prompt import LLMPrompt
from .location_gazetteer import LocationGazetteer
from .message_location import MessageLocation
from .shadow_account_state import ShadowAccountState
from .telegram_account import TelegramAccount
from .telegram_cluster import TelegramEventCluster, ClusterMessage
from .storage import StorageBox  # Must come before MediaFile (FK dependency)
from .media import MediaFile, MessageMedia
from .message import Message
from .message_comment import MessageComment
from .message_entity import MessageEntity
from .message_quarantine import MessageQuarantine
from .military_slang import MilitarySlang, build_slang_glossary
from .model_configuration import ModelConfiguration
from .opensanctions_entity import OpenSanctionsEntity
from .opensanctions_message_entity import OpenSanctionsMessageEntity
from .news_source import NewsSource
from .rss_feed import RSSFeed
from .tag import MessageTag, TagStats
from .translation import TranslationConfig, TranslationUsage
from .user import User
from .validation import MessageValidation
from .viral_post import ViralPost
from .spam_reference import SpamReferenceExample

# Import order matters for foreign key relationships
__all__ = [
    # Base
    "Base",
    "engine",
    "AsyncSessionLocal",
    "get_db",
    # Models
    "Channel",
    "ChannelSubmission",
    "User",
    "ApiKey",
    "FeedToken",
    "FeedSubscription",
    "Message",
    "MessageComment",
    "MessageQuarantine",
    "StorageBox",
    "MediaFile",
    "MessageMedia",
    "MessageTag",
    "TagStats",
    "ModelConfiguration",
    "LLMPrompt",
    "MilitarySlang",
    "build_slang_glossary",
    "TranslationConfig",
    "TranslationUsage",
    # RSS Intelligence Layer
    "RSSFeed",
    "NewsSource",
    "ExternalNews",
    "MessageNewsCorrelation",
    # OpenSanctions Intelligence Layer
    "OpenSanctionsEntity",
    "OpenSanctionsMessageEntity",
    "MessageEntity",
    "EntityRelationship",
    # Entity Knowledge Graph
    "CuratedEntity",
    # Validation Layer
    "MessageValidation",
    # Event Timeline
    "Event",
    "EventMessage",
    # Geolocation
    "LocationGazetteer",
    "MessageLocation",
    # Telegram Cluster Detection
    "TelegramEventCluster",
    "ClusterMessage",
    # Decision Audit
    "DecisionLog",
    # Export System
    "ExportJob",
    "MESSAGE_EXPORT_PROFILES",
    "EXPORT_EXCLUDED_COLUMNS",
    # Viral Tracking
    "ViralPost",
    # Disaster Recovery
    "TelegramAccount",
    "ShadowAccountState",
    "DRBackupHistory",
    "DRFailoverHistory",
    # Spam Reference Examples (embedding-based classification)
    "SpamReferenceExample",
]
