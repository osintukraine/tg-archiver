-- Drop the tags subsystem (message_tags, tag_stats).
--
-- tg-archiver has no AI tagging (the fork removed it) and nothing ever wrote to
-- these tables: no producer in code, no trigger populated tag_stats. The non-AI
-- data they were meant to hold (hashtags/mentions) already lives in
-- messages.entities (JSONB). See init.sql for the fresh-install schema.
--
-- Idempotent; the runner wraps this file in a transaction (no BEGIN/COMMIT here).

DROP TABLE IF EXISTS message_tags CASCADE;
DROP TABLE IF EXISTS tag_stats CASCADE;
