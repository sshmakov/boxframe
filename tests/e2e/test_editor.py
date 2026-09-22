"""
End-to-end tests for the layout editor using Playwright.

Requires a running server at http://127.0.0.1:8000.
Run with: pytest tests/e2e/ -v --asyncio-mode=auto
"""

import json
import re

import requests
from playwright.sync_api import Page, expect


BASE_URL = "http://127.0.0.1:8000"

# A nested export (the format produced by the Export → JSON action) used by
# the import tests. Two blocks: a box and a button.
IMPORT_JSON = {
    "id": "imported-layout",
    "name": "Imported",
    "width": 40,
    "height": 12,
    "blocks": [
        {
            "id": "imp-1",
            "type": "box",
            "x": 0, "y": 0, "width": 20, "height": 6,
            "content": "Imported Box",
            "border_style": "solid",
            "metadata": {},
            "order": 0,
        },
        {
            "id": "imp-2",
            "type": "button",
            "x": 2, "y": 1, "width": 10, "height": 1,
            "content": "Go",
            "border_style": "dashed",
            "metadata": {},
            "order": 1,
        },
    ],
}


def _import_file(page: Page) -> None:
    """Feed the import JSON to the editor's hidden file input."""
    page.set_input_files(
        ".import-file-input",
        {"name": "layout.json", "mimeType": "application/json",
         "buffer": json.dumps(IMPORT_JSON).encode()},
    )


def _create_project_with_block(page: Page) -> tuple[str, str]:
    """Create a project and layout via the UI, add a block via the API.

    Returns (layout_id, block_id).
    """
    page.goto(BASE_URL)
    page.get_by_role("button", name="+ New Project").click()
    page.get_by_placeholder("Project name...").fill("E2E: Editor Test")
    page.get_by_role("button", name="Create").click()
    expect(page).to_have_title("E2E: Editor Test — boxframe")

    page.get_by_role("button", name="+ New Layout").click()
    page.get_by_placeholder("Layout name...").fill("Editor Test Layout")
    page.get_by_role("button", name="Create").click()
    expect(page).to_have_url(re.compile(f"{BASE_URL}/layout/[0-9a-f-]+"))
    layout_id = re.search(r"/layout/([0-9a-f-]+)", page.url).group(1)

    r = requests.post(
        f"{BASE_URL}/api/layouts/{layout_id}/blocks",
        json={
            "block_type": "box",
            "x": 2, "y": 2, "width": 20, "height": 4,
            "content": "Old",
        },
        timeout=5,
    )
    assert r.status_code == 200
    block_id = r.json()["id"]

    # Reload so the editor renders the new block
    page.reload()
    expect(page.locator(f'.block-preview[data-block-id="{block_id}"]')).to_be_visible()
    return layout_id, block_id


def test_editor_page_loads(page: Page):
    """Test that the editor page loads (404 for non-existent layout is expected)."""
    page.goto(f"{BASE_URL}/layout/00000000-0000-0000-0000-000000000000")
    expect(page).to_have_title("404 — boxframe")
    expect(page.get_by_text("Layout not found")).to_be_visible()


def test_project_page_loads(page: Page):
    """Test that the project page loads (404 for non-existent project is expected)."""
    page.goto(f"{BASE_URL}/project/00000000-0000-0000-0000-000000000000")
    expect(page).to_have_title("404 — boxframe")
    expect(page.get_by_text("Project not found")).to_be_visible()


def test_index_page_has_editor_link(page: Page):
    """Test that the index page has links to the editor."""
    page.goto(BASE_URL)

    # Check that the editor link exists
    expect(page.get_by_role("heading", name="Projects")).to_be_visible()
    expect(page.get_by_role("button", name="+ New Project")).to_be_visible()


def test_double_click_edits_block_content(page: Page):
    """Double-clicking a block opens inline editing; Enter saves the content."""
    layout_id, block_id = _create_project_with_block(page)

    # Double-click the block → inline editor opens with the current content
    page.locator(f'.block-preview[data-block-id="{block_id}"]').dblclick()
    textarea = page.locator(".block-edit-overlay textarea")
    expect(textarea).to_be_visible()
    expect(textarea).to_have_value("Old")

    # Replace the text and save with Enter
    textarea.fill("New text")
    textarea.press("Enter")

    # Editor closes after saving
    expect(page.locator(".block-edit-overlay")).not_to_be_visible()

    # Content is persisted in the database
    r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
    block = next(b for b in r.json()["blocks"] if b["id"] == block_id)
    assert block["content"] == "New text"


def test_double_click_esc_cancels_edit(page: Page):
    """Esc in the inline editor cancels the edit without saving."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').dblclick()
    textarea = page.locator(".block-edit-overlay textarea")
    expect(textarea).to_be_visible()

    textarea.fill("Changed")
    textarea.press("Escape")

    # Editor closes and the content is unchanged
    expect(page.locator(".block-edit-overlay")).not_to_be_visible()
    r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
    block = next(b for b in r.json()["blocks"] if b["id"] == block_id)
    assert block["content"] == "Old"


def test_single_click_selects_block(page: Page):
    """Single-clicking a block selects it: frame on canvas + highlight in list."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()

    # Semi-transparent selection frame with a resize handle appears on the
    # canvas; the block actions live in the properties panel
    selection = page.locator(".block-selection")
    expect(selection).to_be_visible()
    expect(selection.locator(".sel-resize")).to_be_visible()
    expect(selection.locator(".sel-icon")).to_have_count(0)

    # The block is highlighted in the sidebar list
    expect(page.locator(".block-item--selected")).to_have_count(1)
    expect(page.locator(".block-item--selected .block-item__info strong")).to_have_text("box")


def test_click_list_item_selects_block(page: Page):
    """Clicking an element in the sidebar list selects it on the canvas."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(".block-item__info").first.click()

    expect(page.locator(".block-selection")).to_be_visible()
    expect(page.locator(".block-item--selected")).to_have_count(1)


def test_click_empty_canvas_deselects(page: Page):
    """Clicking an empty canvas area clears the selection."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()
    expect(page.locator(".block-selection")).to_be_visible()

    # Click near the bottom-right corner of the render area (no block there)
    box = page.locator(".render-wrapper").bounding_box()
    page.mouse.click(box["x"] + box["width"] - 10, box["y"] + box["height"] - 10)

    expect(page.locator(".block-selection")).not_to_be_visible()
    expect(page.locator(".block-item--selected")).to_have_count(0)


