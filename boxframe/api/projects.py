"""
Project API routes.
"""

from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from boxframe.database import get_db
from boxframe.models.block import BLOCK_TYPES, BORDER_STYLES
from boxframe.services.layout_service import LayoutService

router = APIRouter(prefix="/api/projects", tags=["projects"])


# ── Pydantic schemas ──────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class ProjectUpdate(BaseModel):
    name: str | None = None


class ProjectDuplicate(BaseModel):
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
    width: int | None = None
    height: int | None = None
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


def _safe_filename(name: str) -> str:
    """Filesystem/HTTP-safe download name from a project name."""
    cleaned = "".join(c if c.isalnum() or c in "-_" else "_" for c in name).strip("_")
    return cleaned or "project"


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


@router.put("/{project_id}", response_model=ProjectOut)
async def rename_project(project_id: str, data: ProjectUpdate, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    if not data.name:
        raise HTTPException(status_code=400, detail="Name is required")
    project = await service.rename_project(project_id, data.name)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/{project_id}/duplicate", response_model=ProjectOut)
async def duplicate_project(
    project_id: str, data: ProjectDuplicate, db: AsyncSession = Depends(get_db)
):
    service = LayoutService(db)
    project = await service.duplicate_project(project_id, data.name)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/{project_id}/export")
async def export_project(project_id: str, db: AsyncSession = Depends(get_db)):
    """Download the project as a JSON file (all layouts + blocks)."""
    service = LayoutService(db)
    data = await service.export_project(project_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Project not found")
    filename = _safe_filename(data["name"]) + ".json"
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/import", response_model=ProjectOut)
async def import_project(data: dict = Body(...), db: AsyncSession = Depends(get_db)):
    """Create a new project from an exported project JSON file.

    Every entity gets a fresh id (the file's ids are ignored), so importing
    never collides with existing data. The block hierarchy, geometry, meta
    and z-order are preserved as-is.
    """
    service = LayoutService(db)
    try:
        project = await service.import_project(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
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
    # Optional: a layout may have a width, a height, both, or neither.
    # A set dimension is a visual bounds line in the editor, not a constraint.
    width: int | None = Field(default=None, ge=1)
    height: int | None = Field(default=None, ge=1)


@router.post("/{project_id}/layouts", response_model=LayoutOut)
async def create_layout(project_id: str, data: LayoutCreate, db: AsyncSession = Depends(get_db)):
    """Create a new layout for a project."""
    service = LayoutService(db)
    layout = await service.create_layout(project_id, data.name, data.width, data.height)
    return layout
