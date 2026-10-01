/**
 * Tests for the declarative property schema (core/properties.js) and the
 * editor's panel state: sections, mixed display for multi-selection,
 * meta-merge updates, and the section open/closed persistence.
 *
 * Run with: node --test tests/js/
 */

const { test } = require("node:test");
const assert = require("node:assert");
// renderer.js sets global.PGRenderer (the schema reads BORDER_STYLES from it)
require("../../boxframe/static/js/core/renderer.js");
const PGProperties = require("../../boxframe/static/js/core/properties.js");
const { editorApp } = require("../../boxframe/static/js/editor.js");

function block(id, block_type, x, y, width, height, extra) {
    return Object.assign({
        id, block_type, x, y, width, height,
        content: "", border_style: "solid",
        parent_id: null, meta: {}, order: 0,
    }, extra || {});
}

function appWith(blocks, selectedIds) {
    const app = editorApp();
    app.blocks = blocks;
    app.selectedIds = selectedIds || [];
    app.refreshRender = async () => {};
    return app;
}

// A store double that records updateBlock / batchBlocks calls and merges
// the results into the local block list (like the real stores do).
function stubStore(app) {
    const calls = { update: [], batch: [] };
    app.store = {
        updateBlock: async (id, props) => {
            calls.update.push({ id, props });
            const b = app.blocks.find(x => x.id === id);
            return Object.assign({}, b, props);
        },
        batchBlocks: async (payload) => {
            calls.batch.push(payload);
            (payload.update || []).forEach(u =>
                Object.assign(app.blocks.find(b => b.id === u.id), u));
            return { updated: payload.update || [], created: [], deleted: [] };
        },
    };
    return calls;
}

// A meta property pushed into the schema for the meta-related tests
// (phases 1-3 of tasks/0051 add the real ones).
const FILL_PROP = {
    key: "fill", meta: true, label: "Fill", kind: "charpicker",
    options: ["░", "▒"], group: "Fill", default: null,
};

// ── Schema ────────────────────────────────────────────────

test("schema: the current properties are described (phase 1 set)", () => {
    const keys = PGProperties.PROPERTY_SCHEMA.map(p => p.key);
    assert.deepEqual(keys, [
        "border_style", "border_h", "border_v",
        "x", "y", "width", "height", "order", "content",
    ]);
    const style = PGProperties.findProperty("border_style");
    assert.equal(style.kind, "segmented");
    assert.deepEqual(style.options, PGRenderer.BORDER_STYLES);
    assert.equal(style.group, "Style");
    // Per-side border overrides (phase 1 of tasks/0051): meta keys,
    // absent = inherit the base border_style
    for (const key of ["border_h", "border_v"]) {
        const prop = PGProperties.findProperty(key);
        assert.equal(prop.meta, true);
        assert.equal(prop.kind, "segmented");
        assert.deepEqual(prop.options, PGRenderer.BORDER_STYLES);
        assert.equal(prop.group, "Borders");
        assert.equal(prop.default, null);
        assert.ok(!prop.types.includes("button"));
        assert.ok(!prop.types.includes("hline"));
        assert.ok(!prop.types.includes("vline"));
    }
    assert.equal(PGProperties.findProperty("x").min, 0);
    assert.equal(PGProperties.findProperty("width").min, 1);
    assert.equal(PGProperties.findProperty("content").kind, "text");
});

test("findProperty: unknown keys are not in the schema", () => {
    assert.equal(PGProperties.findProperty("nope"), null);
});

test("readPropValue: direct properties read block[key]", () => {
    const b = block("b1", "box", 3, 4, 5, 6);
    assert.equal(PGProperties.readPropValue(b, PGProperties.findProperty("x")), 3);
    assert.equal(
        PGProperties.readPropValue(b, PGProperties.findProperty("border_style")),
        "solid",
    );
});

test("readPropValue: meta properties read block.meta[key], absent → default", () => {
    PGProperties.PROPERTY_SCHEMA.push(FILL_PROP);
    try {
        const withFill = block("b1", "box", 0, 0, 5, 2, { meta: { fill: "░" } });
        assert.equal(PGProperties.readPropValue(withFill, FILL_PROP), "░");
        const without = block("b2", "box", 0, 0, 5, 2);
        assert.equal(PGProperties.readPropValue(without, FILL_PROP), null);
        // A block without a meta object at all
        const noMeta = block("b3", "box", 0, 0, 5, 2);
        delete noMeta.meta;
        assert.equal(PGProperties.readPropValue(noMeta, FILL_PROP), null);
    } finally {
        PGProperties.PROPERTY_SCHEMA.pop();
    }
});

// ── Sections ──────────────────────────────────────────────

