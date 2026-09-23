/**
 * Tests for the editor's container (nesting) geometry and re-parenting.
 *
 * These cover the pure, DOM-free helpers in editor.js:
 *   _absoluteRect / _absToRel / _subtreeIds / _depth / _findDropContainer
 * and the re-parenting decision made by _commitBlockMove (drop into a box,
 * drag out to the canvas, plain root move).
 *
 * Also covers corner resize — the preview rect per corner and the commit
 * (single/child/group), including the half-cell rounding regression (0047)
 * where the fixed corner had to stay in place.
 *
 * Also covers selectionToAscii — the selection → pseudo-graphic text the
 * Copy button puts in the clipboard (with all descendants, anchored at
 * (0,0)).
 *
 * Run with: node --test tests/js/
 */

const { test } = require("node:test");
const assert = require("node:assert");
// renderer.js sets global.PGRenderer, which selectionToAscii uses
require("../../boxframe/static/js/core/renderer.js");
const {
    editorApp,
    selectionToAscii,
    buildDuplicates,
} = require("../../boxframe/static/js/editor.js");

function block(id, block_type, x, y, width, height, parent_id) {
    return {
        id, block_type, x, y, width, height,
        parent_id: parent_id || null, order: 0,
    };
}

function appWith(blocks) {
    const app = editorApp();
    app.blocks = blocks;
    return app;
}

// A minimal store double that records updateBlock calls and returns the
// merged block, plus a no-op refreshRender (the real one needs the DOM).
function stubStore(app) {
    const calls = [];
    app.store = {
        updateBlock: async (id, props) => {
            calls.push({ id, props });
            const b = app.blocks.find(x => x.id === id);
            return Object.assign({}, b, props);
        },
    };
    app.refreshRender = async () => {};
    return calls;
}

// ── _absoluteRect ─────────────────────────────────────────

test("_absoluteRect: a root block is its own coordinates", () => {
    const app = appWith([block("r", "box", 5, 7, 20, 10)]);
    assert.deepEqual(app._absoluteRect(app.blocks[0]), { x: 5, y: 7, width: 20, height: 10 });
});

test("_absoluteRect: a child adds the parent origin + 1-cell padding", () => {
    const app = appWith([
        block("p", "box", 4, 6, 30, 12),
        block("c", "text", 2, 3, 8, 2, "p"),
    ]);
    // abs = (4 + 1 + 2, 6 + 1 + 3) = (7, 10)
    assert.deepEqual(app._absoluteRect(app.blocks[1]), { x: 7, y: 10, width: 8, height: 2 });
});

test("_absoluteRect: a grandchild accumulates padding at each level", () => {
    const app = appWith([
        block("a", "box", 0, 0, 40, 20),
        block("b", "box", 2, 2, 20, 10, "a"),
        block("c", "text", 1, 1, 5, 2, "b"),
    ]);
    // b abs = (0+1+2, 0+1+2) = (3, 3); c abs = (3+1+1, 3+1+1) = (5, 5)
    assert.deepEqual(app._absoluteRect(app.blocks[2]), { x: 5, y: 5, width: 5, height: 2 });
});

test("_absoluteRect: a missing parent is treated as a root", () => {
    const app = appWith([block("c", "text", 2, 3, 8, 2, "ghost")]);
    assert.deepEqual(app._absoluteRect(app.blocks[0]), { x: 2, y: 3, width: 8, height: 2 });
});

// ── _absToRel ─────────────────────────────────────────────

test("_absToRel: removes the parent origin + 1-cell padding", () => {
    const app = appWith([block("p", "box", 4, 6, 30, 12)]);
    // abs (7, 10) inside a parent at (4, 6) → rel (7 - 5, 10 - 7) = (2, 3)
    assert.deepEqual(app._absToRel(7, 10, app.blocks[0]), { x: 2, y: 3 });
});

test("_absToRel: a nested parent uses its absolute origin", () => {
    const app = appWith([
        block("a", "box", 0, 0, 40, 20),
        block("b", "box", 2, 2, 20, 10, "a"),
    ]);
    // b abs = (3, 3); abs (8, 9) → rel (8 - 4, 9 - 4) = (4, 5)
    assert.deepEqual(app._absToRel(8, 9, app.blocks[1]), { x: 4, y: 5 });
});

// ── _subtreeIds ───────────────────────────────────────────

test("_subtreeIds: collects the block and every descendant", () => {
    const app = appWith([
        block("a", "box", 0, 0, 40, 20),
        block("b", "box", 2, 2, 20, 10, "a"),
        block("c", "text", 1, 1, 5, 2, "b"),
        block("d", "text", 1, 1, 5, 2, "a"),
        block("e", "box", 50, 0, 10, 5),
    ]);
    assert.deepEqual(app._subtreeIds("a").sort(), ["a", "b", "c", "d"]);
    assert.deepEqual(app._subtreeIds("b").sort(), ["b", "c"]);
    assert.deepEqual(app._subtreeIds("e"), ["e"]);
});

