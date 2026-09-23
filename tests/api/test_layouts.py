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


def test_render_nested_three_levels_html_preview(client: TestClient):
    """The HTML preview nests children at arbitrary depth (box in box in box).

    Every block gets its own .block-preview div — including a grandchild two
    levels deep — and each container clips its children (overflow:hidden).
    """
    _, layout_id = _create_project_with_layout(client)
    parent_id, child_id, grandchild_id = _create_nested(client, layout_id)

    r = client.get(f"/api/layouts/{layout_id}/render")
    assert r.status_code == 200
    html = r.json()["html"]
    # All three blocks are present, the grandchild included
    assert html.count('class="block-preview"') == 3
    assert f'data-block-id="{parent_id}"' in html
    assert f'data-block-id="{child_id}"' in html
    assert f'data-block-id="{grandchild_id}"' in html
    # The containers clip their children
    assert "overflow:hidden" in html


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


def test_export_nested_three_levels(client: TestClient):
    """Export nests children at arbitrary depth — a grandchild is not lost."""
    _, layout_id = _create_project_with_layout(client)
    parent_id, child_id, grandchild_id = _create_nested(client, layout_id)

    r = client.get(f"/api/layouts/{layout_id}/export")
    assert r.status_code == 200
    data = r.json()["layout_json"]

    assert len(data["blocks"]) == 1
    root = data["blocks"][0]
    assert root["id"] == parent_id
    assert [c["id"] for c in root["children"]] == [child_id]
    assert [c["id"] for c in root["children"][0]["children"]] == [grandchild_id]


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


# ── Text autosize tests ─────────────────────────────────────


def test_create_text_default_border_none(client: TestClient):
    """A text block created without border_style has no border."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text",
        "x": 0, "y": 0,
        "content": "hi",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["border_style"] == "none"


def test_create_box_default_border_solid(client: TestClient):
    """The type-specific default does not leak: other types stay solid."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0,
    })
    assert r.status_code == 200
    assert r.json()["border_style"] == "solid"


def test_create_text_autosizes_to_content(client: TestClient):
    """A new text block is sized to fit its content; requested w/h are ignored."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text",
        "x": 0, "y": 0, "width": 50, "height": 5,
        "content": "hi",
    })
    assert r.status_code == 200
    data = r.json()
    # "hi", no border → 2×1
    assert data["width"] == 2
    assert data["height"] == 1


def test_create_text_autosizes_with_border(client: TestClient):
    """The border is included in the fit size (one cell on each side)."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text",
        "x": 0, "y": 0,
        "content": "hi",
        "border_style": "solid",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 4
    assert data["height"] == 3


def test_create_text_empty_content_is_one_cell(client: TestClient):
    """Empty content: the minimum 1×1 (no border)."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text",
        "x": 0, "y": 0,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 1
    assert data["height"] == 1


def test_update_text_content_autosizes(client: TestClient):
    """Editing the content re-fits the block (multi-line included)."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text",
        "x": 0, "y": 0,
        "content": "hi",
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "content": "hello\nworld",
    })
    assert r.status_code == 200
    data = r.json()
    # "hello\nworld", no border → 5×2
    assert data["width"] == 5
    assert data["height"] == 2


def test_update_text_border_autosizes(client: TestClient):
    """Toggling the border re-fits the block (the border is included)."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text",
        "x": 0, "y": 0,
        "content": "hi",
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "border_style": "double",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 4
    assert data["height"] == 3

    # Back to none — the border cells are released
    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "border_style": "none",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 2
    assert data["height"] == 1


def test_update_text_manual_resize_kept(client: TestClient):
    """A plain size update is a manual resize — it is kept until the next
    content/border change re-fits the block."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text",
        "x": 0, "y": 0,
        "content": "hi",
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "width": 10, "height": 3,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 10
    assert data["height"] == 3

    # Position-only updates do not re-fit either
    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "x": 5,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["x"] == 5
    assert data["width"] == 10
    assert data["height"] == 3

    # The next content change snaps back to the fit size
    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "content": "hey",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["width"] == 3
    assert data["height"] == 1