def test_panel_duplicate_creates_block_copy(page: Page):
    """The Duplicate action in the properties panel creates a copy of the block."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()
    page.locator(".block-props .action-btn", has_text="Duplicate").click()

    # Poll: the browser's POST may still be in flight
    blocks = []
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = r.json()["blocks"]
        if len(blocks) == 2:
            break
        page.wait_for_timeout(100)
    assert len(blocks) == 2
    # The copy is offset by one cell and keeps the same content
    copy = next(b for b in blocks if b["id"] != block_id)
    assert copy["content"] == "Old"
    assert (copy["x"], copy["y"]) == (3, 3)
    # The copy becomes the selected element
    expect(page.locator(".block-item--selected")).to_have_count(1)


def test_panel_delete_removes_block(page: Page):
    """The Delete action in the properties panel deletes the selected block."""
    layout_id, block_id = _create_project_with_block(page)

    page.on("dialog", lambda dialog: dialog.accept())

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()
    page.locator(".block-props .action-btn", has_text="Delete").click()

    # Poll: the browser's DELETE may still be in flight
    blocks = None
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = r.json()["blocks"]
        if blocks == []:
            break
        page.wait_for_timeout(100)
    assert blocks == []
    expect(page.locator(".block-selection")).not_to_be_visible()


def test_web_editor_clear_layout_with_confirmation(page: Page):
    """The Clear button in the web editor asks for confirmation and removes
    all blocks from the database (the layout itself is kept)."""
    layout_id, block_id = _create_project_with_block(page)

    clear_btn = page.locator(".clear-layout-btn")
    expect(clear_btn).to_be_visible()

    # Dismissing the dialog keeps the layout intact
    page.once("dialog", lambda dialog: dialog.dismiss())
    clear_btn.click()
    expect(page.locator(f'.block-preview[data-block-id="{block_id}"]')).to_be_visible()

    # Accepting the dialog clears the layout (blocks removed from the DB)
    page.once("dialog", lambda dialog: dialog.accept())
    clear_btn.click()

    # Poll: the browser's DELETE may still be in flight
    blocks = None
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = r.json()["blocks"]
        if blocks == []:
            break
        page.wait_for_timeout(100)
    assert blocks == []
    expect(page.locator(".block-preview")).to_have_count(0)
    expect(page.locator(".block-item")).to_have_count(0)

    # The layout itself still exists
    r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
    assert r.status_code == 200


def test_web_editor_undo_redo(page: Page):
    """Undo/Redo restore previous layout states in the database.

    The Undo button reverts the last edit, the Ctrl+Shift+Z hotkey
    re-applies it; the buttons track the stack state."""
    layout_id, block_id = _create_project_with_block(page)

    def db_content():
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        return next(b for b in r.json()["blocks"] if b["id"] == block_id)["content"]

    def wait_content(expected):
        # Poll: the browser's request may still be in flight
        for _ in range(20):
            if db_content() == expected:
                return
            page.wait_for_timeout(100)
        assert db_content() == expected

    # Edit the content: "Old" → "New text"
    page.locator(f'.block-preview[data-block-id="{block_id}"]').dblclick()
    textarea = page.locator(".block-edit-overlay textarea")
    expect(textarea).to_be_visible()
    textarea.fill("New text")
    textarea.press("Enter")
    expect(page.locator(".block-edit-overlay")).not_to_be_visible()
    wait_content("New text")

    undo_btn = page.locator(".undo-btn")
    redo_btn = page.locator(".redo-btn")
    expect(undo_btn).to_be_enabled()
    expect(redo_btn).to_be_disabled()

    # Undo: the content reverts to "Old"
    undo_btn.click()
    wait_content("Old")
    expect(undo_btn).to_be_disabled()
    expect(redo_btn).to_be_enabled()

    # Redo via the Ctrl+Shift+Z hotkey: "New text" comes back
    page.keyboard.press("Control+Shift+z")
    wait_content("New text")
    expect(redo_btn).to_be_disabled()


def test_drag_block_past_canvas_edges(page: Page):
    """A block can be dragged past the right/bottom edge of the rendered
    canvas — the drag keeps tracking while the cursor is outside the art."""
    layout_id, block_id = _create_project_with_block(page)

    # The editor re-renders the canvas once more after measuring the real
    # character size — poll until both boxes are available, captured
    # atomically (one evaluate) so they come from the same DOM generation.
    boxes = None
    for _ in range(20):
        boxes = page.evaluate("""(blockId) => {
            const w = document.querySelector('.render-wrapper');
            const b = document.querySelector('.block-preview[data-block-id="' + blockId + '"]');
            if (!w || !b) return null;
            const wr = w.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return {
                wrapper: {x: wr.x, y: wr.y, width: wr.width, height: wr.height},
                block: {x: br.x, y: br.y, width: br.width, height: br.height},
            };
        }""", block_id)
        if boxes:
            break
        page.wait_for_timeout(100)
    assert boxes is not None
    wrapper_box, block_box = boxes["wrapper"], boxes["block"]

    # Start the drag from the middle of the block (20×4 at (2,2))
    start_x = block_box["x"] + block_box["width"] / 2
    start_y = block_box["y"] + block_box["height"] / 2

    # Target: past the bottom-right corner of the canvas
    end_x = wrapper_box["x"] + wrapper_box["width"] + 50
    end_y = wrapper_box["y"] + wrapper_box["height"] + 50

    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(end_x, end_y, steps=10)
    page.mouse.up()

    # Poll: the browser's PUT may still be in flight
    block = None
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        block = next(b for b in r.json()["blocks"] if b["id"] == block_id)
        if block["x"] > 2 or block["y"] > 2:
            break
        page.wait_for_timeout(100)
    # The block extends past the original canvas (80×24) on both axes
    assert block["x"] + block["width"] > 80
    assert block["y"] + block["height"] > 24


def test_selection_resize_handle_resizes_block(page: Page):
    """Dragging the resize handle on the selection frame resizes the block."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()

    # Estimate the character cell size from the block's rendered size (20x4)
    block_box = page.locator(f'.block-preview[data-block-id="{block_id}"]').bounding_box()
    cw = block_box["width"] / 20
    ch = block_box["height"] / 4

    handle = page.locator(".block-selection .sel-resize")
    h = handle.bounding_box()
    start_x = h["x"] + h["width"] / 2
    start_y = h["y"] + h["height"] / 2

    # Drag +2 cells right, +1 cell down
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + 2 * cw, start_y + 1 * ch, steps=5)
    page.mouse.up()

    # Poll: the browser's PUT may still be in flight
    block = None
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        block = next(b for b in r.json()["blocks"] if b["id"] == block_id)
        if (block["width"], block["height"]) == (22, 5):
            break
        page.wait_for_timeout(100)
    assert (block["width"], block["height"]) == (22, 5)


def test_properties_panel_shows_next_to_selected_block(page: Page):
    """Selecting a block shows a floating properties panel next to it."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()

    panel = page.locator(".block-props")
    expect(panel).to_be_visible()
    expect(panel.locator(".block-props__type")).to_have_text("box")
    # The Line Style buttons reflect the current border style
    expect(panel.locator(".style-btn")).to_have_count(5)
    expect(panel.locator(".style-btn--active")).to_have_count(1)
    expect(panel.locator(".style-btn--active")).to_have_attribute("title", "solid")

    # The panel floats to the right of the block (the preferred side) and
    # stays inside the visible canvas area
    block_box = page.locator(f'.block-preview[data-block-id="{block_id}"]').bounding_box()
    panel_box = panel.bounding_box()
    canvas_box = page.locator(".canvas-container").bounding_box()
    assert panel_box["x"] >= block_box["x"] + block_box["width"] - 1
    assert panel_box["x"] >= canvas_box["x"]
    assert panel_box["y"] >= canvas_box["y"]
    assert panel_box["x"] + panel_box["width"] <= canvas_box["x"] + canvas_box["width"]
    assert panel_box["y"] + panel_box["height"] <= canvas_box["y"] + canvas_box["height"]


def test_properties_panel_updates_border_style(page: Page):
    """Changing the style in the properties panel persists to the database."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()
    panel = page.locator(".block-props")
    expect(panel).to_be_visible()

    panel.locator(".style-btn[title='dashed']").click()

    # Poll: the browser's PUT may still be in flight
    block = None
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        block = next(b for b in r.json()["blocks"] if b["id"] == block_id)
        if block["border_style"] == "dashed":
            break
        page.wait_for_timeout(100)
    assert block["border_style"] == "dashed"


