-- Durable translation queue state on messages
-- Run: psql -U archiver -d tg_archiver -f 007_translation_queue.sql
--
-- The processor persists messages immediately and a background worker translates
-- them later. translation_status: NULL (legacy / translation off), 'pending',
-- 'done', 'skipped' (not a translated language, or stale), 'failed' (attempts
-- exhausted; see translation_last_error). Idempotent.

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS translation_status VARCHAR(10),
    ADD COLUMN IF NOT EXISTS translation_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS translation_next_attempt_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS translation_last_error TEXT;

-- The worker's query: newest pending messages that are due
CREATE INDEX IF NOT EXISTS idx_messages_translation_pending
    ON messages (telegram_date DESC)
    WHERE translation_status = 'pending';
