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

// ── Schema ────────────────────────────────────────────────

test("schema: the current properties are described (phase 3 set)", () => {
    const keys = PGProperties.PROPERTY_SCHEMA.map(p => p.key);
    assert.deepEqual(keys, [
        "border_style", "border_h", "border_v", "fill",
        "text_align", "vertical_align", "arrow_start", "arrow_end",
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
    // Fill (phase 2 of tasks/0051): meta key, charpicker; " " (space) is a
    // real fill value (erases the block below); "none" is a display
    // sentinel for the absent value (noneValue: null clears it)
    const fill = PGProperties.findProperty("fill");
    assert.equal(fill.meta, true);
    assert.equal(fill.kind, "charpicker");
    assert.deepEqual(fill.options, ["░", "▒", "▓", "█", "·", "×", " ", "none"]);
    assert.equal(fill.icons[" "], "␣"); // the space button shows a glyph
    assert.equal(fill.icons.none, "∅");
    assert.equal(fill.group, "Fill");
    assert.equal(fill.default, "none");
    assert.equal(fill.noneValue, null);
    assert.ok(fill.types.includes("image"));
    assert.ok(!fill.types.includes("button"));
    assert.ok(!fill.types.includes("text"));
    assert.ok(!fill.types.includes("hline"));
    // Alignment (phase 3 of tasks/0051): meta keys, segmented; picking
    // the default clears the meta key (clearDefault — the default is
    // implicit). Not applicable to lines.
    for (const [key, options, defaultValue] of [
        ["text_align", ["left", "center", "right"], "left"],
        ["vertical_align", ["top", "middle", "bottom"], "top"],
    ]) {
        const prop = PGProperties.findProperty(key);
        assert.equal(prop.meta, true);
        assert.equal(prop.kind, "segmented");
        assert.deepEqual(prop.options, options);
        assert.equal(prop.group, "Align");
        assert.equal(prop.default, defaultValue);
        assert.equal(prop.clearDefault, true);
        assert.ok(prop.types.includes("button"));
        assert.ok(!prop.types.includes("hline"));
        assert.ok(!prop.types.includes("vline"));
    }
    // Arrows (phase 3 of tasks/0051): meta keys, segmented, lines only;
    // six head shapes; "none" is a display sentinel (noneValue: null
    // clears it); the button glyphs depend on the line direction (icons
    // as a function)
    for (const key of ["arrow_start", "arrow_end"]) {
        const prop = PGProperties.findProperty(key);
        assert.equal(prop.meta, true);
        assert.equal(prop.kind, "segmented");
        assert.deepEqual(prop.options, ["none", "arrow", "arrow-open", "diamond",
            "diamond-open", "circle", "circle-open"]);
        assert.equal(prop.group, "Arrows");
        assert.deepEqual(prop.types, ["hline", "vline"]);
        assert.equal(prop.default, "none");
        assert.equal(prop.noneValue, null);
        assert.equal(typeof prop.icons, "function");
    }
    assert.equal(PGProperties.findProperty("arrow_start").icons("hline", "arrow"), "◀");
    assert.equal(PGProperties.findProperty("arrow_start").icons("vline", "arrow"), "▲");
    assert.equal(PGProperties.findProperty("arrow_end").icons("hline", "arrow"), "▶");
    assert.equal(PGProperties.findProperty("arrow_end").icons("vline", "arrow"), "▼");
    assert.equal(PGProperties.findProperty("arrow_start").icons("hline", "arrow-open"), "◁");
    assert.equal(PGProperties.findProperty("arrow_end").icons("vline", "arrow-open"), "▽");
    assert.equal(PGProperties.findProperty("arrow_start").icons("hline", "diamond"), "◆");
    assert.equal(PGProperties.findProperty("arrow_end").icons("vline", "diamond-open"), "◇");
    assert.equal(PGProperties.findProperty("arrow_start").icons("hline", "circle"), "●");
    assert.equal(PGProperties.findProperty("arrow_end").icons("vline", "circle-open"), "○");
    assert.equal(PGProperties.findProperty("arrow_start").icons("hline", "none"), "∅");
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
    const fillProp = PGProperties.findProperty("fill");
    const withFill = block("b1", "box", 0, 0, 5, 2, { meta: { fill: "░" } });
    assert.equal(PGProperties.readPropValue(withFill, fillProp), "░");
    // Absent → the schema default ("none" for fill)
    const without = block("b2", "box", 0, 0, 5, 2);
    assert.equal(PGProperties.readPropValue(without, fillProp), "none");
    // A block without a meta object at all
    const noMeta = block("b3", "box", 0, 0, 5, 2);
    delete noMeta.meta;
    assert.equal(PGProperties.readPropValue(noMeta, fillProp), "none");
});

// ── Sections ──────────────────────────────────────────────

test("sectionsForType: groups in declaration order, all properties applicable", () => {
    const sections = PGProperties.sectionsForType("box");
    assert.deepEqual(sections.map(s => s.name),
        ["Style", "Borders", "Fill", "Align", "Geometry", "Text"]);
    assert.deepEqual(sections[0].props.map(p => p.key), ["border_style"]);
    assert.deepEqual(sections[1].props.map(p => p.key), ["border_h", "border_v"]);
    assert.deepEqual(sections[2].props.map(p => p.key), ["fill"]);
    assert.deepEqual(sections[3].props.map(p => p.key), ["text_align", "vertical_align"]);
    assert.deepEqual(
        sections[4].props.map(p => p.key),
        ["x", "y", "width", "height", "order"],
    );
    assert.deepEqual(sections[5].props.map(p => p.key), ["content"]);
});

test("sectionsForType: Borders/Fill are not applicable to button and lines", () => {
    for (const type of ["button", "hline", "vline"]) {
        const sections = PGProperties.sectionsForType(type);
        assert.ok(!sections.some(s => s.name === "Borders"), type);
        assert.ok(!sections.some(s => s.name === "Fill"), type);
    }
    // Align applies to all content types (including button — text_align
    // aligns the label) but not to lines
    for (const type of ["hline", "vline"]) {
        assert.ok(!PGProperties.sectionsForType(type).some(s => s.name === "Align"), type);
    }
    assert.ok(PGProperties.sectionsForType("button").some(s => s.name === "Align"));
});

test("sectionsForType: Arrows are applicable to lines only", () => {
    for (const type of ["hline", "vline"]) {
        const arrows = PGProperties.sectionsForType(type).find(s => s.name === "Arrows");
        assert.ok(arrows, type);
        assert.deepEqual(arrows.props.map(p => p.key), ["arrow_start", "arrow_end"]);
    }
    for (const type of ["box", "button", "text"]) {
        assert.ok(!PGProperties.sectionsForType(type).some(s => s.name === "Arrows"), type);
    }
});

test("sectionsForType: the types filter drops inapplicable properties and empty groups", () => {
    PGProperties.PROPERTY_SCHEMA.push({
        key: "temp_prop", meta: true, label: "Temp", kind: "segmented",
        options: ["a", "b"], group: "TempGroup",
        types: ["hline"], default: "a",
    });
    try {
        // box: the TempGroup has no applicable property → dropped
        assert.ok(!PGProperties.sectionsForType("box").some(s => s.name === "TempGroup"));
        // hline: the TempGroup appears with its single property
        const line = PGProperties.sectionsForType("hline");
        const temp = line.find(s => s.name === "TempGroup");
        assert.ok(temp);
        assert.deepEqual(temp.props.map(p => p.key), ["temp_prop"]);
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
        ["Style", "Borders", "Fill", "Align", "Geometry", "Text"],
    );
    // A line: no Borders/Fill/Align, but Arrows
    const line = appWith([block("b1", "hline", 0, 0, 5, 1)], ["b1"]);
    assert.deepEqual(
        line.panelSections.map(s => s.name),
        ["Style", "Arrows", "Geometry", "Text"],
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

test("propValue: meta properties read block.meta (absent → default)", () => {
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

    // Absent on a single block → the default "none" (the ∅ button is
    // active, like border_style=none in the Style section)
    const single = appWith([block("a", "box", 0, 0, 5, 2)], ["a"]);
    assert.equal(single.propValue("fill"), "none");
    assert.equal(single.propActive("fill", "none"), true);
    assert.equal(single.propActive("fill", "░"), false);

    // Space fill is a real value (not the "none" sentinel) — it is read
    // back and highlights its own button
    const space = appWith([block("a", "box", 0, 0, 5, 2, { meta: { fill: " " } })], ["a"]);
    assert.equal(space.propValue("fill"), " ");
    assert.equal(space.propActive("fill", " "), true);
    assert.equal(space.propActive("fill", "none"), false);
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
    const app = appWith([
        block("b1", "box", 0, 0, 5, 2, { meta: { keep: 1 } }),
    ], ["b1"]);
    const calls = stubStore(app);
    await app.applyPropValue(PGProperties.findProperty("fill"), "░");

    assert.deepEqual(calls.update[0].props, { meta: { keep: 1, fill: "░" } });
    assert.deepEqual(app.blocks[0].meta, { keep: 1, fill: "░" });
});

test("applyPropValue: a null meta value clears the key (back to default)", async () => {
    const app = appWith([
        block("b1", "box", 0, 0, 5, 2, { meta: { keep: 1, fill: "░" } }),
    ], ["b1"]);
    const calls = stubStore(app);
    await app.applyPropValue(PGProperties.findProperty("fill"), null);

    assert.deepEqual(calls.update[0].props, { meta: { keep: 1 } });
    assert.deepEqual(app.blocks[0].meta, { keep: 1 });
});

test("applyPropValue: a multi-selection is one batch update with per-block meta", async () => {
    const app = appWith([
        block("a", "box", 0, 0, 5, 2, { meta: { a: 1 } }),
        block("b", "box", 0, 0, 5, 2, { meta: { b: 2 } }),
    ], ["a", "b"]);
    const calls = stubStore(app);
    await app.applyPropValue(PGProperties.findProperty("fill"), "▒");

    assert.equal(calls.batch.length, 1);
    assert.deepEqual(calls.batch[0].update, [
        { id: "a", meta: { a: 1, fill: "▒" } },
        { id: "b", meta: { b: 2, fill: "▒" } },
    ]);
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
    const app = appWith([
        block("b1", "box", 0, 0, 5, 2, { meta: { keep: 1 } }),
    ], ["b1"]);
    app.store = {
        updateBlock: async () => { throw new Error("boom"); },
    };
    await app.applyPropValue(PGProperties.findProperty("fill"), "░");
    assert.deepEqual(app.blocks[0].meta, { keep: 1 });
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

test("onPropSelect: the 'none' option applies noneValue (clears the meta key)", () => {
    const app = appWith([block("b1", "box", 3, 4, 5, 6)], ["b1"]);
    const applied = [];
    app.applyPropValue = (prop, value) => applied.push([prop.key, value]);

    // fill declares noneValue: null — "none" is a display sentinel
    app.onPropSelect(PGProperties.findProperty("fill"), "none");
    assert.deepEqual(applied, [["fill", null]]);

    // A property without noneValue stores "none" as-is
    app.onPropSelect(PGProperties.findProperty("border_style"), "none");
    assert.deepEqual(applied, [["fill", null], ["border_style", "none"]]);
});

test("onPropSelect: picking the default clears the meta key (clearDefault)", () => {
    const app = appWith([block("b1", "box", 3, 4, 5, 6)], ["b1"]);
    const applied = [];
    app.applyPropValue = (prop, value) => applied.push([prop.key, value]);

    // text_align declares clearDefault — "left" (the default) clears the key
    app.onPropSelect(PGProperties.findProperty("text_align"), "left");
    assert.deepEqual(applied, [["text_align", null]]);

    // A non-default value is stored as-is
    app.onPropSelect(PGProperties.findProperty("text_align"), "center");
    assert.deepEqual(applied, [["text_align", null], ["text_align", "center"]]);

    // A property without clearDefault stores its default as-is
    app.onPropSelect(PGProperties.findProperty("border_style"), "solid");
    assert.deepEqual(applied, [
        ["text_align", null], ["text_align", "center"],
        ["border_style", "solid"],
    ]);
});

test("propIcon: static icon maps and type-dependent icon functions", () => {
    const app = appWith([block("b1", "box", 0, 0, 5, 2)], ["b1"]);
    // Static map (fill): the space button shows a glyph, the rest as-is
    assert.equal(app.propIcon(PGProperties.findProperty("fill"), " "), "␣");
    assert.equal(app.propIcon(PGProperties.findProperty("fill"), "none"), "∅");
    assert.equal(app.propIcon(PGProperties.findProperty("fill"), "█"), "█");
    // No icons at all → the option itself
    assert.equal(app.propIcon(PGProperties.findProperty("border_style"), "solid"), "─");
    assert.equal(app.propIcon(PGProperties.findProperty("text_align"), "center"), "center");

    // Type-dependent function (arrows): the glyph follows the selected
    // block's line direction
    const start = PGProperties.findProperty("arrow_start");
    const end = PGProperties.findProperty("arrow_end");
    const hline = appWith([block("b1", "hline", 0, 0, 5, 1)], ["b1"]);
    assert.equal(hline.propIcon(start, "arrow"), "◀");
    assert.equal(hline.propIcon(end, "arrow"), "▶");
    assert.equal(hline.propIcon(start, "diamond"), "◆");
    assert.equal(hline.propIcon(start, "none"), "∅");
    const vline = appWith([block("b1", "vline", 0, 0, 1, 5)], ["b1"]);
    assert.equal(vline.propIcon(start, "arrow"), "▲");
    assert.equal(vline.propIcon(end, "arrow"), "▼");
    assert.equal(vline.propIcon(end, "circle"), "●");
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
