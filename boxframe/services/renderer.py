"""
Pseudo-graphic renderer: converts block trees into ASCII art.

Uses Unicode box-drawing characters for clean, AI-readable layouts.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from boxframe.models.block import BLOCK_TYPES, BORDER_STYLES


# SVG icon for resize handle (diagonal arrow in bottom-right corner)
_RESIZE_HANDLE_SVG = (
    'data:image/svg+xml,'
    '%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"'
    '%3E%3Cpath d="M9 1L5 5M9 3L3 9M7 1L9 1L9 3" '
    'stroke="%23888" stroke-width="1.2" fill="none"'
    '%3E%3C/path%3E%3C/svg%3E'
)


@dataclass
class RenderBlock:
    """Flattened block for rendering."""
    x: int
    y: int
    width: int
    height: int
    block_type: str
    content: str
    border_style: str
    is_root: bool = False
    children: list["RenderBlock"] = field(default_factory=list)

    # ── HTML preview generation ─────────────────────────────

    def to_html_preview(
        self,
        block_id: str,
        char_width_px: float = 12.0,
        char_height_px: float = 14.4,
        padding_offset: float = 16.0,
    ) -> str:
        """Generate an HTML preview div for this block with a resize handle.

        Uses pixel dimensions so the overlay matches the actual character size
        (which may differ from font-size in some fonts).
        """
        left = round(padding_offset + self.x * char_width_px, 1)
        top = round(padding_offset + self.y * char_height_px, 1)
        w = round(self.width * char_width_px, 1)
        h = round(self.height * char_height_px, 1)

        def _fmt(v: float) -> str:
            if v == int(v):
                return f"{int(v)}px"
            return f"{v}px"

        return (
            f'<div class="block-preview" data-block-id="{block_id}"'
            f' style="position:absolute;left:{_fmt(left)};top:{_fmt(top)};'
            f'width:{_fmt(w)};height:{_fmt(h)};">'
            f'<div class="block-inner block-{self.block_type}">'
            f"{self._border_html()}"
            f"</div>"
            f'<div class="resize-handle" title="Drag to resize"></div>'
            f"</div>"
        )

    def _border_html(self) -> str:
        """Generate border HTML for a block."""
        border_map = {
            "solid": "solid",
            "dashed": "dashed",
            "dotted": "dotted",
            "double": "double",
        }
        style = border_map.get(self.border_style, "solid")
        if self.border_style == "none":
            return ""
        return (
            f'<div class="block-border block-border--{style}"'
            f' style="width:100%;height:100%;">'
            f"</div>"
        )


# Border character maps: {style: {corner_tl, corner_tr, corner_bl, corner_br, h, v, t_l, t_r, t_t, b_l, b_b, cross}}
BORDERS: dict[str, dict[str, str]] = {
    "solid": {
        "tl": "┌", "tr": "┐", "bl": "└", "br": "┘",
        "h": "─", "v": "│",
        "t_l": "├", "t_r": "┤", "t_t": "┬", "b_l": "┴", "b_b": "┼",
    },
    "dashed": {
        "tl": "┌", "tr": "┐", "bl": "└", "br": "┘",
        "h": "┄", "v": "┆",
        "t_l": "├", "t_r": "┤", "t_t": "┬", "b_l": "┴", "b_b": "┼",
    },
    "dotted": {
        "tl": "┌", "tr": "┐", "bl": "└", "br": "┘",
        "h": "┈", "v": "┊",
        "t_l": "├", "t_r": "┤", "t_t": "┬", "b_l": "┴", "b_b": "┼",
    },
    "double": {
        "tl": "╔", "tr": "╗", "bl": "╚", "br": "╝",
        "h": "═", "v": "║",
        "t_l": "╠", "t_r": "╣", "t_t": "╦", "b_l": "╩", "b_b": "╬",
    },
}


class PseudoGraphicRenderer:
    """Renders block trees as pseudo-graphic ASCII art."""

    def __init__(self, grid_width: int = 80, grid_height: int = 24):
        self.grid_width = grid_width
        self.grid_height = grid_height
        self.grid: list[list[str]] = [[" " for _ in range(grid_width)] for _ in range(grid_height)]

    def render(self, blocks: list[RenderBlock]) -> str:
        """Render a list of root blocks into a pseudo-graphic string."""
        self.grid = [[" " for _ in range(self.grid_width)] for _ in range(self.grid_height)]

        # Sort blocks by y, then x for consistent layering
        sorted_blocks = sorted(blocks, key=lambda b: (b.y, b.x))

        for block in sorted_blocks:
            self._render_block(block)

        return "\n".join("".join(row).rstrip() for row in self.grid)

    def _render_block(self, block: RenderBlock) -> None:
        """Render a single block (including children) onto the grid."""
        style_map = BORDERS.get(block.border_style, BORDERS["solid"])
        has_border = block.border_style != "none" and block.width >= 2 and block.height >= 2

        if has_border:
            self._draw_border(block, style_map)
            self._draw_content(block)
            if block.children:
                self._render_children_in_container(block, style_map)
        else:
            # No border - just place content at the block's position
            self._draw_content(block)

    def _draw_border(self, block: RenderBlock, style: dict[str, str]) -> None:
        """Draw the border of a block."""
        x, y = block.x, block.y
        w, h = block.width, block.height

        # Clamp to grid
        x = max(0, min(x, self.grid_width - 2))
        y = max(0, min(y, self.grid_height - 2))
        w = min(w, self.grid_width - x)
        h = min(h, self.grid_height - y)

        if w < 2 or h < 2:
            return

        # Corners
        self.grid[y][x] = style["tl"]
        self.grid[y][x + w - 1] = style["tr"]
        self.grid[y + h - 1][x] = style["bl"]
        self.grid[y + h - 1][x + w - 1] = style["br"]

        # Top and bottom edges
        for i in range(1, w - 1):
            self.grid[y][x + i] = style["h"]
            self.grid[y + h - 1][x + i] = style["h"]

        # Left and right edges
        for j in range(1, h - 1):
            self.grid[y + j][x] = style["v"]
            self.grid[y + j][x + w - 1] = style["v"]

    def _draw_content(self, block: RenderBlock) -> None:
        """Place block content inside its border area."""
        # Clamp block position and size to grid (same logic as _draw_border)
        x = max(0, min(block.x, self.grid_width - 2))
        y = max(0, min(block.y, self.grid_height - 2))
        w = min(block.width, self.grid_width - x)
        h = min(block.height, self.grid_height - y)

        if w < 1 or h < 1:
            return

        has_border = block.border_style != "none"
        if has_border and (w < 2 or h < 2):
            return

        if not block.content:
            # Show type hint if no content
            if has_border and w >= 4:
                hint = f"[{block.block_type}]"
                hx, hy = x + 1, y + 1
                for i, ch in enumerate(hint):
                    if hx + i < x + w - 1 and hy < self.grid_height:
                        self.grid[hy][hx + i] = ch
            return

        # Determine content area
        content_x = x + (1 if has_border else 0)
        content_y = y + (1 if has_border else 0)
        content_w = w - (2 if has_border else 0)
        content_h = h - (2 if has_border else 0)

        if content_w <= 0 or content_h <= 0:
            return

        # Split content into lines
        lines = block.content.split("\n")
        for line_idx, line in enumerate(lines):
            if line_idx >= content_h:
                break
            row = content_y + line_idx
            if row >= self.grid_height:
                break
            # Truncate line to content width
            line = line[:content_w]
            for col_idx, ch in enumerate(line):
                col = content_x + col_idx
                if col < self.grid_width:
                    self.grid[row][col] = ch

    def _render_children_in_container(self, parent: RenderBlock, style: dict[str, str]) -> None:
        """Render child blocks inside a parent container with padding."""
        pad_x = 1
        pad_y = 1

        for child in sorted(parent.children, key=lambda c: (c.y, c.x)):
            child.x = parent.x + pad_x + child.x
            child.y = parent.y + pad_y + child.y
            child.width = min(child.width, parent.width - 2 * pad_x)
            child.height = min(child.height, parent.height - 2 * pad_y)
            self._render_block(child)

    @classmethod
    def render_simple(cls, blocks_data: list[dict], width: int = 80, height: int = 24) -> str:
        """Convenience method: render from raw dicts."""
        blocks = []
        for bd in blocks_data:
            rb = RenderBlock(
                x=bd.get("x", 0),
                y=bd.get("y", 0),
                width=bd.get("width", 20),
                height=bd.get("height", 3),
                block_type=bd.get("block_type", "box"),
                content=bd.get("content", ""),
                border_style=bd.get("border_style", "solid"),
            )
            children = bd.get("children", [])
            if children:
                rb.children = [
                    RenderBlock(
                        x=c.get("x", 0),
                        y=c.get("y", 0),
                        width=c.get("width", 10),
                        height=c.get("height", 1),
                        block_type=c.get("block_type", "box"),
                        content=c.get("content", ""),
                        border_style=c.get("border_style", "solid"),
                    )
                    for c in children
                ]
            blocks.append(rb)

        renderer = cls(width, height)
        return renderer.render(blocks)

    @classmethod
    def render_html_preview(
        cls,
        blocks_data: list[dict],
        width: int = 80,
        height: int = 24,
        char_width_px: float = 12.0,
        char_height_px: float = 14.4,
        padding_offset: float = 16.0,
    ) -> str:
        """Generate an HTML preview with positioned block divs and resize handles."""
        parts: list[str] = []
        for bd in blocks_data:
            rb = RenderBlock(
                x=bd.get("x", 0),
                y=bd.get("y", 0),
                width=bd.get("width", 20),
                height=bd.get("height", 3),
                block_type=bd.get("block_type", "box"),
                content=bd.get("content", ""),
                border_style=bd.get("border_style", "solid"),
            )
            # Flatten children for the preview (all blocks on the same layer)
            parts.append(rb.to_html_preview(
                bd["id"], char_width_px, char_height_px, padding_offset,
            ))
            for c in bd.get("children", []):
                crb = RenderBlock(
                    x=c.get("x", 0),
                    y=c.get("y", 0),
                    width=c.get("width", 10),
                    height=c.get("height", 1),
                    block_type=c.get("block_type", "box"),
                    content=c.get("content", ""),
                    border_style=c.get("border_style", "solid"),
                )
                parts.append(crb.to_html_preview(
                    c["id"], char_width_px, char_height_px, padding_offset,
                ))
        return "\n".join(parts)
