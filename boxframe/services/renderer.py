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
    # Free-form block metadata (per-side border overrides and other
    # extended properties — tasks/0051). Absent keys inherit defaults.
    meta: dict = field(default_factory=dict)

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
        """Generate border HTML for a block.

        Lines keep the global style; other blocks get per-side classes
        (meta.border_h / meta.border_v ?? border_style).
        """
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

        h_style, v_style = effective_border_styles(self.border_style, self.meta)
        h = border_map.get(h_style, "solid")
        v = border_map.get(v_style, "solid")
        return (
            f'<div class="block-border block-border--h-{h} block-border--v-{v}"'
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


def effective_border_styles(border_style: str, meta: dict | None) -> tuple[str, str]:
    """Effective per-side styles: (H, V) for top/bottom and left/right.

    meta.border_h / meta.border_v override the base border_style per axis;
    an absent (or empty) key inherits the base, so old layouts without
    meta render unchanged.
    """
    meta = meta or {}
    h = meta.get("border_h") or border_style
    v = meta.get("border_v") or border_style
    return h, v


# Block types whose content area can be painted with a fill character
# (meta.fill, tasks/0051 phase 2).
FILL_TYPES = frozenset(
    {"box", "header", "footer", "sidebar", "content", "grid", "image"}
)


def fill_char(block_type: str, meta: dict | None) -> str:
    """The block's fill character (meta.fill), if applicable.

    fill applies only to FILL_TYPES; the value must be exactly one cell
    (a wide character would break the monospace grid). An absent or
    invalid value means no fill.
    """
    if block_type not in FILL_TYPES:
        return ""
    meta = meta or {}
    fill = meta.get("fill")
    if isinstance(fill, str) and len(fill) == 1:
        return fill
    return ""


# Arrow glyphs for line ends (meta.arrow_start / meta.arrow_end,
# tasks/0051 phase 3). Six head shapes per line direction (arrow,
# arrow-open, diamond, diamond-open, circle, circle-open); "none" (or an
# absent/invalid value) means no arrow.
ARROW_GLYPHS: dict[str, dict[str, dict[str, str]]] = {
    "hline": {
        "arrow": {"start": "◀", "end": "▶"},
        "arrow-open": {"start": "◁", "end": "▷"},
        "diamond": {"start": "◆", "end": "◆"},
        "diamond-open": {"start": "◇", "end": "◇"},
        "circle": {"start": "●", "end": "●"},
        "circle-open": {"start": "○", "end": "○"},
    },
    "vline": {
        "arrow": {"start": "▲", "end": "▼"},
        "arrow-open": {"start": "△", "end": "▽"},
        "diamond": {"start": "◆", "end": "◆"},
        "diamond-open": {"start": "◇", "end": "◇"},
        "circle": {"start": "●", "end": "●"},
        "circle-open": {"start": "○", "end": "○"},
    },
}


def arrow_glyph(block_type: str, value: str | None, end: str) -> str:
    """The arrow glyph for a line end (meta.arrow_start / meta.arrow_end).

    value is one of the six head shapes (anything else — absent, "none",
    invalid — means no arrow); end is "start" or "end". Only hline/vline
    have arrows.
    """
    if not isinstance(value, str):
        return ""
    glyphs = ARROW_GLYPHS.get(block_type)
    if glyphs is None or end not in ("start", "end"):
        return ""
    return glyphs.get(value, {}).get(end, "")


def h_align_offset(line_len: int, width: int, align: str | None) -> int:
    """Left offset of a line inside the content area (left — 0).

    center — the gap is split with the extra cell on the right; right —
    the whole gap precedes the line. A line that fills (or overflows) the
    area is not shifted.
    """
    if align not in ("center", "right") or width <= 0:
        return 0
    gap = width - line_len
    if gap <= 0:
        return 0
    return gap // 2 if align == "center" else gap


def v_align_offset(n_lines: int, height: int, valign: str | None) -> int:
    """Top offset of the line block inside the content area (top — 0).

    middle — the empty space is split with the extra row on the bottom;
    bottom — all empty rows precede the block. Overflowing content is not
    shifted (offset 0).
    """
    if valign not in ("middle", "bottom") or height <= 0:
        return 0
    if valign == "middle":
        return max(0, (height - n_lines) // 2)
    return max(0, height - n_lines)


def _fmt_px(v: float) -> str:
    """Format a pixel value: integers without a decimal part."""
    if v == int(v):
        return str(int(v))
    return str(v)


def text_block_size(content: str, border_style: str) -> tuple[int, int]:
    """Fit size of a text block: the content's extent plus the border.

    The text is not wrapped — the block grows to fit every explicit line.
    Empty content is one empty line. A border (any style except "none")
    adds one cell on each side. The result is at least 1×1.
    """
    lines = (content or "").split("\n")
    text_w = max((len(line) for line in lines), default=0)
    text_h = max(1, len(lines))
    if border_style != "none":
        return text_w + 2, text_h + 2
    return max(1, text_w), text_h


def _block_preview_html(
    bd: dict,
    char_width_px: float,
    char_height_px: float,
    padding_offset: float,
    is_root: bool,
) -> str:
    """Build the HTML for a block and its nested children.

    A root block is positioned relative to the canvas (padding_offset +
    grid * char_size). A child is positioned relative to its parent's div
    (1-cell container padding + relative grid * char_size); the parent's
    ``overflow:hidden`` clips it at the container border — mirroring the
    ASCII clip.
    """
    x = bd.get("x", 0)
    y = bd.get("y", 0)
    width = bd.get("width", 20)
    height = bd.get("height", 3)
    order = bd.get("order", 0)
    block_type = bd.get("block_type", "box")
    border_style = bd.get("border_style", "solid")
    meta = bd.get("meta") or {}

    if is_root:
        left = round(padding_offset + x * char_width_px, 1)
        top = round(padding_offset + y * char_height_px, 1)
    else:
        left = round((1 + x) * char_width_px, 1)
        top = round((1 + y) * char_height_px, 1)
    width_px = round(width * char_width_px, 1)
    height_px = round(height * char_height_px, 1)

    children = bd.get("children", [])
    style = (
        f"position:absolute;left:{_fmt_px(left)}px;top:{_fmt_px(top)}px;"
        f"width:{_fmt_px(width_px)}px;height:{_fmt_px(height_px)}px;"
        f"z-index:{10 + order};"
    )
    if children:
        style += "overflow:hidden;"

    border_map = {
        "solid": "solid",
        "dashed": "dashed",
        "dotted": "dotted",
        "double": "double",
        "none": "none",
    }
    bs = border_map.get(border_style, "solid")
    if block_type in ("hline", "vline"):
        direction = "h" if block_type == "hline" else "v"
        border_html = f'<div class="block-line block-line--{direction} block-line--{bs}"></div>'
    else:
        # Per-side border classes (meta.border_h / meta.border_v ?? border_style)
        h_style, v_style = effective_border_styles(border_style, meta)
        border_html = (
            f'<div class="block-border block-border--h-{border_map.get(h_style, "solid")}'
            f' block-border--v-{border_map.get(v_style, "solid")}"'
            f' style="width:100%;height:100%;"></div>'
        )

    children_html = "".join(
        _block_preview_html(c, char_width_px, char_height_px, padding_offset, False)
        for c in children
    )

    return (
        f'<div class="block-preview" data-block-id="{bd["id"]}"'
        f' style="{style}"'
        f' data-order="{order}">'
        f'<div class="block-inner block-{block_type}">'
        f'{border_html}'
        f'</div>'
        f'<div class="resize-handle" title="Drag to resize"></div>'
        f'{children_html}'
        f'</div>'
    )


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
        # Clip rectangle (half-open [x1, x2) × [y1, y2)) that all cell writes
        # must fall inside while rendering a container's children — this is
        # what keeps children from being drawn past the parent's border.
        self._clip: tuple[int, int, int, int] | None = None

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
        self._clip = None

        # Sort by order (ascending) — higher order renders on top
        sorted_blocks = sorted(blocks, key=lambda b: b.order)

        for block in sorted_blocks:
            self._render_block(block)

        lines = ["".join(row).rstrip() for row in self.grid]
        while lines and not lines[-1]:
            lines.pop()
        return "\n".join(lines)

    def _set(self, x: int, y: int, ch: str) -> None:
        """Write a cell, respecting the grid bounds and the active clip rect."""
        if not (0 <= x < self.grid_width and 0 <= y < self.grid_height):
            return
        if self._clip is not None:
            cx1, cy1, cx2, cy2 = self._clip
            if not (cx1 <= x < cx2 and cy1 <= y < cy2):
                return
        self.grid[y][x] = ch

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

        h_style, v_style = effective_border_styles(block.border_style, block.meta)
        has_border = (
            h_style != "none" or v_style != "none"
        ) and block.width >= 2 and block.height >= 2

        if has_border:
            self._draw_border(block, h_style, v_style)
            self._draw_content(block)
            if block.children:
                self._render_children_in_container(block, style_map)
        else:
            # No border - just place content at the block's position
            self._draw_content(block)

    def _draw_border(self, block: RenderBlock, h_style: str, v_style: str) -> None:
        """Draw the border of a block with per-side styles.

        H (top/bottom) and V (left/right) may differ (meta.border_h /
        meta.border_v). An edge is drawn only if its style is not "none";
        a corner only if BOTH adjacent sides are drawn. A corner takes the
        double glyph when either adjacent style is double (double wins).
        """
        x, y = block.x, block.y
        w, h = block.width, block.height

        # Clamp to grid
        x = max(0, min(x, self.grid_width - 2))
        y = max(0, min(y, self.grid_height - 2))
        w = min(w, self.grid_width - x)
        h = min(h, self.grid_height - y)

        if w < 2 or h < 2:
            return

        hm = BORDERS.get(h_style, BORDERS["solid"])
        vm = BORDERS.get(v_style, BORDERS["solid"])
        has_h = h_style != "none"
        has_v = v_style != "none"
        corner = BORDERS["double"] if (h_style == "double" or v_style == "double") else BORDERS["solid"]

        # Corners — only where both adjacent sides are drawn
        if has_h and has_v:
            self._set(x, y, corner["tl"])
            self._set(x + w - 1, y, corner["tr"])
            self._set(x, y + h - 1, corner["bl"])
            self._set(x + w - 1, y + h - 1, corner["br"])

        # Edges span the full extent of the block on their axis; where a
        # corner is drawn it occupies the end cell, so the edge fills the
        # interior. Without corners (the adjacent axis is "none") the edge
        # runs end to end.
        if has_h:
            for i in range(0 if not has_v else 1, w if not has_v else w - 1):
                self._set(x + i, y, hm["h"])
                self._set(x + i, y + h - 1, hm["h"])

        if has_v:
            for j in range(0 if not has_h else 1, h if not has_h else h - 1):
                self._set(x, y + j, vm["v"])
                self._set(x + w - 1, y + j, vm["v"])

    def _draw_line(self, block: RenderBlock, style: dict[str, str]) -> None:
        """Draw an hline (top row) or vline (left column) with style characters.

        Arrows (meta.arrow_start / meta.arrow_end) replace the end cells;
        a line shorter than 2 cells has no arrows.
        """
        x = max(0, min(block.x, self.grid_width - 1))
        y = max(0, min(block.y, self.grid_height - 1))
        meta = block.meta or {}

        if block.block_type == "hline":
            w = min(block.width, self.grid_width - x)
            n = max(1, w)
            for i in range(n):
                self._set(x + i, y, style["h"])
            if n >= 2:
                start = arrow_glyph("hline", meta.get("arrow_start"), "start")
                if start:
                    self._set(x, y, start)
                end = arrow_glyph("hline", meta.get("arrow_end"), "end")
                if end:
                    self._set(x + n - 1, y, end)
        else:  # vline
            h = min(block.height, self.grid_height - y)
            n = max(1, h)
            for j in range(n):
                self._set(x, y + j, style["v"])
            if n >= 2:
                start = arrow_glyph("vline", meta.get("arrow_start"), "start")
                if start:
                    self._set(x, y, start)
                end = arrow_glyph("vline", meta.get("arrow_end"), "end")
                if end:
                    self._set(x, y + n - 1, end)

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
                self._set(x, y, "[")
                self._set(x + w - 1, y, "]")
            else:
                # Side borders on all rows
                for j in range(h):
                    self._set(x, y + j, style["v"])
                    self._set(x + w - 1, y + j, style["v"])
                # Bottom border
                self._set(x, y + h - 1, style["bl"])
                self._set(x + w - 1, y + h - 1, style["br"])
                for i in range(1, w - 1):
                    self._set(x + i, y + h - 1, style["h"])
                if h >= 3:
                    # Top border
                    self._set(x, y, style["tl"])
                    self._set(x + w - 1, y, style["tr"])
                    for i in range(1, w - 1):
                        self._set(x + i, y, style["h"])

        # Label — single line, vertically centered, truncated to fit,
        # horizontally aligned (meta.text_align)
        if block.content:
            row = y + (h - 1) // 2
            inner_x = x + (1 if framed else 0)
            inner_w = w - (2 if framed else 0)
            if inner_w > 0 and row < self.grid_height:
                label = block.content.split("\n")[0][:inner_w]
                off = h_align_offset(len(label), inner_w, (block.meta or {}).get("text_align"))
                for i, ch in enumerate(label):
                    self._set(inner_x + off + i, row, ch)

    def _draw_content(self, block: RenderBlock) -> None:
        """Place block content inside its border area."""
        # Clamp block position and size to grid (same logic as _draw_border)
        x = max(0, min(block.x, self.grid_width - 2))
        y = max(0, min(block.y, self.grid_height - 2))
        w = min(block.width, self.grid_width - x)
        h = min(block.height, self.grid_height - y)

        if w < 1 or h < 1:
            return

        # Per-side border: the content is inset by one cell only where a
        # border is drawn (meta.border_h / meta.border_v ?? border_style)
        h_style, v_style = effective_border_styles(block.border_style, block.meta)
        has_h = h_style != "none"
        has_v = v_style != "none"
        has_border = has_h or has_v
        if has_border and (w < 2 or h < 2):
            return

        # Determine content area
        content_x = x + (1 if has_v else 0)
        content_y = y + (1 if has_h else 0)
        content_w = w - (2 if has_v else 0)
        content_h = h - (2 if has_h else 0)

        # Fill (meta.fill) paints the content area first; the content is
        # drawn on top (content wins) and the [type] hint is suppressed.
        # A block without a border fills its whole area.
        fill = fill_char(block.block_type, block.meta)
        if fill and content_w > 0 and content_h > 0:
            for j in range(content_h):
                row = content_y + j
                if row >= self.grid_height:
                    break
                for i in range(content_w):
                    self._set(content_x + i, row, fill)

        if not block.content:
            # Show type hint if no content and no fill
            if has_border and w >= 4 and not fill:
                hint = f"[{block.block_type}]"
                for i, ch in enumerate(hint):
                    if content_x + i < content_x + content_w and content_y < self.grid_height:
                        self._set(content_x + i, content_y, ch)
            return

        if content_w <= 0 or content_h <= 0:
            return

        # Wrap content by words to fit the content area, then align:
        # each line horizontally inside content_w (meta.text_align) and
        # the line block vertically inside content_h (meta.vertical_align).
        # Only the line's own cells are written — the offsets leave the
        # rest of the area untouched (fill / show-through intact).
        lines = self._wrap_text(block.content, content_w)
        v_off = v_align_offset(len(lines), content_h, (block.meta or {}).get("vertical_align"))
        h_align = (block.meta or {}).get("text_align")
        for line_idx, line in enumerate(lines):
            if line_idx + v_off >= content_h:
                break
            row = content_y + line_idx + v_off
            if row >= self.grid_height:
                break
            off = h_align_offset(len(line), content_w, h_align)
            for col_idx, ch in enumerate(line):
                self._set(content_x + off + col_idx, row, ch)

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
        """Render child blocks inside a parent container with padding.

        Children are placed at the parent's origin + 1-cell padding + their
        relative coordinates, and clipped to the parent's inner area (the
        border is not overdrawn): a child that is larger than the container,
        or offset past its edge, is cut off at the border instead of being
        drawn outside it.
        """
        pad_x = 1
        pad_y = 1

        # Inner area of the parent (half-open), in absolute grid coordinates
        inner = (
            parent.x + pad_x,
            parent.y + pad_y,
            parent.x + parent.width - pad_x,
            parent.y + parent.height - pad_y,
        )
        if inner[2] <= inner[0] or inner[3] <= inner[1]:
            return  # no inner area (degenerate container)

        # Intersect with the active clip (nested containers clip cumulatively)
        if self._clip is not None:
            inner = (
                max(inner[0], self._clip[0]),
                max(inner[1], self._clip[1]),
                min(inner[2], self._clip[2]),
                min(inner[3], self._clip[3]),
            )
            if inner[2] <= inner[0] or inner[3] <= inner[1]:
                return

        prev_clip = self._clip
        self._clip = inner
        try:
            # Sort by order (ascending) — higher order renders on top,
            # same z-index rule as root blocks in render().
            for child in sorted(parent.children, key=lambda c: c.order):
                child.x = parent.x + pad_x + child.x
                child.y = parent.y + pad_y + child.y
                self._render_block(child)
        finally:
            self._clip = prev_clip

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
                meta=bd.get("meta") or {},
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
                        meta=c.get("meta") or {},
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
        """Generate an HTML preview with positioned block divs and resize handles.

        Children are nested inside their parent's div and positioned relative
        to it (1-cell container padding + relative grid), so the parent's
        ``overflow:hidden`` clips them at the container border — mirroring the
        ASCII clip.
        """
        parts: list[str] = [
            _block_preview_html(bd, char_width_px, char_height_px, padding_offset, True)
            for bd in blocks_data
        ]
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
