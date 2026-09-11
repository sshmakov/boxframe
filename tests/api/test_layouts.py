"""
API tests for layouts endpoints.
"""

import asyncio

from fastapi.testclient import TestClient

import boxframe.database as db_module
from boxframe.models.block import Block


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


async def _get_block(block_id: str) -> Block | None:
    """Helper: fetch a block directly from the test database."""
    async with db_module.async_session() as session:
        return await session.get(Block, block_id)


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


def test_create_layout_without_dimensions(client: TestClient):
    """Width and height are optional — a layout can be created without them."""
    r = client.post("/api/projects/", json={"name": "Optional Dims Test"})
    project_id = r.json()["id"]

    r = client.post(f"/api/layouts/{project_id}/layouts", json={"name": "No Dims"})
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "No Dims"
    assert data["width"] is None
    assert data["height"] is None


def test_create_layout_with_single_dimension(client: TestClient):
    """Only one of width/height can be set."""
    r = client.post("/api/projects/", json={"name": "Single Dim Test"})
    project_id = r.json()["id"]

    r = client.post(f"/api/layouts/{project_id}/layouts", json={
        "name": "Width Only",
        "width": 40,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 40
    assert data["height"] is None

    r = client.post(f"/api/layouts/{project_id}/layouts", json={
        "name": "Height Only",
        "height": 12,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] is None
    assert data["height"] == 12


def test_get_layout(client: TestClient):
    """Test getting a layout."""
    _, layout_id = _create_project_with_layout(client)

    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "Test Layout"


def test_get_layout_returns_blocks(client: TestClient):
    """Test that GET /api/layouts/{id} returns the blocks list."""
    _, layout_id = _create_project_with_layout(client)

    # Create a block
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 20, "height": 5,
        "content": "Test block",
    })
    assert r.status_code == 200

    # Fetch layout and verify blocks are in the response
    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    data = r.json()
    assert "blocks" in data
    assert isinstance(data["blocks"], list)
    assert len(data["blocks"]) == 1
    assert data["blocks"][0]["block_type"] == "box"
    assert data["blocks"][0]["content"] == "Test block"


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


def test_clear_layout_blocks(client: TestClient):
    """DELETE /api/layouts/{id}/blocks removes all blocks, keeps the layout."""
    _, layout_id = _create_project_with_layout(client)

    # Add blocks including a nested child
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 30, "height": 10,
    })
    parent_id = r.json()["id"]
    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text",
        "x": 1, "y": 1, "width": 10, "height": 2,
        "parent_id": parent_id,
    })
    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 3,
    })

    r = client.delete(f"/api/layouts/{layout_id}/blocks")
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["deleted"] == 3

    # Layout still exists, but its blocks are gone
    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    assert r.json()["blocks"] == []

    # Render still works on the now-empty layout
    r = client.get(f"/api/layouts/{layout_id}/render")
    assert r.status_code == 200


def test_clear_layout_blocks_not_found(client: TestClient):
    """Clearing a non-existent layout returns 404."""
    r = client.delete("/api/layouts/00000000-0000-0000-0000-000000000000/blocks")
    assert r.status_code == 404


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
    # The art layer is a <div class="ascii-art">, not a <pre>: the HTML
    # parser strips the first newline right after a <pre> start tag, which
    # would drop the first row when the art starts with an empty row.
    assert '<div class="ascii-art"' in data["html"]
    assert "white-space: pre" in data["html"]
    assert "<pre" not in data["html"]


def test_render_empty_layout(client: TestClient):
    """Test rendering a layout without blocks."""
    _, layout_id = _create_project_with_layout(client)

    r = client.get(f"/api/layouts/{layout_id}/render")
    assert r.status_code == 200
    data = r.json()
    assert "ascii" in data


