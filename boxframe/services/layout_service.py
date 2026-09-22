"""
Layout service: CRUD operations for projects, layouts, and blocks.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import delete, func, select
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

    async def create_layout(
        self,
        project_id: str,
        name: str,
        width: int | None = None,
        height: int | None = None,
    ) -> Layout:
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
        layout = result.scalar_one_or_none()
        if layout and layout.blocks:
            self._normalize_block_orders(layout.blocks)
        return layout

    def _normalize_block_orders(self, blocks: list[Block]) -> None:
        """Assign sequential order when there are duplicate values.

        If all blocks have unique orders — leave them alone (user-set).
        If there are duplicates (e.g. old blocks with order=0, or auto-assigned
        blocks that collided) — reassign sequential 0,1,2... based on created_at,
        preserving explicitly set unique orders.
        """
        orders = [b.order for b in blocks]
        if len(orders) == len(set(orders)):
            # All unique — user has explicitly set them
            return

        # Duplicates exist — find the min order to use as base.
        # This preserves explicitly set orders (e.g. order=0) and renumbers
        # duplicates starting from the minimum.
        min_order = min(orders)
        sorted_blocks = sorted(blocks, key=lambda b: b.created_at or b.id)
        for i, block in enumerate(sorted_blocks):
            block.order = min_order + i

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
        meta: dict[str, Any] | None = None,
        order: int = 0,
    ) -> Block:
        # If order is 0 (default/unsent), compute MAX(order) + 1 for this layout
        if order == 0:
            result = await self.db.execute(
                select(func.coalesce(func.max(Block.order), 0)).where(
                    Block.layout_id == layout_id
                )
            )
            max_order = result.scalar() or 0
            order = max_order + 1

        # Validate a parent (exists, same layout, no cycle) before inserting
        block_id = str(uuid.uuid4())
        if parent_id:
            await self._validate_reparent(block_id, parent_id, layout_id)

        # Lines are always 1 cell thick — the thin dimension is fixed
        if block_type == "hline":
            height = 1
        elif block_type == "vline":
            width = 1

        block = Block(
            id=block_id,
            layout_id=layout_id,
            block_type=block_type,
            x=x,
            y=y,
            width=width,
            height=height,
            content=content,
            border_style=border_style,
            parent_id=parent_id,
            meta=meta or {},
            order=order,
        )
        self.db.add(block)
        await self.db.commit()
        await self.db.refresh(block)
        return block

    async def update_block(self, block_id: str, **kwargs) -> Block | None:
        block = await self.db.get(Block, block_id)
        if block:
            # Validate a re-parenting before applying it (parent exists,
            # same layout, no cycle)
            if "parent_id" in kwargs:
                await self._validate_reparent(block_id, kwargs["parent_id"], block.layout_id)
            for key, value in kwargs.items():
                if hasattr(block, key):
                    setattr(block, key, value)
            # Lines are always 1 cell thick — the thin dimension is fixed
            # (also applies when block_type is changed to a line type)
            if block.block_type == "hline":
                block.height = 1
            elif block.block_type == "vline":
                block.width = 1
            await self.db.commit()
            await self.db.refresh(block)
        return block

    async def delete_block(self, block_id: str) -> None:
        block = await self.db.get(Block, block_id)
        if block:
            await self.db.delete(block)
            await self.db.commit()

    async def delete_all_blocks(self, layout_id: str) -> int:
        """Delete every block belonging to a layout. Returns the number deleted.

        The layout itself is kept — only its blocks (including nested ones)
        are removed.
        """
        result = await self.db.execute(delete(Block).where(Block.layout_id == layout_id))
        await self.db.commit()
        return result.rowcount or 0

    async def replace_blocks(self, layout_id: str, blocks: list[dict[str, Any]]) -> Layout:
        """Replace all blocks of a layout with the given set (single transaction).

        Used by the editor's undo/redo: the client sends a full state
        snapshot and the layout is restored to it. Block ids from the
        payload are preserved so restored blocks keep their identity;
        blocks without an id get a new one.
        """
        layout = await self.get_layout(layout_id)
        if not layout:
            return None

        # Delete existing blocks through the ORM (not a bulk statement) so
        # the identity map and relationship state stay consistent. Children
        # go first — otherwise the parent's cascade would delete them twice.
        existing = sorted(layout.blocks, key=lambda b: 0 if b.parent_id else 1)
        for block in existing:
            await self.db.delete(block)
        await self.db.flush()

        for data in blocks:
            block_type = data.get("block_type", "box")
            width = data.get("width", 20)
            height = data.get("height", 3)
            # Lines are always 1 cell thick — the thin dimension is fixed
            if block_type == "hline":
                height = 1
            elif block_type == "vline":
                width = 1
            self.db.add(
                Block(
                    id=data.get("id") or str(uuid.uuid4()),
                    layout_id=layout_id,
                    parent_id=data.get("parent_id"),
                    block_type=block_type,
                    x=data.get("x", 0),
                    y=data.get("y", 0),
                    width=width,
                    height=height,
                    content=data.get("content", ""),
                    border_style=data.get("border_style", "solid"),
                    meta=data.get("meta") or {},
                    order=data.get("order", 0),
                )
            )
        await self.db.commit()
        # The session keeps loaded objects after commit (expire_on_commit
        # is off) — expire everything so the returned layout reflects the
        # new block set instead of the stale relationship collection.
        self.db.expire_all()
        return await self.get_layout(layout_id)

    async def get_block(self, block_id: str) -> Block | None:
        return await self.db.get(Block, block_id)

    async def _validate_reparent(
        self, block_id: str, parent_id: str | None, layout_id: str
    ) -> None:
        """Validate a re-parenting (or a create with a parent).

        Raises ValueError when the parent is missing, belongs to another
        layout, or the change would create a cycle (a block becoming its own
        descendant — e.g. dropping a box onto one of its own children).
        """
        if parent_id is None:
            return
        if parent_id == block_id:
            raise ValueError("A block cannot be its own parent")
        parent = await self.db.get(Block, parent_id)
        if parent is None or parent.layout_id != layout_id:
            raise ValueError("Parent block not found in this layout")
        # Walk up from the proposed parent; reaching the block means a cycle.
        cursor_id = parent.parent_id
        seen = {parent_id}
        while cursor_id is not None:
            if cursor_id == block_id:
                raise ValueError("Cannot move a block into its own descendant")
            if cursor_id in seen:
                break  # pre-existing cycle in the data — stop
            seen.add(cursor_id)
            cursor = await self.db.get(Block, cursor_id)
            if cursor is None:
                break
            cursor_id = cursor.parent_id

    async def batch_blocks(
        self,
        layout_id: str,
        create: list[dict[str, Any]] | None = None,
        update: list[dict[str, Any]] | None = None,
        delete: list[str] | None = None,
    ) -> tuple[Layout | None, list[Block], list[Block], list[str]]:
        """Apply a batch of block operations in a single transaction.

        Backs the editor's multi-selection operations (group move, group
        property edit, group delete, group duplicate): one request instead
        of N, and a single undo step on the client. Returns the layout
        (None when not found), created blocks, updated blocks, and the
        ids actually deleted.
        """
        layout = await self.get_layout(layout_id)
        if not layout:
            return None, [], [], []

        created: list[Block] = []
        updated: list[Block] = []
        deleted: list[str] = []

        for block_id in delete or []:
            block = await self.db.get(Block, block_id)
            if block and block.layout_id == layout_id:
                await self.db.delete(block)
                deleted.append(block_id)

        if create:
            result = await self.db.execute(
                select(func.coalesce(func.max(Block.order), 0)).where(
                    Block.layout_id == layout_id
                )
            )
            next_order = (result.scalar() or 0) + 1
            for data in create:
                block_type = data.get("block_type", "box")
                width = data.get("width", 20)
                height = data.get("height", 3)
                # Lines are always 1 cell thick — the thin dimension is fixed
                if block_type == "hline":
                    height = 1
                elif block_type == "vline":
                    width = 1
                order = data.get("order") or 0
                if order == 0:
                    order = next_order
                    next_order += 1
                parent_id = data.get("parent_id")
                if parent_id:
                    await self._validate_reparent(
                        str(uuid.uuid4()), parent_id, layout_id
                    )
                block = Block(
                    layout_id=layout_id,
                    parent_id=parent_id,
                    block_type=block_type,
                    x=data.get("x", 0),
                    y=data.get("y", 0),
                    width=width,
                    height=height,
                    content=data.get("content", ""),
                    border_style=data.get("border_style", "solid"),
                    meta=data.get("meta") or {},
                    order=order,
                )
                self.db.add(block)
                created.append(block)

        for data in update or []:
            block = await self.db.get(Block, data.get("id"))
            if not block or block.layout_id != layout_id:
                continue
            # Validate a re-parenting (parent_id may be None — un-parent)
            if "parent_id" in data:
                await self._validate_reparent(block.id, data["parent_id"], layout_id)
            for key, value in data.items():
                if key == "id":
                    continue
                # parent_id may be explicitly None (drag out of a container);
                # other None values are "not provided" and are skipped.
                if value is None and key != "parent_id":
                    continue
                if hasattr(block, key):
                    setattr(block, key, value)
            # Lines are always 1 cell thick (also when block_type changes)
            if block.block_type == "hline":
                block.height = 1
            elif block.block_type == "vline":
                block.width = 1
            updated.append(block)

        await self.db.commit()
        for block in created + updated:
            await self.db.refresh(block)
        self.db.expire_all()
        layout = await self.get_layout(layout_id)
        return layout, created, updated, deleted

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

    def canvas_size(self, layout: Layout) -> tuple[int, int]:
        """Canvas size for rendering: layout size expanded to fit all blocks."""
        blocks = self._build_render_blocks(layout.blocks)
        return PseudoGraphicRenderer.canvas_size(blocks, layout.width, layout.height)

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
                order=block.order,
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

        # Build the tree from the flat block list — arbitrary depth, and no
        # lazy loading of the ORM `children` relationship (only two levels
        # are eager-loaded).
        children_by_parent: dict[str | None, list[Block]] = {}
        for b in layout.blocks:
            children_by_parent.setdefault(b.parent_id, []).append(b)

        def to_dict(b: Block) -> dict[str, Any]:
            return {
                "id": b.id,
                "type": b.block_type,
                "x": b.x,
                "y": b.y,
                "width": b.width,
                "height": b.height,
                "content": b.content,
                "border_style": b.border_style,
                "metadata": b.meta,
                "order": b.order,
                "children": [to_dict(c) for c in children_by_parent.get(b.id, [])],
            }

        return {
            "id": layout.id,
            "name": layout.name,
            "width": layout.width,
            "height": layout.height,
            "blocks": [to_dict(b) for b in children_by_parent.get(None, [])],
        }

    async def export_markdown(self, layout_id: str) -> str | None:
        """Export layout as markdown table representation."""
        ascii_art = await self.render_layout(layout_id)
        if ascii_art is None:
            return None
        return f"```text\n{ascii_art}\n```"
