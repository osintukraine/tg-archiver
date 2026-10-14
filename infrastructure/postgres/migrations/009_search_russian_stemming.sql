-- Full-text search: stem words so every inflected form matches.
--
-- The 'simple' config matched exact word forms only: "Украина" found 30 of the
-- 151 messages mentioning Ukraine (Украины, Украине, ... were missed), and
-- "drone" / "drones" returned different sets.
--
-- Postgres's built-in 'russian' config stems Cyrillic words with the Russian
-- Snowball stemmer and Latin words with the English one, so one config covers
-- both the original text and the English translation, and queries keep working
-- with exclusions ("-word"). Ukrainian has no built-in stemmer; Ukrainian words
-- go through the Russian stemmer (shared roots usually still match).
-- Stopwords ("the", "и", ...) are no longer searchable on their own.
--
-- The API must query with the same config: services/api/src/routers/messages.py
-- (SEARCH_CONFIG). Idempotent. Rebuilds every message's vector once (one UPDATE
-- over the table; on a very large archive run it at a quiet time).

CREATE OR REPLACE FUNCTION update_messages_search_vector()
RETURNS TRIGGER AS $$
BEGIN
    NEW.search_vector := to_tsvector('russian', COALESCE(NEW.content, '') || ' ' || COALESCE(NEW.content_translated, ''));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE messages
SET search_vector = to_tsvector('russian', COALESCE(content, '') || ' ' || COALESCE(content_translated, ''));