def test_render_layout_with_block_outside_bounds(client: TestClient):
    """Blocks outside the layout bounds are fully rendered."""
    _, layout_id = _create_project_with_layout(client)  # 40×12

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 35, "y": 9, "width": 10, "height": 4,
        "content": "Outside",
    })
    assert r.status_code == 200

    r = client.get(f"/api/layouts/{layout_id}/render")
    assert r.status_code == 200
    data = r.json()
    # ASCII canvas is the 80×24 default floor — the full box is visible
    assert "Outside" in data["ascii"]
    assert "┘" in data["ascii"]
    # The layout has dimensions (40×12) — the bounds overlay is drawn
    assert 'class="layout-bounds layout-bounds--v"' in data["html"]
    assert 'class="layout-bounds layout-bounds--h"' in data["html"]


def test_render_without_dimensions_has_no_bounds(client: TestClient):
    """A layout without dimensions renders without the bounds overlay."""
    r = client.post("/api/projects/", json={"name": "No Bounds Render"})
    project_id = r.json()["id"]

    r = client.post(f"/api/layouts/{project_id}/layouts", json={"name": "No Dims"})
    layout_id = r.json()["id"]

    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 3,
        "content": "Fit",
    })

    r = client.get(f"/api/layouts/{layout_id}/render")
    assert r.status_code == 200
    data = r.json()
    assert "Fit" in data["ascii"]
    assert 'class="layout-bounds"' not in data["html"]


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


def test_export_has_no_trailing_empty_lines(client: TestClient):
    """Exported text has no trailing empty lines (layout 40×12, box ends at row 2)."""
    _, layout_id = _create_project_with_layout(client)

    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 3,
        "content": "Export",
    })

    r = client.get(f"/api/layouts/{layout_id}/export")
    assert r.status_code == 200
    data = r.json()
    # ASCII: exactly 3 rows (the box), no blank tail
    lines = data["ascii"].split("\n")
    assert len(lines) == 3
    assert lines[-1].rstrip() != ""
    # Markdown: the fenced block ends right after the last art row
    assert data["markdown"].endswith("┘\n```")