def test_properties_panel_fields_in_one_row(page: Page):
    """X/Y/W/H are one row of four fields; each label sits to the left of
    its input, not above it."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()
    panel = page.locator(".block-props")
    expect(panel).to_be_visible()

    boxes = [
        panel.locator(".prop-row input").nth(i).bounding_box()
        for i in range(4)
    ]
    assert all(b is not None for b in boxes)

    # One row: the same top (up to a couple of px) and strictly
    # increasing left — X, Y, W, H from left to right
    tops = [b["y"] for b in boxes]
    assert max(tops) - min(tops) <= 2
    lefts = [b["x"] for b in boxes]
    assert all(b2 > b1 for b1, b2 in zip(lefts, lefts[1:]))

    # The label of each field is to the left of its input, vertically
    # centered against it
    for i in range(4):
        label = panel.locator(".prop-row .prop--inline > span").nth(i).bounding_box()
        inp = boxes[i]
        assert label is not None
        assert label["x"] + label["width"] <= inp["x"] + 1
        label_cy = label["y"] + label["height"] / 2
        assert inp["y"] <= label_cy <= inp["y"] + inp["height"]


def test_properties_panel_section_order(page: Page):
    """Panel sections top to bottom: actions, Line Style, X/Y/W/H, Order,
    Content."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()
    panel = page.locator(".block-props")
    expect(panel).to_be_visible()

    sections = {
        "actions": panel.locator(".block-props__actions"),
        "line_style": panel.locator(".prop--wide:has(.style-btns)"),
        "xywh": panel.locator(".prop-row"),
        "order": panel.locator(".prop--wide:has(input[type=number])"),
        "content": panel.locator(".prop--wide:has(input[type=text])"),
    }
    for name, loc in sections.items():
        expect(loc).to_have_count(1)

    tops = [sections[name].bounding_box()["y"] for name in sections]
    assert all(b > a for a, b in zip(tops, tops[1:]))


# ── Multi-selection (marquee + group operations) ──────────
#
# Two boxes side by side, used by the multi-selection tests:
# A at (2,2) 10×4, B at (14,2) 10×4 (a 2-cell gap between them).
TWO_BOXES = [
    {"block_type": "box", "x": 2, "y": 2, "width": 10, "height": 4},
    {"block_type": "box", "x": 14, "y": 2, "width": 10, "height": 4},
]


def _wait_editor_ready(page: Page, num_blocks: int) -> None:
    """Wait until the Alpine editor app has finished its initial load.

    The block previews are server-rendered (visible right after the reload),
    but the app binds its global mouse listeners and measures the character
    size only after init()'s async load — canvas interactions started before
    that are silently dropped (a drag that never commits).
    """
    page.wait_for_function(
        """(n) => {
            const els = document.querySelectorAll('[x-data]');
            for (const el of els) {
                const app = el._x_dataStack ? el._x_dataStack[0] : null;
                if (app && Array.isArray(app.blocks)) {
                    return !app.loading && app.blocks.length === n &&
                        app.charWidth > 0;
                }
            }
            return false;
        }""",
        arg=num_blocks,
        timeout=10000,
    )


def _create_project_with_blocks(page: Page, specs: list[dict]) -> tuple[str, list[str]]:
    """Create a project and layout via the UI, add blocks via the API.

    specs: list of {block_type, x, y, width, height, content?, border_style?}.
    Returns (layout_id, [block_ids]).
    """
    page.goto(BASE_URL)
    page.get_by_role("button", name="+ New Project").click()
    page.get_by_placeholder("Project name...").fill("E2E: Multi-Select Test")
    page.get_by_role("button", name="Create").click()
    expect(page).to_have_title("E2E: Multi-Select Test — boxframe")

    page.get_by_role("button", name="+ New Layout").click()
    page.get_by_placeholder("Layout name...").fill("Multi-Select Layout")
    page.get_by_role("button", name="Create").click()
    expect(page).to_have_url(re.compile(f"{BASE_URL}/layout/[0-9a-f-]+"))
    layout_id = re.search(r"/layout/([0-9a-f-]+)", page.url).group(1)

    block_ids = []
    for spec in specs:
        payload = {
            "block_type": spec["block_type"],
            "x": spec["x"], "y": spec["y"],
            "width": spec["width"], "height": spec["height"],
        }
        if "content" in spec:
            payload["content"] = spec["content"]
        if "border_style" in spec:
            payload["border_style"] = spec["border_style"]
        # parent_index references an earlier block in the same list — used
        # to seed nested (container → child) layouts.
        if "parent_index" in spec:
            payload["parent_id"] = block_ids[spec["parent_index"]]
        r = requests.post(
            f"{BASE_URL}/api/layouts/{layout_id}/blocks",
            json=payload, timeout=5,
        )
        assert r.status_code == 200
        block_ids.append(r.json()["id"])

    # Reload so the editor renders the new blocks, and wait until the app
    # has loaded them (canvas drags before that are silently dropped).
    page.reload()
    _wait_editor_ready(page, len(block_ids))
    for bid in block_ids:
        expect(page.locator(f'.block-preview[data-block-id="{bid}"]')).to_be_visible()
    return layout_id, block_ids


def _canvas_metrics(page: Page, block_id: str, block_w: int, block_h: int) -> dict:
    """Measure the canvas geometry: the container origin and the char cell size.

    Polls until the canvas container and the given block are both laid out
    (the editor re-renders once after measuring the real character size),
    capturing everything atomically in one evaluate so the values come from
    the same DOM generation.

    Returns {container: {x, y}, cw, ch}.
    """
    metrics = None
    for _ in range(20):
        metrics = page.evaluate(
            """(args) => {
                const [blockId, bw, bh] = args;
                const c = document.querySelector('.canvas-container');
                const b = document.querySelector('.block-preview[data-block-id="' + blockId + '"]');
                if (!c || !b) return null;
                const cr = c.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                if (br.width === 0 || br.height === 0) return null;
                // The editor re-renders once after measuring the real
                // character size — wait until the overlay matches the app's
                // measured size, otherwise the metrics come from the first
                // (default-size) render and canvas drags miss their targets.
                let app = null;
                for (const el of document.querySelectorAll('[x-data]')) {
                    const a = el._x_dataStack ? el._x_dataStack[0] : null;
                    if (a && Array.isArray(a.blocks) && a.charWidth > 0) app = a;
                }
                if (app && Math.abs(br.width - app.charWidth * bw) > 0.5) return null;
                return {
                    container: {x: cr.x, y: cr.y},
                    cw: br.width / bw,
                    ch: br.height / bh,
                };
            }""",
            [block_id, block_w, block_h],
        )
        if metrics:
            break
        page.wait_for_timeout(100)
    assert metrics is not None
    return metrics


def _grid_point(metrics: dict, gx: float, gy: float) -> tuple[float, float]:
    """Grid cell (gx, gy) → client (x, y) pixel coordinates.

    The grid origin sits 16px inside the canvas container (the
    .render-wrapper padding).
    """
    return (
        metrics["container"]["x"] + 16 + gx * metrics["cw"],
        metrics["container"]["y"] + 16 + gy * metrics["ch"],
    )


