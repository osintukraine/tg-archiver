# Channel Import Feature Design

**Date:** 2026-01-02
**Status:** Approved
**Author:** Claude + Rick

## Overview

Import channels from CSV files into tg-archiver. Supports automatic Telegram folder creation, rich channel validation with previews, and rate-limited background joining via Redis queue.

## Requirements

- Upload CSV with columns: `Channel` (URL), `Name`, `Folder`
- Auto-create Telegram folders if they don't exist
- If CSV lacks `Folder` column, UI allows folder selection/creation
- Rich preview showing channel avatars, subscriber counts, already-member status
- Channels grouped by folder with expand/collapse
- Conservative rate limiting: 1 join per 30-60 seconds via Redis queue
- Detailed error log with timestamps and actionable suggestions
- Integration with existing ChannelDiscovery via monitored_folders table

---

## Data Model

### New Tables

```sql
-- Import job tracking
CREATE TABLE import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'uploading',
    -- uploading, validating, ready, processing, completed, failed
    total_channels INTEGER NOT NULL DEFAULT 0,
    validated_channels INTEGER NOT NULL DEFAULT 0,
    joined_channels INTEGER NOT NULL DEFAULT 0,
    failed_channels INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_ip VARCHAR(45),
    user_agent TEXT
);

-- Individual channels within an import job
CREATE TABLE import_job_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    channel_url VARCHAR(255) NOT NULL,
    channel_username VARCHAR(100),
    channel_name VARCHAR(255),
    target_folder VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending, validating, validated, queued, joining, joined, failed, skipped
    validation_data JSONB,
    -- {avatar_url, subscribers, already_member, is_private, telegram_id, etc.}
    error_message TEXT,
    error_code VARCHAR(50),
    -- CHANNEL_NOT_FOUND, CHANNEL_PRIVATE, ALREADY_MEMBER, FLOOD_WAIT, etc.
    selected BOOLEAN NOT NULL DEFAULT TRUE,
    queued_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_import_job_channels_job_id ON import_job_channels(import_job_id);
CREATE INDEX idx_import_job_channels_status ON import_job_channels(status);

-- Monitored folders (extends env-based folder matching)
CREATE TABLE monitored_folders (
    id SERIAL PRIMARY KEY,
    folder_name VARCHAR(100) NOT NULL UNIQUE,
    telegram_folder_id INTEGER,
    rule VARCHAR(50) NOT NULL DEFAULT 'archive_all',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_via VARCHAR(20) NOT NULL DEFAULT 'import',
    -- env_config, import, manual
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Import event log
CREATE TABLE import_job_logs (
    id BIGSERIAL PRIMARY KEY,
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES import_job_channels(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL,
    -- info, warning, error, success
    event_code VARCHAR(50),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_import_job_logs_job_id ON import_job_logs(import_job_id);
```

### Changes to Existing Tables

```sql
-- Add source tracking to channels table
ALTER TABLE channels ADD COLUMN source VARCHAR(20) DEFAULT 'folder_discovery';
-- folder_discovery, import, manual
```

---

## API Endpoints

### Import Management

```
POST /api/admin/import/upload
  Request: multipart/form-data with CSV file
  Response: {
    job_id: UUID,
    filename: string,
    total_channels: int,
    detected_folders: string[],
    has_folder_column: bool
  }

POST /api/admin/import/{job_id}/validate
  Triggers background validation task
  Response: { status: "validating", message: "Started" }

GET /api/admin/import/{job_id}
  Response: {
    id, filename, status, total_channels, validated_channels,
    joined_channels, failed_channels, created_at,
    channels_by_folder: {
      "US-tg": [
        {id, channel_url, channel_username, channel_name, status,
         validation_data, error_message, selected}
      ]
    }
  }

PATCH /api/admin/import/{job_id}/channels
  Request: { channel_ids: UUID[], selected: bool }
       OR: { channel_ids: UUID[], target_folder: string }
  Response: { updated: int }

POST /api/admin/import/{job_id}/start
  Queues selected channels for joining
  Response: { queued: int, folders_to_create: string[] }

GET /api/admin/import/{job_id}/log
  Query: ?event_type=error&limit=100
  Response: { logs: [{id, event_type, event_code, message, created_at}] }

DELETE /api/admin/import/{job_id}
  Cancels pending joins, removes job
  Response: { cancelled: int, deleted: bool }

GET /api/admin/import/jobs
  Query: ?page=1&page_size=20&status=processing
  Response: { jobs: [...], total: int }
```

### Folder Management

```
GET /api/admin/folders
  Response: {
    folders: [
      {id, folder_name, telegram_folder_id, rule, active, created_via}
    ],
    env_pattern: string  // Current FOLDER_ARCHIVE_ALL_PATTERN
  }

POST /api/admin/folders
  Request: { folder_name: string, rule: "archive_all" }
  Response: { id, folder_name, ... }

DELETE /api/admin/folders/{id}
  Response: { deleted: bool }
```

---

## Background Processing

### Redis Queue Structure

```
Queue: import:join_queue (Sorted Set)
  Score: scheduled_timestamp
  Value: JSON {job_id, channel_id, channel_username, target_folder, attempt}

Queue: import:validation_queue (List)
  Value: JSON {job_id, channel_ids: [up to 20]}
```

