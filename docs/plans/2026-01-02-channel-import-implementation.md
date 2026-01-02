# Channel Import Feature - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import Telegram channels from CSV files with folder creation, validation previews, and rate-limited background joining.

**Architecture:** CSV upload → background validation (batch Telegram API calls) → user selection UI → Redis queue → background join processor in listener service. Extends ChannelDiscovery to monitor additional folders via database table.

**Tech Stack:** FastAPI, SQLAlchemy, Redis Streams, Telethon (JoinChannelRequest, UpdateDialogFilterRequest), Next.js 14, React

---

## Task 1: Database Models - MonitoredFolder

**Files:**
- Create: `shared/python/models/monitored_folder.py`
- Modify: `shared/python/models/__init__.py`

**Step 1: Create the MonitoredFolder model**

```python
# shared/python/models/monitored_folder.py
"""
Monitored Folder Model - Extends folder-based channel discovery

Allows import feature to add folders beyond the env-configured pattern.
ChannelDiscovery queries this table alongside FOLDER_ARCHIVE_ALL_PATTERN.
"""

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class MonitoredFolder(Base):
    """
    Tracked Telegram folders for channel discovery.

    Extends the env-based FOLDER_ARCHIVE_ALL_PATTERN to support
    dynamically added folders from the import feature.
    """

    __tablename__ = "monitored_folders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Folder identification
    folder_name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    telegram_folder_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Processing rule
    rule: Mapped[str] = mapped_column(String(50), nullable=False, default="archive_all")

    # State
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Audit
    created_via: Mapped[str] = mapped_column(
        String(20), nullable=False, default="import"
    )  # env_config, import, manual
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<MonitoredFolder(id={self.id}, name='{self.folder_name}', rule='{self.rule}')>"
```

**Step 2: Export from models __init__.py**

Add to `shared/python/models/__init__.py`:

```python
# Add import after existing imports
from .monitored_folder import MonitoredFolder

# Add to __all__ list (in appropriate section)
    # Import System
    "MonitoredFolder",
```

**Step 3: Verify import works**

```bash
cd /home/rick/code/osintukraine/tg-archiver
python3 -c "from models import MonitoredFolder; print(MonitoredFolder.__tablename__)"
```

Expected: `monitored_folders`

**Step 4: Commit**

```bash
git add shared/python/models/monitored_folder.py shared/python/models/__init__.py
git commit -m "feat(models): add MonitoredFolder for dynamic folder tracking"
```

---

## Task 2: Database Models - ImportJob and ImportJobChannel

**Files:**
- Create: `shared/python/models/import_job.py`
- Modify: `shared/python/models/__init__.py`

**Step 1: Create the import job models**

```python
# shared/python/models/import_job.py
"""
Import Job Models - CSV channel import tracking

Tracks the lifecycle of channel imports:
1. CSV upload and parsing
2. Background validation (Telegram API lookups)
3. User selection
4. Queued joining with rate limiting
5. Completion and error logging
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class ImportJob(Base):
    """
    Import job for batch channel imports from CSV.

    Lifecycle: uploading → validating → ready → processing → completed/failed
    """

    __tablename__ = "import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    # Job identification
    filename: Mapped[str] = mapped_column(String(255), nullable=False)

    # Status tracking
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="uploading"
    )  # uploading, validating, ready, processing, completed, failed, cancelled

    # Progress counters
    total_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    validated_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    joined_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_channels: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Timing
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Audit
    created_by_ip: Mapped[Optional[str]] = mapped_column(INET, nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Relationships
    channels: Mapped[list["ImportJobChannel"]] = relationship(
        "ImportJobChannel", back_populates="import_job", cascade="all, delete-orphan"
    )
    logs: Mapped[list["ImportJobLog"]] = relationship(
        "ImportJobLog", back_populates="import_job", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return (
            f"<ImportJob(id={self.id}, file='{self.filename}', "
            f"status={self.status}, {self.joined_channels}/{self.total_channels})>"
        )

    @property
    def progress_percent(self) -> float:
        """Calculate overall progress percentage."""
        if self.total_channels == 0:
            return 0.0
        completed = self.joined_channels + self.failed_channels + self.skipped_channels
        return round((completed / self.total_channels) * 100, 1)


class ImportJobChannel(Base):
    """
    Individual channel within an import job.

    Tracks validation data, selection state, and join status.
    """

    __tablename__ = "import_job_channels"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid()
    )

    # Parent job
    import_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("import_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Channel data from CSV
    channel_url: Mapped[str] = mapped_column(String(255), nullable=False)
    channel_username: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    channel_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    target_folder: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    # Status
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", index=True
    )  # pending, validating, validated, queued, joining, joined, failed, skipped

    # Validation results (populated by background validator)
    validation_data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    # Example: {
    #   "telegram_id": -1001234567890,
    #   "title": "Channel Name",
    #   "username": "channelname",
    #   "subscribers": 12500,
    #   "avatar_url": "...",
    #   "is_private": false,
    #   "already_member": false,
    #   "is_verified": false,
    #   "is_scam": false
    # }

    # Error tracking
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    # Error codes: CHANNEL_NOT_FOUND, CHANNEL_PRIVATE, ALREADY_MEMBER,
    #              FLOOD_WAIT, USER_BANNED, INVITE_HASH_INVALID

    # Selection state (user can select/deselect before import)
    selected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Processing timestamps
    queued_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)
    joined_at: Mapped[Optional[datetime]] = mapped_column(nullable=True)

    # Retry tracking
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )

    # Relationships
    import_job: Mapped["ImportJob"] = relationship("ImportJob", back_populates="channels")

    def __repr__(self) -> str:
        return (
            f"<ImportJobChannel(id={self.id}, url='{self.channel_url}', "
            f"status={self.status})>"
        )


class ImportJobLog(Base):
    """
    Event log for import job progress and errors.

    Provides detailed timeline for debugging and user visibility.
    """

    __tablename__ = "import_job_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)

    # Parent references
    import_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("import_jobs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("import_job_channels.id", ondelete="CASCADE"),
        nullable=True,
    )

    # Event data
    event_type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # info, warning, error, success
    event_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)

    # Timing
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), nullable=False
    )

    # Relationships
    import_job: Mapped["ImportJob"] = relationship("ImportJob", back_populates="logs")

    def __repr__(self) -> str:
        return f"<ImportJobLog(id={self.id}, type={self.event_type}, msg='{self.message[:50]}...')>"
```

**Step 2: Export from models __init__.py**

Add to `shared/python/models/__init__.py`:

```python
# Add import
from .import_job import ImportJob, ImportJobChannel, ImportJobLog

# Add to __all__ list
    # Import System
    "MonitoredFolder",
    "ImportJob",
    "ImportJobChannel",
    "ImportJobLog",
```

**Step 3: Verify imports work**

```bash
cd /home/rick/code/osintukraine/tg-archiver
python3 -c "from models import ImportJob, ImportJobChannel, ImportJobLog; print(ImportJob.__tablename__)"
```

Expected: `import_jobs`

**Step 4: Commit**

```bash
git add shared/python/models/import_job.py shared/python/models/__init__.py
git commit -m "feat(models): add ImportJob, ImportJobChannel, ImportJobLog models"
```

---

## Task 3: Database Migration Script

**Files:**
- Create: `infrastructure/postgres/migrations/002_import_tables.sql`
- Modify: `infrastructure/postgres/init.sql`

**Step 1: Create migration file**

```sql
-- infrastructure/postgres/migrations/002_import_tables.sql
-- Channel Import Feature Tables
-- Run: psql -U osint_user -d osint_platform -f 002_import_tables.sql

BEGIN;

-- Track migration
INSERT INTO schema_migrations (version, description, checksum)
VALUES ('002', 'Channel import feature tables', NULL)
ON CONFLICT (version) DO NOTHING;

-- ===========================================================================
-- MONITORED FOLDERS (extends env-based folder discovery)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS monitored_folders (
    id SERIAL PRIMARY KEY,
    folder_name VARCHAR(100) NOT NULL UNIQUE,
    telegram_folder_id INTEGER,
    rule VARCHAR(50) NOT NULL DEFAULT 'archive_all',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_via VARCHAR(20) NOT NULL DEFAULT 'import',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitored_folders_active
    ON monitored_folders(active) WHERE active = TRUE;

-- ===========================================================================
-- IMPORT JOBS (batch channel import tracking)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'uploading',
    total_channels INTEGER NOT NULL DEFAULT 0,
    validated_channels INTEGER NOT NULL DEFAULT 0,
    joined_channels INTEGER NOT NULL DEFAULT 0,
    failed_channels INTEGER NOT NULL DEFAULT 0,
    skipped_channels INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by_ip INET,
    user_agent VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON import_jobs(created_at DESC);

-- ===========================================================================
-- IMPORT JOB CHANNELS (individual channels within import)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS import_job_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    channel_url VARCHAR(255) NOT NULL,
    channel_username VARCHAR(100),
    channel_name VARCHAR(255),
    target_folder VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    validation_data JSONB,
    error_message TEXT,
    error_code VARCHAR(50),
    selected BOOLEAN NOT NULL DEFAULT TRUE,
    queued_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_job_channels_job_id
    ON import_job_channels(import_job_id);
CREATE INDEX IF NOT EXISTS idx_import_job_channels_status
    ON import_job_channels(status);
CREATE INDEX IF NOT EXISTS idx_import_job_channels_folder
    ON import_job_channels(target_folder);

-- ===========================================================================
-- IMPORT JOB LOGS (event timeline)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS import_job_logs (
    id BIGSERIAL PRIMARY KEY,
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES import_job_channels(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL,
    event_code VARCHAR(50),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_job_logs_job_id
    ON import_job_logs(import_job_id);
CREATE INDEX IF NOT EXISTS idx_import_job_logs_created_at
    ON import_job_logs(created_at DESC);

-- ===========================================================================
-- ADD SOURCE COLUMN TO CHANNELS (track import vs discovery)
-- ===========================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'channels' AND column_name = 'source'
    ) THEN
        ALTER TABLE channels ADD COLUMN source VARCHAR(20) DEFAULT 'folder_discovery';
        COMMENT ON COLUMN channels.source IS 'Origin: folder_discovery, import, manual';
    END IF;
END $$;

COMMIT;
```

