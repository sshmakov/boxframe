"""
Shared fixtures for e2e tests.

Provides page-state cleanup and database cleanup after each test so UI
state (open modals, filled forms) and test data never leak between tests.
"""

import pytest
import requests
from playwright.sync_api import Page

BASE_URL = "http://127.0.0.1:8000"


@pytest.fixture(autouse=True)
def reset_page_state(page: Page):
    """Reset page state after each test.

    Navigates to the index page and closes any open Alpine.js dropdowns
    (e.g. the "+ New Project" form left open by a test) so subsequent
    tests start from a clean slate.
    """
    yield
    # Navigate away to reset all UI state
    page.goto(BASE_URL)
    # Close any open dropdowns / forms by pressing Escape
    page.keyboard.press("Escape")
    # Small wait for any animations to settle
    page.wait_for_timeout(200)


@pytest.fixture(autouse=True)
def cleanup_db(page: Page):
    """Delete E2E test data from the database after each test.

    Calls ``DELETE /api/test/cleanup`` which removes all projects,
    layouts, and blocks whose names start with ``E2E: ``.
    """
    yield
    try:
        requests.delete(f"{BASE_URL}/api/test/cleanup", timeout=5)
    except requests.RequestException:
        # Server may not be running — skip silently
        pass