test("sectionsForType: groups in declaration order, all properties applicable", () => {
    const sections = PGProperties.sectionsForType("box");
    assert.deepEqual(sections.map(s => s.name), ["Style", "Borders", "Geometry", "Text"]);
    assert.deepEqual(sections[0].props.map(p => p.key), ["border_style"]);
    assert.deepEqual(sections[1].props.map(p => p.key), ["border_h", "border_v"]);
    assert.deepEqual(
        sections[2].props.map(p => p.key),
        ["x", "y", "width", "height", "order"],
    );
    assert.deepEqual(sections[3].props.map(p => p.key), ["content"]);
});

test("sectionsForType: border_h/border_v are not applicable to button and lines", () => {
    for (const type of ["button", "hline", "vline"]) {
        const sections = PGProperties.sectionsForType(type);
        assert.ok(!sections.some(s => s.name === "Borders"), type);
    }
});

test("sectionsForType: the types filter drops inapplicable properties and empty groups", () => {
    PGProperties.PROPERTY_SCHEMA.push({
        key: "arrow_end", meta: true, label: "Arrow End", kind: "segmented",
        options: ["none", "arrow", "double"], group: "Arrows",
        types: ["hline", "vline"], default: "none",
    });
    try {
        // box: the Arrows group has no applicable property → dropped
        assert.ok(!PGProperties.sectionsForType("box").some(s => s.name === "Arrows"));
        // hline: the Arrows group appears with its single property
        const line = PGProperties.sectionsForType("hline");
        const arrows = line.find(s => s.name === "Arrows");
        assert.ok(arrows);
        assert.deepEqual(arrows.props.map(p => p.key), ["arrow_end"]);
    } finally {
        PGProperties.PROPERTY_SCHEMA.pop();
    }
});

test("buildPropsPanelHTML: the markup binds to the editor app's state", () => {
    const html = PGProperties.buildPropsPanelHTML();
    assert.ok(html.includes('x-for="section in panelSections"'));
    assert.ok(html.includes("toggleSection(section.name)"));
    assert.ok(html.includes("isSectionOpen(section.name)"));
    assert.ok(html.includes("x-if=\"prop.kind === 'number'\""));
    assert.ok(html.includes("onPropNumber(prop, $event)"));
    assert.ok(html.includes("onPropText(prop, $event)"));
    assert.ok(html.includes("onPropSelect(prop, opt)"));
    assert.ok(html.includes("isMixedProp(prop.key)"));
    assert.ok(html.includes("propActive(prop.key, opt)"));
});

// ── panelSections (editor app) ────────────────────────────

test("panelSections: empty without a selection", () => {
    const app = appWith([block("b1", "box", 0, 0, 5, 2)], []);
    assert.deepEqual(app.panelSections, []);
});

test("panelSections: the sections of the primary selected block's type", () => {
    const app = appWith([block("b1", "box", 0, 0, 5, 2)], ["b1"]);
    assert.deepEqual(
        app.panelSections.map(s => s.name),
        ["Style", "Borders", "Geometry", "Text"],
    );
});

// ── Mixed display (multi-selection) ───────────────────────

test("propValue: a single selection shows its value", () => {
    const app = appWith([block("b1", "box", 3, 4, 5, 6)], ["b1"]);
    assert.equal(app.propValue("x"), 3);
    assert.equal(app.propValue("border_style"), "solid");
});

test("propValue: a multi-selection with equal values shows the value", () => {
    const app = appWith([
        block("a", "box", 0, 0, 5, 2, { border_style: "dashed" }),
        block("b", "box", 0, 0, 5, 2, { border_style: "dashed" }),
    ], ["a", "b"]);
    assert.equal(app.propValue("border_style"), "dashed");
    assert.equal(app.isMixedProp("border_style"), false);
});

test("propValue: differing values across the selection are mixed (\"\" + no active)", () => {
    const app = appWith([
        block("a", "box", 0, 0, 5, 2, { border_style: "solid" }),
        block("b", "box", 0, 0, 5, 2, { border_style: "dashed" }),
    ], ["a", "b"]);
    assert.equal(app.propValue("border_style"), "");
    assert.equal(app.isMixedProp("border_style"), true);
    assert.equal(app.propActive("border_style", "solid"), false);
    assert.equal(app.propActive("border_style", "dashed"), false);
});

test("propActive: a single selection highlights its value only", () => {
    const app = appWith([block("b1", "box", 0, 0, 5, 2)], ["b1"]);
    assert.equal(app.propActive("border_style", "solid"), true);
    assert.equal(app.propActive("border_style", "dashed"), false);
});

