"""Tests for the pseudo-graphic renderer."""

from boxframe.services.renderer import RenderBlock, PseudoGraphicRenderer


def _render(blocks_data: list[dict], width: int = 40, height: int = 12) -> str:
    return PseudoGraphicRenderer.render_simple(blocks_data, width, height)


def test_empty_layout():
    result = _render([], 40, 12)
    lines = result.strip().split("\n")
    assert len(lines) <= 12


def test_render_strips_trailing_empty_rows():
    """Trailing empty rows are not part of the art (clean exports/copies)."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "content": "",
        "border_style": "solid",
    }], width=40, height=12)
    lines = result.split("\n")
    assert len(lines) == 4  # canvas is 40×12, the box ends at row 3
    assert not result.endswith("\n")


def test_render_empty_layout_is_empty_string():
    assert _render([], 40, 12) == ""


def test_single_box():
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "content": "",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    # Top border
    assert lines[0][0] == "┌"
    assert lines[0][9] == "┐"
    assert all(c == "─" for c in lines[0][1:9])
    # Middle row
    assert lines[1][0] == "│"
    assert lines[1][9] == "│"
    # Bottom border
    assert lines[3][0] == "└"
    assert lines[3][9] == "┘"
    assert all(c == "─" for c in lines[3][1:9])


def test_box_with_content():
    result = _render([{
        "block_type": "button",
        "x": 0, "y": 0,
        "width": 12, "height": 3,
        "content": "Submit",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    # Content on second line
    assert "Submit" in lines[1]


def test_nested_blocks():
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 20, "height": 6,
        "content": "",
        "border_style": "solid",
        "children": [{
            "block_type": "text",
            "x": 1, "y": 1,
            "width": 8, "height": 1,
            "content": "Hello",
            "border_style": "none",
        }],
    }])
    lines = result.split("\n")
    assert lines[0][0] == "┌"
    # "Hello" should be inside the box
    assert "Hello" in lines[2]


def test_render_simple_deep_nesting():
    """render_simple recurses at arbitrary depth — a grandchild is drawn."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 24, "height": 10,
        "content": "",
        "border_style": "solid",
        "children": [{
            "block_type": "box",
            "x": 1, "y": 1,
            "width": 16, "height": 6,
            "content": "",
            "border_style": "solid",
            "children": [{
                "block_type": "text",
                "x": 1, "y": 1,
                "width": 6, "height": 1,
                "content": "Deep",
                "border_style": "none",
            }],
        }],
    }])
    lines = result.split("\n")
    # Child absolute position: (0+1+1, 0+1+1) = (2, 2); grandchild:
    # (2+1+1, 2+1+1) = (4, 4)
    assert "Deep" in lines[4]


def test_border_styles():
    corners = {
        "solid": ("┌", "┐"),
        "dashed": ("┌", "┐"),
        "dotted": ("┌", "┐"),
        "double": ("╔", "╗"),
    }
    for style in ["solid", "dashed", "dotted", "double"]:
        result = _render([{
            "block_type": "box",
            "x": 0, "y": 0,
            "width": 6, "height": 3,
            "content": "",
            "border_style": style,
        }])
        lines = result.split("\n")
        tl, tr = corners[style]
        assert lines[0][0] == tl
        assert lines[0][5] == tr


def test_no_border():
    result = _render([{
        "block_type": "text",
        "x": 2, "y": 2,
        "width": 10, "height": 2,
        "content": "Free text",
        "border_style": "none",
    }])
    lines = result.split("\n")
    assert "Free text" in lines[2]


def test_multiple_blocks():
    result = _render([
        {
            "block_type": "header",
            "x": 0, "y": 0,
            "width": 30, "height": 3,
            "content": "My App",
            "border_style": "solid",
        },
        {
            "block_type": "content",
            "x": 0, "y": 3,
            "width": 30, "height": 6,
            "content": "Main content area",
            "border_style": "solid",
        },
    ])
    lines = result.split("\n")
    assert "My App" in lines[1]
    assert "Main content area" in lines[4]


def test_grid_expansion():
    """Blocks extending beyond the layout bounds expand the canvas."""
    result = _render([{
        "block_type": "box",
        "x": 35, "y": 10,
        "width": 10, "height": 4,
        "content": "",
        "border_style": "solid",
    }], width=40, height=14)
    lines = result.split("\n")
    # Canvas is the 80×24 default floor — the full box is drawn, not clamped
    assert lines[10][35] == "┌"
    assert lines[10][44] == "┐"
    assert lines[13][35] == "└"
    assert lines[13][44] == "┘"


def test_render_keeps_layout_size_when_blocks_fit():
    """Canvas stays at the layout size when all blocks fit inside
    (layout size above the default floor)."""
    r = PseudoGraphicRenderer(100, 30)
    r.render([RenderBlock(
        x=0, y=0, width=10, height=3,
        block_type="box", content="", border_style="solid",
    )])
    assert len(r.grid) == 30
    assert len(r.grid[0]) == 100


def test_canvas_size_expands_for_blocks_outside_layout():
    inside = RenderBlock(
        x=0, y=0, width=10, height=3,
        block_type="box", content="", border_style="solid",
    )
    # Set dimensions below the default floor keep the floor
    assert PseudoGraphicRenderer.canvas_size([inside], 40, 12) == (80, 24)

    # A block past the floor expands the canvas
    outside = RenderBlock(
        x=75, y=20, width=10, height=5,
        block_type="box", content="", border_style="solid",
    )
    assert PseudoGraphicRenderer.canvas_size([outside], 40, 14) == (85, 25)


def test_canvas_size_counts_children():
    """Children are counted with their 1-cell container padding."""
    child = RenderBlock(
        x=5, y=0, width=10, height=2,
        block_type="text", content="hi", border_style="none",
    )
    parent = RenderBlock(
        x=70, y=0, width=10, height=10,
        block_type="box", content="", border_style="solid",
        children=[child],
    )
    # Child absolute x = 70 + 1 + 5 = 76, extends to 86 > 80
    assert PseudoGraphicRenderer.canvas_size([parent], 80, 24) == (86, 24)


def test_canvas_size_without_dimensions():
    """Unset layout dimensions (None) fall back to the default canvas (80×24)."""
    block = RenderBlock(
        x=5, y=2, width=10, height=3,
        block_type="box", content="", border_style="solid",
    )
    assert PseudoGraphicRenderer.canvas_size([block], None, None) == (80, 24)
    assert PseudoGraphicRenderer.canvas_size([], None, None) == (80, 24)
    # A set dimension smaller than the default keeps the default floor
    assert PseudoGraphicRenderer.canvas_size([block], 40, None) == (80, 24)
    # A set dimension larger than the default raises the floor for that axis
    assert PseudoGraphicRenderer.canvas_size([block], 100, None) == (100, 24)


def test_render_bounds_html():
    """Bounds overlay: a set width/height draws a line, unset draws nothing."""
    html = PseudoGraphicRenderer.render_bounds_html(40, 12, 12.0, 14.4, 16.0)
    assert 'class="layout-bounds layout-bounds--v"' in html
    assert 'class="layout-bounds layout-bounds--h"' in html
    # Vertical line at x=40: 16 + 40*12 = 496px; horizontal at y=12: 16 + 12*14.4
    assert "left:496px" in html
    assert "top:188.8px" in html

    assert PseudoGraphicRenderer.render_bounds_html(None, None) == ""
    assert "layout-bounds--v" not in PseudoGraphicRenderer.render_bounds_html(None, 12)
    assert "layout-bounds--h" not in PseudoGraphicRenderer.render_bounds_html(40, None)


def test_double_border():
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 6, "height": 3,
        "content": "",
        "border_style": "double",
    }])
    lines = result.split("\n")
    assert lines[0][0] == "╔"
    assert lines[0][5] == "╗"
    assert all(c == "═" for c in lines[0][1:5])


# ── Fill tests (tasks/0051, phase 2) ──────────────────────


def _fill_box(meta=None, border_style="solid", width=8, height=4, content=""):
    data = {
        "block_type": "box",
        "x": 0, "y": 0,
        "width": width, "height": height,
        "content": content,
        "border_style": border_style,
    }
    if meta is not None:
        data["meta"] = meta
    return [data]


def test_fill_char():
    from boxframe.services.renderer import fill_char
    assert fill_char("box", {"fill": "░"}) == "░"
    assert fill_char("image", {"fill": "█"}) == "█"
    assert fill_char("box", {"fill": " "}) == " "  # space is a valid fill
    assert fill_char("box", None) == ""
    assert fill_char("box", {}) == ""
    assert fill_char("box", {"fill": ""}) == ""
    assert fill_char("box", {"fill": "ab"}) == ""  # more than one cell
    assert fill_char("box", {"fill": 5}) == ""     # not a string
    # Not in the fill matrix
    for t in ["button", "input", "textarea", "text", "divider", "hline", "vline"]:
        assert fill_char(t, {"fill": "░"}) == ""


def test_fill_empty_box():
    """fill paints the content area; the [type] hint is suppressed."""
    result = _render(_fill_box({"fill": "░"}))
    lines = result.split("\n")
    assert lines[0] == "┌──────┐"
    assert lines[1] == "│░░░░░░│"
    assert lines[2] == "│░░░░░░│"
    assert lines[3] == "└──────┘"


