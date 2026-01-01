"""
API Schemas (Pydantic Models)

Defines request/response schemas for FastAPI endpoints.
Handles serialization, validation, and documentation.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict, model_validator


# =============================================================================
# MESSAGE SCHEMAS
# =============================================================================


class MessageTag(BaseModel):
    """AI-generated tag for message classification."""

    id: int
    message_id: int
    tag: str
    tag_type: str  # keywords, topics, entities, emotions, urgency
    confidence: float
    generated_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CuratedEntityMatch(BaseModel):
    """Curated entity matched to a message from knowledge graph."""

    entity_id: int
    entity_type: str  # equipment, individual, organization, location, event, military_unit, ship, aircraft
    name: str
    description: Optional[str] = None
    similarity_score: float  # 0.0-1.0 confidence
    match_type: str  # exact_name, alias, hashtag, semantic
    source_reference: str  # armyguide, root_nk_database, odin_sanctions, etc.

    model_config = ConfigDict(from_attributes=True)


class MediaItemSimple(BaseModel):
    """Media item with URL and mime type for proper HTML5 element rendering."""

    url: str = Field(..., description="Full URL to the media file")
    mime_type: str = Field(..., description="MIME type (e.g., video/mp4, image/jpeg, audio/mpeg)")
    media_type: str = Field(..., description="Category: image, video, audio, or document")

    model_config = ConfigDict(from_attributes=True)


class OpenSanctionsEntityMatch(BaseModel):
    """OpenSanctions entity matched to a message (sanctioned, PEP, criminal, corporate)."""

    entity_id: int
    opensanctions_id: str  # External ID from OpenSanctions API
    entity_type: str  # Person, Organization, Company, etc. (FtM schema types)
    schema_type: str  # FtM schema type
    name: str
    description: Optional[str] = None
    risk_classification: str  # sanctioned, pep, criminal, corporate
    datasets: list[str] = Field(default_factory=list)  # Which datasets entity appears in
    match_score: float  # 0.0-1.0 confidence from matching
    match_method: str  # real_time, async_enrichment, manual
    aliases: Optional[list[str]] = None  # Known aliases

    model_config = ConfigDict(from_attributes=True)


class MessageLocation(BaseModel):
    """Geocoded location for a message."""

    id: int
    message_id: int
    location_name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    extraction_method: Optional[str] = None  # gazetteer, llm_relative, nominatim, manual
    confidence: Optional[float] = None
    sequence_order: int = 0  # Order in message text (0=first, 1=second, etc.)
    location_type: str = "point"  # point, origin, destination, waypoint
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ChannelSummary(BaseModel):
    """Lightweight channel info for embedding in message responses."""

    id: Optional[int] = None
    telegram_id: Optional[int] = None
    username: Optional[str] = None
    name: Optional[str] = None
    folder: Optional[str] = None  # CRITICAL: Used for country indicators in frontend
    verified: bool = False
    scam: bool = False
    fake: bool = False
    restricted: bool = False

    # Channel source categorization (human-managed via NocoDB)
    source_type: Optional[str] = Field(
        None,
        description="Channel type: state_media, military_unit, military_official, government_official, journalist, osint_aggregator, news_aggregator, personality, regional, militant, unknown"
    )
    affiliation: Optional[str] = Field(
        None,
        description="Channel affiliation: russia, ukraine, neutral, unknown"
    )


class MessageBase(BaseModel):
    """Base message schema with common fields."""

    message_id: int
    channel_id: int
    content: str
    telegram_date: Optional[datetime] = None
    channel: Optional[ChannelSummary] = None  # Embedded channel info for Telegram URL generation

    # Translation metadata
    language_detected: Optional[str] = None
    content_translated: Optional[str] = None
    translation_provider: Optional[str] = None
    translation_target: Optional[str] = None

    # Spam detection
    is_spam: bool = False
    spam_confidence: Optional[float] = None
    spam_reason: Optional[str] = Field(None, description="Why message was marked as spam")
    spam_type: Optional[str] = Field(None, description="Type of spam: financial, promotional, off_topic")
    spam_review_status: Optional[str] = Field(None, description="Review status: pending, reviewed, false_positive, true_positive, reprocessed")

    # LLM Classification
    osint_topic: Optional[str] = Field(None, description="LLM-classified topic (combat, general, etc.)")
    importance_level: Optional[str] = Field(None, description="LLM importance: high, medium, low")

    # Legacy regex fields (kept for backward compatibility)
    keyword_match_count: Optional[int] = Field(None, description="DEPRECATED: Legacy regex keyword count")
    entities: Optional[dict] = Field(None, description="DEPRECATED: Regex-based entity extraction")

    # Engagement metrics from Telegram
    views: Optional[int] = Field(None, description="Telegram view count")
    forwards: Optional[int] = Field(None, description="Telegram forward count")

    # Social graph metadata
    author_user_id: Optional[int] = Field(None, description="Telegram user ID of author (if available)")
    replied_to_message_id: Optional[int] = Field(None, description="Message ID this is replying to")
    forward_from_channel_id: Optional[int] = Field(None, description="Original channel ID if forwarded")
    forward_from_message_id: Optional[int] = Field(None, description="Original message ID if forwarded")
    forward_date: Optional[datetime] = Field(None, description="When original message was posted")

    # Comments/Discussion
    has_comments: bool = Field(False, description="Whether message has discussion thread")
    comments_count: int = Field(0, description="Number of comments in discussion")
    linked_chat_id: Optional[int] = Field(None, description="Linked discussion group ID")

    # AI enrichment metadata
    content_sentiment: Optional[str] = Field(None, description="LLM sentiment: positive, negative, neutral, urgent")
    content_urgency_level: Optional[int] = Field(None, description="0-100 urgency score")
    content_complexity: Optional[str] = Field(None, description="simple, moderate, complex")
    key_phrases: Optional[list[str]] = Field(None, description="Extracted key phrases")
    summary: Optional[str] = Field(None, description="AI-generated summary")
    summary_generated_at: Optional[datetime] = Field(None, description="When summary was generated")

    # Embedding metadata
    embedding_model: Optional[str] = Field(None, description="Model used for content_embedding")
    embedding_generated_at: Optional[datetime] = Field(None, description="When embedding was generated")

    # Human review
    needs_human_review: bool = Field(False, description="Flagged for human review")
    osint_reviewed: bool = Field(False, description="Has been reviewed by human")
    manual_importance_level: Optional[str] = Field(None, description="Human-assigned importance: high, medium, low")
    reviewed_by: Optional[str] = Field(None, description="Reviewer username")
    reviewed_at: Optional[datetime] = Field(None, description="When reviewed")

    # Selective archival
    archive_triggered_by: Optional[int] = Field(None, description="User ID who triggered archival")
    archive_triggered_at: Optional[datetime] = Field(None, description="When archival was triggered")
    archive_priority: Optional[int] = Field(None, description="Archival priority level")

    # Translation timestamps/cost
    translation_timestamp: Optional[datetime] = Field(None, description="When translation was done")
    translation_cost_usd: Optional[float] = Field(None, description="Translation cost in USD")

    # Media availability tracking
    media_was_available: Optional[bool] = Field(None, description="Whether media was available on Telegram")
    media_expired_at: Optional[datetime] = Field(None, description="When media URL expired")

    # AI-generated tags
    tags: list[MessageTag] = Field(default_factory=list, description="AI-generated classification tags")

    # Curated entity matches from knowledge graph
    curated_entities: list[CuratedEntityMatch] = Field(
        default_factory=list,
        description="Matched entities from curated knowledge graph (1,425 items from ArmyGuide, Root.NK, ODIN)"
    )

    # OpenSanctions entity matches (sanctions, PEPs, criminals)
    opensanctions_entities: list[OpenSanctionsEntityMatch] = Field(
        default_factory=list,
        description="Matched entities from OpenSanctions database (sanctioned individuals, PEPs, criminals, corporations)"
    )

    # Geocoded locations (supports multiple locations per message)
    location: Optional[MessageLocation] = Field(
        None,
        description="Primary geocoded location (first in sequence, for backward compatibility)"
    )
    locations: list[MessageLocation] = Field(
        default_factory=list,
        description="All geocoded locations with sequence order and trajectory type (origin/destination/waypoint)"
    )

    # Media
    media_type: Optional[str] = None
    media_url_telegram: Optional[str] = None
    media_urls: list[str] = Field(default_factory=list, description="S3 keys for media files (deprecated, use media_items)")
    media_items: list[MediaItemSimple] = Field(
        default_factory=list,
        description="Structured media items with URL, mime_type, and media_type for proper HTML5 rendering"
    )
    first_media_url: Optional[str] = Field(None, description="First media file URL (for thumbnail/preview)")
    grouped_id: Optional[int] = Field(None, description="Telegram grouped_id for album messages")

    # Archival metadata
    is_backfilled: bool = False

    # Timestamps
    created_at: datetime
    updated_at: datetime

    # Message Authenticity Hashing (Phase 3)
    content_hash: Optional[str] = Field(
        None,
        description="SHA-256 hash of message content only"
    )
    metadata_hash: Optional[str] = Field(
        None,
        description="SHA-256 hash of full message metadata (message_id, channel_id, telegram_date, content, sender_id, forward metadata)"
    )
    hash_algorithm: Optional[str] = Field(
        None,
        description="Hash algorithm used (default: sha256)"
    )
    hash_generated_at: Optional[datetime] = Field(
        None,
        description="Timestamp when hash was generated"
    )
    hash_version: Optional[int] = Field(
        None,
        description="Hash version (allows algorithm updates without breaking existing hashes)"
    )


class MessageDetail(MessageBase):
    """Detailed message with all fields (for single message view)."""

    id: int

    model_config = ConfigDict(from_attributes=True)


class MessageList(MessageBase):
    """Message summary for list views (lighter payload)."""

    id: int

    model_config = ConfigDict(from_attributes=True)


class AdjacentMessages(BaseModel):
    """Previous and next message IDs for navigation."""

    current_id: int
    prev_id: Optional[int] = None
    next_id: Optional[int] = None


# =============================================================================
# CHANNEL SCHEMAS
# =============================================================================


class ChannelBase(BaseModel):
    """Base channel schema."""

    telegram_id: int
    username: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None

    # Folder-based management
    folder: Optional[str] = None
    rule: Optional[str] = None  # Fixed: should be Optional to match database model
    active: bool = True

    # Metadata
    verified: bool = False
    scam: bool = False
    fake: bool = False
    restricted: bool = False

    # Channel source categorization (human-managed via NocoDB)
    source_type: Optional[str] = Field(
        None,
        description="Channel type: state_media, military_unit, military_official, government_official, journalist, osint_aggregator, news_aggregator, personality, regional, militant, unknown"
    )
    affiliation: Optional[str] = Field(
        None,
        description="Channel affiliation: russia, ukraine, neutral, unknown"
    )


class ChannelDetail(ChannelBase):
    """Detailed channel with all fields."""

    id: int
    created_at: datetime
    updated_at: datetime
    last_message_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ChannelList(ChannelBase):
    """Channel summary for list views."""

    id: int
    last_message_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# SEARCH SCHEMAS
# =============================================================================


class SearchParams(BaseModel):
    """Search query parameters."""

    # Text search
    q: Optional[str] = Field(None, description="Search query (full-text)")

    # Filters
    channel_id: Optional[int] = Field(None, description="Filter by channel ID")
    channel_username: Optional[str] = Field(None, description="Filter by channel username")
    importance_level: Optional[str] = Field(None, description="Filter by importance level: high, medium, low")
    topic: Optional[str] = Field(
        None, description="Filter by topic (combat/civilian/diplomatic/equipment/general)"
    )
    has_media: Optional[bool] = Field(None, description="Filter messages with media")
    media_type: Optional[str] = Field(
        None, description="Filter by media type (photo/video/document/audio/voice/sticker/animation)"
    )
    is_spam: Optional[bool] = Field(None, description="Include spam messages")

    # Date range
    date_from: Optional[datetime] = Field(None, description="Start date (inclusive)")
    date_to: Optional[datetime] = Field(None, description="End date (inclusive)")
    days: Optional[int] = Field(None, ge=1, le=365, description="Last N days")

    # Pagination
    page: int = Field(default=1, ge=1, description="Page number (1-indexed)")
    page_size: int = Field(default=50, ge=1, le=100, description="Items per page")

    # Sorting
    sort_by: str = Field(default="created_at", description="Sort field")
    sort_order: str = Field(default="desc", description="Sort order (asc/desc)")


class SearchResult(BaseModel):
    """Search results with pagination metadata."""

    items: list[MessageList]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool


# =============================================================================
# STATISTICS SCHEMAS
# =============================================================================


class ChannelStats(BaseModel):
    """Channel statistics."""

    total_messages: int
    spam_messages: int
    archived_messages: int
    high_importance_count: int = 0  # Count of messages with importance_level='high'
    messages_by_topic: dict[str, int]
    first_message_at: Optional[datetime] = None
    last_message_at: Optional[datetime] = None


class PlatformStats(BaseModel):
    """Platform-wide statistics."""

    total_channels: int
    active_channels: int
    total_messages: int
    messages_today: int
    messages_this_week: int
    high_importance_count: int = 0  # Count of messages with importance_level='high'
    messages_by_topic: dict[str, int]
    storage_used_mb: Optional[float] = None


# =============================================================================
# BACKFILL SCHEMAS
# =============================================================================


class BackfillRequest(BaseModel):
    """Request schema for manual backfill trigger."""

    from_date: Optional[datetime] = Field(
        None,
        description="Start date for backfill (ISO format). If not provided, uses BACKFILL_START_DATE from .env",
    )


class BackfillResponse(BaseModel):
    """Response schema for backfill operation."""

    channel_id: int = Field(description="Channel database ID")
    channel_name: str = Field(description="Channel name")
    status: str = Field(
        description="Backfill status: pending, in_progress, completed, paused, failed"
    )

    # Stats (only present if backfill started/completed)
    messages_fetched: Optional[int] = Field(
        None, description="Total messages fetched so far"
    )
    messages_stored: Optional[int] = Field(
        None, description="Messages successfully stored"
    )
    media_available: Optional[int] = Field(
        None, description="Media files still available on Telegram"
    )
    media_expired: Optional[int] = Field(
        None, description="Media files that expired"
    )
    errors: Optional[int] = Field(None, description="Number of errors encountered")
    duration_seconds: Optional[float] = Field(
        None, description="Time taken (seconds)"
    )

    # FloodWait handling
    completed: Optional[bool] = Field(None, description="Whether backfill finished")
    flood_wait_seconds: Optional[int] = Field(
        None, description="Seconds to wait if FloodWait error occurred"
    )
    error: Optional[str] = Field(None, description="Error message if backfill failed")


# =============================================================================
# ANALYTICS SCHEMAS
# =============================================================================


class DateBucket(BaseModel):
    """Time-series bucket with aggregated statistics."""

    timestamp: datetime
    message_count: int
    high_importance_count: int = 0  # Count of messages with importance_level='high' in this bucket
    media_count: int = 0


class TimelineStats(BaseModel):
    """Timeline statistics for visualizations."""

    granularity: str  # 'hour', 'day', 'week', 'month', 'year'
    buckets: list[DateBucket]
    total_buckets: int


class DistributionStats(BaseModel):
    """Statistical distributions for visualizations."""

    importance_levels: Optional[dict[str, int]] = None  # {'high': count, 'medium': count, 'low': count}
    topics: Optional[dict[str, int]] = None
    channels: Optional[dict[int, int]] = None
    media_types: Optional[dict[str, int]] = None
    languages: Optional[dict[str, int]] = None


class ChannelDailyStats(BaseModel):
    """Daily aggregates for a channel."""

    date: str  # YYYY-MM-DD format
    message_count: int
    spam_count: int
    non_spam_count: int
    high_importance_count: int
    medium_importance_count: int
    low_importance_count: int
    media_count: int


class ChannelAnalytics(BaseModel):
    """Channel performance analytics."""

    channel_id: int
    channel_name: str
    channel_username: Optional[str] = None

    # Aggregate stats for the period
    total_messages: int
    total_spam: int
    spam_rate: float  # percentage
    high_importance_count: int
    media_count: int

    # Time series (daily buckets)
    daily_stats: list[ChannelDailyStats]

    # Performance metrics
    avg_messages_per_day: float
    peak_day: Optional[str] = None  # Date of highest activity
    peak_count: int = 0


class ChannelAnalyticsResponse(BaseModel):
    """Response for channel analytics endpoint."""

    channels: list[ChannelAnalytics]
    total_channels: int
    date_from: str
    date_to: str
    cached: bool = False


class EntityMention(BaseModel):
    """Entity mention statistics."""

    entity_id: int
    entity_name: str
    entity_type: str
    mention_count: int
    unique_channels: int
    first_mention: Optional[str] = None
    last_mention: Optional[str] = None


class EntityAnalyticsResponse(BaseModel):
    """Response for entity analytics endpoint."""

    top_entities: list[EntityMention]
    total_entities: int
    total_mentions: int
    by_type: dict[str, int]  # Count per entity type
    date_from: str
    date_to: str
    cached: bool = False


class MediaTypeStats(BaseModel):
    """Media type statistics."""

    media_type: str
    count: int
    total_size_bytes: int
    total_size_human: str
    percentage: float


class MediaAnalyticsResponse(BaseModel):
    """Response for media analytics endpoint."""

    total_files: int
    total_size_bytes: int
    total_size_human: str
    by_type: list[MediaTypeStats]
    deduplication_savings_bytes: int
    deduplication_savings_human: str
    date_from: str
    date_to: str
    cached: bool = False


# =============================================================================
# PROGRESSIVE DISCLOSURE SCHEMAS
# =============================================================================


class MessageCompact(BaseModel):
    """Ultra-compact message for list views (minimize payload)."""

    id: int
    channel_id: int
    content: Optional[str] = Field(None, max_length=200)  # Truncated to 200 chars
    importance_level: Optional[str] = None  # high, medium, low
    media_type: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MessageExpanded(MessageCompact):
    """Expanded message with enrichment (for hover/preview)."""

    osint_topic: Optional[str] = None
    entities: Optional[dict] = None
    is_spam: bool = False
    telegram_date: Optional[datetime] = None
    content_translated: Optional[str] = Field(None, max_length=200)  # Truncated

    model_config = ConfigDict(from_attributes=True)


class MessageFull(BaseModel):
    """Full message detail with all fields (for dedicated detail view)."""

    id: int
    message_id: int
    channel_id: int
    content: Optional[str] = None
    telegram_date: Optional[datetime] = None
    grouped_id: Optional[int] = None

    # Translation
    content_translated: Optional[str] = None
    language_detected: Optional[str] = None
    translation_provider: Optional[str] = None

    # Enrichment
    is_spam: bool = False
    spam_confidence: Optional[float] = None
    importance_level: Optional[str] = None  # high, medium, low
    osint_topic: Optional[str] = None
    entities: Optional[dict] = None

    # Media
    media_type: Optional[str] = None
    media_url_telegram: Optional[str] = None
    media_urls: list[str] = Field(default_factory=list, description="S3 keys for media files (deprecated, use media_items)")
    media_items: list[MediaItemSimple] = Field(
        default_factory=list,
        description="Structured media items with URL, mime_type, and media_type for proper HTML5 rendering"
    )
    first_media_url: Optional[str] = Field(None, description="First media file URL (for thumbnail/preview)")

    # Archival
    archive_triggered_by: Optional[int] = None
    archive_triggered_at: Optional[datetime] = None
    is_backfilled: bool = False

    # Timestamps
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# =============================================================================
# MEDIA GALLERY SCHEMAS
# =============================================================================


class MediaItem(BaseModel):
    """Media item for gallery views (lighter than full message)."""

    message_id: int
    channel_id: int
    content: Optional[str] = None  # Truncated to 200 chars
    importance_level: Optional[str] = None  # high, medium, low
    osint_topic: Optional[str] = None
    created_at: datetime

    # Media metadata
    media_type: str
    media_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    file_size: int = 0
    mime_type: str


class MediaGalleryResult(BaseModel):
    """Paginated media gallery results."""

    items: list[MediaItem]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool


# =============================================================================
# ALBUM MEDIA SCHEMAS (Phase 2 - Lightbox)
# =============================================================================


class AlbumMediaItem(BaseModel):
    """Single media item from an album (for lightbox display)."""

    message_id: int
    media_id: int
    media_url: str  # Full MinIO URL ready for display
    media_type: str  # photo, video, document
    mime_type: str
    file_size: int
    sha256: str
    content: Optional[str] = None  # Caption for this specific photo
    telegram_date: Optional[datetime] = None


class AlbumMediaResponse(BaseModel):
    """Album media response for lightbox (all photos/videos in album)."""

    grouped_id: Optional[int] = Field(
        None,
        description="Telegram grouped_id if album, null if single message"
    )
    album_size: int = Field(description="Total number of media items (1 for single, 2+ for album)")
    current_index: int = Field(description="Index of the message that was clicked (0-based)")
    media: list[AlbumMediaItem] = Field(description="All media items in chronological order")


# =============================================================================
# INTELLIGENCE STREAM SCHEMAS
# =============================================================================


class UnifiedStreamItem(BaseModel):
    """Unified stream item combining Telegram and RSS content."""

    type: str  # 'telegram' or 'rss'
    id: int
    source_name: str  # Channel name or RSS feed name
    source_category: Optional[str] = None  # Folder or RSS category
    source_trust_level: Optional[int] = None  # Trust level (1-5) for RSS sources
    title: str  # Short title/headline
    content: str  # Full message/article content
    content_translated: Optional[str] = None  # Translated content (for Telegram messages)
    importance_level: Optional[str] = None  # LLM importance: high, medium, low
    tags: list[str] = Field(default_factory=list)  # Tags/categories
    published_at: datetime  # Message/article timestamp
    url: str  # Link to source (message URL or article URL)
    correlation_count: Optional[int] = None  # Number of correlated items


class CorrelatedArticle(BaseModel):
    """Single article in correlation response."""

    article_id: int
    title: str
    source_name: str  # RSS feed name
    source_category: Optional[str] = None  # RSS category
    source_trust_level: Optional[int] = None  # Trust level (1-5)
    similarity_score: float  # Cosine similarity (0-1)
    entity_overlap_score: Optional[int] = None  # Percentage overlap
    matched_entities: Optional[dict] = None  # Common entities between sources
    url: str  # Link to article
    published_at: datetime


class CorrelationResponse(BaseModel):
    """Response with correlated RSS articles grouped by type."""

    message_id: int
    same_event: list[CorrelatedArticle] = Field(
        default_factory=list,
        description="Articles covering the same event (high similarity)"
    )
    related: list[CorrelatedArticle] = Field(
        default_factory=list,
        description="Related articles (medium-high similarity)"
    )
    alternative_viewpoints: list[CorrelatedArticle] = Field(
        default_factory=list,
        description="Articles with opposing perspectives"
    )
    total_correlations: int = Field(
        0,
        description="Total number of correlated articles"
    )


# =============================================================================
# RSS VALIDATION LAYER SCHEMAS
# =============================================================================


class ArticleValidationItem(BaseModel):
    """Single article validation result."""

    article_id: int
    title: str
    source_name: str
    source_trust_level: int = Field(
        default=3,
        ge=1,
        le=5,
        description="Source trust level (1-5): 5=highest (Reuters/AP), 4=high (BBC/Kyiv Independent), 3=medium, 2=low (TASS/RT), 1=minimal"
    )
    source_category: Optional[str] = Field(
        default=None,
        description="Source category: ukraine, russia, neutral, international, social_media"
    )
    validation_type: str  # confirms|contradicts|context|alternative|none
    relevance_explanation: str
    confidence: int  # 0-100
    is_relevant: bool
    similarity_score: float  # From pgvector
    published_at: datetime
    url: str


class ValidationResponse(BaseModel):
    """LLM-generated validation summary for a Telegram message."""

    message_id: int
    summary: str  # 2-3 sentence overall summary
    total_articles_found: int
    articles_by_type: dict = Field(
        default_factory=dict,
        description="Count of articles by validation type"
    )
    overall_confidence: float  # Average confidence across all articles
    article_validations: list[ArticleValidationItem] = Field(
        default_factory=list,
        description="Individual article classifications"
    )
    cached: bool = Field(
        False,
        description="Whether this result was served from cache"
    )
    cache_expires_at: Optional[datetime] = Field(
        None,
        description="When cached result expires (if cached=true)"
    )
    processing_time_ms: Optional[int] = Field(
        None,
        description="Time taken to generate validation (if not cached)"
    )
"""
Social Graph API Schemas

