"""
Admin Import Router - Channel import job management

Endpoints:
- POST /api/admin/import/upload - Upload CSV file and create import job
- GET /api/admin/import/jobs - List all import jobs (paginated)
- GET /api/admin/import/{job_id} - Get job details with channels by folder
- PATCH /api/admin/import/{job_id}/channels - Update channel selection/folder
- GET /api/admin/import/{job_id}/log - Get event log for job
- DELETE /api/admin/import/{job_id} - Cancel or delete job

Workflow:
1. User uploads CSV with channel URLs
2. System parses and creates ImportJob + ImportJobChannel records
3. Validation phase (Task 6) checks channel accessibility
4. User reviews and selects channels
5. Processing phase (Task 7) joins selected channels
"""

import codecs
import csv
import io
import logging
import re
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import Channel, ImportJob, ImportJobChannel, ImportJobLog

from ...database import get_db
from ...dependencies import AdminUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/import", tags=["Admin - Import"])

# Maximum file size (5MB)
MAX_FILE_SIZE = 5 * 1024 * 1024


# =============================================================================
# Pydantic Schemas
# =============================================================================


class UploadResponse(BaseModel):
    """Response after uploading a CSV file."""

    job_id: str
    filename: str
    total_channels: int
    detected_folders: list[str]
    has_folder_column: bool


class ChannelResponse(BaseModel):
    """Single channel within an import job."""

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


class ImportJobCounters(BaseModel):
    """Progress counters for an import job."""

    total: int
    validated: int
    joined: int
    failed: int
    skipped: int


class ImportJobResponse(BaseModel):
    """Detailed import job response with channels grouped by folder."""

    id: str
    filename: str
    status: str
    counters: ImportJobCounters
    progress_percent: float
    created_at: str
    updated_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    channels_by_folder: dict[str, list[ChannelResponse]]


class ImportJobSummary(BaseModel):
    """Summary of an import job for list view."""

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
    """Request to update channel selection or folder assignment."""

    channel_ids: list[str] = Field(..., description="List of channel UUIDs to update")
    selected: Optional[bool] = Field(None, description="Set selection state")
    target_folder: Optional[str] = Field(None, description="Set target folder")


class LogEntry(BaseModel):
    """Single log entry."""

    id: int
    event_type: str
    event_code: Optional[str] = None
    message: str
    created_at: str


class LogResponse(BaseModel):
    """Paginated log entries."""

    logs: list[LogEntry]
    total: int


# =============================================================================
# Helper Functions
# =============================================================================


def extract_username_from_url(url: str) -> Optional[str]:
    """
    Extract Telegram username from various URL formats.

    Supported formats:
    - https://t.me/username
    - https://telegram.me/username
    - http://t.me/username
    - t.me/username
    - @username
    - username (plain)

    Returns None for invite links (+hash) or joinchat links.
    """
    if not url:
        return None

    url = url.strip()

    # Skip invite links
    if "+joinchat" in url.lower() or "/joinchat/" in url.lower():
        return None

    # Handle +hash invite links (t.me/+abc123)
    if re.search(r"t\.me/\+[A-Za-z0-9_-]+", url):
        return None

    # Handle @username format
    if url.startswith("@"):
        username = url[1:]
        # Validate username format (5-32 chars, alphanumeric + underscore)
        if re.match(r"^[A-Za-z][A-Za-z0-9_]{4,31}$", username):
            return username.lower()
        return None

    # Handle URL formats
    patterns = [
        r"(?:https?://)?(?:www\.)?t\.me/([A-Za-z][A-Za-z0-9_]{4,31})(?:/.*)?$",
        r"(?:https?://)?(?:www\.)?telegram\.me/([A-Za-z][A-Za-z0-9_]{4,31})(?:/.*)?$",
    ]

    for pattern in patterns:
        match = re.match(pattern, url, re.IGNORECASE)
        if match:
            return match.group(1).lower()

    # Handle plain username (no @ or URL)
    if re.match(r"^[A-Za-z][A-Za-z0-9_]{4,31}$", url):
        return url.lower()

    return None