def test_fill_suppresses_type_hint():
    result = _render(_fill_box({"fill": "█"}))
    assert "[box]" not in result


def test_fill_content_on_top():
    """Content is drawn over the fill (content wins)."""
    result = _render(_fill_box({"fill": "░"}, content="Hi"))
    lines = result.split("\n")
    assert lines[1] == "│Hi░░░░│"
    assert lines[2] == "│░░░░░░│"


def test_fill_wrapped_content():
    """Wrapped lines are each drawn over the fill. The wrap keeps the
    trailing space of the first line (spaces are formatting) — it is
    drawn over the fill like any content cell."""
    result = _render(_fill_box({"fill": "·"}, content="Hello World"))
    lines = result.split("\n")
    assert lines[1] == "│Hello │"  # trailing space overwrites the fill
    assert lines[2] == "│World·│"


def test_fill_no_border_fills_whole_area():
    """A block without a border fills its whole area."""
    result = _render(_fill_box({"fill": "▒"}, border_style="none", width=6, height=3))
    lines = result.split("\n")
    assert lines[0] == "▒▒▒▒▒▒"
    assert lines[1] == "▒▒▒▒▒▒"
    assert lines[2] == "▒▒▒▒▒▒"


def test_fill_ignored_for_other_types():
    """fill applies only to the spec's types (matrix): button/text/input/
    divider/lines render identically with and without meta.fill."""
    cases = [
        {"block_type": "button", "width": 12, "height": 3, "content": "Btn"},
        {"block_type": "text", "width": 10, "height": 2, "content": "t",
         "border_style": "none"},
        {"block_type": "input", "width": 10, "height": 2, "content": ""},
        {"block_type": "divider", "width": 10, "height": 1, "content": ""},
        {"block_type": "hline", "width": 10, "height": 1, "content": ""},
        {"block_type": "vline", "width": 1, "height": 5, "content": ""},
    ]
    for case in cases:
        base = {"x": 0, "y": 0, "border_style": "solid", "order": 0}
        plain = _render([dict(case, **base)])
        with_fill = _render([dict(case, **base, meta={"fill": "░"})])
        assert with_fill == plain, case["block_type"]


def test_fill_invalid_values():
    """Invalid meta.fill (multi-char, empty, non-string) → no fill."""
    plain = _render(_fill_box(None))
    for bad in ["ab", "", 5, None]:
        assert _render(_fill_box({"fill": bad})) == plain, bad


def test_fill_image_block():
    """image is in the fill matrix: the hint is suppressed, the area filled."""
    result = _render([{
        "block_type": "image",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "content": "",
        "border_style": "solid",
        "meta": {"fill": "█"},
    }])
    lines = result.split("\n")
    assert lines[0] == "┌────────┐"
    assert lines[1] == "│████████│"
    assert lines[2] == "│████████│"
    assert lines[3] == "└────────┘"


