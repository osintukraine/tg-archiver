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

Python services run on Python 3.14.

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

Only Caddy is published (`http://localhost`, port 80). Ports for frontend (3000), API (8000), SeaweedFS (8333), Postgres and Redis are commented out in `docker-compose.yml`. For local development, `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d` publishes Postgres on `127.0.0.1:5432` (used by the read-only Postgres MCP, see Database Queries).

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
3. `processor/src/redis_consumer.py` consumes with consumer group `processor-workers` (realtime first; also drains the legacy `telegram:messages` stream). A failed message is left pending and redelivered by XAUTOCLAIM after `PROCESSOR_RETRY_IDLE_MS` (default 5 min); after 3 deliveries it goes to `telegram:messages:dlq` with its full payload (admin API: `/api/admin/dlq` list/replay/delete). Persistence is idempotent (`ON CONFLICT DO NOTHING` on `(channel_id, message_id)`), so redelivery is safe
4. `processor/src/message_processor.py`: channel info → routing → entity extraction → language detection → media → DB persist; forwards also upsert `discovered_channels` / `message_forwards`
5. `shared/python/media_archiver.py` uploads media to S3 (SeaweedFS) with SHA-256 deduplication
6. Translation is out of the ingest path: the processor only detects the language and stores `messages.translation_status` (`pending` or `skipped`). The background `processor/src/translation_worker.py` claims `pending` rows (newest first) and translates with DeepL (daily cap `TRANSLATION_DAILY_CHAR_LIMIT`, default 500000, counted in Redis; 0 = no cap), then falls back to Google with backoff. Statuses: `pending`, `done`, `skipped` (also rows older than `TRANSLATION_MAX_AGE_HOURS`), `failed` (after `TRANSLATION_MAX_ATTEMPTS`). Columns added by migration 007

### Channel Discovery
- `listener/src/channel_discovery.py` reads Telegram folders via `GetDialogFiltersRequest`
- Folder name must match `FOLDER_ARCHIVE_ALL_PATTERN` exactly (case-insensitive). `.env.example` sets `tg-archiver`; if unset, code and compose default to `Archive`
- Syncs to the database every 5 minutes (hardcoded in `listener/src/main.py`, not configurable)
- Forwarded broadcast-channel posts record their source in `discovered_channels` (processor `_track_forward_chain`). `listener/src/channel_join_worker.py` joins them according to `CHANNEL_JOIN_MODE`: `approval` (default; only rows with `join_approved_at` set via `POST /api/admin/discovered/{id}/approve`), `auto`, or `off`. Daily cap, FloodWait and channel-limit pauses apply in every mode

