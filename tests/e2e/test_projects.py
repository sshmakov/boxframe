"""
End-to-end tests for project pages using Playwright.

Requires a running server at http://127.0.0.1:8000.
Run with: pytest tests/e2e/ -v --asyncio-mode=auto
"""

import re

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


def test_new_layout_button_toggles_form(page: Page):
    """Test that the 'New Layout' button toggles the form on the project page."""
    # Create a project via the UI first
    page.goto(BASE_URL)
    expect(page).to_have_title("Projects — boxframe")

    # Open the "New Project" form
    page.get_by_role("button", name="+ New Project").click()
    expect(page.get_by_placeholder("Project name...")).to_be_visible()

    # Fill and submit the project form
    page.get_by_placeholder("Project name...").fill("E2E: Layout Test")
    page.get_by_role("button", name="Create").click()

    # Should redirect to the project page
    expect(page).to_have_title("E2E: Layout Test — boxframe")
    expect(page.get_by_role("heading", name="E2E: Layout Test")).to_be_visible()

    # Layout form should be hidden initially (x-cloak)
    expect(page.get_by_placeholder("Layout name...")).not_to_be_visible()

    # Click "New Layout"
    page.get_by_role("button", name="+ New Layout").click()

    # Form should be visible
    expect(page.get_by_placeholder("Layout name...")).to_be_visible()
    expect(page.get_by_placeholder("Width (80)")).to_be_visible()
    expect(page.get_by_placeholder("Height (24)")).to_be_visible()


def test_new_layout_submit_creates_layout(page: Page):
    """Test that submitting the 'New Layout' form creates a layout and redirects."""
    # Create a project via the UI first
    page.goto(BASE_URL)
    expect(page).to_have_title("Projects — boxframe")

    # Open the "New Project" form
    page.get_by_role("button", name="+ New Project").click()
    expect(page.get_by_placeholder("Project name...")).to_be_visible()

    # Fill and submit the project form
    page.get_by_placeholder("Project name...").fill("E2E: Layout Create Test")
    page.get_by_role("button", name="Create").click()

    # Should redirect to the project page
    expect(page).to_have_title("E2E: Layout Create Test — boxframe")

    # Open the "New Layout" form
    page.get_by_role("button", name="+ New Layout").click()

    # Fill in the form
    page.get_by_placeholder("Layout name...").fill("My First Layout")
    page.get_by_placeholder("Width (80)").fill("40")
    page.get_by_placeholder("Height (24)").fill("12")

    # Submit the form
    page.get_by_role("button", name="Create").click()

    # Should redirect to the layout editor page
    expect(page).to_have_url(re.compile(f"{BASE_URL}/layout/[0-9a-f-]+"))