def test_fill_children_container():
    """A filled container: children are drawn on top of the fill."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 20, "height": 6,
        "content": "",
        "border_style": "solid",
        "meta": {"fill": "░"},
        "children": [{
            "block_type": "text",
            "x": 1, "y": 1,
            "width": 8, "height": 1,
            "content": "Hello",
            "border_style": "none",
        }],
    }])
    lines = result.split("\n")
    assert lines[0] == "┌" + "─" * 18 + "┐"
    assert lines[1] == "│" + "░" * 18 + "│"
    assert lines[2] == "│░Hello" + "░" * 12 + "│"
    assert lines[3] == "│" + "░" * 18 + "│"
    assert lines[4] == "│" + "░" * 18 + "│"
    assert lines[5] == "└" + "─" * 18 + "┘"


def test_fill_space_erases_block_below():
    """A space fill (meta.fill=" ") erases the block underneath — the
    'show through' case. Without a fill the lower block's content shows
    through the upper (empty) block; with a space fill the upper block's
    blank fill overwrites it (the grid is space-initialized, so writing a
    space overwrites whatever was drawn before)."""
    lower = {
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 12, "height": 3,
        "content": "ABCDEFGHIJ",
        "border_style": "solid",
        "order": 0,
    }
    # Upper block with no fill: the lower content shows through (the
    # upper [box] hint covers the first cells, the rest stays visible)
    show_through = _render([lower, dict(lower, content="", order=1)])
    assert "FGHIJ" in show_through

    # Upper block with a space fill: the lower content is erased
    result = _render([lower, dict(lower, content="", order=1,
                                  meta={"fill": " "})])
    lines = result.split("\n")
    assert lines[0] == "┌──────────┐"
    assert lines[1] == "│          │"  # 10 spaces — the lower content is erased
    assert lines[2] == "└──────────┘"
    assert "ABCDEFGHIJ" not in result


# ── Line block tests (hline / vline) ──────────────────────


def test_hline_solid():
    result = _render([{
        "block_type": "hline",
        "x": 2, "y": 3,
        "width": 8, "height": 1,
        "content": "",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    assert lines[3][2:10] == "────────"


def test_hline_all_styles():
    chars = {"solid": "─", "dashed": "┄", "dotted": "┈", "double": "═"}
    for style, ch in chars.items():
        result = _render([{
            "block_type": "hline",
            "x": 0, "y": 0,
            "width": 5, "height": 1,
            "content": "",
            "border_style": style,
        }])
        assert result.split("\n")[0][:5] == ch * 5


def test_vline_solid():
    result = _render([{
        "block_type": "vline",
        "x": 4, "y": 1,
        "width": 1, "height": 4,
        "content": "",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    for i in range(1, 5):
        assert lines[i][4] == "│"


def test_vline_all_styles():
    chars = {"solid": "│", "dashed": "┆", "dotted": "┊", "double": "║"}
    for style, ch in chars.items():
        result = _render([{
            "block_type": "vline",
            "x": 0, "y": 0,
            "width": 1, "height": 4,
            "content": "",
            "border_style": style,
        }])
        lines = result.split("\n")
        for i in range(4):
            assert lines[i][0] == ch


def test_line_none_is_invisible():
    result = _render([{
        "block_type": "hline",
        "x": 0, "y": 0,
        "width": 5, "height": 1,
        "content": "",
        "border_style": "none",
    }])
    assert result.strip() == ""


def test_line_ignores_content():
    result = _render([{
        "block_type": "hline",
        "x": 0, "y": 0,
        "width": 8, "height": 1,
        "content": "text",
        "border_style": "solid",
    }])
    assert result.split("\n")[0] == "────────"


def test_hline_beyond_layout():
    """An hline extending past the layout bounds is drawn in full."""
    result = _render([{
        "block_type": "hline",
        "x": 35, "y": 0,
        "width": 20, "height": 1,
        "content": "",
        "border_style": "solid",
    }], width=40, height=12)
    lines = result.split("\n")
    assert lines[0][35:] == "─" * 20  # canvas is the 80×24 default floor


# ── Line arrows (tasks/0051 phase 3) ──────────────────────


def test_arrow_glyph():
    from boxframe.services.renderer import arrow_glyph
    hline = {
        "arrow": ("◀", "▶"),
        "arrow-open": ("◁", "▷"),
        "diamond": ("◆", "◆"),
        "diamond-open": ("◇", "◇"),
        "circle": ("●", "●"),
        "circle-open": ("○", "○"),
    }
    vline = {
        "arrow": ("▲", "▼"),
        "arrow-open": ("△", "▽"),
        "diamond": ("◆", "◆"),
        "diamond-open": ("◇", "◇"),
        "circle": ("●", "●"),
        "circle-open": ("○", "○"),
    }
    for value, (start, end) in hline.items():
        assert arrow_glyph("hline", value, "start") == start
        assert arrow_glyph("hline", value, "end") == end
    for value, (start, end) in vline.items():
        assert arrow_glyph("vline", value, "start") == start
        assert arrow_glyph("vline", value, "end") == end
    # Absent / "none" / invalid → no arrow (the legacy "double" is invalid)
    for value in [None, "none", "", "foo", 5, "double"]:
        assert arrow_glyph("hline", value, "start") == ""
        assert arrow_glyph("vline", value, "end") == ""
    # Not a line type
    assert arrow_glyph("box", "arrow", "start") == ""


def test_hline_arrow_both_ends():
    result = _render([{
        "block_type": "hline",
        "x": 0, "y": 0,
        "width": 8, "height": 1,
        "content": "",
        "border_style": "solid",
        "meta": {"arrow_start": "arrow", "arrow_end": "arrow"},
    }])
    assert result.split("\n")[0][:8] == "◀──────▶"


def test_hline_all_arrow_shapes():
    shapes = {
        "arrow": "◀──────▶",
        "arrow-open": "◁──────▷",
        "diamond": "◆──────◆",
        "diamond-open": "◇──────◇",
        "circle": "●──────●",
        "circle-open": "○──────○",
    }
    for value, expected in shapes.items():
        result = _render([{
            "block_type": "hline",
            "x": 0, "y": 0,
            "width": 8, "height": 1,
            "content": "",
            "border_style": "solid",
            "meta": {"arrow_start": value, "arrow_end": value},
        }])
        assert result.split("\n")[0][:8] == expected, value


def test_hline_arrow_one_end():
    result = _render([{
        "block_type": "hline",
        "x": 0, "y": 0,
        "width": 8, "height": 1,
        "content": "",
        "border_style": "solid",
        "meta": {"arrow_end": "arrow"},
    }])
    assert result.split("\n")[0][:8] == "───────▶"


def test_vline_arrow_both_ends():
    result = _render([{
        "block_type": "vline",
        "x": 0, "y": 0,
        "width": 1, "height": 8,
        "content": "",
        "border_style": "solid",
        "meta": {"arrow_start": "arrow", "arrow_end": "arrow"},
    }])
    lines = result.split("\n")
    assert lines[0][0] == "▲"
    assert lines[7][0] == "▼"
    for i in range(1, 7):
        assert lines[i][0] == "│"


def test_vline_all_arrow_shapes():
    shapes = {
        "arrow": ("▲", "▼"),
        "arrow-open": ("△", "▽"),
        "diamond": ("◆", "◆"),
        "diamond-open": ("◇", "◇"),
        "circle": ("●", "●"),
        "circle-open": ("○", "○"),
    }
    for value, (top, bottom) in shapes.items():
        result = _render([{
            "block_type": "vline",
            "x": 0, "y": 0,
            "width": 1, "height": 8,
            "content": "",
            "border_style": "solid",
            "meta": {"arrow_start": value, "arrow_end": value},
        }])
        lines = result.split("\n")
        assert lines[0][0] == top, value
        assert lines[7][0] == bottom, value


def test_arrow_short_line_ignored():
    """A line shorter than 2 cells has no arrows."""
    result = _render([{
        "block_type": "hline",
        "x": 0, "y": 0,
        "width": 1, "height": 1,
        "content": "",
        "border_style": "solid",
        "meta": {"arrow_start": "arrow", "arrow_end": "arrow"},
    }])
    assert result.split("\n")[0][:1] == "─"


def test_arrow_two_cell_line():
    """A 2-cell line is exactly the two arrow cells."""
    result = _render([{
        "block_type": "hline",
        "x": 0, "y": 0,
        "width": 2, "height": 1,
        "content": "",
        "border_style": "solid",
        "meta": {"arrow_start": "arrow", "arrow_end": "arrow"},
    }])
    assert result.split("\n")[0][:2] == "◀▶"


def test_arrow_all_line_styles():
    chars = {"solid": "─", "dashed": "┄", "dotted": "┈", "double": "═"}
    for style, ch in chars.items():
        result = _render([{
            "block_type": "hline",
            "x": 0, "y": 0,
            "width": 5, "height": 1,
            "content": "",
            "border_style": style,
            "meta": {"arrow_start": "arrow", "arrow_end": "arrow"},
        }])
        assert result.split("\n")[0][:5] == "◀" + ch * 3 + "▶"


def test_arrow_ignored_for_other_types():
    """Arrows apply only to hline/vline: other blocks render identically
    with and without meta.arrow_*."""
    cases = [
        {"block_type": "box", "width": 10, "height": 3, "content": "x"},
        {"block_type": "button", "width": 10, "height": 1, "content": "B"},
        {"block_type": "text", "width": 10, "height": 2, "content": "t",
         "border_style": "none"},
    ]
    meta = {"arrow_start": "arrow", "arrow_end": "diamond"}
    for case in cases:
        base = {"x": 0, "y": 0, "border_style": "solid", "order": 0}
        plain = _render([dict(case, **base)])
        with_arrows = _render([dict(case, **base, meta=meta)])
        assert with_arrows == plain, case["block_type"]


def test_arrow_invalid_values():
    """Invalid meta.arrow_* (not one of the six shapes) → the line is
    unchanged (the legacy "double" is invalid)."""
    plain = _render([{
        "block_type": "hline",
        "x": 0, "y": 0,
        "width": 6, "height": 1,
        "content": "",
        "border_style": "solid",
    }])
    for bad in ["foo", "", 5, None, "ARROW", "double"]:
        assert _render([{
            "block_type": "hline",
            "x": 0, "y": 0,
            "width": 6, "height": 1,
            "content": "",
            "border_style": "solid",
            "meta": {"arrow_start": bad, "arrow_end": bad},
        }]) == plain, bad


# ── Text alignment (tasks/0051 phase 3) ───────────────────


def _align_box(meta: dict | None, content: str = "Hi",
               width: int = 10, height: int = 4) -> list[dict]:
    data = {
        "block_type": "box",
        "x": 0, "y": 0,
        "width": width, "height": height,
        "content": content,
        "border_style": "solid",
    }
    if meta is not None:
        data["meta"] = meta
    return [data]


def test_h_align_offset():
    from boxframe.services.renderer import h_align_offset
    assert h_align_offset(2, 8, "left") == 0
    assert h_align_offset(2, 8, None) == 0
    assert h_align_offset(2, 8, "center") == 3   # gap 6 → 3 left
    assert h_align_offset(1, 8, "center") == 3   # gap 7 → 3 left, 4 right
    assert h_align_offset(2, 8, "right") == 6
    assert h_align_offset(8, 8, "center") == 0   # fills the area
    assert h_align_offset(9, 8, "right") == 0    # overflow — not shifted


def test_v_align_offset():
    from boxframe.services.renderer import v_align_offset
    assert v_align_offset(1, 3, "top") == 0
    assert v_align_offset(1, 3, None) == 0
    assert v_align_offset(1, 3, "middle") == 1   # (3-1)//2
    assert v_align_offset(1, 4, "middle") == 1   # (4-1)//2 = 1
    assert v_align_offset(1, 3, "bottom") == 2
    assert v_align_offset(3, 3, "middle") == 0   # fills the area
    assert v_align_offset(5, 3, "bottom") == 0   # overflow — not shifted


def test_text_align_center():
    """Each wrapped line is centered inside the content area."""
    result = _render(_align_box({"text_align": "center"}))
    lines = result.split("\n")
    # content_w = 8, "Hi" (2) → offset 3
    assert lines[1] == "│   Hi   │"


def test_text_align_right():
    result = _render(_align_box({"text_align": "right"}))
    lines = result.split("\n")
    assert lines[1] == "│      Hi│"


def test_text_align_default_left_unchanged():
    """No meta / left — the current output (regression)."""
    plain = _render(_align_box(None))
    assert plain == _render(_align_box({"text_align": "left"}))
    lines = plain.split("\n")
    assert lines[1] == "│Hi      │"


def test_text_align_wrapped_lines():
    """Every wrapped line is aligned independently."""
    # content_w = 8: "Hello World" wraps to "Hello " (6) + "World" (5)
    result = _render(_align_box({"text_align": "right"}, content="Hello World"))
    lines = result.split("\n")
    assert lines[1] == "│  Hello │"  # "Hello " (6 cells) → offset 2
    assert lines[2] == "│   World│"  # "World" (5) → offset 3


def test_vertical_align_middle():
    result = _render(_align_box({"vertical_align": "middle"}, height=5))
    lines = result.split("\n")
    # content_h = 3, one line → offset 1
    assert lines[1] == "│        │"
    assert lines[2] == "│Hi      │"
    assert lines[3] == "│        │"


def test_vertical_align_bottom():
    result = _render(_align_box({"vertical_align": "bottom"}, height=5))
    lines = result.split("\n")
    # content_h = 3, one line → offset 2
    assert lines[1] == "│        │"
    assert lines[2] == "│        │"
    assert lines[3] == "│Hi      │"


def test_vertical_align_overflow_not_shifted():
    """More lines than content_h: the block is not shifted (top)."""
    # content_h = 2 (height 4), "a\nb\nc" → 3 lines, only 2 fit
    result = _render(_align_box({"vertical_align": "bottom"},
                                content="a\nb\nc", height=4))
    lines = result.split("\n")
    assert lines[1] == "│a       │"
    assert lines[2] == "│b       │"
    assert lines[3] == "└────────┘"


def test_alignment_with_fill():
    """Alignment offsets position the content over the fill; the fill
    stays in the cells the content does not cover."""
    result = _render(_align_box({"text_align": "center", "fill": "░"}))
    lines = result.split("\n")
    # "Hi" at offset 3 over the ░ fill
    assert lines[1] == "│░░░Hi░░░│"


def test_alignment_ignored_for_lines():
    """Alignment applies only to content blocks: lines render identically
    with and without meta.text_align / meta.vertical_align."""
    meta = {"text_align": "center", "vertical_align": "bottom"}
    for block_type, size in [("hline", {"width": 8, "height": 1}),
                             ("vline", {"width": 1, "height": 8})]:
        plain = _render([{"block_type": block_type, "x": 0, "y": 0, **size,
                          "content": "", "border_style": "solid", "order": 0}])
        with_align = _render([{"block_type": block_type, "x": 0, "y": 0, **size,
                               "content": "", "border_style": "solid", "order": 0,
                               "meta": meta}])
        assert with_align == plain, block_type


def test_button_text_align():
    """text_align positions the button label (the label is already
    vertically centered)."""
    for align, expected in [("left", "│Button      │"),
                            ("center", "│   Button   │"),
                            ("right", "│      Button│")]:
        result = _render([{
            "block_type": "button",
            "x": 0, "y": 0,
            "width": 14, "height": 2,
            "content": "Button",
            "border_style": "solid",
            "meta": {"text_align": align},
        }])
        assert result.split("\n")[0] == expected, align


# ── Button tests (tasks/0021-0030/0022-button.md, 0060) ─────


def _button(height: int, width: int = 16, content: str = "Button",
            border_style: str = "solid", meta: dict | None = None) -> list[dict]:
    return [{
        "block_type": "button",
        "x": 0, "y": 0,
        "width": width, "height": height,
        "content": content,
        "border_style": border_style,
        "meta": meta or {},
    }]


def test_button_height_1():
    result = _render(_button(1))
    assert result.split("\n")[0] == "[    Button    ]"


def test_button_height_2():
    result = _render(_button(2))
    lines = result.split("\n")
    assert lines[0] == "│    Button    │"
    assert lines[1] == "└──────────────┘"


def test_button_height_3():
    result = _render(_button(3))
    lines = result.split("\n")
    assert lines[0] == "┌──────────────┐"
    assert lines[1] == "│    Button    │"
    assert lines[2] == "└──────────────┘"


def test_button_height_4_label_upper_middle():
    result = _render(_button(4))
    lines = result.split("\n")
    assert lines[0] == "┌──────────────┐"
    assert lines[1] == "│    Button    │"
    assert lines[2] == "│              │"
    assert lines[3] == "└──────────────┘"


def test_button_height_5_label_centered():
    result = _render(_button(5))
    lines = result.split("\n")
    assert lines[0] == "┌──────────────┐"
    assert lines[1] == "│              │"
    assert lines[2] == "│    Button    │"
    assert lines[3] == "│              │"
    assert lines[4] == "└──────────────┘"


def test_button_border_styles():
    # h=2: side + bottom border use the style characters
    result = _render(_button(2, border_style="dashed"))
    lines = result.split("\n")
    assert lines[0] == "┆    Button    ┆"
    assert lines[1] == "└" + "┄" * 14 + "┘"

    # h=3: full box in the style
    result = _render(_button(3, border_style="double"))
    lines = result.split("\n")
    assert lines[0] == "╔══════════════╗"
    assert lines[1] == "║    Button    ║"
    assert lines[2] == "╚══════════════╝"

    # h=1: [label] for any style
    for style in ["solid", "dashed", "dotted", "double"]:
        result = _render(_button(1, border_style=style))
        assert result.split("\n")[0] == "[    Button    ]", style


def test_button_border_none():
    result = _render(_button(3, border_style="none"))
    lines = result.split("\n")
    assert lines[0] == ""
    assert lines[1] == "     Button"
    assert len(lines) == 2  # trailing empty rows are stripped


def test_button_label_word_wrapped():
    """The label is word-wrapped to the inner width; lines past the
    inner height are not drawn (manual resize smaller than the fit)."""
    result = _render(_button(3, width=10, content="A very long label"))
    lines = result.split("\n")
    # Inner 8×1: "A very " / "long " / "label" → only the first line
    assert lines[0] == "┌" + "─" * 8 + "┐"
    assert lines[1] == "│A very  │"
    assert lines[2] == "└" + "─" * 8 + "┘"


def test_button_multiline():
    """Explicit newlines are kept: each line on its row, centered."""
    result = _render(_button(4, width=7, content="hi\nthere"))
    lines = result.split("\n")
    assert lines[0] == "┌─────┐"
    assert lines[1] == "│ hi  │"
    assert lines[2] == "│there│"
    assert lines[3] == "└─────┘"


def test_button_multiline_h1_clips_to_first_line():
    result = _render(_button(1, width=12, content="a\nb"))
    assert result.split("\n")[0] == "[    a     ]"


def test_button_multiline_h2_manual_form():
    """The manual h=2 form (no top border) keeps one inner row."""
    result = _render(_button(2, content="Line1\nLine2"))
    lines = result.split("\n")
    assert lines[0] == "│    Line1     │"
    assert lines[1] == "└──────────────┘"
    assert "Line2" not in result


def test_button_vertical_align():
    """vertical_align shifts the line block inside the inner height
    (default middle)."""
    for valign, hi_row, there_row in [
        ("top", 1, 2),
        ("middle", 2, 3),
        ("bottom", 3, 4),
    ]:
        result = _render(_button(
            6, width=7, content="hi\nthere",
            meta={"vertical_align": valign},
        ))
        lines = result.split("\n")
        assert lines[hi_row] == "│ hi  │", valign
        assert lines[there_row] == "│there│", valign


def test_button_text_align_multiline():
    """text_align aligns each line (default center)."""
    for align, hi, there in [
        ("left", "│hi   │", "│there│"),
        ("center", "│ hi  │", "│there│"),
        ("right", "│   hi│", "│there│"),
    ]:
        result = _render(_button(
            4, width=7, content="hi\nthere",
            meta={"text_align": align},
        ))
        lines = result.split("\n")
        assert lines[1] == hi, align
        assert lines[2] == there, align


def test_button_border_none_multiline():
    result = _render(_button(2, width=5, content="hi\nthere",
                             border_style="none"))
    lines = result.split("\n")
    assert lines[0] == " hi"  # rstripped
    assert lines[1] == "there"


def test_button_empty_content():
    result = _render(_button(3, content=""))
    lines = result.split("\n")
    assert lines[0] == "┌──────────────┐"
    assert lines[1] == "│              │"
    assert lines[2] == "└──────────────┘"


def test_button_empty_content_h1():
    """An empty framed button keeps the canonical h=1 form."""
    result = _render(_button(1, width=3, content=""))
    assert result.split("\n")[0] == "[ ]"


# ── button_block_size tests (task 0060) ───────────────────


def test_button_block_size_unit():
    """Fit size: 1 line → [label] (h=1), N>=2 lines → full box (h=N+2),
    none → the text's extent."""
    from boxframe.services.renderer import button_block_size

    assert button_block_size("", "solid") == (3, 1)
    assert button_block_size("Button", "solid") == (8, 1)
    assert button_block_size("a", "solid") == (3, 1)
    assert button_block_size("a\nb", "solid") == (3, 4)
    assert button_block_size("hi\nthere", "solid") == (7, 4)
    assert button_block_size("a\n", "solid") == (3, 4)
    assert button_block_size("hi\nthere", "dashed") == (7, 4)
    assert button_block_size("", "none") == (1, 1)
    assert button_block_size("hi", "none") == (2, 1)
    assert button_block_size("a\nbb", "none") == (2, 2)


