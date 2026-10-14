# tg-archiver

**Self-hosted Telegram channel archiver with web interface.**

Archive messages from Telegram channels with media storage, translation support, full-text search, and RSS feed generation.

## Features

- **Real-time Archiving**: Monitor channels via Telegram folders - add channels by drag-and-drop
- **Media Storage**: Photos, videos, documents with SHA-256 deduplication
- **Translation**: Russian/Ukrainian posts are translated to English in a background worker (DeepL with a daily character cap, Google Translate as fallback); archiving never waits for it
- **Full-Text Search**: PostgreSQL full-text search across content and translations, with Russian and English stemming (searching "Украина" also finds "Украины", "Украине"; "drone" finds "drones")
- **RSS Feeds**: Generate RSS/Atom/JSON feeds for archived channels
- **Social Graph**: Track forwards, replies, comments, and engagement metrics
- **Forward Chain Tracking**: Auto-discover channels via forwards, fetch original message context
- **Topic Classification**: Admin-defined topic taxonomy for message categorization
- **Backfill and gap detection**: Fetch historical messages when adding new channels, and fill gaps left by downtime
- **Self-Hosted**: Complete data sovereignty - your data stays on your infrastructure

## Architecture

```
┌─────────────┐     ┌──────────┐     ┌───────────┐     ┌───────────┐
│  Telegram   │────▶│ Listener │────▶│   Redis   │────▶│ Processor │
│   Folders   │     │ Service  │     │  Streams  │     │  Service  │
└─────────────┘     └──────────┘     └───────────┘     └───────────┘
                                                              │ writes
                                                              ▼
┌─────────┐   :80   ┌───────┐  /api   ┌───────────┐  reads ┌──────────────┐
│ Browser │────────▶│ Caddy │────────▶│    API    │───────▶│  PostgreSQL  │
└─────────┘         │       │  /      │  FastAPI  │        │  SeaweedFS   │
                    │       │────────▶ Frontend (Next.js)  └──────────────┘
                    │       │  /media ─────────────────────▶ SeaweedFS (read-only)
                    └───────┘
```

| Service | Purpose |
|---------|---------|
| **Listener** | Connects to Telegram, monitors folder-based channels |
| **Processor** | Processes messages, downloads media, stores to DB; runs the background translation worker |
| **API** | FastAPI REST API with search, RSS, and admin endpoints |
| **Frontend** | Next.js 16 / React 19 web interface for browsing and search (built with Bun) |
| **Caddy** | Reverse proxy and single entry point on port 80 (`/api` → api, `/media` → SeaweedFS, `/` → frontend) |
| **PostgreSQL 18** | Message storage with full-text search |
| **Redis 8** | Message queue using Redis Streams |
| **SeaweedFS** | S3-compatible media storage (replaced MinIO, whose community images were discontinued) |

---

## Quick Start

### Prerequisites

