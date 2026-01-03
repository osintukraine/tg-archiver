"""
Admin Topics API

Manage message topics that admins can configure for classification.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import List, Optional

from ...database import get_db
from ...dependencies import AdminUser

router = APIRouter(prefix="/api/admin/topics", tags=["admin-topics"])


class TopicCreate(BaseModel):
    """Create a new topic."""
    name: str = Field(..., min_length=1, max_length=50)
    label: str = Field(..., min_length=1, max_length=100)
    color: str = Field(default="gray", max_length=20)
    description: Optional[str] = None
    sort_order: int = Field(default=0)
    is_active: bool = Field(default=True)


class TopicUpdate(BaseModel):
    """Update a topic."""
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    label: Optional[str] = Field(None, min_length=1, max_length=100)
    color: Optional[str] = Field(None, max_length=20)
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class TopicResponse(BaseModel):
    """Topic response."""
    id: int
    name: str
    label: str
    color: str
    description: Optional[str]
    sort_order: int
    is_active: bool
    message_count: int = 0


@router.get("/", response_model=List[TopicResponse])
async def list_topics(
    admin: AdminUser,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    List all message topics with message counts.
    """
    where_clause = "" if include_inactive else "WHERE mt.is_active = true"

    result = await db.execute(text(f"""
        SELECT
            mt.id, mt.name, mt.label, mt.color, mt.description,
            mt.sort_order, mt.is_active,
            COUNT(m.id) as message_count
        FROM message_topics mt
        LEFT JOIN messages m ON m.topic = mt.name
        {where_clause}
        GROUP BY mt.id, mt.name, mt.label, mt.color, mt.description, mt.sort_order, mt.is_active
        ORDER BY mt.sort_order, mt.label
    """))

    return [
        TopicResponse(
            id=row[0],
            name=row[1],
            label=row[2],
            color=row[3],
            description=row[4],
            sort_order=row[5],
            is_active=row[6],
            message_count=row[7] or 0
        )
        for row in result.fetchall()
    ]


@router.post("/", response_model=TopicResponse)
async def create_topic(
    topic: TopicCreate,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new message topic.
    """
    # Check for duplicate name
    check = await db.execute(text(
        "SELECT id FROM message_topics WHERE LOWER(name) = LOWER(:name)"
    ), {"name": topic.name})
    if check.fetchone():
        raise HTTPException(status_code=409, detail="Topic name already exists")

    result = await db.execute(text("""
        INSERT INTO message_topics (name, label, color, description, sort_order, is_active)
        VALUES (:name, :label, :color, :description, :sort_order, :is_active)
        RETURNING id, name, label, color, description, sort_order, is_active
    """), {
        "name": topic.name,
        "label": topic.label,
        "color": topic.color,
        "description": topic.description,
        "sort_order": topic.sort_order,
        "is_active": topic.is_active,
    })
    await db.commit()

    row = result.fetchone()
    return TopicResponse(
        id=row[0],
        name=row[1],
        label=row[2],
        color=row[3],
        description=row[4],
        sort_order=row[5],
        is_active=row[6],
        message_count=0
    )


@router.put("/{topic_id}", response_model=TopicResponse)
async def update_topic(
    topic_id: int,
    update: TopicUpdate,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Update an existing topic.
    """
    # Check exists
    check = await db.execute(text(
        "SELECT id FROM message_topics WHERE id = :id"
    ), {"id": topic_id})
    if not check.fetchone():
        raise HTTPException(status_code=404, detail="Topic not found")

    # Build update query dynamically
    updates = []
    params = {"id": topic_id}

    if update.name is not None:
        updates.append("name = :name")
        params["name"] = update.name
    if update.label is not None:
        updates.append("label = :label")
        params["label"] = update.label
    if update.color is not None:
        updates.append("color = :color")
        params["color"] = update.color
    if update.description is not None:
        updates.append("description = :description")
        params["description"] = update.description
    if update.sort_order is not None:
        updates.append("sort_order = :sort_order")
        params["sort_order"] = update.sort_order
    if update.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = update.is_active

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    query = f"UPDATE message_topics SET {', '.join(updates)} WHERE id = :id"
    await db.execute(text(query), params)
    await db.commit()

    # Fetch updated
    result = await db.execute(text("""
        SELECT
            mt.id, mt.name, mt.label, mt.color, mt.description,
            mt.sort_order, mt.is_active,
            COUNT(m.id) as message_count
        FROM message_topics mt
        LEFT JOIN messages m ON m.topic = mt.name
        WHERE mt.id = :id
        GROUP BY mt.id
    """), {"id": topic_id})

    row = result.fetchone()
    return TopicResponse(
        id=row[0],
        name=row[1],
        label=row[2],
        color=row[3],
        description=row[4],
        sort_order=row[5],
        is_active=row[6],
        message_count=row[7] or 0
    )


@router.delete("/{topic_id}")
async def delete_topic(
    topic_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a topic. Messages with this topic will have their topic set to NULL.
    """
    # Check exists
    check = await db.execute(text(
        "SELECT id, name FROM message_topics WHERE id = :id"
    ), {"id": topic_id})
    row = check.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Topic not found")

    name = row[1]

    # Clear topic from messages first
    await db.execute(text(
        "UPDATE messages SET topic = NULL WHERE topic = :name"
    ), {"name": name})

    # Delete topic
    await db.execute(text(
        "DELETE FROM message_topics WHERE id = :id"
    ), {"id": topic_id})
    await db.commit()

    return {"success": True, "deleted": name}


@router.post("/seed")
async def seed_default_topics(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Seed default topics if none exist.
    """
    # Check if topics exist
    check = await db.execute(text("SELECT COUNT(*) FROM message_topics"))
    count = check.scalar()

    if count > 0:
        return {"success": False, "message": f"Topics already exist ({count} found)"}

    default_topics = [
        ("news", "News", "blue", "News and current events", 1),
        ("announcement", "Announcement", "purple", "Official announcements", 2),
        ("discussion", "Discussion", "green", "Community discussions", 3),
        ("media", "Media", "orange", "Photos, videos, documents", 4),
        ("important", "Important", "red", "High-priority content", 5),
        ("archive", "Archive", "gray", "Historical content", 6),
        ("offtopic", "Off-topic", "slate", "Unrelated to main theme", 7),
        ("other", "Other", "zinc", "Uncategorized content", 8),
    ]

    for name, label, color, description, sort_order in default_topics:
        await db.execute(text("""
            INSERT INTO message_topics (name, label, color, description, sort_order, is_active)
            VALUES (:name, :label, :color, :description, :sort_order, true)
        """), {
            "name": name,
            "label": label,
            "color": color,
            "description": description,
            "sort_order": sort_order,
        })

    await db.commit()
    return {"success": True, "message": f"Seeded {len(default_topics)} default topics"}
