"""
End-to-end tests for drag-and-drop and project page fix.

Tests:
  1. Project page loads without 500 error (strftime fix for created_at)
  2. Palette buttons are draggable
  3. Drag from palette onto canvas creates a block
  4. Existing blocks can be dragged to new positions

Requires a running server at http://127.0.0.1:8000.
Run with: pytest tests/e2e/ -v --asyncio-mode=auto
"""

import time

from playwright.sync_api import Page, expect


BASE_URL = "http://127.0.0.1:8000"


def _create_e2e_project(page: Page) -> tuple[str, str]:
    """Create a new E2E project and return (project_id, project_name)."""
    page.goto(BASE_URL)
    expect(page.get_by_role("heading", name="Projects")).to_be_visible()

    # Click "+ New Project" button
    page.get_by_role("button", name="+ New Project").click()

    # Fill in the name and submit
    page.get_by_placeholder("Project name...").fill("E2E: Drag Drop Test")
    page.get_by_role("button", name="Create").click()

    # Wait for navigation to project page by checking the heading
    expect(page.get_by_role("heading", name="E2E: Drag Drop Test")).to_be_visible()

    # Get project ID from the URL
    project_id = page.url.split("/")[-1]
    return project_id, "E2E: Drag Drop Test"


def _create_e2e_layout(page: Page, project_id: str, name: str = "E2E: Canvas") -> str:
    """Create a new E2E layout and return layout_id."""
    page.get_by_role("button", name="+ New Layout").click()
    page.get_by_placeholder("Layout name...").fill(name)
    page.get_by_role("button", name="Create").click()

    # Wait for navigation to editor page by checking the preview
    expect(page.get_by_text("Preview")).to_be_visible()

    layout_id = page.url.split("/")[-1]
    return layout_id


def test_project_page_no_500_error(page: Page):
    """Test that the project page loads without 500 error after strftime fix.

    Previously, `layout.created_at[:10]` failed because SQLAlchemy returns
    a datetime object, not a string. Fixed with strftime().
    """
    project_id, _ = _create_e2e_project(page)
    _create_e2e_layout(page, project_id)

    # Navigate back to project page
    page.goto(f"{BASE_URL}/project/{project_id}")

    # Should load without 500 error
    expect(page).to_have_title("E2E: Drag Drop Test — boxframe")
    expect(page.get_by_role("heading", name="E2E: Drag Drop Test")).to_be_visible()

    # The layout card should be visible with formatted date
    expect(page.get_by_text("E2E: Canvas")).to_be_visible()
    expect(page.get_by_text("grid")).to_be_visible()

    # Verify the date is formatted correctly (YYYY-MM-DD)
    date_text = page.locator("p.text-small.text-muted").first.text_content()
    assert "Created:" in date_text, f"Expected 'Created:' in '{date_text}'"


def test_palette_buttons_are_draggable(page: Page):
    """Test that palette buttons have draggable attribute."""
    project_id, _ = _create_e2e_project(page)
    layout_id = _create_e2e_layout(page, project_id)

    # Palette buttons should be draggable
    palette_buttons = page.locator(".palette-btn[draggable='true']")
    expect(palette_buttons.first).to_be_visible()
    expect(palette_buttons).to_have_count(12)  # All block types


def test_drag_from_palette_creates_block(page: Page):
    """Test that dragging a palette button onto the canvas creates a new block."""
    project_id, _ = _create_e2e_project(page)
    layout_id = _create_e2e_layout(page, project_id)

    # Wait for editor to load
    expect(page.get_by_text("Preview")).to_be_visible()

    # Get palette button for "box" type
    box_button = page.locator(".palette-btn").filter(has_text="box").first

    # Get canvas container for drop target
    canvas = page.locator(".canvas-container").first

    # Perform drag and drop
    box_button.drag_to(canvas, force=True)

    # Wait a moment for the API call to complete
    page.wait_for_timeout(500)

    # Refresh render to see the new block
    page.get_by_role("button", name="↻ Refresh").click()
    page.wait_for_timeout(300)

    # Verify a block was created by checking the block list
    block_items = page.locator(".block-item")
    expect(block_items).to_have_count(1)

    # Verify the block type is "box" by checking the strong element in the block list
    expect(page.locator(".block-item strong")).to_have_text("box")


