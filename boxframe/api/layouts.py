"""
Layout API routes.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from boxframe.database import get_db
from boxframe.services.layout_service import LayoutService
from boxframe.services.renderer import PseudoGraphicRenderer

router = APIRouter(prefix="/api/layouts", tags=["layouts"])


# ── Pydantic schemas ──────────────────────────────────────

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


class LayoutCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    # No upper limit: blocks may be placed outside the layout bounds,
    # so the layout size is just a logical frame, not a hard constraint.
    width: int = Field(default=80, ge=1)
    height: int = Field(default=24, ge=1)


class LayoutUpdate(BaseModel):
    name: str | None = None
    width: int | None = None
    height: int | None = None


class LayoutOut(BaseModel):
    id: str
    project_id: str
    name: str
    width: int
    height: int
    blocks: list[BlockOut] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class BlockCreate(BaseModel):
    block_type: str = Field(..., description="Type of block (box, button, input, etc.)")
    x: int = 0
    y: int = 0
    width: int = 20
    height: int = 3
    content: str = ""
    border_style: str = "solid"
    parent_id: str | None = None
    meta: dict = {}
    order: int = 0


class BlockUpdate(BaseModel):
    block_type: str | None = None
    x: int | None = None
    y: int | None = None
    width: int | None = None
    height: int | None = None
    content: str | None = None
    border_style: str | None = None
    parent_id: str | None = None
    meta: dict | None = None
    order: int | None = None


class RenderOut(BaseModel):
    ascii: str
    html: str | None = None


class ExportOut(BaseModel):
    layout_json: dict | None = None
    markdown: str | None = None
    ascii: str | None = None


# ── Layout CRUD ───────────────────────────────────────────

@router.post("/{project_id}/layouts", response_model=LayoutOut)
async def create_layout(project_id: str, data: LayoutCreate, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    layout = await service.create_layout(project_id, data.name, data.width, data.height)
    return layout


@router.get("/{layout_id}", response_model=LayoutOut)
async def get_layout(layout_id: str, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    layout = await service.get_layout(layout_id)
    if not layout:
        raise HTTPException(status_code=404, detail="Layout not found")
    return layout


@router.delete("/{layout_id}")
async def delete_layout(layout_id: str, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    layout = await service.get_layout(layout_id)
    if not layout:
        raise HTTPException(status_code=404, detail="Layout not found")
    await service.delete_layout(layout_id)
    return {"ok": True}


# ── Block CRUD ────────────────────────────────────────────

@router.post("/{layout_id}/blocks", response_model=BlockOut)
async def create_block(layout_id: str, data: BlockCreate, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    block = await service.create_block(
        layout_id=layout_id,
        block_type=data.block_type,
        x=data.x,
        y=data.y,
        width=data.width,
        height=data.height,
        content=data.content,
        border_style=data.border_style,
        parent_id=data.parent_id,
        meta=data.meta,
        order=data.order,
    )
    return block


@router.put("/{layout_id}/blocks/{block_id}", response_model=BlockOut)
async def update_block(layout_id: str, block_id: str, data: BlockUpdate, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    block = await service.get_block(block_id)
    if not block or block.layout_id != layout_id:
        raise HTTPException(status_code=404, detail="Block not found")

    update_data = data.model_dump(exclude_none=True)
    if not update_data:
        return block

    updated = await service.update_block(block_id, **update_data)
    return updated


@router.delete("/{layout_id}/blocks/{block_id}")
async def delete_block(layout_id: str, block_id: str, db: AsyncSession = Depends(get_db)):
    service = LayoutService(db)
    block = await service.get_block(block_id)
    if not block or block.layout_id != layout_id:
        raise HTTPException(status_code=404, detail="Block not found")
    await service.delete_block(block_id)
    return {"ok": True}


# ── Rendering ─────────────────────────────────────────────

@router.get("/{layout_id}/render", response_model=RenderOut)
async def render_layout(
    layout_id: str,
    char_width_px: float = Query(default=12.0, ge=1, le=50),
    char_height_px: float = Query(default=14.4, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    """Render layout to pseudo-graphic ASCII art.

    char_width_px / char_height_px — measured pixel dimensions of a single
    character.  JS measures the real .ascii-art character size and passes
    them back so overlays match exactly.
    """
    service = LayoutService(db)
    ascii_art = await service.render_layout(layout_id)
    if ascii_art is None:
        raise HTTPException(status_code=404, detail="Layout not found")

    # Generate HTML preview with block overlays and resize handles
    layout = await service.get_layout(layout_id)
    html = ""
    if layout:
        # Canvas = layout size expanded to fit blocks outside the bounds
        # (the ASCII grid is rendered the same way).
        canvas_w, canvas_h = service.canvas_size(layout)
        # Compute exact pixel dimensions so the art layer and overlays share
        # the same size.
        pre_width = canvas_w * char_width_px
        pre_height = round(canvas_h * char_height_px, 1)
        pad = 16.0
        # Padding lives on .render-wrapper; the art layer has no margin so
        # overlay coordinates (padding_offset + grid * char_size) align
        # exactly.  It is a <div>, not a <pre>: the HTML parser strips the
        # first newline right after a <pre> start tag, which would drop the
        # first row when the art starts with an empty row (topmost block
        # not at y=0) and shift the art up one row relative to the overlays.
        ascii_html = (
            f'<div class="ascii-art" style="font-family: monospace; font-size: 12px; '
            f'line-height: 1.2; display: block; white-space: pre; '
            f'width:{pre_width}px; height:{pre_height}px; '
            f'background: #1a1a2e; color: #e0e0e0;">'
            f"{ascii_art.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')}</div>"
        )
        blocks_data = _serialize_blocks_for_html(layout.blocks)
        block_previews_html = PseudoGraphicRenderer.render_html_preview(
            blocks_data,
            char_width_px=char_width_px,
            char_height_px=char_height_px,
            padding_offset=pad,
        )
        html = (
            f'<div class="render-wrapper" '
            f'style="width:{pre_width}px; height:{pre_height}px;">'
            f"{ascii_html}"
            f"{block_previews_html}"
            f"</div>"
        )

    return RenderOut(ascii=ascii_art, html=html)


def _serialize_blocks_for_html(blocks: list) -> list[dict]:
    """Serialize ORM blocks to dicts for HTML preview generation."""
    by_id = {b.id: b for b in blocks}
    result = []
    for block in blocks:
        if block.parent_id and block.parent_id in by_id:
            continue
        bd = {
            "id": block.id,
            "x": block.x,
            "y": block.y,
            "width": block.width,
            "height": block.height,
            "block_type": block.block_type,
            "content": block.content,
            "border_style": block.border_style,
            "order": block.order,
            "children": [
                {
                    "id": c.id,
                    "x": c.x,
                    "y": c.y,
                    "width": c.width,
                    "height": c.height,
                    "block_type": c.block_type,
                    "content": c.content,
                    "border_style": c.border_style,
                    "order": c.order,
                }
                for c in blocks
                if c.parent_id == block.id
            ],
        }
        result.append(bd)
    return result


@router.get("/{layout_id}/export", response_model=ExportOut)
async def export_layout(layout_id: str, db: AsyncSession = Depends(get_db)):
    """Export layout in multiple formats."""
    service = LayoutService(db)

    json_data = await service.export_json(layout_id)
    markdown = await service.export_markdown(layout_id)
    ascii_art = await service.render_layout(layout_id)

    return ExportOut(layout_json=json_data, markdown=markdown, ascii=ascii_art)