**Step 2: Add tables to init.sql (for fresh installs)**

Add to `infrastructure/postgres/init.sql` after the `export_jobs` table section:

```sql
-- ===========================================================================
-- MONITORED FOLDERS (dynamic folder discovery)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS monitored_folders (
    id SERIAL PRIMARY KEY,
    folder_name VARCHAR(100) NOT NULL UNIQUE,
    telegram_folder_id INTEGER,
    rule VARCHAR(50) NOT NULL DEFAULT 'archive_all',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_via VARCHAR(20) NOT NULL DEFAULT 'import',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_monitored_folders_active
    ON monitored_folders(active) WHERE active = TRUE;

-- ===========================================================================
-- IMPORT JOBS (batch channel import)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS import_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'uploading',
    total_channels INTEGER NOT NULL DEFAULT 0,
    validated_channels INTEGER NOT NULL DEFAULT 0,
    joined_channels INTEGER NOT NULL DEFAULT 0,
    failed_channels INTEGER NOT NULL DEFAULT 0,
    skipped_channels INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by_ip INET,
    user_agent VARCHAR(500)
);

CREATE TABLE IF NOT EXISTS import_job_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    channel_url VARCHAR(255) NOT NULL,
    channel_username VARCHAR(100),
    channel_name VARCHAR(255),
    target_folder VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    validation_data JSONB,
    error_message TEXT,
    error_code VARCHAR(50),
    selected BOOLEAN NOT NULL DEFAULT TRUE,
    queued_at TIMESTAMPTZ,
    joined_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_job_channels_job_id ON import_job_channels(import_job_id);
CREATE INDEX IF NOT EXISTS idx_import_job_channels_status ON import_job_channels(status);

CREATE TABLE IF NOT EXISTS import_job_logs (
    id BIGSERIAL PRIMARY KEY,
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    channel_id UUID REFERENCES import_job_channels(id) ON DELETE CASCADE,
    event_type VARCHAR(20) NOT NULL,
    event_code VARCHAR(50),
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_job_logs_job_id ON import_job_logs(import_job_id);
```

**Step 3: Run migration on local database**

```bash
docker-compose exec postgres psql -U osint_user -d osint_platform -f /docker-entrypoint-initdb.d/migrations/002_import_tables.sql
```

Or if running locally:

```bash
PGPASSWORD=dev_password_change_in_production_123456789 psql -h localhost -U osint_user -d osint_platform -f infrastructure/postgres/migrations/002_import_tables.sql
```

**Step 4: Verify tables created**

```bash
docker-compose exec postgres psql -U osint_user -d osint_platform -c "\dt import_*"
```

Expected:
```
              List of relations
 Schema |        Name         | Type  |   Owner
--------+---------------------+-------+-----------
 public | import_job_channels | table | osint_user
 public | import_job_logs     | table | osint_user
 public | import_jobs         | table | osint_user
```

**Step 5: Commit**

```bash
git add infrastructure/postgres/migrations/002_import_tables.sql infrastructure/postgres/init.sql
git commit -m "feat(db): add import tables migration"
```

---

## Task 4: API Router - Folders Endpoint

**Files:**
- Create: `services/api/src/routers/admin/folders.py`
- Modify: `services/api/src/routers/admin/__init__.py`

**Step 1: Create folders router**

```python
# services/api/src/routers/admin/folders.py
"""
Admin Folders Router - Monitored folder management

Endpoints:
- GET /api/admin/folders - List all monitored folders
- POST /api/admin/folders - Add new folder to monitor
- DELETE /api/admin/folders/{id} - Remove folder from monitoring
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from models import MonitoredFolder

from ...database import get_db
from ...dependencies import AdminUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/folders", tags=["Admin - Folders"])


# =============================================================================
# Pydantic Schemas
# =============================================================================


class FolderCreate(BaseModel):
    """Request to add a new monitored folder."""

    folder_name: str = Field(..., min_length=1, max_length=100)
    rule: str = Field(default="archive_all", pattern="^(archive_all|selective_archive)$")


class FolderResponse(BaseModel):
    """Monitored folder response."""

    id: int
    folder_name: str
    telegram_folder_id: Optional[int] = None
    rule: str
    active: bool
    created_via: str
    created_at: str


class FolderListResponse(BaseModel):
    """List of monitored folders."""

    folders: list[FolderResponse]
    env_pattern: str  # Current FOLDER_ARCHIVE_ALL_PATTERN for reference
    total: int


# =============================================================================
# API Endpoints
# =============================================================================


@router.get("")
async def list_folders(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> FolderListResponse:
    """
    List all monitored folders.

    Includes both database-stored folders and the env-configured pattern.
    """
    result = await db.execute(
        select(MonitoredFolder).order_by(MonitoredFolder.created_at.desc())
    )
    folders = result.scalars().all()

    return FolderListResponse(
        folders=[
            FolderResponse(
                id=f.id,
                folder_name=f.folder_name,
                telegram_folder_id=f.telegram_folder_id,
                rule=f.rule,
                active=f.active,
                created_via=f.created_via,
                created_at=f.created_at.isoformat(),
            )
            for f in folders
        ],
        env_pattern=settings.FOLDER_ARCHIVE_ALL_PATTERN,
        total=len(folders),
    )


@router.post("")
async def create_folder(
    admin: AdminUser,
    request: FolderCreate,
    db: AsyncSession = Depends(get_db),
) -> FolderResponse:
    """
    Add a new folder to monitor.

    The folder will be picked up by ChannelDiscovery on next sync cycle.
    If the folder doesn't exist on Telegram, it will be created when
    channels are imported to it.
    """
    # Check for duplicate
    existing = await db.execute(
        select(MonitoredFolder).where(
            func.lower(MonitoredFolder.folder_name) == request.folder_name.lower()
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Folder '{request.folder_name}' is already being monitored",
        )

    # Check if matches env pattern (already monitored)
    if request.folder_name.lower() == settings.FOLDER_ARCHIVE_ALL_PATTERN.lower():
        raise HTTPException(
            status_code=409,
            detail=f"Folder '{request.folder_name}' is already monitored via FOLDER_ARCHIVE_ALL_PATTERN",
        )

    folder = MonitoredFolder(
        folder_name=request.folder_name,
        rule=request.rule,
        created_via="manual",
    )

    db.add(folder)
    await db.commit()
    await db.refresh(folder)

    logger.info(f"Added monitored folder: {folder.folder_name}")

    return FolderResponse(
        id=folder.id,
        folder_name=folder.folder_name,
        telegram_folder_id=folder.telegram_folder_id,
        rule=folder.rule,
        active=folder.active,
        created_via=folder.created_via,
        created_at=folder.created_at.isoformat(),
    )


@router.delete("/{folder_id}")
async def delete_folder(
    admin: AdminUser,
    folder_id: int,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Remove a folder from monitoring.

    Note: This doesn't delete the folder from Telegram or remove
    already-discovered channels. It just stops monitoring that folder.
    """
    result = await db.execute(
        select(MonitoredFolder).where(MonitoredFolder.id == folder_id)
    )
    folder = result.scalar_one_or_none()

    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    folder_name = folder.folder_name
    await db.delete(folder)
    await db.commit()

    logger.info(f"Removed monitored folder: {folder_name}")

    return {"deleted": True, "folder_name": folder_name}


@router.patch("/{folder_id}")
async def toggle_folder(
    admin: AdminUser,
    folder_id: int,
    db: AsyncSession = Depends(get_db),
) -> FolderResponse:
    """
    Toggle folder active status.
    """
    result = await db.execute(
        select(MonitoredFolder).where(MonitoredFolder.id == folder_id)
    )
    folder = result.scalar_one_or_none()

    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    folder.active = not folder.active
    await db.commit()
    await db.refresh(folder)

    logger.info(f"Toggled folder {folder.folder_name} active={folder.active}")

    return FolderResponse(
        id=folder.id,
        folder_name=folder.folder_name,
        telegram_folder_id=folder.telegram_folder_id,
        rule=folder.rule,
        active=folder.active,
        created_via=folder.created_via,
        created_at=folder.created_at.isoformat(),
    )
```

