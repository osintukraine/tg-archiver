# Production backups: design and plan

Status: **design** (2026-10-23). Nothing is built yet.

Audience: organisations running tg-archiver in production. Backups are an **opt-in** feature: off unless an operator configures them. They are never used on development stacks.

## Decisions (maintainer, 2026-10-23)
- Postgres: **continuous WAL archiving + base backups** (point-in-time recovery). An OSINT archive's value is posts that channels later delete; anything newer than the last backup is gone for good, so a nightly dump is not enough.
- Destinations: **S3-compatible** (AWS, Backblaze B2, Hetzner Object Storage, MinIO, …) and **SFTP / SSHFS** (e.g. Hetzner Storage Box).
- Written for **other organisations**: setup guide, restore runbook, safe defaults, tested restores.

## What is backed up

| Part | Tool | How | Data loss window |
|---|---|---|---|
| Postgres (messages, channels, translations, users, audit, config) | **pgBackRest** | WAL archived continuously (`archive_command`), weekly full + daily incremental base backups | ≈ `archive_timeout` (default 60 s) |
| Media in SeaweedFS (bucket `tg-archive-media`) | **rclone** with a `crypt` remote | scheduled `rclone copy` (append-only) from SeaweedFS's S3 API | up to the copy interval (default 1 h); anything newer still has its original on Telegram |
| Secrets: `.env`, `sessions/*.session`, backup passphrases | **not backed up** | The operator keeps them in a password manager / vault. The docs say so explicitly | – |
| Code and config | git | – | – |

### Why these tools (research, 2026-10-23)
- **pgBackRest** (Alpine 3.24 package `2.58.0`, released 2026-01-19): Postgres 18 supported since 2.55.0; repo types `s3` and `sftp` built in (SFTP needs no remote shell, fits Hetzner Storage Box); `posix` repo for an SSHFS mount; AES-256 encryption; full/diff/incremental backups; retention; `check`, `info --output=json`; async archive-push; parallelism.
- **wal-g was rejected**: no tagged release tested against Postgres 18 (CI coverage added after v3.0.9), no Alpine/musl build, libsodium encryption needs a cgo build.
- **rclone** v1.75.1 (2026-09-04): reads the bucket through S3 directly (no FUSE); `crypt` encrypts contents and file names; works with S3 and SFTP targets. Media keys are content-addressed (`media/xx/yy/<sha256>.ext`) and written once (`media_buffer.py` `fput_object`), so an append-only `copy` is incremental.
- **restic was rejected** for media: it backs up files, not buckets; reading the bucket would need an rclone FUSE mount (privileged container) and a full scan each run.
- **SeaweedFS `filer.backup`** was rejected: no SFTP sink and no client-side encryption.

## Architecture

```
postgres  (image: tg-archiver/postgres = postgres:18.6-alpine + pgbackrest 2.58.0)
  archive_mode / archive_command driven by env (off by default)
  ── archive-push (async, spool) ──────────────► repo (S3 | SFTP | posix/SSHFS), AES-256
backup    (profile "backup"; same image; shares PGDATA + socket volumes; runs as postgres)
  supercronic schedule:
    weekly  pgbackrest backup --type=full
    daily   pgbackrest backup --type=incr
    hourly  rclone copy seaweed:tg-archive-media  crypt:media   (append-only)
    daily   pgbackrest check ; rclone check --one-way (sample)
  /metrics :9187 → last full/incr backup time, archive status, last media copy, errors
prometheus (profile "monitoring") scrapes backup:9187; alert rules below
```

- **Opt-in switch**: `BACKUP_ENABLED=false` by default. When false, Postgres runs exactly as today (`archive_mode=off`) and the `backup` service is not started (profile).
- **Postgres image**: the repo builds its own Postgres image (`infrastructure/postgres/Dockerfile`, pinned `postgres:18.6-alpine` + `pgbackrest=2.58.0-r0`). It is used with or without backups, so enabling backups later only changes settings plus one Postgres restart (`archive_mode` needs a restart).
- **Archive config via env**: compose passes `-c archive_mode=${PG_ARCHIVE_MODE:-off}` and `-c archive_command=…`. With archiving off nothing changes. `archive_timeout=60`.
- **Secrets at startup**: the backup container refuses to start with missing or placeholder passphrases (same pattern as `config.secrets_check.require_secrets`). It can't use compose `${VAR:?}`: compose evaluates the whole file even when a profile is off.

## Configuration (operator-facing, `.env`)

