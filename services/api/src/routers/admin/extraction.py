"""
Admin Extraction Patterns API

Manage configurable entity extraction patterns.
Operators can define custom regex patterns or keyword lists.
"""

import logging
import re
from datetime import datetime
from typing import List, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ...database import get_db
from ...dependencies import AdminUser

router = APIRouter(prefix="/api/admin/extraction", tags=["admin-extraction"])


class PatternCreate(BaseModel):
    """Create a new extraction pattern."""
    name: str = Field(..., min_length=1, max_length=100)
    entity_type: str = Field(..., min_length=1, max_length=50)
    pattern: str = Field(..., min_length=1)
    pattern_type: str = Field(default="regex", pattern="^(regex|keyword_list)$")
    case_sensitive: bool = Field(default=False)
    enabled: bool = Field(default=True)
    description: Optional[str] = None
    color: str = Field(default="gray", max_length=20)
    sort_order: int = Field(default=0)

    @field_validator('pattern')
    @classmethod
    def validate_pattern(cls, v: str, info) -> str:
        """Validate that regex patterns are valid."""
        # Only validate if we can determine pattern_type
        # This will be called after pattern_type is set
        return v


class PatternUpdate(BaseModel):
    """Update an extraction pattern."""
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    entity_type: Optional[str] = Field(None, min_length=1, max_length=50)
    pattern: Optional[str] = Field(None, min_length=1)
    pattern_type: Optional[str] = Field(None, pattern="^(regex|keyword_list)$")
    case_sensitive: Optional[bool] = None
    enabled: Optional[bool] = None
    description: Optional[str] = None
    color: Optional[str] = Field(None, max_length=20)
    sort_order: Optional[int] = None


class PatternResponse(BaseModel):
    """Extraction pattern response."""
    id: int
    name: str
    entity_type: str
    pattern: str
    pattern_type: str
    case_sensitive: bool
    enabled: bool
    description: Optional[str]
    color: str
    sort_order: int
    created_at: datetime
    updated_at: datetime


class PatternTestRequest(BaseModel):
    """Request to test a pattern against sample text."""
    text: str = Field(..., min_length=1)


class PatternTestResponse(BaseModel):
    """Response from testing a pattern."""
    matches: List[str]
    match_count: int
    pattern_valid: bool
    error: Optional[str] = None


def validate_regex(pattern: str) -> tuple[bool, Optional[str]]:
    """Validate a regex pattern. Returns (is_valid, error_message)."""
    try:
        re.compile(pattern)
        return True, None
    except re.error as e:
        return False, str(e)