**Step 2: Register router in admin __init__.py**

Add to `services/api/src/routers/admin/__init__.py`:

```python
# Add import
from .folders import router as folders_router

# Add to __all__
    'folders_router',
```

**Step 3: Register in main.py**

Add to `services/api/src/main.py` where other admin routers are included:

```python
from .routers.admin import folders_router
app.include_router(folders_router)
```

**Step 4: Test endpoint**

```bash
curl -X GET http://localhost:8000/api/admin/folders \
  -H "Authorization: Bearer $TOKEN"
```

**Step 5: Commit**

```bash
git add services/api/src/routers/admin/folders.py services/api/src/routers/admin/__init__.py services/api/src/main.py
git commit -m "feat(api): add folders management endpoint"
```

---

## Task 5: API Router - Import Upload Endpoint

**Files:**
- Create: `services/api/src/routers/admin/import_channels.py`
- Modify: `services/api/src/routers/admin/__init__.py`

**Step 1: Create import router with upload endpoint**

```python
# services/api/src/routers/admin/import_channels.py
"""
Admin Import Channels Router - CSV channel import management

Endpoints:
- POST /api/admin/import/upload - Upload CSV file
- POST /api/admin/import/{job_id}/validate - Start validation
- GET /api/admin/import/{job_id} - Get job with channels
- PATCH /api/admin/import/{job_id}/channels - Update selection
- POST /api/admin/import/{job_id}/start - Start joining
- GET /api/admin/import/{job_id}/log - Get event log
- DELETE /api/admin/import/{job_id} - Cancel/delete job
- GET /api/admin/import/jobs - List all jobs
"""

import csv
import io
import logging
import re
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import ImportJob, ImportJobChannel, ImportJobLog, MonitoredFolder

from ...database import get_db
from ...dependencies import AdminUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/import", tags=["Admin - Import"])


# =============================================================================
# Pydantic Schemas
# =============================================================================


class UploadResponse(BaseModel):
    """Response after CSV upload."""

    job_id: str
    filename: str
    total_channels: int
    detected_folders: list[str]
    has_folder_column: bool


class ChannelResponse(BaseModel):
    """Individual channel in import job."""

    id: str
    channel_url: str
    channel_username: Optional[str] = None
    channel_name: Optional[str] = None
    target_folder: Optional[str] = None
    status: str
    validation_data: Optional[dict[str, Any]] = None
    error_message: Optional[str] = None
    error_code: Optional[str] = None
    selected: bool


class ImportJobResponse(BaseModel):
    """Import job details."""

    id: str
    filename: str
    status: str
    total_channels: int
    validated_channels: int
    joined_channels: int
    failed_channels: int
    skipped_channels: int
    progress_percent: float
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    channels_by_folder: dict[str, list[ChannelResponse]]


class ImportJobSummary(BaseModel):
    """Import job summary for list view."""

    id: str
    filename: str
    status: str
    total_channels: int
    joined_channels: int
    failed_channels: int
    progress_percent: float
    created_at: str


class ImportJobListResponse(BaseModel):
    """Paginated list of import jobs."""

    jobs: list[ImportJobSummary]
    total: int
    page: int
    page_size: int


class ChannelUpdateRequest(BaseModel):
    """Request to update channel selection."""

    channel_ids: list[str]
    selected: Optional[bool] = None
    target_folder: Optional[str] = None


class LogEntry(BaseModel):
    """Import log entry."""

    id: int
    event_type: str
    event_code: Optional[str] = None
    message: str
    created_at: str


class LogResponse(BaseModel):
    """Import job log."""

    logs: list[LogEntry]
    total: int


# =============================================================================
# Helper Functions
# =============================================================================


def extract_username_from_url(url: str) -> Optional[str]:
    """
    Extract Telegram username from various URL formats.

    Supports:
    - https://t.me/username
    - https://telegram.me/username
    - t.me/username
    - @username
    - username (plain)
    - https://t.me/+invitehash (returns None for invite links)
    """
    url = url.strip()

    # Invite link - can't extract username
    if "+invite" in url.lower() or "/+" in url:
        return None

    # @username format
    if url.startswith("@"):
        return url[1:]

    # URL formats
    patterns = [
        r"(?:https?://)?(?:t\.me|telegram\.me)/([a-zA-Z][a-zA-Z0-9_]{3,31})",
        r"(?:https?://)?(?:t\.me|telegram\.me)/joinchat/([a-zA-Z0-9_-]+)",
    ]

    for pattern in patterns:
        match = re.search(pattern, url, re.IGNORECASE)
        if match:
            username = match.group(1)
            # Skip joinchat links
            if "joinchat" not in url.lower():
                return username

    # Plain username (if it looks valid)
    if re.match(r"^[a-zA-Z][a-zA-Z0-9_]{3,31}$", url):
        return url

    return None


def parse_csv_content(content: bytes, filename: str) -> tuple[list[dict], list[str], bool]:
    """
    Parse CSV content and extract channel data.

    Returns:
        (channels, detected_folders, has_folder_column)
    """
    # Handle BOM
    if content.startswith(b'\xef\xbb\xbf'):
        content = content[3:]

    try:
        text = content.decode('utf-8')
    except UnicodeDecodeError:
        text = content.decode('latin-1')

    reader = csv.DictReader(io.StringIO(text))

    # Normalize headers (case-insensitive)
    if reader.fieldnames:
        header_map = {h.lower().strip(): h for h in reader.fieldnames}
    else:
        raise ValueError("CSV has no headers")

    # Find column names (flexible matching)
    url_col = header_map.get('channel') or header_map.get('url') or header_map.get('link')
    name_col = header_map.get('name') or header_map.get('title')
    folder_col = header_map.get('folder') or header_map.get('category') or header_map.get('group')

    if not url_col:
        raise ValueError("CSV must have a 'Channel' or 'URL' column")

    channels = []
    folders = set()
    has_folder = folder_col is not None

    for row in reader:
        url = row.get(url_col, '').strip()
        if not url:
            continue

        name = row.get(name_col, '').strip() if name_col else None
        folder = row.get(folder_col, '').strip() if folder_col else None

        username = extract_username_from_url(url)

        channels.append({
            'url': url,
            'username': username,
            'name': name,
            'folder': folder,
        })

        if folder:
            folders.add(folder)

    return channels, list(folders), has_folder


# =============================================================================
# API Endpoints
# =============================================================================


@router.post("/upload")
async def upload_csv(
    request: Request,
    admin: AdminUser,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
) -> UploadResponse:
    """
    Upload a CSV file with channels to import.

    Expected columns:
    - Channel (required): URL or username
    - Name (optional): Display name
    - Folder (optional): Target Telegram folder

    Returns job ID for subsequent operations.
    """
    if not file.filename.endswith('.csv'):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    content = await file.read()

    if len(content) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    try:
        channels, folders, has_folder = parse_csv_content(content, file.filename)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not channels:
        raise HTTPException(status_code=400, detail="No valid channels found in CSV")

    # Create import job
    job = ImportJob(
        filename=file.filename,
        status="uploading",
        total_channels=len(channels),
        created_by_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(job)
    await db.flush()  # Get job ID

    # Create channel records
    for ch in channels:
        channel = ImportJobChannel(
            import_job_id=job.id,
            channel_url=ch['url'],
            channel_username=ch['username'],
            channel_name=ch['name'],
            target_folder=ch['folder'],
            status="pending",
        )
        db.add(channel)

    # Update job status
    job.status = "ready"  # Ready for validation

    await db.commit()

    logger.info(f"Created import job {job.id} with {len(channels)} channels")

    return UploadResponse(
        job_id=str(job.id),
        filename=file.filename,
        total_channels=len(channels),
        detected_folders=folders,
        has_folder_column=has_folder,
    )


@router.get("/jobs")
async def list_jobs(
    admin: AdminUser,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    status: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
) -> ImportJobListResponse:
    """
    List all import jobs with pagination.
    """
    query = select(ImportJob).order_by(ImportJob.created_at.desc())

    if status:
        query = query.where(ImportJob.status == status)

    # Count total
    count_query = select(func.count(ImportJob.id))
    if status:
        count_query = count_query.where(ImportJob.status == status)
    total = (await db.execute(count_query)).scalar() or 0

    # Paginate
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    jobs = result.scalars().all()

    return ImportJobListResponse(
        jobs=[
            ImportJobSummary(
                id=str(j.id),
                filename=j.filename,
                status=j.status,
                total_channels=j.total_channels,
                joined_channels=j.joined_channels,
                failed_channels=j.failed_channels,
                progress_percent=j.progress_percent,
                created_at=j.created_at.isoformat(),
            )
            for j in jobs
        ],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{job_id}")
async def get_job(
    admin: AdminUser,
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> ImportJobResponse:
    """
    Get import job details with all channels grouped by folder.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    result = await db.execute(
        select(ImportJob)
        .options(selectinload(ImportJob.channels))
        .where(ImportJob.id == job_uuid)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    # Group channels by folder
    channels_by_folder: dict[str, list[ChannelResponse]] = {}
    for ch in job.channels:
        folder = ch.target_folder or "(No folder)"
        if folder not in channels_by_folder:
            channels_by_folder[folder] = []

        channels_by_folder[folder].append(
            ChannelResponse(
                id=str(ch.id),
                channel_url=ch.channel_url,
                channel_username=ch.channel_username,
                channel_name=ch.channel_name,
                target_folder=ch.target_folder,
                status=ch.status,
                validation_data=ch.validation_data,
                error_message=ch.error_message,
                error_code=ch.error_code,
                selected=ch.selected,
            )
        )

    return ImportJobResponse(
        id=str(job.id),
        filename=job.filename,
        status=job.status,
        total_channels=job.total_channels,
        validated_channels=job.validated_channels,
        joined_channels=job.joined_channels,
        failed_channels=job.failed_channels,
        skipped_channels=job.skipped_channels,
        progress_percent=job.progress_percent,
        created_at=job.created_at.isoformat(),
        started_at=job.started_at.isoformat() if job.started_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        channels_by_folder=channels_by_folder,
    )


@router.patch("/{job_id}/channels")
async def update_channels(
    admin: AdminUser,
    job_id: str,
    request: ChannelUpdateRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Update channel selection or folder assignment.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    # Verify job exists
    job = await db.get(ImportJob, job_uuid)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    if job.status not in ("ready", "validating"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot modify channels in status '{job.status}'",
        )

    # Parse channel IDs
    channel_uuids = []
    for cid in request.channel_ids:
        try:
            channel_uuids.append(uuid.UUID(cid))
        except ValueError:
            continue

    if not channel_uuids:
        raise HTTPException(status_code=400, detail="No valid channel IDs provided")

    # Build update
    values = {}
    if request.selected is not None:
        values["selected"] = request.selected
    if request.target_folder is not None:
        values["target_folder"] = request.target_folder

    if not values:
        raise HTTPException(status_code=400, detail="No updates provided")

    # Execute update
    result = await db.execute(
        update(ImportJobChannel)
        .where(
            and_(
                ImportJobChannel.import_job_id == job_uuid,
                ImportJobChannel.id.in_(channel_uuids),
            )
        )
        .values(**values)
    )

    await db.commit()

    return {"updated": result.rowcount}


@router.get("/{job_id}/log")
async def get_log(
    admin: AdminUser,
    job_id: str,
    event_type: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> LogResponse:
    """
    Get import job event log.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    query = (
        select(ImportJobLog)
        .where(ImportJobLog.import_job_id == job_uuid)
        .order_by(ImportJobLog.created_at.desc())
    )

    if event_type:
        query = query.where(ImportJobLog.event_type == event_type)

    query = query.limit(limit)

    result = await db.execute(query)
    logs = result.scalars().all()

    # Get total count
    count_query = select(func.count(ImportJobLog.id)).where(
        ImportJobLog.import_job_id == job_uuid
    )
    if event_type:
        count_query = count_query.where(ImportJobLog.event_type == event_type)
    total = (await db.execute(count_query)).scalar() or 0

    return LogResponse(
        logs=[
            LogEntry(
                id=log.id,
                event_type=log.event_type,
                event_code=log.event_code,
                message=log.message,
                created_at=log.created_at.isoformat(),
            )
            for log in reversed(logs)  # Chronological order
        ],
        total=total,
    )


@router.delete("/{job_id}")
async def delete_job(
    admin: AdminUser,
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Cancel or delete an import job.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    job = await db.get(ImportJob, job_uuid)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    # If processing, mark as cancelled (processor will stop)
    if job.status == "processing":
        job.status = "cancelled"
        await db.commit()
        logger.info(f"Cancelled import job {job_id}")
        return {"cancelled": True, "deleted": False}

    # Otherwise delete entirely
    await db.delete(job)
    await db.commit()
    logger.info(f"Deleted import job {job_id}")

    return {"cancelled": False, "deleted": True}
```

