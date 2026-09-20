/**
 * Tests for the editor stores (core/store.js): MemoryStore and
 * LocalStorageStore.
 *
 * Run with: node --test tests/js/
 *
 * The stores render through the local PGRenderer, so the renderer must be
 * loaded first (it sets the PGRenderer global the stores reference).
 */

const { test } = require("node:test");
const assert = require("node:assert");
require("../../boxframe/static/js/core/renderer.js");
const {
    createMemoryStore,
    createLocalStorageStore,
} = require("../../boxframe/static/js/core/store.js");

const KEY = "boxframe.static.layout";

function makeStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
        _map: map,
    };
}

// ── MemoryStore ───────────────────────────────────────────

test("memory store: create/update/delete block", async () => {
    const store = createMemoryStore();
    assert.equal(store.mode, "memory");

    const block = await store.createBlock({
        block_type: "box", x: 1, y: 1, width: 10, height: 3,
    });
    assert.ok(block.id);
    assert.equal(block.order, 1);

    const updated = await store.updateBlock(block.id, { x: 5 });
    assert.equal(updated.x, 5);

    let data = await store.load();
    assert.equal(data.blocks.length, 1);
    assert.equal(data.blocks[0].x, 5);

    await store.deleteBlock(block.id);
    data = await store.load();
    assert.equal(data.blocks.length, 0);
});

test("memory store: clear() removes all blocks", async () => {
    const store = createMemoryStore();
    await store.createBlock({ block_type: "box", x: 0, y: 0, width: 10, height: 3 });
    await store.createBlock({ block_type: "header", x: 0, y: 5, width: 10, height: 2 });
    assert.equal((await store.load()).blocks.length, 2);

    await store.clear();
    const data = await store.load();
    assert.equal(data.blocks.length, 0);
});

// ── LocalStorageStore ─────────────────────────────────────

test("local store: persists mutations to storage", async () => {
    const storage = makeStorage();
    const store = createLocalStorageStore({ key: KEY, storage });
    assert.equal(store.mode, "local");
    assert.equal(store.storageKey, KEY);

    await store.createBlock({
        block_type: "box", x: 2, y: 3, width: 10, height: 4, content: "hi",
    });
    let saved = JSON.parse(storage.getItem(KEY));
    assert.equal(saved.blocks.length, 1);
    assert.equal(saved.blocks[0].content, "hi");

    await store.updateBlock(saved.blocks[0].id, { x: 7 });
    saved = JSON.parse(storage.getItem(KEY));
    assert.equal(saved.blocks[0].x, 7);

    await store.deleteBlock(saved.blocks[0].id);
    saved = JSON.parse(storage.getItem(KEY));
    assert.equal(saved.blocks.length, 0);
});

test("local store: restores saved layout on load", async () => {
    const storage = makeStorage();
    const store = createLocalStorageStore({ key: KEY, storage });
    const block = await store.createBlock({
        block_type: "box", x: 2, y: 3, width: 10, height: 4,
    });

    // A new store over the same storage sees the saved block
    const store2 = createLocalStorageStore({ key: KEY, storage });
    const data = await store2.load();
    assert.equal(data.blocks.length, 1);
    assert.equal(data.blocks[0].id, block.id);
    assert.equal(data.blocks[0].x, 2);

    // And can mutate it — the saved id still resolves
    await store2.updateBlock(block.id, { x: 9 });
    const data2 = await store2.load();
    assert.equal(data2.blocks[0].x, 9);
});

test("local store: clear() empties the layout and the saved state", async () => {
    const storage = makeStorage();
    const store = createLocalStorageStore({ key: KEY, storage });
    await store.createBlock({ block_type: "box", x: 0, y: 0, width: 10, height: 3 });

    await store.clear();
    assert.equal((await store.load()).blocks.length, 0);

    const saved = JSON.parse(storage.getItem(KEY));
    assert.equal(saved.blocks.length, 0);
});

test("local store: corrupted JSON in storage starts empty", async () => {
    const storage = makeStorage();
    storage.setItem(KEY, "{not json");
    const store = createLocalStorageStore({ key: KEY, storage });
    assert.equal((await store.load()).blocks.length, 0);
});

test("local store: saved state without a blocks array starts empty", async () => {
    const storage = makeStorage();
    storage.setItem(KEY, JSON.stringify({ width: 10 }));
    const store = createLocalStorageStore({ key: KEY, storage });
    assert.equal((await store.load()).blocks.length, 0);
});

test("local store: setItem failure does not break mutations", async () => {
    const storage = makeStorage();
    storage.setItem = () => { throw new Error("QuotaExceededError"); };
    const store = createLocalStorageStore({ key: KEY, storage });

    const block = await store.createBlock({
        block_type: "box", x: 0, y: 0, width: 10, height: 3,
    });
    assert.ok(block.id);
    assert.equal((await store.load()).blocks.length, 1);
});