def parse_csv_content(
    content: bytes, filename: str
) -> tuple[list[dict], list[str], bool]:
    """
    Parse CSV content with flexible header detection.

    Handles:
    - UTF-8 BOM
    - Various header names (Channel, URL, channel_url, etc.)
    - Optional Name and Folder columns
    - Excel-style CSV with BOM

    Returns:
        (channels, detected_folders, has_folder_column)
        - channels: List of dicts with keys: url, name, folder
        - detected_folders: Unique folder names found
        - has_folder_column: Whether CSV had a folder column
    """
    # Handle UTF-8 BOM
    if content.startswith(codecs.BOM_UTF8):
        content = content[len(codecs.BOM_UTF8) :]

    # Decode to string
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = content.decode("latin-1")

    # Parse CSV
    reader = csv.DictReader(io.StringIO(text))

    # Normalize header names to find relevant columns
    fieldnames = reader.fieldnames or []
    header_map = {name.lower().strip(): name for name in fieldnames}

    # Find URL column (required)
    url_column = None
    url_candidates = ["channel", "url", "channel_url", "link", "telegram", "channel url"]
    for candidate in url_candidates:
        if candidate in header_map:
            url_column = header_map[candidate]
            break

    if not url_column:
        # Try first column as fallback
        if fieldnames:
            url_column = fieldnames[0]
        else:
            raise ValueError("CSV must have at least one column with channel URLs")

    # Find Name column (optional)
    name_column = None
    name_candidates = ["name", "channel_name", "title", "channel name"]
    for candidate in name_candidates:
        if candidate in header_map:
            name_column = header_map[candidate]
            break

    # Find Folder column (optional)
    folder_column = None
    folder_candidates = ["folder", "category", "group", "target_folder", "target folder"]
    for candidate in folder_candidates:
        if candidate in header_map:
            folder_column = header_map[candidate]
            break

    has_folder_column = folder_column is not None

    # Parse rows
    channels = []
    folders_set = set()

    for row in reader:
        url = row.get(url_column, "").strip()
        if not url:
            continue

        name = row.get(name_column, "").strip() if name_column else ""
        folder = row.get(folder_column, "").strip() if folder_column else ""

        channels.append({"url": url, "name": name or None, "folder": folder or None})

        if folder:
            folders_set.add(folder)

    return channels, sorted(folders_set), has_folder_column


def channel_to_response(channel: ImportJobChannel) -> ChannelResponse:
    """Convert ImportJobChannel to API response."""
    return ChannelResponse(
        id=str(channel.id),
        channel_url=channel.channel_url,
        channel_username=channel.channel_username,
        channel_name=channel.channel_name,
        target_folder=channel.target_folder,
        status=channel.status,
        validation_data=channel.validation_data,
        error_message=channel.error_message,
        error_code=channel.error_code,
        selected=channel.selected,
    )


def job_to_summary(job: ImportJob) -> ImportJobSummary:
    """Convert ImportJob to summary response."""
    return ImportJobSummary(
        id=str(job.id),
        filename=job.filename,
        status=job.status,
        total_channels=job.total_channels,
        joined_channels=job.joined_channels,
        failed_channels=job.failed_channels,
        progress_percent=float(job.progress_percent),
        created_at=job.created_at.isoformat() if job.created_at else "",
    )


def job_to_response(job: ImportJob) -> ImportJobResponse:
    """Convert ImportJob to detailed response with channels grouped by folder."""
    # Group channels by folder
    channels_by_folder: dict[str, list[ChannelResponse]] = defaultdict(list)

    for channel in job.channels:
        folder_key = channel.target_folder or "(No Folder)"
        channels_by_folder[folder_key].append(channel_to_response(channel))

    return ImportJobResponse(
        id=str(job.id),
        filename=job.filename,
        status=job.status,
        counters=ImportJobCounters(
            total=job.total_channels,
            validated=job.validated_channels,
            joined=job.joined_channels,
            failed=job.failed_channels,
            skipped=job.skipped_channels,
        ),
        progress_percent=float(job.progress_percent),
        created_at=job.created_at.isoformat() if job.created_at else "",
        updated_at=job.updated_at.isoformat() if job.updated_at else "",
        started_at=job.started_at.isoformat() if job.started_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        channels_by_folder=dict(channels_by_folder),
    )


async def add_job_log(
    db: AsyncSession,
    job_id: uuid.UUID,
    event_type: str,
    message: str,
    event_code: Optional[str] = None,
    channel_id: Optional[uuid.UUID] = None,
) -> None:
    """Add a log entry to an import job."""
    log_entry = ImportJobLog(
        import_job_id=job_id,
        channel_id=channel_id,
        event_type=event_type,
        event_code=event_code,
        message=message,
    )
    db.add(log_entry)


# =============================================================================
# API Endpoints
# =============================================================================