Pydantic models for social graph endpoints.
Handles author attribution, forward chains, reactions, comments, and influence networks.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict


# =============================================================================
# MESSAGE SOCIAL GRAPH SCHEMAS
# =============================================================================


class AuthorInfo(BaseModel):
    """Author information for a message."""

    user_id: Optional[int] = None
    name: Optional[str] = None
    username: Optional[str] = None
    verified: bool = False


class ForwardInfo(BaseModel):
    """Forward chain information."""

    from_channel_id: Optional[int] = None
    from_channel_name: Optional[str] = None
    from_message_id: Optional[int] = None
    forward_date: Optional[datetime] = None


class ReplyInfo(BaseModel):
    """Reply threading information."""

    replied_to_message_id: Optional[int] = None
    parent_author_id: Optional[int] = None


class CommentSummary(BaseModel):
    """Comment statistics summary."""

    has_comments: bool = False
    comments_count: int = 0
    actual_comments_count: int = 0


class ReactionSummary(BaseModel):
    """Reaction statistics summary."""

    unique_reactions_count: int = 0
    total_reactions_count: int = 0
    top_reactions: Optional[list[dict]] = None  # [{"emoji": "👍", "count": 42}, ...]


class EngagementSnapshot(BaseModel):
    """Latest engagement metrics snapshot."""

    views_count: Optional[int] = None
    forwards_count: Optional[int] = None
    reactions_count: Optional[int] = None
    comments_count: Optional[int] = None
    propagation_rate: Optional[float] = None
    engagement_rate: Optional[float] = None
    snapshot_at: Optional[datetime] = None


