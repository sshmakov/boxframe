"""
End-to-end tests for the layout editor using Playwright.

Requires a running server at http://127.0.0.1:8000.
Run with: pytest tests/e2e/ -v --asyncio-mode=auto
"""

from playwright.sync_api import Page, expect


BASE_URL = "http://127.0.0.1:8000"


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