# ── Word wrap tests ───────────────────────────────────────


def test_wrap_text_unit():
    """_wrap_text wraps by words, preserves newlines, hard-splits long words."""
    r = PseudoGraphicRenderer(10, 5)
    assert r._wrap_text("hello world", 5) == ["hello", "world"]
    assert r._wrap_text("hello", 10) == ["hello"]
    assert r._wrap_text("a b c", 1) == ["a", "b", "c"]
    assert r._wrap_text("ab\ncd", 3) == ["ab", "cd"]
    assert r._wrap_text("abcdefgh", 3) == ["abc", "def", "gh"]
    assert r._wrap_text("", 5) == [""]


def test_wrap_text_preserves_spaces():
    """Runs of spaces are formatting — kept verbatim, dropped only on wrap."""
    r = PseudoGraphicRenderer(10, 5)
    # Spaces kept when the line fits
    assert r._wrap_text("hello    world", 20) == ["hello    world"]
    # Leading spaces kept
    assert r._wrap_text("  hello", 10) == ["  hello"]
    # Space run that doesn't fit is dropped when the word wraps
    assert r._wrap_text("a   b", 2) == ["a", "b"]
    # Explicit newlines still separate lines with their own spacing
    assert r._wrap_text("a  b\nc  d", 10) == ["a  b", "c  d"]


# ── Text autosize tests ───────────────────────────────────


def test_text_block_size_no_border():
    """Without a border the fit size is the content's extent (min 1×1)."""
    from boxframe.services.renderer import text_block_size
    assert text_block_size("", "none") == (1, 1)
    assert text_block_size("hi", "none") == (2, 1)
    assert text_block_size("hello\nworld", "none") == (5, 2)
    # The longest line sets the width, every explicit line sets a row
    assert text_block_size("ab\ncdef", "none") == (4, 2)
    # A trailing newline adds an empty line
    assert text_block_size("a\n", "none") == (1, 2)


def test_text_block_size_with_border():
    """A border (any style except none) adds one cell on each side."""
    from boxframe.services.renderer import text_block_size
    assert text_block_size("", "solid") == (2, 3)
    assert text_block_size("hi", "solid") == (4, 3)
    assert text_block_size("hi", "double") == (4, 3)
    assert text_block_size("hello\nworld", "dashed") == (7, 4)


def test_word_wrap_in_border():
    """Long content wraps by words inside the frame instead of truncating."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 12, "height": 4,
        "content": "Hello world foo",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    # Content width = 10: "Hello" + " world" = 11 > 10 → wrap
    assert "Hello" in lines[1]
    assert "world foo" in lines[2]
    # Border intact on all content rows
    assert lines[1][0] == "│" and lines[1][11] == "│"
    assert lines[2][0] == "│" and lines[2][11] == "│"


def test_word_wrap_hard_split_long_word():
    """Words longer than the content width are split character by character."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 8, "height": 4,
        "content": "abcdefgh",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    # Content width = 6: "abcdef" / "gh"
    assert "abcdef" in lines[1]
    assert "gh" in lines[2]


def test_word_wrap_preserves_explicit_newlines():
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 12, "height": 5,
        "content": "one two\nthree four",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    # Each explicit line fits (7 and 10 ≤ 10) — no extra wrapping
    assert "one two" in lines[1]
    assert "three four" in lines[2]


