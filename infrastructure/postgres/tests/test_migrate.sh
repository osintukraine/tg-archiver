#!/bin/sh
# Runs migrate.sh against throwaway Postgres 18 containers and checks:
#   a) fresh DB (init.sql only)          -> every migration gets applied
#   b) "existing deployment" (init.sql + 003 applied by hand) -> only 004/005 (+002) run
#   c) second run                        -> nothing re-applied, exit 0
#   d) a broken migration                -> non-zero exit, nothing recorded, rolled back
# Needs docker. Usage: infrastructure/postgres/tests/test_migrate.sh
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=postgres:18.6-alpine
NET=tgmigtest-net
PG=tgmigtest-pg
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
    docker rm -fv "$PG" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

start_pg() {
    docker rm -fv "$PG" >/dev/null 2>&1 || true
    docker run -d --name "$PG" --network "$NET" -e POSTGRES_PASSWORD=pw -e POSTGRES_USER=archiver \
        -e POSTGRES_DB=tg_archiver -v "$HERE/init.sql:/docker-entrypoint-initdb.d/init.sql:ro" \
        "$IMAGE" >/dev/null
    # initdb restarts the server once; wait for the real one
    until docker exec "$PG" sh -c 'test -f /tmp/.up || { psql -U archiver -d tg_archiver -Atc "select 1 from schema_migrations limit 1" >/dev/null 2>&1 && touch /tmp/.up; }' 2>/dev/null; do sleep 1; done
}
psql_pg() { docker exec "$PG" psql -U archiver -d tg_archiver -Atq "$@"; }
migrate() { # $1 = migrations dir on host
    docker run --rm --network "$NET" -e PGHOST="$PG" -e PGUSER=archiver -e PGPASSWORD=pw \
        -e PGDATABASE=tg_archiver -v "$HERE/migrate.sh:/migrate.sh:ro" -v "$1:/migrations:ro" \
        --entrypoint /bin/sh "$IMAGE" /migrate.sh
}
versions() { psql_pg -c "select string_agg(version, ',' order by version) from schema_migrations"; }

# Expected bookkeeping after a full run: init.sql records 000, plus one version
# per migrations/NNN_*.sql file (derived, so new migrations don't break the test)
ALL_VERSIONS="000$(for f in "$HERE"/migrations/[0-9]*.sql; do printf ',%s' "$(basename "$f" | cut -d_ -f1)"; done)"

docker network create "$NET" >/dev/null

echo "== a) fresh volume"
start_pg
out=$(migrate "$HERE/migrations")
echo "$out"
[ "$(versions)" = "$ALL_VERSIONS" ] || fail "a) versions: $(versions)"
[ "$(psql_pg -c "select count(*) from information_schema.columns where table_name='export_jobs' and column_name='label'")" = 1 ] || fail "a) export_jobs not migrated"
[ "$(psql_pg -c "select to_regclass('top_forwarded_messages') is not null")" = t ] || fail "a) top_forwarded_messages missing"

echo "== c) re-run is a no-op"
out=$(migrate "$HERE/migrations")
echo "$out"
echo "$out" | grep -q "done (0 applied)" || fail "c) re-applied something"
[ "$(versions)" = "$ALL_VERSIONS" ] || fail "c) versions changed"

echo "== b) existing deployment: init.sql + 003 by hand"
start_pg
docker exec -i "$PG" psql -U archiver -d tg_archiver -q -v ON_ERROR_STOP=1 < "$HERE/migrations/003_discovered_channels.sql" >/dev/null 2>&1
out=$(migrate "$HERE/migrations")
echo "$out"
echo "$out" | grep -q "003_discovered_channels already applied" || fail "b) 003 re-applied"
echo "$out" | grep -q "applying 004" || fail "b) 004 not applied"
echo "$out" | grep -q "applying 005" || fail "b) 005 not applied"
[ "$(versions)" = "$ALL_VERSIONS" ] || fail "b) versions: $(versions)"

echo "== d) failing migration rolls back and exits non-zero"
bad=$(mktemp -d)
cp "$HERE"/migrations/*.sql "$bad"/
# version 999 can't collide with a real migration
printf 'CREATE TABLE tgmigtest_half (id int);\nSELECT * FROM does_not_exist;\n' > "$bad/999_broken.sql"
chmod -R a+rX "$bad"
if migrate "$bad" >/dev/null 2>&1; then rm -rf "$bad"; fail "d) expected non-zero exit"; fi
rm -rf "$bad"
[ "$(versions)" = "$ALL_VERSIONS" ] || fail "d) broken version recorded"
[ "$(psql_pg -c "select to_regclass('tgmigtest_half') is null")" = t ] || fail "d) partial DDL left behind"

echo "PASS"
