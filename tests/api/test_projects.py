"""
API tests for projects endpoints.
"""

import pytest
from fastapi.testclient import TestClient


def test_create_project(client: TestClient):
    """Test creating a new project."""
    r = client.post("/api/projects/", json={"name": "Test Project"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Test Project"
    assert "id" in data
    assert "created_at" in data
    assert "updated_at" in data


def test_create_project_empty_name(client: TestClient):
    """Test that empty project name is rejected."""
    r = client.post("/api/projects/", json={"name": ""})
    assert r.status_code == 422


def test_list_projects(client: TestClient):
    """Test listing all projects."""
    # Create a project first
    client.post("/api/projects/", json={"name": "List Test"})

    r = client.get("/api/projects/")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert data[0]["name"] == "List Test"


def test_get_project(client: TestClient):
    """Test getting a single project."""
    r = client.post("/api/projects/", json={"name": "Get Test"})
    project_id = r.json()["id"]

    r = client.get(f"/api/projects/{project_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == project_id
    assert data["name"] == "Get Test"


def test_get_project_not_found(client: TestClient):
    """Test getting a non-existent project."""
    r = client.get("/api/projects/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


def test_delete_project(client: TestClient):
    """Test deleting a project."""
    r = client.post("/api/projects/", json={"name": "Delete Me"})
    project_id = r.json()["id"]

    r = client.delete(f"/api/projects/{project_id}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    # Verify it's gone
    r = client.get(f"/api/projects/{project_id}")
    assert r.status_code == 404


def test_project_info(client: TestClient):
    """Test project info endpoint."""
    r = client.post("/api/projects/", json={"name": "Info Test"})
    project_id = r.json()["id"]

    r = client.get(f"/api/projects/{project_id}/info")
    assert r.status_code == 200
    data = r.json()
    assert data["project"]["id"] == project_id
    assert data["project"]["name"] == "Info Test"
    assert "block_types" in data
    assert "border_styles" in data
    assert "layouts" in data


def test_project_name_max_length(client: TestClient):
    """Test project name length validation."""
    long_name = "a" * 256
    r = client.post("/api/projects/", json={"name": long_name})
    assert r.status_code == 422


def test_rename_project(client: TestClient):
    """Test renaming a project."""
    r = client.post("/api/projects/", json={"name": "Rename Me"})
    project_id = r.json()["id"]

    r = client.put(f"/api/projects/{project_id}", json={"name": "Renamed Project"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Renamed Project"
    assert data["id"] == project_id

    # Persisted
    r = client.get(f"/api/projects/{project_id}")
    assert r.json()["name"] == "Renamed Project"


def test_rename_project_not_found(client: TestClient):
    """Test renaming a non-existent project."""
    r = client.put("/api/projects/nonexistent-id", json={"name": "Whatever"})
    assert r.status_code == 404


def test_rename_project_empty_name(client: TestClient):
    """Test that renaming with missing name returns 400."""
    r = client.post("/api/projects/", json={"name": "Empty Rename"})
    project_id = r.json()["id"]
    r = client.put(f"/api/projects/{project_id}", json={})
    assert r.status_code == 400


def test_duplicate_project(client: TestClient):
    """Test duplicating a project deep-copies layouts and blocks."""
    r = client.post("/api/projects/", json={"name": "Source Project"})
    project_id = r.json()["id"]

    r = client.post(f"/api/projects/{project_id}/layouts", json={
        "name": "Source Layout", "width": 40, "height": 12,
    })
    layout_id = r.json()["id"]

    # Parent + child block
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 5, "y": 3, "width": 20, "height": 10,
        "content": "parent",
    })
    parent_id = r.json()["id"]
    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "button", "x": 2, "y": 1, "width": 8, "height": 1,
        "content": "OK", "parent_id": parent_id,
    })

    # Duplicate the whole project
    r = client.post(f"/api/projects/{project_id}/duplicate", json={"name": "Copied Project"})
    assert r.status_code == 200
    new = r.json()
    assert new["id"] != project_id
    assert new["name"] == "Copied Project"

    # The copy has one layout with the same name but a new id.
    info = client.get(f"/api/projects/{new['id']}/info").json()
    assert len(info["layouts"]) == 1
    new_layout = info["layouts"][0]
    assert new_layout["id"] != layout_id
    assert new_layout["name"] == "Source Layout"

    # The copied layout carries both blocks with the hierarchy rebuilt.
    layout = client.get(f"/api/layouts/{new_layout['id']}").json()
    assert layout["width"] == 40
    assert layout["height"] == 12
    blocks = layout["blocks"]
    assert len(blocks) == 2
    parent_block = next(b for b in blocks if b["block_type"] == "box")
    child_block = next(b for b in blocks if b["block_type"] == "button")
    assert child_block["parent_id"] == parent_block["id"]
    assert parent_block["id"] != parent_id

    # Source project is untouched.
    src_info = client.get(f"/api/projects/{project_id}/info").json()
    assert [l["id"] for l in src_info["layouts"]] == [layout_id]


def test_duplicate_project_not_found(client: TestClient):
    """Test duplicating a non-existent project."""
    r = client.post("/api/projects/nonexistent-id/duplicate", json={"name": "X"})
    assert r.status_code == 404


def test_duplicate_project_empty_name(client: TestClient):
    """Test that duplicating with an empty name is rejected."""
    r = client.post("/api/projects/", json={"name": "Dup Empty"})
    project_id = r.json()["id"]
    r = client.post(f"/api/projects/{project_id}/duplicate", json={"name": ""})
    assert r.status_code == 422


# ── Export / import ────────────────────────────────────────

def _seed_project(client: TestClient, name: str = "Export Source") -> str:
    """Create a project with one layout, a parent box and a nested button."""
    r = client.post("/api/projects/", json={"name": name})
    project_id = r.json()["id"]
    r = client.post(f"/api/projects/{project_id}/layouts", json={
        "name": "Main", "width": 40, "height": 12,
    })
    layout_id = r.json()["id"]
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 5, "y": 3, "width": 20, "height": 10,
        "content": "parent",
    })
    parent_id = r.json()["id"]
    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "button", "x": 2, "y": 1, "width": 8, "height": 1,
        "content": "OK", "parent_id": parent_id,
    })
    return project_id


