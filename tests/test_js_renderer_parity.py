"""Parity tests: the Python and JS pseudo-graphic renderers must agree.

The JS renderer (boxframe/static/js/core/renderer.js) is a port of
boxframe/services/renderer.py used by the static (backend-less) editor.
These tests run the same block sets through both implementations and
compare the ASCII output byte-for-byte.

Requires Node.js on PATH — skipped otherwise.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from boxframe.services.renderer import PseudoGraphicRenderer

NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")

RENDERER_JS = str(
    Path(__file__).resolve().parent.parent
    / "boxframe" / "static" / "js" / "core" / "renderer.js"
)


def render_js(blocks: list[dict], width: int | None, height: int | None) -> str:
    """Render blocks with the JS renderer via a node one-liner."""
    script = (
        f"const PG = require({json.dumps(RENDERER_JS)});"
        f"process.stdout.write(PG.render({json.dumps(blocks)}, "
        f"{json.dumps(width)}, {json.dumps(height)}));"
    )
    result = subprocess.run(
        [NODE, "-e", script],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def render_js_html(blocks: list[dict]) -> str:
    """Render the HTML preview with the JS renderer via a node one-liner."""
    script = (
        f"const PG = require({json.dumps(RENDERER_JS)});"
        f"process.stdout.write(PG.renderHtmlPreview({json.dumps(blocks)}));"
    )
    result = subprocess.run(
        [NODE, "-e", script],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def text_size_js(content: str, border_style: str) -> tuple[int, int]:
    """Compute the text fit size with the JS renderer via a node one-liner."""
    script = (
        f"const PG = require({json.dumps(RENDERER_JS)});"
        f"process.stdout.write(JSON.stringify(PG.textBlockSize("
        f"{json.dumps(content)}, {json.dumps(border_style)})));")
    result = subprocess.run(
        [NODE, "-e", script],
        capture_output=True,
        text=True,
        check=True,
    )
    w, h = json.loads(result.stdout)
    return w, h


def to_nested(blocks: list[dict]) -> list[dict]:
    """Convert a flat block list (parent_id refs) to nested dicts (children).

    The JS renderer takes a flat list; the Python renderer takes nested dicts.
    Children keep their document order in both.
    """
    node_by_id: dict[str, dict] = {}
    for b in blocks:
        node = dict(b)
        node["children"] = []
        node_by_id[b["id"]] = node
    roots: list[dict] = []
    for b in blocks:
        node = node_by_id[b["id"]]
        if b.get("parent_id") and b["parent_id"] in node_by_id:
            node_by_id[b["parent_id"]]["children"].append(node)
        else:
            roots.append(node)
    return roots


def test_parity_simple_blocks():
    blocks = [
        {"id": "b1", "block_type": "header", "x": 0, "y": 0, "width": 30, "height": 3,
         "content": "My App", "border_style": "solid", "order": 0},
        {"id": "b2", "block_type": "content", "x": 0, "y": 3, "width": 30, "height": 6,
         "content": "Main content area", "border_style": "solid", "order": 1},
        {"id": "b3", "block_type": "button", "x": 2, "y": 10, "width": 12, "height": 1,
         "content": "Submit", "border_style": "dashed", "order": 2},
    ]
    # Python render_simple takes nested dicts (no children here — same shape)
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
    assert render_js(blocks, 40, 14) == PseudoGraphicRenderer.render_simple(py_blocks, 40, 14)


def test_parity_all_border_styles():
    for style in ["solid", "dashed", "dotted", "double", "none"]:
        blocks = [{"id": "b1", "block_type": "box", "x": 1, "y": 1, "width": 12, "height": 4,
                   "content": f"style {style}", "border_style": style, "order": 0}]
        py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
        assert render_js(blocks, 30, 8) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 8), style


def test_parity_per_side_borders():
    """Per-side border styles (meta.border_h / meta.border_v) render identically."""
    cases = [
        # (meta, base style)
        ({"border_h": "solid", "border_v": "dashed"}, "solid"),
        ({"border_h": "solid", "border_v": "double"}, "solid"),
        ({"border_h": "dashed", "border_v": "double"}, "solid"),
        ({"border_h": "none"}, "solid"),
        ({"border_v": "none"}, "solid"),
        ({"border_h": "double", "border_v": "none"}, "solid"),
        ({"border_h": "none", "border_v": "none"}, "solid"),
        ({"border_v": "solid"}, "none"),
        ({}, "dotted"),
        ({}, "none"),
    ]
    for meta, base in cases:
        blocks = [{"id": "b1", "block_type": "box", "x": 0, "y": 0, "width": 12, "height": 5,
                   "content": "per-side", "border_style": base, "meta": meta, "order": 0}]
        py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
        assert render_js(blocks, 30, 8) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 8), (meta, base)


def test_parity_per_side_content_inset():
    """Content origin/inset depends on which sides have borders — in both renderers."""
    blocks = [
        {"id": "b1", "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 4,
         "content": "Hi", "border_style": "solid", "meta": {"border_h": "none"}, "order": 0},
        {"id": "b2", "block_type": "box", "x": 0, "y": 6, "width": 10, "height": 4,
         "content": "Hi", "border_style": "solid", "meta": {"border_v": "none"}, "order": 1},
    ]
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
    assert render_js(blocks, 30, 12) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 12)


def test_parity_per_side_children_container():
    """A container with per-side borders clips its children identically."""
    js_blocks = [
        {"id": "p", "block_type": "box", "x": 0, "y": 0, "width": 20, "height": 6,
         "content": "", "border_style": "solid", "meta": {"border_v": "none"}, "order": 0},
        {"id": "c", "block_type": "text", "x": 1, "y": 1, "width": 8, "height": 1,
         "content": "Hello", "border_style": "none", "parent_id": "p", "order": 0},
    ]
    py_blocks = [{
        "block_type": "box", "x": 0, "y": 0, "width": 20, "height": 6,
        "content": "", "border_style": "solid", "meta": {"border_v": "none"}, "order": 0,
        "children": [
            {"block_type": "text", "x": 1, "y": 1, "width": 8, "height": 1,
             "content": "Hello", "border_style": "none", "order": 0},
        ],
    }]
    assert render_js(js_blocks, 30, 8) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 8)


def test_parity_fill():
    """Fill (meta.fill) renders identically in both renderers."""
    cases = [
        # (block_type, meta, content, border_style)
        ("box", {"fill": "░"}, "", "solid"),
        ("box", {"fill": "█"}, "Hi", "solid"),
        ("box", {"fill": "·"}, "Hello World", "solid"),
        ("box", {"fill": " "}, "", "solid"),   # space fill (erases below)
        ("box", {"fill": "▒"}, "", "none"),
        ("header", {"fill": "▒"}, "Header", "double"),
        ("footer", {"fill": "▓"}, "", "dashed"),
        ("sidebar", {"fill": "░"}, "Side", "solid"),
        ("content", {"fill": "×"}, "Some content here that wraps", "solid"),
        ("grid", {"fill": "░"}, "", "dotted"),
        ("image", {"fill": "█"}, "", "solid"),
        ("box", {"fill": "░", "border_h": "none"}, "", "solid"),
        ("box", {"fill": "▒", "border_v": "none"}, "Hi", "solid"),
        ("box", {"fill": "░", "border_h": "none", "border_v": "none"}, "x", "none"),
        ("box", {"fill": "ab"}, "x", "solid"),  # invalid: more than one cell
        ("box", {"fill": ""}, "", "solid"),     # invalid: empty
        ("box", {"fill": 5}, "", "solid"),      # invalid: not a string
        ("button", {"fill": "░"}, "Btn", "solid"),   # not in the matrix
        ("text", {"fill": "░"}, "t", "none"),        # not in the matrix
        ("input", {"fill": "░"}, "", "solid"),       # not in the matrix
        ("divider", {"fill": "░"}, "", "solid"),     # not in the matrix
        ("hline", {"fill": "░"}, "", "solid"),       # not in the matrix
        ("vline", {"fill": "░"}, "", "solid"),       # not in the matrix
    ]
    for block_type, meta, content, base in cases:
        blocks = [{"id": "b1", "block_type": block_type, "x": 0, "y": 0,
                   "width": 12, "height": 5, "content": content,
                   "border_style": base, "meta": meta, "order": 0}]
        py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
        assert render_js(blocks, 30, 8) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 8), \
            (block_type, meta, content, base)


def test_parity_fill_children_container():
    """A filled container with children: the child overwrites the fill."""
    js_blocks = [
        {"id": "p", "block_type": "box", "x": 0, "y": 0, "width": 20, "height": 6,
         "content": "", "border_style": "solid", "meta": {"fill": "░"}, "order": 0},
        {"id": "c", "block_type": "text", "x": 1, "y": 1, "width": 8, "height": 1,
         "content": "Hello", "border_style": "none", "parent_id": "p", "order": 0},
    ]
    py_blocks = [{
        "block_type": "box", "x": 0, "y": 0, "width": 20, "height": 6,
        "content": "", "border_style": "solid", "meta": {"fill": "░"}, "order": 0,
        "children": [
            {"block_type": "text", "x": 1, "y": 1, "width": 8, "height": 1,
             "content": "Hello", "border_style": "none", "order": 0},
        ],
    }]
    assert render_js(js_blocks, 30, 8) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 8)


def test_parity_fill_space_erases_block_below():
    """A space fill erases the block underneath — identical in both
    renderers (the show-through case)."""
    js_blocks = [
        {"id": "a", "block_type": "box", "x": 0, "y": 0, "width": 12, "height": 3,
         "content": "ABCDEFGHIJ", "border_style": "solid", "order": 0},
        {"id": "b", "block_type": "box", "x": 0, "y": 0, "width": 12, "height": 3,
         "content": "", "border_style": "solid", "meta": {"fill": " "}, "order": 1},
    ]
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in js_blocks]
    assert render_js(js_blocks, 40, 12) == PseudoGraphicRenderer.render_simple(py_blocks, 40, 12)


def test_parity_lines():
    blocks = [
        {"id": "h1", "block_type": "hline", "x": 2, "y": 2, "width": 15, "height": 1,
         "content": "", "border_style": "double", "order": 0},
        {"id": "v1", "block_type": "vline", "x": 20, "y": 1, "width": 1, "height": 8,
         "content": "", "border_style": "dotted", "order": 1},
        {"id": "h2", "block_type": "hline", "x": 5, "y": 10, "width": 10, "height": 1,
         "content": "", "border_style": "none", "order": 2},
    ]
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
    assert render_js(blocks, 40, 12) == PseudoGraphicRenderer.render_simple(py_blocks, 40, 12)


def test_parity_arrows():
    """Arrows (meta.arrow_start / meta.arrow_end) render identically."""
    cases = [
        # (block_type, meta, border_style, width, height)
        ("hline", {"arrow_start": "arrow", "arrow_end": "arrow"}, "solid", 8, 1),
        ("hline", {"arrow_start": "arrow-open", "arrow_end": "arrow-open"}, "solid", 8, 1),
        ("hline", {"arrow_start": "diamond", "arrow_end": "diamond-open"}, "solid", 8, 1),
        ("hline", {"arrow_end": "circle"}, "dashed", 5, 1),
        ("hline", {"arrow_start": "circle-open"}, "dotted", 3, 1),
        ("hline", {"arrow_start": "diamond", "arrow_end": "arrow"}, "double", 6, 1),
        ("vline", {"arrow_start": "arrow", "arrow_end": "arrow"}, "solid", 1, 8),
        ("vline", {"arrow_start": "arrow-open", "arrow_end": "circle"}, "solid", 1, 8),
        ("vline", {"arrow_end": "diamond"}, "dashed", 1, 5),
        ("vline", {"arrow_start": "circle-open"}, "double", 1, 3),
        ("hline", {"arrow_start": "arrow", "arrow_end": "arrow"}, "solid", 1, 1),  # too short
        ("hline", {"arrow_start": "diamond", "arrow_end": "diamond"}, "solid", 2, 1),  # exactly 2
        ("hline", {"arrow_start": "foo", "arrow_end": "bar"}, "solid", 6, 1),  # invalid
        ("hline", {"arrow_start": "double", "arrow_end": "double"}, "solid", 6, 1),  # legacy value
        ("box", {"arrow_start": "arrow", "arrow_end": "diamond"}, "solid", 8, 3),  # not a line
        ("button", {"arrow_start": "arrow"}, "solid", 8, 1),  # not a line
    ]
    for block_type, meta, base, w, h in cases:
        blocks = [{"id": "b1", "block_type": block_type, "x": 0, "y": 0,
                   "width": w, "height": h, "content": "",
                   "border_style": base, "meta": meta, "order": 0}]
        py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
        assert render_js(blocks, 30, 12) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 12), \
            (block_type, meta, base)


def test_parity_alignment():
    """text_align / vertical_align render identically."""
    cases = [
        # (block_type, meta, content, border_style, width, height)
        ("box", {"text_align": "center"}, "Hi", "solid", 10, 4),
        ("box", {"text_align": "right"}, "Hi", "solid", 10, 4),
        ("box", {"vertical_align": "middle"}, "Hi", "solid", 10, 5),
        ("box", {"vertical_align": "bottom"}, "Hi", "solid", 10, 5),
        ("box", {"text_align": "center", "vertical_align": "middle"}, "Hi", "solid", 10, 5),
        ("box", {"text_align": "right", "vertical_align": "bottom"}, "Hello World", "solid", 10, 5),
        ("box", {"text_align": "center", "fill": "░"}, "Hi", "solid", 10, 4),
        ("box", {"vertical_align": "bottom", "fill": "█"}, "a\nb\nc", "solid", 10, 4),
        ("box", {"text_align": "center"}, "Hi", "none", 10, 4),
        ("text", {"text_align": "right", "vertical_align": "middle"}, "t", "none", 10, 5),
        ("header", {"text_align": "center"}, "Header", "double", 20, 4),
        ("button", {"text_align": "center"}, "Button", "solid", 14, 2),
        ("button", {"text_align": "right"}, "Button", "dashed", 14, 3),
        ("button", {"vertical_align": "bottom"}, "Button", "solid", 14, 3),  # no-op for buttons
        ("hline", {"text_align": "center"}, "", "solid", 8, 1),  # lines ignore alignment
        ("vline", {"vertical_align": "bottom"}, "", "solid", 1, 8),
    ]
    for block_type, meta, content, base, w, h in cases:
        blocks = [{"id": "b1", "block_type": block_type, "x": 0, "y": 0,
                   "width": w, "height": h, "content": content,
                   "border_style": base, "meta": meta, "order": 0}]
        py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
        assert render_js(blocks, 30, 12) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 12), \
            (block_type, meta, content, base)


def test_parity_text_block_size():
    """The text fit size (autosize) must agree between the renderers."""
    from boxframe.services.renderer import text_block_size
    cases = [
        ("", "none"),
        ("", "solid"),
        ("hi", "none"),
        ("hi", "solid"),
        ("hi", "double"),
        ("hello\nworld", "none"),
        ("hello\nworld", "dashed"),
        ("ab\ncdef", "dotted"),
        ("a\n", "none"),
        ("  spaced  ", "solid"),
    ]
    for content, style in cases:
        assert text_block_size(content, style) == text_size_js(content, style), (content, style)


def test_parity_word_wrap():
    blocks = [{"id": "b1", "block_type": "box", "x": 0, "y": 0, "width": 14, "height": 6,
               "content": "The quick brown fox jumps over the lazy dog and keeps going",
               "border_style": "solid", "order": 0}]
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
    assert render_js(blocks, 30, 8) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 8)


def test_parity_word_wrap_spaces():
    """Runs of spaces (formatting) are kept/dropped identically by both renderers."""
    blocks = [{"id": "b1", "block_type": "box", "x": 0, "y": 0, "width": 18, "height": 5,
               "content": "Name        Price\n  indented    text",
               "border_style": "solid", "order": 0}]
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
    assert render_js(blocks, 30, 8) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 8)


def test_parity_order_overlap():
    blocks = [
        {"id": "low", "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 5,
         "content": "LOW", "border_style": "solid", "order": 0},
        {"id": "high", "block_type": "box", "x": 2, "y": 1, "width": 10, "height": 5,
         "content": "HIGH", "border_style": "solid", "order": 10},
    ]
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
    assert render_js(blocks, 30, 8) == PseudoGraphicRenderer.render_simple(py_blocks, 30, 8)


def test_parity_children_order_overlap():
    """Children inside a container render by order (z-index), not position:
    the higher-order child overwrites the lower one at the overlap, in both
    renderers, even when the higher-order child is positioned above."""
    js_blocks = [
        {"id": "p", "block_type": "box", "x": 0, "y": 0, "width": 20, "height": 8,
         "content": "", "border_style": "solid", "order": 0},
        {"id": "high", "block_type": "box", "x": 2, "y": 1, "width": 10, "height": 3,
         "content": "HIGH", "border_style": "solid", "parent_id": "p", "order": 10},
        {"id": "low", "block_type": "box", "x": 2, "y": 2, "width": 10, "height": 3,
         "content": "LOW", "border_style": "solid", "parent_id": "p", "order": 0},
        {"id": "t_high", "block_type": "text", "x": 12, "y": 1, "width": 6, "height": 2,
         "content": "TOP", "border_style": "none", "parent_id": "p", "order": 5},
        {"id": "t_low", "block_type": "text", "x": 12, "y": 1, "width": 6, "height": 2,
         "content": "BOT", "border_style": "none", "parent_id": "p", "order": 1},
    ]
    py_blocks = [{
        "block_type": "box", "x": 0, "y": 0, "width": 20, "height": 8,
        "content": "", "border_style": "solid", "order": 0,
        "children": [
            {"block_type": "box", "x": 2, "y": 1, "width": 10, "height": 3,
             "content": "HIGH", "border_style": "solid", "order": 10},
            {"block_type": "box", "x": 2, "y": 2, "width": 10, "height": 3,
             "content": "LOW", "border_style": "solid", "order": 0},
            {"block_type": "text", "x": 12, "y": 1, "width": 6, "height": 2,
             "content": "TOP", "border_style": "none", "order": 5},
            {"block_type": "text", "x": 12, "y": 1, "width": 6, "height": 2,
             "content": "BOT", "border_style": "none", "order": 1},
        ],
    }]
    assert render_js(js_blocks, 40, 12) == PseudoGraphicRenderer.render_simple(py_blocks, 40, 12)


def test_parity_nested_blocks():
    """Nested children: JS takes a flat list with parent_id, Python takes children inline."""
    js_blocks = [
        {"id": "p", "block_type": "box", "x": 0, "y": 0, "width": 24, "height": 8,
         "content": "", "border_style": "solid", "order": 0},
        {"id": "c1", "block_type": "button", "x": 1, "y": 1, "width": 10, "height": 2,
         "content": "Click", "border_style": "dashed", "parent_id": "p", "order": 0},
        {"id": "c2", "block_type": "text", "x": 1, "y": 4, "width": 12, "height": 2,
         "content": "Hello world", "border_style": "none", "parent_id": "p", "order": 1},
    ]
    py_blocks = [{
        "block_type": "box", "x": 0, "y": 0, "width": 24, "height": 8,
        "content": "", "border_style": "solid", "order": 0,
        "children": [
            {"block_type": "button", "x": 1, "y": 1, "width": 10, "height": 2,
             "content": "Click", "border_style": "dashed", "order": 0},
            {"block_type": "text", "x": 1, "y": 4, "width": 12, "height": 2,
             "content": "Hello world", "border_style": "none", "order": 1},
        ],
    }]
    assert render_js(js_blocks, 40, 12) == PseudoGraphicRenderer.render_simple(py_blocks, 40, 12)


def test_parity_button_heights():
    """Buttons of all heights (h=1 [label], h=2 no top border, h>=3 full box)."""
    blocks = [
        {"id": "b1", "block_type": "button", "x": 0, "y": 0, "width": 16, "height": 1,
         "content": "Button", "border_style": "solid", "order": 0},
        {"id": "b2", "block_type": "button", "x": 0, "y": 2, "width": 16, "height": 2,
         "content": "Button", "border_style": "dashed", "order": 1},
        {"id": "b3", "block_type": "button", "x": 0, "y": 5, "width": 16, "height": 3,
         "content": "Button", "border_style": "double", "order": 2},
        {"id": "b4", "block_type": "button", "x": 0, "y": 9, "width": 16, "height": 5,
         "content": "Button", "border_style": "solid", "order": 3},
        {"id": "b5", "block_type": "button", "x": 20, "y": 0, "width": 10, "height": 4,
         "content": "A very long label", "border_style": "none", "order": 4},
    ]
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
    assert render_js(blocks, 40, 14) == PseudoGraphicRenderer.render_simple(py_blocks, 40, 14)


def test_parity_grid_expansion():
    """Blocks outside the layout bounds expand the canvas identically."""
    blocks = [
        {"id": "b1", "block_type": "box", "x": 35, "y": 10, "width": 10, "height": 4,
         "content": "edge", "border_style": "solid", "order": 0},
        {"id": "h1", "block_type": "hline", "x": 30, "y": 0, "width": 20, "height": 1,
         "content": "", "border_style": "solid", "order": 1},
    ]
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
    assert render_js(blocks, 40, 14) == PseudoGraphicRenderer.render_simple(py_blocks, 40, 14)


def test_parity_no_dimensions():
    """Unset layout dimensions: the canvas is the 80×24 default floor."""
    blocks = [
        {"id": "b1", "block_type": "box", "x": 3, "y": 2, "width": 10, "height": 4,
         "content": "edge", "border_style": "solid", "order": 0},
        {"id": "h1", "block_type": "hline", "x": 0, "y": 8, "width": 12, "height": 1,
         "content": "", "border_style": "dashed", "order": 1},
    ]
    py_blocks = [{k: v for k, v in b.items() if k != "id"} for b in blocks]
    assert render_js(blocks, None, None) == PseudoGraphicRenderer.render_simple(py_blocks, None, None)


def test_parity_html_preview_nested():
    """HTML preview: children nested in the parent div (overflow:hidden clip)."""
    blocks = [
        {"id": "p", "block_type": "box", "x": 0, "y": 0, "width": 24, "height": 8,
         "content": "", "border_style": "solid", "order": 0},
        {"id": "c1", "block_type": "button", "x": 1, "y": 1, "width": 10, "height": 2,
         "content": "Click", "border_style": "dashed", "parent_id": "p", "order": 0},
        {"id": "c2", "block_type": "text", "x": 1, "y": 4, "width": 12, "height": 2,
         "content": "Hello", "border_style": "none", "parent_id": "p", "order": 1},
    ]
    assert render_js_html(blocks) == PseudoGraphicRenderer.render_html_preview(to_nested(blocks))


def test_parity_html_preview_box_in_box():
    """HTML preview: nested containers, each clipping its children."""
    blocks = [
        {"id": "outer", "block_type": "box", "x": 0, "y": 0, "width": 40, "height": 12,
         "content": "", "border_style": "solid", "order": 0},
        {"id": "inner", "block_type": "box", "x": 2, "y": 2, "width": 20, "height": 6,
         "content": "", "border_style": "dashed", "parent_id": "outer", "order": 0},
        {"id": "leaf", "block_type": "text", "x": 1, "y": 1, "width": 8, "height": 2,
         "content": "hi", "border_style": "none", "parent_id": "inner", "order": 0},
    ]
    assert render_js_html(blocks) == PseudoGraphicRenderer.render_html_preview(to_nested(blocks))


def test_parity_html_preview_child_bigger_than_parent():
    """HTML preview: an oversized child is still nested and clipped."""
    blocks = [
        {"id": "parent", "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 4,
         "content": "", "border_style": "solid", "order": 0},
        {"id": "big", "block_type": "box", "x": 2, "y": 1, "width": 30, "height": 10,
         "content": "", "border_style": "dashed", "parent_id": "parent", "order": 0},
    ]
    assert render_js_html(blocks) == PseudoGraphicRenderer.render_html_preview(to_nested(blocks))


def test_parity_html_preview_per_side_borders():
    """HTML preview: per-side border classes (meta.border_h / meta.border_v)."""
    blocks = [
        {"id": "b1", "block_type": "box", "x": 0, "y": 0, "width": 12, "height": 4,
         "content": "", "border_style": "solid",
         "meta": {"border_h": "dashed", "border_v": "double"}, "order": 0},
        {"id": "b2", "block_type": "box", "x": 0, "y": 6, "width": 12, "height": 4,
         "content": "", "border_style": "solid", "meta": {"border_h": "none"}, "order": 1},
        {"id": "b3", "block_type": "box", "x": 0, "y": 12, "width": 12, "height": 4,
         "content": "", "border_style": "dotted", "order": 2},
    ]
    assert render_js_html(blocks) == PseudoGraphicRenderer.render_html_preview(to_nested(blocks))
