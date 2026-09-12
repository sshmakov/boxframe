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

function makeStorage() {
    return {
        data: {},
        getItem(k) { return this.data[k] != null ? this.data[k] : null; },
        setItem(k, v) { this.data[k] = String(v); },
        removeItem(k) { delete this.data[k]; },
    };
}

// A fetch-like store bound to a shared "server" state object — mimics
// FetchStore (no replaceState, state restore goes through replaceBlocks).
function makeFetchLike(serverState) {
    const replaceCalls = [];
    return {
        replaceCalls,
        mode: "fetch",
        load: function () {
            return Promise.resolve({
                width: serverState.width,
                height: serverState.height,
                blocks: serverState.blocks.map((b) => Object.assign({}, b)),
            });
        },
        createBlock: function (data) {
            const b = Object.assign(
                { id: "id-" + Math.random().toString(36).slice(2), border_style: "solid", meta: {}, order: 1 },
                data
            );
            serverState.blocks.push(b);
            return Promise.resolve(Object.assign({}, b));
        },
        updateBlock: function (id, props) {
            const b = serverState.blocks.find((x) => x.id === id);
            Object.assign(b, props);
            return Promise.resolve(Object.assign({}, b));
        },
        deleteBlock: function (id) {
            serverState.blocks = serverState.blocks.filter((b) => b.id !== id);
            return Promise.resolve({ ok: true });
        },
        clear: function () {
            serverState.blocks = [];
            return Promise.resolve({ ok: true });
        },
        replaceBlocks: function (blocks) {
            replaceCalls.push(blocks.map((b) => b.id));
            serverState.blocks = blocks.map((b) => Object.assign({}, b));
            return Promise.resolve({ blocks: serverState.blocks });
        },
    };
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
    const state = { width: null, height: null, blocks: [] };
    const fetchLike = makeFetchLike(state);
    const store = withHistory(fetchLike);
    const b = await store.createBlock({ block_type: "box", x: 0, y: 0 });

    await store.undo();
    assert.equal(state.blocks.length, 0);
    assert.deepEqual(fetchLike.replaceCalls, [[]]); // undo sent the empty pre-state

    await store.redo();
    assert.equal(state.blocks.length, 1);
    assert.equal(state.blocks[0].id, b.id);
    assert.deepEqual(fetchLike.replaceCalls, [[], [b.id]]);
});

test("the buffer is capped at maxSnapshots (oldest dropped first)", async () => {
    const store = withHistory(createMemoryStore(), { maxSnapshots: 5 });
    for (let i = 0; i < 8; i++) {
        await store.createBlock({ block_type: "box", x: i, y: 0 });
    }
    assert.equal(store.undoCount, 5);

    for (let i = 0; i < 5; i++) {
        await store.undo();
    }
    const list = await blocks(store);
    assert.equal(list.length, 3); // the three oldest blocks survive
    assert.deepEqual(list.map((b) => b.x), [0, 1, 2]);
    assert.equal(store.canUndo, false);
});

test("the default buffer cap is 50 snapshots", async () => {
    const store = makeStore();
    for (let i = 0; i < 60; i++) {
        await store.createBlock({ block_type: "box", x: i, y: 0 });
    }
    assert.equal(store.undoCount, 50);

    for (let i = 0; i < 50; i++) {
        await store.undo();
    }
    const list = await blocks(store);
    assert.equal(list.length, 10); // blocks 0..9 survive
    assert.equal(store.canUndo, false);
    assert.equal(store.redoCount, 50);
});

test("the undo buffer survives a page reload (static mode)", async () => {
    const storage = makeStorage();
    const make = () => withHistory(
        createLocalStorageStore({ key: "layout", storage }),
        { storage: storage, historyKey: "hist" }
    );

    const store1 = make();
    await store1.load();
    await store1.createBlock({ block_type: "box", x: 0, y: 0 });
    await store1.createBlock({ block_type: "text", x: 5, y: 5, content: "hi" });
    assert.equal(store1.undoCount, 2);

    // "Reload": a fresh store (restored from the layout key) + a fresh
    // wrapper (restored from the history key).
    const store2 = make();
    await store2.load();
    assert.equal(store2.undoCount, 2);
    assert.equal(store2.redoCount, 0);

    await store2.undo();
    const list = await blocks(store2);
    assert.equal(list.length, 1);
    assert.equal(list[0].block_type, "box");

    await store2.undo();
    assert.equal((await blocks(store2)).length, 0);
    assert.equal(store2.canUndo, false);
});

