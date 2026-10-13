#!/usr/bin/env bash
# Create/refresh the read-only Postgres role used by the Claude Code Postgres MCP (.mcp.json).
# Idempotent. Password comes from CLAUDE_READONLY_PASSWORD (never hardcoded).
#
#   export CLAUDE_READONLY_PASSWORD='...'   # choose any strong value
#   scripts/create_readonly_db_role.sh
#
# Runs psql inside the compose postgres container by default. Override with PSQL_CMD, e.g.
#   PSQL_CMD="psql -h 127.0.0.1 -U archiver -d tg_archiver" scripts/create_readonly_db_role.sh
set -euo pipefail

: "${CLAUDE_READONLY_PASSWORD:?set CLAUDE_READONLY_PASSWORD}"
PSQL_CMD="${PSQL_CMD:-docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\"'}"

# Password goes to psql as a variable on stdin (not argv) and is quoted with :'pw'.
escaped_pw="$(printf %s "$CLAUDE_READONLY_PASSWORD" | sed "s/'/''/g")"

{
  printf "\\\\set pw '%s'\n" "$escaped_pw"
  cat <<'SQL'
SELECT 'CREATE ROLE claude_readonly LOGIN'
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'claude_readonly') \gexec
ALTER ROLE claude_readonly WITH LOGIN PASSWORD :'pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE claude_readonly SET default_transaction_read_only = on;
SELECT format('GRANT CONNECT ON DATABASE %I TO claude_readonly', current_database()) \gexec
GRANT USAGE ON SCHEMA public TO claude_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO claude_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO claude_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO claude_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON SEQUENCES TO claude_readonly;
SQL
} | eval "$PSQL_CMD"
echo "claude_readonly ready."
