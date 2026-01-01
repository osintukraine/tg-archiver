-- tg-archiver Database Schema
-- PostgreSQL 16+ initialization script
-- Simplified schema for Telegram archiving (no AI/ML tables)

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
-- TELEGRAM CHANNELS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS telegram_channels (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT NOT NULL UNIQUE,

    -- Basic info
    name VARCHAR(255) NOT NULL,
    username VARCHAR(64),
    description TEXT,

    -- Folder-based management
    folder VARCHAR(100),
    rule VARCHAR(50) DEFAULT 'archive_all',  -- archive_all, selective_archive

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    participant_count INTEGER,

    -- Telegram account that monitors this channel
    source_account VARCHAR(100),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE,

    -- Full-text search
    content_tsvector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', COALESCE(name, '') || ' ' || COALESCE(username, '') || ' ' || COALESCE(description, ''))
    ) STORED
);

CREATE INDEX idx_channels_telegram_id ON telegram_channels(telegram_id);
CREATE INDEX idx_channels_username ON telegram_channels(username);
CREATE INDEX idx_channels_folder ON telegram_channels(folder);
CREATE INDEX idx_channels_rule ON telegram_channels(rule);
CREATE INDEX idx_channels_active ON telegram_channels(is_active);
CREATE INDEX idx_channels_fts ON telegram_channels USING GIN(content_tsvector);

-- ===========================================================================
-- MEDIA FILES (content-addressed storage)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS media_files (
    id SERIAL PRIMARY KEY,

    -- Content addressing (SHA-256)
    file_hash VARCHAR(64) NOT NULL UNIQUE,

    -- Storage info
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100),

    -- Metadata
    width INTEGER,
    height INTEGER,
    duration_seconds INTEGER,

    -- Telegram metadata
    telegram_file_id VARCHAR(255),
    telegram_unique_id VARCHAR(255),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_media_files_hash ON media_files(file_hash);
CREATE INDEX idx_media_files_mime ON media_files(mime_type);
CREATE INDEX idx_media_files_created ON media_files(created_at);

-- ===========================================================================
-- TELEGRAM MESSAGES
-- ===========================================================================
CREATE TABLE IF NOT EXISTS telegram_messages (
    id SERIAL PRIMARY KEY,

    -- Telegram identifiers
    message_id BIGINT NOT NULL,
    channel_id INTEGER NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,
    grouped_id BIGINT,  -- Album grouping

    -- Content
    content TEXT,
    content_translated TEXT,

    -- Media reference
    media_type VARCHAR(50),  -- photo, video, document, audio, webpage, etc.
    media_url_telegram VARCHAR(500),  -- Original Telegram URL (expires)

    -- Engagement metrics
    views INTEGER DEFAULT 0,
    forwards INTEGER DEFAULT 0,

    -- Translation metadata
    language_detected VARCHAR(10),
    translation_target VARCHAR(10),
    translation_provider VARCHAR(50),
    translation_cost_usd DECIMAL(10, 6),
    translation_timestamp TIMESTAMP WITH TIME ZONE,

    -- Social graph - Author
    author_user_id BIGINT,

    -- Social graph - Reply tracking
    replied_to_message_id BIGINT,

    -- Social graph - Forward tracking
    forward_from_channel_id BIGINT,
    forward_from_message_id BIGINT,
    forward_date TIMESTAMP WITH TIME ZONE,

    -- Comments/Discussion
    has_comments BOOLEAN DEFAULT FALSE,
    comments_count INTEGER DEFAULT 0,
    linked_chat_id BIGINT,

    -- Extracted entities (regex-based)
    entities JSONB,

    -- Message authenticity hashing
    content_hash VARCHAR(64),
    metadata_hash VARCHAR(64),
    hash_algorithm VARCHAR(20) DEFAULT 'sha256',
    hash_generated_at TIMESTAMP WITH TIME ZONE,
    hash_version INTEGER DEFAULT 1,

    -- Processing flags (simplified - no AI)
    is_spam BOOLEAN DEFAULT FALSE,
    is_backfilled BOOLEAN DEFAULT FALSE,

    -- Timestamps
    telegram_date TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Full-text search
    content_tsvector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple', COALESCE(content, '') || ' ' || COALESCE(content_translated, ''))
    ) STORED,

    -- Unique constraint
    CONSTRAINT unique_channel_message UNIQUE (channel_id, message_id)
);

-- Essential indexes
CREATE INDEX idx_messages_channel ON telegram_messages(channel_id);
CREATE INDEX idx_messages_date ON telegram_messages(telegram_date DESC);
CREATE INDEX idx_messages_grouped ON telegram_messages(grouped_id) WHERE grouped_id IS NOT NULL;
CREATE INDEX idx_messages_fts ON telegram_messages USING GIN(content_tsvector);
CREATE INDEX idx_messages_media ON telegram_messages(media_type) WHERE media_type IS NOT NULL;
CREATE INDEX idx_messages_author ON telegram_messages(author_user_id) WHERE author_user_id IS NOT NULL;
CREATE INDEX idx_messages_forward ON telegram_messages(forward_from_channel_id) WHERE forward_from_channel_id IS NOT NULL;
CREATE INDEX idx_messages_reply ON telegram_messages(replied_to_message_id) WHERE replied_to_message_id IS NOT NULL;

