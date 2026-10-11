# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

tg-archiver is a self-hosted Telegram channel archiver. It monitors Telegram folders, archives messages and media, provides full-text search, and generates RSS feeds. No AI/ML dependencies.

## Architecture

```
Telegram Folders → Listener → Redis Streams → Processor → PostgreSQL + SeaweedFS (S3)
                                                                   ↑
                     Browser → Caddy :80 → Frontend (Next.js) / API (FastAPI)
                                       └→ /media/* → SeaweedFS (anonymous read)
```

**Services** (all in `services/`, run via `docker-compose.yml`):
- **listener**: Telethon client; discovers channels via Telegram folders (`GetDialogFiltersRequest`), publishes messages to Redis Streams
- **processor**: consumes Redis Streams, translates, downloads media to S3, persists to PostgreSQL. Uses its own Telegram session (copies `sessions/listener.session` to `sessions/processor-<hostname>.session`)
- **api**: FastAPI REST API with JWT auth, full-text search, RSS/Atom/JSON feeds, admin endpoints
- **frontend**: Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript 6; built and run with **Bun** (`bun.lock`, `oven/bun` image). Small shadcn-style primitives in `components/ui/`
- **Infrastructure images**: PostgreSQL 18.6, Redis 8, SeaweedFS 4.48 (S3 gateway on :8333; replaced MinIO, whose images were discontinued), Caddy 2

Python services run on Python 3.13.

**Shared code** (`shared/python/`, on `PYTHONPATH` in every Python image):
- `models/`: SQLAlchemy ORM models; `AsyncSessionLocal` lives in `models/base.py`
- `config/settings.py`: pydantic-settings
- `observability/`: JSON logging + Prometheus metrics
- `media_archiver.py`: S3 upload with SHA-256 deduplication (used by listener and processor)
- `translation/`, `hashing/`, `audit/`, `telegram/`
- `database/` and `translation.py` are currently unused

## Build & Run Commands

```bash
# Full platform (Docker)
docker-compose build                    # Build all images
docker-compose up -d                    # Start all services
docker-compose logs -f listener         # Watch specific service

# Infrastructure only
docker-compose up -d postgres redis seaweedfs

# Frontend (Bun)
cd services/frontend
bun install
bun run dev                             # Dev server at :3000
bun run build                           # Production build
bun run lint                            # ESLint 10, flat config in eslint.config.mjs
bun run type-check                      # tsc --noEmit
bun run test                            # Vitest, watch mode
bun run test:run                        # Vitest, single run

# Telegram authentication (required before first run)
pip install telethon python-dotenv
python3 scripts/telegram_auth.py
```

Only Caddy is published (`http://localhost`, port 80). Ports for frontend (3000), API (8000), SeaweedFS (8333), Postgres and Redis are commented out in `docker-compose.yml`; uncomment them for direct access.