def _marquee_select(page: Page, metrics: dict, x1: float, y1: float,
                    x2: float, y2: float) -> None:
    """Rubber-band select on the canvas from grid (x1,y1) to (x2,y2).

    The start point must be on empty canvas (no block under it) or the
    editor starts a block drag instead of a marquee.
    """
    sx, sy = _grid_point(metrics, x1, y1)
    ex, ey = _grid_point(metrics, x2, y2)
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(ex, ey, steps=10)
    page.mouse.up()


def test_marquee_selects_multiple_blocks(page: Page):
    """Dragging a rubber-band on the empty canvas selects every block fully
    inside it; the panel shows the count and the list/canvas highlight."""
    layout_id, (a_id, b_id) = _create_project_with_blocks(page, TWO_BOXES)

    metrics = _canvas_metrics(page, a_id, 10, 4)
    _marquee_select(page, metrics, 1, 1, 26, 8)

    panel = page.locator(".block-props")
    expect(panel).to_be_visible()
    expect(panel.locator(".block-props__type")).to_have_text("2 selected")
    expect(page.locator(".block-item--selected")).to_have_count(2)
    expect(page.locator(".block-preview--selected")).to_have_count(2)
    # The selection frame is the group's bounding box (spans both blocks)
    expect(page.locator(".block-selection")).to_be_visible()


def test_marquee_partial_overlap_not_selected(page: Page):
    """A block that the rubber-band only partially covers is NOT selected —
    the block must be fully inside the marquee."""
    layout_id, (a_id, b_id) = _create_project_with_blocks(page, TWO_BOXES)

    metrics = _canvas_metrics(page, a_id, 10, 4)
    # Marquee (1,1)→(5,5) overlaps A (2..12 × 2..6) but does not contain it
    _marquee_select(page, metrics, 1, 1, 5, 5)

    expect(page.locator(".block-item--selected")).to_have_count(0)
    expect(page.locator(".block-preview--selected")).to_have_count(0)


def test_shift_click_toggles_selection(page: Page):
    """Shift/Ctrl+click on a block toggles it in the selection without
    starting a drag.

    The rightmost block (B) is selected first so the floating properties
    panel opens to its right and does not cover the other block.
    """
    layout_id, (a_id, b_id) = _create_project_with_blocks(page, TWO_BOXES)

    # Click B → selects it alone
    page.locator(f'.block-preview[data-block-id="{b_id}"]').click()
    expect(page.locator(".block-item--selected")).to_have_count(1)
    expect(page.locator(".block-props__type")).to_have_text("box")

    # Shift+click A → adds it to the selection
    page.locator(f'.block-preview[data-block-id="{a_id}"]').click(modifiers=["Shift"])
    expect(page.locator(".block-item--selected")).to_have_count(2)
    expect(page.locator(".block-props__type")).to_have_text("2 selected")

    # Shift+click B again → removes it from the selection
    page.locator(f'.block-preview[data-block-id="{b_id}"]').click(modifiers=["Shift"])
    expect(page.locator(".block-item--selected")).to_have_count(1)
    expect(page.locator(".block-props__type")).to_have_text("box")


def test_group_move_drag_moves_all_selected(page: Page):
    """Dragging one block of a multi-selection moves the whole selection by
    the same delta (one batch update)."""
    layout_id, (a_id, b_id) = _create_project_with_blocks(page, TWO_BOXES)

    metrics = _canvas_metrics(page, a_id, 10, 4)
    _marquee_select(page, metrics, 1, 1, 26, 8)
    expect(page.locator(".block-item--selected")).to_have_count(2)

    # Drag block A by +5 cells right, +2 cells down
    a_box = page.locator(f'.block-preview[data-block-id="{a_id}"]').bounding_box()
    start_x = a_box["x"] + a_box["width"] / 2
    start_y = a_box["y"] + a_box["height"] / 2
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + 5 * metrics["cw"], start_y + 2 * metrics["ch"], steps=10)
    page.mouse.up()

    # Poll: the browser's batch request may still be in flight
    blocks = {}
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = {b["id"]: b for b in r.json()["blocks"]}
        a = blocks.get(a_id)
        if a and (a["x"], a["y"]) != (2, 2):
            break
        page.wait_for_timeout(100)
    a, b = blocks[a_id], blocks[b_id]
    # Both blocks moved by the same delta (rigid group move)
    assert a["x"] - 2 == b["x"] - 14
    assert a["y"] - 2 == b["y"] - 2
    assert a["x"] > 2 and a["y"] > 2  # a real move in the intended direction
    assert b["x"] - a["x"] == 12  # the 12-cell gap is preserved


def test_press_inside_selection_bbox_drags_group(page: Page):
    """Pressing inside the selection's bounding box — even on empty canvas
    between the blocks — drags the whole selection, not the block under the
    cursor (there is none in the gap)."""
    layout_id, (a_id, b_id) = _create_project_with_blocks(page, TWO_BOXES)

    metrics = _canvas_metrics(page, a_id, 10, 4)
    _marquee_select(page, metrics, 1, 1, 26, 8)
    expect(page.locator(".block-item--selected")).to_have_count(2)

    # Press in the gap between A (ends at x=12) and B (starts at x=14):
    # grid (13,4) is inside the selection bbox but on empty canvas.
    sx, sy = _grid_point(metrics, 13, 4)
    page.mouse.move(sx, sy)
    page.mouse.down()
    page.mouse.move(sx + 5 * metrics["cw"], sy + 2 * metrics["ch"], steps=10)
    page.mouse.up()

    # Poll: the browser's batch request may still be in flight
    blocks = {}
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = {b["id"]: b for b in r.json()["blocks"]}
        a = blocks.get(a_id)
        if a and (a["x"], a["y"]) != (2, 2):
            break
        page.wait_for_timeout(100)
    a, b = blocks[a_id], blocks[b_id]
    # Both blocks moved by the same delta (rigid group move)
    assert a["x"] - 2 == b["x"] - 14
    assert a["y"] - 2 == b["y"] - 2
    assert a["x"] > 2 and a["y"] > 2  # a real move in the intended direction
    assert b["x"] - a["x"] == 12  # the 12-cell gap is preserved


def test_click_inside_selection_bbox_keeps_group(page: Page):
    """A plain click inside the selection's bounding box (no drag) keeps the
    whole selection — it does not collapse to a single block."""
    layout_id, (a_id, b_id) = _create_project_with_blocks(page, TWO_BOXES)

    metrics = _canvas_metrics(page, a_id, 10, 4)
    _marquee_select(page, metrics, 1, 1, 26, 8)
    expect(page.locator(".block-item--selected")).to_have_count(2)

    # Click in the gap between the blocks (inside the bbox, empty canvas)
    sx, sy = _grid_point(metrics, 13, 4)
    page.mouse.click(sx, sy)

    # The selection is unchanged (both blocks still selected)
    expect(page.locator(".block-item--selected")).to_have_count(2)
    expect(page.locator(".block-props__type")).to_have_text("2 selected")


