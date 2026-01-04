-- tg-archiver Database Schema
-- PostgreSQL 16+ initialization script
-- Simplified schema for Telegram archiving
-- Table names match SQLAlchemy ORM models

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- For full-text search similarity
CREATE EXTENSION IF NOT EXISTS btree_gin; -- For compound GIN indexes

-- ===========================================================================
-- SCHEMA MIGRATIONS TRACKING
-- ===========================================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum VARCHAR(64),
    applied_by VARCHAR(100) DEFAULT current_user
);

INSERT INTO schema_migrations (version, description, checksum)
VALUES ('000', 'Initial schema from init.sql', NULL)
ON CONFLICT (version) DO NOTHING;

-- ===========================================================================
-- USERS (required before channels for FK)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ===========================================================================
-- STORAGE BOXES (for multi-box media storage routing)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS storage_boxes (
    id VARCHAR(50) PRIMARY KEY,              -- e.g., 'default', 'hetzner-1', 'box-1'
    name VARCHAR(100) NOT NULL,
    storage_type VARCHAR(50) NOT NULL DEFAULT 'minio',
    endpoint VARCHAR(500),
    bucket_name VARCHAR(100),
    access_key VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    is_primary BOOLEAN DEFAULT FALSE,
    total_size_bytes BIGINT DEFAULT 0,
    used_size_bytes BIGINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default storage box
INSERT INTO storage_boxes (id, name, storage_type, is_active, is_primary)
VALUES ('default', 'Default MinIO Storage', 'minio', true, true)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- CHANNEL CATEGORIES (admin-configurable)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS channel_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    color VARCHAR(20) DEFAULT 'gray',
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed with neutral default categories
INSERT INTO channel_categories (name, color, description, sort_order)
VALUES
    ('news', 'blue', 'News and media channels', 1),
    ('official', 'green', 'Official government or organization channels', 2),
    ('community', 'purple', 'Community and discussion channels', 3),
    ('aggregator', 'orange', 'Content aggregation channels', 4),
    ('other', 'gray', 'Uncategorized channels', 99)
ON CONFLICT (name) DO NOTHING;

-- ===========================================================================
-- MESSAGE TOPICS (admin-configurable for message classification)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS message_topics (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    label VARCHAR(100) NOT NULL,
    color VARCHAR(20) DEFAULT 'gray',
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed with default topics
INSERT INTO message_topics (name, label, color, description, sort_order)
VALUES
    ('news', 'News', 'blue', 'News and current events', 1),
    ('announcement', 'Announcement', 'green', 'Official announcements', 2),
    ('discussion', 'Discussion', 'purple', 'Community discussions', 3),
    ('media', 'Media', 'cyan', 'Photos, videos, documents', 4),
    ('important', 'Important', 'red', 'High-priority content', 5),
    ('archive', 'Archive', 'gray', 'Historical content', 6),
    ('offtopic', 'Off-topic', 'yellow', 'Unrelated to main theme', 7),
    ('other', 'Other', 'gray', 'Uncategorized content', 99)
ON CONFLICT (name) DO NOTHING;

-- ===========================================================================
-- CHANNELS (matches SQLAlchemy Channel model)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL UNIQUE,
    username VARCHAR(100),
    access_hash BIGINT,

    -- Channel metadata
    name VARCHAR(255),
    description TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'source',
    verified BOOLEAN DEFAULT FALSE,
    scam BOOLEAN DEFAULT FALSE,
    fake BOOLEAN DEFAULT FALSE,
    restricted BOOLEAN DEFAULT FALSE,

    -- Categorization (admin-configurable)
    category_id INTEGER REFERENCES channel_categories(id) ON DELETE SET NULL,

    -- Folder-based management
    folder VARCHAR(100),
    rule VARCHAR(50),
    source VARCHAR(20) DEFAULT 'folder_discovery',  -- Origin: folder_discovery, import, manual

    -- Multi-account support
    source_account VARCHAR(50) NOT NULL DEFAULT 'default',

    -- Status
    active BOOLEAN DEFAULT TRUE,
    removed_at TIMESTAMP WITH TIME ZONE,

    -- Backfill tracking
    backfill_status VARCHAR(20),
    backfill_from_date TIMESTAMP WITH TIME ZONE,
    backfill_messages_fetched INTEGER DEFAULT 0,
    backfill_completed_at TIMESTAMP WITH TIME ZONE,

    -- Discovery metadata
    discovery_status VARCHAR(50),
    discovery_metadata JSONB DEFAULT '{}',
    quality_metrics JSONB DEFAULT '{}',

    -- Retention
    retention_policy VARCHAR(50) DEFAULT 'permanent',
    removal_scheduled_at TIMESTAMP WITH TIME ZONE,
    removal_reason TEXT,

    -- Disaster recovery
    invite_link VARCHAR(100),
    invite_link_updated_at TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_channels_telegram_id ON channels(telegram_id);
CREATE INDEX IF NOT EXISTS idx_channels_username ON channels(username);
CREATE INDEX IF NOT EXISTS idx_channels_folder ON channels(folder);
CREATE INDEX IF NOT EXISTS idx_channels_rule ON channels(rule);
CREATE INDEX IF NOT EXISTS idx_channels_active ON channels(active);
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category_id);
CREATE INDEX IF NOT EXISTS idx_channels_source_account ON channels(source_account);
CREATE INDEX IF NOT EXISTS idx_channels_backfill_status ON channels(backfill_status);
CREATE INDEX IF NOT EXISTS idx_channels_last_message ON channels(last_message_at);

-- ===========================================================================
-- MEDIA FILES (content-addressed storage with SHA-256 deduplication)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS media_files (
    id SERIAL PRIMARY KEY,
    sha256 VARCHAR(64) UNIQUE NOT NULL,       -- Content-addressed storage key
    s3_key TEXT NOT NULL,                      -- media/0e/34/hash.jpg
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100) NOT NULL,

    -- Storage box location (for multi-box routing)
    storage_box_id VARCHAR(50) REFERENCES storage_boxes(id),

    -- Telegram source (for verification)
    telegram_file_id TEXT,
    telegram_url TEXT,

    -- Deduplication tracking
    reference_count INTEGER DEFAULT 1,
    first_seen TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),

    -- Sync status tracking (local buffer -> MinIO)
    synced_at TIMESTAMP WITHOUT TIME ZONE,    -- NULL = pending sync
    local_path TEXT,                           -- Path in local buffer (until synced)

    -- Cache warming / popularity tracking
    last_accessed_at TIMESTAMP WITHOUT TIME ZONE,
    access_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_media_files_sha256 ON media_files(sha256);