def test_update_block_type_to_text_autosizes(client: TestClient):
    """Changing a block's type to text re-fits it to its content."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box",
        "x": 0, "y": 0, "width": 20, "height": 5,
        "content": "hi",
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "block_type": "text",
    })
    assert r.status_code == 200
    data = r.json()
    # "hi" + the box's solid border → 4×3
    assert data["width"] == 4
    assert data["height"] == 3


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


# ── Batch operations tests (multi-selection support) ─────


def test_batch_blocks_create_update_delete(client: TestClient):
    """POST /api/layouts/{id}/blocks/batch applies create/update/delete
    in a single request (backs the editor's multi-selection edits)."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 3,
    })
    a_id = r.json()["id"]
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 12, "y": 0, "width": 10, "height": 3,
    })
    b_id = r.json()["id"]

    r = client.post(f"/api/layouts/{layout_id}/blocks/batch", json={
        "create": [
            {"block_type": "button", "x": 0, "y": 8, "width": 8, "height": 1,
             "content": "Go"},
        ],
        "update": [
            {"id": a_id, "x": 5},
            {"id": b_id, "border_style": "dashed"},
        ],
        "delete": [b_id],
    })
    assert r.status_code == 200
    data = r.json()
    assert len(data["created"]) == 1
    assert data["created"][0]["block_type"] == "button"
    assert len(data["updated"]) == 1
    assert data["updated"][0]["id"] == a_id
    assert data["updated"][0]["x"] == 5
    assert data["deleted"] == [b_id]

    # The layout reflects all three operations
    r = client.get(f"/api/layouts/{layout_id}")
    blocks = r.json()["blocks"]
    assert len(blocks) == 2
    by_id = {b["id"]: b for b in blocks}
    assert by_id[a_id]["x"] == 5
    assert b_id not in by_id
    created = [b for b in blocks if b["block_type"] == "button"][0]
    assert created["content"] == "Go"


def test_batch_blocks_auto_order(client: TestClient):
    """Created blocks without an explicit order get sequential orders
    after the current maximum."""
    _, layout_id = _create_project_with_layout(client)
    client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 3,
    })

    r = client.post(f"/api/layouts/{layout_id}/blocks/batch", json={
        "create": [
            {"block_type": "box", "x": 0, "y": 5, "width": 10, "height": 3},
            {"block_type": "box", "x": 12, "y": 5, "width": 10, "height": 3},
        ],
    })
    assert r.status_code == 200
    orders = sorted(b["order"] for b in r.json()["created"])
    assert orders == [2, 3]


def test_batch_blocks_normalizes_lines(client: TestClient):
    """hline/vline keep their 1-cell thickness in batch create/update."""
    _, layout_id = _create_project_with_layout(client)
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "hline", "x": 0, "y": 0, "width": 20, "height": 1,
    })
    line_id = r.json()["id"]

    r = client.post(f"/api/layouts/{layout_id}/blocks/batch", json={
        "create": [
            {"block_type": "vline", "x": 0, "y": 0, "width": 4, "height": 10},
        ],
        "update": [
            {"id": line_id, "height": 5, "width": 30},
        ],
    })
    assert r.status_code == 200
    created = r.json()["created"][0]
    assert created["width"] == 1
    assert created["height"] == 10
    updated = r.json()["updated"][0]
    assert updated["height"] == 1
    assert updated["width"] == 30


