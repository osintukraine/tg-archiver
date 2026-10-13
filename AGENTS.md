# AGENTS.md

Guidance for non-Claude coding agents (Codex, Cursor, etc.). `CLAUDE.md` is the source of truth for conventions; this file only points to it.

## Project

tg-archiver: self-hosted Telegram channel archiver. Services in `services/` (listener, processor, api, frontend), shared Python in `shared/python/`, schema in `infrastructure/postgres/init.sql` + `migrations/`. Everything runs in Docker Compose. Architecture and key patterns: see `CLAUDE.md` ("Architecture", "Key Patterns").

## Never read, print, or commit

- `.env` and any `.env.*` (only `.env.example` is safe)
- `sessions/` and `*.session` (Telethon sessions are full Telegram account credentials)
- `*.pem`, `*.key`
- Output of `docker compose config` / `env` / `printenv` (they expand secrets)

Use `.env.example` for variable names. Do not guess credentials, table names, or endpoints; read the schema and source.

## Conventions (see CLAUDE.md)

- Build/run via Docker only; recreate with `--force-recreate` ("Building Services").
- State-changing API calls need CSRF handling ("CSRF Protection").
- Check the DB schema before writing queries ("Database Queries").

## Tests and checks

See `README.md` -> "Development". Frontend (from `services/frontend`): `bun run lint`, `bun run type-check`, `bun run test:run`. Python: `ruff check`.

## Live schema (optional)

`.mcp.json` registers a read-only Postgres MCP (role `claude_readonly`). Setup: `docker-compose.dev.yml` + `scripts/create_readonly_db_role.sh`.
