"""
boxframe — Pseudo-graphic UI mockup editor.

FastAPI backend with HTMX + Alpine.js frontend.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from boxframe.database import init_db
from boxframe.api.projects import router as projects_router
from boxframe.api.layouts import router as layouts_router
from boxframe.models.layout import Layout
from boxframe.models.project import Project
from boxframe.services.layout_service import LayoutService
from sqlalchemy import select

# ── App lifecycle ─────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(
    title="boxframe",
    description="Pseudo-graphic UI mockup editor for AI agents",
    version="0.1.0",
    lifespan=lifespan,
)

# ── Mount static files & templates ────────────────────────

app.mount("/static", StaticFiles(directory="boxframe/static"), name="static")
templates = Jinja2Templates(directory="boxframe/templates")

# ── Include API routers ───────────────────────────────────

app.include_router(projects_router)
app.include_router(layouts_router)


# ── Page routes ───────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def page_index(request: Request):
    """List all projects."""
    from boxframe.database import async_session
    async with async_session() as db:
        service = LayoutService(db)
        projects = await service.list_projects()
    return templates.TemplateResponse("pages/projects.html", {
        "request": request,
        "projects": projects,
    })


@app.get("/project/{project_id}", response_class=HTMLResponse)
async def page_project(request: Request, project_id: str):
    """Show project detail with layouts list."""
    from boxframe.database import async_session
    async with async_session() as db:
        service = LayoutService(db)
        project = await service.get_project(project_id)
        if not project:
            return templates.TemplateResponse("404.html", {
                "request": request, "message": "Project not found"
            }, status_code=404)
    return templates.TemplateResponse("pages/project.html", {
        "request": request,
        "project": project,
        "project_name": project.name,
    })


@app.get("/layout/{layout_id}", response_class=HTMLResponse)
async def page_editor(request: Request, layout_id: str):
    """Open the layout editor."""
    from boxframe.database import async_session
    async with async_session() as db:
        service = LayoutService(db)
        layout = await service.get_layout(layout_id)
        if not layout:
            return templates.TemplateResponse("404.html", {
                "request": request, "message": "Layout not found"
            }, status_code=404)
        project = await service.get_project(layout.project_id)
    return templates.TemplateResponse("pages/editor.html", {
        "request": request,
        "layout": layout,
        "project_name": project.name if project else "Unknown",
    })


# ── API page routes (HTMX-friendly) ──────────────────────

@app.get("/api/pages/project/{project_id}", response_class=HTMLResponse)
async def api_page_project(request: Request, project_id: str):
    """HTMX partial: project layouts list."""
    from boxframe.database import async_session
    async with async_session() as db:
        service = LayoutService(db)
        project = await service.get_project(project_id)
        if not project:
            return "<p>Project not found</p>"
    return templates.TemplateResponse("pages/project.html", {
        "request": request,
        "project": project,
        "project_name": project.name,
    })