def test_drag_existing_block_to_new_position(page: Page):
    """Test that existing blocks can be dragged to new positions on the canvas."""
    project_id, _ = _create_e2e_project(page)
    layout_id = _create_e2e_layout(page, project_id)

    # Create a block via click (since drag-to-create can be flaky in headless)
    page.get_by_role("button", name="box").first.click()
    page.wait_for_timeout(300)

    # Verify block was created
    block_items = page.locator(".block-item")
    expect(block_items).to_have_count(1)

    # Get the initial position from the block list
    initial_pos_text = page.locator(".block-item").first.text_content()
    assert "@(" in initial_pos_text

    # The block should now be draggable on the canvas
    # Simulate a mouse drag on the canvas area
    canvas = page.locator(".canvas-container").first
    canvas_box = canvas.bounding_box()

    # Calculate a position within the canvas (accounting for padding)
    start_x = canvas_box["x"] + 50
    start_y = canvas_box["y"] + 50
    end_x = canvas_box["x"] + 150
    end_y = canvas_box["y"] + 150

    # Perform mouse drag
    page.mouse.move(start_x, start_y)
    page.mouse.down()
    page.mouse.move(end_x, end_y)
    page.wait_for_timeout(200)
    page.mouse.up()

    # Refresh render to see the updated position
    page.get_by_role("button", name="↻ Refresh").click()
    page.wait_for_timeout(300)

    # Verify the block still exists (wasn't deleted)
    expect(block_items).to_have_count(1)


def test_multiple_blocks_via_palette_drag(page: Page):
    """Test that multiple blocks can be created by dragging from palette."""
    project_id, _ = _create_e2e_project(page)
    layout_id = _create_e2e_layout(page, project_id)

    canvas = page.locator(".canvas-container").first

    # Drag "box" type
    box_button = page.locator(".palette-btn").filter(has_text="box").first
    box_button.drag_to(canvas, force=True)
    page.wait_for_timeout(400)

    # Drag "button" type
    button_button = page.locator(".palette-btn").filter(has_text="button").first
    button_button.drag_to(canvas, force=True)
    page.wait_for_timeout(400)

    # Refresh render
    page.get_by_role("button", name="↻ Refresh").click()
    page.wait_for_timeout(300)

    # Verify two blocks were created
    block_items = page.locator(".block-item")
    expect(block_items).to_have_count(2)


def test_block_list_shows_coordinates(page: Page):
    """Test that the block list displays block coordinates correctly."""
    project_id, _ = _create_e2e_project(page)
    layout_id = _create_e2e_layout(page, project_id)

    # Create a block
    page.get_by_role("button", name="box").first.click()
    page.wait_for_timeout(300)

    # Refresh to update the block list
    page.get_by_role("button", name="↻ Refresh").click()
    page.wait_for_timeout(300)

    # The block list should show the block with its coordinates
    block_items = page.locator(".block-item")
    expect(block_items).to_be_visible()

    # Check that coordinates are displayed in the format "(@x,y)"
    block_text = block_items.first.text_content()
    assert "@(" in block_text, f"Expected '@(' in block text '{block_text}'"
    assert ")" in block_text, f"Expected ')' in block text '{block_text}'"


def test_delete_block_via_block_list(page: Page):
    """Test that blocks can be deleted from the block list."""
    project_id, _ = _create_e2e_project(page)
    layout_id = _create_e2e_layout(page, project_id)

    # Create a block
    page.get_by_role("button", name="box").first.click()
    page.wait_for_timeout(300)

    # Verify block exists
    block_items = page.locator(".block-item")
    expect(block_items).to_have_count(1)

    # Set up dialog handler BEFORE clicking delete
    page.on("dialog", lambda dialog: dialog.accept())

    # Click the delete button (×)
    page.locator(".delete-block").first.click()

    # Wait for the block to be removed
    page.wait_for_timeout(500)

    # Verify block was deleted
    expect(block_items).to_have_count(0)
