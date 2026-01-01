"""
Admin Export Router - Background data export job management

Endpoints:
- POST /api/admin/export/start - Create new export job
- GET /api/admin/export/jobs - List all export jobs (paginated)
- GET /api/admin/export/{job_id} - Get job status and progress
- GET /api/admin/export/{job_id}/download - Download completed export
- DELETE /api/admin/export/{job_id} - Cancel or delete job
- GET /api/admin/export/profiles - Get available export profiles
- POST /api/admin/export/estimate - Estimate row count before export

Tiered Processing:
- < 10K rows: Direct streaming (no job queue)
- >= 10K rows: Background job with progress tracking
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Dict, List

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import Channel, Message
from models.export_job import (
    EXPORT_EXCLUDED_COLUMNS,
    MESSAGE_EXPORT_PROFILES,
    ExportJob,
)

from ...database import get_db
from ...dependencies import AdminUser
from ...utils.formatting import format_bytes
from ...utils.sql_safety import escape_ilike_pattern

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/export", tags=["Admin - Export"])


# =============================================================================
# Pydantic Schemas
# =============================================================================


class ExportFilters(BaseModel):
    """Filters for export query."""

    channel_ids: Optional[list[int]] = Field(
        None, description="Filter by specific channel IDs"
    )
    channel_usernames: Optional[list[str]] = Field(
        None, description="Filter by channel usernames"
    )
    date_from: Optional[str] = Field(
        None, description="Start date (ISO format: YYYY-MM-DD)"
    )
    date_to: Optional[str] = Field(None, description="End date (ISO format: YYYY-MM-DD)")
    importance_level: Optional[str] = Field(
        None, description="Filter by importance (high/medium/low)"
    )
    topics: Optional[list[str]] = Field(None, description="Filter by OSINT topics")
    is_spam: Optional[bool] = Field(None, description="Include/exclude spam")
    has_media: Optional[bool] = Field(None, description="Filter by media presence")
    media_types: Optional[list[str]] = Field(
        None, description="Filter by media types (photo/video/document)"
    )
    languages: Optional[list[str]] = Field(
        None, description="Filter by detected languages"
    )
    min_views: Optional[int] = Field(None, ge=0, description="Minimum view count")
    min_forwards: Optional[int] = Field(None, ge=0, description="Minimum forward count")
    search_query: Optional[str] = Field(
        None, description="Full-text search in content"
    )


class ExportRequest(BaseModel):
    """Request to create an export job."""

    export_type: str = Field(
        default="messages",
        description="Type of data to export: messages, channels, entities, decision_log",
    )
    format: str = Field(
        default="json", description="Output format: json, csv, jsonl"
    )
    profile: str = Field(
        default="standard",
        description="Column profile: minimal, standard, full, custom",
    )
    filters: ExportFilters = Field(
        default_factory=ExportFilters, description="Query filters"
    )
    columns: Optional[list[str]] = Field(
        None, description="Custom columns (required if profile='custom')"
    )
    label: Optional[str] = Field(
        None, max_length=255, description="Optional label for this export"
    )


class ExportEstimate(BaseModel):
    """Estimated export size and processing tier."""

    estimated_rows: int
    estimated_size_bytes: int
    estimated_size_human: str
    processing_tier: str  # direct_streaming, background_job
    estimated_duration_seconds: Optional[int] = None


class ExportJobResponse(BaseModel):
    """Export job status response."""

    id: str
    status: str
    export_type: str
    format: str
    profile: str
    label: Optional[str] = None
    filters: dict
    total_rows: Optional[int] = None
    processed_rows: int
    progress_percent: float
    created_at: str
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error_message: Optional[str] = None
    download_url: Optional[str] = None
    file_size_bytes: Optional[int] = None
    file_size_human: Optional[str] = None


class ExportJobListResponse(BaseModel):
    """Paginated list of export jobs."""

    jobs: list[ExportJobResponse]
    total: int
    page: int
    page_size: int


class ExportProfileInfo(BaseModel):
    """Information about an export profile."""

    name: str
    description: str
    columns: list[str]
    estimated_size_per_row_bytes: int


# =============================================================================
# Helper Functions
# =============================================================================


def job_to_response(job: ExportJob, base_url: str) -> ExportJobResponse:
    """Convert ExportJob to API response."""
    download_url = None
    if job.status == "completed" and job.is_downloadable:
        download_url = f"{base_url}/api/admin/export/{job.id}/download"

    return ExportJobResponse(
        id=str(job.id),
        status=job.status,
        export_type=job.export_type,
        format=job.format,
        profile=job.profile,
        label=job.label,
        filters=job.filters or {},
        total_rows=job.total_rows,
        processed_rows=job.processed_rows,
        progress_percent=float(job.progress_percent or 0),
        created_at=job.created_at.isoformat() if job.created_at else None,
        started_at=job.started_at.isoformat() if job.started_at else None,
        completed_at=job.completed_at.isoformat() if job.completed_at else None,
        error_message=job.error_message,
        download_url=download_url,
        file_size_bytes=job.file_size_bytes,
        file_size_human=format_bytes(job.file_size_bytes) if job.file_size_bytes else None,
    )


async def build_message_query_filters(
    filters: ExportFilters, db: AsyncSession
) -> list:
    """Build SQLAlchemy filters from ExportFilters."""
    conditions = []

    # Channel filters
    if filters.channel_ids:
        conditions.append(Message.channel_id.in_(filters.channel_ids))

    if filters.channel_usernames:
        # Look up channel IDs by username
        channel_result = await db.execute(
            select(Channel.id).where(Channel.username.in_(filters.channel_usernames))
        )
        channel_ids = [r[0] for r in channel_result.fetchall()]
        if channel_ids:
            conditions.append(Message.channel_id.in_(channel_ids))

    # Date filters
    if filters.date_from:
        try:
            from_dt = datetime.fromisoformat(filters.date_from)
            conditions.append(Message.telegram_date >= from_dt)
        except ValueError:
            pass

    if filters.date_to:
        try:
            to_dt = datetime.fromisoformat(filters.date_to)
            # Include the entire end day
            to_dt = to_dt.replace(hour=23, minute=59, second=59)
            conditions.append(Message.telegram_date <= to_dt)
        except ValueError:
            pass

    # Classification filters
    if filters.importance_level:
        conditions.append(Message.importance_level == filters.importance_level)

    if filters.topics:
        conditions.append(Message.osint_topic.in_(filters.topics))

    if filters.is_spam is not None:
        conditions.append(Message.is_spam == filters.is_spam)

    # Media filters
    if filters.has_media is not None:
        if filters.has_media:
            conditions.append(Message.media_type.isnot(None))
        else:
            conditions.append(Message.media_type.is_(None))

    if filters.media_types:
        conditions.append(Message.media_type.in_(filters.media_types))

    # Language filter
    if filters.languages:
        conditions.append(Message.language_detected.in_(filters.languages))

    # Engagement filters
    if filters.min_views is not None:
        conditions.append(Message.views >= filters.min_views)

    if filters.min_forwards is not None:
        conditions.append(Message.forwards >= filters.min_forwards)

    # Full-text search
    if filters.search_query:
        # SECURITY: Escape ILIKE wildcards to prevent pattern injection
        search_escaped = escape_ilike_pattern(filters.search_query)
        search_term = f"%{search_escaped}%"
        conditions.append(
            or_(
                Message.content.ilike(search_term),
                Message.content_translated.ilike(search_term),
            )
        )

    return conditions


async def estimate_export_size(
    filters: ExportFilters, profile: str, db: AsyncSession
) -> ExportEstimate:
    """Estimate the size and row count of an export."""
    # Build query
    conditions = await build_message_query_filters(filters, db)

    # Count rows
    count_query = select(func.count(Message.id))
    if conditions:
        count_query = count_query.where(and_(*conditions))

    result = await db.execute(count_query)
    row_count = result.scalar() or 0

    # Estimate size based on profile
    size_per_row = {
        "minimal": 200,  # ~200 bytes per row
        "standard": 500,  # ~500 bytes per row
        "full": 2000,  # ~2KB per row
        "custom": 500,  # Default to standard
    }
    bytes_per_row = size_per_row.get(profile, 500)
    estimated_bytes = row_count * bytes_per_row

    # Determine processing tier
    if row_count < 10000:
        tier = "direct_streaming"
        duration = None
    else:
        tier = "background_job"
        # Estimate ~1000 rows/second processing
        duration = max(1, row_count // 1000)

    return ExportEstimate(
        estimated_rows=row_count,
        estimated_size_bytes=estimated_bytes,
        estimated_size_human=format_bytes(estimated_bytes),
        processing_tier=tier,
        estimated_duration_seconds=duration,
    )


# =============================================================================
# API Endpoints
# =============================================================================


@router.get("/profiles")
async def get_export_profiles(admin: AdminUser) -> Dict[str, Any]:
    """
    Get available export profiles with column information.

    Returns profile names, descriptions, included columns, and size estimates.
    """
    profiles = {
        "minimal": {
            "name": "Minimal",
            "description": "Essential fields only: ID, content, date, channel",
            "columns": MESSAGE_EXPORT_PROFILES["minimal"],
            "estimated_size_per_row_bytes": 200,
        },
        "standard": {
            "name": "Standard",
            "description": "Common fields: minimal + engagement, classification, language",
            "columns": MESSAGE_EXPORT_PROFILES["standard"],
            "estimated_size_per_row_bytes": 500,
        },
        "full": {
            "name": "Full",
            "description": "All fields except embeddings and internal hashes",
            "columns": MESSAGE_EXPORT_PROFILES["full"],
            "estimated_size_per_row_bytes": 2000,
        },
        "custom": {
            "name": "Custom",
            "description": "Select specific columns to export",
            "available_columns": MESSAGE_EXPORT_PROFILES["full"],
            "excluded_columns": EXPORT_EXCLUDED_COLUMNS,
            "estimated_size_per_row_bytes": 500,
        },
    }

    return {
        "profiles": profiles,
        "formats": ["json", "csv", "jsonl"],
        "export_types": ["messages", "channels", "entities", "decision_log"],
    }


@router.post("/estimate")
async def estimate_export(
    admin: AdminUser,
    request: ExportRequest,
    db: AsyncSession = Depends(get_db),
) -> ExportEstimate:
    """
    Estimate the size and duration of an export before starting.

    Returns row count, estimated file size, and processing tier.
    """
    if request.export_type != "messages":
        # For now, only message exports are supported
        raise HTTPException(
            status_code=400,
            detail=f"Export type '{request.export_type}' not yet supported. Use 'messages'.",
        )

    return await estimate_export_size(request.filters, request.profile, db)


@router.post("/start")
async def start_export(
    request: Request,
    export_request: ExportRequest,
    admin: AdminUser,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> ExportJobResponse:
    """
    Start a new export job.

    For small exports (<10K rows), returns data directly via streaming.
    For larger exports, creates a background job and returns immediately.
    """
    if export_request.export_type != "messages":
        raise HTTPException(
            status_code=400,
            detail=f"Export type '{export_request.export_type}' not yet supported. Use 'messages'.",
        )

    # Validate custom columns
    if export_request.profile == "custom":
        if not export_request.columns:
            raise HTTPException(
                status_code=400,
                detail="Custom profile requires 'columns' field with list of column names.",
            )
        # Validate columns against allowed list
        valid_columns = set(MESSAGE_EXPORT_PROFILES["full"])
        invalid_columns = set(export_request.columns) - valid_columns
        if invalid_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid columns: {invalid_columns}. Valid columns: {valid_columns}",
            )

    # Estimate size
    estimate = await estimate_export_size(
        export_request.filters, export_request.profile, db
    )

    # Create job record
    job = ExportJob(
        user_id=None,  # TODO: Get from auth context when Kratos is integrated
        label=export_request.label,
        export_type=export_request.export_type,
        format=export_request.format,
        profile=export_request.profile,
        filters=export_request.filters.model_dump(exclude_none=True),
        columns=export_request.columns,
        total_rows=estimate.estimated_rows,
        created_by_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        download_token_expires_at=datetime.utcnow() + timedelta(days=7),
        expires_at=datetime.utcnow() + timedelta(days=14),
    )

    db.add(job)
    await db.commit()
    await db.refresh(job)

    # For small exports, we could stream directly
    # For now, all exports go through the background job system
    # TODO: Implement streaming for <10K rows

    logger.info(
        f"Created export job {job.id}: type={job.export_type}, "
        f"format={job.format}, estimated_rows={estimate.estimated_rows}"
    )

    base_url = str(request.base_url).rstrip("/")
    return job_to_response(job, base_url)


@router.get("/jobs")
async def list_export_jobs(
    request: Request,
    admin: AdminUser,
    page: int = Query(default=1, ge=1, description="Page number"),
    page_size: int = Query(default=20, ge=1, le=100, description="Items per page"),
    status: Optional[str] = Query(
        default=None, description="Filter by status: pending, processing, completed, failed"
    ),
    db: AsyncSession = Depends(get_db),
) -> ExportJobListResponse:
    """
    List all export jobs with pagination.

    Ordered by creation date (newest first).
    """
    # Build query
    query = select(ExportJob).order_by(ExportJob.created_at.desc())

    if status:
        query = query.where(ExportJob.status == status)

    # Get total count
    count_query = select(func.count(ExportJob.id))
    if status:
        count_query = count_query.where(ExportJob.status == status)
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # Paginate
    offset = (page - 1) * page_size
    query = query.offset(offset).limit(page_size)

    result = await db.execute(query)
    jobs = result.scalars().all()

    base_url = str(request.base_url).rstrip("/")
    return ExportJobListResponse(
        jobs=[job_to_response(job, base_url) for job in jobs],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{job_id}")
async def get_export_job(
    request: Request,
    job_id: str,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> ExportJobResponse:
    """
    Get status and details of a specific export job.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    result = await db.execute(select(ExportJob).where(ExportJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    base_url = str(request.base_url).rstrip("/")
    return job_to_response(job, base_url)


@router.get("/{job_id}/download")
async def download_export(
    job_id: str,
    admin: AdminUser,
    token: Optional[str] = Query(None, description="Download token"),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """
    Download a completed export file.

    Can use either:
    - Session authentication (admin users)
    - Download token (for shareable links)
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    result = await db.execute(select(ExportJob).where(ExportJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    if job.status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Export not ready. Current status: {job.status}",
        )

    if not job.s3_key:
        raise HTTPException(
            status_code=500,
            detail="Export completed but file not available",
        )

    # Check download limits
    if job.download_count >= job.max_downloads:
        raise HTTPException(
            status_code=403,
            detail="Download limit exceeded for this export",
        )

    if job.download_token_expires_at and datetime.now(timezone.utc) > job.download_token_expires_at:
        raise HTTPException(
            status_code=403,
            detail="Download link has expired",
        )

    # Increment download count
    await db.execute(
        update(ExportJob)
        .where(ExportJob.id == job_uuid)
        .values(download_count=ExportJob.download_count + 1)
    )
    await db.commit()

    # Stream file from MinIO through the API
    # This avoids Docker networking issues with presigned URLs
    try:
        from minio import Minio
        from config.settings import settings

        if not settings.MINIO_ENDPOINT:
            raise HTTPException(
                status_code=500,
                detail="MinIO not configured",
            )

        # Use internal endpoint for container-to-container communication
        minio_client = Minio(
            settings.MINIO_ENDPOINT.replace("http://", "").replace("https://", ""),
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            secure=settings.MINIO_ENDPOINT.startswith("https://"),
        )

        # Get the object from MinIO
        response = minio_client.get_object(
            settings.MINIO_BUCKET_NAME,
            job.s3_key,
        )

        # Determine content type and filename
        content_type_map = {
            "json": "application/json",
            "jsonl": "application/x-ndjson",
            "csv": "text/csv",
        }
        content_type = content_type_map.get(job.format, "application/octet-stream")

        # Generate filename for download
        filename = f"export_{job.export_type}_{job.created_at.strftime('%Y%m%d')}_{str(job.id)[:8]}.{job.format}"

        # Stream the response
        def iter_file():
            try:
                for chunk in response.stream(32 * 1024):  # 32KB chunks
                    yield chunk
            finally:
                response.close()
                response.release_conn()

        return StreamingResponse(
            iter_file(),
            media_type=content_type,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(job.file_size_bytes) if job.file_size_bytes else "",
            },
        )

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="MinIO client not available",
        )
    except Exception as e:
        logger.error(f"Error downloading export {job.s3_key}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to download export: {str(e)}",
        )


@router.delete("/{job_id}")
async def delete_export_job(
    admin: AdminUser,
    job_id: str,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, str]:
    """
    Cancel a pending/processing job or delete a completed/failed job.

    Cancelling a processing job will stop it at the next checkpoint.
    Deleting a completed job will also remove the file from MinIO.
    """
    try:
        job_uuid = uuid.UUID(job_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format")

    result = await db.execute(select(ExportJob).where(ExportJob.id == job_uuid))
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status_code=404, detail="Export job not found")

    if job.status in ("pending", "processing"):
        # Cancel the job
        await db.execute(
            update(ExportJob)
            .where(ExportJob.id == job_uuid)
            .values(status="cancelled")
        )
        await db.commit()
        logger.info(f"Cancelled export job {job_id}")
        return {"message": "Export job cancelled", "job_id": job_id}

    # For completed/failed/cancelled jobs, delete the record
    # TODO: Also delete the file from MinIO if exists
    await db.delete(job)
    await db.commit()
    logger.info(f"Deleted export job {job_id}")
    return {"message": "Export job deleted", "job_id": job_id}


@router.get("/stats/summary")
async def get_export_stats(admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Get summary statistics for export system.
    """
    # Count jobs by status
    status_counts = {}
    for status in ["pending", "processing", "completed", "failed", "cancelled"]:
        result = await db.execute(
            select(func.count(ExportJob.id)).where(ExportJob.status == status)
        )
        status_counts[status] = result.scalar() or 0

    # Recent exports
    recent_result = await db.execute(
        select(func.count(ExportJob.id)).where(
            ExportJob.created_at >= datetime.utcnow() - timedelta(hours=24)
        )
    )
    exports_24h = recent_result.scalar() or 0

    # Total data exported (completed jobs)
    size_result = await db.execute(
        select(func.sum(ExportJob.file_size_bytes)).where(
            ExportJob.status == "completed"
        )
    )
    total_bytes = size_result.scalar() or 0

    return {
        "status_counts": status_counts,
        "exports_last_24h": exports_24h,
        "total_data_exported_bytes": total_bytes,
        "total_data_exported_human": format_bytes(total_bytes),
        "queue_depth": status_counts.get("pending", 0),
        "active_jobs": status_counts.get("processing", 0),
    }
