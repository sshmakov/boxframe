/**
 * Tests for the editor's container (nesting) geometry and re-parenting.
 *
 * These cover the pure, DOM-free helpers in editor.js:
 *   _absoluteRect / _absToRel / _subtreeIds / _depth / _findDropContainer
 * and the re-parenting decision made by _commitBlockMove (drop into a box,
 * drag out to the canvas, plain root move).
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
const { editorApp, selectionToAscii } = require("../../boxframe/static/js/editor.js");

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
