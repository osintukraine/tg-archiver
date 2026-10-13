-- Schema drift fixes: align the database with the ORM models / raw SQL the
-- services actually run. Idempotent and re-runnable. Applied by db-migrate.
--
-- 1. export_jobs      - rebuilt to match shared/python/models/export_job.py
-- 2. external_news    - widen columns to the model's types (bigint / text)
-- 3. message_comments - translation columns used by routers/comments.py
-- 4. telegram_users   - table written by listener/social_graph_utils.py
-- 5. channel_interactions, channel_influence_network, top_forwarded_messages
--    - views read by routers/social_graph.py

-- ---------------------------------------------------------------------------
-- 1. export_jobs
-- ---------------------------------------------------------------------------
-- The init.sql table (SERIAL id, file_path, row_count) was never usable: the
-- ORM model needs a UUID id and a different column set, and nothing else
-- reads the old columns. Rebuild it only while it still has the old shape
-- (id is not uuid); a table already in the new shape (and its rows) is kept.
-- If an old-shape table somehow holds rows, stop instead of dropping data.
DO $$
DECLARE
    old_rows BIGINT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'export_jobs'
          AND column_name = 'id' AND data_type <> 'uuid'
    ) THEN
        SELECT count(*) INTO old_rows FROM export_jobs;
        IF old_rows > 0 THEN
            RAISE EXCEPTION 'export_jobs has % row(s) in the legacy format; back them up, '
                'drop the table (DROP TABLE export_jobs), then restart to re-run migrations', old_rows;
        END IF;
        DROP TABLE export_jobs;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS export_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    label VARCHAR(255),
    export_type VARCHAR(50) NOT NULL,
    format VARCHAR(20) NOT NULL DEFAULT 'json',
    profile VARCHAR(20) NOT NULL DEFAULT 'standard',
    filters JSONB NOT NULL DEFAULT '{}',
    columns JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    total_rows INTEGER,
    processed_rows INTEGER NOT NULL DEFAULT 0,
    progress_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
    s3_key VARCHAR(500),
    file_size_bytes BIGINT,
    file_checksum VARCHAR(64),
    download_token UUID UNIQUE DEFAULT gen_random_uuid(),
    download_token_expires_at TIMESTAMPTZ,
    download_count INTEGER NOT NULL DEFAULT 0,
    max_downloads INTEGER NOT NULL DEFAULT 10,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    error_message TEXT,
    error_details JSONB,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_by_ip INET,
    user_agent VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_user ON export_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status);

-- ---------------------------------------------------------------------------
-- 2. external_news (model: BigInteger id, Text url/title/author/language)
-- ---------------------------------------------------------------------------
ALTER TABLE external_news
    ALTER COLUMN id TYPE BIGINT,
    ALTER COLUMN url TYPE TEXT,
    ALTER COLUMN title TYPE TEXT,
    ALTER COLUMN author TYPE TEXT,
    ALTER COLUMN language_detected TYPE TEXT;

