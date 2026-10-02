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


# ── Per-side border tests (tasks/0051, phase 1) ───────────


def _ps_box(meta=None, border_style="solid", width=8, height=4, content=""):
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


def test_effective_border_styles():
    from boxframe.services.renderer import effective_border_styles
    assert effective_border_styles("solid", None) == ("solid", "solid")
    assert effective_border_styles("solid", {}) == ("solid", "solid")
    assert effective_border_styles("solid", {"border_h": "dashed"}) == ("dashed", "solid")
    assert effective_border_styles("solid", {"border_v": "none"}) == ("solid", "none")
    assert effective_border_styles("none", {"border_v": "double"}) == ("none", "double")
    # An empty string inherits the base style
    assert effective_border_styles("dotted", {"border_h": ""}) == ("dotted", "dotted")


def test_per_side_solid_dashed():
    """H=solid, V=dashed: solid horizontals, dashed verticals, solid corners.
    The empty box shows the [box] type hint on the first content row."""
    result = _render(_ps_box({"border_h": "solid", "border_v": "dashed"}))
    lines = result.split("\n")
    assert lines[0] == "┌──────┐"
    assert lines[1] == "┆[box] ┆"
    assert lines[2] == "┆      ┆"
    assert lines[3] == "└──────┘"


def test_per_side_solid_double():
    """H=solid, V=double (spec example): double corners (double wins)."""
    result = _render(_ps_box({"border_h": "solid", "border_v": "double"}))
    lines = result.split("\n")
    assert lines[0] == "╔──────╗"
    assert lines[1] == "║[box] ║"
    assert lines[2] == "║      ║"
    assert lines[3] == "╚──────╝"


def test_per_side_dashed_double_corners():
    """H=dashed, V=double: corners are double, edges keep their styles."""
    result = _render(_ps_box({"border_h": "dashed", "border_v": "double"}))
    lines = result.split("\n")
    assert lines[0] == "╔┄┄┄┄┄┄╗"
    assert lines[1] == "║[box] ║"
    assert lines[3] == "╚┄┄┄┄┄┄╝"


def test_per_side_h_none():
    """H=none: no top/bottom edges and no corners, verticals run end to end.
    The hint sits at the content origin (no top inset)."""
    result = _render(_ps_box({"border_h": "none"}))
    lines = result.split("\n")
    assert lines[0] == "│[box] │"  # no top edge, hint on the first row
    assert lines[1] == "│      │"
    assert lines[2] == "│      │"
    assert lines[3] == "│      │"  # no bottom edge, verticals span full height


def test_per_side_v_none():
    """V=none: no left/right edges and no corners, horizontals intact.
    The hint sits at the content origin (no left inset)."""
    result = _render(_ps_box({"border_v": "none"}))
    lines = result.split("\n")
    assert lines[0] == "─" * 8
    assert lines[1] == "[box]"
    assert lines[2] == ""
    assert lines[3] == "─" * 8


def test_per_side_double_h_only():
    """H=double, V=none: double horizontals, no corners or verticals."""
    result = _render(_ps_box({"border_h": "double", "border_v": "none"}))
    lines = result.split("\n")
    assert lines[0] == "═" * 8
    assert lines[1] == "[box]"
    assert lines[3] == "═" * 8


def test_per_side_both_none():
    """Both axes none (base solid): no border, no type hint."""
    result = _render(_ps_box({"border_h": "none", "border_v": "none"}))
    assert result.strip() == ""


def test_per_side_base_none_v_override():
    """border_style=none + meta.border_v=solid: verticals only, the type
    hint sits at the content origin (no top inset)."""
    result = _render(_ps_box({"border_v": "solid"}, border_style="none"))
    lines = result.split("\n")
    assert lines[0] == "│[box] │"  # hint at the content origin
    assert lines[1] == "│      │"
    assert lines[2] == "│      │"
    assert lines[3] == "│      │"


