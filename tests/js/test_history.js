/**
 * Tests for the snapshot-based undo/redo history (core/history.js).
 *
 * Run with: node --test tests/js/
 *
 * The history wraps a layout store (memory / localStorage) and records a
 * state snapshot before every mutation. undo()/redo() restore snapshots
 * through the store's replaceState().
 */

const { test } = require("node:test");
const assert = require("node:assert");
require("../../boxframe/static/js/core/renderer.js"); // sets global.PGRenderer
const { createMemoryStore, createLocalStorageStore } = require("../../boxframe/static/js/core/store.js");
const { withHistory } = require("../../boxframe/static/js/core/history.js");

function makeStore(options) {
    return withHistory(createMemoryStore(options || {}));
}

async function blocks(store) {
    const data = await store.load();
    return data.blocks;
}

function blockById(list, id) {
    return list.find((b) => b.id === id);
}

test("undo of createBlock removes the block, redo restores it with the same id", async () => {
    const store = makeStore();
    const created = await store.createBlock({ block_type: "box", x: 0, y: 0 });

    assert.equal((await blocks(store)).length, 1);
    assert.equal(store.canUndo, true);
    assert.equal(store.canRedo, false);

    await store.undo();
    assert.equal((await blocks(store)).length, 0);
    assert.equal(store.canUndo, false);
    assert.equal(store.canRedo, true);

    await store.redo();
    const restored = await blocks(store);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, created.id);
});

test("undo of updateBlock restores the previous values", async () => {
    const store = makeStore();
    const b = await store.createBlock({ block_type: "box", x: 1, y: 2, width: 10, height: 3, content: "old" });

    await store.updateBlock(b.id, { x: 5, content: "new" });
    assert.equal(store.undoCount, 2); // create + update

    await store.undo();
    let b2 = blockById(await blocks(store), b.id);
    assert.equal(b2.x, 1);
    assert.equal(b2.content, "old");

    await store.redo();
    b2 = blockById(await blocks(store), b.id);
    assert.equal(b2.x, 5);
    assert.equal(b2.content, "new");
});

test("undo of deleteBlock restores the block with the same id and fields", async () => {
    const store = makeStore();
    const b = await store.createBlock({ block_type: "button", x: 3, y: 4, width: 8, height: 1, content: "Go" });

    await store.deleteBlock(b.id);
    assert.equal((await blocks(store)).length, 0);

    await store.undo();
    const restored = blockById(await blocks(store), b.id);
    assert.ok(restored);
    assert.equal(restored.block_type, "button");
    assert.equal(restored.x, 3);
    assert.equal(restored.y, 4);
    assert.equal(restored.content, "Go");
});

test("undo of clear restores all blocks", async () => {
    const store = makeStore();
    const a = await store.createBlock({ block_type: "box", x: 0, y: 0 });
    const c = await store.createBlock({ block_type: "text", x: 5, y: 5, content: "hi" });

    await store.clear();
    assert.equal((await blocks(store)).length, 0);

    await store.undo();
    const restored = await blocks(store);
    assert.equal(restored.length, 2);
    assert.ok(blockById(restored, a.id));
    assert.ok(blockById(restored, c.id));
});

test("a new mutation after undo clears the redo stack", async () => {
    const store = makeStore();
    await store.createBlock({ block_type: "box", x: 0, y: 0 });
    await store.undo();
    assert.equal(store.canRedo, true);

    await store.createBlock({ block_type: "text", x: 9, y: 9 });
    assert.equal(store.canRedo, false);
    assert.equal(store.redoCount, 0);
});

test("undo/redo on empty stacks are no-ops", async () => {
    const store = makeStore();
    assert.equal(await store.undo(), null);
    assert.equal(await store.redo(), null);
    assert.equal((await blocks(store)).length, 0);
});

test("consecutive updates of the same block coalesce into one entry", async () => {
    const store = makeStore();
    const b = await store.createBlock({ block_type: "text", content: "" });
    assert.equal(store.undoCount, 1);

    // Simulate typing: several updates of the same block in quick succession
    await store.updateBlock(b.id, { content: "a" });
    await store.updateBlock(b.id, { content: "ab" });
    await store.updateBlock(b.id, { content: "abc" });
    assert.equal(store.undoCount, 2); // create + one coalesced update burst

    // One undo reverts to the state before the burst
    await store.undo();
    assert.equal(blockById(await blocks(store), b.id).content, "");
    assert.equal(store.undoCount, 1);

    // One redo brings the whole burst back
    await store.redo();
    assert.equal(blockById(await blocks(store), b.id).content, "abc");
});

test("updates of different blocks are not coalesced", async () => {
    const store = makeStore();
    const a = await store.createBlock({ block_type: "box", x: 0, y: 0 });
    const b = await store.createBlock({ block_type: "box", x: 5, y: 5 });

    await store.updateBlock(a.id, { x: 1 });
    await store.updateBlock(b.id, { x: 6 });
    assert.equal(store.undoCount, 4); // 2 creates + 2 updates
});

test("coalescing window expiry splits the burst into separate entries", async () => {
    const store = withHistory(createMemoryStore(), { coalesceWindowMs: 20 });
    const b = await store.createBlock({ block_type: "text", content: "" });

    await store.updateBlock(b.id, { content: "a" });
    await new Promise((r) => setTimeout(r, 50)); // longer than the window
    await store.updateBlock(b.id, { content: "ab" });
    assert.equal(store.undoCount, 3); // create + two separate updates
});