-- ---------------------------------------------------------------------------
-- 3. message_comments translation columns (routers/comments.py)
-- ---------------------------------------------------------------------------
ALTER TABLE message_comments
    ADD COLUMN IF NOT EXISTS translation_method VARCHAR(50),
    ADD COLUMN IF NOT EXISTS translation_confidence REAL,
    ADD COLUMN IF NOT EXISTS translated_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 4. telegram_users (listener upsert_telegram_user)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telegram_users (
    telegram_id BIGINT PRIMARY KEY,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    username VARCHAR(100),
    phone VARCHAR(50),
    is_bot BOOLEAN NOT NULL DEFAULT FALSE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    is_scam BOOLEAN NOT NULL DEFAULT FALSE,
    is_fake BOOLEAN NOT NULL DEFAULT FALSE,
    is_premium BOOLEAN NOT NULL DEFAULT FALSE,
    has_photo BOOLEAN NOT NULL DEFAULT FALSE,
    has_username BOOLEAN NOT NULL DEFAULT FALSE,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    interaction_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telegram_users_username
    ON telegram_users(username) WHERE username IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Forward-graph views
-- ---------------------------------------------------------------------------
-- Plain views, not materialized: nothing in the stack refreshes a materialized
-- view, so it would stay empty/stale forever. A view is always current; the
-- partial index below keeps the self-join cheap. If the archive grows large
-- enough that these are slow, convert to MATERIALIZED VIEW + a periodic
-- REFRESH ... CONCURRENTLY (needs a unique index per view).
--
-- messages.forward_from_channel_id holds the raw Telegram id while
-- channels.telegram_id stores the marked form (-100<raw>); match both.
-- messages.forward_date is when the ORIGINAL was posted, messages.telegram_date
-- when our forwarded copy was, so their difference is the propagation delay.

CREATE INDEX IF NOT EXISTS idx_messages_forward_origin
    ON messages(forward_from_channel_id, forward_from_message_id)
    WHERE forward_from_channel_id IS NOT NULL;

-- Channel -> channel forward counts (source = where it was forwarded from).
CREATE OR REPLACE VIEW channel_interactions AS
SELECT
    src.id AS source_channel_id,
    f.channel_id AS target_channel_id,
    COUNT(*) AS forward_count,
    AVG(EXTRACT(EPOCH FROM (f.telegram_date - f.forward_date)))
        FILTER (WHERE f.telegram_date >= f.forward_date) AS avg_propagation_seconds,
    MIN(f.telegram_date) AS first_forward_at,
    MAX(f.telegram_date) AS last_forward_at
FROM messages f
JOIN channels src
  ON src.telegram_id IN (f.forward_from_channel_id,
                         -(1000000000000 + f.forward_from_channel_id))
WHERE f.forward_from_channel_id IS NOT NULL
  AND src.id <> f.channel_id
GROUP BY src.id, f.channel_id;

-- Same pairs with channel names and an influence score: the pair's share of
-- everything the target channel forwarded (0..1; higher = the target leans
-- more on that source).
CREATE OR REPLACE VIEW channel_influence_network AS
SELECT
    ci.source_channel_id,
    sc.name AS source_channel_name,
    sc.username AS source_channel_username,
    ci.target_channel_id,
    tc.name AS target_channel_name,
    tc.username AS target_channel_username,
    ci.forward_count,
    ci.avg_propagation_seconds,
    ROUND(ci.forward_count::numeric
          / SUM(ci.forward_count) OVER (PARTITION BY ci.target_channel_id), 4)
        AS influence_score
FROM channel_interactions ci
JOIN channels sc ON sc.id = ci.source_channel_id
JOIN channels tc ON tc.id = ci.target_channel_id;

-- Archived messages that other archived channels forwarded, ranked by the
-- API on forward_count within a time window on last_forward_date.
CREATE OR REPLACE VIEW top_forwarded_messages AS
SELECT
    m.id AS message_id,
    m.message_id AS telegram_message_id,
    c.id AS channel_id,
    c.name AS channel_name,
    c.username AS channel_username,
    LEFT(m.content, 200) AS content_preview,
    m.telegram_date,
    COUNT(f.id) AS forward_count,
    MIN(EXTRACT(EPOCH FROM (f.telegram_date - m.telegram_date)))::bigint
        AS fastest_propagation_seconds,
    AVG(EXTRACT(EPOCH FROM (f.telegram_date - m.telegram_date)))
        AS avg_propagation_seconds,
    MAX(f.telegram_date) AS last_forward_date,
    m.views
FROM messages m
JOIN channels c ON c.id = m.channel_id
JOIN messages f
  ON f.forward_from_message_id = m.message_id
 AND f.forward_from_channel_id IN (c.telegram_id, -c.telegram_id - 1000000000000)
 AND f.channel_id <> m.channel_id
GROUP BY m.id, c.id;
