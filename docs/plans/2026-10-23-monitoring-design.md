# Monitoring: design and plan

Status: **plan only** (2026-10-23). Nothing here is built yet.

## Why

The services already export Prometheus metrics, and the api already contains Prometheus-backed endpoints, but nothing collects the metrics. Problems (listener gone quiet, DLQ growing, media errors, DeepL cap) are only visible by reading logs. Most of the existing scaffolding was ported from the OSINT platform and does not match this project.

## What exists today (inventory, 2026-10-23)

**Exporters**
- listener: `:8001/metrics`, health on `:8002/health` (503 after 600 s without messages; not a compose healthcheck)
- processor: `:8002/metrics`
- api: `/metrics` (not exposed through Caddy: 404, correct)
- Because `shared/python/observability/__init__.py` imports `.metrics`, every service registers the whole `tg_*` set; most series are empty outside the processor.

**Metrics that are live and useful**

| Signal | Metric |
|---|---|
| Ingest freshness | `telegram_last_message_timestamp` (listener), `tg_message_last_archived_timestamp` (processor) |
| Throughput | `telegram_messages_received_total`, `tg_messages_processed_total`, `tg_messages_archived_total` |
| Queue | `tg_queue_messages_pending{consumer_group}` (XPENDING = delivered, not yet acked) |
| Telegram health | `telegram_flood_waits_total`, `telegram_messages_failed_total`, `telegram_connections_active` |
| Media | `tg_media_archived_total`, `tg_media_errors_total{error_type}`, `tg_media_download_duration_seconds` |
| Translation | `tg_translation_operations_total`, `tg_translation_errors_total`, `tg_translation_deepl_chars_today` |
| Backfill | `backfill_messages_total`, `backfill_status`, `backfill_duration_seconds` |
| API | `api_requests_total{method,endpoint,status}`, `api_request_duration_seconds` |

**Problems found**
1. ~40 metrics are defined but never updated (rule engine, LLM/classifier, search/RSS, `tg_database_connections_active`, `tg_queue_depth_*`, `tg_queue_consumer_lag_seconds`, discovery, listener `translations_*`, `redis_queue_*`). They expose 0 or nothing.
2. `tg_processing_duration_seconds` is observed twice per message (`message_processor.py:294` and `record_message_processed`).
3. `tg_pipeline_active` is set to 1 and never reset.
4. No backlog or DLQ gauge: `redis_consumer.get_queue_depths()` and `DeadLetterQueue.get_dlq_count()` exist but are not exported.
5. `db_pool_*` gauges (`utils/db_metrics.py`) are never started, so never exposed.
6. `/api/metrics/{overview,pipeline,services}`: no auth dependency; query `tg:*` recording rules that don't exist and OSINT names (`enrichment_*`, LLM, `ollama`); `get_scalar` takes the first series of unsummed queries; `up == 0` maps to "unknown", never "down". No frontend page calls them.
7. The admin dashboard banner ("Pipeline Active · msg/s · archived/s · Queue · Services", `app/admin/page.tsx:86-104`) expects fields that `/api/admin/stats/overview` never returns: dead UI.
8. `/api/system/health` checks the Redis stream `telegram_messages` (underscore; real streams are `telegram:messages:realtime|backfill` + legacy), so the processor always reads "unknown"; `/api/system/pipeline` checks only the legacy stream.
9. `PROMETHEUS_URL` is not a Settings field and not passed by compose (falls back to `http://prometheus:9090`).

## Design

### Phase 0: make the metrics true (code only, no new services)
- Fix the double observation (2) and `tg_pipeline_active` (3): set from freshness, or drop it in favour of the timestamp gauges.
- Export backlog and DLQ: `tg_queue_depth{stream}` from `get_queue_depths()` and `tg_dlq_messages` from `xlen`, in the processor's existing 10 s updater.
- Start the `db_pool_*` monitor in the api, or remove it.
- Fix the stream names in `/api/system/health` and `/api/system/pipeline` (8).
- `/api/metrics/*`: require `AdminUser`; rewrite the queries to metrics that exist (sum the series, `sum by (le)` for quantiles); drop the LLM / enrichment / ollama / grafana parts; map `up == 0` to "down".
- Dead metrics (1): **list and ask before removing**. Some may be planned work (see the 2026-10-14 lesson: a grep proves "unused", not "unwanted").
- Add `PROMETHEUS_URL` to Settings and compose (api).
- Tests: unit tests for the new gauges and the rewritten query builders (fake Prometheus client).

### Phase 1: Prometheus as an optional compose profile
- `docker compose --profile monitoring up -d`; without the flag nothing changes.
- `prom/prometheus` (pinned), config in `infrastructure/prometheus/`:
  - scrape jobs `listener` (`listener:8001`), `processor` (`processor:8002`), `api` (`api:8000/metrics`), interval 15 s
  - retention 15 d (`PROMETHEUS_RETENTION`, documented in `.env.example`)
  - port bound to `127.0.0.1:9090` only (no Caddy route)
- Recording rules for the throughput the app shows (`tg:messages_processed:rate5m = sum(rate(tg_messages_processed_total[5m]))`, …), so the api queries stay cheap.
- Alert rules (shown in the Prometheus UI; no notifications yet):

| Alert | Expression (sketch) | For |
|---|---|---|
| ListenerQuiet | `time() - telegram_last_message_timestamp > 900` | 5m |
| ArchiveStalled | `time() - tg_message_last_archived_timestamp > 900` | 5m |
| DLQGrowing | `increase(tg_dlq_messages[30m]) > 0` | 0m |
| QueueBacklog | `sum(tg_queue_depth) > 500` | 10m |
| TargetDown | `up == 0` | 2m |
| FloodWaits | `increase(telegram_flood_waits_total[1h]) > 5` | 0m |
| MediaErrors | `rate(tg_media_errors_total[15m]) > 0.1` | 15m |
| DeepLNearCap | `tg_translation_deepl_chars_today > 0.9 * <cap>` | 0m |

- Admin dashboard banner (7): fill it from `/api/metrics/overview`, or remove it. Decide in phase 1.

### Phase 2 (optional): Grafana, exporters, notifications
- Grafana (pinned) in the same profile, provisioned datasource and one tg-archiver dashboard; bound to `127.0.0.1`; admin password required with no placeholder default (CLAUDE.md secrets rule). Note that `${VAR:?}` is evaluated for the whole compose file even when the profile is off, so use a file secret or an override file instead.
- `postgres_exporter` / `redis_exporter` only if a concrete alert needs them.
- Alertmanager (or Grafana alerting) once there is a channel to notify (e-mail, Telegram bot, …).

## Security notes
- Metrics stay internal: no Caddy route to `/metrics`, Prometheus or Grafana; host ports on `127.0.0.1` only.
- `/api/metrics/*` becomes admin-only (today it is public through Caddy).

## Open questions for the maintainer
1. Remove the ~40 never-updated metrics, or keep some as planned work?
2. Admin dashboard banner: revive it (phase 1) or remove it?
3. Grafana and notifications: wanted, and where should alerts go?

## Rough effort
Phase 0: one PR, about a day of agent work with tests. Phase 1: one PR (compose profile, configs, rules, docs). Phase 2: separate, on request.