**Step 2: Register router**

Add to `services/api/src/routers/admin/__init__.py`:

```python
from .import_channels import router as import_router

# Add to __all__
    'import_router',
```

Add to `services/api/src/main.py`:

```python
from .routers.admin import import_router
app.include_router(import_router)
```

**Step 3: Commit**

```bash
git add services/api/src/routers/admin/import_channels.py services/api/src/routers/admin/__init__.py services/api/src/main.py
git commit -m "feat(api): add import upload and management endpoints"
```

---

## Task 6: API Router - Validate and Start Endpoints

**Files:**
- Modify: `services/api/src/routers/admin/import_channels.py`

**Step 1: Add validate and start endpoints**

Add to `import_channels.py` after the existing endpoints:

```python
@router.post("/{job_id}/validate")
async def start_validation(
    admin: AdminUser,
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Start background validation of channels.

    Triggers the listener service to validate channels via Telegram API.
    Progress updates available via GET /api/admin/import/{job_id}
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    job = await db.get(ImportJob, job_uuid)
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    if job.status not in ("ready", "validating"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot validate job in status '{job.status}'",
        )

    # Update status
    job.status = "validating"
    await db.commit()

    # Queue validation task via Redis
    try:
        import redis.asyncio as redis
        from config.settings import settings

        r = redis.from_url(settings.REDIS_URL)
        await r.rpush(
            "import:validation_queue",
            f'{{"job_id": "{job_id}"}}',
        )
        await r.close()
        logger.info(f"Queued validation for job {job_id}")
    except Exception as e:
        logger.error(f"Failed to queue validation: {e}")
        # Don't fail the request - validation can be retried
        pass

    # Log event
    log = ImportJobLog(
        import_job_id=job_uuid,
        event_type="info",
        event_code="VALIDATION_STARTED",
        message="Channel validation started",
    )
    db.add(log)
    await db.commit()

    return {"status": "validating", "message": "Validation started"}


@router.post("/{job_id}/start")
async def start_import(
    admin: AdminUser,
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Start joining selected channels.

    Queues selected channels for background joining via Redis.
    The listener service processes the queue with rate limiting.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID")

    result = await db.execute(
        select(ImportJob)
        .options(selectinload(ImportJob.channels))
        .where(ImportJob.id == job_uuid)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    if job.status not in ("ready", "validating"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot start import in status '{job.status}'",
        )

    # Get selected channels that are ready to join
    selected_channels = [
        ch for ch in job.channels
        if ch.selected and ch.status in ("pending", "validated")
        and ch.validation_data  # Has been validated
        and not ch.validation_data.get("already_member")  # Not already member
        and not ch.validation_data.get("is_private")  # Not private (for now)
    ]

    if not selected_channels:
        raise HTTPException(
            status_code=400,
            detail="No eligible channels to join (all already member, private, or not validated)",
        )

    # Collect folders to create
    folders_to_create = set()
    for ch in selected_channels:
        if ch.target_folder:
            folders_to_create.add(ch.target_folder)

    # Ensure folders are in monitored_folders table
    for folder_name in folders_to_create:
        existing = await db.execute(
            select(MonitoredFolder).where(
                func.lower(MonitoredFolder.folder_name) == folder_name.lower()
            )
        )
        if not existing.scalar_one_or_none():
            folder = MonitoredFolder(
                folder_name=folder_name,
                rule="archive_all",
                created_via="import",
            )
            db.add(folder)
            logger.info(f"Added folder '{folder_name}' to monitored folders")

    # Update job status
    job.status = "processing"
    job.started_at = datetime.utcnow()

    # Queue channels for joining
    try:
        import redis.asyncio as redis
        from config.settings import settings
        import json
        import time

        r = redis.from_url(settings.REDIS_URL)

        base_time = time.time()
        for i, ch in enumerate(selected_channels):
            # Mark as queued
            ch.status = "queued"
            ch.queued_at = datetime.utcnow()

            # Schedule with 45-second intervals
            scheduled_time = base_time + (i * 45)

            await r.zadd(
                "import:join_queue",
                {
                    json.dumps({
                        "job_id": str(job.id),
                        "channel_id": str(ch.id),
                        "channel_username": ch.channel_username,
                        "target_folder": ch.target_folder,
                        "attempt": 0,
                    }): scheduled_time
                },
            )

        await r.close()
        logger.info(f"Queued {len(selected_channels)} channels for job {job_id}")

    except Exception as e:
        logger.error(f"Failed to queue channels: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to queue channels: {str(e)}",
        )

    # Log event
    log = ImportJobLog(
        import_job_id=job_uuid,
        event_type="info",
        event_code="IMPORT_STARTED",
        message=f"Started importing {len(selected_channels)} channels to {len(folders_to_create)} folder(s)",
    )
    db.add(log)
    await db.commit()

    return {
        "status": "processing",
        "queued": len(selected_channels),
        "folders_to_create": list(folders_to_create),
        "estimated_minutes": len(selected_channels) * 45 // 60,
    }
```

**Step 2: Commit**

