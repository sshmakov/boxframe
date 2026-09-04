"""
Layout service: CRUD operations for projects, layouts, and blocks.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from boxframe.models.block import Block
from boxframe.models.layout import Layout
from boxframe.models.project import Project
from boxframe.services.renderer import RenderBlock, PseudoGraphicRenderer


class LayoutService:
    """Business logic for project/layout/block management."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Projects ──────────────────────────────────────────────

    async def create_project(self, name: str) -> Project:
        project = Project(name=name)
        self.db.add(project)
        await self.db.commit()
        await self.db.refresh(project)
        return project

    async def list_projects(self) -> list[Project]:
        result = await self.db.execute(
            select(Project).options(selectinload(Project.layouts)).order_by(Project.updated_at.desc())
        )
        return list(result.scalars().all())

    async def get_project(self, project_id: str) -> Project | None:
        result = await self.db.execute(
            select(Project).options(selectinload(Project.layouts)).filter(Project.id == project_id)
        )
        return result.scalar_one_or_none()

    async def delete_project(self, project_id: str) -> None:
        project = await self.get_project(project_id)
        if project:
            await self.db.delete(project)
            await self.db.commit()

    # ── Layouts ───────────────────────────────────────────────

    async def create_layout(self, project_id: str, name: str, width: int = 80, height: int = 24) -> Layout:
        layout = Layout(project_id=project_id, name=name, width=width, height=height)
        self.db.add(layout)
        await self.db.commit()
        await self.db.refresh(layout)
        return layout

    async def get_layout(self, layout_id: str) -> Layout | None:
        result = await self.db.execute(
            select(Layout)
            .options(selectinload(Layout.blocks).selectinload(Block.children))
            .filter(Layout.id == layout_id)
        )
        return result.scalar_one_or_none()

    async def delete_layout(self, layout_id: str) -> None:
        layout = await self.get_layout(layout_id)
        if layout:
            await self.db.delete(layout)
            await self.db.commit()

    # ── Blocks ────────────────────────────────────────────────

    async def create_block(
        self,
        layout_id: str,
        block_type: str,
        x: int = 0,
        y: int = 0,
        width: int = 20,
        height: int = 3,
        content: str = "",
        border_style: str = "solid",
        parent_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> Block:
        block = Block(
            layout_id=layout_id,
            block_type=block_type,
            x=x,
            y=y,
            width=width,
            height=height,
            content=content,
            border_style=border_style,
            parent_id=parent_id,
            metadata=metadata or {},
        )
        self.db.add(block)
        await self.db.commit()
        await self.db.refresh(block)
        return block

    async def update_block(self, block_id: str, **kwargs) -> Block | None:
        block = await self.db.get(Block, block_id)
        if block:
            for key, value in kwargs.items():
                if hasattr(block, key):
                    setattr(block, key, value)
            await self.db.commit()
            await self.db.refresh(block)
        return block

    async def delete_block(self, block_id: str) -> None:
        block = await self.db.get(Block, block_id)
        if block:
            await self.db.delete(block)
            await self.db.commit()

    async def get_block(self, block_id: str) -> Block | None:
        return await self.db.get(Block, block_id)

    # ── Rendering ─────────────────────────────────────────────

    async def render_layout(self, layout_id: str) -> str | None:
        """Render a layout to pseudo-graphic string."""
        layout = await self.get_layout(layout_id)
        if not layout:
            return None

        # Build flat block list for rendering
        blocks = self._build_render_blocks(layout.blocks)
        renderer = PseudoGraphicRenderer(layout.width, layout.height)
        return renderer.render(blocks)

    def _build_render_blocks(self, blocks: list[Block]) -> list[RenderBlock]:
        """Convert ORM blocks to RenderBlocks, handling nesting."""
        root_blocks = []
        by_id = {b.id: b for b in blocks}

        for block in blocks:
            if block.parent_id and block.parent_id in by_id:
                continue  # Will be added as child

            rb = RenderBlock(
                x=block.x,
                y=block.y,
                width=block.width,
                height=block.height,
                block_type=block.block_type,
                content=block.content,
                border_style=block.border_style,
                is_root=True,
            )

            # Add children
            child_blocks = [b for b in blocks if b.parent_id == block.id]
            rb.children = self._build_render_blocks(child_blocks)

            root_blocks.append(rb)

        return root_blocks

    # ── Export ────────────────────────────────────────────────

    async def export_json(self, layout_id: str) -> dict[str, Any] | None:
        """Export layout as JSON structure."""
        layout = await self.get_layout(layout_id)
        if not layout:
            return None

        return {
            "id": layout.id,
            "name": layout.name,
            "width": layout.width,
            "height": layout.height,
            "blocks": [
                {
                    "id": b.id,
                    "type": b.block_type,
                    "x": b.x,
                    "y": b.y,
                    "width": b.width,
                    "height": b.height,
                    "content": b.content,
                    "border_style": b.border_style,
                    "metadata": b.metadata,
                    "children": [
                        {
                            "id": c.id,
                            "type": c.block_type,
                            "x": c.x,
                            "y": c.y,
                            "width": c.width,
                            "height": c.height,
                            "content": c.content,
                            "border_style": c.border_style,
                            "metadata": c.metadata,
                        }
                        for c in b.children
                    ],
                }
                for b in layout.blocks
                if not b.parent_id
            ],
        }

    async def export_markdown(self, layout_id: str) -> str | None:
        """Export layout as markdown table representation."""
        ascii_art = await self.render_layout(layout_id)
        if not ascii_art:
            return None
        return f"```text\n{ascii_art}\n```"
