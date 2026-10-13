#!/bin/sh
# Apply pending SQL migrations (migrations/NNN_*.sql) in version order.
#
# A migration is pending when its version (the NNN prefix) is not in
# schema_migrations. Each file runs in one transaction together with the
# bookkeeping INSERT; any error aborts with a non-zero exit. Migrations must
# be idempotent (existing deployments may have applied them by hand).
#
# Connection comes from the standard PG* env vars (PGHOST, PGUSER, PGPASSWORD,
# PGDATABASE). MIGRATIONS_DIR overrides the default directory.
set -eu

DIR="${MIGRATIONS_DIR:-/migrations}"
export PGOPTIONS="-c client_min_messages=warning"
PSQL="psql -X -q -v ON_ERROR_STOP=1"

i=0
until pg_isready -q; do
    i=$((i + 1))
    [ "$i" -le 60 ] || { echo "migrate: postgres not ready after 60s" >&2; exit 1; }
    sleep 1
done

# init.sql creates this on a fresh volume; keep the runner self-sufficient anyway.
$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(50) PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum VARCHAR(64),
    applied_by VARCHAR(100) DEFAULT current_user)"

applied=0
for file in "$DIR"/[0-9]*.sql; do
    [ -e "$file" ] || continue
    name=$(basename "$file" .sql)
    version=${name%%_*}
    case "$version" in *[!0-9]*) echo "migrate: bad file name $name" >&2; exit 1 ;; esac

    seen=$($PSQL -At -c "SELECT 1 FROM schema_migrations WHERE version = '$version'")
    if [ -n "$seen" ]; then
        echo "migrate: $name already applied"
        continue
    fi

    echo "migrate: applying $name"
    sum=$(sha256sum "$file" | cut -d' ' -f1)
    desc=$(echo "${name#*_}" | tr '_' ' ')
    {
        # the runner owns the transaction; drop the files' own BEGIN/COMMIT
        grep -vxE '[[:space:]]*(BEGIN|COMMIT);[[:space:]]*' "$file" || true
        printf "\n;\nINSERT INTO schema_migrations (version, description, checksum) VALUES ('%s', '%s', '%s') ON CONFLICT (version) DO NOTHING;\n" \
            "$version" "$desc" "$sum"
    } | $PSQL --single-transaction -f -
    applied=$((applied + 1))
done

echo "migrate: done ($applied applied)"
