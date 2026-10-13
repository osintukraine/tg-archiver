"""Compare every SQLAlchemy model with the live schema (init.sql + migrations).

Self-contained. Needs a migrated Postgres reachable via DRIFT_DB_URL
(e.g. postgresql://archiver:pw@localhost:5432/tg_archiver) and sqlalchemy,
psycopg2, pydantic-settings. Run: python test_schema_drift.py  (or pytest).
"""
import os
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "shared" / "python"))

# shared Settings requires these at import time; values are irrelevant here
for _k in ("POSTGRES_PASSWORD", "REDIS_PASSWORD", "MINIO_ENDPOINT",
           "MINIO_ACCESS_KEY", "MINIO_SECRET_KEY", "JWT_SECRET_KEY"):
    os.environ.setdefault(_k, "x")

DB_URL = os.environ.get("DRIFT_DB_URL")
# Relations the API reads with raw SQL (not covered by ORM models).
REQUIRED_RELATIONS = ["top_forwarded_messages"]
# ORM models that no service imports or queries via the ORM (the services only
# run raw SQL against these tables, which a separate check validates). Their
# models are stale relative to init.sql; not worth migrating the DB to match.
UNUSED_MODEL_TABLES = {
    "channel_submissions", "storage_boxes", "tag_stats",
    "message_quarantine", "message_comments",
}
# Harmless width/precision differences, "table.column".
IGNORED = {"message_tags.confidence"}  # REAL in DB, NUMERIC(3,2) in model

ALIASES = {
    "character varying": "varchar", "timestamp with time zone": "timestamptz",
    # models use naive DateTime, DB is tz-aware: treated as equal
    "timestamp without time zone": "timestamptz", "double precision": "float8",
    "integer": "int4", "bigint": "int8", "smallint": "int2", "boolean": "bool",
}


def norm(t: str) -> str:
    t = re.sub(r"\s+", " ", t.lower().strip())
    base = re.match(r"[a-z ]+", t).group(0).strip()
    rest = t[len(base):].replace(" ", "")
    keep_len = base in ("varchar", "character varying", "numeric")
    return ALIASES.get(base, base) + (rest if keep_len else "")


def model_columns():
    from sqlalchemy.dialects import postgresql
    from models.base import Base
    import models  # noqa: F401  registers all tables
    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            yield table.name, col.name, norm(col.type.compile(postgresql.dialect())), col.nullable


@pytest.mark.skipif(not DB_URL, reason="DRIFT_DB_URL not set")
def test_models_match_schema():
    import psycopg2
    cur = psycopg2.connect(DB_URL).cursor()
    cur.execute("""
        SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p') AND a.attnum > 0 AND NOT a.attisdropped
    """)
    live = {(t, c): (norm(ty), nl) for t, c, ty, nl in cur.fetchall()}
    tables = {t for t, _ in live}
    problems = []
    for t, c, ty, nullable in model_columns():
        key = f"{t}.{c}"
        if key in IGNORED or t in UNUSED_MODEL_TABLES:
            continue
        if t not in tables:
            problems.append(f"{key}: table missing")
        elif (t, c) not in live:
            problems.append(f"{key}: column missing")
        else:
            lty, lnull = live[(t, c)]
            if lty != ty:
                problems.append(f"{key}: type model={ty} db={lty}")
            if not lnull and nullable:
                problems.append(f"{key}: db NOT NULL but model nullable")
    cur.execute("""
        SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND relkind IN ('r','v','m')""")
    rels = {r[0] for r in cur.fetchall()}
    problems += [f"relation {r}: missing" for r in REQUIRED_RELATIONS if r not in rels]
    assert not problems, "schema drift:\n" + "\n".join(problems)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-q"]))