// ── _depth ────────────────────────────────────────────────

test("_depth: counts the number of ancestors", () => {
    const app = appWith([
        block("a", "box", 0, 0, 40, 20),
        block("b", "box", 2, 2, 20, 10, "a"),
        block("c", "text", 1, 1, 5, 2, "b"),
    ]);
    assert.equal(app._depth("a"), 0);
    assert.equal(app._depth("b"), 1);
    assert.equal(app._depth("c"), 2);
    assert.equal(app._depth("missing"), 0);
});

// ── _findDropContainer ────────────────────────────────────

test("_findDropContainer: a point on empty canvas → null", () => {
    const app = appWith([block("p", "box", 0, 0, 10, 10)]);
    assert.equal(app._findDropContainer(50, 50, null), null);
});

test("_findDropContainer: only box blocks are containers", () => {
    const app = appWith([block("h", "header", 0, 0, 30, 5)]);
    assert.equal(app._findDropContainer(5, 2, null), null);
});

test("_findDropContainer: the innermost box wins", () => {
    const app = appWith([
        block("outer", "box", 0, 0, 40, 20),
        block("inner", "box", 2, 2, 20, 10, "outer"),
    ]);
    // inner abs = (3, 3) size 20×10 → contains (10, 8)
    assert.equal(app._findDropContainer(10, 8, null).id, "inner");
    // (30, 15) is inside outer but outside inner
    assert.equal(app._findDropContainer(30, 15, null).id, "outer");
});

test("_findDropContainer: excludes the dragged subtree (cycle guard)", () => {
    const app = appWith([
        block("outer", "box", 0, 0, 40, 20),
        block("inner", "box", 2, 2, 20, 10, "outer"),
    ]);
    // Dropping "outer" back over its own area must not target itself or
    // its descendant — the whole subtree is excluded.
    const exclude = app._subtreeIds("outer");
    assert.equal(app._findDropContainer(10, 8, exclude), null);
});

// ── _commitBlockMove (re-parenting) ───────────────────────

test("_commitBlockMove: dropping into a box re-parents to relative coords", async () => {
    const app = appWith([
        block("box", "box", 0, 0, 30, 12),
        block("free", "text", 40, 0, 8, 2),
    ]);
    const calls = stubStore(app);

    // Drag "free" so its absolute top-left lands at (5, 5)
    app.dragBlock = app.blocks[1];
    app.dragGridX = 5;
    app.dragGridY = 5;
    await app._commitBlockMove();

    // center = (5 + 4, 5 + 1) = (9, 6) → inside the box
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "free");
    assert.equal(calls[0].props.parent_id, "box");
    assert.equal(calls[0].props.x, 5 - 1); // rel = 5 - (0 + 1)
    assert.equal(calls[0].props.y, 5 - 1);
});

test("_commitBlockMove: dragging a child out to the canvas un-parents", async () => {
    const app = appWith([
        block("box", "box", 0, 0, 30, 12),
        block("child", "text", 1, 1, 8, 2, "box"),
    ]);
    const calls = stubStore(app);

    // child abs = (2, 2); drag to abs (40, 20) — outside the box
    app.dragBlock = app.blocks[1];
    app.dragGridX = 40;
    app.dragGridY = 20;
    await app._commitBlockMove();

    // center = (44, 21) → outside → back to root, absolute coords
    assert.equal(calls[0].props.parent_id, null);
    assert.equal(calls[0].props.x, 40);
    assert.equal(calls[0].props.y, 20);
});

test("_commitBlockMove: moving a root block stays at root (no parent_id)", async () => {
    const app = appWith([block("free", "text", 0, 0, 8, 2)]);
    const calls = stubStore(app);

    app.dragBlock = app.blocks[0];
    app.dragGridX = 10;
    app.dragGridY = 12;
    await app._commitBlockMove();

    assert.equal(calls[0].props.x, 10);
    assert.equal(calls[0].props.y, 12);
    assert.equal(calls[0].props.parent_id, undefined); // not sent
});

test("_commitBlockMove: a box cannot be dropped into its own child", async () => {
    const app = appWith([
        block("outer", "box", 0, 0, 40, 20),
        block("inner", "box", 2, 2, 20, 10, "outer"),
    ]);
    const calls = stubStore(app);

    // Drag "outer" to (0, 0): its center (20, 10) is inside "inner" (its
    // own child). Without the cycle guard this would re-parent outer into
    // inner; the guard excludes the whole subtree, so outer just moves.
    app.dragBlock = app.blocks[0];
    app.dragGridX = 0;
    app.dragGridY = 0;
    await app._commitBlockMove();

    assert.equal(calls[0].props.parent_id, undefined); // not re-parented
    assert.equal(calls[0].props.x, 0);
    assert.equal(calls[0].props.y, 0);
});

// ── Selection: drag / hover-resize must not select ────────