test("a non-update mutation resets the coalescing key", async () => {
    const store = makeStore();
    const b = await store.createBlock({ block_type: "text", content: "" });

    await store.updateBlock(b.id, { content: "a" });
    await store.createBlock({ block_type: "box", x: 9, y: 9 }); // breaks the burst
    await store.updateBlock(b.id, { content: "ab" });
    assert.equal(store.undoCount, 4); // create + update + create + update
});

test("replaceState through the wrapper is recorded and undoable", async () => {
    const store = makeStore();
    await store.createBlock({ block_type: "box", x: 0, y: 0 });

    await store.replaceState({
        width: null,
        height: null,
        blocks: [{ id: "x1", block_type: "text", x: 1, y: 1, width: 5, height: 2, content: "replaced" }],
    });
    let list = await blocks(store);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "x1");

    await store.undo();
    list = await blocks(store);
    assert.equal(list.length, 1);
    assert.equal(list[0].block_type, "box");
});

test("undo restores a layout with nested blocks (parent_id kept)", async () => {
    const store = makeStore();
    const parent = await store.createBlock({ block_type: "box", x: 0, y: 0, width: 20, height: 6 });
    await store.createBlock({ block_type: "text", x: 1, y: 1, content: "child", parent_id: parent.id });

    await store.deleteBlock(parent.id);
    await store.undo();

    const list = await blocks(store);
    assert.equal(list.length, 2);
    const child = blockById(list, list.find((b) => b.block_type === "text").id);
    assert.equal(child.parent_id, parent.id);
});

test("the onChange callback is called with stack sizes", async () => {
    const calls = [];
    const store = withHistory(createMemoryStore(), {
        onChange: (counts) => calls.push(counts),
    });

    await store.createBlock({ block_type: "box" });
    await store.undo();
    await store.redo();

    assert.deepEqual(calls, [
        { undoCount: 1, redoCount: 0 },
        { undoCount: 0, redoCount: 1 },
        { undoCount: 1, redoCount: 0 },
    ]);
});

test("non-mutation methods pass through the wrapper", async () => {
    const store = makeStore({ name: "Passthrough" });
    assert.equal(store.mode, "memory");

    const info = await store.info();
    assert.ok(Array.isArray(info.block_types));
    assert.ok(info.block_types.includes("box"));

    const rendered = await store.render(12, 14.4);
    assert.equal(typeof rendered.ascii, "string");
});

test("works with the localStorage store (restored state is persisted)", async () => {
    const storage = {
        data: {},
        getItem(k) { return this.data[k] != null ? this.data[k] : null; },
        setItem(k, v) { this.data[k] = String(v); },
    };
    const store = withHistory(createLocalStorageStore({ key: "t", storage: storage }));

    await store.createBlock({ block_type: "box", x: 0, y: 0 });
    await store.undo();
    assert.equal((await blocks(store)).length, 0);
    // The undo (empty state) was persisted
    assert.equal(JSON.parse(storage.data["t"]).blocks.length, 0);

    await store.redo();
    assert.equal((await blocks(store)).length, 1);
    assert.equal(JSON.parse(storage.data["t"]).blocks.length, 1);
});

test("works with a fetch-like store that restores via replaceBlocks", async () => {
    // Mimics FetchStore: no replaceState, state restore goes through the
    // batch endpoint (replaceBlocks).
    var state = { width: null, height: null, blocks: [] };
    var replaceCalls = [];
    var fetchLike = {
        mode: "fetch",
        load: function () {
            return Promise.resolve({
                width: state.width,
                height: state.height,
                blocks: state.blocks.map(function (b) { return Object.assign({}, b); }),
            });
        },
        createBlock: function (data) {
            var b = Object.assign(
                { id: "id-" + Math.random().toString(36).slice(2), border_style: "solid", meta: {}, order: 1 },
                data
            );
            state.blocks.push(b);
            return Promise.resolve(Object.assign({}, b));
        },
        updateBlock: function (id, props) {
            var b = state.blocks.find(function (x) { return x.id === id; });
            Object.assign(b, props);
            return Promise.resolve(Object.assign({}, b));
        },
        deleteBlock: function (id) {
            state.blocks = state.blocks.filter(function (b) { return b.id !== id; });
            return Promise.resolve({ ok: true });
        },
        clear: function () {
            state.blocks = [];
            return Promise.resolve({ ok: true });
        },
        replaceBlocks: function (blocks) {
            replaceCalls.push(blocks.map(function (b) { return b.id; }));
            state.blocks = blocks.map(function (b) { return Object.assign({}, b); });
            return Promise.resolve({ blocks: state.blocks });
        },
    };

    const store = withHistory(fetchLike);
    const b = await store.createBlock({ block_type: "box", x: 0, y: 0 });

    await store.undo();
    assert.equal(state.blocks.length, 0);
    assert.deepEqual(replaceCalls, [[]]); // undo sent the empty pre-state

    await store.redo();
    assert.equal(state.blocks.length, 1);
    assert.equal(state.blocks[0].id, b.id);
    assert.deepEqual(replaceCalls, [[], [b.id]]);
});

test("unlimited buffer: many operations are all undoable", async () => {
    const store = makeStore();
    for (let i = 0; i < 200; i++) {
        await store.createBlock({ block_type: "box", x: i, y: 0 });
    }
    assert.equal(store.undoCount, 200);

    for (let i = 0; i < 200; i++) {
        await store.undo();
    }
    assert.equal((await blocks(store)).length, 0);
    assert.equal(store.redoCount, 200);
});