@router.get("/", response_model=List[PatternResponse])
async def list_patterns(
    admin: AdminUser,
    enabled_only: bool = False,
    entity_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    List all extraction patterns.
    """
    query = """
        SELECT id, name, entity_type, pattern, pattern_type,
               case_sensitive, enabled, description, color, sort_order,
               created_at, updated_at
        FROM extraction_patterns
        WHERE 1=1
    """
    params = {}

    if enabled_only:
        query += " AND enabled = true"

    if entity_type:
        query += " AND entity_type = :entity_type"
        params["entity_type"] = entity_type

    query += " ORDER BY sort_order, name"

    result = await db.execute(text(query), params)

    return [
        PatternResponse(
            id=row[0],
            name=row[1],
            entity_type=row[2],
            pattern=row[3],
            pattern_type=row[4],
            case_sensitive=row[5],
            enabled=row[6],
            description=row[7],
            color=row[8] or "gray",
            sort_order=row[9] or 0,
            created_at=row[10],
            updated_at=row[11]
        )
        for row in result.fetchall()
    ]


@router.post("/", response_model=PatternResponse)
async def create_pattern(
    pattern: PatternCreate,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new extraction pattern.
    """
    # Validate regex if pattern_type is regex
    if pattern.pattern_type == "regex":
        is_valid, error = validate_regex(pattern.pattern)
        if not is_valid:
            raise HTTPException(status_code=400, detail=f"Invalid regex pattern: {error}")

    # Check for duplicate name
    check = await db.execute(text(
        "SELECT id FROM extraction_patterns WHERE LOWER(name) = LOWER(:name)"
    ), {"name": pattern.name})
    if check.fetchone():
        raise HTTPException(status_code=409, detail="Pattern name already exists")

    result = await db.execute(text("""
        INSERT INTO extraction_patterns
        (name, entity_type, pattern, pattern_type, case_sensitive, enabled,
         description, color, sort_order)
        VALUES (:name, :entity_type, :pattern, :pattern_type, :case_sensitive,
                :enabled, :description, :color, :sort_order)
        RETURNING id, name, entity_type, pattern, pattern_type, case_sensitive,
                  enabled, description, color, sort_order, created_at, updated_at
    """), {
        "name": pattern.name,
        "entity_type": pattern.entity_type,
        "pattern": pattern.pattern,
        "pattern_type": pattern.pattern_type,
        "case_sensitive": pattern.case_sensitive,
        "enabled": pattern.enabled,
        "description": pattern.description,
        "color": pattern.color,
        "sort_order": pattern.sort_order,
    })
    await db.commit()

    row = result.fetchone()
    return PatternResponse(
        id=row[0],
        name=row[1],
        entity_type=row[2],
        pattern=row[3],
        pattern_type=row[4],
        case_sensitive=row[5],
        enabled=row[6],
        description=row[7],
        color=row[8] or "gray",
        sort_order=row[9] or 0,
        created_at=row[10],
        updated_at=row[11]
    )


@router.put("/{pattern_id}", response_model=PatternResponse)
async def update_pattern(
    pattern_id: int,
    update: PatternUpdate,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Update an existing extraction pattern.
    """
    # Check exists
    check = await db.execute(text(
        "SELECT id, pattern_type FROM extraction_patterns WHERE id = :id"
    ), {"id": pattern_id})
    row = check.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pattern not found")

    current_pattern_type = row[1]

    # Validate regex if updating pattern and type is regex
    pattern_type = update.pattern_type or current_pattern_type
    if update.pattern and pattern_type == "regex":
        is_valid, error = validate_regex(update.pattern)
        if not is_valid:
            raise HTTPException(status_code=400, detail=f"Invalid regex pattern: {error}")

    # Build update query dynamically
    updates = ["updated_at = NOW()"]
    params = {"id": pattern_id}

    if update.name is not None:
        updates.append("name = :name")
        params["name"] = update.name
    if update.entity_type is not None:
        updates.append("entity_type = :entity_type")
        params["entity_type"] = update.entity_type
    if update.pattern is not None:
        updates.append("pattern = :pattern")
        params["pattern"] = update.pattern
    if update.pattern_type is not None:
        updates.append("pattern_type = :pattern_type")
        params["pattern_type"] = update.pattern_type
    if update.case_sensitive is not None:
        updates.append("case_sensitive = :case_sensitive")
        params["case_sensitive"] = update.case_sensitive
    if update.enabled is not None:
        updates.append("enabled = :enabled")
        params["enabled"] = update.enabled
    if update.description is not None:
        updates.append("description = :description")
        params["description"] = update.description
    if update.color is not None:
        updates.append("color = :color")
        params["color"] = update.color
    if update.sort_order is not None:
        updates.append("sort_order = :sort_order")
        params["sort_order"] = update.sort_order

    query = f"UPDATE extraction_patterns SET {', '.join(updates)} WHERE id = :id"
    await db.execute(text(query), params)
    await db.commit()

    # Fetch updated
    result = await db.execute(text("""
        SELECT id, name, entity_type, pattern, pattern_type,
               case_sensitive, enabled, description, color, sort_order,
               created_at, updated_at
        FROM extraction_patterns
        WHERE id = :id
    """), {"id": pattern_id})

    row = result.fetchone()
    return PatternResponse(
        id=row[0],
        name=row[1],
        entity_type=row[2],
        pattern=row[3],
        pattern_type=row[4],
        case_sensitive=row[5],
        enabled=row[6],
        description=row[7],
        color=row[8] or "gray",
        sort_order=row[9] or 0,
        created_at=row[10],
        updated_at=row[11]
    )


@router.delete("/{pattern_id}")
async def delete_pattern(
    pattern_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete an extraction pattern.
    """
    # Check exists
    check = await db.execute(text(
        "SELECT id, name FROM extraction_patterns WHERE id = :id"
    ), {"id": pattern_id})
    row = check.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Pattern not found")

    name = row[1]

    await db.execute(text(
        "DELETE FROM extraction_patterns WHERE id = :id"
    ), {"id": pattern_id})
    await db.commit()

    return {"success": True, "deleted": name}


@router.post("/{pattern_id}/test", response_model=PatternTestResponse)
async def test_pattern(
    pattern_id: int,
    request: PatternTestRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Test an extraction pattern against sample text.
    Returns all matches found.
    """
    # Fetch pattern
    result = await db.execute(text("""
        SELECT pattern, pattern_type, case_sensitive
        FROM extraction_patterns WHERE id = :id
    """), {"id": pattern_id})
    row = result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail="Pattern not found")

    pattern_str, pattern_type, case_sensitive = row

    if pattern_type == "regex":
        try:
            flags = 0 if case_sensitive else re.IGNORECASE
            compiled = re.compile(pattern_str, flags)
            matches = compiled.findall(request.text)
            # Handle tuple results from groups
            if matches and isinstance(matches[0], tuple):
                matches = [''.join(m) for m in matches]
            return PatternTestResponse(
                matches=matches,
                match_count=len(matches),
                pattern_valid=True
            )
        except re.error as e:
            return PatternTestResponse(
                matches=[],
                match_count=0,
                pattern_valid=False,
                error=str(e)
            )
    else:
        # keyword_list - pattern is JSON array
        import json
        try:
            keywords = json.loads(pattern_str)
            if not isinstance(keywords, list):
                return PatternTestResponse(
                    matches=[],
                    match_count=0,
                    pattern_valid=False,
                    error="Keyword list must be a JSON array"
                )

            text_to_search = request.text if case_sensitive else request.text.lower()
            matches = []
            for kw in keywords:
                kw_search = kw if case_sensitive else kw.lower()
                if kw_search in text_to_search:
                    matches.append(kw)

            return PatternTestResponse(
                matches=matches,
                match_count=len(matches),
                pattern_valid=True
            )
        except json.JSONDecodeError as e:
            return PatternTestResponse(
                matches=[],
                match_count=0,
                pattern_valid=False,
                error=f"Invalid JSON: {e}"
            )


@router.post("/test-inline", response_model=PatternTestResponse)
async def test_pattern_inline(
    pattern: str,
    pattern_type: str,
    text: str,
    case_sensitive: bool = False,
    admin: AdminUser = None,
):
    """
    Test a pattern inline without saving it.
    Useful for testing patterns before creating them.
    """
    if pattern_type == "regex":
        try:
            flags = 0 if case_sensitive else re.IGNORECASE
            compiled = re.compile(pattern, flags)
            matches = compiled.findall(text)
            if matches and isinstance(matches[0], tuple):
                matches = [''.join(m) for m in matches]
            return PatternTestResponse(
                matches=matches,
                match_count=len(matches),
                pattern_valid=True
            )
        except re.error as e:
            return PatternTestResponse(
                matches=[],
                match_count=0,
                pattern_valid=False,
                error=str(e)
            )
    else:
        import json
        try:
            keywords = json.loads(pattern)
            if not isinstance(keywords, list):
                return PatternTestResponse(
                    matches=[],
                    match_count=0,
                    pattern_valid=False,
                    error="Keyword list must be a JSON array"
                )

            text_to_search = text if case_sensitive else text.lower()
            matches = []
            for kw in keywords:
                kw_search = kw if case_sensitive else kw.lower()
                if kw_search in text_to_search:
                    matches.append(kw)

            return PatternTestResponse(
                matches=matches,
                match_count=len(matches),
                pattern_valid=True
            )
        except json.JSONDecodeError as e:
            return PatternTestResponse(
                matches=[],
                match_count=0,
                pattern_valid=False,
                error=f"Invalid JSON: {e}"
            )


@router.post("/reload")
async def reload_patterns(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger pattern reload on processor service.
    Publishes a message to Redis pub/sub that the processor listens to.
    """
    import redis.asyncio as redis
    import os

    redis_url = os.getenv("REDIS_URL", "redis://localhost:6379")

    try:
        r = redis.from_url(redis_url)
        await r.publish("extraction:reload", "reload")
        await r.close()
        return {"success": True, "message": "Reload signal sent to processor"}
    except Exception as e:
        logger.error(f"Failed to send reload signal: {e}")
        raise HTTPException(
            status_code=500,
            detail="Failed to send reload signal. Check Redis connection."
        )
