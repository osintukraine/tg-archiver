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

## How It Works

### Channel Discovery
The listener discovers channels to monitor from your Telegram folder structure:

1. Scans all your Telegram folders every `CHANNEL_SYNC_INTERVAL` seconds (default: 300s)
2. Identifies folders matching the naming patterns: `Archive-*` or `Monitor-*`
3. Registers all channels within these folders in the database
4. Starts monitoring for new messages in real-time

### Message Processing
When a new message arrives:

1. Telegram client receives the message event
2. Message is serialized to JSON with metadata
3. Pushed to Redis Streams queue for processing
4. Processor service picks it up for archival

### Backfill Service
Optionally fetch historical messages:

```bash
export BACKFILL_ENABLED=true
export BACKFILL_BATCH_SIZE=100
export BACKFILL_DELAY_SECONDS=2
```

The backfill service will:
- Fetch historical messages from channels you're monitoring
- Process them in batches to respect rate limits
- Handle Telegram flood wait errors automatically

## Common Local Issues

### "Session not authorized"
First-time run requires interactive auth. Run without `-d` to see prompts:
```bash
docker-compose up listener  # Follow prompts for code
```

### "No channels discovered"
Create Telegram folders named `Archive-*` or `Monitor-*` and add channels to them.
The listener discovers channels from your folder structure.

### "Flood wait error"
Telegram rate limiting - handled automatically. Reduce `BACKFILL_BATCH_SIZE` if frequent.

## Folder Naming Conventions

| Pattern | Behavior |
|---------|----------|
| `Archive-*` | Archive all messages |
| `Monitor-*` | Same as Archive (selective archiving reserved for future) |
| Other names | Folder is ignored |

Examples:
- `Archive-News` - Archive all messages from news channels
- `Archive-Tech` - Archive technology-related channels
- `Monitor-Research` - Monitor research channels

## Metrics

Prometheus metrics on port `8001`:
```bash
curl http://localhost:8001/metrics
```

Metrics include:
- Messages received per second
- Channels monitored
- Queue backlog
- Telegram API call rates

## Development Tips

### Testing with a Single Channel
1. Create a test folder: `Archive-Test`
2. Add a single low-volume channel
3. Watch logs: `docker-compose logs -f listener`
4. Verify messages appear in database

### Session Management
The Telegram session is stored in `listener.session` file. This file:
- Contains your authentication token
- Should be backed up for production deployments
- Allows reconnecting without re-authenticating

**Important**: Keep `listener.session` secure and never commit to git.

### Debugging
Enable verbose logging:
```bash
export LOG_LEVEL=DEBUG
python src/main.py
```

## Production Considerations

### Session Persistence
Mount a volume for the session file in docker-compose.yml:
```yaml
volumes:
  - ./listener_data:/app/data
```

### Rate Limiting
Telegram has strict rate limits. For large deployments:
- Keep `BACKFILL_BATCH_SIZE` conservative (default: 100)
- Monitor flood wait errors in metrics
- Consider multiple listener instances with different accounts (advanced)

### Monitoring
- Set up Prometheus scraping on port 8001
- Alert on listener disconnections
- Monitor queue depth in Redis

## Troubleshooting

### Listener keeps disconnecting
- Check your internet connection
- Verify Telegram account is not banned
- Check for IP-based rate limiting

### Messages not appearing in database
- Verify Redis is running: `redis-cli ping`
- Check processor service logs: `docker-compose logs processor`
- Ensure folder names match patterns: `Archive-*` or `Monitor-*`

### Cannot authenticate
- Verify phone number format: `+1234567890` (with country code)
- Check API ID and hash from my.telegram.org
- Try deleting `listener.session` and re-authenticating
