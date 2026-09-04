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
