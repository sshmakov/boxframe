"""
End-to-end tests for project pages using Playwright.

Requires a running server at http://127.0.0.1:8000.
Run with: pytest tests/e2e/ -v --asyncio-mode=auto
"""

from playwright.sync_api import Page, expect


BASE_URL = "http://127.0.0.1:8000"


def test_index_page_loads(page: Page):
    """Test that the index page loads successfully."""
    page.goto(BASE_URL)
    expect(page).to_have_title("Projects — boxframe")
    expect(page.get_by_role("heading", name="Projects")).to_be_visible()


def test_new_project_button(page: Page):
    """Test that the 'New Project' button toggles the form."""
    page.goto(BASE_URL)
    
    # Form should be hidden initially
    expect(page.get_by_placeholder("Project name...")).not_to_be_visible()
    
    # Click "New Project"
    page.get_by_role("button", name="+ New Project").click()
    
    # Form should be visible
    expect(page.get_by_placeholder("Project name...")).to_be_visible()


def test_delete_button_exists(page: Page):
    """Test that delete buttons exist on project cards."""
    page.goto(BASE_URL)
    
    # Delete buttons should exist in the DOM
    delete_buttons = page.locator("button.btn-danger")
    count = delete_buttons.count()
    assert count > 0, f"Expected at least 1 delete button, got {count}"