def test_per_side_content_inset_per_side():
    """Content is inset only where a border is drawn (H=none → no top inset)."""
    result = _render(_ps_box({"border_h": "none"}, content="Hi"))
    lines = result.split("\n")
    assert lines[0] == "│Hi    │"  # content on the first row (no top inset)
    assert lines[1] == "│      │"
    assert lines[2] == "│      │"
    assert lines[3] == "│      │"


def test_per_side_empty_meta_inherits_base():
    """An empty meta renders exactly like no meta at all."""
    plain = _render(_ps_box(None))
    empty_meta = _render(_ps_box({}))
    assert plain == empty_meta


def test_per_side_button_ignores_meta():
    """Buttons keep the global border_style (their shapes don't map to sides)."""
    plain = _render([{
        "block_type": "button", "x": 0, "y": 0,
        "width": 16, "height": 3, "content": "Button", "border_style": "solid",
    }])
    with_meta = _render([{
        "block_type": "button", "x": 0, "y": 0,
        "width": 16, "height": 3, "content": "Button", "border_style": "solid",
        "meta": {"border_h": "dashed", "border_v": "dotted"},
    }])
    assert with_meta == plain


def test_per_side_lines_ignore_meta():
    """hline/vline keep the global line style."""
    plain = _render([{
        "block_type": "hline", "x": 0, "y": 0,
        "width": 8, "height": 1, "content": "", "border_style": "solid",
    }])
    with_meta = _render([{
        "block_type": "hline", "x": 0, "y": 0,
        "width": 8, "height": 1, "content": "", "border_style": "solid",
        "meta": {"border_h": "double", "border_v": "dashed"},
    }])
    assert with_meta == plain


def test_per_side_children_container():
    """A per-side container still clips and pads its children (1 cell)."""
    result = _render([{
        "block_type": "box",
        "x": 0, "y": 0,
        "width": 20, "height": 6,
        "content": "",
        "border_style": "solid",
        "meta": {"border_v": "none"},
        "children": [{
            "block_type": "text",
            "x": 1, "y": 1,
            "width": 8, "height": 1,
            "content": "Hello",
            "border_style": "none",
        }],
    }])
    lines = result.split("\n")
    assert lines[0] == "─" * 20  # top edge end to end (V=none → no corners)
    assert lines[2] == "  Hello"  # child at parent origin + 1-cell padding
    assert lines[5] == "─" * 20  # bottom edge end to end


def test_per_side_html_preview():
    """HTML preview: per-side classes from meta.border_h / meta.border_v."""
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "b1",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "block_type": "box",
        "content": "",
        "border_style": "solid",
        "meta": {"border_h": "dashed", "border_v": "double"},
    }])
    assert 'class="block-border block-border--h-dashed block-border--v-double"' in html


def test_per_side_html_preview_to_html_preview():
    """to_html_preview: meta.border_h=none → h-none, v inherits the base."""
    rb = RenderBlock(
        x=0, y=0, width=10, height=4,
        block_type="box", content="", border_style="solid",
        meta={"border_h": "none"},
    )
    html = rb.to_html_preview("b1")
    assert 'class="block-border block-border--h-none block-border--v-solid"' in html


def test_per_side_html_preview_lines_keep_global_style():
    """Lines keep the global style class (no per-side split)."""
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "l1",
        "x": 0, "y": 0,
        "width": 10, "height": 1,
        "block_type": "hline",
        "content": "",
        "border_style": "dashed",
        "meta": {"border_h": "double"},
    }])
    assert 'class="block-line block-line--h block-line--dashed"' in html


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


def test_fill_respects_per_side_inset():
    """The fill area is inset only where a border is drawn (H=none → no
    top/bottom inset)."""
    result = _render(_fill_box({"fill": "░", "border_h": "none"}))
    lines = result.split("\n")
    assert lines[0] == "│░░░░░░│"
    assert lines[1] == "│░░░░░░│"
    assert lines[2] == "│░░░░░░│"
    assert lines[3] == "│░░░░░░│"


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