def test_delete_hotkey_deletes_group(page: Page):
    """The Delete key removes the whole multi-selection (one batch delete)."""
    layout_id, (a_id, b_id) = _create_project_with_blocks(page, TWO_BOXES)

    metrics = _canvas_metrics(page, a_id, 10, 4)
    _marquee_select(page, metrics, 1, 1, 26, 8)
    expect(page.locator(".block-item--selected")).to_have_count(2)

    page.on("dialog", lambda dialog: dialog.accept())
    page.keyboard.press("Delete")

    # Poll: the browser's batch request may still be in flight
    blocks = None
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = r.json()["blocks"]
        if blocks == []:
            break
        page.wait_for_timeout(100)
    assert blocks == []
    expect(page.locator(".block-preview")).to_have_count(0)
    expect(page.locator(".block-item")).to_have_count(0)


def test_panel_style_applies_to_all_selected(page: Page):
    """Changing the Line Style with a multi-selection applies it to every
    selected block (one batch update)."""
    layout_id, (a_id, b_id) = _create_project_with_blocks(page, TWO_BOXES)

    metrics = _canvas_metrics(page, a_id, 10, 4)
    _marquee_select(page, metrics, 1, 1, 26, 8)
    expect(page.locator(".block-props__type")).to_have_text("2 selected")

    panel = page.locator(".block-props")
    panel.locator(".style-btn[title='dotted']").click()

    # Poll: the browser's batch request may still be in flight
    blocks = {}
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = {b["id"]: b for b in r.json()["blocks"]}
        a, b = blocks.get(a_id), blocks.get(b_id)
        if a and b and a["border_style"] == "dotted" and b["border_style"] == "dotted":
            break
        page.wait_for_timeout(100)
    assert blocks[a_id]["border_style"] == "dotted"
    assert blocks[b_id]["border_style"] == "dotted"
    # The active style button reflects the shared style
    expect(panel.locator(".style-btn--active")).to_have_count(1)
    expect(panel.locator(".style-btn--active")).to_have_attribute("title", "dotted")


def test_group_duplicate_copies_all_selected(page: Page):
    """The Duplicate action copies every selected block with a one-cell
    offset; the copies become the new selection."""
    layout_id, (a_id, b_id) = _create_project_with_blocks(page, TWO_BOXES)

    metrics = _canvas_metrics(page, a_id, 10, 4)
    _marquee_select(page, metrics, 1, 1, 26, 8)
    expect(page.locator(".block-item--selected")).to_have_count(2)

    page.locator(".block-props .action-btn", has_text="Duplicate").click()

    # Poll: the browser's batch request may still be in flight
    blocks = []
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = r.json()["blocks"]
        if len(blocks) == 4:
            break
        page.wait_for_timeout(100)
    assert len(blocks) == 4
    orig_a = next(b for b in blocks if b["id"] == a_id)
    orig_b = next(b for b in blocks if b["id"] == b_id)
    copies = [b for b in blocks if b["id"] not in (a_id, b_id)]
    assert len(copies) == 2
    # Each copy is offset by one cell from its original, same size
    for orig in (orig_a, orig_b):
        copy = next(
            c for c in copies
            if (c["x"], c["y"]) == (orig["x"] + 1, orig["y"] + 1)
        )
        assert (copy["width"], copy["height"]) == (orig["width"], orig["height"])
    # The copies become the selected elements
    expect(page.locator(".block-item--selected")).to_have_count(2)


# ── Group drag ↔ container (re-parenting) ─────────────────
#
# Container C at (2,2) 24×12 and two blocks to its right:
# A at (30,4) 6×3, B at (30,9) 6×3.
GROUP_REPARENT = [
    {"block_type": "box", "x": 2, "y": 2, "width": 24, "height": 12},
    {"block_type": "box", "x": 30, "y": 4, "width": 6, "height": 3},
    {"block_type": "box", "x": 30, "y": 9, "width": 6, "height": 3},
]


def test_group_drag_into_box_reparents(page: Page):
    """Dragging a multi-selection into a box makes every block a child of
    the box (relative coordinates, one batch update)."""
    layout_id, (c_id, a_id, b_id) = _create_project_with_blocks(
        page, GROUP_REPARENT
    )

    metrics = _canvas_metrics(page, a_id, 6, 3)
    # Marquee over A and B only (C is to the left, outside the band)
    _marquee_select(page, metrics, 29, 3, 37, 13)
    expect(page.locator(".block-item--selected")).to_have_count(2)

    # Drag A 15 cells left — the group lands inside C
    a_box = page.locator(f'.block-preview[data-block-id="{a_id}"]').bounding_box()
    start_x = a_box["x"] + a_box["width"] / 2
    start_y = a_box["y"] + a_box["height"] / 2
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x - 15 * metrics["cw"], start_y, steps=10)
    page.mouse.up()

    # Poll: the browser's batch request may still be in flight
    blocks = {}
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = {b["id"]: b for b in r.json()["blocks"]}
        if blocks.get(a_id, {}).get("parent_id") == c_id:
            break
        page.wait_for_timeout(100)
    a, b = blocks[a_id], blocks[b_id]
    # Both blocks became children of the box
    assert a["parent_id"] == c_id
    assert b["parent_id"] == c_id
    # Relative to C's interior (C at (2,2) + 1-cell padding): A ≈ (12,1), B ≈ (12,6)
    assert abs(a["x"] - 12) <= 1 and abs(a["y"] - 1) <= 1
    assert abs(b["x"] - 12) <= 1 and abs(b["y"] - 6) <= 1
    # The rigid offset between the blocks is preserved
    assert b["x"] - a["x"] == 0
    assert b["y"] - a["y"] == 5


def test_group_drag_out_of_box_unparents(page: Page):
    """Dragging a multi-selection out of its container back onto the canvas
    un-parents every block (absolute coordinates, one batch update)."""
    layout_id, (c_id, a_id, b_id) = _create_project_with_blocks(page, [
        {"block_type": "box", "x": 2, "y": 2, "width": 24, "height": 12},
        {"block_type": "box", "x": 4, "y": 2, "width": 6, "height": 3, "parent_index": 0},
        {"block_type": "box", "x": 4, "y": 7, "width": 6, "height": 3, "parent_index": 0},
    ])

    # A and B are inside C — a marquee cannot start on them (the cursor
    # would hit C), so select with click + shift+click
    page.locator(f'.block-preview[data-block-id="{a_id}"]').click()
    expect(page.locator(".block-item--selected")).to_have_count(1)
    page.locator(f'.block-preview[data-block-id="{b_id}"]').click(modifiers=["Shift"])
    expect(page.locator(".block-item--selected")).to_have_count(2)

    metrics = _canvas_metrics(page, a_id, 6, 3)
    # Drag A 20 cells right — the group lands outside C
    a_box = page.locator(f'.block-preview[data-block-id="{a_id}"]').bounding_box()
    start_x = a_box["x"] + a_box["width"] / 2
    start_y = a_box["y"] + a_box["height"] / 2
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + 20 * metrics["cw"], start_y, steps=10)
    page.mouse.up()

    # Poll: the browser's batch request may still be in flight
    blocks = {}
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = {b["id"]: b for b in r.json()["blocks"]}
        a = blocks.get(a_id, {})
        if a.get("parent_id") is None and a.get("x", 0) > 20:
            break
        page.wait_for_timeout(100)
    a, b = blocks[a_id], blocks[b_id]
    # Both blocks are back on the canvas (absolute coordinates)
    assert a["parent_id"] is None
    assert b["parent_id"] is None
    assert abs(a["x"] - 27) <= 1 and abs(a["y"] - 5) <= 1
    assert abs(b["x"] - 27) <= 1 and abs(b["y"] - 10) <= 1
    assert b["x"] - a["x"] == 0
    assert b["y"] - a["y"] == 5


