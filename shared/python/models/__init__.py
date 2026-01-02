"""Database models module for tg-archiver."""

from .base import AsyncSessionLocal, Base, engine, get_db
from .api_key import ApiKey
from .channel_category import ChannelCategory  # Must come before Channel (FK dependency)
from .channel import Channel
from .channel_submission import ChannelSubmission
from .extraction_pattern import ExtractionPattern
from .export_job import ExportJob, MESSAGE_EXPORT_PROFILES, EXPORT_EXCLUDED_COLUMNS
from .import_job import ImportJob, ImportJobChannel, ImportJobLog
from .external_news import ExternalNews
from .monitored_folder import MonitoredFolder
from .feed_token import FeedToken
from .feed_subscription import FeedSubscription
from .storage import StorageBox  # Must come before MediaFile (FK dependency)
from .media import MediaFile, MessageMedia
from .message import Message
from .message_comment import MessageComment
from .message_topic import MessageTopic
from .message_quarantine import MessageQuarantine
from .rss_feed import RSSFeed
from .tag import MessageTag, TagStats
from .user import User

# Import order matters for foreign key relationships
__all__ = [
    # Base
    "Base",
    "engine",
    "AsyncSessionLocal",
    "get_db",
    # Models
    "ChannelCategory",
    "Channel",
    "ChannelSubmission",
    "User",
    "ApiKey",
    "FeedToken",
    "FeedSubscription",
    "Message",
    "MessageComment",
    "MessageTopic",
    "MessageQuarantine",
    "StorageBox",
    "MediaFile",
    "MessageMedia",
    "MessageTag",
    "TagStats",
    # RSS Layer
    "RSSFeed",
    "ExternalNews",
    # Entity Extraction
    "ExtractionPattern",
    # Export System
    "ExportJob",
    "MESSAGE_EXPORT_PROFILES",
    "EXPORT_EXCLUDED_COLUMNS",
    # Import System
    "ImportJob",
    "ImportJobChannel",
    "ImportJobLog",
    "MonitoredFolder",
]