// Simulates a mousedown on a block (the "pending" state) and a mousemove
// past the 3px click threshold, which starts the move-drag.
function startMoveDrag(app, block) {
    app._ensurePreviewEl = () => null; // no DOM in node
    app._showPreview = () => {};
    app.dragMode = "pending";
    app.pendingBlock = block;
    app.pendingToggle = false;
    app.dragStartX = 100;
    app.dragStartY = 100;
    app.onCanvasMouseMove({ clientX: 110, clientY: 105, preventDefault() {} });
}

test("drag start does not select the block (selection only on click)", () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    startMoveDrag(app, app.blocks[0]);

    assert.equal(app.dragMode, "move");
    assert.equal(app.dragBlock.id, "b1");
    assert.deepEqual(app.selectedIds, []);
});

test("dragging a block of an existing multi-selection moves the group", () => {
    const app = appWith([
        block("b1", "box", 2, 2, 20, 4),
        block("b2", "box", 30, 2, 10, 4),
    ]);
    app.selectedIds = ["b1", "b2"];
    startMoveDrag(app, app.blocks[0]);

    assert.equal(app.dragMode, "move");
    assert.equal(app.dragGroup, true);
    assert.deepEqual(app.selectedIds, ["b1", "b2"]);
});

test("hover-resize does not select the block", () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    let target = null;
    app._startResizeDrag = (b) => { target = b; };

    const e = {
        button: 0,
        target: {
            closest: (sel) =>
                sel === ".block-preview" ? { dataset: { blockId: "b1" } } : null,
        },
    };
    app.onResizeHandleMouseDown(e);

    assert.equal(target.id, "b1");
    assert.deepEqual(app.selectedIds, []);
});

test("_startResizeDrag: a single block resizes itself (no group)", () => {
    const app = appWith([
        block("b1", "box", 2, 2, 20, 4),
        block("b2", "box", 30, 2, 10, 4),
    ]);
    app.charWidth = 8;
    app.charHeight = 16;
    app._ensurePreviewEl = () => null;
    app._setPreviewMode = () => {};
    app._showPreview = () => {};
    // A single selection is not a group either
    app.selectedIds = ["b1"];

    app._startResizeDrag(app.blocks[0], {
        clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {},
    });

    assert.equal(app.dragMode, "resize");
    assert.equal(app.resizeGroup, false);
    assert.equal(app.dragBlock.id, "b1");
    assert.equal(app.resizeStartW, 20);
    assert.equal(app.resizeStartH, 4);
});

test("_startResizeDrag: a block from a multi-selection resizes the group bbox", () => {
    const app = appWith([
        block("b1", "box", 2, 2, 20, 4),
        block("b2", "box", 30, 2, 10, 4),
    ]);
    app.charWidth = 8;
    app.charHeight = 16;
    app._ensurePreviewEl = () => null;
    app._setPreviewMode = () => {};
    app._showPreview = () => {};
    app.selectedIds = ["b1", "b2"];

    app._startResizeDrag(app.blocks[1], {
        clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {},
    });

    assert.equal(app.dragMode, "resize");
    assert.equal(app.resizeGroup, true);
    // Group bbox: x 2..40, y 2..6
    assert.equal(app.resizePreviewX, 2);
    assert.equal(app.resizePreviewY, 2);
    assert.equal(app.resizeStartW, 38);
    assert.equal(app.resizeStartH, 4);
});

// ── Corner resize (selection frame handles) ──────────────

// Simulates a corner resize drag: mousedown on the selection frame's
// corner handle, then a mousemove by (dx, dy) pixels.
function cornerResize(app, block, corner, dx, dy, selectedIds) {
    app.charWidth = 8;
    app.charHeight = 16;
    app._ensurePreviewEl = () => null;
    app._setPreviewMode = () => {};
    app._showPreview = () => {};
    app.selectedIds = selectedIds || [block.id];
    app._startResizeDrag(block, {
        clientX: 0, clientY: 0, preventDefault() {}, stopPropagation() {},
    }, corner);
    app.onCanvasMouseMove({
        clientX: dx, clientY: dy, preventDefault() {}, stopPropagation() {},
    });
}

test("onSelectionResizeMouseDown: the corner is read from the handle", () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    app.charWidth = 8;
    app.charHeight = 16;
    app._ensurePreviewEl = () => null;
    app._setPreviewMode = () => {};
    app._showPreview = () => {};
    app.selectedIds = ["b1"];
    let corner = null;
    app._startResizeDrag = (b, e, c) => { corner = c; };

    const e = {
        button: 0,
        target: {
            closest: (sel) =>
                sel === ".sel-resize" ? { dataset: { corner: "nw" } } : null,
        },
    };
    app.onSelectionResizeMouseDown(e);

    assert.equal(corner, "nw");
});

test("corner resize: 'se' grows the block from the bottom-right", () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    cornerResize(app, app.blocks[0], "se", 16, 16); // +2 cells right, +1 down
    assert.deepEqual(
        [app.resizePreviewX, app.resizePreviewY, app.resizePreviewW, app.resizePreviewH],
        [2, 2, 22, 5],
    );
});

