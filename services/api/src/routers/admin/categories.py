"""
Admin Categories API

Manage channel categories that admins can configure.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import List, Optional

from ...database import get_db
from ...dependencies import AdminUser

router = APIRouter(prefix="/api/admin/categories", tags=["admin-categories"])


class CategoryCreate(BaseModel):
    """Create a new category."""
    name: str = Field(..., min_length=1, max_length=50)
    color: str = Field(default="gray", max_length=20)
    description: Optional[str] = None
    sort_order: int = Field(default=0)


class CategoryUpdate(BaseModel):
    """Update a category."""
    name: Optional[str] = Field(None, min_length=1, max_length=50)
    color: Optional[str] = Field(None, max_length=20)
    description: Optional[str] = None
    sort_order: Optional[int] = None


class CategoryResponse(BaseModel):
    """Category response."""
    id: int
    name: str
    color: str
    description: Optional[str]
    sort_order: int
    channel_count: int = 0


@router.get("/", response_model=List[CategoryResponse])
async def list_categories(
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    List all channel categories with channel counts.
    """
    result = await db.execute(text("""
        SELECT
            cc.id, cc.name, cc.color, cc.description, cc.sort_order,
            COUNT(c.id) as channel_count
        FROM channel_categories cc
        LEFT JOIN channels c ON c.category_id = cc.id
        GROUP BY cc.id, cc.name, cc.color, cc.description, cc.sort_order
        ORDER BY cc.sort_order, cc.name
    """))

    return [
        CategoryResponse(
            id=row[0],
            name=row[1],
            color=row[2],
            description=row[3],
            sort_order=row[4],
            channel_count=row[5] or 0
        )
        for row in result.fetchall()
    ]


@router.post("/", response_model=CategoryResponse)
async def create_category(
    category: CategoryCreate,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new channel category.
    """
    # Check for duplicate name
    check = await db.execute(text(
        "SELECT id FROM channel_categories WHERE LOWER(name) = LOWER(:name)"
    ), {"name": category.name})
    if check.fetchone():
        raise HTTPException(status_code=409, detail="Category name already exists")

    result = await db.execute(text("""
        INSERT INTO channel_categories (name, color, description, sort_order)
        VALUES (:name, :color, :description, :sort_order)
        RETURNING id, name, color, description, sort_order
    """), {
        "name": category.name,
        "color": category.color,
        "description": category.description,
        "sort_order": category.sort_order,
    })
    await db.commit()

    row = result.fetchone()
    return CategoryResponse(
        id=row[0],
        name=row[1],
        color=row[2],
        description=row[3],
        sort_order=row[4],
        channel_count=0
    )


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int,
    update: CategoryUpdate,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Update an existing category.
    """
    # Check exists
    check = await db.execute(text(
        "SELECT id FROM channel_categories WHERE id = :id"
    ), {"id": category_id})
    if not check.fetchone():
        raise HTTPException(status_code=404, detail="Category not found")

    # Build update query dynamically
    updates = []
    params = {"id": category_id}

    if update.name is not None:
        updates.append("name = :name")
        params["name"] = update.name
    if update.color is not None:
        updates.append("color = :color")
        params["color"] = update.color
    if update.description is not None:
        updates.append("description = :description")
        params["description"] = update.description
    if update.sort_order is not None:
        updates.append("sort_order = :sort_order")
        params["sort_order"] = update.sort_order

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    query = f"UPDATE channel_categories SET {', '.join(updates)} WHERE id = :id"
    await db.execute(text(query), params)
    await db.commit()

    # Fetch updated
    result = await db.execute(text("""
        SELECT
            cc.id, cc.name, cc.color, cc.description, cc.sort_order,
            COUNT(c.id) as channel_count
        FROM channel_categories cc
        LEFT JOIN channels c ON c.category_id = cc.id
        WHERE cc.id = :id
        GROUP BY cc.id
    """), {"id": category_id})

    row = result.fetchone()
    return CategoryResponse(
        id=row[0],
        name=row[1],
        color=row[2],
        description=row[3],
        sort_order=row[4],
        channel_count=row[5] or 0
    )


@router.delete("/{category_id}")
async def delete_category(
    category_id: int,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a category. Channels with this category will have their category set to NULL.
    """
    # Check exists
    check = await db.execute(text(
        "SELECT id, name FROM channel_categories WHERE id = :id"
    ), {"id": category_id})
    row = check.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")

    name = row[1]

    # Delete (FK ON DELETE SET NULL will handle channels)
    await db.execute(text(
        "DELETE FROM channel_categories WHERE id = :id"
    ), {"id": category_id})
    await db.commit()

    return {"success": True, "deleted": name}