def test_delete_layout(client: TestClient):
    """Test deleting a layout."""
    project_id, layout_id = _create_project_with_layout(client)

    # Add a block so we can verify cascade deletion
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 3,
    })
    block_id = r.json()["id"]

    r = client.delete(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 404

    # Block must be cascade-deleted along with the layout
    block = asyncio.get_event_loop().run_until_complete(_get_block(block_id))
    assert block is None


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

    # Zero size is rejected
    r = client.post(f"/api/layouts/{project_id}/layouts", json={
        "name": "Bad",
        "width": 0,
    })
    assert r.status_code == 422

    # No upper limit — large layouts are allowed
    r = client.post(f"/api/layouts/{project_id}/layouts", json={
        "name": "Big",
        "width": 500,
        "height": 200,
    })
    assert r.status_code == 200
    assert r.json()["width"] == 500
    assert r.json()["height"] == 200


# ── Order tests ─────────────────────────────────────────────


def test_create_block_auto_order(client: TestClient):
    """Blocks without explicit order get sequential order on the server.

    Server assigns MAX(order)+1 when order=0 (default), so first block
    gets order=1, second gets order=2, etc.
    """
    _, layout_id = _create_project_with_layout(client)

    # Create 3 blocks without sending order (server assigns MAX+1)
    for i in range(3):
        r = client.post(f"/api/layouts/{layout_id}/blocks", json={
            "block_type": "box",
            "x": 0, "y": i, "width": 10, "height": 2,
        })
        assert r.status_code == 200

    # Fetch layout and verify unique sequential orders (1, 2, 3)
    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    orders = [b["order"] for b in r.json()["blocks"]]
    assert sorted(orders) == [1, 2, 3]


def test_create_block_explicit_order(client: TestClient):
    """Explicit order is respected."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 10, "height": 2,
        "order": 10,
    })
    assert r.status_code == 200
    assert r.json()["order"] == 10

    # Next block without explicit order should get max + 1
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 1, "width": 10, "height": 2,
    })
    assert r.status_code == 200
    assert r.json()["order"] == 11


def test_normalize_block_orders_on_load(client: TestClient):
    """When all blocks share the same order, get_layout assigns sequential.

    Simulates old blocks created before order feature — they all have order=0.
    get_layout detects this and normalizes to 0, 1, 2...
    """
    _, layout_id = _create_project_with_layout(client)

    # Create blocks with explicit order=0 (simulating old blocks)
    # Note: create_block converts order=0 to MAX+1, so we need to
    # directly set order=0 via update to simulate pre-existing blocks.
    for i in range(3):
        r = client.post(f"/api/layouts/{layout_id}/blocks", json={
            "block_type": "box",
            "x": 0, "y": i, "width": 10, "height": 2,
            "order": 0,  # Will be converted to 1, 2, 3 by create_block
        })
        assert r.status_code == 200
        block_id = r.json()["id"]
        # Force order back to 0 to simulate old blocks
        client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={"order": 0})

    # Fetch layout — orders should be normalized to 0, 1, 2
    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    orders = [b["order"] for b in r.json()["blocks"]]
    assert sorted(orders) == [0, 1, 2]
    # All orders should be unique now
    assert len(orders) == len(set(orders))


def test_normalize_does_not_touch_unique_orders(client: TestClient):
    """Blocks with all-unique orders are not normalized."""
    _, layout_id = _create_project_with_layout(client)

    # Create first block (gets order=1 by default)
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 2,
    })
    block_id = r.json()["id"]
    # Force order to 0 to simulate old block
    client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={"order": 0})

    # Create second block with explicit order=5
    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 1, "width": 10, "height": 2, "order": 5,
    })

    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    orders = [b["order"] for b in r.json()["blocks"]]
    assert sorted(orders) == [0, 5]  # Unchanged — all unique


def test_normalize_with_duplicates(client: TestClient):
    """Blocks with duplicate orders are normalized to sequential values."""
    _, layout_id = _create_project_with_layout(client)

    # Create 3 blocks — orders auto-assigned: 1, 2, 3
    r1 = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 2,
    })
    r2 = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 1, "width": 10, "height": 2,
    })
    r3 = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 2, "width": 10, "height": 2,
    })

    # Force first and second blocks to order=0 to create duplicates
    client.put(f"/api/layouts/{layout_id}/blocks/{r1.json()['id']}", json={"order": 0})
    client.put(f"/api/layouts/{layout_id}/blocks/{r2.json()['id']}", json={"order": 0})

    # Now DB orders are [0, 0, 3] — duplicates exist
    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    orders = [b["order"] for b in r.json()["blocks"]]
    assert sorted(orders) == [0, 1, 2]  # Normalized to sequential
    assert len(orders) == len(set(orders))  # All unique


# ── Line thickness tests ────────────────────────────────────


def test_create_hline_height_forced_to_one(client: TestClient):
    """hline is always 1 cell tall, regardless of the requested height."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "hline",
        "x": 0, "y": 0, "width": 15, "height": 4,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["height"] == 1
    assert data["width"] == 15  # long dimension is not affected


def test_update_hline_height_stays_one(client: TestClient):
    """hline height cannot be changed via update; width can."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "hline",
        "x": 0, "y": 0, "width": 10, "height": 1,
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "height": 5,
    })
    assert r.status_code == 200
    assert r.json()["height"] == 1

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "width": 30,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 30
    assert data["height"] == 1


def test_create_vline_width_forced_to_one(client: TestClient):
    """vline is always 1 cell wide, regardless of the requested width."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "vline",
        "x": 0, "y": 0, "width": 4, "height": 10,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 1
    assert data["height"] == 10  # long dimension is not affected


def test_update_vline_width_stays_one(client: TestClient):
    """vline width cannot be changed via update; height can."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "vline",
        "x": 0, "y": 0, "width": 1, "height": 5,
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "width": 5,
    })
    assert r.status_code == 200
    assert r.json()["width"] == 1

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "height": 10,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["height"] == 10
    assert data["width"] == 1


# ── Batch replace tests (undo/redo support) ─────────────────


def test_replace_layout_blocks(client: TestClient):
    """PUT /api/layouts/{id}/blocks replaces the full block set.

    Given block ids are preserved (undo/redo restores block identity),
    blocks without an id get a new one.
    """
    _, layout_id = _create_project_with_layout(client)

    # Existing blocks: a parent with a nested child
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 30, "height": 10,
    })
    old_parent_id = r.json()["id"]
    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text", "x": 1, "y": 1, "width": 10, "height": 2,
        "parent_id": old_parent_id,
    })

    r = client.put(f"/api/layouts/{layout_id}/blocks", json={
        "blocks": [
            {"id": old_parent_id, "block_type": "box", "x": 2, "y": 3,
             "width": 12, "height": 4, "content": "kept", "order": 1},
            {"block_type": "button", "x": 0, "y": 0, "width": 8, "height": 1,
             "content": "New", "order": 2},
        ],
    })
    assert r.status_code == 200
    data = r.json()
    assert len(data["blocks"]) == 2
    by_id = {b["id"]: b for b in data["blocks"]}
    # The old id survived the replace
    assert old_parent_id in by_id
    assert by_id[old_parent_id]["x"] == 2
    assert by_id[old_parent_id]["content"] == "kept"
    # The new block got a generated id
    new = [b for b in data["blocks"] if b["id"] != old_parent_id][0]
    assert new["block_type"] == "button"
    assert new["id"]


def test_replace_layout_blocks_with_nested_child(client: TestClient):
    """A replace payload can contain nested blocks (parent_id)."""
    _, layout_id = _create_project_with_layout(client)

    r = client.put(f"/api/layouts/{layout_id}/blocks", json={
        "blocks": [
            {"block_type": "box", "x": 0, "y": 0, "width": 20, "height": 6, "order": 1},
        ],
    })
    parent_id = r.json()["blocks"][0]["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks", json={
        "blocks": [
            {"id": parent_id, "block_type": "box", "x": 0, "y": 0,
             "width": 20, "height": 6, "order": 1},
            {"block_type": "text", "x": 1, "y": 1, "width": 10, "height": 2,
             "content": "child", "parent_id": parent_id, "order": 2},
        ],
    })
    assert r.status_code == 200
    data = r.json()
    assert len(data["blocks"]) == 2
    child = [b for b in data["blocks"] if b["block_type"] == "text"][0]
    assert child["parent_id"] == parent_id


def test_replace_layout_blocks_empty(client: TestClient):
    """An empty blocks list clears the layout; the layout itself is kept."""
    _, layout_id = _create_project_with_layout(client)
    client.post(f"/api/layouts/{layout_id}/blocks", json={"block_type": "box"})

    r = client.put(f"/api/layouts/{layout_id}/blocks", json={"blocks": []})
    assert r.status_code == 200
    assert r.json()["blocks"] == []

    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    assert r.json()["blocks"] == []


def test_replace_layout_blocks_not_found(client: TestClient):
    """Replacing blocks of a non-existent layout returns 404."""
    r = client.put(
        "/api/layouts/00000000-0000-0000-0000-000000000000/blocks",
        json={"blocks": []},
    )
    assert r.status_code == 404


def test_replace_layout_blocks_normalizes_lines(client: TestClient):
    """hline/vline keep their 1-cell thickness in a replace payload."""
    _, layout_id = _create_project_with_layout(client)

    r = client.put(f"/api/layouts/{layout_id}/blocks", json={
        "blocks": [
            {"block_type": "hline", "x": 0, "y": 0, "width": 15, "height": 4},
            {"block_type": "vline", "x": 0, "y": 0, "width": 4, "height": 10},
        ],
    })
    assert r.status_code == 200
    by_type = {b["block_type"]: b for b in r.json()["blocks"]}
    assert by_type["hline"]["height"] == 1
    assert by_type["hline"]["width"] == 15
    assert by_type["vline"]["width"] == 1
    assert by_type["vline"]["height"] == 10
