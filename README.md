# tg-archiver

**Self-hosted Telegram channel archiver with web interface.**

Archive messages from Telegram channels with media storage, translation support, full-text search, and RSS feed generation.

## Features

- **Real-time Archiving**: Monitor channels via Telegram folders - add channels by drag-and-drop
- **Media Storage**: Photos, videos, documents with SHA-256 deduplication
- **Translation**: Auto-translate non-English content (Google Translate free tier, optional DeepL)
- **Full-Text Search**: PostgreSQL tsvector-powered search across content and translations
- **RSS Feeds**: Generate RSS/Atom/JSON feeds for archived channels
- **Social Graph**: Track forwards, replies, comments, and engagement metrics
- **Spam Filtering**: Built-in spam detection keeps archives clean
- **Backfill**: Automatically fetch historical messages when adding new channels
- **Self-Hosted**: Complete data sovereignty - your data stays on your infrastructure

## Architecture

```
┌─────────────┐     ┌─────────┐     ┌───────────┐     ┌──────────┐
│  Telegram   │────▶│ Listener │────▶│   Redis   │────▶│ Processor │
│   Folders   │     │ Service  │     │  Streams  │     │  Service  │
└─────────────┘     └─────────┘     └───────────┘     └──────────┘
                                                            │
                    ┌─────────┐     ┌───────────┐           │
                    │ Frontend │◀───│    API    │◀──────────┤
                    │ Next.js  │    │  FastAPI  │           │
                    └─────────┘     └───────────┘           ▼
                                                    ┌──────────────┐
                                                    │  PostgreSQL  │
                                                    │    MinIO     │
                                                    └──────────────┘
```

| Service | Purpose |
|---------|---------|
| **Listener** | Connects to Telegram, monitors folder-based channels |
| **Processor** | Processes messages, downloads media, stores to DB |
| **API** | FastAPI REST API with search, RSS, and admin endpoints |
| **Frontend** | Next.js web interface for browsing and search |
| **PostgreSQL** | Message storage with full-text search |
| **Redis** | Message queue using Redis Streams |
| **MinIO** | S3-compatible media storage |

---

## Quick Start

### Prerequisites

- **Docker** and **Docker Compose** (v2.0+)
- **Python 3.11+** (for initial Telegram authentication only)
- **Telegram API credentials** from [my.telegram.org/apps](https://my.telegram.org/apps)

### Step 1: Clone and Configure

```bash
git clone https://github.com/yourusername/tg-archiver.git
cd tg-archiver

# Copy example environment file
cp .env.example .env
```

Edit `.env` with your Telegram credentials:

```bash
# Required - get from https://my.telegram.org/apps
TELEGRAM_API_ID=your_api_id_here
TELEGRAM_API_HASH=your_api_hash_here

# Change these in production!
POSTGRES_PASSWORD=your_secure_password
JWT_SECRET_KEY=generate_a_64_char_secret_key
JWT_ADMIN_PASSWORD=your_admin_password
```

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
3. Name it exactly: `tg-archiver` (or match your `FOLDER_ARCHIVE_ALL_PATTERN` in `.env`)
4. Add channels you want to archive to this folder

### Step 4: Start the Platform

```bash
# Start all services
docker-compose up -d

# Watch logs to verify startup
docker-compose logs -f
```

### Step 5: Access the Interface

| Service | URL | Credentials |
|---------|-----|-------------|
| **Frontend** | http://localhost:3000 | JWT_ADMIN_EMAIL / JWT_ADMIN_PASSWORD |
| **API Docs** | http://localhost:8000/docs | - |
| **MinIO Console** | http://localhost:9001 | MINIO_ACCESS_KEY / MINIO_SECRET_KEY |

---

## Channel Management

tg-archiver uses **Telegram's native folder feature** for channel management - no admin panel needed!

### Adding Channels

1. Find a channel in Telegram
2. Long-press (mobile) or right-click (desktop) → **Add to Folder**
3. Select your `tg-archiver` folder
4. Done! The listener detects changes within 5 minutes

### Removing Channels

1. Remove the channel from your `tg-archiver` folder
2. The listener stops monitoring (existing messages remain archived)

### Folder Naming

The default folder name is `tg-archiver`. You can customize it in `.env`:

```bash
FOLDER_ARCHIVE_ALL_PATTERN=my-archive
```

**Note:** Telegram folder names are limited to 12 characters.

---

## Configuration Reference

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
| `POSTGRES_PASSWORD` | - | Database password (**change in production**) |

### Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_PROVIDER` | `jwt` | `jwt` for local auth, `none` to disable |
| `JWT_SECRET_KEY` | - | Secret for JWT signing (**change in production**) |
| `JWT_ADMIN_EMAIL` | `admin@tg-archiver.local` | Admin login email |
| `JWT_ADMIN_PASSWORD` | - | Admin login password |
| `JWT_EXPIRATION_MINUTES` | `60` | Token expiration time |

### Storage (MinIO)

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIO_ENDPOINT` | `minio:9000` | MinIO server address |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `minioadmin` | MinIO secret key (**change in production**) |
| `MINIO_BUCKET_NAME` | `tg-archive-media` | Bucket for media files |

### Translation

| Variable | Default | Description |
|----------|---------|-------------|
| `TRANSLATION_ENABLED` | `true` | Enable auto-translation |
| `DEEPL_API_KEY` | - | DeepL API key (uses Google Translate if not set) |

### Backfill

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKFILL_ENABLED` | `true` | Enable historical message backfill |
| `BACKFILL_START_DATE` | `2024-01-01` | How far back to fetch |
| `BACKFILL_MODE` | `on_discovery` | `manual`, `on_discovery`, or `scheduled` |
| `BACKFILL_BATCH_SIZE` | `100` | Messages per batch |
| `BACKFILL_DELAY_MS` | `1000` | Delay between batches (rate limiting) |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `` (empty) | API URL for browser requests. Empty = relative URLs (use when behind proxy) |

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
│   └── postgres/       # Database schema (init.sql)
├── scripts/
│   └── telegram_auth.py  # Telegram authentication script
├── sessions/           # Telegram session files (gitignored)
├── docker-compose.yml
├── .env.example
└── .env               # Your configuration (gitignored)
```

### Running Services Locally

```bash
# Start infrastructure only
docker-compose up -d postgres redis minio minio-init

# Install Python dependencies
cd services/listener
pip install -r requirements.txt

# Run listener locally (for debugging)
POSTGRES_HOST=localhost python -m src.main
```

### Running Frontend Locally

```bash
cd services/frontend
npm install
npm run dev
```

---

## License

MIT License - See [LICENSE](LICENSE) file for details.
