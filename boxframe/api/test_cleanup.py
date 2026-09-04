"""
Test cleanup API route.

Deletes all projects, layouts, and blocks whose names start with
the ``E2E: `` prefix.  This keeps the production database clean
when running E2E tests against a shared server.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from boxframe.database import get_db
from boxframe.models.block import Block
from boxframe.models.layout import Layout
from boxframe.models.project import Project

router = APIRouter(prefix="/api/test", tags=["test"])

E2E_PREFIX = "E2E: "


@router.delete("/cleanup")
async def cleanup_e2e_data(db: AsyncSession = Depends(get_db)):
    """Delete all E2E test data (projects, layouts, blocks with E2E prefix)."""
    # 1. Collect layout IDs belonging to E2E projects
    e2e_projects = await db.execute(
        select(Project.id).where(Project.name.like(f"{E2E_PREFIX}%"))
    )
    e2e_project_ids = set(e2e_projects.scalars().all())

    # 2. Collect layout IDs for those projects
    e2e_layouts = await db.execute(
        select(Layout.id).where(Layout.project_id.in_(e2e_project_ids))
    )
    e2e_layout_ids = set(e2e_layouts.scalars().all())

    # 3. Delete blocks belonging to those layouts
    deleted_blocks = 0
    if e2e_layout_ids:
        result = await db.execute(delete(Block).where(Block.layout_id.in_(e2e_layout_ids)))
        deleted_blocks = result.rowcount

    # 4. Delete layouts
    deleted_layouts = 0
    if e2e_layout_ids:
        result = await db.execute(delete(Layout).where(Layout.id.in_(e2e_layout_ids)))
        deleted_layouts = result.rowcount

    # 5. Delete projects
    deleted_projects = 0
    if e2e_project_ids:
        result = await db.execute(delete(Project).where(Project.id.in_(e2e_project_ids)))
        deleted_projects = result.rowcount

    await db.commit()

    return {
        "deleted_projects": deleted_projects,
        "deleted_layouts": deleted_layouts,
        "deleted_blocks": deleted_blocks,
    }