```bash
git add services/api/src/routers/admin/import_channels.py
git commit -m "feat(api): add validate and start import endpoints"
```

---

## Task 7: Listener - Import Validator

**Files:**
- Create: `services/listener/src/import_validator.py`

**Step 1: Create the validator module**

```python
# services/listener/src/import_validator.py
"""
Import Validator - Background channel validation

Processes the import:validation_queue to validate channels via Telegram API.
Fetches channel metadata (title, subscribers, avatar) and checks membership.
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    UsernameInvalidError,
    UsernameNotOccupiedError,
)
from telethon.tl.types import Channel as TelegramChannel

from models import ImportJob, ImportJobChannel, ImportJobLog
from models.base import AsyncSessionLocal

logger = logging.getLogger(__name__)


class ImportValidator:
    """
    Validates channels from import jobs via Telegram API.

    Processes batches of 10-20 channels with delays between batches.
    Updates validation_data JSONB with channel metadata.
    """

    BATCH_SIZE = 15
    BATCH_DELAY_SECONDS = 3
    CHANNEL_DELAY_SECONDS = 0.5

    def __init__(self, client: TelegramClient, redis_client):
        self.client = client
        self.redis = redis_client
        self._running = False
        self._dialogs_cache: Optional[set] = None
        self._dialogs_cache_time: Optional[datetime] = None

    async def start(self):
        """Start the validation processor."""
        self._running = True
        logger.info("Import validator started")

        while self._running:
            try:
                await self._process_queue()
            except Exception as e:
                logger.exception(f"Error in validation loop: {e}")

            await asyncio.sleep(2)

    async def stop(self):
        """Stop the validation processor."""
        self._running = False
        logger.info("Import validator stopped")

    async def _process_queue(self):
        """Process one item from validation queue."""
        # Pop from queue (blocking with timeout)
        result = await self.redis.blpop("import:validation_queue", timeout=5)
        if not result:
            return

        _, data = result
        try:
            payload = json.loads(data)
            job_id = payload["job_id"]
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(f"Invalid validation queue item: {e}")
            return

        logger.info(f"Processing validation for job {job_id}")

        async with AsyncSessionLocal() as session:
            await self._validate_job(job_id, session)

    async def _validate_job(self, job_id: str, session: AsyncSession):
        """Validate all pending channels in a job."""
        import uuid

        try:
            job_uuid = uuid.UUID(job_id)
        except ValueError:
            logger.error(f"Invalid job ID: {job_id}")
            return

        # Get job with channels
        result = await session.execute(
            select(ImportJob).where(ImportJob.id == job_uuid)
        )
        job = result.scalar_one_or_none()

        if not job:
            logger.error(f"Job not found: {job_id}")
            return

        if job.status != "validating":
            logger.info(f"Job {job_id} not in validating status, skipping")
            return

        # Get pending channels
        result = await session.execute(
            select(ImportJobChannel)
            .where(ImportJobChannel.import_job_id == job_uuid)
            .where(ImportJobChannel.status == "pending")
        )
        channels = result.scalars().all()

        if not channels:
            job.status = "ready"
            await session.commit()
            logger.info(f"Job {job_id} validation complete - no pending channels")
            return

        # Refresh dialogs cache for membership check
        await self._refresh_dialogs_cache()

        # Process in batches
        for i in range(0, len(channels), self.BATCH_SIZE):
            batch = channels[i : i + self.BATCH_SIZE]

            for channel in batch:
                try:
                    await self._validate_channel(channel, session)
                    job.validated_channels += 1
                except FloodWaitError as e:
                    logger.warning(f"FloodWait during validation: {e.seconds}s")
                    await self._log_event(
                        session, job_uuid, None, "warning", "FLOOD_WAIT",
                        f"Rate limited, waiting {e.seconds}s"
                    )
                    await session.commit()
                    await asyncio.sleep(e.seconds)
                except Exception as e:
                    logger.error(f"Error validating {channel.channel_url}: {e}")
                    channel.status = "validated"
                    channel.error_code = "VALIDATION_ERROR"
                    channel.error_message = str(e)

                await asyncio.sleep(self.CHANNEL_DELAY_SECONDS)

            await session.commit()
            await asyncio.sleep(self.BATCH_DELAY_SECONDS)

        # Mark job as ready
        job.status = "ready"
        await self._log_event(
            session, job_uuid, None, "success", "VALIDATION_COMPLETE",
            f"Validated {job.validated_channels} channels"
        )
        await session.commit()

        logger.info(f"Job {job_id} validation complete: {job.validated_channels} validated")

    async def _validate_channel(self, channel: ImportJobChannel, session: AsyncSession):
        """Validate a single channel via Telegram API."""
        channel.status = "validating"

        username = channel.channel_username
        if not username:
            channel.status = "validated"
            channel.error_code = "NO_USERNAME"
            channel.error_message = "Could not extract username from URL"
            channel.validation_data = {"valid": False}
            return

        try:
            # Fetch entity from Telegram
            entity = await self.client.get_entity(username)

            if not isinstance(entity, TelegramChannel):
                channel.status = "validated"
                channel.error_code = "NOT_CHANNEL"
                channel.error_message = "URL does not point to a channel"
                channel.validation_data = {"valid": False}
                return

            # Check membership
            already_member = entity.id in (self._dialogs_cache or set())

            # Build validation data
            channel.validation_data = {
                "valid": True,
                "telegram_id": entity.id,
                "title": entity.title,
                "username": entity.username,
                "subscribers": getattr(entity, "participants_count", None),
                "is_private": not entity.username,
                "is_verified": getattr(entity, "verified", False),
                "is_scam": getattr(entity, "scam", False),
                "is_fake": getattr(entity, "fake", False),
                "already_member": already_member,
            }

            channel.status = "validated"
            channel.channel_name = entity.title

            if already_member:
                channel.error_code = "ALREADY_MEMBER"
                channel.error_message = "Already a member of this channel"

            logger.debug(f"Validated {username}: {entity.title}")

        except UsernameNotOccupiedError:
            channel.status = "validated"
            channel.error_code = "CHANNEL_NOT_FOUND"
            channel.error_message = "Channel username does not exist"
            channel.validation_data = {"valid": False}

        except UsernameInvalidError:
            channel.status = "validated"
            channel.error_code = "INVALID_USERNAME"
            channel.error_message = "Invalid username format"
            channel.validation_data = {"valid": False}

        except ChannelPrivateError:
            channel.status = "validated"
            channel.error_code = "CHANNEL_PRIVATE"
            channel.error_message = "Channel is private, requires invite link"
            channel.validation_data = {"valid": True, "is_private": True}

    async def _refresh_dialogs_cache(self):
        """Refresh cache of channels we're already a member of."""
        now = datetime.utcnow()

        # Cache for 5 minutes
        if (
            self._dialogs_cache_time
            and (now - self._dialogs_cache_time).total_seconds() < 300
        ):
            return

        try:
            dialogs = await self.client.get_dialogs()
            self._dialogs_cache = {
                d.entity.id for d in dialogs
                if isinstance(d.entity, TelegramChannel)
            }
            self._dialogs_cache_time = now
            logger.debug(f"Refreshed dialogs cache: {len(self._dialogs_cache)} channels")
        except Exception as e:
            logger.error(f"Failed to refresh dialogs cache: {e}")
            self._dialogs_cache = set()

    async def _log_event(
        self,
        session: AsyncSession,
        job_id,
        channel_id,
        event_type: str,
        event_code: str,
        message: str,
    ):
        """Log an event to import_job_logs."""
        log = ImportJobLog(
            import_job_id=job_id,
            channel_id=channel_id,
            event_type=event_type,
            event_code=event_code,
            message=message,
        )
        session.add(log)
```

**Step 2: Commit**

```bash
git add services/listener/src/import_validator.py
git commit -m "feat(listener): add import channel validator"
```

---

## Task 8: Listener - Folder Manager

**Files:**
- Create: `services/listener/src/folder_manager.py`

**Step 1: Create the folder manager module**