def test_batch_blocks_normalizes_text(client: TestClient):
    """Text blocks autosize in batch create; a content update re-fits,
    a plain size update is kept (manual resize)."""
    _, layout_id = _create_project_with_layout(client)
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text", "x": 0, "y": 0, "content": "hi",
    })
    text_id = r.json()["id"]

    r = client.post(f"/api/layouts/{layout_id}/blocks/batch", json={
        "create": [
            {"block_type": "text", "x": 0, "y": 5, "width": 40, "height": 4,
             "content": "abc"},
        ],
        "update": [
            {"id": text_id, "content": "abcd"},
        ],
    })
    assert r.status_code == 200
    created = r.json()["created"][0]
    # "abc", no border → 3×1 (the requested 40×4 is ignored)
    assert created["width"] == 3
    assert created["height"] == 1
    assert created["border_style"] == "none"
    # The content update re-fitted: "abcd", no border → 4×1
    updated = r.json()["updated"][0]
    assert updated["width"] == 4
    assert updated["height"] == 1

    # A plain size update is a manual resize — kept
    r = client.post(f"/api/layouts/{layout_id}/blocks/batch", json={
        "update": [
            {"id": text_id, "width": 12, "height": 2},
        ],
    })
    assert r.status_code == 200
    updated = r.json()["updated"][0]
    assert updated["width"] == 12
    assert updated["height"] == 2


def test_batch_blocks_ignores_unknown_ids(client: TestClient):
    """Unknown ids in update/delete are skipped, not an error."""
    _, layout_id = _create_project_with_layout(client)
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 3,
    })
    block_id = r.json()["id"]

    r = client.post(f"/api/layouts/{layout_id}/blocks/batch", json={
        "update": [
            {"id": "no-such-block", "x": 99},
            {"id": block_id, "x": 7},
        ],
        "delete": ["no-such-block"],
    })
    assert r.status_code == 200
    data = r.json()
    assert len(data["updated"]) == 1
    assert data["updated"][0]["id"] == block_id
    assert data["updated"][0]["x"] == 7
    assert data["deleted"] == []


def test_batch_blocks_empty_payload(client: TestClient):
    """An empty payload is a no-op."""
    _, layout_id = _create_project_with_layout(client)
    client.post(f"/api/layouts/{layout_id}/blocks", json={"block_type": "box"})

    r = client.post(f"/api/layouts/{layout_id}/blocks/batch", json={})
    assert r.status_code == 200
    data = r.json()
    assert data["created"] == []
    assert data["updated"] == []
    assert data["deleted"] == []

    r = client.get(f"/api/layouts/{layout_id}")
    assert len(r.json()["blocks"]) == 1


def test_batch_blocks_not_found(client: TestClient):
    """Batch operations on a non-existent layout return 404."""
    r = client.post(
        "/api/layouts/00000000-0000-0000-0000-000000000000/blocks/batch",
        json={"delete": []},
    )
    assert r.status_code == 404


# ── Container re-parenting & cascade tests ─────────────────


def _create_nested(client: TestClient, layout_id: str) -> tuple[str, str, str]:
    """Create parent → child → grandchild and return their ids."""
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 30, "height": 10,
    })
    parent_id = r.json()["id"]
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 1, "y": 1, "width": 20, "height": 6,
        "parent_id": parent_id,
    })
    child_id = r.json()["id"]
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text", "x": 1, "y": 1, "width": 8, "height": 2,
        "parent_id": child_id,
    })
    grandchild_id = r.json()["id"]
    return parent_id, child_id, grandchild_id


def test_delete_block_cascades_to_descendants(client: TestClient):
    """Deleting a container removes all of its descendants."""
    _, layout_id = _create_project_with_layout(client)
    parent_id, child_id, grandchild_id = _create_nested(client, layout_id)

    r = client.delete(f"/api/layouts/{layout_id}/blocks/{parent_id}")
    assert r.status_code == 200

    r = client.get(f"/api/layouts/{layout_id}")
    assert r.status_code == 200
    assert r.json()["blocks"] == []


def test_batch_delete_cascades_to_descendants(client: TestClient):
    """A batch delete of a container removes all of its descendants."""
    _, layout_id = _create_project_with_layout(client)
    parent_id, child_id, grandchild_id = _create_nested(client, layout_id)

    r = client.post(f"/api/layouts/{layout_id}/blocks/batch", json={
        "delete": [parent_id],
    })
    assert r.status_code == 200
    assert r.json()["deleted"] == [parent_id]

    r = client.get(f"/api/layouts/{layout_id}")
    assert r.json()["blocks"] == []


