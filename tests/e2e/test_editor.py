"""
End-to-end tests for the layout editor using Playwright.

Requires a running server at http://127.0.0.1:8000.
Run with: pytest tests/e2e/ -v --asyncio-mode=auto
"""

import re

import requests
from playwright.sync_api import Page, expect


BASE_URL = "http://127.0.0.1:8000"


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

    # Semi-transparent selection frame with action icons appears on the canvas
    selection = page.locator(".block-selection")
    expect(selection).to_be_visible()
    expect(selection.locator(".sel-icon--dup")).to_be_visible()
    expect(selection.locator(".sel-icon--del")).to_be_visible()
    expect(selection.locator(".sel-resize")).to_be_visible()

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


def test_duplicate_icon_creates_block_copy(page: Page):
    """The duplicate icon on the selection frame creates a copy of the block."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()
    page.locator(".block-selection .sel-icon--dup").click()

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


def test_delete_icon_removes_block(page: Page):
    """The delete icon on the selection frame deletes the selected block."""
    layout_id, block_id = _create_project_with_block(page)

    page.on("dialog", lambda dialog: dialog.accept())

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()
    page.locator(".block-selection .sel-icon--del").click()

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
    # The style select reflects the current border style
    expect(panel.locator("select")).to_have_value("solid")


def test_properties_panel_updates_border_style(page: Page):
    """Changing the style in the properties panel persists to the database."""
    layout_id, block_id = _create_project_with_block(page)

    page.locator(f'.block-preview[data-block-id="{block_id}"]').click()
    panel = page.locator(".block-props")
    expect(panel).to_be_visible()

    panel.locator("select").select_option("dashed")

    # Poll: the browser's PUT may still be in flight
    block = None
    for _ in range(20):
        r = requests.get(f"{BASE_URL}/api/layouts/{layout_id}", timeout=5)
        block = next(b for b in r.json()["blocks"] if b["id"] == block_id)
        if block["border_style"] == "dashed":
            break
        page.wait_for_timeout(100)
    assert block["border_style"] == "dashed"


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


def test_static_editor_delete_block_in_memory(page: Page):
    """Deleting a block in the static editor removes it from the canvas."""
    page.goto(f"{BASE_URL}/static/editor/index.html")
    page.locator(".palette-btn", has_text="box").click()
    expect(page.locator(".block-preview")).to_have_count(1)

    page.on("dialog", lambda dialog: dialog.accept())
    page.locator(".delete-block").click()

    expect(page.locator(".block-preview")).to_have_count(0)
    expect(page.locator(".block-item")).to_have_count(0)
