# tg-archiver

**Self-hosted Telegram channel archiver with web interface.**

Archive messages from Telegram channels with media storage, translation support, full-text search, and RSS feed generation.

## Features

- **Real-time Archiving**: Monitor channels via Telegram folders - add channels by drag-and-drop
- **Media Storage**: Photos, videos, documents with SHA-256 deduplication
- **Translation**: Auto-translate non-English content (Google Translate free tier via deep-translator)
- **Full-Text Search**: PostgreSQL tsvector-powered search across content and translations
- **RSS Feeds**: Generate RSS/Atom/JSON feeds for archived channels
- **Social Graph**: Track forwards, replies, comments, and engagement metrics
- **Forward Chain Tracking**: Auto-discover channels via forwards, fetch original message context
- **Topic Classification**: Admin-defined topic taxonomy for message categorization
- **Backfill**: Automatically fetch historical messages when adding new channels
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
| **Processor** | Processes messages, downloads media, stores to DB |
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
- **Python 3.11+** (for initial Telegram authentication only; the services themselves run on Python 3.13 in Docker)
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

# Change these! If unset, docker-compose falls back to `change_me_in_production`,
# which gives a working admin login with a publicly known password.
POSTGRES_PASSWORD=your_secure_password
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

**Fresh database only:** `infrastructure/postgres/init.sql` runs automatically on the first start
(empty `postgres18_data` volume), but the migrations in `infrastructure/postgres/migrations/` are
**not** applied automatically. Apply the forward-chain tables once Postgres is up:

```bash
docker-compose exec -T postgres psql -U archiver -d tg_archiver \
  < infrastructure/postgres/migrations/003_discovered_channels.sql
```

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

> These tables come from `infrastructure/postgres/migrations/003_discovered_channels.sql`,
> which must be applied manually on a fresh database (see Quick Start, Step 4).

When a forwarded message arrives in your monitored channels:

1. **Discovery**: The source channel is recorded in `discovered_channels`
2. **Auto-Join**: Background worker joins the channel (for social data access only)
3. **Social Fetch**: Original message content, reactions, and comments are retrieved
4. **Admin Review**: Discovered channels appear in `/admin/channels` → **Discovered** tab

### Key Benefits

- **No archiving of discovered channels** - Only social context is fetched
- **Propagation timing** - Track how fast content spreads (seconds from original to forward)
- **Complete social graph** - Reactions and comments from the original post
- **Admin control** - Promote interesting channels to full archiving, or ignore them

### Admin Interface

Navigate to **Admin** → **Channels** → **Discovered** tab to:

| Action | Description |
|--------|-------------|
| **Promote** | Add channel to full archiving (select category, folder, rule) |
| **Ignore** | Hide from suggestions, stop social fetching |
| **Retry** | Retry joining a failed/private channel |

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CHANNEL_JOIN_ENABLED` | `true` | Enable auto-joining discovered channels |
| `CHANNEL_JOIN_INTERVAL_SECONDS` | `60` | Seconds between join attempts |
| `CHANNEL_JOIN_BATCH_SIZE` | `5` | Max channels to join per cycle |
| `CHANNEL_JOIN_MAX_RETRIES` | `3` | Retries before marking as failed |
| `CHANNEL_JOIN_RETRY_DELAY_HOURS` | `24` | Hours between retry attempts |

Social data fetching uses the existing `SOCIAL_FETCH_*` settings.

> **Note:** none of the `CHANNEL_JOIN_*` or `SOCIAL_FETCH_*` variables are passed by
> `docker-compose.yml`, so the defaults above always apply. To override them, add the
> variables under `listener.environment` in `docker-compose.yml`.

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

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `postgres` | PostgreSQL hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `tg_archiver` | Database name |
| `POSTGRES_USER` | `archiver` | Database user |
| `POSTGRES_PASSWORD` | `change_me_in_production` | Database password (**must change**) |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_PROVIDER` | `jwt` | `jwt` for local auth, `none` to disable (code default without compose: `none`) |
| `JWT_SECRET_KEY` | `change_me_in_production` | Secret for JWT signing (**must change**) |
| `JWT_ADMIN_EMAIL` | `admin@tg-archiver.local` | Admin email (the admin username is `admin`; either works for login) |
| `JWT_ADMIN_PASSWORD` | `change_me_in_production` | Admin login password (**must change**) |
| `JWT_EXPIRATION_MINUTES` | `60` | Token expiration time |

### Storage (SeaweedFS, S3-compatible)