def test_word_wrap_clipped_by_height():
    """Wrapped lines beyond the content height are not drawn."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 8, "height": 3,
        "content": "aa bb cc dd",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    # Content height = 1: only the first wrapped line fits
    assert "aa bb" in lines[1]
    assert "cc" not in lines[1]
    # Bottom border intact
    assert lines[2][0] == "└" and lines[2][7] == "┘"


def test_word_wrap_no_border():
    """Borderless blocks wrap by their own width."""
    result = _render([{
        "block_type": "text",
        "x": 0, "y": 0,
        "width": 8, "height": 3,
        "content": "hello world",
        "border_style": "none",
    }])
    lines = result.split("\n")
    assert "hello" in lines[0]
    assert "world" in lines[1]


def test_word_wrap_preserves_spaces_in_render():
    """Runs of spaces are formatting — kept verbatim when the line fits."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 20, "height": 3,
        "content": "Name        Price",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    # Content width = 18: "Name        Price" (17) fits on one line
    assert "Name        Price" in lines[1]


def test_word_wrap_drops_gap_on_wrap():
    """A space run that doesn't fit is dropped when the word wraps."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "content": "Name        Price",
        "border_style": "solid",
    }])
    lines = result.split("\n")
    # Content width = 8: "Name" + 8 spaces = 12 > 8 → gap dropped
    assert "Name" in lines[1]
    assert "Price" in lines[2]


# ── Divider tests (variant E, tasks/0003) ─────────────────


def _divider_block(content="", width=20, height=1, meta=None,
                   border_style="solid", x=0, y=0):
    data = {
        "block_type": "divider",
        "x": x, "y": y,
        "width": width, "height": height,
        "content": content,
        "border_style": border_style,
    }
    if meta is not None:
        data["meta"] = meta
    return [data]


def test_divider_fit_size():
    """Grow-only fit: the size grows to fit the content, never shrinks
    (unlike text_block_size, which is an exact fit)."""
    from boxframe.services.renderer import divider_fit_size
    # Empty content — one empty line, the size is kept
    assert divider_fit_size("", 20, 1) == (20, 1)
    # Height grows to the line count
    assert divider_fit_size("a\nbb\nccc", 20, 1) == (20, 3)
    # Width grows to the longest line
    assert divider_fit_size("a\nbb\nccc", 2, 3) == (3, 3)
    # Stored width larger than the longest line — no shrink
    assert divider_fit_size("a\nbb\nccc", 4, 3) == (4, 3)
    # Smaller content (down to empty) — no shrink
    assert divider_fit_size("a", 20, 3) == (20, 3)
    assert divider_fit_size("", 20, 3) == (20, 3)
    # A trailing newline adds an empty line
    assert divider_fit_size("a\n", 20, 1) == (20, 2)


def test_divider_empty_is_lines():
    """Empty content: a line on every row (old 20×3 → 3 parallel lines)."""
    result = _render(_divider_block(width=20, height=3))
    lines = result.split("\n")
    for i in range(3):
        assert lines[i][:20] == "─" * 20


def test_divider_label_centered_by_default():
    """The label is centered by default (meta.text_align absent)."""
    result = _render(_divider_block(content="or"))
    assert result.split("\n")[0][:20] == "─" * 9 + "or" + "─" * 9


def test_divider_multiline_label():
    """Each content line is drawn over its row, as-is (no wrap, no
    collapse), each line aligned independently."""
    result = _render(_divider_block(content="a\nbb\nccc", height=3))
    lines = result.split("\n")
    assert lines[0][:20] == "─" * 9 + "a" + "─" * 10
    assert lines[1][:20] == "─" * 9 + "bb" + "─" * 9
    assert lines[2][:20] == "─" * 8 + "ccc" + "─" * 9


def test_divider_spaces_spread_line():
    """The label's own spaces spread the line (spaces matter in
    pseudo-graphics)."""
    result = _render(_divider_block(content="  a  \n  bb  \n  ccc  ", height=3))
    lines = result.split("\n")
    assert lines[0][:20] == "─" * 7 + "  a  " + "─" * 8
    assert lines[1][:20] == "─" * 7 + "  bb  " + "─" * 7
    assert lines[2][:20] == "─" * 6 + "  ccc  " + "─" * 7


def test_divider_alignment():
    """meta.text_align aligns every line (left/right)."""
    result = _render(_divider_block(
        content="a\nbb\nccc", height=3, meta={"text_align": "left"}))
    lines = result.split("\n")
    assert lines[0][:20] == "a" + "─" * 19
    assert lines[1][:20] == "bb" + "─" * 18
    assert lines[2][:20] == "ccc" + "─" * 17

    result = _render(_divider_block(
        content="a\nbb\nccc", height=3, meta={"text_align": "right"}))
    lines = result.split("\n")
    assert lines[0][:20] == "─" * 19 + "a"
    assert lines[1][:20] == "─" * 18 + "bb"
    assert lines[2][:20] == "─" * 17 + "ccc"


def test_divider_vertical_align_default_middle():
    """The label block is vertically centered by default
    (meta.vertical_align absent — unlike box, whose default is top)."""
    result = _render(_divider_block(content="or", height=3))
    lines = result.split("\n")
    assert lines[0][:20] == "─" * 20
    assert lines[1][:20] == "─" * 9 + "or" + "─" * 9
    assert lines[2][:20] == "─" * 20


def test_divider_vertical_align_top():
    result = _render(_divider_block(
        content="or", height=3, meta={"vertical_align": "top"}))
    lines = result.split("\n")
    assert lines[0][:20] == "─" * 9 + "or" + "─" * 9
    assert lines[1][:20] == "─" * 20
    assert lines[2][:20] == "─" * 20


def test_divider_vertical_align_bottom():
    result = _render(_divider_block(
        content="or", height=3, meta={"vertical_align": "bottom"}))
    lines = result.split("\n")
    assert lines[0][:20] == "─" * 20
    assert lines[1][:20] == "─" * 20
    assert lines[2][:20] == "─" * 9 + "or" + "─" * 9


def test_divider_vertical_align_multiline():
    """A multiline label: the whole line block is shifted (middle — the
    extra row goes to the bottom)."""
    result = _render(_divider_block(
        content="a\nbb", height=5, meta={"vertical_align": "middle"}))
    lines = result.split("\n")
    # v_off = (5-2)//2 = 1
    assert lines[0][:20] == "─" * 20
    assert lines[1][:20] == "─" * 9 + "a" + "─" * 10
    assert lines[2][:20] == "─" * 9 + "bb" + "─" * 9
    assert lines[3][:20] == "─" * 20
    assert lines[4][:20] == "─" * 20


def test_divider_vertical_align_overflow_not_shifted():
    """Content taller than the block: no shift, the tail is clipped
    (same rule as box)."""
    result = _render(_divider_block(
        content="a\nbb\nccc\ndddd", height=2, meta={"vertical_align": "bottom"}))
    lines = result.split("\n")
    assert lines[0][:20] == "─" * 9 + "a" + "─" * 10
    assert lines[1][:20] == "─" * 9 + "bb" + "─" * 9
    assert "ccc" not in result
    assert "dddd" not in result


def test_divider_truncates_to_width():
    """A line longer than the stored width is truncated (no word wrap)."""
    result = _render(_divider_block(content="abcdefghij", width=8))
    assert result.split("\n")[0][:8] == "abcdefgh"


def test_divider_more_lines_than_height():
    """Content lines beyond the stored height are not drawn."""
    result = _render(_divider_block(content="a\nbb\nccc\ndddd", height=2))
    lines = result.split("\n")
    assert lines[0][:20] == "─" * 9 + "a" + "─" * 10
    assert lines[1][:20] == "─" * 9 + "bb" + "─" * 9
    assert "ccc" not in result
    assert "dddd" not in result


def test_divider_all_styles():
    chars = {"solid": "─", "dashed": "┄", "dotted": "┈", "double": "═"}
    for style, ch in chars.items():
        result = _render(_divider_block(
            content="x", height=2, border_style=style))
        lines = result.split("\n")
        assert lines[0][:20] == ch * 9 + "x" + ch * 10
        assert lines[1][:20] == ch * 20


def test_divider_none_line_invisible():
    """border_style none: the line is invisible, the label is drawn."""
    result = _render(_divider_block(content="or", border_style="none"))
    assert result.split("\n")[0] == "         or"


def test_divider_ignores_children():
    """Children are not drawn (a line is an atomic element)."""
    blocks = [{
        "block_type": "divider",
        "x": 0, "y": 0,
        "width": 20, "height": 3,
        "content": "",
        "border_style": "solid",
        "children": [{
            "block_type": "text", "x": 1, "y": 1, "width": 8, "height": 1,
            "content": "child", "border_style": "none", "order": 0,
        }],
    }]
    result = _render(blocks)
    assert "child" not in result
    lines = result.split("\n")
    assert len(lines) == 3
    for i in range(3):
        assert lines[i][:20] == "─" * 20


def test_divider_ignores_arrows_and_fill():
    """Arrows and fill do not apply to dividers."""
    base = _divider_block(content="or")[0]
    plain = _render([base])
    with_meta = _render([{
        **base,
        "meta": {"arrow_start": "arrow", "arrow_end": "diamond",
                 "fill": "░"},
    }])
    assert with_meta == plain


def test_divider_in_container():
    """A divider as a child is clipped to the container's inner area."""
    blocks = [{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 12, "height": 6,
        "content": "",
        "border_style": "solid",
        "children": [{
            "block_type": "divider", "x": 0, "y": 1, "width": 10, "height": 2,
            "content": "wide", "border_style": "solid", "order": 0,
        }],
    }]
    result = _render(blocks)
    lines = result.split("\n")
    assert lines[2] == "│───wide───│"
    assert lines[3] == "│──────────│"


