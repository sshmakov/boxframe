"""
API tests for layouts endpoints.
"""

from fastapi.testclient import TestClient


def _create_project_with_layout(client: TestClient) -> tuple[str, str]:
    """Helper: create a project and return its ID."""
    r = client.post("/api/projects/", json={"name": "Layout Test"})
    project_id = r.json()["id"]

    r = client.post(f"/api/layouts/{project_id}/layouts", json={
        "name": "Test Layout",
        "width": 40,
        "height": 12,
    })
    layout_id = r.json()["id"]
    return project_id, layout_id


def test_create_layout(client: TestClient):
    """Test creating a layout."""
    r = client.post("/api/projects/", json={"name": "Create Layout Test"})
    project_id = r.json()["id"]

    r = client.post(f"/api/layouts/{project_id}/layouts", json={
        "name": "My Layout",
        "width": 60,
        "height": 20,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "My Layout"
    assert data["width"] == 60
    assert data["height"] == 20


def test_get_layout(client: TestClient):
    """Test getting a layout."""
    _, layout_id = _create_project_with_layout(client)

    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Test Layout"


def test_get_layout_not_found(client: TestClient):
    """Test getting a non-existent layout."""
    r = client.get("/api/layouts/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_create_block(client: TestClient):
    """Test creating a block."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0,
        "y": 0,
        "width": 20,
        "height": 5,
        "content": "Hello",
        "border_style": "solid",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["block_type"] == "box"
    assert data["content"] == "Hello"
    assert data["meta"] == {}


def test_create_block_with_parent(client: TestClient):
    """Test creating a nested block."""
    _, layout_id = _create_project_with_layout(client)

    # Create parent block
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 30, "height": 10,
    })
    parent_id = r.json()["id"]

    # Create child block
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text",
        "x": 1, "y": 1, "width": 10, "height": 2,
        "content": "Child",
        "parent_id": parent_id,
    })
    assert r.status_code == 200
    assert r.json()["parent_id"] == parent_id


def test_update_block(client: TestClient):
    """Test updating a block."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 3,
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "content": "Updated",
    })
    assert r.status_code == 200
    assert r.json()["content"] == "Updated"


def test_delete_block(client: TestClient):
    """Test deleting a block."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 3,
    })
    block_id = r.json()["id"]

    r = client.delete(f"/api/layouts/{layout_id}/blocks/{block_id}")
    assert r.status_code == 200

    # Verify block is gone by checking render still works (no crash)
    r = client.get(f"/api/layouts/{layout_id}/render")
    assert r.status_code == 200


def test_render_layout(client: TestClient):
    """Test rendering a layout to ASCII."""
    _, layout_id = _create_project_with_layout(client)

    # Add a block so render has something to draw
    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 3,
        "content": "Test",
    })

    r = client.get(f"/api/layouts/{layout_id}/render")
    assert r.status_code == 200
    data = r.json()
    assert "ascii" in data
    assert "html" in data
    assert "Test" in data["ascii"]


def test_render_empty_layout(client: TestClient):
    """Test rendering a layout without blocks."""
    _, layout_id = _create_project_with_layout(client)

    r = client.get(f"/api/layouts/{layout_id}/render")
    assert r.status_code == 200
    data = r.json()
    assert "ascii" in data


def test_export_layout(client: TestClient):
    """Test exporting a layout."""
    _, layout_id = _create_project_with_layout(client)

    # Add a block
    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 3,
        "content": "Export",
    })

    r = client.get(f"/api/layouts/{layout_id}/export")
    assert r.status_code == 200
    data = r.json()
    assert "layout_json" in data
    assert "markdown" in data
    assert "ascii" in data
    assert data["layout_json"]["name"] == "Test Layout"


def test_delete_layout(client: TestClient):
    """Test deleting a layout."""
    project_id, layout_id = _create_project_with_layout(client)

    r = client.delete(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 404


def test_delete_project_cascades(client: TestClient):
    """Test that deleting a project also deletes its layouts and blocks."""
    r = client.post("/api/projects/", json={"name": "Cascade Test"})
    project_id = r.json()["id"]

    r = client.post(f"/api/layouts/{project_id}/layouts", json={
        "name": "Cascade Layout",
    })
    layout_id = r.json()["id"]

    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 3,
    })

    client.delete(f"/api/projects/{project_id}")

    # Layout should be gone too
    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 404


def test_layout_validation(client: TestClient):
    """Test layout dimension validation."""
    r = client.post("/api/projects/", json={"name": "Validation Test"})
    project_id = r.json()["id"]

    # Width too small
    r = client.post(f"/api/layouts/{project_id}/layouts", json={
        "name": "Bad",
        "width": 10,  # min is 20
    })
    assert r.status_code == 422
