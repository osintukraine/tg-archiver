-- Discovered Channels for Social Graph Fetching
-- Run: psql -U archiver -d tg_archiver -f 003_discovered_channels.sql
--
-- Enables tracking of channels discovered via forwards and fetching
-- social context (reactions, comments) from original messages.

BEGIN;

-- Track migration
INSERT INTO schema_migrations (version, description, checksum)
VALUES ('003', 'Discovered channels for social graph', NULL)
ON CONFLICT (version) DO NOTHING;

-- ===========================================================================
-- DISCOVERED CHANNELS
-- ===========================================================================
-- Channels discovered via message forwards. These are auto-joined for social
-- data fetching but NOT archived. Admin can promote to full archiving.

CREATE TABLE IF NOT EXISTS discovered_channels (
    id SERIAL PRIMARY KEY,

    -- Telegram identifiers
    telegram_id BIGINT NOT NULL UNIQUE,
    username VARCHAR(100),
    access_hash BIGINT,

    -- Channel metadata (fetched when joining)
    name VARCHAR(255),
    description TEXT,
    participant_count INTEGER,
    photo_id BIGINT,

    -- Channel flags (from Telegram API)
    verified BOOLEAN DEFAULT FALSE,
    scam BOOLEAN DEFAULT FALSE,
    fake BOOLEAN DEFAULT FALSE,
    restricted BOOLEAN DEFAULT FALSE,
    is_private BOOLEAN DEFAULT FALSE,
    has_link BOOLEAN DEFAULT FALSE,               -- Has linked discussion group

    -- Discovery tracking
    discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    discovered_via_message_id BIGINT,             -- First message that led to discovery
    discovery_count INTEGER DEFAULT 1,            -- How many forwards we've seen
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Join status
    -- pending: discovered, not yet attempted to join
    -- joining: join in progress
    -- joined: successfully joined
    -- private: channel is private, can't join without invite
    -- failed: join failed (banned, geo-restricted, etc.)
    -- ignored: admin marked as ignored, don't retry
    join_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    join_attempted_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,
    join_error TEXT,
    join_retry_count INTEGER DEFAULT 0,
    join_retry_after TIMESTAMPTZ,

    -- Social fetching
    social_fetch_enabled BOOLEAN DEFAULT TRUE,
    social_fetch_last_at TIMESTAMPTZ,
    social_messages_fetched INTEGER DEFAULT 0,

    -- Admin actions
    admin_action VARCHAR(20),                     -- 'promoted', 'ignored', NULL
    admin_action_at TIMESTAMPTZ,
    admin_action_by INTEGER REFERENCES users(id),
    promoted_to_channel_id INTEGER REFERENCES channels(id),

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discovered_channels_telegram_id
    ON discovered_channels(telegram_id);
CREATE INDEX IF NOT EXISTS idx_discovered_channels_username
    ON discovered_channels(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_discovered_channels_join_status
    ON discovered_channels(join_status);
CREATE INDEX IF NOT EXISTS idx_discovered_channels_pending
    ON discovered_channels(join_status, join_retry_after)
    WHERE join_status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_discovered_channels_discovery_count
    ON discovered_channels(discovery_count DESC);
CREATE INDEX IF NOT EXISTS idx_discovered_channels_last_seen
    ON discovered_channels(last_seen_at DESC);

-- ===========================================================================
-- MESSAGE FORWARDS (Forward Chain Tracking)
-- ===========================================================================
-- Links our archived messages to their original source messages.
-- Enables fetching and caching social data from the original.

CREATE TABLE IF NOT EXISTS message_forwards (
    id BIGSERIAL PRIMARY KEY,

    -- The message in our archive (the forwarded copy)
    local_message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,

    -- The original message (in the source channel)
    original_channel_id BIGINT NOT NULL,          -- telegram_id of source channel
    original_message_id BIGINT NOT NULL,          -- message_id in source channel

    -- Reference to discovered channel (if we're tracking it)
    discovered_channel_id INTEGER REFERENCES discovered_channels(id) ON DELETE SET NULL,

    -- Propagation timing
    original_date TIMESTAMPTZ,                    -- When original was posted
    forward_date TIMESTAMPTZ,                     -- When our copy was posted
    propagation_seconds INTEGER,                  -- Time delta

    -- Cached engagement from original
    original_views INTEGER,
    original_forwards INTEGER,
    original_reactions_count INTEGER,
    original_comments_count INTEGER,
    social_data_fetched_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_forward_link UNIQUE (local_message_id)
);

CREATE INDEX IF NOT EXISTS idx_forwards_local
    ON message_forwards(local_message_id);
CREATE INDEX IF NOT EXISTS idx_forwards_original
    ON message_forwards(original_channel_id, original_message_id);
CREATE INDEX IF NOT EXISTS idx_forwards_discovered
    ON message_forwards(discovered_channel_id)
    WHERE discovered_channel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_forwards_pending_social
    ON message_forwards(created_at DESC)
    WHERE social_data_fetched_at IS NULL;

-- ===========================================================================
-- ORIGINAL MESSAGES (Cached Original Message Content)
-- ===========================================================================
-- Stores the original message content as a leaf node in the social graph.
-- This is NOT a full archive - just the content for graph context.

CREATE TABLE IF NOT EXISTS original_messages (
    id BIGSERIAL PRIMARY KEY,

    message_forward_id BIGINT NOT NULL UNIQUE REFERENCES message_forwards(id) ON DELETE CASCADE,

    -- Original message content
    content TEXT,
    content_translated TEXT,
    language_detected VARCHAR(10),

    -- Media summary (not the actual files)
    has_media BOOLEAN DEFAULT FALSE,
    media_type VARCHAR(50),                       -- 'photo', 'video', 'document', etc.
    media_count INTEGER DEFAULT 0,

    -- Author info
    author_user_id BIGINT,
    author_username VARCHAR(100),

    -- Message metadata
    original_date TIMESTAMPTZ,
    edit_date TIMESTAMPTZ,
    is_pinned BOOLEAN DEFAULT FALSE,

    -- Engagement at fetch time
    views INTEGER,
    forwards INTEGER,
    has_comments BOOLEAN DEFAULT FALSE,
    comments_count INTEGER DEFAULT 0,

    -- Fetch tracking
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_original_messages_forward
    ON original_messages(message_forward_id);

-- ===========================================================================
-- FORWARD REACTIONS (Reactions on Original Messages)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS forward_reactions (
    id BIGSERIAL PRIMARY KEY,

    message_forward_id BIGINT NOT NULL REFERENCES message_forwards(id) ON DELETE CASCADE,

    emoji VARCHAR(100) NOT NULL,
    count INTEGER NOT NULL,
    custom_emoji_id BIGINT,

    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_forward_reaction UNIQUE (message_forward_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_forward_reactions_forward
    ON forward_reactions(message_forward_id);

-- ===========================================================================
-- FORWARD COMMENTS (Comments on Original Messages)
-- ===========================================================================

CREATE TABLE IF NOT EXISTS forward_comments (
    id BIGSERIAL PRIMARY KEY,

    message_forward_id BIGINT NOT NULL REFERENCES message_forwards(id) ON DELETE CASCADE,

    comment_id BIGINT NOT NULL,                   -- Comment message ID in discussion
    discussion_chat_id BIGINT,                    -- Discussion group ID

    author_user_id BIGINT,
    author_username VARCHAR(100),
    author_first_name VARCHAR(100),

    content TEXT,
    content_translated TEXT,
    language_detected VARCHAR(10),

    reply_to_comment_id BIGINT,                   -- Thread support
    comment_date TIMESTAMPTZ,

    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_forward_comment UNIQUE (message_forward_id, comment_id)
);

CREATE INDEX IF NOT EXISTS idx_forward_comments_forward
    ON forward_comments(message_forward_id);
CREATE INDEX IF NOT EXISTS idx_forward_comments_date
    ON forward_comments(comment_date);

-- ===========================================================================
-- VIEW: Discovered Channels with Stats
-- ===========================================================================
-- Convenient view for admin UI showing discovery stats

CREATE OR REPLACE VIEW discovered_channels_stats AS
SELECT
    dc.*,
    COUNT(DISTINCT mf.id) as forward_count,
    MAX(mf.created_at) as last_forward_at,
    COUNT(DISTINCT CASE WHEN mf.social_data_fetched_at IS NOT NULL THEN mf.id END) as fetched_count
FROM discovered_channels dc
LEFT JOIN message_forwards mf ON mf.discovered_channel_id = dc.id
GROUP BY dc.id;

COMMIT;
