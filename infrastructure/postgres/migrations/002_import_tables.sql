-- Channel Import Feature Tables
-- Run: psql -U archiver -d tg_archiver -f 002_import_tables.sql

BEGIN;

-- Track migration
INSERT INTO schema_migrations (version, description, checksum)
VALUES ('002', 'Channel import feature tables', NULL)
ON CONFLICT (version) DO NOTHING;

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
-- ADD SOURCE COLUMN TO CHANNELS (track import vs discovery)
-- ===========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'channels' AND column_name = 'source'
    ) THEN
        ALTER TABLE channels ADD COLUMN source VARCHAR(20) DEFAULT 'folder_discovery';
        COMMENT ON COLUMN channels.source IS 'Origin: folder_discovery, import, manual';
    END IF;
END $$;

COMMIT;