# ── HTML preview tests ────────────────────────────────────


def test_render_block_to_html_preview():
    rb = RenderBlock(
        x=2, y=1, width=10, height=3,
        block_type="box", content="", border_style="solid",
    )
    html = rb.to_html_preview("block-123")
    assert 'data-block-id="block-123"' in html
    assert 'class="block-preview"' in html
    assert 'class="resize-handle"' in html
    # Default char_width_px=12, char_height_px=14.4, padding_offset=16
    assert "left:40px" in html  # 16 + 2*12
    assert "top:30.4px" in html  # 16 + 1*14.4
    assert "width:120px" in html
    assert "height:43.2px" in html


def test_render_block_to_html_preview_no_border():
    rb = RenderBlock(
        x=0, y=0, width=5, height=2,
        block_type="text", content="hello", border_style="none",
    )
    html = rb.to_html_preview("block-456")
    assert 'data-block-id="block-456"' in html
    assert 'class="resize-handle"' in html


def test_render_html_preview_single_block():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "b1",
        "x": 0, "y": 0,
        "width": 20, "height": 3,
        "block_type": "box",
        "content": "Header",
        "border_style": "solid",
    }])
    assert 'data-block-id="b1"' in html
    assert 'class="block-preview"' in html
    assert 'class="resize-handle"' in html
    # Default char_width_px=12, padding_offset=16 → left:16px, width:240px
    assert "left:16px" in html
    assert "width:240px" in html


def test_render_html_preview_with_children():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "parent",
        "x": 0, "y": 0,
        "width": 30, "height": 10,
        "block_type": "box",
        "content": "",
        "border_style": "solid",
        "children": [{
            "id": "child-1",
            "x": 1, "y": 1,
            "width": 10, "height": 2,
            "block_type": "button",
            "content": "Click",
            "border_style": "dashed",
        }],
    }])
    # Both parent and child should have resize handles
    assert 'data-block-id="parent"' in html
    assert 'data-block-id="child-1"' in html
    # Count resize handles — should be 2
    assert html.count('class="resize-handle"') == 2


def _opening_tag(html: str, block_id: str) -> str:
    """Return the opening ``<div ...>`` tag for the block with the given id."""
    idx = html.index(f'data-block-id="{block_id}"')
    start = html.rindex("<div", 0, idx)
    end = html.index(">", idx) + 1
    return html[start:end]


def test_render_html_preview_child_nested_in_parent():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "parent", "x": 0, "y": 0, "width": 30, "height": 10,
        "block_type": "box", "content": "", "border_style": "solid",
        "children": [{
            "id": "child-1", "x": 1, "y": 1, "width": 10, "height": 2,
            "block_type": "button", "content": "Click", "border_style": "dashed",
        }],
    }])
    parent_tag = _opening_tag(html, "parent")
    child_tag = _opening_tag(html, "child-1")
    # The parent has overflow:hidden (it contains children); the child does not
    assert "overflow:hidden" in parent_tag
    assert "overflow:hidden" not in child_tag
    # The child is nested inside the parent: the parent's tag opens first
    assert html.index('data-block-id="parent"') < html.index('data-block-id="child-1"')


def test_render_html_preview_child_positioned_relative_to_parent():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "parent", "x": 0, "y": 0, "width": 30, "height": 10,
        "block_type": "box", "content": "", "border_style": "solid",
        "children": [{
            "id": "child-1", "x": 1, "y": 1, "width": 10, "height": 2,
            "block_type": "button", "content": "Click", "border_style": "dashed",
        }],
    }])
    child_tag = _opening_tag(html, "child-1")
    # Child positioned relative to the parent: 1-cell padding + relative grid
    # (1+1)*12 = 24px, (1+1)*14.4 = 28.8px — NOT 16 + 1*12 = 28px (flattened)
    assert "left:24px" in child_tag
    assert "top:28.8px" in child_tag


def test_render_html_preview_box_in_box():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "outer", "x": 0, "y": 0, "width": 40, "height": 12,
        "block_type": "box", "content": "", "border_style": "solid",
        "children": [{
            "id": "inner", "x": 2, "y": 2, "width": 20, "height": 6,
            "block_type": "box", "content": "", "border_style": "dashed",
            "children": [{
                "id": "leaf", "x": 1, "y": 1, "width": 8, "height": 2,
                "block_type": "text", "content": "hi", "border_style": "none",
            }],
        }],
    }])
    outer_tag = _opening_tag(html, "outer")
    inner_tag = _opening_tag(html, "inner")
    leaf_tag = _opening_tag(html, "leaf")
    # Both containers have overflow:hidden; the leaf does not
    assert "overflow:hidden" in outer_tag
    assert "overflow:hidden" in inner_tag
    assert "overflow:hidden" not in leaf_tag
    # Nesting order: outer < inner < leaf
    assert html.index('data-block-id="outer"') < html.index('data-block-id="inner"')
    assert html.index('data-block-id="inner"') < html.index('data-block-id="leaf"')
    # inner positioned relative to outer: (1+2)*12=36px, (1+2)*14.4=43.2px
    assert "left:36px" in inner_tag
    assert "top:43.2px" in inner_tag
    # leaf positioned relative to inner: (1+1)*12=24px, (1+1)*14.4=28.8px
    assert "left:24px" in leaf_tag
    assert "top:28.8px" in leaf_tag


def test_render_html_preview_child_bigger_than_parent():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "parent", "x": 0, "y": 0, "width": 10, "height": 4,
        "block_type": "box", "content": "", "border_style": "solid",
        "children": [{
            "id": "big", "x": 2, "y": 1, "width": 30, "height": 10,
            "block_type": "box", "content": "", "border_style": "dashed",
        }],
    }])
    parent_tag = _opening_tag(html, "parent")
    big_tag = _opening_tag(html, "big")
    # The oversized child is still nested and clipped by the parent
    assert "overflow:hidden" in parent_tag
    assert html.index('data-block-id="parent"') < html.index('data-block-id="big"')
    # The child keeps its full size — clipping is visual (overflow:hidden)
    assert "width:360px" in big_tag   # 30*12
    assert "height:144px" in big_tag  # 10*14.4


def test_render_html_preview_dashed_border():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "b1",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "block_type": "box",
        "content": "",
        "border_style": "dashed",
    }])
    assert 'class="block-border block-border--dashed"' in html


def test_render_html_preview_double_border():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "b1",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "block_type": "box",
        "content": "",
        "border_style": "double",
    }])
    assert 'class="block-border block-border--double"' in html


def test_render_html_preview_hline():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "l1",
        "x": 0, "y": 0,
        "width": 10, "height": 1,
        "block_type": "hline",
        "content": "",
        "border_style": "dashed",
    }])
    assert 'data-block-id="l1"' in html
    assert 'class="block-line block-line--h block-line--dashed"' in html


def test_render_html_preview_vline():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "l2",
        "x": 0, "y": 0,
        "width": 1, "height": 4,
        "block_type": "vline",
        "content": "",
        "border_style": "double",
    }])
    assert 'class="block-line block-line--v block-line--double"' in html


def test_render_html_preview_line_none():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "l3",
        "x": 0, "y": 0,
        "width": 10, "height": 1,
        "block_type": "hline",
        "content": "",
        "border_style": "none",
    }])
    assert 'class="block-line block-line--h block-line--none"' in html


def test_render_html_preview_divider_empty():
    """Empty content: one full-width segment per row."""
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "d1",
        "x": 0, "y": 0,
        "width": 10, "height": 3,
        "block_type": "divider",
        "content": "",
        "border_style": "solid",
    }])
    assert html.count('class="block-line block-line--h block-line--seg') == 3
    # Row centers: 7.2 / 21.6 / 36 px (char_height_px=14.4)
    assert 'style="top:7.2px;left:0px;width:120px;"' in html
    assert 'style="top:21.6px;left:0px;width:120px;"' in html
    assert 'style="top:36px;left:0px;width:120px;"' in html


def test_render_html_preview_divider_segments():
    """A labeled row: up to two segments around the label (the overlay
    sits above the ASCII layer and must not cross the text)."""
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "d2",
        "x": 0, "y": 0,
        "width": 20, "height": 2,
        "block_type": "divider",
        "content": "or\n",
        "border_style": "dashed",
    }])
    assert 'block-line--seg block-line--dashed' in html
    # "or" centered in 20: offset 9 → left segment 9 cells (108px),
    # right segment 9 cells (108px) at left 11*12=132px
    assert 'style="top:7.2px;left:0px;width:108px;"' in html
    assert 'style="top:7.2px;left:132px;width:108px;"' in html
    # The empty second line — one full-width segment
    assert 'style="top:21.6px;left:0px;width:240px;"' in html
    assert html.count('block-line--seg') == 3


