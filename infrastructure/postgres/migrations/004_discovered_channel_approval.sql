-- Admin approval for joining discovered channels
-- Run: psql -U archiver -d tg_archiver -f 004_discovered_channel_approval.sql
--
-- Dedicated columns (rather than admin_action='approved') so approval is
-- orthogonal to promote/ignore: admin_action keeps its meaning, an approved
-- row can still be promoted or ignored afterwards, and unapprove is just
-- clearing the timestamp. Existing rows start unapproved (CHANNEL_JOIN_MODE=approval
-- is the default); idempotent.

BEGIN;

INSERT INTO schema_migrations (version, description, checksum)
VALUES ('004', 'Discovered channel join approval', NULL)
ON CONFLICT (version) DO NOTHING;

ALTER TABLE discovered_channels
    ADD COLUMN IF NOT EXISTS join_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS join_approved_by INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_discovered_channels_approved
    ON discovered_channels(join_status, join_retry_after)
    WHERE join_approved_at IS NOT NULL;

COMMIT;