test("corner resize: 'ne' moves the top edge down, keeps the left edge", () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    cornerResize(app, app.blocks[0], "ne", 16, 16);
    assert.deepEqual(
        [app.resizePreviewX, app.resizePreviewY, app.resizePreviewW, app.resizePreviewH],
        [2, 3, 22, 3],
    );
});

test("corner resize: 'sw' moves the left edge right, keeps the top-right corner", () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    cornerResize(app, app.blocks[0], "sw", 16, 16); // +2 cells right, +1 down
    assert.deepEqual(
        [app.resizePreviewX, app.resizePreviewY, app.resizePreviewW, app.resizePreviewH],
        [4, 2, 18, 5],
    );
});

test("corner resize: 'nw' moves both edges, keeps the bottom-right corner", () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    cornerResize(app, app.blocks[0], "nw", -16, 16); // -2 cells left, +1 down
    assert.deepEqual(
        [app.resizePreviewX, app.resizePreviewY, app.resizePreviewW, app.resizePreviewH],
        [0, 3, 22, 3],
    );
});

test("corner resize: a clamped minimum size keeps the fixed corner in place", () => {
    const app = appWith([block("b1", "box", 2, 2, 4, 4)]);
    // Drag the 'sw' corner +3 cells right: the width would hit 1, but the
    // minimum is 2 — the right edge stays at x=6, the left edge stops at 4
    cornerResize(app, app.blocks[0], "sw", 24, 0);
    assert.deepEqual(
        [app.resizePreviewX, app.resizePreviewY, app.resizePreviewW, app.resizePreviewH],
        [4, 2, 2, 4],
    );
});

test("corner resize: the moving edge stops at the canvas origin", () => {
    const app = appWith([block("b1", "box", 2, 2, 4, 4)]);
    // Drag the 'nw' corner -4 cells left: the left edge hits 0, the right
    // edge stays at x=6
    cornerResize(app, app.blocks[0], "nw", -32, 0);
    assert.deepEqual(
        [app.resizePreviewX, app.resizePreviewY, app.resizePreviewW, app.resizePreviewH],
        [0, 2, 6, 4],
    );
});

test("_commitBlockResize: 'nw' updates x/y and the size", async () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    const calls = stubStore(app);
    cornerResize(app, app.blocks[0], "nw", -16, 16);
    await app._commitBlockResize();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "b1");
    assert.deepEqual(calls[0].props, { x: 0, y: 3, width: 22, height: 3 });
});

test("_commitBlockResize: a child keeps relative coordinates to its parent", async () => {
    const app = appWith([
        block("p", "box", 4, 6, 30, 12),
        block("c", "text", 2, 3, 8, 2, "p"),
    ]);
    const calls = stubStore(app);
    // Child absolute (7, 10) 8x2; 'ne' +2 right, +2 down → (7, 11) 10x1
    // (the height hits its minimum of 1, the bottom edge stays at y=12)
    cornerResize(app, app.blocks[1], "ne", 16, 32);
    await app._commitBlockResize();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "c");
    assert.deepEqual(calls[0].props, { x: 2, y: 4, width: 10, height: 1 });
});

test("_commitBlockResize: a group resize shifts and resizes every block", async () => {
    const app = appWith([
        block("b1", "box", 2, 2, 20, 4),
        block("b2", "box", 30, 2, 10, 4),
    ]);
    const calls = [];
    app.store = {
        batchBlocks: async ({ update }) => {
            calls.push(update);
            update.forEach(u =>
                Object.assign(app.blocks.find(b => b.id === u.id), u));
            return { updated: update };
        },
    };
    app.refreshRender = async () => {};
    // Group bbox (2, 2, 38, 4); 'nw' -2 left, +1 down → (0, 3, 40, 3)
    cornerResize(app, app.blocks[0], "nw", -16, 16, ["b1", "b2"]);
    await app._commitBlockResize();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [
        { id: "b1", x: 0, y: 3, width: 22, height: 3 },
        { id: "b2", x: 28, y: 3, width: 12, height: 3 },
    ]);
});

// ── Commit rounding (0047): half-cell drags keep the fixed corner ──
// The drag snaps to half-cells, so the preview rect can carry a .5
// fraction. The committed fixed edges must stay at their exact integer
// positions — rounding x and width independently used to shift the
// fixed corner by a cell.

test("corner resize: half-cell 'sw' preview keeps the fixed edges exact", () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    cornerResize(app, app.blocks[0], "sw", 4, 8); // 0.5 right, 0.5 down
    assert.deepEqual(
        [app.resizePreviewX, app.resizePreviewY, app.resizePreviewW, app.resizePreviewH],
        [2.5, 2, 19.5, 4.5],
    );
});

test("_commitBlockResize: half-cell 'sw' keeps the top-right corner in place", async () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    const calls = stubStore(app);
    cornerResize(app, app.blocks[0], "sw", 4, 8);
    await app._commitBlockResize();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].props, { x: 3, y: 2, width: 19, height: 5 });
    // Fixed corner: top-right stays at (startX + startW, startY) = (22, 2)
    assert.equal(calls[0].props.x + calls[0].props.width, 22);
    assert.equal(calls[0].props.y, 2);
});