test("local store: without storage behaves like the memory store", async () => {
    // Node has no global localStorage (unless --experimental-webstorage)
    const store = createLocalStorageStore({ key: KEY });
    const block = await store.createBlock({
        block_type: "box", x: 0, y: 0, width: 10, height: 3,
    });
    assert.ok(block.id);
    assert.equal(store.mode, "local");
});

// ── batchBlocks (multi-selection edits) ──────────────────

test("memory store: batchBlocks create/update/delete in one call", async () => {
    const store = createMemoryStore();
    const a = await store.createBlock({
        block_type: "box", x: 0, y: 0, width: 10, height: 3,
    });
    const b = await store.createBlock({
        block_type: "box", x: 12, y: 0, width: 10, height: 3,
    });

    const result = await store.batchBlocks({
        create: [{ block_type: "button", x: 0, y: 5, width: 8, height: 1, content: "Go" }],
        update: [{ id: a.id, x: 4 }, { id: b.id, border_style: "dashed" }],
        delete: [b.id],
    });
    assert.equal(result.created.length, 1);
    assert.equal(result.updated.length, 1);
    assert.deepEqual(result.deleted, [b.id]);

    const data = await store.load();
    assert.equal(data.blocks.length, 2); // a (moved) + the new button
    const moved = data.blocks.find((x) => x.id === a.id);
    assert.equal(moved.x, 4);
    const created = data.blocks.find((x) => x.id === result.created[0].id);
    assert.equal(created.block_type, "button");
    assert.equal(created.content, "Go");
});

test("memory store: batchBlocks auto-assigns sequential orders", async () => {
    const store = createMemoryStore();
    await store.createBlock({ block_type: "box", x: 0, y: 0, width: 10, height: 3 });

    const result = await store.batchBlocks({
        create: [
            { block_type: "box", x: 0, y: 5, width: 10, height: 3 },
            { block_type: "box", x: 12, y: 5, width: 10, height: 3 },
        ],
    });
    const orders = result.created.map((b) => b.order).sort((x, y) => x - y);
    assert.deepEqual(orders, [2, 3]);
});

test("memory store: batchBlocks normalizes line thickness", async () => {
    const store = createMemoryStore();
    const line = await store.createBlock({
        block_type: "hline", x: 0, y: 0, width: 20, height: 1,
    });

    const result = await store.batchBlocks({
        create: [{ block_type: "vline", x: 0, y: 0, width: 4, height: 10 }],
        update: [{ id: line.id, height: 5, width: 30 }],
    });
    assert.equal(result.created[0].width, 1);
    assert.equal(result.created[0].height, 10);
    assert.equal(result.updated[0].height, 1);
    assert.equal(result.updated[0].width, 30);
});

test("memory store: batchBlocks skips unknown ids", async () => {
    const store = createMemoryStore();
    const a = await store.createBlock({ block_type: "box", x: 0, y: 0, width: 10, height: 3 });

    const result = await store.batchBlocks({
        update: [{ id: "no-such-block", x: 99 }, { id: a.id, x: 7 }],
        delete: ["no-such-block"],
    });
    assert.equal(result.updated.length, 1);
    assert.equal(result.updated[0].id, a.id);
    assert.equal(result.updated[0].x, 7);
    assert.deepEqual(result.deleted, []);
});

test("memory store: batchBlocks with an empty payload is a no-op", async () => {
    const store = createMemoryStore();
    await store.createBlock({ block_type: "box", x: 0, y: 0, width: 10, height: 3 });

    const result = await store.batchBlocks({});
    assert.deepEqual(result.created, []);
    assert.deepEqual(result.updated, []);
    assert.deepEqual(result.deleted, []);
    assert.equal((await store.load()).blocks.length, 1);
});

test("local store: batchBlocks persists in one save", async () => {
    const storage = makeStorage();
    const store = createLocalStorageStore({ key: KEY, storage });
    const a = await store.createBlock({
        block_type: "box", x: 0, y: 0, width: 10, height: 3,
    });

    let saves = 0;
    const origSetItem = storage.setItem;
    storage.setItem = (k, v) => { saves++; origSetItem(k, v); };

    await store.batchBlocks({
        create: [{ block_type: "button", x: 0, y: 5, width: 8, height: 1 }],
        update: [{ id: a.id, x: 4 }],
    });
    // One mutation → exactly one save
    assert.equal(saves, 1);

    const saved = JSON.parse(storage.getItem(KEY));
    assert.equal(saved.blocks.length, 2);
    assert.equal(saved.blocks.find((b) => b.id === a.id).x, 4);
});
