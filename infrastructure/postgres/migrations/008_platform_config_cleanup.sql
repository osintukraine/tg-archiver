-- Remove admin settings that no service will ever honour.
--  * telegram.session_name: the session is a credential file, not a runtime setting
--  * api.cors_allow_all: allowing all origins from a web form is a security footgun
-- The remaining keys stay; the API reports which of them are actually applied.
-- Idempotent.

DELETE FROM platform_config WHERE key IN ('telegram.session_name', 'api.cors_allow_all');