-- ===========================================================================
-- MESSAGE MEDIA JUNCTION TABLE
-- ===========================================================================
CREATE TABLE IF NOT EXISTS message_media (
    id SERIAL PRIMARY KEY,
    message_id INTEGER NOT NULL REFERENCES telegram_messages(id) ON DELETE CASCADE,
    media_id INTEGER NOT NULL REFERENCES media_files(id) ON DELETE CASCADE,
    position INTEGER DEFAULT 0,  -- Position in album
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_message_media UNIQUE (message_id, media_id)
);

CREATE INDEX idx_message_media_message ON message_media(message_id);
CREATE INDEX idx_message_media_media ON message_media(media_id);

-- ===========================================================================
-- CHANNEL AUTHORS (social graph - author attribution)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS channel_authors (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    channel_id INTEGER NOT NULL REFERENCES telegram_channels(id) ON DELETE CASCADE,

    -- User info
    username VARCHAR(64),
    first_name VARCHAR(100),
    last_name VARCHAR(100),

    -- Statistics
    message_count INTEGER DEFAULT 0,
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_channel_author UNIQUE (channel_id, user_id)
);

CREATE INDEX idx_channel_authors_user ON channel_authors(user_id);
CREATE INDEX idx_channel_authors_channel ON channel_authors(channel_id);

-- ===========================================================================
-- MESSAGE FORWARDS (social graph - forward chain tracking)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS message_forwards (
    id SERIAL PRIMARY KEY,

    -- Source (our archived message)
    message_id INTEGER NOT NULL REFERENCES telegram_messages(id) ON DELETE CASCADE,

    -- Forward origin
    forward_from_channel_id BIGINT NOT NULL,
    forward_from_message_id BIGINT,
    forward_date TIMESTAMP WITH TIME ZONE,

    -- Origin channel info (if known)
    forward_channel_name VARCHAR(255),
    forward_channel_username VARCHAR(64),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_forwards_message ON message_forwards(message_id);
CREATE INDEX idx_forwards_origin ON message_forwards(forward_from_channel_id, forward_from_message_id);

-- ===========================================================================
-- MESSAGE REPLIES (social graph - reply thread structure)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS message_replies (
    id SERIAL PRIMARY KEY,

    -- The reply message
    message_id INTEGER NOT NULL REFERENCES telegram_messages(id) ON DELETE CASCADE,

    -- The message being replied to
    replied_to_message_id BIGINT NOT NULL,
    replied_to_channel_id BIGINT,  -- If cross-channel reply

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_replies_message ON message_replies(message_id);
CREATE INDEX idx_replies_parent ON message_replies(replied_to_message_id);

-- ===========================================================================
-- CHANNEL DISCOVERY EVENTS (folder sync tracking)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS channel_discovery_events (
    id SERIAL PRIMARY KEY,
    channel_id INTEGER REFERENCES telegram_channels(id) ON DELETE SET NULL,
    telegram_channel_id BIGINT NOT NULL,

    -- Event info
    event_type VARCHAR(50) NOT NULL,  -- discovered, joined, rule_changed, removed
    folder_name VARCHAR(100),
    new_rule VARCHAR(50),
    previous_rule VARCHAR(50),

    -- Metadata
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_discovery_events_channel ON channel_discovery_events(channel_id);
CREATE INDEX idx_discovery_events_type ON channel_discovery_events(event_type);
CREATE INDEX idx_discovery_events_date ON channel_discovery_events(created_at);

-- ===========================================================================
-- USERS TABLE (basic auth)
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

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);

-- ===========================================================================
-- USER BOOKMARKS
-- ===========================================================================
CREATE TABLE IF NOT EXISTS user_bookmarks (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id INTEGER NOT NULL REFERENCES telegram_messages(id) ON DELETE CASCADE,

    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT unique_user_bookmark UNIQUE (user_id, message_id)
);

CREATE INDEX idx_bookmarks_user ON user_bookmarks(user_id);
CREATE INDEX idx_bookmarks_message ON user_bookmarks(message_id);

-- ===========================================================================
-- SUMMARY: Tables in this schema
-- ===========================================================================
-- Core archiving:
--   telegram_channels     - Channel metadata and folder-based management
--   telegram_messages     - Message storage with full-text search
--   media_files           - SHA-256 content-addressed media storage
--   message_media         - Junction table for message-to-media links
--
-- Social graph:
--   channel_authors       - Author attribution per channel
--   message_forwards      - Forward chain tracking
--   message_replies       - Reply thread structure
--
-- Management:
--   channel_discovery_events - Folder sync history
--   users                    - Basic authentication
--   user_bookmarks           - User bookmark feature
--   schema_migrations        - Migration tracking
--
-- REMOVED from full platform (AI-dependent):
--   message_embeddings, telegram_event_clusters, llm_prompts,
--   llm_decisions, ai_tags, entity_*, opensanctions_*, etc.