def _strip_ids(obj):
    """Recursively drop every 'id' key so two exports compare structurally."""
    if isinstance(obj, dict):
        return {k: _strip_ids(v) for k, v in obj.items() if k != "id"}
    if isinstance(obj, list):
        return [_strip_ids(x) for x in obj]
    return obj


def test_export_project(client: TestClient):
    """Export a project as JSON with the nested layout/block tree."""
    project_id = _seed_project(client)

    r = client.get(f"/api/projects/{project_id}/export")
    assert r.status_code == 200
    assert "attachment;" in r.headers.get("content-disposition", "")

    data = r.json()
    assert data["kind"] == "boxframe.project"
    assert data["format_version"] == 1
    assert data["name"] == "Export Source"
    assert len(data["layouts"]) == 1

    layout = data["layouts"][0]
    assert layout["name"] == "Main"
    assert layout["width"] == 40 and layout["height"] == 12
    # Root block carries the child nested inside it.
    assert len(layout["blocks"]) == 1
    root = layout["blocks"][0]
    assert root["type"] == "box"
    assert len(root["children"]) == 1
    assert root["children"][0]["type"] == "button"


def test_export_project_not_found(client: TestClient):
    """Exporting a non-existent project returns 404."""
    r = client.get("/api/projects/00000000-0000-0000-0000-000000000000/export")
    assert r.status_code == 404


def test_import_project(client: TestClient):
    """Importing a project file creates a fresh copy with new ids."""
    payload = {
        "kind": "boxframe.project",
        "format_version": 1,
        "name": "Imported",
        "layouts": [
            {
                "name": "L1", "width": 30, "height": 8,
                "blocks": [
                    {
                        "id": "old-parent-id", "type": "box",
                        "x": 1, "y": 2, "width": 15, "height": 6,
                        "content": "p", "border_style": "solid",
                        "metadata": {"text_align": "center"}, "order": 1,
                        "children": [
                            {
                                "id": "old-child-id", "type": "text",
                                "x": 0, "y": 0, "width": 5, "height": 1,
                                "content": "hi", "border_style": "none",
                                "metadata": {}, "order": 2, "children": [],
                            }
                        ],
                    }
                ],
            }
        ],
    }

    r = client.post("/api/projects/import", json=payload)
    assert r.status_code == 200
    new = r.json()
    assert new["name"] == "Imported"

    info = client.get(f"/api/projects/{new['id']}/info").json()
    assert len(info["layouts"]) == 1
    layout_id = info["layouts"][0]["id"]

    layout = client.get(f"/api/layouts/{layout_id}").json()
    assert layout["width"] == 30 and layout["height"] == 8
    blocks = layout["blocks"]
    assert len(blocks) == 2
    parent = next(b for b in blocks if b["block_type"] == "box")
    child = next(b for b in blocks if b["block_type"] == "text")
    # Hierarchy rebuilt with fresh ids (file's ids are ignored).
    assert child["parent_id"] == parent["id"]
    assert parent["id"] not in ("old-parent-id", "old-child-id")
    assert child["id"] not in ("old-parent-id", "old-child-id")
    # Geometry, meta, order and border preserved as-is.
    assert parent["x"] == 1 and parent["y"] == 2 and parent["order"] == 1
    assert parent["meta"] == {"text_align": "center"}
    assert child["border_style"] == "none"


def test_project_export_import_round_trip(client: TestClient):
    """export -> import -> export is structurally identical (ids aside)."""
    project_id = _seed_project(client, name="Roundtrip")
    first = client.get(f"/api/projects/{project_id}/export").json()

    r = client.post("/api/projects/import", json=first)
    assert r.status_code == 200
    new_id = r.json()["id"]

    second = client.get(f"/api/projects/{new_id}/export").json()
    assert _strip_ids(first) == _strip_ids(second)


def test_import_project_bad_kind(client: TestClient):
    """Importing a payload that isn't a project file is rejected."""
    r = client.post("/api/projects/import", json={"kind": "not.a.project", "layouts": []})
    assert r.status_code == 400


def test_import_project_missing_kind(client: TestClient):
    """A layout file (no project 'kind') cannot be imported as a project."""
    r = client.post("/api/projects/import", json={"name": "X", "blocks": []})
    assert r.status_code == 400