class MessageSocialGraphResponse(BaseModel):
    """Complete social context for a message from materialized view."""

    message_id: int
    telegram_message_id: int
    channel_id: int
    channel_name: Optional[str] = None
    channel_username: Optional[str] = None

    # Author
    author: AuthorInfo

    # Forward chain
    forward: ForwardInfo

    # Reply threading
    reply: ReplyInfo

    # Comments
    comments: CommentSummary

    # Reactions
    reactions: ReactionSummary

    # Engagement
    views: Optional[int] = None
    forwards: Optional[int] = None
    latest_engagement: Optional[EngagementSnapshot] = None

    # Metadata
    telegram_date: Optional[datetime] = None
    is_spam: bool = False
    importance_level: Optional[str] = None  # high, medium, low
    created_at: datetime


# =============================================================================
# CHANNEL INFLUENCE NETWORK SCHEMAS
# =============================================================================


class ChannelInfluenceResponse(BaseModel):
    """Channel-to-channel influence relationship."""

    from_channel_id: int
    from_channel_name: Optional[str] = None
    from_channel_username: Optional[str] = None
    from_channel_verified: bool = False

    to_channel_id: int
    to_channel_name: Optional[str] = None
    to_channel_username: Optional[str] = None
    to_channel_verified: bool = False

    forward_count: int
    first_forward_at: Optional[datetime] = None
    last_forward_at: Optional[datetime] = None
    avg_forward_delay_hours: Optional[float] = None
    synchronized_forwards: Optional[int] = None
    topic_distribution: Optional[dict] = None

    coordination_level: str  # high_coordination, moderate_coordination, organic
    propagation_speed: str  # immediate, same_day, same_week, delayed

    updated_at: Optional[datetime] = None