```python
# services/listener/src/folder_manager.py
"""
Folder Manager - Telegram folder operations

Creates and updates Telegram folders via UpdateDialogFilterRequest.
Used by import processor to create folders and add channels to them.
"""

import logging
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.functions.messages import GetDialogFiltersRequest, UpdateDialogFilterRequest
from telethon.tl.types import DialogFilter, InputPeerChannel
from telethon.tl.types import Channel as TelegramChannel

from models import MonitoredFolder
from models.base import AsyncSessionLocal

logger = logging.getLogger(__name__)


class FolderManager:
    """
    Manages Telegram folders for channel organization.

    Handles folder creation and adding channels to folders.
    Caches folder structure to minimize API calls.
    """

    def __init__(self, client: TelegramClient):
        self.client = client
        self._folders_cache: dict[str, DialogFilter] = {}
        self._max_folder_id: int = 0

    async def refresh_cache(self):
        """Refresh the folders cache from Telegram."""
        try:
            result = await self.client(GetDialogFiltersRequest())
            self._folders_cache = {}

            for f in result.filters:
                if hasattr(f, "title") and hasattr(f.title, "text"):
                    self._folders_cache[f.title.text.lower()] = f
                    if hasattr(f, "id") and f.id > self._max_folder_id:
                        self._max_folder_id = f.id

            logger.info(f"Refreshed folder cache: {len(self._folders_cache)} folders")

        except Exception as e:
            logger.error(f"Failed to refresh folder cache: {e}")

    async def get_or_create_folder(
        self, folder_name: str, session: Optional[AsyncSession] = None
    ) -> Optional[int]:
        """
        Get existing folder or create new one.

        Returns the folder ID, or None if creation failed.
        """
        # Check cache first
        folder_key = folder_name.lower()
        if folder_key in self._folders_cache:
            folder = self._folders_cache[folder_key]
            return folder.id

        # Refresh cache and check again
        await self.refresh_cache()
        if folder_key in self._folders_cache:
            folder = self._folders_cache[folder_key]

            # Update database if we have session
            if session:
                await self._update_folder_id(session, folder_name, folder.id)

            return folder.id

        # Create new folder
        try:
            self._max_folder_id += 1
            new_id = self._max_folder_id

            # Create minimal folder structure
            from telethon.tl.types import TextWithEntities

            await self.client(
                UpdateDialogFilterRequest(
                    id=new_id,
                    filter=DialogFilter(
                        id=new_id,
                        title=TextWithEntities(text=folder_name, entities=[]),
                        pinned_peers=[],
                        include_peers=[],
                        exclude_peers=[],
                        contacts=False,
                        non_contacts=False,
                        groups=False,
                        broadcasts=True,  # Only channels
                        bots=False,
                        exclude_muted=False,
                        exclude_read=False,
                        exclude_archived=False,
                    ),
                )
            )

            logger.info(f"Created Telegram folder '{folder_name}' with id={new_id}")

            # Refresh cache
            await self.refresh_cache()

            # Update database
            if session:
                await self._update_folder_id(session, folder_name, new_id)

            return new_id

        except FloodWaitError:
            raise  # Let caller handle
        except Exception as e:
            logger.error(f"Failed to create folder '{folder_name}': {e}")
            return None

    async def add_channel_to_folder(
        self, channel_entity: TelegramChannel, folder_name: str
    ) -> bool:
        """
        Add a channel to a Telegram folder.

        Returns True if successful, False otherwise.
        """
        folder_key = folder_name.lower()

        # Ensure we have the folder
        if folder_key not in self._folders_cache:
            await self.refresh_cache()

        if folder_key not in self._folders_cache:
            logger.error(f"Folder '{folder_name}' not found")
            return False

        folder = self._folders_cache[folder_key]

        # Check if channel already in folder
        channel_peer = InputPeerChannel(
            channel_id=channel_entity.id,
            access_hash=channel_entity.access_hash,
        )

        # Get current include_peers
        current_peers = list(folder.include_peers)

        # Check if already included
        for peer in current_peers:
            if hasattr(peer, "channel_id") and peer.channel_id == channel_entity.id:
                logger.debug(f"Channel already in folder '{folder_name}'")
                return True

        # Add channel to folder
        current_peers.append(channel_peer)

        try:
            from telethon.tl.types import TextWithEntities

            await self.client(
                UpdateDialogFilterRequest(
                    id=folder.id,
                    filter=DialogFilter(
                        id=folder.id,
                        title=TextWithEntities(text=folder.title.text, entities=[]),
                        pinned_peers=list(folder.pinned_peers),
                        include_peers=current_peers,
                        exclude_peers=list(folder.exclude_peers),
                        contacts=folder.contacts,
                        non_contacts=folder.non_contacts,
                        groups=folder.groups,
                        broadcasts=folder.broadcasts,
                        bots=folder.bots,
                        exclude_muted=folder.exclude_muted,
                        exclude_read=folder.exclude_read,
                        exclude_archived=folder.exclude_archived,
                    ),
                )
            )

            logger.info(f"Added channel {channel_entity.title} to folder '{folder_name}'")

            # Refresh cache
            await self.refresh_cache()

            return True

        except FloodWaitError:
            raise
        except Exception as e:
            logger.error(f"Failed to add channel to folder: {e}")
            return False

    async def _update_folder_id(
        self, session: AsyncSession, folder_name: str, telegram_id: int
    ):
        """Update the telegram_folder_id in monitored_folders table."""
        await session.execute(
            update(MonitoredFolder)
            .where(MonitoredFolder.folder_name == folder_name)
            .values(telegram_folder_id=telegram_id)
        )
        await session.commit()
```

**Step 2: Commit**

```bash
git add services/listener/src/folder_manager.py
git commit -m "feat(listener): add Telegram folder manager"
```

---

## Task 9: Listener - Import Processor

**Files:**
- Create: `services/listener/src/import_processor.py`

**Step 1: Create the import processor module**

```python
# services/listener/src/import_processor.py
"""
Import Processor - Background channel joining

Processes the import:join_queue to join channels via Telegram API.
Uses conservative rate limiting (45s between joins) to avoid bans.
"""

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import (
    ChannelPrivateError,
    FloodWaitError,
    UserBannedInChannelError,
    InviteHashExpiredError,
    InviteHashInvalidError,
    UserAlreadyParticipantError,
)
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest
from telethon.tl.types import Channel as TelegramChannel

from models import ImportJob, ImportJobChannel, ImportJobLog
from models.base import AsyncSessionLocal

from .folder_manager import FolderManager

logger = logging.getLogger(__name__)


class ImportProcessor:
    """
    Processes channel join queue with rate limiting.

    Joins channels one at a time with 45-second delays.
    Handles errors, retries, and folder assignment.
    """

    JOIN_INTERVAL_SECONDS = 45
    MAX_RETRIES = 3

    def __init__(
        self,
        client: TelegramClient,
        redis_client,
        folder_manager: FolderManager,
    ):
        self.client = client
        self.redis = redis_client
        self.folder_manager = folder_manager
        self._running = False

    async def start(self):
        """Start the import processor."""
        self._running = True
        logger.info("Import processor started")

        while self._running:
            try:
                await self._process_queue()
            except FloodWaitError as e:
                logger.warning(f"FloodWait in processor: {e.seconds}s")
                await asyncio.sleep(e.seconds)
            except Exception as e:
                logger.exception(f"Error in processor loop: {e}")

            await asyncio.sleep(5)  # Poll interval

    async def stop(self):
        """Stop the import processor."""
        self._running = False
        logger.info("Import processor stopped")

    async def _process_queue(self):
        """Process one item from join queue if ready."""
        now = time.time()

        # Get next scheduled item
        items = await self.redis.zrangebyscore(
            "import:join_queue",
            min=0,
            max=now,
            start=0,
            num=1,
        )

        if not items:
            return

        item = items[0]

        # Remove from queue
        await self.redis.zrem("import:join_queue", item)

        try:
            payload = json.loads(item)
        except json.JSONDecodeError:
            logger.error(f"Invalid queue item: {item}")
            return

        job_id = payload.get("job_id")
        channel_id = payload.get("channel_id")
        username = payload.get("channel_username")
        target_folder = payload.get("target_folder")
        attempt = payload.get("attempt", 0)

        logger.info(f"Processing join: @{username} → {target_folder}")

        async with AsyncSessionLocal() as session:
            await self._join_channel(
                session, job_id, channel_id, username, target_folder, attempt
            )

    async def _join_channel(
        self,
        session: AsyncSession,
        job_id: str,
        channel_id: str,
        username: str,
        target_folder: Optional[str],
        attempt: int,
    ):
        """Join a single channel and update database."""
        import uuid

        try:
            job_uuid = uuid.UUID(job_id)
            channel_uuid = uuid.UUID(channel_id)
        except ValueError:
            logger.error(f"Invalid UUIDs: job={job_id}, channel={channel_id}")
            return

        # Get channel record
        result = await session.execute(
            select(ImportJobChannel).where(ImportJobChannel.id == channel_uuid)
        )
        channel = result.scalar_one_or_none()

        if not channel:
            logger.error(f"Channel record not found: {channel_id}")
            return

        # Check job status
        job = await session.get(ImportJob, job_uuid)
        if not job or job.status == "cancelled":
            logger.info(f"Job {job_id} cancelled, skipping channel")
            channel.status = "skipped"
            job.skipped_channels += 1
            await session.commit()
            return

        channel.status = "joining"
        await session.commit()

        try:
            # Join the channel
            entity = await self.client(JoinChannelRequest(username))

            if isinstance(entity.chats[0], TelegramChannel):
                channel_entity = entity.chats[0]

                # Add to folder if specified
                if target_folder:
                    # Ensure folder exists
                    await self.folder_manager.get_or_create_folder(
                        target_folder, session
                    )
                    # Add channel to folder
                    await self.folder_manager.add_channel_to_folder(
                        channel_entity, target_folder
                    )

                # Success
                channel.status = "joined"
                channel.joined_at = datetime.utcnow()
                channel.error_message = None
                channel.error_code = None
                job.joined_channels += 1

                await self._log_event(
                    session, job_uuid, channel_uuid, "success", "JOINED",
                    f"Joined @{username}" + (f" → {target_folder}" if target_folder else "")
                )

                logger.info(f"Joined @{username}")

        except UserAlreadyParticipantError:
            channel.status = "joined"
            channel.joined_at = datetime.utcnow()
            channel.error_code = "ALREADY_MEMBER"
            channel.error_message = "Already a member"
            job.joined_channels += 1

            await self._log_event(
                session, job_uuid, channel_uuid, "info", "ALREADY_MEMBER",
                f"Already member of @{username}"
            )

        except ChannelPrivateError:
            channel.status = "failed"
            channel.error_code = "CHANNEL_PRIVATE"
            channel.error_message = "Channel is private"
            job.failed_channels += 1

            await self._log_event(
                session, job_uuid, channel_uuid, "error", "CHANNEL_PRIVATE",
                f"Cannot join @{username} - private channel"
            )

        except UserBannedInChannelError:
            channel.status = "failed"
            channel.error_code = "USER_BANNED"
            channel.error_message = "Banned from this channel"
            job.failed_channels += 1

            await self._log_event(
                session, job_uuid, channel_uuid, "error", "USER_BANNED",
                f"Banned from @{username}"
            )

        except FloodWaitError as e:
            # Re-queue with delay
            channel.status = "queued"
            channel.retry_count += 1

            await self._log_event(
                session, job_uuid, channel_uuid, "warning", "FLOOD_WAIT",
                f"Rate limited, waiting {e.seconds}s before retrying @{username}"
            )

            # Re-add to queue with wait time
            reschedule_time = time.time() + e.seconds + 5
            await self.redis.zadd(
                "import:join_queue",
                {
                    json.dumps({
                        "job_id": job_id,
                        "channel_id": channel_id,
                        "channel_username": username,
                        "target_folder": target_folder,
                        "attempt": attempt + 1,
                    }): reschedule_time
                },
            )

            logger.warning(f"FloodWait for @{username}, rescheduled in {e.seconds}s")

        except Exception as e:
            error_msg = str(e)[:500]

            if attempt < self.MAX_RETRIES:
                # Retry
                channel.status = "queued"
                channel.retry_count += 1

                reschedule_time = time.time() + 60 * (attempt + 1)
                await self.redis.zadd(
                    "import:join_queue",
                    {
                        json.dumps({
                            "job_id": job_id,
                            "channel_id": channel_id,
                            "channel_username": username,
                            "target_folder": target_folder,
                            "attempt": attempt + 1,
                        }): reschedule_time
                    },
                )

                await self._log_event(
                    session, job_uuid, channel_uuid, "warning", "RETRY",
                    f"Error joining @{username}, retrying: {error_msg}"
                )
            else:
                # Max retries exceeded
                channel.status = "failed"
                channel.error_code = "JOIN_ERROR"
                channel.error_message = error_msg
                job.failed_channels += 1

                await self._log_event(
                    session, job_uuid, channel_uuid, "error", "JOIN_FAILED",
                    f"Failed to join @{username}: {error_msg}"
                )

        await session.commit()

        # Check if job is complete
        await self._check_job_completion(session, job)

    async def _check_job_completion(self, session: AsyncSession, job: ImportJob):
        """Check if all channels are processed and update job status."""
        completed = job.joined_channels + job.failed_channels + job.skipped_channels

        if completed >= job.total_channels:
            job.status = "completed"
            job.completed_at = datetime.utcnow()

            await self._log_event(
                session, job.id, None, "success", "IMPORT_COMPLETE",
                f"Import complete: {job.joined_channels} joined, "
                f"{job.failed_channels} failed, {job.skipped_channels} skipped"
            )

            await session.commit()
            logger.info(f"Import job {job.id} completed")

    async def _log_event(
        self,
        session: AsyncSession,
        job_id,
        channel_id,
        event_type: str,
        event_code: str,
        message: str,
    ):
        """Log an event to import_job_logs."""
        log = ImportJobLog(
            import_job_id=job_id,
            channel_id=channel_id,
            event_type=event_type,
            event_code=event_code,
            message=message,
        )
        session.add(log)
```

