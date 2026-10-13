-- Channel suggestions submitted via /suggest-channel (POST /api/channel-submissions)
-- Run: psql -U archiver -d tg_archiver -f 006_channel_submissions.sql
--
-- init.sql created a minimal channel_submissions table that nothing used.
-- Add the columns the public form needs; idempotent.

BEGIN;

INSERT INTO schema_migrations (version, description, checksum)
VALUES ('006', 'Channel submission form columns', NULL)
ON CONFLICT (version) DO NOTHING;

ALTER TABLE channel_submissions
    ADD COLUMN IF NOT EXISTS channel_link VARCHAR(255),
    ADD COLUMN IF NOT EXISTS channel_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS value_description TEXT,
    ADD COLUMN IF NOT EXISTS source_origin VARCHAR(20) DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS submitted_by_ip INET,
    ADD COLUMN IF NOT EXISTS assigned_folder VARCHAR(100),
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

COMMIT;