class InfluenceNetworkResult(BaseModel):
    """Paginated channel influence network results."""

    items: list[ChannelInfluenceResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool


# =============================================================================
# ENGAGEMENT TIMELINE SCHEMAS
# =============================================================================


class EngagementTimelinePoint(BaseModel):
    """Single point in engagement timeline."""

    message_id: int
    snapshot_at: datetime

    views_count: Optional[int] = None
    forwards_count: Optional[int] = None
    reactions_count: Optional[int] = None
    comments_count: Optional[int] = None

    views_delta: Optional[int] = None
    forwards_delta: Optional[int] = None
    reactions_delta: Optional[int] = None
    comments_delta: Optional[int] = None

    propagation_rate: Optional[float] = None  # forwards / views * 100
    engagement_rate: Optional[float] = None  # (reactions + comments) / views * 100
    virality_score: Optional[int] = None

    created_at: datetime


class EngagementTimelineResponse(BaseModel):
    """Engagement timeline for virality tracking."""

    message_id: int
    timeline: list[EngagementTimelinePoint]
    total_snapshots: int


# =============================================================================
# REACTIONS SCHEMAS
# =============================================================================


class MessageReactionItem(BaseModel):
    """Individual emoji reaction."""

    emoji: str
    count: int
    user_id: Optional[int] = None  # If tracking individual users
    reacted_at: Optional[datetime] = None


class ReactionBreakdownResponse(BaseModel):
    """Detailed emoji reactions breakdown."""

    message_id: int
    reactions: list[MessageReactionItem]
    total_reactions: int
    unique_emojis: int


# =============================================================================
# COMMENTS SCHEMAS
# =============================================================================


class CommentResponse(BaseModel):
    """Individual comment/reply from discussion thread."""

    id: int
    parent_message_id: int
    comment_id: int  # Telegram message_id in discussion group
    author_user_id: Optional[int] = None
    author_name: Optional[str] = None
    content: Optional[str] = None
    telegram_date: Optional[datetime] = None

    # Engagement on comment itself
    views: Optional[int] = None
    forwards: Optional[int] = None

    created_at: datetime


class CommentsThreadResponse(BaseModel):
    """Paginated comments thread."""

    message_id: int
    comments: list[CommentResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool


# =============================================================================
# INFLUENCERS SCHEMAS
# =============================================================================


class InfluencerResponse(BaseModel):
    """Top influencer profile."""

    telegram_id: int
    full_name: Optional[str] = None
    username: Optional[str] = None
    is_verified: bool = False
    is_premium: bool = False
    is_bot: bool = False

    # Activity metrics
    interaction_count: int
    first_seen: Optional[datetime] = None
    last_seen: Optional[datetime] = None

    # Authorship stats
    messages_authored: int
    comments_made: int

    # Engagement averages
    avg_views_per_message: int
    avg_forwards_per_message: int
    high_importance_message_count: int  # Count of authored messages with importance_level='high'

    # Influence score (weighted composite)
    influence_score: int


class InfluencersListResponse(BaseModel):
    """Paginated top influencers list."""

    influencers: list[InfluencerResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    has_next: bool
    has_prev: bool