def test_render_html_preview_divider_label_fills_row():
    """A label that fills the row: no segments (the text covers it)."""
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "d3",
        "x": 0, "y": 0,
        "width": 4, "height": 1,
        "block_type": "divider",
        "content": "abcd",
        "border_style": "solid",
    }])
    assert "block-line--seg" not in html


def test_render_html_preview_divider_vertical_align():
    """The segments follow the vertical shift of the label block
    (default middle — the label sits on the middle row)."""
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "d4",
        "x": 0, "y": 0,
        "width": 20, "height": 3,
        "block_type": "divider",
        "content": "or",
        "border_style": "solid",
    }])
    # "or" centered in 20: offset 9 → 9-cell segments (108px) at 0 and
    # 132px on the middle row (center 21.6px); rows 0 and 2 are full-width
    assert 'style="top:7.2px;left:0px;width:240px;"' in html
    assert 'style="top:21.6px;left:0px;width:108px;"' in html
    assert 'style="top:21.6px;left:132px;width:108px;"' in html
    assert 'style="top:36px;left:0px;width:240px;"' in html
    assert html.count('block-line--seg') == 4

    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "d5",
        "x": 0, "y": 0,
        "width": 20, "height": 3,
        "block_type": "divider",
        "content": "or",
        "border_style": "solid",
        "meta": {"vertical_align": "top"},
    }])
    # top: the label sits on row 0 (center 7.2px)
    assert 'style="top:7.2px;left:0px;width:108px;"' in html
    assert 'style="top:7.2px;left:132px;width:108px;"' in html
    assert 'style="top:21.6px;left:0px;width:240px;"' in html
    assert 'style="top:36px;left:0px;width:240px;"' in html


def test_render_html_preview_border_none():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "b1",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "block_type": "box",
        "content": "",
        "border_style": "none",
    }])
    assert 'class="block-border block-border--none"' in html


# ── Order / z-index tests ──────────────────────────────────


def test_render_sorts_by_order():
    """Blocks with higher order render on top."""
    result = _render([
        {
            "block_type": "box",
            "x": 0, "y": 0,
            "width": 10, "height": 5,
            "content": "LOW",
            "border_style": "solid",
            "order": 0,
        },
        {
            "block_type": "box",
            "x": 2, "y": 1,
            "width": 10, "height": 5,
            "content": "HIGH",
            "border_style": "solid",
            "order": 10,
        },
    ])
    lines = result.split("\n")
    # HIGH (order=10) should overwrite LOW at overlapping positions
    assert "HIGH" in lines[2]
    assert "LOW" not in lines[2]


def test_render_default_order_zero():
    """Blocks without explicit order default to 0."""
    result = _render([
        {
            "block_type": "box",
            "x": 0, "y": 0,
            "width": 10, "height": 5,
            "content": "A",
            "border_style": "solid",
        },
        {
            "block_type": "box",
            "x": 2, "y": 1,
            "width": 10, "height": 5,
            "content": "B",
            "border_style": "solid",
        },
    ])
    lines = result.split("\n")
    # Both have order=0, so insertion order decides (B is second → on top)
    assert "B" in lines[2]


def test_render_children_sorted_by_order():
    """Children inside a container render by order, not insertion order."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 20, "height": 6,
        "content": "",
        "border_style": "solid",
        "order": 0,
        "children": [
            # Inserted first but higher order — must render on top
            {"block_type": "text", "x": 2, "y": 1, "width": 8, "height": 2,
             "content": "HIGH", "border_style": "none", "order": 10},
            {"block_type": "text", "x": 2, "y": 1, "width": 8, "height": 2,
             "content": "LOW", "border_style": "none", "order": 0},
        ],
    }])
    lines = result.split("\n")
    # Both children at the same position: HIGH (order=10) overwrites LOW
    assert "HIGH" in lines[2]
    assert "LOW" not in lines[2]


def test_render_children_order_beats_position():
    """A higher-order child renders on top even when positioned above
    (smaller y) a lower-order sibling — z-index, not position, decides."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 20, "height": 8,
        "content": "",
        "border_style": "solid",
        "order": 0,
        "children": [
            # Higher order, positioned higher (smaller y)
            {"block_type": "box", "x": 2, "y": 1, "width": 10, "height": 3,
             "content": "HIGH", "border_style": "solid", "order": 10},
            # Lower order, positioned lower (larger y), overlaps HIGH
            {"block_type": "box", "x": 2, "y": 2, "width": 10, "height": 3,
             "content": "LOW", "border_style": "solid", "order": 0},
        ],
    }])
    lines = result.split("\n")
    # Overlap cell (3,3): HIGH's left border wins over LOW's top-left
    # corner — if position decided, LOW (drawn last) would leave "┌" here.
    assert lines[3][3] == "│"
    # HIGH's content survives the overlap (drawn on top of LOW's border)
    assert "HIGH" in lines[3]


def test_render_block_html_preview_z_index():
    """to_html_preview emits z-index based on order."""
    rb = RenderBlock(
        x=0, y=0, width=10, height=3,
        block_type="box", content="", border_style="solid",
        order=5,
    )
    html = rb.to_html_preview("block-xyz")
    assert "z-index:15" in html  # 10 + 5
    assert 'data-order="5"' in html


def test_render_block_html_preview_default_z_index():
    """Default order=0 → z-index:10."""
    rb = RenderBlock(
        x=0, y=0, width=10, height=3,
        block_type="box", content="", border_style="solid",
    )
    html = rb.to_html_preview("block-abc")
    assert "z-index:10" in html
    assert 'data-order="0"' in html


def test_render_html_preview_with_order():
    """render_html_preview passes order from data dicts."""
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "b1",
        "x": 0, "y": 0,
        "width": 10, "height": 3,
        "block_type": "box",
        "content": "Low",
        "border_style": "solid",
        "order": 0,
    }, {
        "id": "b2",
        "x": 3, "y": 0,
        "width": 10, "height": 3,
        "block_type": "box",
        "content": "High",
        "border_style": "solid",
        "order": 5,
    }])
    assert "z-index:10" in html
    assert "z-index:15" in html
    assert 'data-order="0"' in html
    assert 'data-order="5"' in html


# ── Content placeholder (todo-0004) ──────────────────────────────


def test_content_placeholder_default_size():
    """Empty content block 40×10 → lorem placeholder, 8 lines, last shorter."""
    result = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 40, "height": 10,
        "content": "",
        "border_style": "solid",
    }], width=40, height=10)
    lines = result.split("\n")
    assert len(lines) == 10
    # Border rows
    assert lines[0][0] == "┌"
    assert lines[0][39] == "┐"
    assert lines[9][0] == "└"
    assert lines[9][39] == "┘"
    # Content rows: 8 lines (rows 1–8)
    content_lines = []
    for i in range(1, 9):
        row = lines[i]
        assert row[0] == "│"
        assert row[39] == "│"
        content_lines.append(row[1:39])
    # First line starts with "lorem"
    assert content_lines[0].startswith("lorem")
    # Last line is shorter than the others (~70% of 38 = 26)
    assert len(content_lines[-1].rstrip()) < len(content_lines[0].rstrip())
    # All lines are non-empty
    for cl in content_lines:
        assert cl.strip()


def test_content_placeholder_deterministic():
    """Same size → same placeholder (deterministic)."""
    block = {
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 30, "height": 6,
        "content": "",
        "border_style": "solid",
    }
    r1 = _render([block], width=30, height=6)
    r2 = _render([block], width=30, height=6)
    assert r1 == r2


def test_content_placeholder_resize_rewraps():
    """Different sizes → different placeholder lines (live re-layout)."""
    small = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 20, "height": 4,
        "content": "",
        "border_style": "solid",
    }], width=20, height=4)
    large = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 40, "height": 10,
        "content": "",
        "border_style": "solid",
    }], width=40, height=10)
    # Different sizes produce different content
    small_content = "\n".join(l[1:19] for l in small.split("\n")[1:3])
    large_content = "\n".join(l[1:39] for l in large.split("\n")[1:9])
    assert small_content != large_content
    # Both start with "lorem"
    assert small_content.startswith("lorem")
    assert large_content.startswith("lorem")


def test_content_placeholder_last_line_shorter():
    """Last line is ~70% of content width (only when h>=2 and w>=4)."""
    result = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 40, "height": 10,
        "content": "",
        "border_style": "solid",
    }], width=40, height=10)
    lines = result.split("\n")
    content_lines = [l[1:39] for l in lines[1:9]]
    # Content width is 38; last line should be <= 26 chars (38*7//10=26)
    last_len = len(content_lines[-1].rstrip())
    assert last_len <= 26
    assert last_len >= 3
    # Last line is shorter than the longest content line
    max_len = max(len(cl.rstrip()) for cl in content_lines[:-1])
    assert last_len < max_len


def test_content_nonempty_content_no_placeholder():
    """Non-empty content → word-wrap as before, no lorem placeholder."""
    result = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 20, "height": 5,
        "content": "Hello World",
        "border_style": "solid",
    }], width=20, height=5)
    lines = result.split("\n")
    # Content should show "Hello World", not lorem
    content_text = "\n".join(l[1:19] for l in lines[1:4])
    assert "Hello" in content_text
    assert "lorem" not in content_text


