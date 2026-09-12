/**
 * Tests for the layout import module (core/import.js).
 *
 * Run with: node --test tests/js/
 *
 * parseLayoutJson bridges the nested export format (type/metadata/children)
 * to the editor's flat block list; prepareImport regenerates ids and shifts
 * orders so an import is a clean, collision-free state change.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const { parseLayoutJson, prepareImport } = require("../../boxframe/static/js/core/import.js");

// A nested export as produced by LayoutService.export_json / buildExportJson.
const sampleExport = {
    id: "layout-1",
    name: "Test",
    width: 40,
    height: 12,
    blocks: [
        {
            id: "b1",
            type: "box",
            x: 0, y: 0, width: 20, height: 6,
            content: "Parent",
            border_style: "solid",
            metadata: { tag: "root" },
            order: 0,
            children: [
                {
                    id: "b2",
                    type: "button",
                    x: 1, y: 1, width: 10, height: 1,
                    content: "Click",
                    border_style: "dashed",
                    metadata: {},
                    order: 1,
                },
            ],
        },
        {
            id: "b3",
            type: "text",
            x: 25, y: 2, width: 10, height: 2,
            content: "Hello",
            border_style: "none",
            metadata: {},
            order: 2,
        },
    ],
};

// ── parseLayoutJson ───────────────────────────────────────

test("parseLayoutJson: flattens nested export into a flat list", () => {
    const parsed = parseLayoutJson(sampleExport);
    assert.equal(parsed.width, 40);
    assert.equal(parsed.height, 12);
    assert.equal(parsed.blocks.length, 3);

    // Field name conversion: type -> block_type, metadata -> meta
    const parent = parsed.blocks.find((b) => b.id === "b1");
    assert.equal(parent.block_type, "box");
    assert.deepEqual(parent.meta, { tag: "root" });
    assert.equal(parent.parent_id, null);

    // Children are flattened with parent_id set
    const child = parsed.blocks.find((b) => b.id === "b2");
    assert.equal(child.block_type, "button");
    assert.equal(child.parent_id, "b1");
    assert.equal(child.border_style, "dashed");
});

test("parseLayoutJson: preserves order when present", () => {
    const parsed = parseLayoutJson(sampleExport);
    const byId = Object.fromEntries(parsed.blocks.map((b) => [b.id, b.order]));
    assert.deepEqual(byId, { b1: 0, b2: 1, b3: 2 });
});

test("parseLayoutJson: assigns order by document order when absent", () => {
    const json = {
        blocks: [
            { id: "a", type: "box", x: 0, y: 0, width: 5, height: 2 },
            { id: "b", type: "text", x: 1, y: 1, content: "hi" },
        ],
    };
    const parsed = parseLayoutJson(json);
    const byId = Object.fromEntries(parsed.blocks.map((b) => [b.id, b.order]));
    assert.deepEqual(byId, { a: 0, b: 1 });
});

test("parseLayoutJson: applies defaults for missing fields", () => {
    const parsed = parseLayoutJson({ blocks: [{ id: "x" }] });
    const b = parsed.blocks[0];
    assert.equal(b.block_type, "box");
    assert.equal(b.x, 0);
    assert.equal(b.y, 0);
    assert.equal(b.width, 20);
    assert.equal(b.height, 3);
    assert.equal(b.content, "");
    assert.equal(b.border_style, "solid");
    assert.deepEqual(b.meta, {});
    assert.equal(b.parent_id, null);
});

test("parseLayoutJson: generates an id when missing", () => {
    const parsed = parseLayoutJson({ blocks: [{ type: "box" }] });
    assert.ok(parsed.blocks[0].id);
});

test("parseLayoutJson: throws when the blocks array is missing", () => {
    assert.throws(() => parseLayoutJson(null));
    assert.throws(() => parseLayoutJson({}));
    assert.throws(() => parseLayoutJson({ blocks: "nope" }));
});

test("parseLayoutJson: unset dimensions become null", () => {
    const parsed = parseLayoutJson({ blocks: [{ id: "a", type: "box" }] });
    assert.equal(parsed.width, null);
    assert.equal(parsed.height, null);
});

// ── prepareImport ─────────────────────────────────────────

function parsedBlocks() {
    return parseLayoutJson(sampleExport).blocks;
}

test("prepareImport replace: regenerates ids and keeps orders", () => {
    const blocks = parsedBlocks();
    const prepared = prepareImport(blocks, null, "replace");
    assert.equal(prepared.length, 3);

    // Fresh ids, no overlap with the originals, all unique
    const origIds = new Set(blocks.map((b) => b.id));
    const newIds = prepared.map((b) => b.id);
    for (const id of newIds) assert.ok(!origIds.has(id));
    assert.equal(new Set(newIds).size, 3);

    // Orders kept
    const byType = Object.fromEntries(prepared.map((b) => [b.block_type, b.order]));
    assert.deepEqual(byType, { box: 0, button: 1, text: 2 });

    // parent_id remapped to the new child id
    const parent = prepared.find((b) => b.block_type === "box");
    const child = prepared.find((b) => b.block_type === "button");
    assert.equal(child.parent_id, parent.id);
});

test("prepareImport add: shifts orders above the existing maximum", () => {
    const blocks = parsedBlocks();
    const existing = [
        { id: "e1", order: 5 },
        { id: "e2", order: 7 },
    ];
    const prepared = prepareImport(blocks, existing, "add");
    const orders = prepared.map((b) => b.order).sort((a, b) => a - b);
    // Imported orders (0,1,2) shifted above the existing max (7) -> 8,9,10
    assert.deepEqual(orders, [8, 9, 10]);
});

test("prepareImport add: no id collision with existing blocks", () => {
    const blocks = parsedBlocks();
    // One existing block shares an id with an imported block
    const existing = [{ id: "b1", order: 0 }];
    const prepared = prepareImport(blocks, existing, "add");
    const newIds = prepared.map((b) => b.id);
    assert.ok(!newIds.includes("b1"));
    assert.equal(new Set(newIds).size, 3);
});

test("prepareImport add: remaps parent_id among the new ids", () => {
    const blocks = parsedBlocks();
    const prepared = prepareImport(blocks, [{ id: "e", order: 0 }], "add");
    const parent = prepared.find((b) => b.block_type === "box");
    const child = prepared.find((b) => b.block_type === "button");
    assert.equal(child.parent_id, parent.id);
    assert.notEqual(parent.id, "b1"); // regenerated
});
