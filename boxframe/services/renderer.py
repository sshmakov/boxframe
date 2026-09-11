"""
Pseudo-graphic renderer: converts block trees into ASCII art.

Uses Unicode box-drawing characters for clean, AI-readable layouts.
"""

from __future__ import annotations

import re
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
    order: int = 0
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
        Uses `order` to compute z-index: higher order = higher z-index.
        """
        left = round(padding_offset + self.x * char_width_px, 1)
        top = round(padding_offset + self.y * char_height_px, 1)
        w = round(self.width * char_width_px, 1)
        h = round(self.height * char_height_px, 1)
        # z-index: base 10 + order so default order=0 → z-index 10
        z_index = 10 + self.order

        def _fmt(v: float) -> str:
            if v == int(v):
                return f"{int(v)}px"
            return f"{v}px"

        return (
            f'<div class="block-preview" data-block-id="{block_id}"'
            f' style="position:absolute;left:{_fmt(left)};top:{_fmt(top)};'
            f'width:{_fmt(w)};height:{_fmt(h)};z-index:{z_index};"'
            f' data-order="{self.order}">'
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
            "none": "none",
        }
        style = border_map.get(self.border_style, "solid")

        if self.block_type in ("hline", "vline"):
            direction = "h" if self.block_type == "hline" else "v"
            return (
                f'<div class="block-line block-line--{direction} block-line--{style}">'
                f"</div>"
            )

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


def _fmt_px(v: float) -> str:
    """Format a pixel value: integers without a decimal part."""
    if v == int(v):
        return str(int(v))
    return str(v)


# Default canvas size for layouts without set dimensions — the working
# area the editor shows when nothing else determines the canvas size.
DEFAULT_CANVAS_WIDTH = 80
DEFAULT_CANVAS_HEIGHT = 24


class PseudoGraphicRenderer:
    """Renders block trees as pseudo-graphic ASCII art."""

    def __init__(self, grid_width: int | None = DEFAULT_CANVAS_WIDTH, grid_height: int | None = DEFAULT_CANVAS_HEIGHT):
        # Unset layout dimensions (None) fall back to the default canvas
        self.grid_width = grid_width if grid_width is not None else DEFAULT_CANVAS_WIDTH
        self.grid_height = grid_height if grid_height is not None else DEFAULT_CANVAS_HEIGHT
        self.grid: list[list[str]] = [[" " for _ in range(self.grid_width)] for _ in range(self.grid_height)]

    @classmethod
    def canvas_size(cls, blocks: list[RenderBlock], width: int | None, height: int | None) -> tuple[int, int]:
        """Canvas dimensions: the max of the blocks' extent, the set
        dimensions, and the default canvas size (80×24).

        The default size is the editor's working area: it applies when a
        dimension is unset and when the set dimension is smaller than the
        default (the bounds line must stay inside the canvas). Set
        dimensions only raise the floor for their axis — they are a visual
        bounds line, not a constraint. Blocks are not restricted to the
        layout bounds — the canvas grows to the right/bottom so
        out-of-bounds blocks are fully visible. Children are counted with
        their 1-cell container padding (same as
        _render_children_in_container).
        """
        max_x = max(width, DEFAULT_CANVAS_WIDTH) if width is not None else DEFAULT_CANVAS_WIDTH
        max_y = max(height, DEFAULT_CANVAS_HEIGHT) if height is not None else DEFAULT_CANVAS_HEIGHT

        def walk(bs: list[RenderBlock], ox: int, oy: int) -> None:
            nonlocal max_x, max_y
            for b in bs:
                ax, ay = ox + b.x, oy + b.y
                max_x = max(max_x, ax + b.width)
                max_y = max(max_y, ay + b.height)
                if b.children:
                    walk(b.children, ax + 1, ay + 1)

        walk(blocks, 0, 0)
        return max_x, max_y

    def render(self, blocks: list[RenderBlock]) -> str:
        """Render a list of root blocks into a pseudo-graphic string.

        The canvas is at least grid_width × grid_height but expands to fit
        blocks placed outside the layout bounds. Trailing empty rows are
        stripped — the layout height is metadata, not part of the art.
        """
        self.grid_width, self.grid_height = self.canvas_size(blocks, self.grid_width, self.grid_height)
        self.grid = [[" " for _ in range(self.grid_width)] for _ in range(self.grid_height)]

        # Sort by order (ascending) — higher order renders on top
        sorted_blocks = sorted(blocks, key=lambda b: b.order)

        for block in sorted_blocks:
            self._render_block(block)

        lines = ["".join(row).rstrip() for row in self.grid]
        while lines and not lines[-1]:
            lines.pop()
        return "\n".join(lines)

    def _render_block(self, block: RenderBlock) -> None:
        """Render a single block (including children) onto the grid."""
        style_map = BORDERS.get(block.border_style, BORDERS["solid"])

        if block.block_type in ("hline", "vline"):
            if block.border_style != "none":
                self._draw_line(block, style_map)
            return

        if block.block_type == "button":
            self._draw_button(block, style_map)
            return

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

    def _draw_line(self, block: RenderBlock, style: dict[str, str]) -> None:
        """Draw an hline (top row) or vline (left column) with style characters."""
        x = max(0, min(block.x, self.grid_width - 1))
        y = max(0, min(block.y, self.grid_height - 1))

        if block.block_type == "hline":
            w = min(block.width, self.grid_width - x)
            for i in range(max(1, w)):
                self.grid[y][x + i] = style["h"]
        else:  # vline
            h = min(block.height, self.grid_height - y)
            for j in range(max(1, h)):
                self.grid[y + j][x] = style["v"]

    def _draw_button(self, block: RenderBlock, style: dict[str, str]) -> None:
        """Draw a button. The shape depends on the height:

        h=1:  [label        ]
        h=2:  │label        │   (no top border)
              └──────────────┘
        h>=3: full box, label on the middle row (upper middle for even h)

        The label is a single line: newlines are ignored and the text is
        truncated to the inner width.
        """
        # Clamp to grid (same logic as _draw_border)
        x = max(0, min(block.x, self.grid_width - 2))
        y = max(0, min(block.y, self.grid_height - 2))
        w = min(block.width, self.grid_width - x)
        h = min(block.height, self.grid_height - y)

        if w < 1 or h < 1:
            return

        framed = block.border_style != "none" and w >= 2

        if framed:
            if h == 1:
                self.grid[y][x] = "["
                self.grid[y][x + w - 1] = "]"
            else:
                # Side borders on all rows
                for j in range(h):
                    self.grid[y + j][x] = style["v"]
                    self.grid[y + j][x + w - 1] = style["v"]
                # Bottom border
                self.grid[y + h - 1][x] = style["bl"]
                self.grid[y + h - 1][x + w - 1] = style["br"]
                for i in range(1, w - 1):
                    self.grid[y + h - 1][x + i] = style["h"]
                if h >= 3:
                    # Top border
                    self.grid[y][x] = style["tl"]
                    self.grid[y][x + w - 1] = style["tr"]
                    for i in range(1, w - 1):
                        self.grid[y][x + i] = style["h"]

        # Label — single line, vertically centered, truncated to fit
        if block.content:
            row = y + (h - 1) // 2
            inner_x = x + (1 if framed else 0)
            inner_w = w - (2 if framed else 0)
            if inner_w > 0 and row < self.grid_height:
                label = block.content.split("\n")[0][:inner_w]
                for i, ch in enumerate(label):
                    if inner_x + i < self.grid_width:
                        self.grid[row][inner_x + i] = ch

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

        # Wrap content by words to fit the content area
        lines = self._wrap_text(block.content, content_w)
        for line_idx, line in enumerate(lines):
            if line_idx >= content_h:
                break
            row = content_y + line_idx
            if row >= self.grid_height:
                break
            for col_idx, ch in enumerate(line):
                col = content_x + col_idx
                if col < self.grid_width:
                    self.grid[row][col] = ch

    def _wrap_text(self, text: str, width: int) -> list[str]:
        """Wrap text by words to fit within `width` columns.

        Explicit newlines are preserved. Runs of spaces are treated as
        formatting and kept verbatim: a space run stays on the line when
        it fits and is dropped when it forces a wrap. Words longer than
        `width` are hard-split character by character.
        """
        wrapped: list[str] = []
        for raw_line in text.split("\n"):
            # Words and runs of spaces — spaces are formatting, not separators
            tokens = re.findall(r"\S+| +", raw_line)
            current = ""
            for token in tokens:
                if token[0] == " ":
                    if current and len(current) + len(token) <= width:
                        current += token
                    elif current:
                        # Gap doesn't fit — wrap to the next line, drop the gap
                        wrapped.append(current)
                        current = ""
                    else:
                        current += token  # leading spaces
                else:
                    word = token
                    while len(word) > width:
                        if current:
                            wrapped.append(current)
                            current = ""
                        wrapped.append(word[:width])
                        word = word[width:]
                    if not word:
                        continue
                    if not current:
                        current = word
                    elif len(current) + len(word) <= width:
                        current += word
                    else:
                        wrapped.append(current)
                        current = word
            if current:
                wrapped.append(current)
            elif not tokens:
                wrapped.append("")
        return wrapped

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
    def render_simple(
        cls,
        blocks_data: list[dict],
        width: int | None = DEFAULT_CANVAS_WIDTH,
        height: int | None = DEFAULT_CANVAS_HEIGHT,
    ) -> str:
        """Convenience method: render from raw dicts.

        width/height may be None — unset dimensions fall back to the
        default canvas size (80×24).
        """
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
                order=bd.get("order", 0),
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
                        order=c.get("order", 0),
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
                order=bd.get("order", 0),
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
                    order=c.get("order", 0),
                )
                parts.append(crb.to_html_preview(
                    c["id"], char_width_px, char_height_px, padding_offset,
                ))
        return "\n".join(parts)

    @classmethod
    def render_bounds_html(
        cls,
        width: int | None,
        height: int | None,
        char_width_px: float = 12.0,
        char_height_px: float = 14.4,
        padding_offset: float = 16.0,
    ) -> str:
        """Generate the layout bounds overlay for the editor canvas.

        A set width draws a vertical line at x=width; a set height draws a
        horizontal line at y=height. The lines are a visual guide only —
        they do not constrain block placement or the canvas size, and they
        are not part of the pseudo-graphic format (ASCII art).
        """
        parts: list[str] = []
        if width:
            left = _fmt_px(round(padding_offset + width * char_width_px, 1))
            parts.append(
                f'<div class="layout-bounds layout-bounds--v" '
                f'style="left:{left}px;top:{_fmt_px(padding_offset)}px;'
                f'bottom:{_fmt_px(padding_offset)}px;"></div>'
            )
        if height:
            top = _fmt_px(round(padding_offset + height * char_height_px, 1))
            parts.append(
                f'<div class="layout-bounds layout-bounds--h" '
                f'style="top:{top}px;left:{_fmt_px(padding_offset)}px;'
                f'right:{_fmt_px(padding_offset)}px;"></div>'
            )
        return "\n".join(parts)