### API Structure
- Routers in `services/api/src/routers/` (e.g. messages, channels, rss, social_graph, auth, media, channel_submissions, admin/*; full list in `services/api/src/main.py`)
- Public `POST /api/channel-submissions` (suggest-a-channel form) is CSRF-protected, limited to 3/min per IP, and verifies Cloudflare Turnstile when `TURNSTILE_SECRET_KEY` is set; admins list submissions at `GET /api/admin/channel-submissions`
- Schemas in `services/api/src/schemas.py` (Pydantic models)
- Auth middleware in `services/api/src/middleware/auth_unified.py`
- Dependencies: `CurrentUser`, `AuthenticatedUser`, `AdminUser` from `services/api/src/dependencies/`
- Health: `/api/health` (also `/health`). API docs at `http://localhost/docs` (role-filtered; FastAPI's built-in docs are disabled)
- JWTs are accepted only from the `Authorization: Bearer` header (and the `access_token` cookie used by /docs), never from query parameters
- Logout: the frontend `logout()` fires `POST /api/auth/logout` (Bearer + CSRF) without awaiting it, then clears local state. The API blacklists the JWT in Redis (`jwt:blacklist:<sha256[:32]>`, TTL = remaining lifetime) and `AuthMiddleware` rejects blacklisted tokens with 401 (Redis outage behaviour per `TOKEN_BLACKLIST_FAIL_MODE`)
- Media URLs come from `services/api/src/utils/minio_client.py:get_media_url` → `<origin>/media/<key>` (Caddy serves `/media/*` from SeaweedFS); feed and album URLs use the request's origin, falling back to `PUBLIC_BASE_URL`. Presigned URLs were removed (the bucket is public-read behind Caddy)

### Admin config (`platform_config`)
- The admin Configuration page edits `platform_config` rows. Services read them through `shared/python/config/platform_config.py:get_override(key)` (60 s in-process cache, so an edit applies within about a minute, no restart; errors fall back to env/default)
- Precedence: a row overrides `.env`/defaults ONLY when `last_modified_at IS NOT NULL` (an admin saved it); seeded rows never override anything
- Applied keys (`APPLIED_KEYS` in `services/api/src/routers/admin/config.py`, returned as `applied` per item): `processing.translation_enabled` (false pauses the translation worker; queued rows stay pending), `telegram.folder_sync_interval`, `storage.media_enabled`, `storage.max_file_size_mb` (skips larger downloads), `feed.default_limit`, `feed.max_limit`. The other keys are stored but not applied, and the page labels them "not applied". To wire a key, call `get_override` where it is used and add it to `APPLIED_KEYS`
- Deliberately not configurable from the UI: Telegram session name and "allow all CORS origins" (removed by migration 008)

### Frontend Structure
- App Router pages in `services/frontend/app/`
- Reusable components in `services/frontend/components/`
- API client in `services/frontend/lib/api.ts` (relative URLs when `NEXT_PUBLIC_API_URL` is empty; server-side rendering uses `API_URL`, default `http://api:8000`)
- Admin API client in `services/frontend/lib/admin-api.ts` (includes JWT and CSRF token)
- Types in `services/frontend/lib/types.ts`
- `NEXT_PUBLIC_*` values are baked in at build time; rebuild the frontend image after changing them

### Database
- Base schema in `infrastructure/postgres/init.sql` (runs only on an empty `postgres18_data` volume) plus ordered, idempotent `infrastructure/postgres/migrations/NNN_*.sql`
- The one-shot `db-migrate` compose service (`infrastructure/postgres/migrate.sh`) applies pending migrations on every `docker-compose up`, before listener/processor/api start; each file runs in one transaction with its `schema_migrations` record, and any error stops startup
- To change the schema, add the next numbered migration; never edit an applied one (checksums are recorded but not verified). Migrations must be idempotent, and new ones must not contain their own `BEGIN`/`COMMIT` (the runner wraps each file)
- SQLAlchemy models in `shared/python/models/`
- Key tables: `messages`, `channels`, `media_files`, `message_media` (junction), `users`
- Full-text search via PostgreSQL tsvector on `messages.search_vector` (content + translation), built with the `russian` config (migration 009): Cyrillic words get Russian stemming, Latin words English stemming, so inflected forms match. The API queries with the same config (`SEARCH_CONFIG` in `routers/messages.py`); change both together. No Ukrainian stemmer exists in Postgres; stopwords are not searchable
- `top_forwarded_messages`, `channel_interactions` and `channel_influence_network` are plain views over `messages` (migration 005)
- `infrastructure/postgres/tests/test_schema_drift.py` compares every ORM model with the live schema

## Environment Configuration

Key variables in `.env` (see `.env.example` for full list):
- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`: From my.telegram.org
- `FOLDER_ARCHIVE_ALL_PATTERN`: Telegram folder name to monitor (see Channel Discovery)
- `POSTGRES_*`: Database connection
- `MINIO_*`: Object storage (names kept from MinIO; they configure SeaweedFS and its clients). `MINIO_BUCKET` sets the bucket; Caddy hardcodes `/tg-archive-media`, so keep the default
- `JWT_SECRET_KEY`, `JWT_ADMIN_EMAIL`, `JWT_ADMIN_PASSWORD`: Auth config
- `NEXT_PUBLIC_API_URL`: Empty for the proxied setup, `http://localhost:8000` for direct access
- `PUBLIC_BASE_URL`: public site origin (default `http://localhost`); passed to the api and baked into the frontend as `NEXT_PUBLIC_BASE_URL` (rebuild after changing). Used for absolute media URLs in feeds and OpenGraph tags. `MINIO_PUBLIC_URL` is optional (empty = Caddy `/media/...` URLs)

**`docker-compose.yml` has no `env_file`.** A container only sees the variables listed under its `environment:` block; a new setting must be added there to take effect. Passed through today: `LOG_LEVEL`/`LOG_FORMAT` (python services), `CHANNEL_JOIN_*`, `SOCIAL_FETCH_*`, `GAP_*`, `BACKFILL_*` (listener), `TRANSLATION_*`, `DEEPL_*`, `GOOGLE_*` (processor; the api gets a subset), `PROCESSOR_RETRY_IDLE_MS` (processor), and for the api `PLATFORM_NAME`, `API_CORS_ORIGINS`, `TRUSTED_PROXY_HOSTS`, `AUTH_REQUIRED`, `FEED_AUTH_REQUIRED`, `PUBLIC_BASE_URL`, `ENVIRONMENT` (`production` enables `Secure` cookies), `CSRF_ENABLED`, `TOKEN_BLACKLIST_FAIL_MODE`, `TURNSTILE_SECRET_KEY`. Postgres, Redis and SeaweedFS hostnames and ports are fixed in compose, not `.env` settings. To check a `.env` for dead or unpassed names (prints names only, never values): `python scripts/env_audit.py --env-file .env --strict` (needs PyYAML).

**Secrets are required, never defaulted.** `POSTGRES_PASSWORD`, `MINIO_SECRET_KEY`, `JWT_SECRET_KEY` and `JWT_ADMIN_PASSWORD` use `${VAR:?...}` in compose (it refuses to start without them), and each Python service calls `config.secrets_check.require_secrets()` at startup, refusing the `.env.example` placeholders and a JWT key under 32 characters (messages name variables, never values). Don't reintroduce `:-default` for a secret. Renamed settings (`SECRET_KEY`, `MINIO_BUCKET_NAME`, `GAP_LOOKBACK_HOURS`) are listed in `RENAMED` in `scripts/env_audit.py`, which reports them with their replacement; add an entry whenever a setting is renamed.

## Session Files

Telegram session stored in `sessions/listener.session`. Created by `scripts/telegram_auth.py`. If missing, listener will fail to start. The `sessions/` directory must be writable by the containers (processor runs as uid 1001 and writes its own session copy).

## Testing Notes

Frontend tests use Vitest with React Testing Library (`**/*.test.{ts,tsx}`). Run a single test:
```bash
cd services/frontend
bun run test:run components/__tests__/ErrorBoundary.test.tsx
```

Python tests (pytest) live in `services/processor/tests`, `services/listener/tests` and `services/api/tests`. They run inside the service Docker images against a real Redis 8 / Postgres 18 (not fakes); see README → Development for the exact commands. Don't create a shared `services/api/tests/conftest.py`: each API test file keeps its own fixtures.

Database: `infrastructure/postgres/tests/test_migrate.sh` (migration runner, needs Docker) and `infrastructure/postgres/tests/test_schema_drift.py` (model vs schema, set `DRIFT_DB_URL`).

Browser testing: the UI shows an 18+ content-warning modal on public archive pages (`/`, `/messages`, `/channels`, `/search`, …) until accepted, and it blocks clicks. `/admin`, `/auth`, `/about` and `/suggest-channel` are exempt (`EXEMPT_ROUTES` in `lib/content-warning-config.ts`). On gated pages, accept it first (tick the checkbox, then "Enter Site"), or pre-seed `localStorage['tg-archiver-content-warning-consent'] = JSON.stringify({accepted: true, expiresAt: Date.now() + 30*86400000})` and reload. Consent lasts 30 days and is per origin.

### Lint / CI
- CI (`.github/workflows/ci.yml`) runs on pushes to main/develop and on PRs: `lint` (ruff, `env_audit.py --env-file .env.example --strict`, gitleaks), `python-tests` (applies `init.sql` + the `db-migrate` runner, runs the migration runner test, then the processor, listener and API suites), `frontend` (lint, type-check, vitest) and `docker-build` of all four services
- `ruff check .` must pass (config and documented baseline of ignored rules in `pyproject.toml`; the ignores are burn-down items, don't add new ones without a reason)
- gitleaks runs in CI and pre-commit (`.pre-commit-config.yaml`); allowlist false positives narrowly in `.gitleaks.toml`

## Critical Instructions for Claude Code

### CSRF Protection (MANDATORY)

**All API interactions involving authentication or state changes MUST account for CSRF protection.**

- CSRF is on by default (`CSRF_ENABLED=true`); rejections return 403 JSON
- State-changing requests (POST, PUT, PATCH, DELETE) require the `X-CSRF-Token` header; login and `/api/auth/info` are exempt
- The token is read from the `csrf_token` cookie set by the API (not HttpOnly, by design)
- Frontend clients (`lib/api.ts`, `lib/admin-api.ts`) handle this automatically. Code that calls `fetch` directly must use `getAuthHeaders()` from `lib/auth-utils.ts`, which adds both `Authorization` and `X-CSRF-Token`
- Middleware must return a response (e.g. `JSONResponse(status_code=403, …)`), never raise `HTTPException`: inside `BaseHTTPMiddleware` that becomes a 500 and resets the proxy connection
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

**Never guess table or column names. Inspect the live schema before writing any query.**

Prefer the `postgres` MCP server (`.mcp.json`; read-only role `claude_readonly`, restricted mode): use `list_objects` / `get_object_details` first. One-time setup per dev machine (the user does this, with an alphanumeric password):
```bash
export CLAUDE_READONLY_PASSWORD='...'
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres
scripts/create_readonly_db_role.sh
# then start Claude Code from the same shell (needs uv for uvx)
```

Without the MCP, list the schema with psql first:
```bash
docker-compose exec postgres psql -U archiver -d tg_archiver -c "\dt"
docker-compose exec postgres psql -U archiver -d tg_archiver -c "\d table_name"
```

Schema changes go through numbered migration files, never ad-hoc DDL.

### API Testing (MANDATORY)

**Never read `.env` or other secret files** (see Secrets). To authenticate as admin:

1. Get a token by logging in from inside the api container, which already holds `JWT_ADMIN_PASSWORD`:
   ```bash
   # The api container already has JWT_ADMIN_PASSWORD; log in from inside it so the
   # password never appears in your context. Use the username `admin`.
   TOKEN=$(docker-compose exec -T api python -c "import os, httpx; print(httpx.post('http://localhost:8000/api/auth/login', json={'username': 'admin', 'password': os.environ['JWT_ADMIN_PASSWORD']}).json()['access_token'])")
   ```

2. Never print or echo the password. If the login response shape changes, read `services/api/src/routers/auth.py` (`TokenResponse`) instead of guessing.

3. Use the token for authenticated requests:
   ```bash
   docker-compose exec api curl -s http://localhost:8000/api/admin/endpoint \
     -H "Authorization: Bearer <TOKEN>"
   ```

**NEVER guess or hallucinate:**
- Usernames or passwords
- Database table names or column names
- API endpoint paths

Always read from the schema or source code first.

### Secrets (MANDATORY)

- `.env*` (except `.env.example`), `sessions/` and `*.session` (Telethon sessions are full Telegram account credentials), `*.pem`, `*.key` are denied to Claude in `.claude/settings.json` (`permissions.deny`). `.claudeignore` is **not** a Claude Code feature and would do nothing
- Deny rules cover Claude's file tools and Bash commands that name the file (`cat`, `head`, `sed`, redirections), not `grep -r`, scripts or subprocesses: don't work around them
- Don't run `docker compose config`, `env` or `printenv`; they print resolved secrets