@router.post("/upload", response_model=UploadResponse)
async def upload_csv(
    request: Request,
    admin: AdminUser,
    file: UploadFile = File(..., description="CSV file with channel URLs"),
    db: AsyncSession = Depends(get_db),
) -> UploadResponse:
    """
    Upload a CSV file to create a new import job.

    The CSV should have columns:
    - Channel/URL (required): Channel URL or username
    - Name (optional): Display name for the channel
    - Folder (optional): Target Telegram folder

    Supports UTF-8 and UTF-8-BOM encoded files.
    """
    # Validate file type
    if not file.filename:
        raise HTTPException(status_code=400, detail="Filename is required")

    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400, detail="Only CSV files are supported"
        )

    # Read file content
    content = await file.read()

    # Check file size
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // 1024 // 1024}MB",
        )

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="File is empty")

    # Parse CSV
    try:
        channels, detected_folders, has_folder_column = parse_csv_content(
            content, file.filename
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"CSV parsing error: {e}")
        raise HTTPException(status_code=400, detail="Failed to parse CSV file")

    if not channels:
        raise HTTPException(
            status_code=400, detail="No valid channels found in CSV file"
        )

    # Check for existing channels in database
    existing_usernames: set[str] = set()
    usernames_to_check = [
        extract_username_from_url(c["url"]) for c in channels
    ]
    usernames_to_check = [u for u in usernames_to_check if u]

    if usernames_to_check:
        result = await db.execute(
            select(Channel.username).where(
                Channel.username.in_(usernames_to_check)
            )
        )
        existing_usernames = {r[0].lower() for r in result.fetchall() if r[0]}

    # Create import job
    job = ImportJob(
        filename=file.filename,
        status="uploading",
        total_channels=len(channels),
        created_by_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    db.add(job)
    await db.flush()  # Get job.id

    # Create channel records
    for channel_data in channels:
        username = extract_username_from_url(channel_data["url"])

        channel = ImportJobChannel(
            import_job_id=job.id,
            channel_url=channel_data["url"],
            channel_username=username,
            channel_name=channel_data["name"],
            target_folder=channel_data["folder"],
            status="pending",
            selected=True,
        )

        # Pre-mark channels that already exist in database
        if username and username.lower() in existing_usernames:
            channel.validation_data = {"already_in_db": True}

        db.add(channel)

    # Add initial log entry
    await add_job_log(
        db,
        job.id,
        event_type="info",
        event_code="JOB_CREATED",
        message=f"Import job created with {len(channels)} channels from {file.filename}",
    )

    # Update job status to ready for validation
    job.status = "uploading"

    await db.commit()
    await db.refresh(job)

    logger.info(
        f"Created import job {job.id}: filename={file.filename}, "
        f"channels={len(channels)}, folders={len(detected_folders)}"
    )

    return UploadResponse(
        job_id=str(job.id),
        filename=file.filename,
        total_channels=len(channels),
        detected_folders=detected_folders,
        has_folder_column=has_folder_column,
    )


@router.get("/jobs", response_model=ImportJobListResponse)
async def list_import_jobs(
    admin: AdminUser,
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    status: Optional[str] = Query(
        default=None,
        description="Filter by status: uploading, validating, ready, processing, completed, failed, cancelled",
    ),
    db: AsyncSession = Depends(get_db),
) -> ImportJobListResponse:
    """
    List all import jobs with pagination.

    Ordered by creation date (newest first).
    """
    # Build query
    query = select(ImportJob).order_by(ImportJob.created_at.desc())

    if status:
        valid_statuses = [
            "uploading",
            "validating",
            "ready",
            "processing",
            "completed",
            "failed",
            "cancelled",
        ]
        if status not in valid_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of: {valid_statuses}",
            )
        query = query.where(ImportJob.status == status)

    # Get total count
    count_query = select(func.count(ImportJob.id))
    if status:
        count_query = count_query.where(ImportJob.status == status)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    jobs = result.scalars().all()

    return ImportJobListResponse(
        jobs=[job_to_summary(job) for job in jobs],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{job_id}", response_model=ImportJobResponse)
async def get_import_job(
    job_id: str,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> ImportJobResponse:
    """
    Get detailed status of an import job with channels grouped by folder.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    result = await db.execute(
        select(ImportJob).where(ImportJob.id == job_uuid)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    return job_to_response(job)


@router.patch("/{job_id}/channels")
async def update_channels(
    job_id: str,
    update_request: ChannelUpdateRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """
    Update channel selection or folder assignment.

    Can either:
    - Set selection state (selected: true/false) for channels
    - Set target folder for channels

    Both can be done in the same request.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    # Verify job exists and is in a valid state for updates
    result = await db.execute(
        select(ImportJob).where(ImportJob.id == job_uuid)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    if job.status not in ("uploading", "validating", "ready"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot update channels when job is in '{job.status}' state",
        )

    # Parse channel IDs
    try:
        channel_uuids = [uuid.UUID(cid) for cid in update_request.channel_ids]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid channel ID format")

    if not channel_uuids:
        raise HTTPException(status_code=400, detail="No channel IDs provided")

    # Build update values
    update_values: dict[str, Any] = {}
    if update_request.selected is not None:
        update_values["selected"] = update_request.selected
    if update_request.target_folder is not None:
        update_values["target_folder"] = update_request.target_folder

    if not update_values:
        raise HTTPException(
            status_code=400,
            detail="Must provide either 'selected' or 'target_folder' to update",
        )

    # Update channels
    update_stmt = (
        update(ImportJobChannel)
        .where(
            and_(
                ImportJobChannel.import_job_id == job_uuid,
                ImportJobChannel.id.in_(channel_uuids),
            )
        )
        .values(**update_values)
    )

    result = await db.execute(update_stmt)
    updated_count = result.rowcount

    # Log the update
    action_parts = []
    if update_request.selected is not None:
        action_parts.append(f"selected={update_request.selected}")
    if update_request.target_folder is not None:
        action_parts.append(f"folder={update_request.target_folder}")

    await add_job_log(
        db,
        job_uuid,
        event_type="info",
        event_code="CHANNELS_UPDATED",
        message=f"Updated {updated_count} channels: {', '.join(action_parts)}",
    )

    await db.commit()

    return {
        "message": "Channels updated successfully",
        "updated_count": updated_count,
    }


@router.get("/{job_id}/log", response_model=LogResponse)
async def get_job_log(
    job_id: str,
    admin: AdminUser,
    event_type: Optional[str] = Query(
        None, description="Filter by event type: info, warning, error, success"
    ),
    limit: int = Query(100, ge=1, le=1000, description="Maximum entries to return"),
    db: AsyncSession = Depends(get_db),
) -> LogResponse:
    """
    Get event log for an import job.

    Returns entries ordered by creation time (newest first).
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    # Verify job exists
    job_result = await db.execute(
        select(ImportJob.id).where(ImportJob.id == job_uuid)
    )
    if not job_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Import job not found")

    # Build query
    query = (
        select(ImportJobLog)
        .where(ImportJobLog.import_job_id == job_uuid)
        .order_by(ImportJobLog.created_at.desc())
    )

    if event_type:
        valid_types = ["info", "warning", "error", "success"]
        if event_type not in valid_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid event_type. Must be one of: {valid_types}",
            )
        query = query.where(ImportJobLog.event_type == event_type)

    # Get total count
    count_query = select(func.count(ImportJobLog.id)).where(
        ImportJobLog.import_job_id == job_uuid
    )
    if event_type:
        count_query = count_query.where(ImportJobLog.event_type == event_type)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Apply limit
    query = query.limit(limit)

    result = await db.execute(query)
    logs = result.scalars().all()

    return LogResponse(
        logs=[
            LogEntry(
                id=log.id,
                event_type=log.event_type,
                event_code=log.event_code,
                message=log.message,
                created_at=log.created_at.isoformat() if log.created_at else "",
            )
            for log in logs
        ],
        total=total,
    )


@router.delete("/{job_id}")
async def delete_import_job(
    job_id: str,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """
    Cancel a processing job or delete a completed/failed job.

    - For processing jobs: Sets status to 'cancelled'
    - For completed/failed/cancelled jobs: Deletes the job and all related data
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    result = await db.execute(
        select(ImportJob).where(ImportJob.id == job_uuid)
    )
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    if job.status in ("uploading", "validating", "ready", "processing"):
        # Cancel the job
        await db.execute(
            update(ImportJob).where(ImportJob.id == job_uuid).values(status="cancelled")
        )

        await add_job_log(
            db,
            job_uuid,
            event_type="warning",
            event_code="JOB_CANCELLED",
            message="Import job cancelled by user",
        )

        await db.commit()
        logger.info(f"Cancelled import job {job_id}")
        return {"message": "Import job cancelled", "job_id": job_id}

    # For completed/failed/cancelled jobs, delete the record
    # Cascade will delete related channels and logs
    await db.delete(job)
    await db.commit()
    logger.info(f"Deleted import job {job_id}")
    return {"message": "Import job deleted", "job_id": job_id}


class ValidateResponse(BaseModel):
    """Response after triggering validation."""

    job_id: str
    status: str
    message: str
    channels_to_validate: int


class StartResponse(BaseModel):
    """Response after starting import processing."""

    job_id: str
    status: str
    message: str
    channels_to_process: int


@router.post("/{job_id}/validate", response_model=ValidateResponse)
async def trigger_validation(
    job_id: str,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> ValidateResponse:
    """
    Trigger validation of channels in an import job.

    Validation checks:
    - Channel exists and is accessible
    - Channel is public (not private invite-only)
    - Gets channel metadata (title, subscriber count, etc.)

    The validation runs asynchronously in the listener service.
    Poll GET /{job_id} to check validation progress.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    result = await db.execute(select(ImportJob).where(ImportJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    if job.status not in ("uploading", "ready"):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot validate job in '{job.status}' state. Must be 'uploading' or 'ready'.",
        )

    # Count pending channels
    count_result = await db.execute(
        select(func.count(ImportJobChannel.id)).where(
            and_(
                ImportJobChannel.import_job_id == job_uuid,
                ImportJobChannel.status == "pending",
            )
        )
    )
    pending_count = count_result.scalar() or 0

    if pending_count == 0:
        raise HTTPException(
            status_code=400, detail="No pending channels to validate"
        )

    # Update job status
    await db.execute(
        update(ImportJob)
        .where(ImportJob.id == job_uuid)
        .values(status="validating")
    )

    await add_job_log(
        db,
        job_uuid,
        event_type="info",
        event_code="VALIDATION_STARTED",
        message=f"Validation triggered for {pending_count} channels",
    )

    # Publish validation request to Redis stream
    try:
        import redis.asyncio as redis
        from config.settings import settings

        redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        await redis_client.xadd(
            "import:validate",
            {"job_id": str(job_uuid), "timestamp": datetime.utcnow().isoformat()},
        )
        await redis_client.close()
        logger.info(f"Published validation request for job {job_id} to Redis")
    except Exception as e:
        logger.warning(f"Failed to publish to Redis (listener may poll DB instead): {e}")

    await db.commit()

    return ValidateResponse(
        job_id=job_id,
        status="validating",
        message="Validation started. Poll job status for progress.",
        channels_to_validate=pending_count,
    )


@router.post("/{job_id}/start", response_model=StartResponse)
async def start_import(
    job_id: str,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> StartResponse:
    """
    Start the import process to join selected channels.

    Prerequisites:
    - Job must be in 'ready' state (validation complete)
    - At least one channel must be selected

    The import runs asynchronously with rate limiting (1 channel per 30-60s).
    Poll GET /{job_id} to check progress.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    result = await db.execute(select(ImportJob).where(ImportJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    if job.status != "ready":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot start job in '{job.status}' state. Must be 'ready'.",
        )

    # Count selected channels with validated status
    count_result = await db.execute(
        select(func.count(ImportJobChannel.id)).where(
            and_(
                ImportJobChannel.import_job_id == job_uuid,
                ImportJobChannel.selected == True,
                ImportJobChannel.status == "validated",
            )
        )
    )
    selected_count = count_result.scalar() or 0

    if selected_count == 0:
        raise HTTPException(
            status_code=400,
            detail="No validated channels selected. Select channels and ensure validation is complete.",
        )

    # Update job status
    await db.execute(
        update(ImportJob)
        .where(ImportJob.id == job_uuid)
        .values(status="processing", started_at=datetime.utcnow())
    )

    await add_job_log(
        db,
        job_uuid,
        event_type="info",
        event_code="PROCESSING_STARTED",
        message=f"Import started for {selected_count} channels",
    )

    # Publish start request to Redis stream
    try:
        import redis.asyncio as redis
        from config.settings import settings

        redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
        await redis_client.xadd(
            "import:start",
            {"job_id": str(job_uuid), "timestamp": datetime.utcnow().isoformat()},
        )
        await redis_client.close()
        logger.info(f"Published start request for job {job_id} to Redis")
    except Exception as e:
        logger.warning(f"Failed to publish to Redis (listener may poll DB instead): {e}")

    await db.commit()

    return StartResponse(
        job_id=job_id,
        status="processing",
        message=f"Import started. {selected_count} channels queued for joining (rate limited).",
        channels_to_process=selected_count,
    )