def test_group_move_with_nested_block_keeps_delta(page: Page):
    """Dragging a multi-selection that includes a block nested in a box
    moves the whole group by the mouse delta (regression: the delta was
    computed against the nested block's RELATIVE coordinates, so the group
    overshot by the container's offset)."""
    layout_id, (c_id, a_id, d_id) = _create_project_with_blocks(page, [
        {"block_type": "box", "x": 2, "y": 2, "width": 24, "height": 12},
        {"block_type": "box", "x": 4, "y": 2, "width": 6, "height": 3, "parent_index": 0},
        {"block_type": "box", "x": 30, "y": 5, "width": 6, "height": 3},
    ])

    # Click D (the rightmost block) first so the floating properties panel
    # opens to its right and does not cover A
    page.locator(f'.block-preview[data-block-id="{d_id}"]').click()
    expect(page.locator(".block-item--selected")).to_have_count(1)
    page.locator(f'.block-preview[data-block-id="{a_id}"]').click(modifiers=["Shift"])
    expect(page.locator(".block-item--selected")).to_have_count(2)

    metrics = _canvas_metrics(page, a_id, 6, 3)
    # Drag A 10 cells right — A stays inside C, D stays on the canvas
    a_box = page.locator(f'.block-preview[data-block-id="{a_id}"]').bounding_box()
    start_x = a_box["x"] + a_box["width"] / 2
    start_y = a_box["y"] + a_box["height"] / 2
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x + 10 * metrics["cw"], start_y, steps=10)
    page.mouse.up()

    # Poll: the browser's batch request may still be in flight
    blocks = {}
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = {b["id"]: b for b in r.json()["blocks"]}
        if blocks.get(d_id, {}).get("x", 0) > 35:
            break
        page.wait_for_timeout(100)
    a, d = blocks[a_id], blocks[d_id]
    # A moved by the mouse delta (10 cells) and stayed a child of C
    assert a["parent_id"] == c_id
    assert abs(a["x"] - 14) <= 1 and abs(a["y"] - 2) <= 1
    # D moved by the same delta on the canvas
    assert d["parent_id"] is None
    assert abs(d["x"] - 40) <= 1 and abs(d["y"] - 5) <= 1


# ── Static editor (no backend, in-memory store) ───────────


def test_static_editor_loads_and_renders(page: Page):
    """The static editor page loads and renders an empty canvas client-side."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    expect(page).to_have_title("boxframe — static editor")

    # Palette is populated from the built-in constants (no API call)
    expect(page.locator(".palette-btn")).to_have_count(14)

    # The canvas is rendered by the local JS renderer: an empty 80x24 grid
    expect(page.locator(".render-wrapper")).to_be_visible()
    expect(page.locator(".canvas-container .ascii-art")).to_be_visible()
    # Static editor: dimensions are considered unset — no bounds line
    expect(page.locator(".layout-bounds")).to_have_count(0)


def test_static_editor_adds_block_in_memory(page: Page):
    """Clicking a palette button adds a block via the in-memory store."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    expect(page.locator(".palette-btn")).to_have_count(14)

    page.locator(".palette-btn", has_text="box").click()

    # The block appears on the canvas (JS-rendered overlay) and in the list
    expect(page.locator(".block-preview")).to_have_count(1)
    expect(page.locator(".block-item")).to_have_count(1)
    expect(page.locator(".block-item__info strong")).to_have_text("box")

    # The ASCII preview contains the box border drawn by the JS renderer
    expect(page.locator(".canvas-container .ascii-art")).to_contain_text("┌")


def test_static_editor_block_not_shifted_when_not_at_top(page: Page):
    """Regression: the HTML parser strips the first newline right after a
    <pre> start tag, so when the art's first row is empty (topmost block
    not at y=0) the art lost its first row and shifted up one row relative
    to the block overlays. The canvas text must keep all leading rows."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    page.locator(".palette-btn", has_text="box").click()
    expect(page.locator(".block-preview")).to_have_count(1)

    # Move the block (added at (1,1)) to y=5 so rows 0-4 of the art are empty
    page.locator(".block-preview").click()
    panel = page.locator(".block-props")
    expect(panel).to_be_visible()
    y_input = panel.locator(".prop input").nth(1)
    y_input.fill("5")
    y_input.dispatch_event("change")
    page.wait_for_timeout(300)

    # The number of leading empty rows in the canvas text equals the block's y
    leading_empty = page.evaluate(
        "() => {"
        " const t = document.querySelector('.canvas-container .ascii-art').textContent;"
        " const rows = t.split('\\n');"
        " let i = 0;"
        " while (i < rows.length && rows[i].trim() === '') i++;"
        " return i;"
        "}"
    )
    assert leading_empty == 5


def test_static_editor_panel_matches_web_layout(page: Page):
    """The static editor's panel keeps the web layout: an actions row,
    Line Style buttons and X/Y/W/H in one row (the markup is duplicated
    in static/editor/index.html)."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    page.locator(".palette-btn", has_text="box").click()
    expect(page.locator(".block-preview")).to_have_count(1)

    page.locator(".block-preview").click()
    panel = page.locator(".block-props")
    expect(panel).to_be_visible()

    expect(panel.locator(".block-props__actions .action-btn")).to_have_count(3)
    expect(panel.locator(".style-btn")).to_have_count(5)

    boxes = [
        panel.locator(".prop-row input").nth(i).bounding_box()
        for i in range(4)
    ]
    assert all(b is not None for b in boxes)
    assert max(b["y"] for b in boxes) - min(b["y"] for b in boxes) <= 2
    lefts = [b["x"] for b in boxes]
    assert all(b2 > b1 for b1, b2 in zip(lefts, lefts[1:]))


def test_static_editor_delete_block_in_memory(page: Page):
    """Deleting a block in the static editor removes it from the canvas."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    page.locator(".palette-btn", has_text="box").click()
    expect(page.locator(".block-preview")).to_have_count(1)

    page.on("dialog", lambda dialog: dialog.accept())
    page.locator(".delete-block").click()

    expect(page.locator(".block-preview")).to_have_count(0)
    expect(page.locator(".block-item")).to_have_count(0)


def test_static_editor_persists_layout_in_localstorage(page: Page):
    """Blocks added in the static editor survive a page reload (localStorage)."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    page.locator(".palette-btn", has_text="box").click()
    expect(page.locator(".block-preview")).to_have_count(1)

    page.reload()
    expect(page.locator(".block-preview")).to_have_count(1)
    expect(page.locator(".block-item__info strong")).to_have_text("box")


