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


def test_grid_clamping():
    """Blocks extending beyond grid should be clamped."""
    result = _render([{
        "block_type": "box",
        "x": 35, "y": 10,
        "width": 10, "height": 4,
        "content": "",
        "border_style": "solid",
    }], width=40, height=14)
    lines = result.split("\n")
    # Should not crash and should have borders
    assert any("┌" in line for line in lines)


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