CREATE INDEX IF NOT EXISTS idx_media_files_mime ON media_files(mime_type);
CREATE INDEX IF NOT EXISTS idx_media_files_storage_box ON media_files(storage_box_id);
CREATE INDEX IF NOT EXISTS idx_media_files_synced ON media_files(synced_at) WHERE synced_at IS NULL;

-- ===========================================================================
-- MESSAGES (matches SQLAlchemy Message model)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS messages (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,

    -- Content
    content TEXT,
    telegram_date TIMESTAMP WITH TIME ZONE,

    -- Engagement
    views INTEGER,
    forwards INTEGER,

    -- Language/Translation
    language_detected VARCHAR(10),
    content_translated TEXT,
    translation_target VARCHAR(10),
    translation_provider VARCHAR(20),
    translation_timestamp TIMESTAMP WITH TIME ZONE,
    translation_cost_usd DECIMAL(10, 6),

    -- Media
    media_type VARCHAR(20),
    media_url_telegram TEXT,
    grouped_id BIGINT,

    -- Moderation
    is_hidden BOOLEAN DEFAULT FALSE,
    admin_notes TEXT,

    -- Topic classification (references message_topics.name)
    topic VARCHAR(50),

    -- Entity extraction (regex-based: hashtags, mentions, URLs)
    entities JSONB,

    -- Selective archival
    archive_triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    archive_triggered_at TIMESTAMP WITH TIME ZONE,
    archive_priority INTEGER,

    -- Backfill tracking
    is_backfilled BOOLEAN DEFAULT FALSE,
    media_was_available BOOLEAN,
    media_expired_at TIMESTAMP WITH TIME ZONE,

    -- Social graph
    author_user_id BIGINT,
    replied_to_message_id BIGINT,
    forward_from_channel_id BIGINT,
    forward_from_message_id BIGINT,
    forward_date TIMESTAMP WITH TIME ZONE,

    -- Comments
    has_comments BOOLEAN DEFAULT FALSE,
    comments_count INTEGER DEFAULT 0,
    linked_chat_id BIGINT,
    comments_fetched_at TIMESTAMP WITH TIME ZONE,
    comments_refreshed_at TIMESTAMP WITH TIME ZONE,

    -- Full-text search
    search_vector TSVECTOR,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Message authenticity
    content_hash VARCHAR(64),
    metadata_hash VARCHAR(64),
    hash_algorithm VARCHAR(20),
    hash_generated_at TIMESTAMP WITH TIME ZONE,
    hash_version INTEGER,

    CONSTRAINT uq_messages_channel_message UNIQUE (channel_id, message_id)
);

