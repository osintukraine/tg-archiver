# Listener Service

Telethon client that owns the Telegram session. It discovers channels from a Telegram folder, receives new messages and publishes them to Redis Streams for the processor. No other service uses the listener session.

## Running

Run it with the rest of the stack (`docker-compose up -d`). Authenticate once before the first start, from the repo root:

```bash
pip install telethon python-dotenv
python3 scripts/telegram_auth.py      # writes sessions/listener.session
```

The listener exits with code 1 if the session file is missing. Compose mounts `./sessions` at `/data/sessions` and runs the container as `${UID}:${GID}`, so the directory must be writable by that user. Never commit or share `sessions/`: it holds full account credentials.

Running outside Docker: see "Build & Run Commands" in `CLAUDE.md` (`PYTHONPATH=../../shared/python ... python -m src.main`).

## Settings

Passed to the container by `docker-compose.yml`; defaults live in `shared/python/config/settings.py`.

| Variable | Notes |
|----------|-------|
| `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` | Required, from my.telegram.org |
| `TELEGRAM_SESSION_NAME` | Session file name without extension (default `listener`) |
| `FOLDER_ARCHIVE_ALL_PATTERN` | Telegram folder to monitor; exact, case-insensitive match (compose default `Archive`, `.env.example` sets `tg-archiver`) |
| `BACKFILL_ENABLED`, `BACKFILL_START_DATE`, `BACKFILL_MODE`, `BACKFILL_BATCH_SIZE`, `BACKFILL_DELAY_MS`, `BACKFILL_MEDIA_STRATEGY` | Historical fetch (off by default; mode `manual`, `on_discovery` or `scheduled`) |
| `GAP_DETECTION_ENABLED`, `GAP_THRESHOLD_HOURS`, `GAP_CHECK_INTERVAL_SECONDS`, `GAP_MAX_CHANNELS_PER_CHECK` | Detect and fill message gaps |
| `CHANNEL_JOIN_MODE` and `CHANNEL_JOIN_*` | Joining channels discovered through forwards: `approval` (default), `auto` or `off` |
| `SOCIAL_FETCH_*`, `SOCIAL_REACTION_POLL_INTERVAL` | Reaction and comment polling |
| `LOG_LEVEL`, `LOG_FORMAT` | Logging |

The folder sync interval (5 minutes) is hardcoded in `src/main.py`. `TELEGRAM_PHONE` is not used; authentication happens in `scripts/telegram_auth.py`.

## Files

| File | Purpose |
|------|---------|
| `src/main.py` | Entry point and startup sequence |
| `src/telegram_listener.py` | Live message event handlers |
| `src/channel_discovery.py` | Folder-based channel discovery and DB sync |
| `src/redis_queue.py` | Publishes to `telegram:messages:realtime` / `:backfill` |
| `src/backfill_service.py` | Historical message fetch and gap filling |
| `src/channel_join_worker.py` | Joins discovered channels per `CHANNEL_JOIN_MODE` |
| `src/social_fetcher.py`, `src/forward_social_fetcher.py` | Engagement data for archived messages |
| `src/import_*.py`, `src/promotion_worker.py` | Import and promotion workers |

## Ports

The image exposes 8001 (Prometheus `/metrics`) and 8002 (health endpoint used by the Dockerfile healthcheck). Compose does not publish either.

## Tests

`services/listener/tests` runs in the listener image against real Redis and Postgres; see README -> Development.

## Troubleshooting

- Immediate exit or "not authorized": run `scripts/telegram_auth.py` again and check `sessions/` permissions.
- No channels discovered: the folder name must equal `FOLDER_ARCHIVE_ALL_PATTERN` exactly (case-insensitive); `Archive-*` / `Monitor-*` patterns are not supported.
- Messages not in the database: check `docker-compose logs processor` and the Redis stream lengths.
