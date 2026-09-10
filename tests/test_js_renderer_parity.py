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


def render_js(blocks: list[dict], width: int, height: int) -> str:
    """Render blocks with the JS renderer via a node one-liner."""
    script = (
        f"const PG = require({json.dumps(RENDERER_JS)});"
        f"process.stdout.write(PG.render({json.dumps(blocks)}, {width}, {height}));"
    )
    result = subprocess.run(
        [NODE, "-e", script],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


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