def test_static_editor_clear_layout_with_confirmation(page: Page):
    """The Clear button asks for confirmation and removes all blocks."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    page.locator(".palette-btn", has_text="box").click()
    page.locator(".palette-btn", has_text="header").click()
    expect(page.locator(".block-preview")).to_have_count(2)

    # Dismissing the dialog keeps the layout intact
    page.once("dialog", lambda dialog: dialog.dismiss())
    page.locator(".clear-layout-btn").click()
    expect(page.locator(".block-preview")).to_have_count(2)

    # Accepting the dialog clears the layout
    page.once("dialog", lambda dialog: dialog.accept())
    page.locator(".clear-layout-btn").click()
    expect(page.locator(".block-preview")).to_have_count(0)
    expect(page.locator(".block-item")).to_have_count(0)

    # The cleared state survives a reload
    page.reload()
    expect(page.locator(".block-preview")).to_have_count(0)


def test_static_editor_undo_redo(page: Page):
    """Undo/Redo in the static editor: a palette-added block is removed by
    undo and restored by redo; a new action clears the redo stack."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    undo_btn = page.locator(".undo-btn")
    redo_btn = page.locator(".redo-btn")

    expect(undo_btn).to_be_disabled()
    expect(redo_btn).to_be_disabled()

    page.locator(".palette-btn", has_text="box").click()
    expect(page.locator(".block-preview")).to_have_count(1)
    expect(undo_btn).to_be_enabled()

    # Undo removes the block
    undo_btn.click()
    expect(page.locator(".block-preview")).to_have_count(0)
    expect(undo_btn).to_be_disabled()
    expect(redo_btn).to_be_enabled()

    # Redo restores it
    redo_btn.click()
    expect(page.locator(".block-preview")).to_have_count(1)
    expect(redo_btn).to_be_disabled()

    # A new action after redo clears the redo stack
    page.locator(".palette-btn", has_text="header").click()
    expect(page.locator(".block-preview")).to_have_count(2)
    expect(redo_btn).to_be_disabled()


# ── Import from a JSON file ───────────────────────────────


def test_static_editor_import_into_empty(page: Page):
    """Importing a JSON file into the empty static editor loads its blocks."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    expect(page.locator(".block-preview")).to_have_count(0)

    _import_file(page)

    # Both imported blocks appear on the canvas and in the list
    expect(page.locator(".block-preview")).to_have_count(2)
    expect(page.locator(".block-item")).to_have_count(2)
    types = page.locator(".block-item__info strong").all_inner_texts()
    assert sorted(types) == ["box", "button"]


def test_static_editor_import_add_when_not_empty(page: Page):
    """A non-empty editor asks on import; OK adds the file's blocks on top."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    page.locator(".palette-btn", has_text="box").click()
    expect(page.locator(".block-preview")).to_have_count(1)

    page.once("dialog", lambda d: d.accept())  # OK = add
    _import_file(page)

    # 1 existing + 2 imported = 3 blocks
    expect(page.locator(".block-preview")).to_have_count(3)
    expect(page.locator(".block-item")).to_have_count(3)


def test_static_editor_import_replace_when_not_empty(page: Page):
    """A non-empty editor asks on import; Cancel replaces all content."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    page.locator(".palette-btn", has_text="box").click()
    expect(page.locator(".block-preview")).to_have_count(1)

    page.once("dialog", lambda d: d.dismiss())  # Cancel = replace
    _import_file(page)

    # Only the 2 imported blocks remain
    expect(page.locator(".block-preview")).to_have_count(2)
    expect(page.locator(".block-item")).to_have_count(2)


def test_static_editor_import_invalid_json(page: Page):
    """A file that is not valid JSON is rejected with an alert (no blocks)."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    expect(page.locator(".block-preview")).to_have_count(0)

    page.once("dialog", lambda d: d.accept())  # the "not valid JSON" alert
    page.set_input_files(
        ".import-file-input",
        {"name": "bad.json", "mimeType": "application/json",
         "buffer": b"{not valid json"},
    )
    expect(page.locator(".block-preview")).to_have_count(0)


def test_web_editor_import_replaces_blocks(page: Page):
    """Importing into a non-empty web editor replaces the blocks (Cancel)."""
    layout_id, _ = _create_project_with_block(page)

    page.once("dialog", lambda d: d.dismiss())  # Cancel = replace
    _import_file(page)

    blocks = None
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = r.json()["blocks"]
        if len(blocks) == 2:
            break
        page.wait_for_timeout(100)
    assert blocks is not None and len(blocks) == 2
    assert sorted(b["block_type"] for b in blocks) == ["box", "button"]


def test_web_editor_import_adds_blocks(page: Page):
    """Accepting the import prompt adds the file's blocks on top (OK)."""
    layout_id, existing_id = _create_project_with_block(page)

    page.once("dialog", lambda d: d.accept())  # OK = add
    _import_file(page)

    blocks = None
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = r.json()["blocks"]
        if len(blocks) == 3:
            break
        page.wait_for_timeout(100)
    assert blocks is not None and len(blocks) == 3
    # The original block survives the add
    assert any(b["id"] == existing_id for b in blocks)


# ── Container (box) nesting: drag re-parenting ────────────


def _wait_block(page: Page, layout_id: str, block_id: str, predicate) -> dict:
    """Poll the layout until the given block satisfies predicate (the
    browser's PUT may still be in flight after a drag)."""
    block = None
    for _ in range(30):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        block = next(b for b in r.json()["blocks"] if b["id"] == block_id)
        if predicate(block):
            return block
        page.wait_for_timeout(100)
    return block


def test_drag_block_into_box_reparents(page: Page):
    """Dragging a block so its center lands inside a box re-parents it: the
    block becomes the box's child with coordinates relative to the box."""
    specs = [
        {"block_type": "box", "x": 0, "y": 0, "width": 30, "height": 10},  # container
        {"block_type": "button", "x": 40, "y": 20, "width": 10, "height": 2,
         "content": "Go"},  # free block, outside the container
    ]
    layout_id, (box_id, free_id) = _create_project_with_blocks(page, specs)
    metrics = _canvas_metrics(page, box_id, 30, 10)

    # Grab the free block at its center (40,20) 10×2 → (45, 21) and drop it
    # so its top-left lands at grid (5, 3): center (10, 4) is inside the box.
    start = _grid_point(metrics, 45, 21)
    end = _grid_point(metrics, 10, 4)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=12)
    page.mouse.up()

    block = _wait_block(
        page, layout_id, free_id,
        lambda b: b["parent_id"] == box_id,
    )
    assert block["parent_id"] == box_id
    # Relative to the box at (0,0): abs (5, 3) → rel (5 - 1, 3 - 1)
    assert (block["x"], block["y"]) == (4, 2)


def test_drag_child_out_of_box_unparents(page: Page):
    """Dragging a child out of its box onto the canvas un-parents it: the
    block returns to the root with absolute coordinates."""
    specs = [
        {"block_type": "box", "x": 0, "y": 0, "width": 30, "height": 10},  # container
        {"block_type": "button", "x": 2, "y": 2, "width": 10, "height": 2,
         "content": "Go", "parent_index": 0},  # child inside the box
    ]
    layout_id, (box_id, child_id) = _create_project_with_blocks(page, specs)
    metrics = _canvas_metrics(page, box_id, 30, 10)

    # The child is at relative (2, 2) → absolute (3, 3), 10×2 → center (8, 4).
    # Drag it so its top-left lands at grid (40, 20): center (45, 21) is
    # outside the box → un-parent.
    start = _grid_point(metrics, 8, 4)
    end = _grid_point(metrics, 45, 21)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=12)
    page.mouse.up()

    block = _wait_block(
        page, layout_id, child_id,
        lambda b: b["parent_id"] is None and b["x"] > 30,
    )
    assert block["parent_id"] is None
    assert (block["x"], block["y"]) == (40, 20)


# ── Drop-target highlight (the box that will become the parent) ──


