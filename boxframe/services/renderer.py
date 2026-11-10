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

# Fixed lorem source for the content-block placeholder (todo-0004).
# ~245 chars; repeated (h+1) times to guarantee ≥ h wrapped lines at any width.
LOREM_PLACEHOLDER = (
    "lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do "
    "eiusmod tempor incididunt ut labore et dolore magna aliqua. ut "
    "enim ad minim veniam, quis nostrud exercitation ullamco laboris "
    "nisi ut aliquip ex ea commodo consequat."
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
    # Free-form block metadata (extended properties — fill, text/vertical
    # alignment, line arrows — tasks/0051). Absent keys inherit defaults.
    meta: dict = field(default_factory=dict)
    # A header attached to the top of its box parent (todo-0007), a
    # footer attached to the bottom (todo-0008), or a sidebar attached to
    # the left/right (todo-0009): no border on the three outer sides,
    # only the line across the box's inner extent (the side is in
    # attached_side). Set by _render_children_in_container (render-time,
    # the stored geometry is not touched).
    attached: bool = False
    attached_side: str = ""  # "top" | "bottom" | "left" | "right"

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
            f"{self._border_html(char_width_px, char_height_px)}"
            f"</div>"
            f'<div class="resize-handle" title="Drag to resize"></div>'
            f"</div>"
        )

    def _border_html(
        self, char_width_px: float = 12.0, char_height_px: float = 14.4
    ) -> str:
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

        if self.block_type == "divider":
            return _divider_segments_html(
                {
                    "width": self.width,
                    "height": self.height,
                    "content": self.content,
                    "meta": self.meta,
                },
                char_width_px,
                char_height_px,
                style,
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


# Block types whose content area can be painted with a fill character
# (meta.fill, tasks/0051 phase 2; extended to every framed block type in
# task 0073 — button, input, textarea, text). Lines (divider, hline,
# vline) are not frames and stay out of the matrix.
FILL_TYPES = frozenset(
    {"box", "header", "footer", "sidebar", "content", "grid", "image",
     "button", "input", "textarea", "text"}
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


def button_block_size(content: str, border_style: str) -> tuple[int, int]:
    """Fit size of a button (task 0060): the content's extent plus the
    button's border, which depends on the height.

    One line (including empty) fits the canonical h=1 form — ``[label]``
    (an empty label keeps one inner cell: ``[ ]``); N>=2 lines fit a full
    box, the label flush with the border (like text). A border (any style
    except "none") adds the frame cells; "none" is the text's extent
    (min 1x1).
    """
    lines = (content or "").split("\n")
    text_w = max((len(line) for line in lines), default=0)
    n_lines = max(1, len(lines))
    if border_style == "none":
        return max(1, text_w), n_lines
    if n_lines == 1:
        return max(3, text_w + 2), 1
    return text_w + 2, n_lines + 2


def divider_fit_size(content: str, width: int, height: int) -> tuple[int, int]:
    """Grow-only fit size of a divider (variant E, tasks/0003).

    The stored size grown to fit the content: width — the longest
    content line, height — the line count. Unlike text_block_size
    (exact fit), the result never shrinks the stored size — a smaller
    content (down to empty) keeps the size (a manual resize is kept
    until the next content change regrows the block).
    """
    lines = (content or "").split("\n")
    longest = max((len(line) for line in lines), default=0)
    n_lines = max(1, len(lines))
    return max(width, longest), max(height, n_lines)


def grid_meta_int(meta: dict | None, key: str, default: int) -> int:
    """A grid's cols/rows from meta (todo-0005): a positive int, or the
    default. An absent or invalid value (not an int, < 1) falls back —
    the renderer is tolerant, like fill_char."""
    v = (meta or {}).get(key)
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        return default
    return v


def grid_has_structure(meta: dict | None) -> bool:
    """Whether a grid has explicit structure in its meta (0069, backward
    compat): a valid cols or rows (a positive int). A grid without one
    (created before partitions existed) renders as a plain box — border,
    [grid] hint, children — exactly as before partitions were
    introduced."""
    for key in ("cols", "rows"):
        v = (meta or {}).get(key)
        if not isinstance(v, bool) and isinstance(v, int) and v >= 1:
            return True
    return False


def grid_create_meta(meta: dict | None) -> dict:
    """The meta of a NEW grid block (0069): the given meta with cols/rows
    defaulted (3/2) when absent or invalid, so the block renders with
    partitions. A grid without cols/rows in meta is a legacy block and
    renders as a plain box — creation is the only place the defaults are
    injected (updates and replace restore the stored meta as-is)."""
    m = dict(meta or {})
    for key, default in (("cols", 3), ("rows", 2)):
        v = m.get(key)
        if isinstance(v, bool) or not isinstance(v, int) or v < 1:
            m[key] = default
    return m


def grid_meta_widths(meta: dict | None, key: str) -> list[int] | None:
    """A grid's col_widths/row_heights from meta (0067): a non-empty list
    of ints >= 1 (cells), or None when absent/invalid — the caller falls
    back to the even split."""
    v = (meta or {}).get(key)
    if not isinstance(v, list) or not v:
        return None
    if any(isinstance(w, bool) or not isinstance(w, int) or w < 1 for w in v):
        return None
    return v


def _split_axis(widths: list[int] | None, n: int, total: int) -> list[int]:
    """Boundary positions x[0..n] (x[0] = 0, x[n] = total) for n
    columns/rows across `total` cells (0067).

    Even split (integer division, the remainder goes to the last one)
    when widths is absent or its length != n. Otherwise the prefix sums
    of the widths, clamped so every column/row keeps at least 1 cell —
    the last one absorbs the delta when the widths don't sum to total
    (an outer resize of the grid block, or a stale array).
    """
    if widths is None or len(widths) != n:
        return [(i * total) // n for i in range(n + 1)]
    x = [0]
    for i in range(1, n):
        x.append(min(x[-1] + widths[i - 1], total - (n - i)))
    x.append(total)
    return x


def grid_split(
    meta: dict | None, inner_w: int, inner_h: int
) -> tuple[int, int, list[int], list[int]]:
    """A grid's effective structure (todo-0005 + 0067): the effective
    column/row counts (clamped to the inner area, every column/row is at
    least 1 cell) and the partition boundary positions col_x/row_y.

    meta.cols / meta.rows (defaults 3/2, invalid → default) give the
    requested counts; meta.col_widths / meta.row_heights (0067) give the
    custom per-column/row widths in cells — absent/invalid → the even
    split (backward compatible)."""
    meta = meta or {}
    eff_cols = min(grid_meta_int(meta, "cols", 3), inner_w)
    eff_rows = min(grid_meta_int(meta, "rows", 2), inner_h)
    col_x = _split_axis(grid_meta_widths(meta, "col_widths"), eff_cols, inner_w)
    row_y = _split_axis(grid_meta_widths(meta, "row_heights"), eff_rows, inner_h)
    return eff_cols, eff_rows, col_x, row_y


def _grid_junction(
    part: dict[str, str], up: bool, down: bool, left: bool, right: bool
) -> str | None:
    """The box-drawing character of a grid junction (an interior cross or
    a frame node) from the four partition segments actually drawn around
    it (0063). A suppressed segment (under a child's span, 0062) degrades
    the node — ┼ → ├/┤/┬/┴/│/─ — so no line ends stick out of a spanned
    cell. None — no segment is drawn, nothing to place."""
    if up and down:
        if left and right:
            return part["b_b"]
        if left:
            return part["t_r"]
        if right:
            return part["t_l"]
        return part["v"]
    if left and right:
        if up:
            return part["b_l"]
        if down:
            return part["t_t"]
        return part["h"]
    if up and left:
        return part["bl"]
    if up and right:
        return part["tr"]
    if down and left:
        return part["br"]
    if down and right:
        return part["tl"]
    if up or down:
        return part["v"]
    if left or right:
        return part["h"]
    return None


_MIXED_LEFT = {("solid", "double"): "╞", ("double", "solid"): "╟"}
_MIXED_RIGHT = {("solid", "double"): "╡", ("double", "solid"): "╢"}
# Mixed junctions where an attached sidebar's VERTICAL line meets the
# box's HORIZONTAL border (todo-0009). Top: the through line is the box's
# horizontal border, the stem is the sidebar descending into the box.
# box=double/child=solid → ╤ (double horizontal, single down);
# box=solid/child=double → ╥ (single horizontal, double down). Bottom is
# the mirror (stem up): ╧ / ╨.
_MIXED_TOP = {("double", "solid"): "╤", ("solid", "double"): "╥"}
_MIXED_BOTTOM = {("double", "solid"): "╧", ("solid", "double"): "╨"}


def _attached_v_junction(box_style: str, child_style: str, end: str) -> str:
    """Junction where an attached sidebar's vertical line meets the box's
    horizontal border (todo-0009). Same styles → the style map's t_t (top)
    / b_l (bottom). Mixed solid/double → ╤╥ (top) / ╧╨ (bottom). Other
    mixes (dashed/dotted) → fallback to the box's junction (no dashed
    junction glyphs)."""
    key = "t_t" if end == "top" else "b_l"
    if box_style == child_style:
        return BORDERS.get(box_style, BORDERS["solid"])[key]
    table = _MIXED_TOP if end == "top" else _MIXED_BOTTOM
    junction = table.get((box_style, child_style))
    if junction:
        return junction
    return BORDERS.get(box_style, BORDERS["solid"])[key]


def _two_line_junction(through_style: str, stem_style: str, orient: str) -> str:
    """Junction at a corner where an attached horizontal line (a header/
    footer, trimmed by a dominant sidebar) or a vertical line (a sidebar,
    trimmed by a dominant header/footer) meets the dominant block's line
    (todo-0009). `through_style` is the dominant line (the two arms),
    `stem_style` the subordinate stem. `orient` gives the stem direction
    relative to the meeting cell: "down" (┬ family), "up" (┴), "right"
    (├), "left" (┤). Same styles → the style map glyph; mixed → the
    dominant style's glyph (Unicode has no clean asymmetric mixed T for
    these; the through-line style wins — the mixed ╤╥╧╨ set is reserved
    for the sidebar-vs-box-border junctions)."""
    key = {"down": "t_t", "up": "b_l", "right": "t_l", "left": "t_r"}[orient]
    return BORDERS.get(through_style, BORDERS["solid"])[key]


def _mixed_attached_junction(box_style: str, child_style: str, side: str) -> str:
    """Junction where an attached header/footer line meets the box border.
    The vertical arm belongs to the box border, the horizontal arm to the
    child line. Same styles: use the style map's t_l/t_r. Mixed
    solid/double: use Unicode mixed junctions (╞╡ left, ╟╢ right). Other
    mixes (dashed/dotted): fallback to box style's junction (Unicode has
    no dashed junctions)."""
    if box_style == child_style:
        return BORDERS.get(box_style, BORDERS["solid"])["t_l" if side == "left" else "t_r"]
    table = _MIXED_LEFT if side == "left" else _MIXED_RIGHT
    junction = table.get((box_style, child_style))
    if junction:
        return junction
    return BORDERS.get(box_style, BORDERS["solid"])["t_l" if side == "left" else "t_r"]


def _line_segment_html(
    top: float, col: int, length: int, char_width_px: float, style: str
) -> str:
    """One divider line segment: a zero-height div with a border-top at
    the row's vertical center (same alignment as .block-line--h top:50%)."""
    left = round(col * char_width_px, 1)
    w = round(length * char_width_px, 1)
    return (
        f'<div class="block-line block-line--h block-line--seg block-line--{style}"'
        f' style="top:{_fmt_px(top)}px;left:{_fmt_px(left)}px;width:{_fmt_px(w)}px;">'
        f"</div>"
    )


def _divider_segments_html(
    bd: dict,
    char_width_px: float,
    char_height_px: float,
    style: str,
) -> str:
    """HTML overlay of a divider (variant E): a line segment per row —
    up to two divs per row (left/right of the label), because the
    overlay sits above the ASCII layer and a full line would cross the
    text. Segments are computed from the label's position/length after
    alignment (meta.text_align, default center) and the vertical shift
    of the line block (meta.vertical_align, default middle); empty
    content — one div per row.
    """
    width = bd.get("width", 20)
    height = bd.get("height", 3)
    content = bd.get("content") or ""
    meta = bd.get("meta") or {}
    align = meta.get("text_align")
    if align not in ("left", "center", "right"):
        align = "center"
    valign = meta.get("vertical_align")
    if valign not in ("top", "middle", "bottom"):
        valign = "middle"

    lines = content.split("\n")
    v_off = v_align_offset(len(lines), height, valign)
    parts: list[str] = []
    for row in range(height):
        idx = row - v_off
        line = lines[idx][:width] if 0 <= idx < len(lines) else ""
        # An empty line has no offset (alignment is a no-op) — one
        # full-width segment per row
        off = h_align_offset(len(line), width, align) if line else 0
        top = round(row * char_height_px + char_height_px / 2, 1)
        if off > 0:
            parts.append(_line_segment_html(top, 0, off, char_width_px, style))
        right = width - off - len(line)
        if right > 0:
            parts.append(_line_segment_html(top, off + len(line), right, char_width_px, style))
    return "".join(parts)


def _attached_line_html(
    width: int,
    height: int,
    char_width_px: float,
    char_height_px: float,
    style: str,
    side: str,
) -> str:
    """HTML overlay of an attached header/footer/sidebar's line
    (todo-0007/0008/0009). For a header/footer (side "top"/"bottom") a
    zero-height div with a border-top at the line row's vertical center —
    the last row for a header, the first row for a footer. For a sidebar
    (side "left"/"right") a zero-width div with a border-left at the line
    column's horizontal center — the last column for a left sidebar, the
    first column for a right sidebar."""
    if side in ("left", "right"):
        left = round(((width - 0.5) if side == "left" else 0.5) * char_width_px, 1)
        return (
            f'<div class="block-line block-line--v block-line--seg block-line--{style}"'
            f' style="left:{_fmt_px(left)}px;top:0;height:100%;">'
            f"</div>"
        )
    top = round((0.5 if side == "bottom" else height - 0.5) * char_height_px, 1)
    return (
        f'<div class="block-line block-line--h block-line--seg block-line--{style}"'
        f' style="top:{_fmt_px(top)}px;left:0;width:100%;">'
        f"</div>"
    )


def _block_preview_html(
    bd: dict,
    char_width_px: float,
    char_height_px: float,
    padding_offset: float,
    is_root: bool,
    effective: tuple[int, int, int, int] | None = None,
    attached: bool = False,
    attached_side: str = "",
) -> str:
    """Build the HTML for a block and its nested children.

    A root block is positioned relative to the canvas (padding_offset +
    grid * char_size). A child is positioned relative to its parent's div
    (1-cell container padding + relative grid * char_size); children are
    wrapped in a ``.block-clip`` div (``overflow:hidden``, inset 0) that
    clips them at the container border — mirroring the ASCII clip. The
    clip lives on the wrapper, not on ``.block-preview`` itself, so the
    container's own outline (drawn OUTSIDE its border box) is not clipped.

    effective/attached (todo-0007/0008): a header whose top border is
    clipped by the box's top edge (relative y < 0) or a footer whose
    bottom border is clipped by the box's bottom edge (relative y + h >
    inner_h) is attached — the caller passes its effective geometry
    (flush with the top/bottom of the inner area, full inner width) and
    the line (bottom for a header, top for a footer) is drawn instead of
    the full outline.
    """
    x = bd.get("x", 0)
    y = bd.get("y", 0)
    width = bd.get("width", 20)
    height = bd.get("height", 3)
    order = bd.get("order", 0)
    block_type = bd.get("block_type", "box")
    border_style = bd.get("border_style", "solid")
    if effective is not None:
        x, y, width, height = effective

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
    elif block_type == "divider":
        border_html = _divider_segments_html(bd, char_width_px, char_height_px, bs)
    elif attached:
        side = attached_side or ("bottom" if block_type == "footer" else "top")
        border_html = _attached_line_html(width, height, char_width_px, char_height_px, bs, side)
    else:
        border_html = f'<div class="block-border block-border--{bs}" style="width:100%;height:100%;"></div>'

    children_html = []
    for c in children:
        # A header whose top border is clipped by the box's top edge
        # (relative y < 0), a footer whose bottom border is clipped by the
        # box's bottom edge (relative y + h > inner_h), or a sidebar whose
        # left/right border is clipped (x < 0 / x + w > inner_w) is
        # attached (todo-0007/0008/0009): effective geometry — flush with
        # the inner area at the full inner extent, the line instead of the
        # full outline. A block merely touching an edge stays detached.
        eff = None
        att = False
        att_side = ""
        c_type = c.get("block_type", "box")
        c_x = c.get("x", 0)
        c_y = c.get("y", 0)
        c_w = c.get("width", 20)
        c_h = c.get("height", 3)
        inner_w = max(0, width - 2)
        inner_h = max(0, height - 2)
        if block_type == "box" and c_type == "header" and c_y < 0:
            att, att_side = True, "top"
            eff = (0, 0, inner_w, c_h)
        elif block_type == "box" and c_type == "footer" and c_y + c_h > inner_h:
            att, att_side = True, "bottom"
            eff = (0, inner_h - c_h, inner_w, c_h)
        elif block_type == "box" and c_type == "sidebar" and c_x < 0:
            att, att_side = True, "left"
            eff = (0, 0, c_w, inner_h)
        elif block_type == "box" and c_type == "sidebar" and c_x + c_w > inner_w:
            att, att_side = True, "right"
            eff = (inner_w - c_w, 0, c_w, inner_h)
        children_html.append(
            _block_preview_html(c, char_width_px, char_height_px, padding_offset, False, eff, att, att_side)
        )
    children_html = "".join(children_html)
    if children:
        # Clip wrapper: children are clipped at the container border here,
        # while the container's own outline (outside its border box) stays
        # unclipped — .block-preview itself has no overflow.
        children_html = f'<div class="block-clip">{children_html}</div>'

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

        if block.block_type == "divider":
            self._draw_divider(block, style_map)
            return

        # A header attached to the top of its box parent (todo-0007) or a
        # footer attached to the bottom (todo-0008): no border on the
        # three outer sides — only the line across the box's inner extent
        # (bottom for a header, top for a footer, the far column for a
        # sidebar), the content on the other side of it. The junctions
        # with the box's border and the inner corner junctions are drawn
        # by the parent (in _render_children_in_container — the child is
        # clipped to the inner area).
        if block.block_type in ("header", "footer", "sidebar") and block.attached:
            self._draw_attached(block, style_map)
            if block.children:
                self._render_children_in_container(block, style_map)
            return

        # A grid with explicit structure in meta (a valid cols or rows)
        # renders the partitions; a legacy grid (no cols/rows — created
        # before partitions existed) falls through to the plain box path
        # (border + [grid] hint + children), as before (0069).
        if block.block_type == "grid" and grid_has_structure(block.meta):
            self._draw_grid(block, style_map)
            if block.children:
                self._render_children_in_container(block, style_map)
            return

        has_border = block.border_style != "none" and block.width >= 2 and block.height >= 2

        if has_border:
            self._draw_border(block, style_map)
        self._draw_content(block)
        # Children are rendered regardless of the parent's border: a
        # borderless container keeps the same 1-cell padding and inner
        # clip as a framed one (the HTML overlay and the editor's
        # coordinate math assume the padding unconditionally).
        if block.children:
            self._render_children_in_container(block, style_map)

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
        self._set(x, y, style["tl"])
        self._set(x + w - 1, y, style["tr"])
        self._set(x, y + h - 1, style["bl"])
        self._set(x + w - 1, y + h - 1, style["br"])

        # Top and bottom edges
        for i in range(1, w - 1):
            self._set(x + i, y, style["h"])
            self._set(x + i, y + h - 1, style["h"])

        # Left and right edges
        for j in range(1, h - 1):
            self._set(x, y + j, style["v"])
            self._set(x + w - 1, y + j, style["v"])

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
        h>=3: full box

        The label is word-wrapped to the inner width (explicit newlines
        are kept); the line block is vertically aligned
        (meta.vertical_align, default middle — unlike box, whose default
        is top) and each line is horizontally aligned
        (meta.text_align, default center — unlike box, whose default is
        left). Lines past the inner height are not drawn (the border is
        drawn first and is not overwritten). Fill (meta.fill) paints the
        inner area (task 0073); the label is drawn on top.
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

        # The inner area: h=1/h=2 — one row (row y), h>=3 — the rows
        # between the borders, none — the whole block.
        if framed:
            inner_x, inner_w = x + 1, w - 2
            if h >= 3:
                inner_y, inner_h = y + 1, h - 2
            else:
                inner_y, inner_h = y, 1
        else:
            inner_x, inner_y, inner_w, inner_h = x, y, w, h

        # Fill (meta.fill) paints the inner area; the label is drawn on
        # top (label wins).
        fill = fill_char(block.block_type, block.meta)
        if fill and inner_w > 0 and inner_h > 0:
            for j in range(inner_h):
                row = inner_y + j
                if row >= self.grid_height:
                    break
                for i in range(inner_w):
                    self._set(inner_x + i, row, fill)

        # Label — word-wrapped to the inner width, the line block
        # vertically aligned (meta.vertical_align, default middle) and
        # each line horizontally aligned (meta.text_align, default
        # center). meta.hide_text suppresses the label (the frame and
        # the fill stay).
        if block.content and not (block.meta or {}).get("hide_text"):
            if inner_w > 0 and inner_h > 0:
                meta = block.meta or {}
                align = meta.get("text_align")
                if align not in ("left", "center", "right"):
                    align = "center"
                valign = meta.get("vertical_align")
                if valign not in ("top", "middle", "bottom"):
                    valign = "middle"
                lines = self._wrap_text(block.content, inner_w)
                v_off = v_align_offset(len(lines), inner_h, valign)
                for line_idx, line in enumerate(lines):
                    if line_idx + v_off >= inner_h:
                        break
                    row = inner_y + line_idx + v_off
                    if row >= self.grid_height:
                        break
                    off = h_align_offset(len(line), inner_w, align)
                    for col_idx, ch in enumerate(line):
                        self._set(inner_x + off + col_idx, row, ch)

    def _draw_divider(self, block: RenderBlock, style: dict[str, str]) -> None:
        """Draw a divider (variant E, tasks/0003): a line on every row of
        the stored size, the label lines drawn over their rows as-is (no
        word wrap, no whitespace collapse), each line aligned
        independently (meta.text_align, default center); the line block
        is shifted vertically inside the stored height
        (meta.vertical_align, default middle — unlike box, whose default
        is top).

        The block is drawn within its stored size — no recalculation
        (the grow-only autosize lives in LayoutService). The label's own
        spaces spread the line (content wins over the line). Children
        are ignored (a line is an atomic element).
        """
        x = max(0, min(block.x, self.grid_width - 1))
        y = max(0, min(block.y, self.grid_height - 1))
        w = min(block.width, self.grid_width - x)
        h = min(block.height, self.grid_height - y)

        if w < 1 or h < 1:
            return

        # Line on every row (border_style none → invisible)
        if block.border_style != "none":
            for j in range(h):
                for i in range(w):
                    self._set(x + i, y + j, style["h"])

        # Label: each content line over its row, as-is, truncated to the
        # stored width, aligned (meta.text_align, default center); the
        # line block is shifted vertically (meta.vertical_align, default
        # middle), lines past the bottom are not drawn.
        # meta.hide_text suppresses the label (the line stays).
        if not (block.meta or {}).get("hide_text"):
            align = (block.meta or {}).get("text_align")
            if align not in ("left", "center", "right"):
                align = "center"
            valign = (block.meta or {}).get("vertical_align")
            if valign not in ("top", "middle", "bottom"):
                valign = "middle"
            lines = (block.content or "").split("\n")
            v_off = v_align_offset(len(lines), h, valign)
            for i, line in enumerate(lines):
                if i + v_off >= h:
                    break
                row = y + v_off + i
                if row >= self.grid_height:
                    break
                line = line[:w]
                off = h_align_offset(len(line), w, align)
                for col, ch in enumerate(line):
                    self._set(x + off + col, row, ch)

    def _draw_attached(self, block: RenderBlock, style: dict[str, str]) -> None:
        """Draw a header/footer/sidebar attached to its box parent
        (todo-0007/0008/0009). The side is in block.attached_side.

        The effective geometry (set by _render_children_in_container) is
        flush with the box's inner area — full inner width for a
        header/footer (top/bottom), full inner height for a sidebar
        (left/right). No border on the three outer sides — only the line
        across the full effective extent (the block's own border_style):
        the last/first row (header/footer) or the last/first column
        (sidebar-left/right). The content area is the strip on the other
        side of the line (full extent minus the line, or the full extent
        when border_style is none). Trimming by a dominant orthogonal
        attached block (todo-0009 corner) is already reflected in the
        effective width/height. The junctions with the box's border and
        the inner corner junctions are drawn by the parent (the child is
        clipped to the inner area and cannot write the border cells — the
        grid frame-node pattern, 0063)."""
        # Clamp to grid (same logic as _draw_border)
        x = max(0, min(block.x, self.grid_width - 2))
        y = max(0, min(block.y, self.grid_height - 2))
        w = min(block.width, self.grid_width - x)
        h = min(block.height, self.grid_height - y)

        if w < 1 or h < 1:
            return

        side = block.attached_side
        vertical = side in ("left", "right")
        has_line = block.border_style != "none"

        if vertical:
            if has_line:
                # The vertical line: the right column of the effective
                # rectangle for a left sidebar, the left column for a
                # right sidebar, full effective height.
                line_col = x + w - 1 if side == "left" else x
                for j in range(h):
                    self._set(line_col, y + j, style["v"])
            # Content area: w−1 columns on the side away from the line
            # (w when there is no line) × full height.
            if has_line and side == "left":
                content_x, content_w = x, w - 1
            elif has_line and side == "right":
                content_x, content_w = x + 1, w - 1
            else:
                content_x, content_w = x, w
            content_y, content_h = y, h
        else:
            is_bottom = side == "bottom"
            if has_line:
                # The line: the first row for a footer (bottom attach),
                # the last row for a header (top attach), full width.
                line_row = y if is_bottom else y + h - 1
                for i in range(w):
                    self._set(x + i, line_row, style["h"])
            # Content area: full width × h−1 rows on the other side of
            # the line (× h when there is no line).
            content_x, content_y = x, y
            if has_line and is_bottom:
                content_y = y + 1
            content_w = w
            content_h = h - (1 if has_line else 0)

        # Fill (meta.fill) paints the content area first; the content is
        # drawn on top (content wins) and the [type] hint is suppressed.
        fill = fill_char(block.block_type, block.meta)
        if fill and content_w > 0 and content_h > 0:
            for j in range(content_h):
                row = content_y + j
                if row >= self.grid_height:
                    break
                for i in range(content_w):
                    self._set(content_x + i, row, fill)

        # Hide text (meta.hide_text): the content and the [type] hint are
        # not drawn — the fill (above) and the line remain.
        if (block.meta or {}).get("hide_text"):
            return

        if not block.content:
            if has_line and content_w >= 4 and content_h > 0 and not fill:
                hint = f"[{block.block_type}]"
                for i, ch in enumerate(hint):
                    if content_x + i < content_x + content_w and content_y < self.grid_height:
                        self._set(content_x + i, content_y, ch)
            return

        if content_w <= 0 or content_h <= 0:
            return

        # Wrap content by words to fit the content area, then align (the
        # same rules as _draw_content: meta.text_align / vertical_align;
        # a sidebar keeps the box default top/left — no type override).
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

    def _dominant_corner(self, hr: dict, vr: dict) -> str | None:
        """Which of an attached horizontal (header/footer, `hr`) and
        vertical (sidebar, `vr`) block owns the corner they share
        (todo-0009). "H" → the horizontal block is full, the sidebar is
        trimmed; "V" → the sidebar is full, the horizontal block is
        trimmed; None → their *effective* rects do not overlap.

        The away test uses the EFFECTIVE (render-time, stretched) rects,
        not the saved positions: the block whose effective rect lies
        entirely beyond the other is the subordinate. Because an attached
        header/footer spans the full inner width and an attached sidebar
        the full inner height, their effective rects always intersect, so
        the away branches never fire in practice and dominance falls
        through to `order` (higher wins; on a tie the horizontal block —
        the classic app-chrome default). The saved-position test that
        preceded this used stored `x`/`y` and could wrongly report two
        blocks that physically cross as placed "diagonally apart" (a
        double-framed corner); basing it on the effective geometry makes
        every real intersection merge. """
        h_top = hr["side"] == "top"
        v_left = vr["side"] == "left"
        hx, hy, hw, hh = hr["eff"]
        vx, vy, vw, vh = vr["eff"]
        # Horizontal effective rect entirely beyond the vertical one (→ V full)
        away_h = (hx >= vx + vw) if v_left else (hx + hw <= vx)
        # Vertical effective rect entirely beyond the horizontal one (→ H full)
        away_v = (vy >= hy + hh) if h_top else (vy + vh <= hy)
        if away_h and away_v:
            return None  # effective rects do not overlap — no corner
        if away_h:
            return "V"
        if away_v:
            return "H"
        h_order, v_order = hr["c"].order, vr["c"].order
        if v_order > h_order:
            return "V"
        return "H"  # tie or higher h-order

    def _plan_attached(self, parent: RenderBlock) -> tuple[list, list]:
        """Plan attached header/footer/sidebar children of a box parent
        (todo-0007/0008/0009): set each attached child's `attached`,
        `attached_side` and its effective absolute geometry (flush with
        the inner area, full inner extent; trimmed at a shared corner by
        the dominant block). Returns (border_ops, meeting_ops) — lists of
        `(col, row, char)` the parent draws: border junctions (cells
        outside the inner clip — ├/┤ for header/footer, ┬/┴ for sidebar)
        and inner corner T-junctions where a trimmed block meets the
        dominant block's line. The child is clipped to the inner area and
        cannot write the border/meeting cells itself (grid frame-node
        pattern, 0063)."""
        border_ops: list[tuple[int, int, str]] = []
        meeting_ops: list[tuple[int, int, str]] = []
        if parent.block_type != "box":
            return border_ops, meeting_ops

        px, py = parent.x, parent.y
        pw, ph = parent.width, parent.height
        inner_w, inner_h = pw - 2, ph - 2
        box_style = parent.border_style

        for c in parent.children:
            c.attached = False
            c.attached_side = ""
        if inner_w < 1 or inner_h < 1:
            return border_ops, meeting_ops

        recs: list[dict] = []
        for c in parent.children:
            t = c.block_type
            cx, cy, cw, chh = c.x, c.y, c.width, c.height
            if t == "header" and cy < 0:
                side, clipped = "top", chh > inner_h
                eff = [px + 1, py + 1, inner_w, max(1, chh)]
            elif t == "footer" and cy + chh > inner_h:
                side, clipped = "bottom", chh > inner_h
                eff = [px + 1, py + 1 + inner_h - max(1, chh), inner_w, max(1, chh)]
            elif t == "sidebar" and cx < 0:
                side, clipped = "left", cw > inner_w
                eff = [px + 1, py + 1, max(1, cw), inner_h]
            elif t == "sidebar" and cx + cw > inner_w:
                side, clipped = "right", cw > inner_w
                eff = [px + 1 + inner_w - max(1, cw), py + 1, max(1, cw), inner_h]
            else:
                continue
            c.attached = True
            c.attached_side = side
            recs.append({
                "c": c, "side": side, "cx": cx, "cy": cy, "cw": cw, "ch": chh,
                "eff": eff, "clipped": clipped,
                "trim_left": False, "trim_right": False,
                "trim_top": False, "trim_bottom": False,
            })

        def line_col(vr):
            return vr["eff"][0] + vr["eff"][2] - 1 if vr["side"] == "left" else vr["eff"][0]

        def line_row(hr):
            return hr["eff"][1] + hr["eff"][3] - 1 if hr["side"] == "top" else hr["eff"][1]

        # Corner dominance → trim the subordinate and record the meeting
        # T-junction. Horizontal×vertical pairs only.
        for hr in recs:
            if hr["side"] not in ("top", "bottom") or hr["clipped"]:
                continue
            for vr in recs:
                if vr["side"] not in ("left", "right") or vr["clipped"]:
                    continue
                dom = self._dominant_corner(hr, vr)
                if dom == "H":
                    # Sidebar trimmed so its body sits on the far side of
                    # the header/footer line; the meeting T sits ON the
                    # dominant line and connects to the sidebar's line.
                    lr = line_row(hr)
                    col = line_col(vr)
                    if hr["side"] == "top":
                        # header line at row lr; sidebar body starts at lr+1
                        vr["eff"][1] = lr + 1
                        vr["eff"][3] = (py + ph - 1) - (lr + 1)
                        vr["trim_top"] = True
                        orient = "down"
                    else:
                        # footer line at row lr; sidebar body ends at lr−1
                        vr["eff"][3] = (lr - 1) - (py + 1) + 1
                        vr["trim_bottom"] = True
                        orient = "up"
                    if vr["eff"][3] < 1:
                        vr["eff"][3] = 1
                    meeting_ops.append((col, lr, _two_line_junction(
                        hr["c"].border_style, vr["c"].border_style, orient)))
                elif dom == "V":
                    # Header/footer trimmed so its body sits on the far
                    # side of the sidebar line; the meeting T sits ON the
                    # dominant (sidebar) line and connects to its line.
                    col = line_col(vr)
                    lr = line_row(hr)
                    if vr["side"] == "left":
                        # sidebar line at col; header body starts at col+1
                        hr["eff"][0] = col + 1
                        hr["eff"][2] = (px + pw - 1) - (col + 1)
                        hr["trim_left"] = True
                        orient = "right"
                    else:
                        # sidebar line at col; header body ends at col−1
                        hr["eff"][2] = (col - 1) - (px + 1) + 1
                        hr["trim_right"] = True
                        orient = "left"
                    if hr["eff"][2] < 1:
                        hr["eff"][2] = 1
                    meeting_ops.append((col, lr, _two_line_junction(
                        vr["c"].border_style, hr["c"].border_style, orient)))

        # Apply effective geometry and emit the border junctions for the
        # ends that were not trimmed away. A borderless parent draws no
        # junctions (there is no border to join) — the line just ends at
        # the inner edge (todo-0007/0008).
        for r in recs:
            c = r["c"]
            ex, ey, ew, eh = r["eff"]
            c.x, c.y, c.width, c.height = ex, ey, ew, eh
            if r["clipped"] or c.border_style == "none" or box_style == "none":
                continue
            side = r["side"]
            if side in ("top", "bottom"):
                row = ey + eh - 1 if side == "top" else ey
                if not r["trim_left"]:
                    border_ops.append((px, row, _mixed_attached_junction(box_style, c.border_style, "left")))
                if not r["trim_right"]:
                    border_ops.append((px + pw - 1, row, _mixed_attached_junction(box_style, c.border_style, "right")))
            else:
                col = ex + ew - 1 if side == "left" else ex
                if not r["trim_top"]:
                    border_ops.append((col, py, _attached_v_junction(box_style, c.border_style, "top")))
                if not r["trim_bottom"]:
                    border_ops.append((col, py + ph - 1, _attached_v_junction(box_style, c.border_style, "bottom")))

        return border_ops, meeting_ops

    def _draw_grid(self, block: RenderBlock, style: dict[str, str]) -> None:
        """Draw a grid (todo-0005): the outer border (per border_style)
        plus inner partitions — vertical (eff_cols − 1) and horizontal
        (eff_rows − 1) — with junction nodes from the style map. Only
        called for grids with explicit structure in meta (a valid cols or
        rows, 0069) — a legacy grid renders as a plain box instead.

        meta.cols / meta.rows (defaults 3/2, invalid → default) give the
        requested number of columns/rows; the effective count is clamped
        to the inner area (every column/row is at least 1 cell). The
        inner area is split evenly with integer division (the remainder
        goes to the last column/row) unless meta.col_widths /
        meta.row_heights (0067) give custom per-column/row widths in
        cells — then the partitions sit at the prefix sums of the
        widths, and the last column/row absorbs the delta when the
        widths don't sum to the inner size (an outer resize). The
        content is not rendered (a grid is a structural element, like a
        line) and the [type] hint is suppressed; fill (meta.fill) is
        painted under the partitions;
        children are rendered over the partitions (by the caller).
        border_style none — no outer border, solid partitions.

        Partitions are not drawn inside the children's span regions
        (0062, refined in 0064, re-refined in 0065, re-refined in 0066,
        re-refined in 0068): a child's span region is the union of the
        whole grid cells its half-open rectangle touches — a left/top
        edge flush with a cell boundary spans the cell on the other side
        of it (the child's border is drawn over the boundary, 0066), but
        a right/bottom edge flush does not (the boundary stays drawn,
        0068). A partition is suppressed only where the child actually
        crosses it (0065): a vertical partition is removed across the
        spanned rows only if the child straddles it, a horizontal one
        across the spanned columns only if the child straddles it, and a
        cell at their crossing only if the child straddles both — so a
        spanned cell keeps the borders of the cells it does not cross. A
        partition under the child's own left/top border counts as
        crossed (0066) — the child's border is drawn over it. The skip is
        applied at draw time (the fill/space under a skipped partition
        cell is left untouched).
        The frame nodes on the outer border and the interior junctions
        reflect the segments actually drawn around them (0063): a
        suppressed segment degrades the node (┬ → ─, ├ → │, ┼ → ├/┬/│/─),
        so no line ends stick out of a spanned cell.
        """
        x = max(0, min(block.x, self.grid_width - 2))
        y = max(0, min(block.y, self.grid_height - 2))
        w = min(block.width, self.grid_width - x)
        h = min(block.height, self.grid_height - y)

        if w < 1 or h < 1:
            return

        framed = block.border_style != "none" and w >= 2 and h >= 2
        if framed:
            self._draw_border(block, style)
            inner_x, inner_y = x + 1, y + 1
            inner_w, inner_h = w - 2, h - 2
        else:
            inner_x, inner_y = x, y
            inner_w, inner_h = w, h

        if inner_w <= 0 or inner_h <= 0:
            return

        # Fill under the partitions (meta.fill)
        fill = fill_char(block.block_type, block.meta)
        if fill:
            for j in range(inner_h):
                row = inner_y + j
                if row >= self.grid_height:
                    break
                for i in range(inner_w):
                    self._set(inner_x + i, row, fill)

        # Partitions: the frame's style (none → solid)
        part = style if framed else BORDERS["solid"]

        eff_cols, eff_rows, col_x, row_y = grid_split(block.meta, inner_w, inner_h)

        # Span regions (absolute, half-open): the union of the whole grid
        # cells each child's rectangle touches (0062, refined in 0064,
        # re-refined in 0065, re-refined in 0066, re-refined in 0068) —
        # the child's half-open rect intersects the cell's closed range:
        # a left/top edge flush with a cell boundary spans the cell on
        # the other side of it (the child's border is drawn over the
        # boundary, 0066), but a right/bottom edge flush does not (the
        # child's border sits one cell short of the boundary, which stays
        # drawn, 0068). A partition is suppressed only where the child
        # actually crosses it (0065): a vertical partition is removed
        # across the spanned rows only if the child straddles it, a
        # horizontal one across the spanned columns only if the child
        # straddles it; at a crossing of the two the cell is removed only
        # if the child straddles both — so a spanned cell keeps the
        # borders of the cells it does not cross. A partition under the
        # child's own left/top border counts as crossed (0066): the
        # child's border is drawn over it, so it is hidden. Same origin
        # as _render_children_in_container (1-cell padding), clipped to
        # the inner area.
        v_parts = {inner_x + col_x[i] for i in range(1, eff_cols)}
        h_parts = {inner_y + row_y[j] for j in range(1, eff_rows)}
        child_spans = []
        for c in block.children:
            if c.width < 1 or c.height < 1:
                continue
            rx0 = max(block.x + 1 + c.x, inner_x)
            ry0 = max(block.y + 1 + c.y, inner_y)
            rx1 = min(block.x + 1 + c.x + c.width, inner_x + inner_w)
            ry1 = min(block.y + 1 + c.y + c.height, inner_y + inner_h)
            if not (rx1 > rx0 and ry1 > ry0):
                continue
            ix0, iy0 = rx0 - inner_x, ry0 - inner_y
            ix1, iy1 = rx1 - inner_x, ry1 - inner_y
            # The child's half-open rect [ix0, ix1) intersects the cell's
            # closed range [col_x[i], col_x[i+1]]: the left/top edge flush
            # with a boundary counts (the child's border is drawn over it),
            # the right/bottom edge flush does not (its border sits one
            # cell short of the boundary, which stays drawn).
            cols = [i for i in range(eff_cols)
                    if col_x[i] < ix1 and col_x[i + 1] >= ix0]
            rows = [j for j in range(eff_rows)
                    if row_y[j] < iy1 and row_y[j + 1] >= iy0]
            if not cols or not rows:
                continue
            crossed_v = {p for p in v_parts if rx0 <= p < rx1}
            crossed_h = {q for q in h_parts if ry0 <= q < ry1}
            child_spans.append((
                inner_x + col_x[cols[0]],
                inner_y + row_y[rows[0]],
                inner_x + col_x[cols[-1] + 1],
                inner_y + row_y[rows[-1] + 1],
                crossed_v,
                crossed_h,
            ))

        def covered(px: int, py: int) -> bool:
            px_v = px in v_parts
            py_h = py in h_parts
            for sx0, sy0, sx1, sy1, cv, ch in child_spans:
                if not (sx0 <= px < sx1 and sy0 <= py < sy1):
                    continue
                if px_v and px in cv and (not py_h or py in ch):
                    return True
                if py_h and py in ch and (not px_v or px in cv):
                    return True
            return False

        # Vertical partitions
        for i in range(1, eff_cols):
            cx = inner_x + col_x[i]
            for j in range(inner_h):
                if covered(cx, inner_y + j):
                    continue
                self._set(cx, inner_y + j, part["v"])

        # Horizontal partitions
        for j in range(1, eff_rows):
            ry = inner_y + row_y[j]
            for i in range(inner_w):
                if covered(inner_x + i, ry):
                    continue
                self._set(inner_x + i, ry, part["h"])

        # Frame nodes and interior junctions reflect the partition
        # segments actually drawn around them (0063): a segment
        # suppressed by a child's span (0062/0064) degrades the node, so
        # no line ends stick out of a spanned cell.
        if framed:
            for i in range(1, eff_cols):
                cx = inner_x + col_x[i]
                self._set(
                    cx, y,
                    part["t_t"] if not covered(cx, inner_y) else part["h"])
                self._set(
                    cx, y + h - 1,
                    part["b_l"] if not covered(cx, inner_y + inner_h - 1)
                    else part["h"])
            for j in range(1, eff_rows):
                ry = inner_y + row_y[j]
                self._set(
                    x, ry,
                    part["t_l"] if not covered(inner_x, ry) else part["v"])
                self._set(
                    x + w - 1, ry,
                    part["t_r"] if not covered(inner_x + inner_w - 1, ry)
                    else part["v"])

        for i in range(1, eff_cols):
            for j in range(1, eff_rows):
                px = inner_x + col_x[i]
                py = inner_y + row_y[j]
                if covered(px, py):
                    continue
                ch = _grid_junction(
                    part,
                    not covered(px, py - 1),
                    not covered(px, py + 1),
                    not covered(px - 1, py),
                    not covered(px + 1, py),
                )
                if ch is not None:
                    self._set(px, py, ch)

    def _draw_content(self, block: RenderBlock) -> None:
        """Place block content inside its border area."""
        # Clamp block position and size to grid (same logic as _draw_border)
        x = max(0, min(block.x, self.grid_width - 2))
        y = max(0, min(block.y, self.grid_height - 2))
        w = min(block.width, self.grid_width - x)
        h = min(block.height, self.grid_height - y)

        if w < 1 or h < 1:
            return

        # The content is inset by one cell where a border is drawn
        has_border = block.border_style != "none"
        if has_border and (w < 2 or h < 2):
            return

        # Determine content area
        content_x = x + (1 if has_border else 0)
        content_y = y + (1 if has_border else 0)
        content_w = w - (2 if has_border else 0)
        content_h = h - (2 if has_border else 0)

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

        # Hide text (meta.hide_text): the content, the lorem placeholder
        # and the [type] hint are not drawn — the fill (above) and the
        # border (drawn by the caller) remain.
        if (block.meta or {}).get("hide_text"):
            return

        if not block.content:
            if block.block_type == "content" and not fill and content_w > 0 and content_h > 0:
                # Lorem placeholder (todo-0004): deterministic lines wrapped
                # to the content area, last line shorter — "like a paragraph".
                # Regenerated on each render (live re-layout on resize).
                lines = self.placeholder_lines(content_w, content_h)
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
            elif has_border and w >= 4 and not fill:
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

    def placeholder_lines(self, w: int, h: int) -> list[str]:
        """Lorem placeholder lines for an empty content block (todo-0004).

        Wraps the fixed lorem source to width *w*, takes the first *h*
        lines, and shortens the last line to ~70% of *w* (only when
        h >= 2 and w >= 4) — "like a paragraph". Regenerated on each
        render from the current size (live re-layout on resize).
        """
        if w <= 0 or h <= 0:
            return []
        text = (LOREM_PLACEHOLDER + " ") * (h + 1)
        lines = self._wrap_text(text, w)[:h]
        if h >= 2 and w >= 4 and lines:
            lines[-1] = lines[-1][: max(3, w * 7 // 10)]
        return lines

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

        # Attached header/footer/sidebar children of a box: effective
        # geometry + corner dominance are planned here (render-time — the
        # stored relative geometry is consumed, not mutated outside this
        # pass). The plan sets child.attached/attached_side and the
        # effective absolute x/y/width/height, and returns the junction
        # cells the parent must draw (border junctions outside the inner
        # clip; inner corner T-junctions over the child lines).
        border_ops, meeting_ops = self._plan_attached(parent)

        prev_clip = self._clip
        # Border junctions live on the parent's border cells — outside the
        # inner clip — so draw them under the outer clip, before it narrows.
        for col, row, ch in border_ops:
            self._set(col, row, ch)
        self._clip = inner
        try:
            # Sort by order (ascending) — higher order renders on top,
            # same z-index rule as root blocks in render().
            for child in sorted(parent.children, key=lambda c: c.order):
                # An attached child already carries its effective absolute
                # geometry from _plan_attached; a normal child is placed
                # at the parent's inner origin + its relative coords.
                if not child.attached:
                    child.x = parent.x + pad_x + child.x
                    child.y = parent.y + pad_y + child.y
                self._render_block(child)
            # Inner corner T-junctions: drawn after the children so the
            # junction overrides the trimmed block's line end (both child
            # lines pass through the meeting cell).
            for col, row, ch in meeting_ops:
                self._set(col, row, ch)
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
        default canvas size (80×24). Children nest at arbitrary depth
        (each dict may carry its own `children` list).
        """

        def to_render_block(bd: dict) -> RenderBlock:
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
            rb.children = [to_render_block(c) for c in bd.get("children", [])]
            return rb

        renderer = cls(width, height)
        return renderer.render([to_render_block(bd) for bd in blocks_data])

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
        to it (1-cell container padding + relative grid); a ``.block-clip``
        wrapper (``overflow:hidden``) clips them at the container border —
        mirroring the ASCII clip — while the parent's own outline stays
        visible (it is drawn outside the parent's border box).
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