test("_commitBlockResize: half-cell 'nw' keeps the bottom-right corner in place", async () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    const calls = stubStore(app);
    cornerResize(app, app.blocks[0], "nw", -4, 8); // 0.5 left, 0.5 down
    await app._commitBlockResize();

    assert.deepEqual(calls[0].props, { x: 2, y: 3, width: 20, height: 3 });
    // Fixed corner: bottom-right stays at (22, 6)
    assert.equal(calls[0].props.x + calls[0].props.width, 22);
    assert.equal(calls[0].props.y + calls[0].props.height, 6);
});

test("_commitBlockResize: half-cell 'ne' keeps the bottom-left corner in place", async () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    const calls = stubStore(app);
    cornerResize(app, app.blocks[0], "ne", 4, -8); // 0.5 right, 0.5 up
    await app._commitBlockResize();

    assert.deepEqual(calls[0].props, { x: 2, y: 2, width: 21, height: 4 });
    // Fixed corner: bottom-left stays at (2, 6)
    assert.equal(calls[0].props.x, 2);
    assert.equal(calls[0].props.y + calls[0].props.height, 6);
});

test("_commitBlockResize: half-cell 'se' keeps the top-left corner in place", async () => {
    const app = appWith([block("b1", "box", 2, 2, 20, 4)]);
    const calls = stubStore(app);
    cornerResize(app, app.blocks[0], "se", 4, 8); // 0.5 right, 0.5 down
    await app._commitBlockResize();

    assert.deepEqual(calls[0].props, { x: 2, y: 2, width: 21, height: 5 });
    assert.equal(calls[0].props.x, 2);
    assert.equal(calls[0].props.y, 2);
});

test("_commitBlockResize: half-cell group 'sw' keeps the fixed bbox edges in place", async () => {
    const app = appWith([
        block("b1", "box", 2, 2, 20, 4),
        block("b2", "box", 30, 2, 10, 4),
    ]);
    const calls = [];
    app.store = {
        batchBlocks: async ({ update }) => {
            calls.push(update);
            update.forEach(u =>
                Object.assign(app.blocks.find(b => b.id === u.id), u));
            return { updated: update };
        },
    };
    app.refreshRender = async () => {};
    // Group bbox (2, 2, 38, 4); 'sw' 0.5 right, 0.5 down
    cornerResize(app, app.blocks[0], "sw", 4, 8, ["b1", "b2"]);
    await app._commitBlockResize();

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [
        { id: "b1", x: 3, y: 2, width: 19, height: 5 },
        { id: "b2", x: 31, y: 2, width: 9, height: 5 },
    ]);
    // Fixed bbox edges: right stays at 40, top at 2
    assert.equal(Math.max(...calls[0].map(u => u.x + u.width)), 40);
    assert.equal(Math.min(...calls[0].map(u => u.y)), 2);
});

// ── _blockAt (topmost hit-test for click / drag / dblclick) ──

test("_blockAt: the highest-order block under the point wins", () => {
    const app = appWith([
        block("low", "box", 0, 0, 20, 10),
        block("high", "box", 5, 2, 10, 6),
    ]);
    app.blocks[1].order = 1;
    assert.equal(app._blockAt(8, 4).id, "high");
    assert.equal(app._blockAt(2, 2).id, "low");
    assert.equal(app._blockAt(50, 50), null);
});

test("_blockAt: right and bottom edges are not inside (half-open rect)", () => {
    const app = appWith([block("b", "box", 0, 0, 10, 4)]);
    assert.equal(app._blockAt(9, 3).id, "b");
    assert.equal(app._blockAt(10, 3), null);
    assert.equal(app._blockAt(9, 4), null);
});

test("_blockAt: ties in order — the later block in document order wins", () => {
    const app = appWith([
        block("first", "box", 0, 0, 10, 4),
        block("second", "box", 2, 1, 10, 4),
    ]);
    // Stamp the document order (as _flattenBlocks does on load)
    app.blocks = app._flattenBlocks(app.blocks);
    assert.equal(app._blockAt(4, 2).id, "second");
});

test("_blockAt: a child is on top of its own container (even with lower order)", () => {
    const app = appWith([
        block("parent", "box", 0, 0, 20, 10),
        block("child", "text", 2, 2, 8, 3, "parent"),
    ]);
    app.blocks[0].order = 5;
    // child abs = (0+1+2, 0+1+2) = (3, 3), 8x3
    assert.equal(app._blockAt(5, 4).id, "child");
    // On the container's border the container is on top
    assert.equal(app._blockAt(0, 4).id, "parent");
    assert.equal(app._blockAt(19, 4).id, "parent");
});

