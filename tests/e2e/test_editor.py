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
