"""
Project API routes.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from boxframe.database import get_db
from boxframe.models.block import BLOCK_TYPES, BORDER_STYLES
from boxframe.services.layout_service import LayoutService

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Pydantic schemas ──────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class ProjectOut(BaseModel):
    id: str
    name: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class LayoutOut(BaseModel):
    id: str
    name: str
    width: int
    height: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BlockSchema(BaseModel):
    id: str | None = None
    block_type: str
    x: int = 0
    y: int = 0
    width: int = 20
    height: int = 3
    content: str = ""
    border_style: str = "solid"
    parent_id: str | None = None
    meta: dict = {}
    order: int = 0


class BlockOut(BaseModel):
    id: str
    block_type: str
    x: int
    y: int
    width: int
    height: int
    content: str
    border_style: str
    parent_id: str | None
    meta: dict
    order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ── Routes ────────────────────────────────────────────────

@router.get("/", response_model=list[ProjectOut])
async def list_projects(db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    projects = await service.list_projects()
    return projects


@router.post("/", response_model=ProjectOut)
async def create_project(data: ProjectCreate, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    project = await service.create_project(data.name)
    return project


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    project = await service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/{project_id}")
async def delete_project(project_id: str, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    project = await service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await service.delete_project(project_id)
    return {"ok": True}


@router.get("/{project_id}/info", response_model=dict)
async def project_info(project_id: str, db: AsyncSession = Depends(get_db)):
    """Return project metadata including available block types and border styles."""
    service = LayoutService(db)
    project = await service.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    return {
        "project": {"id": project.id, "name": project.name},
        "layouts": [{"id": l.id, "name": l.name} for l in project.layouts],
        "block_types": BLOCK_TYPES,
        "border_styles": BORDER_STYLES,
    }


class LayoutCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    width: int = Field(default=80, ge=20, le=200)
    height: int = Field(default=24, ge=10, le=100)


@router.post("/{project_id}/layouts", response_model=LayoutOut)
async def create_layout(project_id: str, data: LayoutCreate, db: AsyncSession = Depends(get_db)):
    """Create a new layout for a project."""
    service = LayoutService(db)
    layout = await service.create_layout(project_id, data.name, data.width, data.height)
    return layout