# ── Button tests (tasks/0021-0030/0022-button.md) ────────


def _button(height: int, width: int = 16, content: str = "Button",
            border_style: str = "solid") -> list[dict]:
    return [{
        "block_type": "button",
        "x": 0, "y": 0,
        "width": width, "height": height,
        "content": content,
        "border_style": border_style,
    }]


def test_button_height_1():
    result = _render(_button(1))
    assert result.split("\n")[0] == "[Button        ]"


def test_button_height_2():
    result = _render(_button(2))
    lines = result.split("\n")
    assert lines[0] == "│Button        │"
    assert lines[1] == "└──────────────┘"


def test_button_height_3():
    result = _render(_button(3))
    lines = result.split("\n")
    assert lines[0] == "┌──────────────┐"
    assert lines[1] == "│Button        │"
    assert lines[2] == "└──────────────┘"


def test_button_height_4_label_upper_middle():
    result = _render(_button(4))
    lines = result.split("\n")
    assert lines[0] == "┌──────────────┐"
    assert lines[1] == "│Button        │"
    assert lines[2] == "│              │"
    assert lines[3] == "└──────────────┘"


def test_button_height_5_label_centered():
    result = _render(_button(5))
    lines = result.split("\n")
    assert lines[0] == "┌──────────────┐"
    assert lines[1] == "│              │"
    assert lines[2] == "│Button        │"
    assert lines[3] == "│              │"
    assert lines[4] == "└──────────────┘"


def test_button_border_styles():
    # h=2: side + bottom border use the style characters
    result = _render(_button(2, border_style="dashed"))
    lines = result.split("\n")
    assert lines[0] == "┆Button        ┆"
    assert lines[1] == "└" + "┄" * 14 + "┘"

    # h=3: full box in the style
    result = _render(_button(3, border_style="double"))
    lines = result.split("\n")
    assert lines[0] == "╔══════════════╗"
    assert lines[1] == "║Button        ║"
    assert lines[2] == "╚══════════════╝"

    # h=1: [label] for any style
    for style in ["solid", "dashed", "dotted", "double"]:
        result = _render(_button(1, border_style=style))
        assert result.split("\n")[0] == "[Button        ]", style


def test_button_border_none():
    result = _render(_button(3, border_style="none"))
    lines = result.split("\n")
    assert lines[0] == ""
    assert lines[1] == "Button"
    assert len(lines) == 2  # trailing empty rows are stripped


def test_button_label_truncated_not_wrapped():
    result = _render(_button(3, width=10, content="A very long label"))
    lines = result.split("\n")
    # Inner width = 8: label truncated, no wrapping
    assert lines[0] == "┌" + "─" * 8 + "┐"
    assert lines[1] == "│A very l│"
    assert lines[2] == "└" + "─" * 8 + "┘"


def test_button_label_ignores_newlines():
    result = _render(_button(3, content="Line1\nLine2"))
    lines = result.split("\n")
    assert lines[1] == "│Line1" + " " * 9 + "│"
    assert "Line2" not in result


def test_button_empty_content():
    result = _render(_button(3, content=""))
    lines = result.split("\n")
    assert lines[0] == "┌──────────────┐"
    assert lines[1] == "│              │"
    assert lines[2] == "└──────────────┘"


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
    assert 'class="block-border block-border--h-dashed block-border--v-dashed"' in html


def test_render_html_preview_double_border():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "b1",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "block_type": "box",
        "content": "",
        "border_style": "double",
    }])
    assert 'class="block-border block-border--h-double block-border--v-double"' in html


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


def test_render_html_preview_border_none():
    html = PseudoGraphicRenderer.render_html_preview([{
        "id": "b1",
        "x": 0, "y": 0,
        "width": 10, "height": 4,
        "block_type": "box",
        "content": "",
        "border_style": "none",
    }])
    assert 'class="block-border block-border--h-none block-border--v-none"' in html


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
