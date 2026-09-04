"""
Pseudo-graphic renderer: converts block trees into ASCII art.

Uses Unicode box-drawing characters for clean, AI-readable layouts.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from boxframe.models.block import BLOCK_TYPES, BORDER_STYLES


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
        if not block.content:
            # Show type hint if no content
            if block.border_style != "none" and block.width >= 4:
                hint = f"[{block.block_type}]"
                x, y = block.x + 1, block.y + 1
                for i, ch in enumerate(hint):
                    if x + i < block.x + block.width - 1 and y < self.grid_height:
                        self.grid[y][x + i] = ch
            return

        x, y = block.x, block.y
        w, h = block.width, block.height

        # Determine content area
        has_border = block.border_style != "none"
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