test("_blockAt: a child of a high-order container beats a lower-order root", () => {
    const app = appWith([
        block("mid", "box", 0, 0, 30, 10),
        block("cont", "box", 0, 0, 30, 10),
        block("kid", "text", 1, 1, 28, 8, "cont"),
    ]);
    app.blocks[0].order = 3;
    app.blocks[1].order = 5;
    app.blocks[2].order = 1;
    // kid abs = (2, 2) 28x8 — covers (5, 5); it is drawn inside "cont"
    // (order 5), which is drawn after "mid" (order 3)
    assert.equal(app._blockAt(5, 5).id, "kid");
});

test("_blockAt: children of a borderless container are not drawn", () => {
    const app = appWith([
        block("p", "box", 0, 0, 20, 10),
        block("c", "text", 2, 2, 8, 3, "p"),
    ]);
    app.blocks[0].border_style = "none";
    assert.equal(app._blockAt(5, 4).id, "p");
});

test("_blockAt: buttons never render their children", () => {
    const app = appWith([
        block("btn", "button", 0, 0, 20, 3),
        block("c", "text", 1, 1, 5, 1, "btn"),
    ]);
    assert.equal(app._blockAt(3, 1).id, "btn");
});

test("_blockAt: a grandchild is reached through nested containers", () => {
    const app = appWith([
        block("a", "box", 0, 0, 40, 20),
        block("b", "box", 2, 2, 20, 10, "a"),
        block("c", "text", 1, 1, 5, 2, "b"),
    ]);
    app.blocks[0].order = 10;
    // c abs = (5, 5) 5x2
    assert.equal(app._blockAt(6, 6).id, "c");
    // (3, 3) is inside b but outside c
    assert.equal(app._blockAt(3, 3).id, "b");
});

test("_blockAt: a child clipped past the container border is not picked there", () => {
    const app = appWith([
        block("p", "box", 0, 0, 10, 10),
        block("c", "text", 8, 8, 8, 2, "p"),
    ]);
    // c abs = (9, 9) 8x2 — its whole area is clipped away by the
    // container's inner area (x < 9); the container is on top at (9, 9)
    assert.equal(app._blockAt(9, 9).id, "p");
});

