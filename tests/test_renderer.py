"""Tests for the pseudo-graphic renderer."""

from boxframe.services.renderer import RenderBlock, PseudoGraphicRenderer


def _render(blocks_data: list[dict], width: int = 40, height: int = 12) -> str:
    return PseudoGraphicRenderer.render_simple(blocks_data, width, height)


def test_empty_layout():
    result = _render([], 40, 12)
    lines = result.strip().split("\n")
    assert len(lines) <= 12


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
    # Canvas expanded to 45×14 — the full box is drawn, not clamped
    assert lines[10][35] == "┌"
    assert lines[10][44] == "┐"
    assert lines[13][35] == "└"
    assert lines[13][44] == "┘"


def test_render_keeps_layout_size_when_blocks_fit():
    """Canvas stays at the layout size when all blocks fit inside."""
    r = PseudoGraphicRenderer(40, 12)
    r.render([RenderBlock(
        x=0, y=0, width=10, height=3,
        block_type="box", content="", border_style="solid",
    )])
    assert len(r.grid) == 12
    assert len(r.grid[0]) == 40


def test_canvas_size_expands_for_blocks_outside_layout():
    inside = RenderBlock(
        x=0, y=0, width=10, height=3,
        block_type="box", content="", border_style="solid",
    )
    assert PseudoGraphicRenderer.canvas_size([inside], 40, 12) == (40, 12)

    outside = RenderBlock(
        x=35, y=10, width=10, height=4,
        block_type="box", content="", border_style="solid",
    )
    assert PseudoGraphicRenderer.canvas_size([outside], 40, 14) == (45, 14)


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
    assert lines[0][35:] == "─" * 20  # canvas expanded to 55


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
