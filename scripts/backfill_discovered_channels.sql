-- Backfill discovered_channels and message_forwards from existing forwarded messages
-- Run: docker-compose exec postgres psql -U archiver -d tg_archiver -f /tmp/backfill_discovered_channels.sql

BEGIN;

-- Step 1: Populate discovered_channels from existing forwards
-- Only add channels that are NOT already in our monitored channels
INSERT INTO discovered_channels (
    telegram_id,
    discovered_at,
    discovered_via_message_id,
    discovery_count,
    last_seen_at,
    join_status,
    created_at,
    updated_at
)
SELECT DISTINCT ON (m.forward_from_channel_id)
    m.forward_from_channel_id as telegram_id,
    MIN(m.telegram_date) as discovered_at,
    (SELECT id FROM messages WHERE forward_from_channel_id = m.forward_from_channel_id ORDER BY telegram_date LIMIT 1) as discovered_via_message_id,
    COUNT(*) as discovery_count,
    MAX(m.telegram_date) as last_seen_at,
    'pending' as join_status,
    NOW() as created_at,
    NOW() as updated_at
FROM messages m
WHERE m.forward_from_channel_id IS NOT NULL
  AND m.forward_from_message_id IS NOT NULL
  -- Exclude channels we already monitor
  AND NOT EXISTS (
      SELECT 1 FROM channels c WHERE c.telegram_id = m.forward_from_channel_id
  )
GROUP BY m.forward_from_channel_id
ON CONFLICT (telegram_id) DO UPDATE SET
    discovery_count = discovered_channels.discovery_count + EXCLUDED.discovery_count,
    last_seen_at = GREATEST(discovered_channels.last_seen_at, EXCLUDED.last_seen_at),
    updated_at = NOW();

-- Step 2: Populate message_forwards from existing forwards
INSERT INTO message_forwards (
    local_message_id,
    original_channel_id,
    original_message_id,
    discovered_channel_id,
    original_date,
    forward_date,
    propagation_seconds,
    created_at,
    updated_at
)
SELECT
    m.id as local_message_id,
    m.forward_from_channel_id as original_channel_id,
    m.forward_from_message_id as original_message_id,
    dc.id as discovered_channel_id,
    m.forward_date as original_date,
    m.telegram_date as forward_date,
    CASE
        WHEN m.forward_date IS NOT NULL AND m.telegram_date IS NOT NULL
        THEN EXTRACT(EPOCH FROM (m.telegram_date - m.forward_date))::INTEGER
        ELSE NULL
    END as propagation_seconds,
    NOW() as created_at,
    NOW() as updated_at
FROM messages m
LEFT JOIN discovered_channels dc ON dc.telegram_id = m.forward_from_channel_id
WHERE m.forward_from_channel_id IS NOT NULL
  AND m.forward_from_message_id IS NOT NULL
ON CONFLICT (local_message_id) DO NOTHING;

-- Show results
SELECT 'Discovered channels' as table_name, COUNT(*) as count FROM discovered_channels
UNION ALL
SELECT 'Message forwards' as table_name, COUNT(*) as count FROM message_forwards;

COMMIT;