test("the redo buffer survives a page reload", async () => {
    const storage = makeStorage();
    const make = () => withHistory(
        createLocalStorageStore({ key: "layout", storage }),
        { storage: storage, historyKey: "hist" }
    );

    const store1 = make();
    await store1.load();
    await store1.createBlock({ block_type: "box", x: 0, y: 0 });
    await store1.undo(); // state: empty, redo: 1

    const store2 = make();
    await store2.load();
    assert.equal(store2.undoCount, 0);
    assert.equal(store2.redoCount, 1);

    await store2.redo();
    assert.equal((await blocks(store2)).length, 1);
});

test("undo buffer survives a reload in web mode (server state unchanged)", async () => {
    const storage = makeStorage();
    const serverState = { width: null, height: null, blocks: [] };

    const store1 = withHistory(makeFetchLike(serverState), { storage: storage, historyKey: "hist" });
    await store1.load();
    const b = await store1.createBlock({ block_type: "box", x: 0, y: 0 });

    // "Reload": a fresh wrapper, same server state.
    const store2 = withHistory(makeFetchLike(serverState), { storage: storage, historyKey: "hist" });
    await store2.load();
    assert.equal(store2.undoCount, 1);

    await store2.undo();
    assert.equal(serverState.blocks.length, 0);
    assert.equal(store2.canRedo, true);

    await store2.redo();
    assert.equal(serverState.blocks.length, 1);
    assert.equal(serverState.blocks[0].id, b.id);
});

test("stale stacks are dropped when the server state changed", async () => {
    const storage = makeStorage();
    const serverState = { width: null, height: null, blocks: [] };

    const store1 = withHistory(makeFetchLike(serverState), { storage: storage, historyKey: "hist" });
    await store1.load();
    await store1.createBlock({ block_type: "box", x: 0, y: 0 });
    assert.equal(store1.undoCount, 1);

    // Another client adds a block while this one is closed.
    serverState.blocks.push({
        id: "external", block_type: "text", x: 9, y: 9, width: 5, height: 2,
        content: "from another tab", border_style: "solid", parent_id: null,
        meta: {}, order: 2, created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
    });

    const store2 = withHistory(makeFetchLike(serverState), { storage: storage, historyKey: "hist" });
    await store2.load();
    assert.equal(store2.undoCount, 0); // stale buffer discarded
    assert.equal(store2.canRedo, false);
    assert.equal(storage.getItem("hist"), null); // stale record removed
});

test("a corrupted history record is ignored", async () => {
    const storage = makeStorage();
    storage.setItem("hist", "{not valid json");
    const store = withHistory(createMemoryStore(), { storage: storage, historyKey: "hist" });
    await store.createBlock({ block_type: "box", x: 0, y: 0 });
    assert.equal(store.undoCount, 1); // works, no crash
});

test("the persisted buffer respects the cap", async () => {
    const storage = makeStorage();
    const store = withHistory(createMemoryStore(), {
        storage: storage, historyKey: "hist", maxSnapshots: 3,
    });
    for (let i = 0; i < 5; i++) {
        await store.createBlock({ block_type: "box", x: i, y: 0 });
    }
    const saved = JSON.parse(storage.getItem("hist"));
    assert.equal(saved.undoStack.length, 3);
});

test("onChange fires when the buffer is restored on load", async () => {
    const storage = makeStorage();
    const s1 = withHistory(
        createLocalStorageStore({ key: "layout", storage }),
        { storage: storage, historyKey: "hist" }
    );
    await s1.load();
    await s1.createBlock({ block_type: "box", x: 0, y: 0 });

    const calls = [];
    const s2 = withHistory(
        createLocalStorageStore({ key: "layout", storage }),
        { storage: storage, historyKey: "hist", onChange: (c) => calls.push(c) }
    );
    await s2.load();
    assert.deepEqual(calls, [{ undoCount: 1, redoCount: 0 }]);
});