**Step 2: Commit**

```bash
git add services/listener/src/import_processor.py
git commit -m "feat(listener): add import channel processor with rate limiting"
```

---

## Task 10: Listener - Integration

**Files:**
- Modify: `services/listener/src/main.py`
- Modify: `services/listener/src/channel_discovery.py`

**Step 1: Update channel_discovery.py to check monitored_folders**

Add method to `ChannelDiscovery` class:

```python
async def _load_monitored_folders(self, session: AsyncSession) -> dict[str, str]:
    """Load monitored folders from database."""
    from models import MonitoredFolder

    result = await session.execute(
        select(MonitoredFolder).where(MonitoredFolder.active == True)
    )
    folders = result.scalars().all()

    return {f.folder_name.lower(): f.rule for f in folders}


def _get_rule_for_folder(self, folder_name: str) -> Optional[str]:
    """
    Check if folder name matches any monitored pattern.

    Checks both env pattern and database-stored folders.
    """
    # Check env pattern first (backwards compatible)
    if folder_name.lower() == settings.FOLDER_ARCHIVE_ALL_PATTERN.lower():
        return "archive_all"

    # Check database folders (loaded in memory)
    if hasattr(self, "_monitored_folders") and self._monitored_folders:
        folder_key = folder_name.lower()
        if folder_key in self._monitored_folders:
            return self._monitored_folders[folder_key]

    return None
```

Update `start_background_sync` to load monitored folders each cycle:

```python
async def start_background_sync(self, interval_seconds: int = 300):
    # ... existing code ...

    while True:
        try:
            # Load monitored folders from database
            async with AsyncSessionLocal() as session:
                self._monitored_folders = await self._load_monitored_folders(session)
                logger.debug(f"Loaded {len(self._monitored_folders)} monitored folders from DB")

            # Discover channels from folders
            channels = await self.discover_channels()
            # ... rest of existing code ...
```

**Step 2: Update main.py to initialize import components**

Add to imports:

```python
from .import_validator import ImportValidator
from .import_processor import ImportProcessor
from .folder_manager import FolderManager
```

Add initialization after ChannelDiscovery (around step 8-9):

```python
# Step 8b: Initialize FolderManager
logger.info("8b. Initializing folder manager...")
folder_manager = FolderManager(client)
await folder_manager.refresh_cache()

# Step 8c: Initialize ImportValidator
logger.info("8c. Initializing import validator...")
import_validator = ImportValidator(client, redis_client)

# Step 8d: Initialize ImportProcessor
logger.info("8d. Initializing import processor...")
import_processor = ImportProcessor(client, redis_client, folder_manager)
```

Add background tasks:

```python
# Start import components
validator_task = asyncio.create_task(import_validator.start())
processor_task = asyncio.create_task(import_processor.start())
```

Add shutdown:

```python
# Stop import components
await import_validator.stop()
await import_processor.stop()
validator_task.cancel()
processor_task.cancel()
```

**Step 3: Commit**

```bash
git add services/listener/src/main.py services/listener/src/channel_discovery.py
git commit -m "feat(listener): integrate import validator and processor"
```

---

## Task 11: Frontend - Import Page

**Files:**
- Create: `services/frontend/app/admin/import/page.tsx`

**Step 1: Create the import page**

