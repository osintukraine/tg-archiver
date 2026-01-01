# Listener Service

Real-time Telegram channel monitoring - the entry point for all message ingestion.

## Quick Start (localhost)

```bash
# Prerequisites - start dependencies
docker-compose up -d postgres redis

# Run locally
cd services/listener
pip install -r requirements.txt

# Required: Telegram credentials
export TELEGRAM_API_ID=your_api_id      # from https://my.telegram.org
export TELEGRAM_API_HASH=your_api_hash
export TELEGRAM_PHONE=+1234567890

export POSTGRES_HOST=localhost
export REDIS_URL=redis://localhost:6379/0

# Run (will prompt for Telegram auth code on first run)
python src/main.py
```

## Essential Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_API_ID` | Yes | From my.telegram.org |
| `TELEGRAM_API_HASH` | Yes | From my.telegram.org |
| `TELEGRAM_PHONE` | Yes | Phone number with country code |
| `REDIS_URL` | Yes | Redis connection string |
| `POSTGRES_HOST` | Yes | Database host |
| `CHANNEL_SYNC_INTERVAL` | No | Folder sync interval (default: 300s) |
| `BACKFILL_ENABLED` | No | Enable historical fetch (default: false) |

## Key Files

| File | Purpose |
|------|---------|
| `src/main.py` | Entry point, initialization |
| `src/telegram_listener.py` | Message event handlers |
| `src/channel_discovery.py` | Folder-based channel sync |
| `src/backfill_service.py` | Historical message fetch |
| `src/redis_queue.py` | Redis Streams client |

## Common Local Issues

### "Session not authorized"
First-time run requires interactive auth. Run without `-d` to see prompts:
```bash
docker-compose up listener  # Follow prompts for code
```

### "No channels discovered"
Create Telegram folders named `Archive*` or `Monitor*` and add channels to them.
The listener discovers channels from your folder structure.

### "Flood wait error"
Telegram rate limiting - handled automatically. Reduce `BACKFILL_BATCH_SIZE` if frequent.

## Metrics

Prometheus metrics on port `8001`:
```bash
curl http://localhost:8001/metrics
```

## Full Documentation

See [Platform Docs: Listener Service](https://docs.osintukraine.com/developer-guide/services/listener) for:
- Complete architecture and data flow
- Session management rules (CRITICAL)
- Folder naming conventions
- Backfill configuration
- Troubleshooting guide