| Variable | Purpose |
|---|---|
| `BACKUP_ENABLED` | `true` to archive WAL and run the backup service (also start with `--profile backup`) |
| `BACKUP_REPO_TYPE` | `s3` \| `sftp` \| `posix` (posix = a mounted path, e.g. SSHFS) |
| `BACKUP_REPO_PATH` | path inside the repo, e.g. `/tg-archiver/<deployment-name>` (one per deployment and per Postgres major version) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_KEY`, `BACKUP_S3_SECRET`, `BACKUP_S3_URI_STYLE` (`path` default) | S3-compatible repo |
| `BACKUP_SFTP_HOST`, `BACKUP_SFTP_PORT`, `BACKUP_SFTP_USER`, `BACKUP_SFTP_KEY_FILE`, `BACKUP_SFTP_KNOWN_HOSTS` | SFTP repo (host key checking on by default) |
| `BACKUP_PG_CIPHER_PASS` | pgBackRest AES-256 passphrase (**losing it makes backups unrecoverable**) |
| `BACKUP_MEDIA_ENABLED` | default `true` |
| `BACKUP_MEDIA_CRYPT_PASS`, `BACKUP_MEDIA_CRYPT_SALT` | rclone crypt secrets (**same warning**) |
| `BACKUP_RETENTION_FULL` | full backups kept (default 4 → about 4 weeks of point-in-time recovery) |
| `BACKUP_SCHEDULE_FULL`, `_INCR`, `_MEDIA` | cron expressions (defaults: Sun 02:00, daily 02:00, hourly) |

The media copy reuses the same destination settings, in a sibling path (`…/media`).

## Monitoring and alerts (needs the monitoring profile)

| Alert | Condition | Why |
|---|---|---|
| WALArchiveFailing | archive failures increased in 15 m | a failing `archive_command` makes Postgres keep all WAL, so the disk fills |
| WALArchiveStale | last archived WAL older than `archive_timeout` + 10 m | archiving silently stopped |
| BaseBackupStale | no successful full/incr in 26 h | schedule broken |
| MediaBackupStale | no successful media copy in 3 h | |
| PgWalDirLarge | `pg_wal` size above a threshold | early warning before the disk fills |

The `backup` container exports these itself (`pg_stat_archiver` queried on scrape plus `pgbackrest info` and the last rclone run), so no extra `postgres_exporter` container is needed.

## Restore (runbook outline; the full runbook goes in the docs)
1. **Full disaster** (new host): install tg-archiver at the same version, restore `.env` and the session from the vault, `docker compose run --rm backup restore-db [--target-time "…"]` (pgBackRest restore into an empty `postgres_data` volume; writes `recovery.signal` + `restore_command`, replays WAL to the target, promotes), then `restore-media` (`rclone copy crypt:media seaweed:tg-archive-media`), then start the stack.
2. **Point in time** (e.g. an accidental admin delete): same, with `--target-time`.
3. **Media only**: `restore-media`.
4. After a restore: run `backup verify` (counts, sample media fetch) and start a new full backup.
5. **Major Postgres upgrade**: new `BACKUP_REPO_PATH` (or `stanza-upgrade`); never mix clusters in one stanza.

## Proof that restores work
- **CI job** (`backup-e2e`, on PRs touching backup files and weekly): throwaway stack plus a MinIO container (S3) and an `atmoz/sftp`-style container (SFTP). Seed data → full backup → more writes → note the time → more writes → point-in-time restore into a fresh volume → assert row counts at the target, and that the media restore matches checksums. Both repo types.
- **`restore-drill` command** for operators: restore the latest backup into a throwaway project on the same host, report counts, tear it down. The docs recommend running it monthly.

## Gotchas handled by the design
- A failing archive fills the disk → alerts plus a documented emergency procedure (fix the repo, or temporarily set `archive_mode=off` and restart, accepting the gap).
- The first enable needs one Postgres restart (documented; the backup service checks `archive_mode=on` and refuses to run backups otherwise).
- Postgres 18 enables data checksums by default; pgBackRest verifies pages during backup. Corruption is reported, not hidden.
- Encryption passphrases are single points of loss → setup guide step "store these off-host" plus a `backup show-config` command that prints which secrets must be escrowed (names only).
- One stanza per cluster and major version.
- With `MEDIA_RETENTION_DAYS`, the backup keeps media that retention deleted (append-only). Intended: the backup is the archive of record.

## Build phases
1. **Postgres image + WAL archiving + base backups** (pgBackRest, S3 and SFTP and posix), the backup service with schedule and secret checks, docs for setup. CI e2e for the database (S3 + SFTP).
2. **Media backup** (rclone crypt), restore-media, CI e2e for media.
3. **Metrics + alerts** (`/metrics` in the backup service, rules + promtool tests).
4. **Restore runbook + `restore-drill`**, final docs pass (setup guide per destination: AWS S3, Backblaze B2, Hetzner Object Storage, Hetzner Storage Box over SFTP, SSHFS mount).

Each phase is one PR, with CI green and the e2e passing, before the next.

## Open questions
1. Defaults: full weekly + incremental daily, keep 4 full backups (≈ 4 weeks of point-in-time recovery), media copy hourly. OK?
2. Should the media backup prune anything (e.g. objects deleted by retention older than N days), or stay append-only forever (recommended for an archive)?
3. pgBackRest supports a second repository (e.g. S3 **and** SFTP at once, the 3-2-1 rule). Support `repo2` in phase 1, or later?