-- Essential indexes
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(telegram_date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_grouped ON messages(grouped_id) WHERE grouped_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_media ON messages(media_type) WHERE media_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_hidden ON messages(is_hidden);
CREATE INDEX IF NOT EXISTS idx_messages_backfilled ON messages(is_backfilled);
CREATE INDEX IF NOT EXISTS idx_messages_content_hash ON messages(content_hash);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author_user_id) WHERE author_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_forward ON messages(forward_from_channel_id) WHERE forward_from_channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_topic ON messages(topic) WHERE topic IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_views ON messages(views);
CREATE INDEX IF NOT EXISTS idx_messages_forwards ON messages(forwards);
-- Full-text search trigger
CREATE OR REPLACE FUNCTION update_messages_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('simple', COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.content_translated, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_messages_search_vector ON messages;
CREATE TRIGGER trigger_update_messages_search_vector
    BEFORE INSERT OR UPDATE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION update_messages_search_vector();

CREATE INDEX IF NOT EXISTS idx_messages_fts ON messages USING GIN(search_vector);

-- ===========================================================================
-- MESSAGE MEDIA JUNCTION TABLE
-- ===========================================================================
CREATE TABLE IF NOT EXISTS message_media (
    id SERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    media_file_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_media_message ON message_media(message_id);
CREATE INDEX IF NOT EXISTS idx_message_media_media ON message_media(media_file_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_message_media_unique ON message_media(message_id, media_file_id);

-- ===========================================================================
-- MESSAGE TAGS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS message_tags (
    id SERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    tag VARCHAR(100) NOT NULL,
    tag_type VARCHAR(50) DEFAULT 'keyword',
    confidence REAL DEFAULT 1.0,
    source VARCHAR(50) DEFAULT 'llm',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_tags_message ON message_tags(message_id);
CREATE INDEX IF NOT EXISTS idx_message_tags_tag ON message_tags(tag);
CREATE INDEX IF NOT EXISTS idx_message_tags_type ON message_tags(tag_type);

-- ===========================================================================
-- MESSAGE COMMENTS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS message_comments (
    id SERIAL PRIMARY KEY,
    parent_message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    comment_message_id BIGINT NOT NULL,
    discussion_chat_id BIGINT NOT NULL,

    -- Author info
    author_user_id BIGINT,
    author_username VARCHAR(100),
    author_first_name VARCHAR(100),

    -- Content
    content TEXT,
    content_translated TEXT,
    language_detected VARCHAR(10),

    -- Metadata
    reply_to_comment_id BIGINT,
    comment_date TIMESTAMP WITH TIME ZONE,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT uq_comment_message UNIQUE (discussion_chat_id, comment_message_id)
);

CREATE INDEX IF NOT EXISTS idx_comments_parent ON message_comments(parent_message_id);
CREATE INDEX IF NOT EXISTS idx_comments_author ON message_comments(author_user_id);
CREATE INDEX IF NOT EXISTS idx_comments_date ON message_comments(comment_date);

-- ===========================================================================
-- MESSAGE REACTIONS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS message_reactions (
    id BIGSERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,

    -- Reaction data
    emoji VARCHAR(100) NOT NULL,          -- Emoji string or "custom:doc_id"
    count INTEGER NOT NULL DEFAULT 0,
    custom_emoji_id BIGINT,               -- For custom emoji reactions

    -- Tracking
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint: one row per emoji per message (latest count)
    CONSTRAINT uq_message_reaction UNIQUE (message_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_reactions_emoji ON message_reactions(emoji);
CREATE INDEX IF NOT EXISTS idx_reactions_updated ON message_reactions(last_updated);

-- ===========================================================================
-- MESSAGE QUARANTINE (for content review)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS message_quarantine (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id BIGINT NOT NULL,
    content TEXT,
    media_type VARCHAR(50),
    telegram_date TIMESTAMP WITH TIME ZONE,

    -- Quarantine reason
    quarantine_reason VARCHAR(100),
    quarantine_details JSONB,
    confidence REAL,

    -- Review status
    review_status VARCHAR(20) DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    review_decision VARCHAR(20),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT uq_quarantine_channel_message UNIQUE (channel_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_quarantine_channel ON message_quarantine(channel_id);
CREATE INDEX IF NOT EXISTS idx_quarantine_status ON message_quarantine(review_status);

-- ===========================================================================
-- API KEYS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    scopes TEXT[],
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- ===========================================================================
-- FEED TOKENS (for RSS feed authentication)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS feed_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_feed_tokens_user ON feed_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_tokens_hash ON feed_tokens(token_hash);

-- ===========================================================================
-- FEED SUBSCRIPTIONS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS feed_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    feed_type VARCHAR(50) NOT NULL,
    filters JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_subscriptions_user ON feed_subscriptions(user_id);

-- ===========================================================================
-- CHANNEL SUBMISSIONS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS channel_submissions (
    id SERIAL PRIMARY KEY,
    submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    telegram_username VARCHAR(100),
    telegram_id BIGINT,
    reason TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON channel_submissions(status);

-- ===========================================================================
-- RSS FEEDS (for news ingestion)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS rss_feeds (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url VARCHAR(500) NOT NULL UNIQUE,
    category VARCHAR(100),
    language VARCHAR(10),
    is_active BOOLEAN DEFAULT TRUE,
    last_fetched_at TIMESTAMP WITH TIME ZONE,
    fetch_interval_minutes INTEGER DEFAULT 30,
    error_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rss_feeds_active ON rss_feeds(is_active);
CREATE INDEX IF NOT EXISTS idx_rss_feeds_category ON rss_feeds(category);

-- ===========================================================================
-- EXTERNAL NEWS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS external_news (
    id SERIAL PRIMARY KEY,
    feed_id INTEGER REFERENCES rss_feeds(id) ON DELETE SET NULL,

    url VARCHAR(1000) NOT NULL,
    title VARCHAR(500),
    content TEXT,
    content_translated TEXT,
    summary TEXT,

    author VARCHAR(255),
    published_at TIMESTAMP WITH TIME ZONE,

    language_detected VARCHAR(10),
    categories TEXT[],

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT uq_external_news_url UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS idx_external_news_feed ON external_news(feed_id);
CREATE INDEX IF NOT EXISTS idx_external_news_published ON external_news(published_at);

-- ===========================================================================
-- EXPORT JOBS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS export_jobs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    export_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    filters JSONB DEFAULT '{}',
    file_path VARCHAR(500),
    file_size_bytes BIGINT,
    row_count INTEGER,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_user ON export_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);

-- ===========================================================================
-- MONITORED FOLDERS (extends env-based folder discovery)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS monitored_folders (
    id SERIAL PRIMARY KEY,
    folder_name VARCHAR(100) NOT NULL UNIQUE,
    telegram_folder_id INTEGER,
    rule VARCHAR(50) NOT NULL DEFAULT 'archive_all',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_via VARCHAR(20) NOT NULL DEFAULT 'import',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitored_folders_active
    ON monitored_folders(active) WHERE active = TRUE;

-- ===========================================================================
-- IMPORT JOBS (batch channel import tracking)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'uploading',
    total_channels INTEGER NOT NULL DEFAULT 0,
    validated_channels INTEGER NOT NULL DEFAULT 0,
    joined_channels INTEGER NOT NULL DEFAULT 0,
    failed_channels INTEGER NOT NULL DEFAULT 0,
    skipped_channels INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by_ip INET,
    user_agent VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at DESC);

-- ===========================================================================
-- IMPORT JOB CHANNELS (individual channels within import)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS import_job_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    channel_url VARCHAR(255) NOT NULL,
    channel_username VARCHAR(100),
    channel_name VARCHAR(255),
    target_folder VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    validation_data JSONB,
    error_message TEXT,
    error_code VARCHAR(50),
    selected BOOLEAN NOT NULL DEFAULT TRUE,
    queued_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_job_channels_job_id
    ON import_job_channels(import_job_id);
CREATE INDEX IF NOT EXISTS idx_import_job_channels_status
    ON import_job_channels(status);
CREATE INDEX IF NOT EXISTS idx_import_job_channels_folder
    ON import_job_channels(target_folder);

-- ===========================================================================
-- IMPORT JOB LOGS (event timeline)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS import_job_logs (
    id BIGSERIAL PRIMARY KEY,
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES import_job_channels(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL,
    event_code VARCHAR(50),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_job_logs_job_id
    ON import_job_logs(import_job_id);
CREATE INDEX IF NOT EXISTS idx_import_job_logs_created_at
    ON import_job_logs(created_at DESC);

-- ===========================================================================
-- PLATFORM CONFIG (runtime configuration storage)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS platform_config (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL,
    key VARCHAR(100) NOT NULL UNIQUE,
    value TEXT,
    description TEXT,
    data_type VARCHAR(20) NOT NULL DEFAULT 'string',
    is_secret BOOLEAN DEFAULT FALSE,
    restart_required BOOLEAN DEFAULT FALSE,
    last_modified_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_platform_config_category ON platform_config(category);
CREATE INDEX IF NOT EXISTS idx_platform_config_key ON platform_config(key);

-- Seed platform config with tg-archiver defaults
INSERT INTO platform_config (category, key, value, description, data_type, is_secret, restart_required)
VALUES
    -- Telegram settings
    ('telegram', 'telegram.session_name', 'default', 'Primary Telegram session name', 'string', false, true),
    ('telegram', 'telegram.folder_sync_interval', '300', 'Folder sync interval in seconds', 'integer', false, false),
    ('telegram', 'telegram.message_batch_size', '100', 'Messages to fetch per batch', 'integer', false, false),

    -- Storage settings
    ('storage', 'storage.media_enabled', 'true', 'Enable media archiving', 'boolean', false, false),
    ('storage', 'storage.max_file_size_mb', '100', 'Maximum file size to archive (MB)', 'integer', false, false),
    ('storage', 'storage.dedup_enabled', 'true', 'Enable SHA-256 deduplication', 'boolean', false, false),

    -- Processing settings
    ('processing', 'processing.translation_enabled', 'true', 'Enable automatic translation', 'boolean', false, false),
    ('processing', 'processing.translation_target', 'en', 'Target language for translation', 'string', false, false),

    -- Feed settings
    ('feed', 'feed.default_limit', '50', 'Default items per feed', 'integer', false, false),
    ('feed', 'feed.max_limit', '200', 'Maximum items per feed request', 'integer', false, false),
    ('feed', 'feed.cache_ttl', '300', 'Feed cache TTL in seconds', 'integer', false, false),

    -- API settings
    ('api', 'api.rate_limit_requests', '100', 'Rate limit requests per minute', 'integer', false, false),
    ('api', 'api.cors_allow_all', 'false', 'Allow all CORS origins (dev only)', 'boolean', false, true)
ON CONFLICT (key) DO NOTHING;

-- ===========================================================================
-- TAG STATS (aggregate tag statistics)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS tag_stats (
    id SERIAL PRIMARY KEY,
    tag VARCHAR(100) NOT NULL,
    tag_type VARCHAR(50) DEFAULT 'keyword',
    message_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT uq_tag_stats UNIQUE (tag, tag_type)
);

CREATE INDEX IF NOT EXISTS idx_tag_stats_tag ON tag_stats(tag);
CREATE INDEX IF NOT EXISTS idx_tag_stats_count ON tag_stats(message_count DESC);

-- ===========================================================================
-- ADMIN ACTIONS (audit log for moderation actions)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS admin_actions (
    id BIGSERIAL PRIMARY KEY,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL DEFAULT 'message',
    resource_id BIGINT NOT NULL,
    details JSONB DEFAULT '{}',
    admin_id VARCHAR(255),
    admin_email VARCHAR(255),
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_action ON admin_actions(action);
CREATE INDEX IF NOT EXISTS idx_admin_actions_resource ON admin_actions(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_date ON admin_actions(created_at DESC);

-- ===========================================================================
-- EXTRACTION PATTERNS (Configurable entity extraction)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS extraction_patterns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    entity_type VARCHAR(50) NOT NULL,  -- 'hashtag', 'mention', 'url', 'coordinate', 'custom'
    pattern TEXT NOT NULL,              -- regex pattern
    pattern_type VARCHAR(20) NOT NULL DEFAULT 'regex',  -- 'regex', 'keyword_list'
    case_sensitive BOOLEAN DEFAULT false,
    enabled BOOLEAN DEFAULT true,
    description TEXT,
    color VARCHAR(20) DEFAULT 'gray',   -- for UI display
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extraction_patterns_enabled ON extraction_patterns(enabled);
CREATE INDEX IF NOT EXISTS idx_extraction_patterns_type ON extraction_patterns(entity_type);

-- Seed default patterns (generic patterns for any Telegram archive)
INSERT INTO extraction_patterns (name, entity_type, pattern, description, sort_order) VALUES
    ('Hashtags', 'hashtag', '#[a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9_]+', 'Extract hashtags', 1),
    ('Mentions', 'mention', '@[a-zA-Z0-9_]{5,32}', 'Extract @username mentions', 2),
    ('URLs', 'url', 'https?://[^\s]+', 'Extract HTTP/HTTPS URLs', 3),
    ('Telegram Links', 'telegram_link', 't\.me/[a-zA-Z0-9_/]+', 'Extract t.me links', 4),
    ('Coordinates', 'coordinate', '(-?\d+\.\d+)[°\s]*([NS]),?\s*(-?\d+\.\d+)[°\s]*([EW])', 'Extract GPS coordinates', 5)
ON CONFLICT (name) DO NOTHING;

-- ===========================================================================
-- SUMMARY
-- ===========================================================================
-- Core archiving:
--   channels          - Channel metadata and folder-based management
--   messages          - Message storage with full-text search
--   media_files       - SHA-256 content-addressed media storage
--   message_media     - Junction table for message-to-media links
--   message_tags      - Generated tags
--   message_comments  - Discussion group comments
--
-- Classification:
--   channel_categories - Admin-configurable channel categories
--   message_topics     - Admin-configurable message topics
--   extraction_patterns - Configurable regex entity extraction
--
-- Content review:
--   message_quarantine - Messages held for review
--
-- User management:
--   users, api_keys, feed_tokens, feed_subscriptions
--   channel_submissions
--
-- RSS/News:
--   rss_feeds, external_news
--
-- Channel import:
--   monitored_folders  - Folder-based archiving rules
--   import_jobs        - Batch channel import tracking
--   import_job_channels - Individual channels within import
--   import_job_logs    - Import event timeline
--
-- Utilities:
--   export_jobs, tag_stats, platform_config
--   admin_actions, schema_migrations