test("propValue: meta properties read block.meta (absent → \"\")", () => {
    PGProperties.PROPERTY_SCHEMA.push(FILL_PROP);
    try {
        const app = appWith([
            block("a", "box", 0, 0, 5, 2, { meta: { fill: "░" } }),
            block("b", "box", 0, 0, 5, 2, { meta: { fill: "░" } }),
        ], ["a", "b"]);
        assert.equal(app.propValue("fill"), "░");
        assert.equal(app.propActive("fill", "░"), true);

        // Mixed: one block has the fill, the other does not
        const mixed = appWith([
            block("a", "box", 0, 0, 5, 2, { meta: { fill: "░" } }),
            block("b", "box", 0, 0, 5, 2),
        ], ["a", "b"]);
        assert.equal(mixed.propValue("fill"), "");
        assert.equal(mixed.isMixedProp("fill"), true);

        // Absent on a single block → "" (no active button)
        const single = appWith([block("a", "box", 0, 0, 5, 2)], ["a"]);
        assert.equal(single.propValue("fill"), "");
        assert.equal(single.propActive("fill", "░"), false);
    } finally {
        PGProperties.PROPERTY_SCHEMA.pop();
    }
});

// ── applyPropValue ────────────────────────────────────────

test("applyPropValue: a single non-meta property is one block update", async () => {
    const app = appWith([block("b1", "box", 3, 4, 5, 6)], ["b1"]);
    const calls = stubStore(app);
    await app.applyPropValue(PGProperties.findProperty("x"), 10);

    assert.equal(calls.update.length, 1);
    assert.equal(calls.update[0].id, "b1");
    assert.deepEqual(calls.update[0].props, { x: 10 });
    assert.equal(app.blocks[0].x, 10);
});

test("applyPropValue: an order change re-sorts the block list", async () => {
    const app = appWith([
        block("a", "box", 0, 0, 5, 2, { order: 0 }),
        block("b", "box", 0, 0, 5, 2, { order: 1 }),
    ], ["a"]);
    app._reorderBlocks();
    stubStore(app);
    await app.applyPropValue(PGProperties.findProperty("order"), 5);

    assert.equal(app.blocks[0].id, "a");
    assert.equal(app.blocks[0].order, 5);
});

test("applyPropValue: a meta property is merged into the block's meta", async () => {
    PGProperties.PROPERTY_SCHEMA.push(FILL_PROP);
    try {
        const app = appWith([
            block("b1", "box", 0, 0, 5, 2, { meta: { keep: 1 } }),
        ], ["b1"]);
        const calls = stubStore(app);
        await app.applyPropValue(FILL_PROP, "░");

        assert.deepEqual(calls.update[0].props, { meta: { keep: 1, fill: "░" } });
        assert.deepEqual(app.blocks[0].meta, { keep: 1, fill: "░" });
    } finally {
        PGProperties.PROPERTY_SCHEMA.pop();
    }
});

test("applyPropValue: a null meta value clears the key (back to default)", async () => {
    PGProperties.PROPERTY_SCHEMA.push(FILL_PROP);
    try {
        const app = appWith([
            block("b1", "box", 0, 0, 5, 2, { meta: { keep: 1, fill: "░" } }),
        ], ["b1"]);
        const calls = stubStore(app);
        await app.applyPropValue(FILL_PROP, null);

        assert.deepEqual(calls.update[0].props, { meta: { keep: 1 } });
        assert.deepEqual(app.blocks[0].meta, { keep: 1 });
    } finally {
        PGProperties.PROPERTY_SCHEMA.pop();
    }
});

test("applyPropValue: a multi-selection is one batch update with per-block meta", async () => {
    PGProperties.PROPERTY_SCHEMA.push(FILL_PROP);
    try {
        const app = appWith([
            block("a", "box", 0, 0, 5, 2, { meta: { a: 1 } }),
            block("b", "box", 0, 0, 5, 2, { meta: { b: 2 } }),
        ], ["a", "b"]);
        const calls = stubStore(app);
        await app.applyPropValue(FILL_PROP, "▒");

        assert.equal(calls.batch.length, 1);
        assert.deepEqual(calls.batch[0].update, [
            { id: "a", meta: { a: 1, fill: "▒" } },
            { id: "b", meta: { b: 2, fill: "▒" } },
        ]);
    } finally {
        PGProperties.PROPERTY_SCHEMA.pop();
    }
});

test("applyPropValue: a failed single update rolls back the value", async () => {
    const app = appWith([block("b1", "box", 3, 4, 5, 6)], ["b1"]);
    app.store = {
        updateBlock: async () => { throw new Error("boom"); },
    };
    await app.applyPropValue(PGProperties.findProperty("x"), 10);
    assert.equal(app.blocks[0].x, 3);
});