def test_drag_block_highlights_drop_target(page: Page):
    """While dragging a block over a box that will become its parent, the
    box is highlighted; the highlight is removed on mouseup."""
    specs = [
        {"block_type": "box", "x": 0, "y": 0, "width": 30, "height": 10},  # container
        {"block_type": "button", "x": 40, "y": 20, "width": 10, "height": 2,
         "content": "Go"},
    ]
    layout_id, (box_id, free_id) = _create_project_with_blocks(page, specs)
    metrics = _canvas_metrics(page, box_id, 30, 10)

    # Grab the free block at its center (45, 21) and drag it so its top-left
    # lands at grid (5, 3): center (10, 4) is inside the box.
    start = _grid_point(metrics, 45, 21)
    end = _grid_point(metrics, 10, 4)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=12)

    # Mid-drag: the container box is highlighted as the drop target
    expect(page.locator(f'.block-preview[data-block-id="{box_id}"]')) \
        .to_have_class(re.compile(r"block-preview--drop-target"))
    expect(page.locator(".block-preview--drop-target")).to_have_count(1)

    page.mouse.up()

    # The highlight is cleared after the drop...
    expect(page.locator(".block-preview--drop-target")).to_have_count(0)
    # ...and the block became the box's child
    block = _wait_block(
        page, layout_id, free_id,
        lambda b: b["parent_id"] == box_id,
    )
    assert block["parent_id"] == box_id


def test_drag_block_no_highlight_outside_box(page: Page):
    """Dragging a block over the empty canvas (no box under its center)
    shows no drop-target highlight."""
    specs = [
        {"block_type": "box", "x": 0, "y": 0, "width": 30, "height": 10},
        {"block_type": "button", "x": 40, "y": 20, "width": 10, "height": 2,
         "content": "Go"},
    ]
    layout_id, (box_id, free_id) = _create_project_with_blocks(page, specs)
    metrics = _canvas_metrics(page, box_id, 30, 10)

    # Drag the free block further away from the box
    start = _grid_point(metrics, 45, 21)
    end = _grid_point(metrics, 55, 21)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=12)

    expect(page.locator(".block-preview--drop-target")).to_have_count(0)

    page.mouse.up()
    expect(page.locator(".block-preview--drop-target")).to_have_count(0)


def test_group_drag_highlights_drop_target(page: Page):
    """While dragging a multi-selection over a box that will become the
    blocks' parent, the box is highlighted; cleared on mouseup."""
    layout_id, (c_id, a_id, b_id) = _create_project_with_blocks(
        page, GROUP_REPARENT
    )

    metrics = _canvas_metrics(page, a_id, 6, 3)
    _marquee_select(page, metrics, 29, 3, 37, 13)
    expect(page.locator(".block-item--selected")).to_have_count(2)

    # Drag A 15 cells left — the group lands inside C
    a_box = page.locator(f'.block-preview[data-block-id="{a_id}"]').bounding_box()
    start_x = a_box["x"] + a_box["width"] / 2
    start_y = a_box["y"] + a_box["height"] / 2
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(start_x - 15 * metrics["cw"], start_y, steps=10)

    # Mid-drag: C is highlighted as the drop target for the group
    expect(page.locator(f'.block-preview[data-block-id="{c_id}"]')) \
        .to_have_class(re.compile(r"block-preview--drop-target"))
    expect(page.locator(".block-preview--drop-target")).to_have_count(1)

    page.mouse.up()
    expect(page.locator(".block-preview--drop-target")).to_have_count(0)

    # Poll: the browser's batch request may still be in flight
    blocks = {}
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        blocks = {b["id"]: b for b in r.json()["blocks"]}
        if blocks.get(a_id, {}).get("parent_id") == c_id:
            break
        page.wait_for_timeout(100)
    assert blocks[a_id]["parent_id"] == c_id


def test_static_palette_drag_highlights_drop_target(page: Page):
    """Dragging a palette button over a box highlights the box that will
    become the new block's parent (synthetic HTML5 drag events)."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    page.locator(".palette-btn", has_text="box").click()
    expect(page.locator(".block-preview")).to_have_count(1)

    box_id = page.locator(".block-preview").get_attribute("data-block-id")
    metrics = _canvas_metrics(page, box_id, 20, 3)
    # The box is at (1,1) 20×3; a button (16×1) dropped at grid (5,2) has
    # its center (13, 2.5) inside the box.
    x, y = _grid_point(metrics, 5.5, 2.5)

    page.evaluate(
        """(args) => {
            const [x, y] = args;
            const dt = new DataTransfer();
            const btn =
                document.querySelector('.palette-btn[data-block-type="button"]');
            btn.dispatchEvent(new DragEvent('dragstart', {
                bubbles: true, cancelable: true, dataTransfer: dt,
            }));
            const canvas = document.querySelector('.canvas-container');
            canvas.dispatchEvent(new DragEvent('dragover', {
                bubbles: true, cancelable: true, dataTransfer: dt,
                clientX: x, clientY: y,
            }));
        }""",
        [x, y],
    )

    expect(page.locator(f'.block-preview[data-block-id="{box_id}"]')) \
        .to_have_class(re.compile(r"block-preview--drop-target"))
    expect(page.locator(".block-preview--drop-target")).to_have_count(1)

    # Leaving the canvas clears the highlight
    page.evaluate(
        """() => {
            const canvas = document.querySelector('.canvas-container');
            canvas.dispatchEvent(new DragEvent('dragleave', {bubbles: true}));
        }"""
    )
    expect(page.locator(".block-preview--drop-target")).to_have_count(0)

    # End the synthetic drag to reset the editor's drag state
    page.evaluate(
        """() => {
            const btn =
                document.querySelector('.palette-btn[data-block-type="button"]');
            btn.dispatchEvent(new DragEvent('dragend', {bubbles: true}));
        }"""
    )


# ── Copy selection to the clipboard ───────────────────────


def test_panel_copy_selection_to_clipboard(page: Page):
    """The Copy action in the properties panel copies the selected block(s)
    with their children to the clipboard as pseudo-graphic text anchored at
    (0,0) — the child is not selected but comes along with its parent."""
    specs = [
        {"block_type": "box", "x": 2, "y": 2, "width": 20, "height": 4,
         "content": "Old"},
        {"block_type": "button", "x": 2, "y": 1, "width": 10, "height": 1,
         "content": "Go", "border_style": "dashed", "parent_index": 0},
    ]
    layout_id, (box_id, child_id) = _create_project_with_blocks(page, specs)

    page.context.grant_permissions(["clipboard-read", "clipboard-write"])

    # Select the box: click its top border row (grid (3, 2.5)) — inside the
    # box but outside the child button (absolute (5, 4)), so the hit-test
    # picks the box, not the child.
    metrics = _canvas_metrics(page, box_id, 20, 4)
    x, y = _grid_point(metrics, 3, 2.5)
    page.mouse.click(x, y)
    expect(page.locator(".block-item--selected")).to_have_count(1)

    page.locator(".block-props .action-btn", has_text="Copy").click()
    expect(page.locator(".copy-selection-btn")).to_have_text("Copied!")

    # Poll: the clipboard write may still be in flight
    text = ""
    for _ in range(20):
        text = page.evaluate("navigator.clipboard.readText()")
        if text:
            break
        page.wait_for_timeout(100)
    assert text == (
        "┌──────────────────┐\n"
        "│Old               │\n"
        "│  [Go      ]      │\n"
        "└──────────────────┘"
    )