### Listener Service Components

**import_validator.py:**
- Consumes from `import:validation_queue`
- For each channel batch:
  - `client.get_entity(username)` to fetch metadata
  - Check `client.get_dialogs()` for membership
  - Handle errors (ChannelPrivate, UsernameNotOccupied, etc.)
  - Update `import_job_channels.validation_data`
  - Log events to `import_job_logs`
- Rate: ~10 channels per batch, 2-3 second delay between batches

**import_processor.py:**
- Polls `import:join_queue` every 5 seconds
- For each channel:
  1. Check/create folder if needed (folder_manager.py)
  2. `JoinChannelRequest(channel)` for public channels
  3. `ImportChatInviteRequest(hash)` for invite links
  4. Add channel to folder via `UpdateDialogFilterRequest`
  5. Update status, log event
  6. Wait 30-60 seconds before next join
- On FloodWaitError:
  - Log warning with wait duration
  - Sleep for required duration
  - Resume processing

**folder_manager.py:**
- `get_or_create_folder(folder_name)`:
  1. Query `monitored_folders` for existing
  2. If has `telegram_folder_id`, verify via `GetDialogFiltersRequest`
  3. If not exists, create via `UpdateDialogFilterRequest`
  4. Return folder_id
- `add_channel_to_folder(channel_id, folder_id)`:
  - Update folder's include_peers via `UpdateDialogFilterRequest`

### ChannelDiscovery Changes

Modify `_get_rule_for_folder()`:

```python
def _get_rule_for_folder(self, folder_name: str) -> Optional[str]:
    # Check env pattern first (backwards compatible)
    if folder_name.lower() == settings.FOLDER_ARCHIVE_ALL_PATTERN.lower():
        return "archive_all"

    # Check monitored_folders table
    # (Query cached in memory, refreshed every sync cycle)
    if folder_name in self._monitored_folders:
        return self._monitored_folders[folder_name].rule

    return None
```

---

## Frontend UI

### Page: `/admin/import`

**Phase 1 - Upload:**
- Dropzone for CSV file
- Shows format hints
- Table of recent import jobs with status

**Phase 2 - Review & Select:**
- Progress bar for validation
- Channels grouped by folder (collapsible)
- Each channel row shows:
  - Checkbox (selected)
  - Username/URL
  - Validation status icon (valid/invalid/private/already-member)
  - Subscriber count (if available)
  - Avatar thumbnail (if available)
- Folder header with "Select All" button
- Summary footer: Selected / Already member / Failed counts
- "Start Import" button

**Phase 3 - Progress:**
- Overall progress bar with ETA
- Real-time log panel (auto-scroll)
- Log entries: timestamp, icon, message
- Filter dropdown (all/errors/warnings)
- "Pause Queue" and "Cancel Remaining" buttons

### Components

```
services/frontend/components/admin/
├── ImportDropzone.tsx      # Drag-drop CSV upload
├── ChannelPreviewTable.tsx # Grouped channel list
├── FolderGroup.tsx         # Collapsible folder section
├── ChannelRow.tsx          # Individual channel with validation
└── ImportLogPanel.tsx      # Real-time scrolling log
```

---

## File Structure

### New Files

```
services/api/src/routers/admin/
├── import_channels.py
└── folders.py

services/listener/src/
├── import_processor.py
├── import_validator.py
└── folder_manager.py

shared/python/models/
├── import_job.py
└── monitored_folder.py

services/frontend/app/admin/import/
└── page.tsx

services/frontend/components/admin/
├── ImportDropzone.tsx
├── ChannelPreviewTable.tsx
├── FolderGroup.tsx
├── ChannelRow.tsx
└── ImportLogPanel.tsx

infrastructure/postgres/migrations/
└── 002_import_tables.sql
```

### Modified Files

```
services/listener/src/main.py          # Initialize ImportProcessor
services/listener/src/channel_discovery.py  # Check monitored_folders
shared/python/models/__init__.py       # Export new models
shared/python/models/channel.py        # Add source column
infrastructure/postgres/init.sql       # Add new tables
```

---

## Implementation Notes

1. **CSV Parsing:**
   - Handle UTF-8 BOM (the example CSV has one)
   - Case-insensitive header matching
   - Extract username from URL formats: `t.me/user`, `telegram.me/user`, `@user`, `https://t.me/+invitehash`

2. **Progress Updates:**
   - Polling every 2 seconds for simplicity
   - Can add SSE later if needed

3. **Telethon API:**
   - `JoinChannelRequest` for public channels
   - `ImportChatInviteRequest` for invite links
   - `UpdateDialogFilterRequest` to create/modify folders
   - `GetDialogFiltersRequest` to read existing folders

4. **Error Codes:**
   - `CHANNEL_NOT_FOUND` - Username doesn't exist
   - `CHANNEL_PRIVATE` - Requires invite link
   - `ALREADY_MEMBER` - Skip, mark as success
   - `FLOOD_WAIT` - Pause and retry
   - `USER_BANNED` - Cannot join, permanent failure
   - `INVITE_HASH_INVALID` - Bad invite link

5. **Rate Limits:**
   - Validation: ~10 channels per batch, 2-3s between batches
   - Joining: 1 channel per 30-60 seconds
   - Folder creation: Minimal calls, cache folder IDs