test("updateSelectedBlock: an order change re-sorts the block list", async () => {
    const app = appWith([
        block("a", "box", 0, 0, 10, 4),
        block("b", "box", 0, 0, 10, 4),
    ]);
    app.blocks[1].order = 1;
    app._reorderBlocks();
    const calls = stubStore(app);
    app.selectedIds = ["a"];
    await app.updateSelectedBlock({ order: 5 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "a");
    // "a" is the top layer now — the list leads with it
    assert.equal(app.blocks[0].id, "a");
    assert.equal(app.blocks[0].order, 5);
});

// Simulates a mousedown on the canvas (the "pending" state).
function canvasMouseDown(app, gridPos) {
    const e = {
        button: 0, shiftKey: false, ctrlKey: false, metaKey: false,
        clientX: 0, clientY: 0,
        target: { closest: () => null },
        preventDefault() {},
    };
    app._pixelToGrid = () => gridPos;
    app.onCanvasMouseDown(e);
    return e;
}

test("mousedown: a non-selected topmost block wins over the selection bbox", () => {
    const app = appWith([
        block("sel", "box", 0, 0, 20, 10),
        block("top", "box", 5, 2, 10, 6),
    ]);
    app.blocks[1].order = 1;
    app.selectedIds = ["sel"];
    app._reorderBlocks();

    canvasMouseDown(app, { x: 8, y: 4 }); // on "top" (inside "sel"'s bbox)

    assert.equal(app.dragMode, "pending");
    assert.equal(app.dragSelection, false);
    assert.equal(app.pendingBlock.id, "top");
});

test("mousedown: empty canvas inside the selection bbox still drags the selection", () => {
    const app = appWith([
        block("a", "box", 0, 0, 10, 4),
        block("b", "box", 30, 0, 10, 4),
    ]);
    app.selectedIds = ["a", "b"];

    canvasMouseDown(app, { x: 20, y: 2 }); // empty, inside the group bbox

    assert.equal(app.dragMode, "pending");
    assert.equal(app.dragSelection, true);
});

test("mousedown: a press on a selected block drags the selection", () => {
    const app = appWith([
        block("a", "box", 0, 0, 10, 4),
        block("b", "box", 30, 0, 10, 4),
    ]);
    app.selectedIds = ["a", "b"];

    canvasMouseDown(app, { x: 5, y: 2 }); // on "a" (selected)

    assert.equal(app.dragMode, "pending");
    assert.equal(app.dragSelection, true);
});

// ── selectionToAscii (Copy button → clipboard) ───────────

function sbox(id, x, y, w, h, extra = {}) {
    return Object.assign({
        id, block_type: "box", x, y, width: w, height: h,
        content: "", border_style: "solid", order: 0,
    }, extra);
}

test("selectionToAscii: empty selection renders an empty string", () => {
    assert.equal(selectionToAscii([], ["b1"]), "");
    assert.equal(selectionToAscii([sbox("b1", 0, 0, 5, 2)], []), "");
});

test("selectionToAscii: a single block is re-anchored at (0,0)", () => {
    const blocks = [sbox("b1", 7, 4, 10, 4, { content: "Hi" })];
    const out = selectionToAscii(blocks, ["b1"]);
    assert.equal(out, [
        "┌────────┐",
        "│Hi      │",
        "│        │",
        "└────────┘",
    ].join("\n"));
});

test("selectionToAscii: children are copied with the parent (hierarchy kept)", () => {
    // Empty boxes show the [box] type hint (same as the canvas preview);
    // in a 6×2 box the hint clips to 4 cells and overwrites the bottom
    // border's middle — the copy reflects what is rendered.
    const blocks = [
        sbox("p", 3, 2, 12, 5),
        sbox("c", 2, 1, 6, 2, { parent_id: "p", order: 1 }),
    ];
    const out = selectionToAscii(blocks, ["p"]);
    assert.equal(out, [
        "┌──────────┐",
        "│[box]     │",
        "│  ┌────┐  │",
        "│  └[box┘  │",
        "└──────────┘",
    ].join("\n"));
});

test("selectionToAscii: a child without its parent is re-anchored by absolute position", () => {
    const blocks = [
        sbox("p", 4, 2, 20, 6),
        sbox("c", 1, 1, 8, 3, { parent_id: "p", order: 1, content: "C" }),
    ];
    // Child absolute (4+1+1, 2+1+1) = (6,3) → re-anchored at (0,0)
    const out = selectionToAscii(blocks, ["c"]);
    assert.equal(out, [
        "┌──────┐",
        "│C     │",
        "└──────┘",
    ].join("\n"));
});

test("selectionToAscii: selecting a parent and its child does not duplicate the child", () => {
    const blocks = [
        sbox("p", 0, 0, 12, 5),
        sbox("c", 2, 1, 6, 2, { parent_id: "p", order: 1 }),
    ];
    assert.equal(
        selectionToAscii(blocks, ["p", "c"]),
        selectionToAscii(blocks, ["p"]),
    );
});

test("selectionToAscii: multi-selection copies every block, anchored at the group top-left", () => {
    const blocks = [
        sbox("a", 2, 5, 6, 2),
        sbox("b", 10, 5, 6, 2, { order: 1 }),
    ];
    const out = selectionToAscii(blocks, ["a", "b"]);
    assert.equal(out, [
        "┌────┐  ┌────┐",
        "└[box┘  └[box┘",
    ].join("\n"));
});

test("selectionToAscii: deep nesting copies grandchildren too", () => {
    const blocks = [
        sbox("r", 1, 1, 16, 8),
        sbox("m", 1, 1, 10, 5, { parent_id: "r", order: 1 }),
        sbox("g", 1, 1, 4, 2, { parent_id: "m", order: 2 }),
    ];
    const out = selectionToAscii(blocks, ["r"]);
    assert.equal(out, [
        "┌──────────────┐",
        "│[box]         │",
        "│ ┌────────┐   │",
        "│ │[box]   │   │",
        "│ │ ┌──┐   │   │",
        "│ │ └[b┘   │   │",
        "│ └────────┘   │",
        "└──────────────┘",
    ].join("\n"));
});

test("selectionToAscii: unknown selected ids are ignored", () => {
    const blocks = [sbox("b1", 0, 0, 5, 2)];
    assert.equal(selectionToAscii(blocks, ["nope"]), "");
    assert.equal(
        selectionToAscii(blocks, ["nope", "b1"]),
        selectionToAscii(blocks, ["b1"]),
    );
});

// ── buildDuplicates (Duplicate button → copies) ──────────

function idGen(prefix) {
    let n = 0;
    return () => prefix + "-" + ++n;
}

test("buildDuplicates: a single root block is copied with a one-cell offset", () => {
    const blocks = [sbox("b1", 7, 4, 10, 4, { content: "Hi", order: 3 })];
    const copies = buildDuplicates(blocks, ["b1"], idGen("c"), 3);
    assert.equal(copies.length, 1);
    assert.deepEqual(copies[0], {
        id: "c-1",
        block_type: "box",
        x: 8, y: 5,
        width: 10, height: 4,
        content: "Hi",
        border_style: "solid",
        parent_id: null,
        meta: {},
        order: 4,
    });
});

test("buildDuplicates: a container is copied with its whole subtree", () => {
    const blocks = [
        sbox("p", 2, 2, 20, 8, { content: "C", order: 1 }),
        sbox("a", 1, 1, 8, 2, { parent_id: "p", content: "A", order: 2 }),
        sbox("b", 1, 4, 8, 2, { parent_id: "p", content: "B", order: 3 }),
    ];
    const copies = buildDuplicates(blocks, ["p"], idGen("c"), 3);
    assert.equal(copies.length, 3);
    const [pCopy, aCopy, bCopy] = copies;
    // The container copy is offset by one cell, same size
    assert.equal(pCopy.id, "c-1");
    assert.equal(pCopy.parent_id, null);
    assert.deepEqual([pCopy.x, pCopy.y, pCopy.width, pCopy.height], [3, 3, 20, 8]);
    // The children copies keep their relative coordinates and are
    // re-parented to the container copy
    assert.equal(aCopy.parent_id, "c-1");
    assert.deepEqual([aCopy.x, aCopy.y, aCopy.width, aCopy.height], [1, 1, 8, 2]);
    assert.equal(aCopy.content, "A");
    assert.equal(bCopy.parent_id, "c-1");
    assert.deepEqual([bCopy.x, bCopy.y, bCopy.width, bCopy.height], [1, 4, 8, 2]);
    // Orders continue above the existing max
    assert.deepEqual(copies.map(c => c.order), [4, 5, 6]);
});

test("buildDuplicates: deep nesting copies grandchildren too", () => {
    const blocks = [
        sbox("r", 1, 1, 16, 8, { order: 1 }),
        sbox("m", 1, 1, 10, 5, { parent_id: "r", order: 2 }),
        sbox("g", 1, 1, 4, 2, { parent_id: "m", order: 3 }),
    ];
    const copies = buildDuplicates(blocks, ["r"], idGen("c"), 3);
    assert.equal(copies.length, 3);
    const [rCopy, mCopy, gCopy] = copies;
    assert.equal(rCopy.parent_id, null);
    assert.deepEqual([rCopy.x, rCopy.y], [2, 2]);
    assert.equal(mCopy.parent_id, rCopy.id);
    assert.deepEqual([mCopy.x, mCopy.y], [1, 1]);
    assert.equal(gCopy.parent_id, mCopy.id);
    assert.deepEqual([gCopy.x, gCopy.y], [1, 1]);
});

test("buildDuplicates: a selected child of a selected parent is not copied twice", () => {
    const blocks = [
        sbox("p", 0, 0, 12, 5, { order: 1 }),
        sbox("c", 2, 1, 6, 2, { parent_id: "p", order: 2 }),
    ];
    const copies = buildDuplicates(blocks, ["p", "c"], idGen("c"), 2);
    // The child's copy is nested inside the parent's copy
    assert.equal(copies.length, 2);
    assert.equal(copies[1].parent_id, copies[0].id);
});

test("buildDuplicates: a selected grandchild of a selected parent is not copied twice", () => {
    const blocks = [
        sbox("r", 1, 1, 16, 8, { order: 1 }),
        sbox("m", 1, 1, 10, 5, { parent_id: "r", order: 2 }),
        sbox("g", 1, 1, 4, 2, { parent_id: "m", order: 3 }),
    ];
    const copies = buildDuplicates(blocks, ["r", "g"], idGen("c"), 3);
    assert.equal(copies.length, 3);
});

test("buildDuplicates: a child selected alone keeps its original parent", () => {
    const blocks = [
        sbox("p", 2, 2, 20, 8, { order: 1 }),
        sbox("c", 1, 1, 8, 2, { parent_id: "p", content: "C", order: 2 }),
    ];
    const copies = buildDuplicates(blocks, ["c"], idGen("c"), 2);
    assert.equal(copies.length, 1);
    // The copy is a sibling of the original inside the same container
    assert.equal(copies[0].parent_id, "p");
    assert.deepEqual([copies[0].x, copies[0].y], [2, 2]);
});

test("buildDuplicates: multi-selection copies every independent tree", () => {
    const blocks = [
        sbox("a", 2, 2, 10, 4, { order: 1 }),
        sbox("b", 14, 2, 10, 4, { order: 2 }),
        sbox("c", 1, 1, 4, 2, { parent_id: "b", order: 3 }),
    ];
    const copies = buildDuplicates(blocks, ["a", "b"], idGen("c"), 3);
    assert.equal(copies.length, 3);
    const aCopy = copies.find(c => c.id === "c-1");
    const bCopy = copies.find(c => c.id === "c-2");
    const cCopy = copies.find(c => c.id === "c-3");
    assert.deepEqual([aCopy.x, aCopy.y], [3, 3]);
    assert.deepEqual([bCopy.x, bCopy.y], [15, 3]);
    assert.equal(cCopy.parent_id, bCopy.id);
    assert.deepEqual([cCopy.x, cCopy.y], [1, 1]);
});

test("buildDuplicates: meta and border style are preserved", () => {
    const blocks = [
        sbox("b1", 0, 0, 5, 2, {
            border_style: "dashed", meta: { k: "v" }, order: 1,
        }),
    ];
    const copies = buildDuplicates(blocks, ["b1"], idGen("c"), 1);
    assert.equal(copies[0].border_style, "dashed");
    assert.deepEqual(copies[0].meta, { k: "v" });
});

test("buildDuplicates: unknown selected ids are ignored", () => {
    const blocks = [sbox("b1", 0, 0, 5, 2)];
    assert.deepEqual(buildDuplicates(blocks, ["nope"], idGen("c"), 0), []);
    assert.equal(
        buildDuplicates(blocks, ["nope", "b1"], idGen("c"), 0).length,
        1,
    );
});
