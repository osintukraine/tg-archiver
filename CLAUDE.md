# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

tg-archiver is a self-hosted Telegram channel archiver. It monitors Telegram folders, archives messages and media, provides full-text search, and generates RSS feeds. No AI/ML dependencies.

## Architecture

```
Telegram Folders → Listener → Redis Streams → Processor → PostgreSQL/MinIO
                                                              ↓
                                            Frontend ← API (FastAPI)
```

**Services** (all in `services/`):
- **listener**: Telethon-based Telegram client, monitors folders via `GetDialogFiltersRequest`, publishes to Redis Streams
- **processor**: Consumes from Redis, downloads media to MinIO, persists to PostgreSQL
- **api**: FastAPI REST API with JWT auth, full-text search, RSS generation
- **frontend**: Next.js 14 with App Router, Tailwind CSS, shadcn/ui components

**Shared code** (`shared/python/`):
- `models/`: SQLAlchemy ORM models (Message, Channel, MediaFile, etc.)
- `database/`: Async session management
- `config/`: Settings via pydantic-settings
- `observability/`: Structured logging for Loki

## Build & Run Commands

```bash
# Full platform (Docker)
docker-compose build                    # Build all images
docker-compose up -d                    # Start all services
docker-compose logs -f listener         # Watch specific service

# Infrastructure only (for local dev)
docker-compose up -d postgres redis minio minio-init

# Frontend development
cd services/frontend
npm install
npm run dev                             # Dev server at :3000
npm run build                           # Production build
npm run lint                            # ESLint
npm run type-check                      # TypeScript check
npm run test                            # Vitest

# Python services (local)
cd services/listener  # or processor, api
pip install -r requirements.txt
POSTGRES_HOST=localhost python -m src.main

# Telegram authentication (required before first run)
pip install telethon python-dotenv
python3 scripts/telegram_auth.py
```

## Key Patterns

### Message Flow
1. `listener/src/telegram_listener.py` receives Telegram events
2. Serializes to JSON, publishes to Redis Stream `telegram:messages`
3. `processor/src/redis_consumer.py` consumes in consumer group
4. `processor/src/message_processor.py` orchestrates: entity extraction → media download → DB persist
5. `processor/src/media_archiver.py` downloads to MinIO with SHA-256 deduplication

### Channel Discovery
- `listener/src/channel_discovery.py` reads Telegram folders via `GetDialogFiltersRequest`
- Matches folder names against `FOLDER_ARCHIVE_ALL_PATTERN` env var (default: `tg-archiver`)
- Syncs discovered channels to database every 5 minutes

### API Structure
- Routers in `services/api/src/routers/` (messages, channels, rss, social_graph, admin/*)
- Schemas in `services/api/src/schemas.py` (Pydantic models)
- Auth middleware in `services/api/src/middleware/auth_unified.py`
- Dependencies: `CurrentUser`, `AuthenticatedUser`, `AdminUser` from `services/api/src/dependencies/`

### Frontend Structure
- App Router pages in `services/frontend/app/`
- Reusable components in `services/frontend/components/`
- API client in `services/frontend/lib/api.ts` (uses relative URLs when `NEXT_PUBLIC_API_URL` is empty)
- Admin API client in `services/frontend/lib/admin-api.ts` (includes JWT token)
- Types in `services/frontend/lib/types.ts`

### Database
- Schema in `infrastructure/postgres/init.sql`
- SQLAlchemy models in `shared/python/models/`
- Key tables: `messages`, `channels`, `media_files`, `message_media` (junction), `users`
- Full-text search via PostgreSQL tsvector on `messages.search_vector`

## Environment Configuration

Key variables in `.env` (see `.env.example` for full list):
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`: From my.telegram.org
- `FOLDER_ARCHIVE_ALL_PATTERN`: Telegram folder name to monitor (default: `tg-archiver`)
- `POSTGRES_*`: Database connection
- `MINIO_*`: Object storage
- `JWT_SECRET_KEY`, `JWT_ADMIN_EMAIL`, `JWT_ADMIN_PASSWORD`: Auth config
- `NEXT_PUBLIC_API_URL`: Empty for proxied setup, `http://localhost:8000` for direct

## Session Files

Telegram session stored in `sessions/listener.session`. Created by `scripts/telegram_auth.py`. If missing, listener will fail to start.

## Testing Notes

Frontend tests use Vitest with React Testing Library. Run single test:
```bash
cd services/frontend
npm run test -- components/__tests__/PostCard.test.tsx
```

Python services don't have comprehensive test coverage yet. Manual testing via Docker logs.