The `MINIO_*` variable names are kept for compatibility; they configure the
SeaweedFS S3 gateway and the services that talk to it. Anonymous clients get
read-only access to the media bucket (served by Caddy at `/media/*`); writes,
deletes and listings require the access key.

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIO_ENDPOINT` | `seaweedfs:8333` | S3 endpoint (set by docker-compose) |
| `MINIO_ACCESS_KEY` | `minioadmin` | S3 access key |
| `MINIO_SECRET_KEY` | `minioadmin` | S3 secret key (**change in production**) |
| `MINIO_BUCKET` | `tg-archive-media` | Bucket for media files. Caddy hardcodes `/tg-archive-media` and the listener doesn't receive this variable, so keep the default |
| `MINIO_PUBLIC_URL` | `http://localhost:9000` | Browser-reachable S3 base URL, used for RSS enclosures and the media-redirect fallback. The default is a MinIO leftover that nothing listens on; set it to a reachable S3 endpoint (e.g. `http://localhost:8333` with the port published) if you need those links |

### Translation

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSLATION_ENABLED` | `false` (`.env.example` sets `true`) | Enable auto-translation (also sets the frontend's `NEXT_PUBLIC_TRANSLATION_ENABLED`) |
| `DEEPL_API_KEY` | - | Currently ignored: the processor creates the translator without a key, so only Google Translate is used |

### Backfill

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_ENABLED` | `false` (`.env.example` sets `true`) | Enable historical message backfill |
| `BACKFILL_START_DATE` | `2024-01-01` | How far back to fetch |
| `BACKFILL_MODE` | `manual` (`.env.example` sets `on_discovery`) | `manual` or `on_discovery` (`scheduled` is not implemented) |
| `BACKFILL_BATCH_SIZE` | `100` | Messages per batch |
| `BACKFILL_DELAY_MS` | `1000` | Delay between batches (rate limiting) |

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
│   ├── postgres/       # init.sql + migrations/ (applied manually)
│   └── seaweedfs/      # entrypoint.sh (renders S3 identities from MINIO_* vars)
├── scripts/
│   ├── telegram_auth.py              # Telegram authentication script
│   └── backfill_discovered_channels.sql
├── docs/plans/         # Design notes
├── sessions/           # Telegram session files (gitignored)
├── docker-compose.yml
├── .env.example
└── .env               # Your configuration (gitignored)
```

### Running Services Locally

Uncomment the `ports:` of postgres, redis and seaweedfs in `docker-compose.yml` first.

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

Python services have no automated tests yet.

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

`ENVIRONMENT`, `CSRF_ENABLED` and `TOKEN_BLACKLIST_FAIL_MODE` are **not** passed to the API
container by default, so it runs with `ENVIRONMENT=development` (no `Secure` cookie flag),
CSRF on and `TOKEN_BLACKLIST_FAIL_MODE=open`. For production, add them to `api.environment`
in `docker-compose.yml`:

```yaml
  api:
    environment:
      - ENVIRONMENT=production
      - CSRF_ENABLED=true
      - TOKEN_BLACKLIST_FAIL_MODE=closed
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
| **Rate Limiting** | 5 login attempts per minute | Built-in |
| **CSRF Protection** | Double-submit cookie pattern (`csrf_token` cookie is readable by JS by design) | On by default |
| **Token Invalidation** | `POST /api/auth/logout` blacklists JWT tokens (the web UI's logout doesn't call it yet) | Built-in |
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

- **Schema drift on a fresh database:** the `top_forwarded_messages` view used by the social-graph
  virality endpoint is not defined in any SQL file, and `export_jobs` in `init.sql` is missing
  columns the model uses (`label`, `format`, `profile`, …). Exports and top-forwarded views fail
  until the schema is fixed.
- **CSRF in some pages:** `profile/api-keys`, `profile/feeds`, `settings/feed-tokens` and
  `suggest-channel` call `fetch` directly without the `X-CSRF-Token` header, so their
  state-changing actions are rejected. `suggest-channel` also posts to `/api/channel-submissions`,
  which has no API route.
- **Health check path:** the API image's built-in healthcheck and Caddy's `/health` route point at
  `/health`; the real endpoint is `/api/health` (compose overrides the container healthcheck).
- **Media URLs from the API:** the `media_url` field in API responses and RSS enclosures use
  `MINIO_PUBLIC_URL` (see Storage); the web UI builds its own `/media/...` URLs and is unaffected.
  OpenGraph images use a `/minio-storage/...` path that has no Caddy route.
- **Trailing-slash redirects** (e.g. `/api/channels` → `/api/channels/`) drop non-default ports,
  which only matters when serving on a port other than 80/443.
- **React hydration warnings (#418)** appear in the browser console on the home and message pages.

---

## License

AGPL-3.0 License - See [LICENSE](LICENSE) file for details.