```tsx
// services/frontend/app/admin/import/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

interface ImportJob {
  id: string;
  filename: string;
  status: string;
  total_channels: number;
  validated_channels: number;
  joined_channels: number;
  failed_channels: number;
  skipped_channels: number;
  progress_percent: number;
  created_at: string;
  channels_by_folder: Record<string, ChannelEntry[]>;
}

interface ChannelEntry {
  id: string;
  channel_url: string;
  channel_username: string | null;
  channel_name: string | null;
  target_folder: string | null;
  status: string;
  validation_data: {
    valid?: boolean;
    title?: string;
    subscribers?: number;
    already_member?: boolean;
    is_private?: boolean;
  } | null;
  error_message: string | null;
  error_code: string | null;
  selected: boolean;
}

interface LogEntry {
  id: number;
  event_type: string;
  event_code: string | null;
  message: string;
  created_at: string;
}

export default function ImportPage() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [activeJob, setActiveJob] = useState<ImportJob | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Fetch jobs list
  const fetchJobs = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/import/jobs?page=1&page_size=10');
      setJobs(data.jobs || []);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch active job details
  const fetchJobDetails = useCallback(async (jobId: string) => {
    try {
      const [jobData, logData] = await Promise.all([
        adminApi.get(`/api/admin/import/${jobId}`),
        adminApi.get(`/api/admin/import/${jobId}/log?limit=50`),
      ]);
      setActiveJob(jobData);
      setLogs(logData.logs || []);
    } catch (err) {
      console.error('Failed to fetch job details:', err);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Auto-refresh for active job
  useEffect(() => {
    if (!activeJob) return;
    if (activeJob.status === 'completed' || activeJob.status === 'failed') return;

    const interval = setInterval(() => {
      fetchJobDetails(activeJob.id);
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJob, fetchJobDetails]);

  // Handle file upload
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/admin/import/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Upload failed');
      }

      const data = await response.json();
      await fetchJobs();
      await fetchJobDetails(data.job_id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Start validation
  const startValidation = async () => {
    if (!activeJob) return;
    try {
      await adminApi.post(`/api/admin/import/${activeJob.id}/validate`);
      await fetchJobDetails(activeJob.id);
    } catch (err) {
      console.error('Failed to start validation:', err);
    }
  };

  // Start import
  const startImport = async () => {
    if (!activeJob) return;
    try {
      await adminApi.post(`/api/admin/import/${activeJob.id}/start`);
      await fetchJobDetails(activeJob.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start import');
    }
  };

  // Toggle channel selection
  const toggleChannel = async (channelId: string, selected: boolean) => {
    if (!activeJob) return;
    try {
      await adminApi.patch(`/api/admin/import/${activeJob.id}/channels`, {
        channel_ids: [channelId],
        selected,
      });
      await fetchJobDetails(activeJob.id);
    } catch (err) {
      console.error('Failed to update channel:', err);
    }
  };

  // Toggle all in folder
  const toggleFolder = async (folder: string, selected: boolean) => {
    if (!activeJob) return;
    const channels = activeJob.channels_by_folder[folder] || [];
    try {
      await adminApi.patch(`/api/admin/import/${activeJob.id}/channels`, {
        channel_ids: channels.map(c => c.id),
        selected,
      });
      await fetchJobDetails(activeJob.id);
    } catch (err) {
      console.error('Failed to update folder:', err);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
      completed: 'success',
      processing: 'info',
      validating: 'info',
      ready: 'warning',
      failed: 'danger',
      cancelled: 'default',
    };
    return <Badge variant={variants[status] || 'default'} size="sm">{status}</Badge>;
  };

  const getChannelStatus = (ch: ChannelEntry) => {
    if (ch.status === 'joined') return <span className="text-green-500">✓ Joined</span>;
    if (ch.status === 'failed') return <span className="text-red-500">✗ {ch.error_code}</span>;
    if (ch.status === 'joining') return <span className="text-blue-500">⟳ Joining...</span>;
    if (ch.status === 'queued') return <span className="text-yellow-500">⏳ Queued</span>;
    if (ch.validation_data?.already_member) return <span className="text-gray-500">Already member</span>;
    if (ch.validation_data?.is_private) return <span className="text-orange-500">Private</span>;
    if (ch.error_code) return <span className="text-red-500">{ch.error_code}</span>;
    if (ch.validation_data?.valid) return <span className="text-green-500">✓ Valid</span>;
    return <span className="text-gray-400">Pending</span>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Channel Import</h1>
          <p className="text-text-secondary mt-1">
            Import channels from CSV files
          </p>
        </div>
        <label className="cursor-pointer">
          <input
            type="file"
            accept=".csv"
            onChange={handleUpload}
            className="hidden"
            disabled={uploading}
          />
          <span className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
            {uploading ? 'Uploading...' : 'Upload CSV'}
          </span>
        </label>
      </div>

      {/* Active Job Details */}
      {activeJob && (
        <div className="glass p-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-text-primary">
                {activeJob.filename}
              </h2>
              {getStatusBadge(activeJob.status)}
            </div>
            <button
              onClick={() => setActiveJob(null)}
              className="text-text-tertiary hover:text-text-primary"
            >
              ✕
            </button>
          </div>

          {/* Progress */}
          {(activeJob.status === 'validating' || activeJob.status === 'processing') && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-text-secondary mb-1">
                <span>
                  {activeJob.status === 'validating'
                    ? `Validating: ${activeJob.validated_channels}/${activeJob.total_channels}`
                    : `Joining: ${activeJob.joined_channels + activeJob.failed_channels}/${activeJob.total_channels}`}
                </span>
                <span>{activeJob.progress_percent.toFixed(0)}%</span>
              </div>
              <div className="w-full bg-bg-tertiary rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${activeJob.progress_percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-4">
            <StatCard title="Total" value={activeJob.total_channels} />
            <StatCard title="Validated" value={activeJob.validated_channels} />
            <StatCard title="Joined" value={activeJob.joined_channels} />
            <StatCard title="Failed" value={activeJob.failed_channels} />
          </div>

          {/* Actions */}
          {activeJob.status === 'ready' && (
            <div className="flex gap-3 mb-4">
              <button
                onClick={startValidation}
                className="px-4 py-2 bg-bg-secondary rounded hover:bg-bg-tertiary"
              >
                Validate Channels
              </button>
              <button
                onClick={startImport}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Start Import
              </button>
            </div>
          )}

          {/* Channels by Folder */}
          <div className="space-y-4">
            {Object.entries(activeJob.channels_by_folder).map(([folder, channels]) => {
              const selectedCount = channels.filter(c => c.selected).length;
              return (
                <div key={folder} className="bg-bg-secondary rounded p-4">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-medium text-text-primary">
                      {folder} ({channels.length})
                    </h3>
                    <button
                      onClick={() => toggleFolder(folder, selectedCount < channels.length)}
                      className="text-sm text-blue-500 hover:underline"
                    >
                      {selectedCount === channels.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {channels.map(ch => (
                      <div
                        key={ch.id}
                        className="flex items-center gap-3 text-sm py-1"
                      >
                        <input
                          type="checkbox"
                          checked={ch.selected}
                          onChange={(e) => toggleChannel(ch.id, e.target.checked)}
                          disabled={activeJob.status === 'processing'}
                          className="rounded"
                        />
                        <span className="text-text-primary flex-1">
                          @{ch.channel_username || ch.channel_url}
                        </span>
                        <span className="text-text-tertiary">
                          {ch.validation_data?.subscribers?.toLocaleString() || '—'}
                        </span>
                        {getChannelStatus(ch)}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Log */}
          {logs.length > 0 && (
            <div className="mt-4">
              <h3 className="font-medium text-text-primary mb-2">Import Log</h3>
              <div className="bg-bg-tertiary rounded p-3 max-h-48 overflow-y-auto text-sm font-mono">
                {logs.map(log => (
                  <div key={log.id} className="flex gap-2">
                    <span className="text-text-tertiary">
                      {new Date(log.created_at).toLocaleTimeString()}
                    </span>
                    <span className={
                      log.event_type === 'error' ? 'text-red-500' :
                      log.event_type === 'warning' ? 'text-yellow-500' :
                      log.event_type === 'success' ? 'text-green-500' :
                      'text-text-secondary'
                    }>
                      {log.message}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Jobs List */}
      <div className="glass p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-4">Import History</h2>
        {loading ? (
          <div className="animate-pulse space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-bg-secondary rounded" />
            ))}
          </div>
        ) : jobs.length > 0 ? (
          <div className="space-y-2">
            {jobs.map(job => (
              <div
                key={job.id}
                onClick={() => fetchJobDetails(job.id)}
                className="flex items-center justify-between p-3 bg-bg-secondary rounded cursor-pointer hover:bg-bg-tertiary"
              >
                <div className="flex items-center gap-3">
                  {getStatusBadge(job.status)}
                  <span className="text-text-primary">{job.filename}</span>
                  <span className="text-text-tertiary text-sm">
                    {job.total_channels} channels
                  </span>
                </div>
                <span className="text-text-tertiary text-sm">
                  {new Date(job.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center text-text-tertiary py-8">
            No imports yet. Upload a CSV to get started.
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Add to admin navigation**

Update `services/frontend/components/admin/AdminNav.tsx` to include import link:

```tsx
{ href: '/admin/import', label: 'Import', icon: '📥' },
```

**Step 3: Commit**

```bash
git add services/frontend/app/admin/import/page.tsx services/frontend/components/admin/AdminNav.tsx
git commit -m "feat(frontend): add channel import admin page"
```

---

## Task 12: Testing and Validation

**Step 1: Build and start services**

```bash
docker-compose build api listener frontend
docker-compose up -d postgres redis minio api listener frontend
```

**Step 2: Run database migration**

```bash
docker-compose exec postgres psql -U osint_user -d osint_platform -f /docker-entrypoint-initdb.d/migrations/002_import_tables.sql
```

**Step 3: Test CSV upload via API**

```bash
curl -X POST http://localhost:8000/api/admin/import/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@USTelegram.csv"
```

**Step 4: Access frontend**

Open http://localhost:3000/admin/import and test the upload flow.

**Step 5: Verify logs**

```bash
docker-compose logs -f listener
```

Look for "Import validator started" and "Import processor started".

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete channel import feature implementation"
```

---

## Summary

This plan implements:

1. **Database layer** - MonitoredFolder, ImportJob, ImportJobChannel, ImportJobLog models
2. **API layer** - Upload, validate, start, and management endpoints
3. **Listener layer** - Validator (Telegram lookups), Processor (channel joining), FolderManager (folder creation)
4. **Frontend layer** - Import page with upload, selection, and progress tracking
5. **Integration** - ChannelDiscovery extended to use monitored_folders table

The implementation respects Telegram rate limits with 45-second join intervals and batch validation with delays.