def test_content_fill_suppresses_placeholder():
    """Fill suppresses the lorem placeholder."""
    result = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 20, "height": 5,
        "content": "",
        "border_style": "solid",
        "meta": {"fill": "░"},
    }], width=20, height=5)
    lines = result.split("\n")
    # Content area should be filled with ░, no lorem
    for i in range(1, 4):
        row = lines[i][1:19]
        assert "lorem" not in row
        assert all(c == "░" for c in row)


def test_content_placeholder_text_align():
    """Placeholder follows meta.text_align."""
    # Left-aligned (default)
    left = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 30, "height": 4,
        "content": "",
        "border_style": "solid",
        "meta": {"text_align": "left"},
    }], width=30, height=4)
    # Center-aligned
    center = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 30, "height": 4,
        "content": "",
        "border_style": "solid",
        "meta": {"text_align": "center"},
    }], width=30, height=4)
    # Last content line (row 2, shorter) should be positioned differently
    left_last = left.split("\n")[2][1:29]
    center_last = center.split("\n")[2][1:29]
    assert left_last != center_last
    # Left-aligned: starts at position 0 (no leading spaces)
    assert left_last[0] != " "
    # Center-aligned: has leading spaces (shorter line centered)
    assert center_last[0] == " "


def test_content_placeholder_no_border():
    """Content block without border → placeholder in full area."""
    result = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 20, "height": 4,
        "content": "",
        "border_style": "none",
    }], width=20, height=4)
    lines = result.split("\n")
    assert len(lines) == 4
    # No border characters, content starts at column 0
    assert lines[0].startswith("lorem")


def test_content_placeholder_small_block():
    """Very small content block (2×2) → no placeholder (no content area)."""
    result = _render([{
        "block_type": "content",
        "x": 0, "y": 0,
        "width": 2, "height": 2,
        "content": "",
        "border_style": "solid",
    }], width=20, height=10)
    lines = result.split("\n")
    # 2×2 block: just border, no content area
    assert lines[0] == "┌┐"
    assert lines[1] == "└┘"
    assert "lorem" not in result


# ── Grid tests (variant 1 — partitions, todo-0005) ─────────────────

def _grid_block(width=24, height=8, meta=None, border_style="solid",
                x=0, y=0, content="", children=None):
    data = {
        "block_type": "grid",
        "x": x, "y": y,
        "width": width, "height": height,
        "content": content,
        "border_style": border_style,
    }
    if meta is not None:
        data["meta"] = meta
    if children is not None:
        data["children"] = children
    return [data]


def test_grid_meta_int():
    """cols/rows from meta: a positive int, otherwise the default
    (absent, < 1, non-int, bool, float all fall back)."""
    from boxframe.services.renderer import grid_meta_int
    assert grid_meta_int(None, "cols", 3) == 3
    assert grid_meta_int({}, "cols", 3) == 3
    assert grid_meta_int({"cols": 5}, "cols", 3) == 5
    assert grid_meta_int({"cols": 1}, "cols", 3) == 1
    assert grid_meta_int({"cols": 0}, "cols", 3) == 3
    assert grid_meta_int({"cols": -1}, "cols", 3) == 3
    assert grid_meta_int({"cols": "5"}, "cols", 3) == 3
    assert grid_meta_int({"cols": True}, "cols", 3) == 3
    assert grid_meta_int({"cols": 2.5}, "cols", 3) == 3
    assert grid_meta_int({"rows": 4}, "rows", 2) == 4


def test_grid_default_3x2():
    """Default grid (no meta → 3 cols × 2 rows), solid border: the outer
    frame plus inner partitions with junction nodes; the content area is
    empty (no hint, no content)."""
    result = _render(_grid_block())
    expected = "\n".join([
        "┌───────┬──────┬───────┐",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ])
    assert result == expected


def test_grid_split_with_remainder():
    """Uneven inner width: integer division, the remainder goes to the
    last column (partitions at the requested column starts)."""
    # 21×7 → inner 19×5, cols=4 → partitions at inner 4, 9, 14
    result = _render(_grid_block(width=21, height=7, meta={"cols": 4, "rows": 2}))
    lines = result.split("\n")
    # inner_x = 1, so partitions at absolute cols 5, 10, 15
    assert lines[0][5] == "┬"
    assert lines[0][10] == "┬"
    assert lines[0][15] == "┬"
    assert lines[6][5] == "┴"
    assert lines[6][10] == "┴"
    assert lines[6][15] == "┴"
    # rows=2 → the single horizontal partition at inner 2 → absolute row 3
    assert lines[3][0] == "├"
    assert lines[3][20] == "┤"
    assert lines[3][5] == "┼"
    assert lines[3][10] == "┼"
    assert lines[3][15] == "┼"


def test_grid_clamps_cols_to_inner_width():
    """meta.cols larger than the inner width is clamped (every column is
    at least 1 cell): a 10×10 grid (inner 8) with cols=20 → 8 columns."""
    result = _render(_grid_block(width=10, height=10, meta={"cols": 20, "rows": 2}))
    lines = result.split("\n")
    # inner_x=1, inner_w=8 → partitions at every inner col 1..7 → abs 2..8
    for col in range(2, 9):
        assert lines[0][col] == "┬"
        assert lines[1][col] == "│"


def test_grid_clamps_rows_to_inner_height():
    """meta.rows larger than the inner height is clamped: a 10×10 grid
    (inner 8) with rows=20 → 8 rows."""
    result = _render(_grid_block(width=10, height=10, meta={"cols": 2, "rows": 20}))
    lines = result.split("\n")
    # inner_y=1, inner_h=8 → partitions at every inner row 1..7 → abs 2..8
    for row in range(2, 9):
        assert lines[row][1] == "─"
        assert lines[row][8] == "─"


def test_grid_none_border():
    """border_style none — no outer border, solid partitions over the
    whole block area."""
    result = _render(_grid_block(border_style="none"))
    lines = result.split("\n")
    # 24×8, inner = whole block, cols=3 → partitions at inner 8, 16;
    # rows=2 → the horizontal partition at inner 4
    assert lines[0][8] == "│"
    assert lines[0][16] == "│"
    assert lines[4][0] == "─"
    assert lines[4][8] == "┼"
    assert lines[4][16] == "┼"
    assert lines[7][8] == "│"
    # no outer border characters
    assert "┌" not in result and "┐" not in result
    assert "└" not in result and "┘" not in result


def test_grid_fill_under_partitions():
    """meta.fill paints the inner area under the partitions."""
    result = _render(_grid_block(
        width=12, height=6, meta={"cols": 2, "rows": 2, "fill": "░"}))
    lines = result.split("\n")
    # inner 10×4, partition at inner 5 → abs col 6 (the partition takes a
    # cell, so the columns are 5 and 4 wide); row partition at abs 3
    assert lines[1] == "│░░░░░│░░░░│"
    assert lines[2] == "│░░░░░│░░░░│"
    # the partition row: fill except the junction
    assert lines[3] == "├─────┼────┤"
    assert lines[4] == "│░░░░░│░░░░│"


def test_grid_children_render_over_partitions():
    """Children are drawn after the partitions: the child's border and
    content overwrite the partition where they coincide (the child
    interior is transparent, like any block); the partition stays
    visible outside the child."""
    result = _render(_grid_block(children=[{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 10, "height": 3,
        "content": "0123456789",
        "border_style": "solid",
    }]))
    lines = result.split("\n")
    # child box at abs (1,1) 10×3 covers the partition at abs col 8, rows 1..3
    assert lines[1][8] == "─"  # child top border overwrote the partition
    assert lines[2][8] == "6"  # child content overwrote the partition
    assert lines[3][8] == "─"  # child bottom border overwrote the partition
    assert lines[5][8] == "│"  # partition still visible below the child


def test_grid_degenerate_2x2_is_plain_border():
    """A 2×2 grid has no inner area → just the border, no partitions."""
    result = _render(_grid_block(width=2, height=2))
    lines = result.split("\n")
    assert lines[0] == "┌┐"
    assert lines[1] == "└┘"


def test_grid_hint_suppressed():
    """A grid is a structural element: no [grid] hint is drawn."""
    result = _render(_grid_block())
    assert "[grid]" not in result


def test_grid_content_not_rendered():
    """The grid's content is not rendered (like a line)."""
    result = _render(_grid_block(content="hello"))
    assert "hello" not in result


def test_grid_single_col_single_row():
    """cols=1, rows=1 → no partitions, just the outer border."""
    result = _render(_grid_block(meta={"cols": 1, "rows": 1}))
    lines = result.split("\n")
    assert lines[0] == "┌" + "─" * 22 + "┐"
    assert lines[3] == "│" + " " * 22 + "│"
    assert lines[7] == "└" + "─" * 22 + "┘"
    # no interior partition nodes
    assert "┬" not in result and "┼" not in result and "┴" not in result


def test_grid_double_border():
    """border_style double — the frame and the partitions use the double
    style map."""
    result = _render(_grid_block(border_style="double"))
    lines = result.split("\n")
    assert lines[0][0] == "╔"
    assert lines[0][8] == "╦"
    assert lines[0][15] == "╦"
    assert lines[0][23] == "╗"
    assert lines[1][0] == "║"
    assert lines[1][8] == "║"
    assert lines[4][0] == "╠"
    assert lines[4][8] == "╬"
    assert lines[4][23] == "╣"
    assert lines[7][0] == "╚"
    assert lines[7][8] == "╩"
    assert lines[7][23] == "╝"