- **Docker** and **Docker Compose** (v2.0+)
- **Python 3.11+** (for initial Telegram authentication only; the services themselves run on Python 3.14 in Docker)
- **Telegram API credentials** from [my.telegram.org/apps](https://my.telegram.org/apps)

### Step 1: Clone and Configure

```bash
git clone https://github.com/osintukraine/tg-archiver.git
cd tg-archiver

# Copy example environment file
cp .env.example .env
```

Edit `.env` with your Telegram credentials:

```bash
# Required - get from https://my.telegram.org/apps
TELEGRAM_API_ID=your_api_id_here
TELEGRAM_API_HASH=your_api_hash_here

# Required. docker compose refuses to start while one is missing, and the services
# refuse the .env.example placeholders (change_me_..., minioadmin) and a JWT key
# shorter than 32 characters. Generate values with: openssl rand -hex 32
POSTGRES_PASSWORD=your_secure_password
MINIO_SECRET_KEY=your_s3_secret
JWT_SECRET_KEY=generate_a_64_char_secret_key
JWT_ADMIN_PASSWORD=your_admin_password
```

> **Note:** `docker-compose.yml` does not load `.env` into containers wholesale. Each
> service only receives the variables listed under its `environment:` block (`.env` is
> used to fill in those values). See [Configuration Reference](#configuration-reference).

### Step 2: Create Telegram Session

Before starting Docker, you need to authenticate with Telegram to create a session file:

```bash
# Install dependencies for auth script
pip install telethon python-dotenv

# Run the authentication script
python3 scripts/telegram_auth.py
```

The script will:
1. Ask for your phone number (with country code, e.g., `+1234567890`)
2. Send a verification code to your Telegram app
3. Ask for 2FA password if enabled
4. Create `sessions/listener.session` file
5. Show your Telegram folders for verification

Example output:
```
🔐 tg-archiver Telegram Authentication
============================================================
API ID: 12345678
Session file: /path/to/tg-archiver/sessions/listener.session
============================================================

📱 Phone number authentication required

Enter your phone number (with country code, e.g., +1234567890): +1234567890

📤 Sending verification code to +1234567890...

🔑 Enter the verification code you received: 12345

🔐 Signing in...

============================================================
✅ Authentication successful!
============================================================
Logged in as: John Doe
Username: @johndoe
Phone: +1234567890
User ID: 123456789

📁 Telegram Folders on this account:
----------------------------------------
  1. [All Chats]
  2. Personal (15 chats)
  3. Work (8 chats)
----------------------------------------
⚠️  Target folder 'tg-archiver' NOT FOUND
   Create a folder named 'tg-archiver' in your Telegram app
   and add channels to archive.
```

### Step 3: Create Archive Folder in Telegram

1. Open Telegram (mobile or desktop)
2. Go to **Settings** → **Folders** → **Create New Folder**
3. Name it exactly: `tg-archiver` (the value `.env.example` sets for `FOLDER_ARCHIVE_ALL_PATTERN`; if the variable is unset the default is `Archive`)
4. Add channels you want to archive to this folder

### Step 4: Build and Start the Platform

```bash
# Build all container images (first time or after updates)
docker-compose build

# Start all services
docker-compose up -d

# Watch logs to verify startup
docker-compose logs -f
```

**Note:** The build step installs the Python services and builds the Next.js frontend with Bun.

**Database schema is automatic.** `infrastructure/postgres/init.sql` creates the base schema on an
empty volume, and on every `docker-compose up` a one-shot `db-migrate` service applies any pending
`infrastructure/postgres/migrations/NNN_*.sql` (tracked in `schema_migrations`) before the listener,
processor and API start. Existing deployments pick up new migrations the same way; no manual `psql`
step is needed. If a migration fails, `db-migrate` exits non-zero and the services don't start
(`docker-compose logs db-migrate`).

### Step 5: Access the Interface

| Service | URL | Credentials |
|---------|-----|-------------|
| **Frontend** | http://localhost | username `admin` (or JWT_ADMIN_EMAIL) / JWT_ADMIN_PASSWORD |
| **API Docs** | http://localhost/docs | Log in as admin to see all endpoints (anonymous users see public ones only) |
| **Health** | http://localhost/api/health | - |

Only Caddy (port 80) is published. Direct access to the frontend (3000), API (8000),
SeaweedFS S3 (8333), Postgres and Redis requires uncommenting their `ports:` in
`docker-compose.yml`.

---

## Channel Management

tg-archiver uses **Telegram's native folder feature** as the primary way to manage channels. The admin panel adds bulk CSV import and review of discovered channels.

### Adding Channels (Folder Method)

1. Find a channel in Telegram
2. Long-press (mobile) or right-click (desktop) → **Add to Folder**
3. Select your `tg-archiver` folder
4. Done! The listener detects changes within 5 minutes (sync interval is fixed at 300 seconds)

### Removing Channels

1. Remove the channel from your `tg-archiver` folder
2. The listener stops monitoring (existing messages remain archived)

### Folder Naming

`.env.example` sets the folder name to `tg-archiver` (if `FOLDER_ARCHIVE_ALL_PATTERN` is unset, the default is `Archive`). Matching is exact and case-insensitive. You can customize it in `.env`:

```bash
FOLDER_ARCHIVE_ALL_PATTERN=my-archive
```

**Note:** Telegram folder names are limited to 12 characters.

---

## Bulk Channel Import (CSV)

For importing many channels at once, use the CSV import feature in the admin panel.

### How to Import

1. Go to **Admin** → **Import Channels** (`/admin/import`)
2. Prepare a CSV file with your channels
3. Drag-and-drop or click to upload
4. Review the validation results
5. Select channels and target folders
6. Click **Start Import**

### CSV Format

```csv
channel,name,folder
https://t.me/channelname,Channel Name,tg-archiver
@anotherchannel,,tg-archiver
```

| Column (accepted header names) | Required | Description |
|--------|----------|-------------|
| `channel` / `url` / `channel_url` / `link` / `telegram` | Yes | `https://t.me/name`, `telegram.me/name`, `@name` or plain `name`. If no header matches, the first column is used |
| `name` / `channel_name` / `title` | No | Display name |
| `folder` / `category` / `group` / `target_folder` | No | Target Telegram folder |

Only public usernames are supported. Numeric channel IDs and private invite links are rejected, and rows with an empty channel cell are skipped.

### Import Process

1. **Validation** - Each channel is validated (exists, accessible, not duplicate)
2. **Folder Creation** - Target folders are created in Telegram if they don't exist
3. **Channel Addition** - Channels are added to the specified folders
4. **Monitoring Starts** - Listener automatically picks up new channels

### Import Status

**Job status:** `uploading` → `validating` → `ready` → `processing` → `completed` (or `failed` / `cancelled`).

**Per-channel status:**

| Status | Meaning |
|--------|---------|
| `pending` | Waiting to be validated |
| `validating` | Checking channel accessibility |
| `validated` | Ready to import |
| `validation_failed` | Cannot be imported (see error) |
| `already_member` | Account already in the channel |
| `joined` | Successfully joined and added |
| `join_failed` | Join failed (see error) |

Skipped channels are reported as a count on the job.

---

## Forward Chain Tracking

tg-archiver automatically discovers new channels through message forwards and enriches the social graph with original message context.

### How It Works

```
Your Monitored Channel          Discovered Channel (auto-joined)
┌──────────────────────┐        ┌──────────────────────────────┐
│ Message A            │        │ Original Message             │
│ "Forwarded from X"   │───────▶│ - Content cached             │
│ - forward_from_id    │        │ - Reactions fetched          │
│ - propagation time   │        │ - Comments fetched           │
└──────────────────────┘        └──────────────────────────────┘
```

> These tables come from migrations `003_discovered_channels.sql` and
> `004_discovered_channel_approval.sql`, applied automatically by `db-migrate`.

When a forwarded message arrives in your monitored channels:

1. **Discovery**: The source channel of a forwarded **broadcast-channel post** is recorded in
   `discovered_channels` (forwards from users, bots, groups and hidden senders are not tracked;
   channels you already archive are skipped)
2. **Admin Review**: Discovered channels appear in `/admin/channels` → **Discovered** tab
3. **Join** (for social data access only): by default the account joins a discovered channel
   **only after an admin approves it** (`CHANNEL_JOIN_MODE=approval`)
4. **Social Fetch**: Original message content, reactions, and comments are retrieved from joined channels

> **Why approval is the default:** joining is visible to the target channel's admins, and anyone
> who can forward a post into a monitored chat (e.g. a member of a monitored supergroup) could
> otherwise make the archiving account join arbitrary channels. `CHANNEL_JOIN_MODE=auto` restores
> fully automatic joining; `off` disables joining.

### Key Benefits

- **No archiving of discovered channels** - Only social context is fetched
- **Propagation timing** - Track how fast content spreads (seconds from original to forward)
- **Complete social graph** - Reactions and comments from the original post
- **Admin control** - Promote interesting channels to full archiving, or ignore them

### Admin Interface

Navigate to **Admin** → **Channels** → **Discovered** tab to:

| Action | Description |
|--------|-------------|
| **Approve** | Allow the account to join this channel (approval mode). Approving a failed channel makes it eligible again |
| **Unapprove** | Withdraw approval before the join happens |
| **Promote** | Add channel to full archiving (select category, folder, rule) |
| **Ignore** | Hide from suggestions, never join, stop social fetching |
| **Retry** | Retry joining a failed/private channel |

The tab shows the current join mode and how many channels are awaiting approval.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CHANNEL_JOIN_MODE` | `approval` | `approval` (join only admin-approved channels), `auto` (join automatically) or `off` |
| `CHANNEL_JOIN_ENABLED` | `true` | Deprecated: `false` is treated as `CHANNEL_JOIN_MODE=off` |
| `CHANNEL_JOIN_INTERVAL_SECONDS` | `60` | Seconds between join cycles |
| `CHANNEL_JOIN_BATCH_SIZE` | `5` | Max channels to join per cycle |
| `CHANNEL_JOIN_DAILY_CAP` | `20` | Max successful joins per rolling 24 hours |
| `CHANNEL_JOIN_MAX_RETRIES` | `3` | Retries before marking as failed |
| `CHANNEL_JOIN_RETRY_DELAY_HOURS` | `24` | Hours between retry attempts |
| `CHANNEL_JOIN_LIMIT_PAUSE_HOURS` | `24` | Pause after Telegram reports the account is in too many channels |

Telegram FloodWait errors are honoured (the cycle sleeps, up to 1 hour, then stops). Social data
fetching uses the `SOCIAL_FETCH_*` settings (`SOCIAL_FETCH_ENABLED=false` turns it off). All of
these are passed to the listener by `docker-compose.yml`, so setting them in `.env` takes effect.

### Database Tables

| Table | Purpose |
|-------|---------|
| `discovered_channels` | Channels found via forwards (status, metadata, admin actions) |
| `message_forwards` | Links archived messages to their original sources |
| `original_messages` | Cached content of original messages (graph leaf nodes) |
| `forward_reactions` | Reactions on original messages |
| `forward_comments` | Comments on original messages |

### API Endpoints

```
GET  /api/admin/discovered/          # List discovered channels
GET  /api/admin/discovered/stats     # Statistics
GET  /api/admin/discovered/{id}      # Channel details + recent forwards
POST /api/admin/discovered/{id}/promote  # Promote to full archiving
POST /api/admin/discovered/{id}/ignore   # Mark as ignored
POST /api/admin/discovered/{id}/approve    # Approve joining (approval mode)
POST /api/admin/discovered/{id}/unapprove  # Withdraw approval
POST /api/admin/discovered/{id}/retry    # Retry failed join
DELETE /api/admin/discovered/{id}        # Remove a discovered channel
```

---

## Configuration Reference

`docker-compose.yml` has no `env_file`: each container only receives the variables listed
under its `environment:` block, with `.env` supplying the values. A variable that is in `.env`
but not referenced in `docker-compose.yml` has no effect. Defaults below are the
docker-compose defaults unless noted.

### Required Settings

| Variable | Description |
|----------|-------------|
| `TELEGRAM_API_ID` | Telegram API ID from my.telegram.org |
| `TELEGRAM_API_HASH` | Telegram API Hash from my.telegram.org |

### Database

The PostgreSQL host and port are fixed to `postgres:5432` in `docker-compose.yml` and cannot be set from `.env`.

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `tg_archiver` | Database name |
| `POSTGRES_USER` | `archiver` | Database user |
| `POSTGRES_PASSWORD` | (required) | Database password (**must change**) |
| `REDIS_PASSWORD` | (empty) | Redis password; empty = no auth (set it in production). The Redis host is fixed in compose |
| `TELEGRAM_SESSION_NAME` | `listener` | Session file name under `sessions/` |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_PROVIDER` | `jwt` | `jwt` for local auth, `none` to disable (code default without compose: `none`) |
| `AUTH_REQUIRED` | `false` | `true` = every API endpoint needs a login (private archive); `false` = public read access |
| `FEED_AUTH_REQUIRED` | `false` | `true` = RSS/Atom/JSON feeds need a feed token |
| `JWT_SECRET_KEY` | (required) | Secret for JWT signing (**must change**) |
| `JWT_ADMIN_EMAIL` | `admin@tg-archiver.local` | Admin email (the admin username is `admin`; either works for login) |
| `JWT_ADMIN_PASSWORD` | (required) | Admin login password (**must change**) |
| `JWT_EXPIRATION_MINUTES` | `60` | Token expiration time |

### Storage (SeaweedFS, S3-compatible)

The `MINIO_*` variable names are kept for compatibility; they configure the
SeaweedFS S3 gateway and the services that talk to it (the endpoint is fixed to `seaweedfs:8333` in compose). Anonymous clients get
read-only access to the media bucket (served by Caddy at `/media/*`); writes,
deletes and listings require the access key.

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIO_ACCESS_KEY` | `minioadmin` | S3 access key |
| `MINIO_SECRET_KEY` | `minioadmin` | S3 secret key (**change in production**) |
| `MINIO_BUCKET` | `tg-archive-media` | Bucket for media files. Caddy hardcodes `/tg-archive-media`, so keep the default |
| `PUBLIC_BASE_URL` | `http://localhost` | Public site origin (what browsers and feed readers use). Media links in the API, RSS/Atom/JSON feeds and OpenGraph tags are `<origin>/media/...` (Caddy proxies `/media/*` to SeaweedFS). The API prefers the origin of the incoming request and falls back to this value; the frontend bakes it in as `NEXT_PUBLIC_BASE_URL`, so rebuild the frontend after changing it |
| `MINIO_PUBLIC_URL` | (empty) | Optional direct public S3 endpoint (e.g. `http://localhost:8333` with the port published). When set, API and feed media URLs become `{MINIO_PUBLIC_URL}/{bucket}/{key}` instead of Caddy paths |

### Translation

Ingest never waits for translation. The processor detects each message's language (`langdetect`,
stored in `messages.language_detected`) and marks it `translation_status = pending` (language in
`TRANSLATION_FROM_LANGUAGES`) or `skipped`. A background worker in the processor
(`services/processor/src/translation_worker.py`) translates pending messages newest first and sets
`done`, or `failed` after `TRANSLATION_MAX_ATTEMPTS`. Pending messages older than
`TRANSLATION_MAX_AGE_HOURS` are skipped. Migration `007_translation_queue.sql` adds the queue columns.

With `TRANSLATION_PROVIDER=deepl` and a `DEEPL_API_KEY`, DeepL (target `EN-US` for `en`) is used first,
up to `TRANSLATION_DAILY_CHAR_LIMIT` characters per UTC day (Redis counter, gauge
`tg_translation_deepl_chars_today`). Past the cap, or when DeepL reports its quota exceeded, DeepL is
paused until 00:00 UTC and the free Google Translate fallback is used. Google calls keep a minimum
interval and back off exponentially after a rate-limit (429) or connection error; affected messages
are rescheduled, never dropped.

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSLATION_ENABLED` | `true` | Enable translation (also sets the frontend's `NEXT_PUBLIC_TRANSLATION_ENABLED`) |
| `TRANSLATION_PROVIDER` | `deepl` | `deepl` (DeepL first if a key is set, then Google), `google` or `none` |
| `DEEPL_API_KEY` | (empty) | DeepL API key; without it only Google is used |
| `DEEPL_API_URL` | (empty) | Override the endpoint derived from the key |
| `TRANSLATION_TARGET_LANG` | `en` | Target language |
| `TRANSLATION_FROM_LANGUAGES` | `ru,uk` | Source languages that get translated (processor) |
| `TRANSLATION_DAILY_CHAR_LIMIT` | `500000` | Max characters sent to DeepL per UTC day; `0` = no cap |
| `TRANSLATION_MAX_AGE_HOURS` | `48` | Older untranslated messages are skipped |
| `TRANSLATION_BATCH_SIZE` | `10` | Messages per worker batch |
| `TRANSLATION_POLL_INTERVAL_SECONDS` | `5` | Idle poll interval |
| `TRANSLATION_MAX_ATTEMPTS` | `8` | Attempts before `failed` |
| `GOOGLE_MIN_INTERVAL_SECONDS` | `2` | Minimum pause between Google calls |
| `GOOGLE_BACKOFF_BASE_SECONDS` / `GOOGLE_BACKOFF_MAX_SECONDS` | `30` / `900` | Exponential backoff after a Google rate limit |

### Backfill

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_ENABLED` | `false` (`.env.example` sets `true`) | Enable historical message backfill |
| `BACKFILL_START_DATE` | `2024-01-01` | How far back to fetch |
| `BACKFILL_MODE` | `manual` (`.env.example` sets `on_discovery`) | `manual` or `on_discovery` (`scheduled` is not implemented) |
| `BACKFILL_BATCH_SIZE` | `100` | Messages per batch |
| `BACKFILL_DELAY_MS` | `1000` | Delay between batches (rate limiting) |
| `BACKFILL_MEDIA_STRATEGY` | `download_available` | `download_available`, `skip` or `download_all` |
| `GAP_DETECTION_ENABLED` | `false` (`.env.example` sets `true`) | On startup and periodically, backfill channels silent for too long |
| `GAP_THRESHOLD_HOURS` | `1.0` | Hours without a message before a channel is checked |
| `GAP_CHECK_INTERVAL_SECONDS` | `600` | Seconds between gap checks |
| `GAP_MAX_CHANNELS_PER_CHECK` | `10` | Max channels backfilled per check |

### Logging and API

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `INFO` | Log level (listener, processor, api) |
| `LOG_FORMAT` | `json` | `json` or `console` |
| `PLATFORM_NAME` | `Telegram Archiver` | Site name in feeds and author fields (api) |
| `API_CORS_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins allowed cross-origin; not needed behind Caddy |
| `TRUSTED_PROXY_HOSTS` | `caddy,127.0.0.1,localhost` | Hosts whose `X-Forwarded-*` headers the API trusts |
| `PROCESSOR_RETRY_IDLE_MS` | `300000` | Idle time before a failed message is redelivered (see Dead-Letter Queue) |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `` (empty) | API URL for browser requests. Empty = relative URLs (use when behind proxy) |
| `NEXT_PUBLIC_MINIO_URL` | `` (empty) | Base URL prefixed to media keys. Keep empty behind Caddy; for direct S3 access include the bucket, e.g. `http://localhost:8333/tg-archive-media` |
| `NEXT_PUBLIC_RSS_ENABLED` | `false` | Show RSS features in the UI |
| `API_URL` | `http://api:8000` | API URL for server-side rendering (not passed by compose; the default works inside Docker) |

`NEXT_PUBLIC_*` values are baked into the frontend at build time: run `docker-compose build frontend` after changing them.

---

## Operations

### Viewing Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f listener
docker-compose logs -f processor
docker-compose logs -f api
```

### Restarting Services

```bash
# Restart everything
docker-compose restart

# Restart specific service
docker-compose restart listener
```

### Stopping the Platform

```bash
docker-compose down
```

### Updating

```bash
git pull
docker-compose build
docker-compose up -d
```

### Failed Messages and the Dead-Letter Queue

If processing a message fails (for example a database error), the processor leaves it pending
in Redis and retries it after `PROCESSOR_RETRY_IDLE_MS` (default 5 minutes). After 3 failed
deliveries the full message is moved to the dead-letter queue (Redis stream
`telegram:messages:dlq`, last 10,000 entries). A message that repeatedly crashes the processor
is dead-lettered the same way instead of looping forever.

Admins can inspect and recover dead-lettered messages through the API:

```
GET    /api/admin/dlq?limit=50&before=<id>   # List entries (newest first)
POST   /api/admin/dlq/{dlq_id}/replay        # Put the message back on its original stream
DELETE /api/admin/dlq/{dlq_id}               # Discard an entry
```

Media download failures don't fail the message: it is archived without the media file.

### Re-authenticating Telegram

If your session expires or you need to switch accounts:

```bash
# Remove old session
rm sessions/listener.session

# Re-run authentication
python3 scripts/telegram_auth.py

# Restart listener
docker-compose restart listener
```

---

## Troubleshooting

### "Session file not found" Error

The listener can't find the Telegram session file.

```bash
# Check if session exists
ls -la sessions/

# If missing, create it
python3 scripts/telegram_auth.py
```

### "Target folder not found" Warning

The listener can't find your archive folder in Telegram.

1. Verify folder name matches `FOLDER_ARCHIVE_ALL_PATTERN` in `.env`
2. Folder names are case-insensitive but must match exactly
3. Re-run `python3 scripts/telegram_auth.py` to see current folders

### CORS Errors in Browser

If you see CORS errors when accessing the frontend:

1. Ensure `NEXT_PUBLIC_API_URL` is empty (for proxied setup) or set correctly
2. Check that Caddy/nginx is properly routing `/api/*` to the API service

### Messages Not Appearing

1. Check listener logs: `docker-compose logs -f listener`
2. Verify the channel is in your archive folder
3. Check processor logs: `docker-compose logs -f processor`
4. Verify Redis is running: `docker-compose logs redis`

### FloodWait Errors

Telegram rate limiting. The listener handles this automatically by waiting.

```bash
# Check listener logs for wait time
docker-compose logs listener | grep -i flood
```

---

## Development

### Directory Structure

```
tg-archiver/
├── services/
│   ├── listener/       # Telegram monitoring service
│   ├── processor/      # Message processing service
│   ├── api/            # FastAPI backend
│   └── frontend/       # Next.js frontend
├── shared/python/      # Shared Python modules (models, utils)
├── infrastructure/
│   ├── caddy/          # Caddyfile (local) and Caddyfile.production (HTTPS)
│   ├── postgres/       # init.sql, migrate.sh, migrations/ (applied by db-migrate)
│   └── seaweedfs/      # entrypoint.sh (renders S3 identities from MINIO_* vars)
├── scripts/
│   ├── telegram_auth.py              # Telegram authentication script
│   ├── env_audit.py                  # finds dead/missing settings in .env vs compose and code
│   ├── create_readonly_db_role.sh    # read-only DB role for the Postgres MCP
│   └── backfill_discovered_channels.sql
├── docs/plans/         # Design notes
├── sessions/           # Telegram session files (gitignored)
├── docker-compose.yml
├── .env.example
└── .env               # Your configuration (gitignored)
```

### Running Services Locally

Uncomment the `ports:` of postgres, redis and seaweedfs in `docker-compose.yml` first (or, for Postgres
only, use `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`, which publishes it on
`127.0.0.1:5432`).

```bash
# Start infrastructure only
docker-compose up -d postgres redis seaweedfs

# Install Python dependencies (shared + service)
cd services/listener   # or processor, api
pip install -r ../../shared/python/requirements.txt -r requirements.txt

# Run locally (for debugging). These settings have no defaults and must be set:
# POSTGRES_PASSWORD, REDIS_PASSWORD, MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, JWT_SECRET_KEY
PYTHONPATH=../../shared/python POSTGRES_HOST=localhost MINIO_ENDPOINT=localhost:8333 \
  python -m src.main
# The API runs with uvicorn instead: PYTHONPATH=../../shared/python uvicorn src.main:app
```

Python tests use pytest against real services (Redis 8 / Postgres 18 in Docker, no mocks for
stream or SQL semantics). Run them inside the service images:

```bash
docker-compose build processor listener api
docker network create tgtest
docker run -d --name tgtest-redis --network tgtest redis:8-alpine
docker run -d --name tgtest-pg --network tgtest -e POSTGRES_USER=archiver \
  -e POSTGRES_PASSWORD=testpw -e POSTGRES_DB=tg_archiver postgres:18.6-alpine
# schema for listener/api tests: init.sql, then the same migration runner db-migrate uses
docker exec -i tgtest-pg psql -q -U archiver -d tg_archiver < infrastructure/postgres/init.sql
docker run --rm --network tgtest -e PGHOST=tgtest-pg -e PGUSER=archiver -e PGPASSWORD=testpw \
  -e PGDATABASE=tg_archiver -v $PWD/infrastructure/postgres/migrate.sh:/migrate.sh:ro \
  -v $PWD/infrastructure/postgres/migrations:/migrations:ro --entrypoint /bin/sh postgres:18.6-alpine /migrate.sh

# Settings without defaults must be set (dummy values are fine for tests)
ENV="-e POSTGRES_HOST=tgtest-pg -e POSTGRES_USER=archiver -e POSTGRES_PASSWORD=testpw -e REDIS_PASSWORD=x -e MINIO_ENDPOINT=x:1 \
  -e MINIO_ACCESS_KEY=x -e MINIO_SECRET_KEY=x -e JWT_SECRET_KEY=x -e TELEGRAM_API_ID=1 -e TELEGRAM_API_HASH=x"

# processor (Redis Streams retry / dead-letter)
docker run --rm -u root --network tgtest $ENV -e TEST_REDIS_URL=redis://tgtest-redis:6379/15 \
  -v $PWD/services/processor/tests:/app/tests:ro -v $PWD/services/processor/requirements-dev.txt:/tmp/rd.txt:ro \
  tg-archiver-processor sh -c "pip install -q -r /tmp/rd.txt && python -m pytest -o asyncio_mode=auto tests"

# listener (channel join worker, import/promotion worker Redis reads)
docker run --rm -u root --network tgtest $ENV -e PYTHONPATH=/shared/python:/app -w /app \
  -e TEST_REDIS_URL=redis://tgtest-redis:6379/13 \
  -v $PWD/services/listener/tests:/app/tests:ro -v $PWD/services/listener/requirements-dev.txt:/tmp/rd.txt:ro \
  tg-archiver-listener sh -c "pip install -q -r /tmp/rd.txt && python -m pytest tests"

# api (DLQ, discovered-channel approval, channel submissions, middleware, media URLs, logout blacklist)
docker run --rm -u root --network tgtest $ENV -e TEST_REDIS_URL=redis://tgtest-redis:6379/14 -w /app \
  -v $PWD/services/api/tests:/app/tests:ro \
  tg-archiver-api sh -c "pip install -q pytest pytest-asyncio && python -m pytest tests -c tests/pytest-approval.ini"

docker rm -f tgtest-redis tgtest-pg && docker network rm tgtest
```

Image names follow the compose project name (`tg-archiver-*` when the checkout directory is `tg-archiver`).

Database tests: `sh infrastructure/postgres/tests/test_migrate.sh` checks the migration runner (fresh
database, re-run, existing deployment, failing migration) against throwaway Postgres 18 containers.
`infrastructure/postgres/tests/test_schema_drift.py` compares every ORM model with a live schema
(`DRIFT_DB_URL=postgresql://user:pw@host:5432/db`).

### Linting and CI

CI (`.github/workflows/ci.yml`) runs on every push to `main`/`develop` and on pull requests: ruff, the
env audit (`.env.example` against compose and code) and gitleaks, the Python test suites (against real Redis 8 / Postgres 18, schema applied with
`migrate.sh`), the migration runner test, frontend lint/type-check/vitest, and a Docker build of all
four services. Dependabot (`.github/dependabot.yml`) opens weekly grouped update PRs.

Run the same checks locally:

```bash
pip install pre-commit ruff pyyaml
python scripts/env_audit.py --env-file .env.example --strict   # prints names only, never values
python scripts/env_audit.py --env-file .env --strict           # your real .env: dead, unpassed and RENAMED names (with their replacement)
ruff check .               # config + documented baseline of ignored rules in pyproject.toml
pre-commit install         # gitleaks, ruff, hygiene hooks, eslint on changed frontend files
pre-commit run --all-files
```

### AI-assisted development

`.claude/settings.json` denies Claude Code access to `.env*`, Telegram session files and keys
(`.claudeignore` is not a Claude Code feature). `.mcp.json` gives Claude read-only schema access
through a Postgres MCP server: set `CLAUDE_READONLY_PASSWORD` (alphanumeric), start Postgres with
`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres`, run
`scripts/create_readonly_db_role.sh`, then start Claude Code from that shell (requires `uv`).
`AGENTS.md` points other coding agents to the same conventions.

### Running Frontend Locally

The frontend uses [Bun](https://bun.sh) (`bun.lock`):

```bash
cd services/frontend
bun install
bun run dev          # http://localhost:3000
bun run lint         # ESLint (flat config in eslint.config.mjs)
bun run type-check   # TypeScript
bun run test:run     # Vitest (single run; `bun run test` watches)
```

Outside Docker, server-side rendering calls `http://api:8000` unless you set `API_URL`
(e.g. `API_URL=http://localhost:8000`, with the API port published).

---

## Production Deployment

### Security Checklist

Before deploying to production, ensure you've configured proper security:

#### 1. Generate Secure Secrets

```bash
# Generate JWT secret (64 characters minimum)
openssl rand -hex 64

# Generate Redis password
openssl rand -base64 32

# Generate PostgreSQL password
openssl rand -base64 24
```

#### 2. Configure Production Environment

Create or update your `.env` file:

```bash
# Strong passwords (use generated values above)
POSTGRES_PASSWORD=your_generated_postgres_password
JWT_SECRET_KEY=your_generated_64_char_jwt_secret
JWT_ADMIN_PASSWORD=your_strong_admin_password
REDIS_PASSWORD=your_generated_redis_password
MINIO_SECRET_KEY=your_s3_secret_at_least_32_chars
```

For production also set these in `.env` (they are passed to the API by `docker-compose.yml`):

```bash
ENVIRONMENT=production            # adds the Secure flag to the login and CSRF cookies
CSRF_ENABLED=true                 # default
TOKEN_BLACKLIST_FAIL_MODE=closed  # deny requests if Redis (token blacklist) is unavailable
TURNSTILE_SECRET_KEY=...          # optional: real captcha on the public suggest-channel form
NEXT_PUBLIC_TURNSTILE_SITE_KEY=... # its site key (build-time: rebuild the frontend)
```

#### 3. Enable HTTPS

`infrastructure/caddy/Caddyfile.production` provides automatic HTTPS, but the default
compose `caddy` service is set up for local HTTP only. To use it, change the `caddy`
service in `docker-compose.yml`:

```yaml
  caddy:
    ports:
      - "80:80"
      - "443:443"
    environment:
      - DOMAIN=${DOMAIN}            # e.g. archive.yourdomain.com
      - ACME_EMAIL=${ACME_EMAIL}
    volumes:
      - ./infrastructure/caddy/Caddyfile.production:/etc/caddy/Caddyfile:ro
      - caddy_data:/data             # persist certificates (add caddy_data to volumes:)
```

#### 4. Deploy

```bash
# Build with production settings
docker-compose build

# Start services
docker-compose up -d

# Verify all services are healthy
docker-compose ps
```

### Security Features

| Feature | Description | Config Variable |
|---------|-------------|-----------------|
| **HTTPS** | TLS 1.2+ with automatic Let's Encrypt | Caddyfile.production |
| **Rate Limiting** | 5 login attempts per minute per client IP (Caddy forwards the real IP); suggest-channel submissions 3 per minute | Built-in |
| **CSRF Protection** | Double-submit cookie pattern (`csrf_token` cookie is readable by JS by design) | On by default |
| **Token Invalidation** | Logging out (web UI or `POST /api/auth/logout`) blacklists the JWT in Redis until it expires; blacklisted tokens get 401 | `TOKEN_BLACKLIST_FAIL_MODE` |
| **Token transport** | JWTs only via `Authorization: Bearer` header (or the `access_token` cookie for /docs), never URL query parameters | Built-in |
| **Captcha** | Cloudflare Turnstile on the public suggest-channel form | `TURNSTILE_SECRET_KEY` |
| **Secure Cookies** | `access_token`: HttpOnly, SameSite=Strict, plus Secure in production | `ENVIRONMENT=production` (see above) |
| **Password Policy** | Minimum 8 characters | Built-in |
| **Non-root Containers** | All application services run as non-root | Built-in |
| **Media access** | Anonymous read-only on the media bucket; writes, deletes and listings need the S3 key; Caddy strips auth headers before `/media/*` | Built-in |
| **Redis Auth** | Password-protected Redis | `REDIS_PASSWORD` |

### Production Architecture

```
Internet → Caddy (HTTPS:443) → Internal Docker Network
                │
                ├── /api/*, /docs, /redoc, /openapi.json → api:8000
                ├── /media/*   → seaweedfs:8333
                └── /*         → frontend:3000
```

Only Caddy is exposed to the internet. All other services communicate internally.

### Backup Recommendations

```bash
# Database backup (-T avoids TTY line-ending corruption in the dump)
docker-compose exec -T postgres pg_dump -U archiver tg_archiver > backup.sql

# Media backup (SeaweedFS data; stop the seaweedfs service first for a consistent copy).
# The volume name is prefixed with the compose project name (the directory name by default).
docker run --rm -v tg-archiver_seaweedfs_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/seaweedfs-backup.tar.gz /data
```

---

## Known Issues

These are current gaps in the code, documented here so they don't surprise you:

- **Suggest-channel review:** submissions are stored and listable by admins
  (`GET /api/admin/channel-submissions`), but there is no admin UI or accept/reject workflow yet.
- **Unpopulated tables:** `message_engagement_timeline` and `message_replies` are queried but
  nothing writes them (endpoints return empty results), and the media-status check in
  `/api/system` reads a `messages.media_archived` column that nothing sets.
- **React hydration warnings (#418)** appear in the browser console on the home and message pages.

---

## License

AGPL-3.0 License - See [LICENSE](LICENSE) file for details.