Running a Python service outside Docker needs the shared code on the path and the required settings set (no defaults: `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `JWT_SECRET_KEY`):
```bash
cd services/listener   # or processor
pip install -r ../../shared/python/requirements.txt -r requirements.txt
PYTHONPATH=../../shared/python POSTGRES_HOST=localhost MINIO_ENDPOINT=localhost:8333 ... python -m src.main
# api: PYTHONPATH=../../shared/python ... uvicorn src.main:app
```

## Key Patterns

### Message Flow
1. `listener/src/telegram_listener.py` receives Telegram events
2. `listener/src/redis_queue.py` publishes to `telegram:messages:realtime` (live) or `telegram:messages:backfill` (historical)
3. `processor/src/redis_consumer.py` consumes with consumer group `processor-workers` (realtime first; also drains the legacy `telegram:messages` stream). Failures go to `telegram:messages:dlq`
4. `processor/src/message_processor.py`: channel info → routing → entity extraction → translation → media → DB persist; forwards also upsert `discovered_channels` / `message_forwards`
5. `shared/python/media_archiver.py` uploads media to S3 (SeaweedFS) with SHA-256 deduplication

### Channel Discovery
- `listener/src/channel_discovery.py` reads Telegram folders via `GetDialogFiltersRequest`
- Folder name must match `FOLDER_ARCHIVE_ALL_PATTERN` exactly (case-insensitive). `.env.example` sets `tg-archiver`; if unset, code and compose default to `Archive`
- Syncs to the database every 5 minutes (hardcoded, `listener/src/main.py`; `FOLDER_SYNC_INTERVAL` is not read)

### API Structure
- Routers in `services/api/src/routers/` (e.g. messages, channels, rss, social_graph, auth, media, admin/*; full list in `services/api/src/main.py`)
- Schemas in `services/api/src/schemas.py` (Pydantic models)
- Auth middleware in `services/api/src/middleware/auth_unified.py`
- Dependencies: `CurrentUser`, `AuthenticatedUser`, `AdminUser` from `services/api/src/dependencies/`
- Health: `/api/health`. API docs at `http://localhost/docs` (role-filtered; FastAPI's built-in docs are disabled)

### Frontend Structure
- App Router pages in `services/frontend/app/`
- Reusable components in `services/frontend/components/`
- API client in `services/frontend/lib/api.ts` (relative URLs when `NEXT_PUBLIC_API_URL` is empty; server-side rendering uses `API_URL`, default `http://api:8000`)
- Admin API client in `services/frontend/lib/admin-api.ts` (includes JWT and CSRF token)
- Types in `services/frontend/lib/types.ts`
- `NEXT_PUBLIC_*` values are baked in at build time; rebuild the frontend image after changing them

### Database
- Schema in `infrastructure/postgres/init.sql`, which only runs on an empty `postgres18_data` volume
- Migrations in `infrastructure/postgres/migrations/` are **not** applied automatically (no Alembic). Apply them manually on a fresh database:
  ```bash
  docker-compose exec -T postgres psql -U archiver -d tg_archiver < infrastructure/postgres/migrations/003_discovered_channels.sql
  ```
- SQLAlchemy models in `shared/python/models/`
- Key tables: `messages`, `channels`, `media_files`, `message_media` (junction), `users`
- Full-text search via PostgreSQL tsvector on `messages.search_vector`
- Known schema drift: the `top_forwarded_messages` view (used by `social_graph.py`) is not defined in any SQL file, and `export_jobs` in `init.sql` lacks columns the model uses (`label`, `format`, `profile`, …), so export and top-forwarded endpoints fail on a fresh database

## Environment Configuration

Key variables in `.env` (see `.env.example` for full list):
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`: From my.telegram.org
- `FOLDER_ARCHIVE_ALL_PATTERN`: Telegram folder name to monitor (see Channel Discovery)
- `POSTGRES_*`: Database connection
- `MINIO_*`: Object storage (names kept from MinIO; they configure SeaweedFS and its clients). `MINIO_BUCKET` sets the bucket; Caddy hardcodes `/tg-archive-media`, so keep the default
- `JWT_SECRET_KEY`, `JWT_ADMIN_EMAIL`, `JWT_ADMIN_PASSWORD`: Auth config (compose defaults to `change_me_in_production`; always set them)
- `NEXT_PUBLIC_API_URL`: Empty for the proxied setup, `http://localhost:8000` for direct access

**`docker-compose.yml` has no `env_file`.** A container only sees the variables listed under its `environment:` block. Setting e.g. `SOCIAL_FETCH_*`, `CHANNEL_JOIN_*`, `CSRF_ENABLED`, `ENVIRONMENT` or `TOKEN_BLACKLIST_FAIL_MODE` in `.env` has no effect until you add them to the relevant service.

## Session Files

Telegram session stored in `sessions/listener.session`. Created by `scripts/telegram_auth.py`. If missing, listener will fail to start. The `sessions/` directory must be writable by the containers (processor runs as uid 1001 and writes its own session copy).

## Testing Notes

Frontend tests use Vitest with React Testing Library (`**/*.test.{ts,tsx}`). Run a single test:
```bash
cd services/frontend
bun run test:run components/__tests__/ErrorBoundary.test.tsx
```

Python services have no automated tests. Test manually via Docker logs.

## Critical Instructions for Claude Code

### CSRF Protection (MANDATORY)

**All API interactions involving authentication or state changes MUST account for CSRF protection.**

- CSRF is always on in Docker: the code default is `true` and compose does not pass `CSRF_ENABLED`, so the `.env` value (`.env.example` says `false`) is ignored
- State-changing requests (POST, PUT, PATCH, DELETE) require the `X-CSRF-Token` header; login and `/api/auth/info` are exempt
- The token is read from the `csrf_token` cookie set by the API (not HttpOnly, by design)
- Frontend clients (`lib/api.ts`, `lib/admin-api.ts`) handle this automatically. Pages that call `fetch` directly (`app/profile/api-keys`, `app/profile/feeds`, `app/settings/feed-tokens`, `app/suggest-channel`) do **not** send the header yet
- When adding new API endpoints or frontend API calls, always include CSRF token handling

### Building Services (MANDATORY)

**Always use Docker to build frontend and backend components.**

```bash
# Build specific service
docker-compose build api
docker-compose build frontend

# Rebuild and restart (force recreate to pick up new image)
docker-compose build api && docker-compose up -d --force-recreate api
docker-compose build frontend && docker-compose up -d --force-recreate frontend
```

**IMPORTANT:** Always use `--force-recreate` when restarting after a build. Without it, Docker may reuse the old container and ignore the new image.

Never run `bun run build` or Python directly for production testing. Always use Docker containers.

### Database Queries (MANDATORY)

**Before running ANY psql command, ALWAYS list the database schema first.**

```bash
# List all tables
docker-compose exec postgres psql -U archiver -d tg_archiver -c "\dt"

# Describe a specific table
docker-compose exec postgres psql -U archiver -d tg_archiver -c "\d table_name"
```

**NEVER guess table names or column names.** Always verify schema before querying.

### API Testing (MANDATORY)

**When testing API endpoints, use JWT authentication with credentials from `.env`.**

1. Read credentials from `.env`:
   ```bash
   grep -E "^JWT_ADMIN" .env
   ```

2. Use the `username` field for login (the admin user is `admin`; the email address is also accepted):
   ```bash
   # Get token - use "admin" as username, password from JWT_ADMIN_PASSWORD
   docker-compose exec api curl -s -X POST http://localhost:8000/api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"<PASSWORD_FROM_ENV>"}'
   ```

3. Use token for authenticated requests:
   ```bash
   docker-compose exec api curl -s http://localhost:8000/api/admin/endpoint \
     -H "Authorization: Bearer <TOKEN>"
   ```

**NEVER guess or hallucinate:**
- Usernames or passwords
- Database table names or column names
- API endpoint paths

Always read from `.env`, schema, or source code first.