test("applyPropValue: a failed meta update rolls back the meta", async () => {
    PGProperties.PROPERTY_SCHEMA.push(FILL_PROP);
    try {
        const app = appWith([
            block("b1", "box", 0, 0, 5, 2, { meta: { keep: 1 } }),
        ], ["b1"]);
        app.store = {
            updateBlock: async () => { throw new Error("boom"); },
        };
        await app.applyPropValue(FILL_PROP, "░");
        assert.deepEqual(app.blocks[0].meta, { keep: 1 });
    } finally {
        PGProperties.PROPERTY_SCHEMA.pop();
    }
});

// ── Control handlers ──────────────────────────────────────

test("onPropNumber: a valid value is applied", () => {
    const app = appWith([block("b1", "box", 3, 4, 5, 6)], ["b1"]);
    const applied = [];
    app.applyPropValue = (prop, value) => applied.push([prop.key, value]);

    app.onPropNumber(PGProperties.findProperty("x"), { target: { value: "10" } });
    assert.deepEqual(applied, [["x", 10]]);
});

test("onPropNumber: a value below the schema minimum is clamped", () => {
    const app = appWith([block("b1", "box", 3, 4, 5, 6)], ["b1"]);
    const applied = [];
    app.applyPropValue = (prop, value) => applied.push([prop.key, value]);

    app.onPropNumber(PGProperties.findProperty("width"), { target: { value: "0" } });
    assert.deepEqual(applied, [["width", 1]]);
});

test("onPropNumber: an invalid value restores the input and applies nothing", () => {
    const app = appWith([block("b1", "box", 3, 4, 5, 6)], ["b1"]);
    let applied = null;
    app.applyPropValue = (prop, value) => { applied = [prop.key, value]; };

    const target = { value: "abc" };
    app.onPropNumber(PGProperties.findProperty("x"), { target });
    assert.equal(applied, null);
    assert.equal(target.value, 3);
});

test("onPropText / onPropSelect: the value is applied as-is", () => {
    const app = appWith([block("b1", "box", 3, 4, 5, 6)], ["b1"]);
    const applied = [];
    app.applyPropValue = (prop, value) => applied.push([prop.key, value]);

    app.onPropText(PGProperties.findProperty("content"), { target: { value: "Hi" } });
    app.onPropSelect(PGProperties.findProperty("border_style"), "dashed");
    assert.deepEqual(applied, [["content", "Hi"], ["border_style", "dashed"]]);
});

// ── Section open/closed state (localStorage) ──────────────

function fakeLocalStorage() {
    const data = {};
    return {
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
        _data: data,
    };
}

test("sections: new sections are collapsed by default", () => {
    const app = appWith([block("b1", "box", 0, 0, 5, 2)], ["b1"]);
    assert.equal(app.isSectionOpen("Style"), false);
    assert.equal(app.isSectionOpen("Geometry"), false);
});

test("sections: a toggle opens the section and persists the state", () => {
    const storage = fakeLocalStorage();
    globalThis.localStorage = storage;
    try {
        const app = appWith([block("b1", "box", 0, 0, 5, 2)], ["b1"]);
        app._loadSectionState();

        app.toggleSection("Geometry");
        assert.equal(app.isSectionOpen("Geometry"), true);
        assert.equal(app.isSectionOpen("Style"), false);
        assert.equal(storage._data["boxframe.props.sections"], '{"Geometry":true}');

        // Toggle back → collapsed
        app.toggleSection("Geometry");
        assert.equal(app.isSectionOpen("Geometry"), false);
    } finally {
        delete globalThis.localStorage;
    }
});

test("sections: the persisted state survives a new app instance (reload)", () => {
    const storage = fakeLocalStorage();
    globalThis.localStorage = storage;
    try {
        const first = appWith([block("b1", "box", 0, 0, 5, 2)], ["b1"]);
        first._loadSectionState();
        first.toggleSection("Text");

        // A "reloaded" editor restores the user's choice
        const second = appWith([block("b1", "box", 0, 0, 5, 2)], ["b1"]);
        second._loadSectionState();
        assert.equal(second.isSectionOpen("Text"), true);
        assert.equal(second.isSectionOpen("Style"), false);
    } finally {
        delete globalThis.localStorage;
    }
});

test("sections: a corrupted persisted state falls back to all-collapsed", () => {
    const storage = fakeLocalStorage();
    storage._data["boxframe.props.sections"] = "{not json";
    globalThis.localStorage = storage;
    try {
        const app = appWith([block("b1", "box", 0, 0, 5, 2)], ["b1"]);
        app._loadSectionState();
        assert.deepEqual(app.sectionState, {});
    } finally {
        delete globalThis.localStorage;
    }
});