def test_reparent_via_update(client: TestClient):
    """Moving a block into a container via update sets parent_id + relative x/y."""
    _, layout_id = _create_project_with_layout(client)
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 30, "height": 10,
    })
    container_id = r.json()["id"]
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "button", "x": 40, "y": 20, "width": 10, "height": 2,
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "parent_id": container_id, "x": 2, "y": 3,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["parent_id"] == container_id
    assert data["x"] == 2
    assert data["y"] == 3


def test_reparent_via_batch(client: TestClient):
    """A batch update can re-parent a block into a container."""
    _, layout_id = _create_project_with_layout(client)
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 30, "height": 10,
    })
    container_id = r.json()["id"]
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "button", "x": 40, "y": 20, "width": 10, "height": 2,
    })
    block_id = r.json()["id"]

    r = client.post(f"/api/layouts/{layout_id}/blocks/batch", json={
        "update": [{"id": block_id, "parent_id": container_id, "x": 1, "y": 1}],
    })
    assert r.status_code == 200
    updated = r.json()["updated"][0]
    assert updated["parent_id"] == container_id
    assert updated["x"] == 1


def test_unparent_via_update(client: TestClient):
    """Setting parent_id to null moves a block back to the root."""
    _, layout_id = _create_project_with_layout(client)
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 30, "height": 10,
    })
    container_id = r.json()["id"]
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "button", "x": 1, "y": 1, "width": 10, "height": 2,
        "parent_id": container_id,
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "parent_id": None, "x": 5, "y": 6,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["parent_id"] is None
    assert data["x"] == 5


def test_reparent_cycle_rejected(client: TestClient):
    """Moving a block into its own descendant is rejected (400)."""
    _, layout_id = _create_project_with_layout(client)
    parent_id, child_id, grandchild_id = _create_nested(client, layout_id)

    # Make the parent a child of its own grandchild → cycle
    r = client.put(f"/api/layouts/{layout_id}/blocks/{parent_id}", json={
        "parent_id": grandchild_id,
    })
    assert r.status_code == 400

    # The parent is unchanged
    r = client.get(f"/api/layouts/{layout_id}")
    blocks = {b["id"]: b for b in r.json()["blocks"]}
    assert blocks[parent_id]["parent_id"] is None


def test_reparent_into_own_child_rejected(client: TestClient):
    """Dropping a box onto its own direct child is rejected (400)."""
    _, layout_id = _create_project_with_layout(client)
    parent_id, child_id, _ = _create_nested(client, layout_id)

    r = client.put(f"/api/layouts/{layout_id}/blocks/{parent_id}", json={
        "parent_id": child_id,
    })
    assert r.status_code == 400


def test_reparent_self_rejected(client: TestClient):
    """A block cannot become its own parent (400)."""
    _, layout_id = _create_project_with_layout(client)
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 3,
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "parent_id": block_id,
    })
    assert r.status_code == 400


def test_reparent_missing_parent_rejected(client: TestClient):
    """Re-parenting to a non-existent parent is rejected (400)."""
    _, layout_id = _create_project_with_layout(client)
    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "box", "x": 0, "y": 0, "width": 10, "height": 3,
    })
    block_id = r.json()["id"]

    r = client.put(f"/api/layouts/{layout_id}/blocks/{block_id}", json={
        "parent_id": "00000000-0000-0000-0000-000000000000",
    })
    assert r.status_code == 400


def test_create_block_missing_parent_rejected(client: TestClient):
    """Creating a block with a non-existent parent is rejected (400)."""
    _, layout_id = _create_project_with_layout(client)

    r = client.post(f"/api/layouts/{layout_id}/blocks", json={
        "block_type": "text", "x": 1, "y": 1, "width": 8, "height": 2,
        "parent_id": "00000000-0000-0000-0000-000000000000",
    })
    assert r.status_code == 400
