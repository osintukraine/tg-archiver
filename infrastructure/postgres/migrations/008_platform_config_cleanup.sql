-- Remove admin settings that no service will ever honour.
--  * telegram.session_name: the session is a credential file, not a runtime setting
--  * api.cors_allow_all: allowing all origins from a web form is a security footgun
-- The remaining keys stay; the API reports which of them are actually applied.
-- Idempotent.

DELETE FROM platform_config WHERE key IN ('telegram.session_name', 'api.cors_allow_all');

-- The admin switch can only pause translation; it cannot start it when .env disables it.
UPDATE platform_config
SET description = 'Pause translation when false (only takes effect if TRANSLATION_ENABLED=true in .env)'
WHERE key = 'processing.translation_enabled';
