"""
Admin Folders Router - Monitored folder management

Endpoints:
- GET /api/admin/folders - List all monitored folders
- POST /api/admin/folders - Add new folder to monitor
- DELETE /api/admin/folders/{id} - Remove folder from monitoring
- PATCH /api/admin/folders/{id} - Toggle folder active status
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
    """Response for a single monitored folder."""

    id: int
    folder_name: str
    telegram_folder_id: Optional[int] = None
    rule: str
    active: bool
    created_via: str
    created_at: str


class FolderListResponse(BaseModel):
    """Response for listing all monitored folders."""

    folders: list[FolderResponse]
    env_pattern: str  # Current FOLDER_ARCHIVE_ALL_PATTERN
    total: int


# =============================================================================
# API Endpoints
# =============================================================================


@router.get("")
async def list_folders(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db),
) -> FolderListResponse:
    """List all monitored folders."""
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
    """Add a new folder to monitor."""
    # Check for duplicate
    existing = await db.execute(
        select(MonitoredFolder).where(
            func.lower(MonitoredFolder.folder_name) == request.folder_name.lower()
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409, detail=f"Folder '{request.folder_name}' already monitored"
        )

    # Check if matches env pattern
    if request.folder_name.lower() == settings.FOLDER_ARCHIVE_ALL_PATTERN.lower():
        raise HTTPException(
            status_code=409,
            detail=f"Folder '{request.folder_name}' already monitored via env",
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
    """Remove a folder from monitoring."""
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
    """Toggle folder active status."""
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
