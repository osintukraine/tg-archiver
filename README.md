# tg-archiver

**Self-hosted Telegram channel archiver with web interface.**

A standalone fork of the [OSINT Intelligence Platform](https://github.com/your-org/osint-intelligence-platform), stripped of all AI/ML dependencies for simple, efficient Telegram archiving.

## Features

- **Telegram Monitoring**: Archive messages from public and private channels via folder-based management
- **Multi-Media Support**: Full album support - photos, videos, documents with SHA-256 deduplication
- **Translation**: Optional DeepL translation for non-English content
- **Web Interface**: Browse, search, and export archived messages
- **Social Graph**: Track forwards, replies, and author attribution
- **Full-Text Search**: PostgreSQL-powered tsvector search
- **RSS Feeds**: Subscribe to channels via RSS/Atom/JSON feeds
- **Self-Hosted**: Complete data sovereignty - no cloud dependencies

## What's Different from the Full Platform

This is a surgical extraction focused on archiving without AI:

| Feature | tg-archiver | Full Platform |
|---------|-------------|---------------|
| Telegram archiving | ✅ | ✅ |
| Media deduplication | ✅ | ✅ |
| Full-text search | ✅ | ✅ |
| Social graph | ✅ | ✅ |
| Translation | ✅ | ✅ |
| Semantic search | ❌ | ✅ |
| AI classification | ❌ | ✅ |
| Event detection | ❌ | ✅ |
| Entity matching | ❌ | ✅ |
| Map visualization | ❌ | ✅ |

**No Ollama, no embeddings, no vector databases required.**

## Quick Start

### 1. Prerequisites

- Docker and Docker Compose
- Telegram API credentials from [my.telegram.org](https://my.telegram.org/apps)

### 2. Configure

```bash
cp .env.example .env
# Edit .env with your Telegram API credentials
```

### 3. Start Services

```bash
docker-compose up -d
```

### 4. Authenticate Telegram

First-time setup requires Telegram authentication:

```bash
# Attach to listener container for phone code entry
docker-compose logs -f listener
```

### 5. Access

- **Frontend**: http://localhost:3000
- **API**: http://localhost:8000
- **MinIO Console**: http://localhost:9001 (minioadmin/minioadmin)

## Architecture

```
Telegram → Listener → Redis → Processor → PostgreSQL/MinIO → API → Frontend
```

| Service | Purpose |
|---------|---------|
| **Listener** | Connects to Telegram, monitors folder-based channels |
| **Processor** | Extracts entities, archives media, persists to DB |
| **API** | FastAPI REST API with full-text search |
| **Frontend** | Next.js web interface |
| **PostgreSQL** | Message storage with tsvector full-text search |
| **Redis** | Message queue (Redis Streams) |
| **MinIO** | S3-compatible media storage |

## Channel Management

Channels are managed via Telegram folders (not a custom admin panel):

1. Create folders in Telegram: `Archive-UA`, `Archive-RU`, etc.
2. Drag channels into these folders
3. tg-archiver auto-detects and starts monitoring

**Folder naming conventions:**
- `Archive-*` → Archive all messages (after spam filter)
- `Monitor-*` → Selective archiving (currently same as Archive)
- Other folders → Ignored

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_API_ID` | Telegram API ID | Required |
| `TELEGRAM_API_HASH` | Telegram API Hash | Required |
| `POSTGRES_PASSWORD` | Database password | `change_me_in_production` |
| `TRANSLATION_ENABLED` | Enable DeepL translation | `false` |
| `DEEPL_API_KEY` | DeepL API key (free tier works) | Optional |

## Development

### Directory Structure

```
tg-archiver/
├── services/
│   ├── listener/      # Telegram monitoring
│   ├── processor/     # Message processing
│   ├── api/           # FastAPI backend
│   └── frontend/      # Next.js frontend
├── shared/python/     # Shared Python modules
├── infrastructure/
│   └── postgres/      # Database schema
├── docker-compose.yml
└── .env.example
```

### Running Locally

```bash
# Start infrastructure only
docker-compose up -d postgres redis minio

# Run services locally
cd services/listener && pip install -r requirements.txt && python -m src.main
```

## Credits

Extracted from the OSINT Intelligence Platform - a comprehensive system for archiving, enriching, and analyzing Telegram content with AI-powered classification and event detection.

## License

MIT License - See LICENSE file for details.
