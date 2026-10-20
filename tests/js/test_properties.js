/**
 * Tests for the declarative property schema (core/properties.js) and the
 * editor's panel state: sections (always open, no collapse), mixed
 * display for multi-selection, and meta-merge updates.
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
        "border_style", "fill",
        "text_align", "vertical_align", "arrow_start", "arrow_end",
        "x", "y", "width", "height", "order", "content",
    ]);
    const style = PGProperties.findProperty("border_style");
    assert.equal(style.kind, "segmented");
    assert.deepEqual(style.options, PGRenderer.BORDER_STYLES);
    assert.equal(style.group, "Style");
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
    // implicit). Not applicable to lines. row: "align" — the pair shares
    // one panel row (one button group each, one shared label).
    // iconPrefix: the buttons show SVG icons (static/icons/align-*.svg,
    // masked in editor.css) instead of the option text.
    for (const [key, options, defaultValue] of [
        ["text_align", ["left", "center", "right"], "left"],
        ["vertical_align", ["top", "middle", "bottom"], "top"],
    ]) {
        const prop = PGProperties.findProperty(key);
        assert.equal(prop.meta, true);
        assert.equal(prop.kind, "segmented");
        assert.deepEqual(prop.options, options);
        assert.equal(prop.iconPrefix, "align");
        assert.equal(prop.group, "Align");
        assert.equal(prop.row, "align");
        assert.equal(prop.default, defaultValue);
        assert.equal(prop.clearDefault, true);
        assert.ok(prop.types.includes("button"));
        assert.ok(!prop.types.includes("hline"));
        assert.ok(!prop.types.includes("vline"));
    }
    assert.equal(PGProperties.findProperty("text_align").rowLabel, "Align");
    // Arrows (phase 3 of tasks/0051): meta keys, select (two selects
    // share one row — 14 buttons don't fit the panel width), lines only;
    // six head shapes; "none" is a display sentinel (noneValue: null
    // clears it); the option glyphs depend on the line direction (icons
    // as a function)
    for (const key of ["arrow_start", "arrow_end"]) {
        const prop = PGProperties.findProperty(key);
        assert.equal(prop.meta, true);
        assert.equal(prop.kind, "select");
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
    // Geometry: three columns (X Y W / H Order) — the section body grid
    // is widened by cols: 3
    for (const key of ["x", "y", "width", "height", "order"]) {
        assert.equal(PGProperties.findProperty(key).cols, 3, key);
    }
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
        ["Style", "Fill", "Align", "Geometry", "Text"]);
    assert.deepEqual(sections[0].props.map(p => p.key), ["border_style"]);
    assert.deepEqual(sections[1].props.map(p => p.key), ["fill"]);
    assert.deepEqual(sections[2].props.map(p => p.key), ["text_align", "vertical_align"]);
    assert.deepEqual(
        sections[3].props.map(p => p.key),
        ["x", "y", "width", "height", "order"],
    );
    assert.deepEqual(sections[4].props.map(p => p.key), ["content"]);
});

test("sectionsForType: rows group the Align pair, Geometry widens to 3 columns", () => {
    const sections = PGProperties.sectionsForType("box");
    const align = sections.find(s => s.name === "Align");
    // Two properties → one group row (a shared label, a button group
    // each)
    assert.equal(align.rows.length, 1);
    assert.equal(align.rows[0].kind, "group");
    assert.equal(align.rows[0].label, "Align");
    assert.deepEqual(align.rows[0].props.map(p => p.key),
        ["text_align", "vertical_align"]);
    const geometry = sections.find(s => s.name === "Geometry");
    assert.equal(geometry.cols, 3);
    assert.equal(geometry.rows.length, 5);
    for (const row of geometry.rows) {
        assert.equal(row.props.length, 1);
        assert.equal(row.kind, row.prop.kind);
    }
    // The other sections: one row per property, two columns
    for (const s of sections) {
        if (s.name === "Align" || s.name === "Geometry") continue;
        assert.equal(s.cols, 2, s.name);
        assert.equal(s.rows.length, s.props.length, s.name);
    }
});

test("rowsForProps: a lone row property keeps its own label", () => {
    const rows = PGProperties.rowsForProps([
        PGProperties.findProperty("text_align"),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "segmented");
    assert.equal(rows[0].label, "H Align");
    assert.deepEqual(rows[0].props.map(p => p.key), ["text_align"]);
});

test("sectionsForType: Fill is not applicable to button and lines", () => {
    for (const type of ["button", "hline", "vline"]) {
        const sections = PGProperties.sectionsForType(type);
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
    // Sections are always open (no collapse, no headers): the name is a
    // data attribute, there is no head button or x-show on the body
    assert.ok(html.includes(':data-section="section.name"'));
    assert.ok(!html.includes("props-section__head"));
    assert.ok(!html.includes("isSectionOpen"));
    assert.ok(!html.includes("toggleSection"));
    // Rows: the section body iterates the section's rows (a group row
    // renders a shared label + a button group per property; the rest by
    // row.kind)
    assert.ok(html.includes('x-for="row in section.rows"'));
    assert.ok(html.includes('x-if="row.kind === \'group\'"'));
    assert.ok(html.includes('x-if="row.kind === \'number\'"'));
    assert.ok(html.includes('x-if="row.kind === \'select\'"'));
    assert.ok(html.includes('class="align-row"'));
    assert.ok(html.includes("x-text=\"row.label\""));
    // The 3-column Geometry grid is switched by the section's cols
    assert.ok(html.includes("'props-section__body--3col': section.cols === 3"));
    // The change handlers and selection bindings
    assert.ok(html.includes("onPropNumber(row.prop, $event)"));
    assert.ok(html.includes("onPropText(row.prop, $event)"));
    assert.ok(html.includes("onPropSelect(row.prop, $event.target.value)"));
    assert.ok(html.includes("isMixedProp(row.prop.key)"));
    // Group rows bind per property (the inner x-for's loop variable)
    assert.ok(html.includes("onPropSelect(prop, opt)"));
    // Button classes come from styleBtnClasses (active state + the SVG
    // icon class for iconPrefix properties); the option text stays in
    // the button as a fallback (hidden by CSS only after the editor
    // verifies the mask image loads — the `align-icons-ok` class)
    assert.ok(html.includes("styleBtnClasses(prop, opt)"));
    assert.ok(html.includes("styleBtnClasses(row.prop, opt)"));
    assert.ok(html.includes('x-text="propIcon(prop, opt)"'));
    // Select options show the icon glyphs (arrow heads)
    assert.ok(html.includes('x-text="propIcon(row.prop, opt)"'));
    // The select's current value is bound per option (:selected), not on
    // the select (:value): Alpine initializes the select's own directives
    // before its x-for children exist, so a :value binding would run with
    // an empty option list and never select the current value (the first
    // option shows until the selection changes)
    assert.ok(html.includes(':selected="propValue(row.prop.key) === opt"'));
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
        ["Style", "Fill", "Align", "Geometry", "Text"],
    );
    // A line: no Fill/Align, but Arrows
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

test("styleBtnClasses: active state + the SVG icon classes (iconPrefix)", () => {
    const app = appWith([
        block("b1", "box", 0, 0, 5, 2, { meta: { text_align: "center" } }),
    ], ["b1"]);
    const hAlign = PGProperties.findProperty("text_align");
    const vAlign = PGProperties.findProperty("vertical_align");
    // iconPrefix property: the active class + the generic icon class +
    // the per-option mask class (static/icons/align-<opt>.svg)
    assert.deepEqual(app.styleBtnClasses(hAlign, "center"), {
        "style-btn--active": true,
        "style-btn--icon": true,
        "style-btn--align-center": true,
    });
    assert.deepEqual(app.styleBtnClasses(hAlign, "left"), {
        "style-btn--active": false,
        "style-btn--icon": true,
        "style-btn--align-left": true,
    });
    assert.deepEqual(app.styleBtnClasses(vAlign, "bottom"), {
        "style-btn--active": false,
        "style-btn--icon": true,
        "style-btn--align-bottom": true,
    });
    // A glyph property (no iconPrefix) keeps the plain active binding
    const style = PGProperties.findProperty("border_style");
    assert.deepEqual(app.styleBtnClasses(style, "solid"),
        { "style-btn--active": true });
    assert.deepEqual(app.styleBtnClasses(style, "dashed"),
        { "style-btn--active": false });
});

test("maskUrlFromComputed: extracts the mask image URL (icon fallback)", () => {
    const app = appWith([block("b1", "box", 0, 0, 5, 2)], ["b1"]);
    // Computed mask values (browser-quoted and bare) → the URL
    assert.equal(
        app.maskUrlFromComputed('url("file:///a/static/icons/align-left.svg")'),
        "file:///a/static/icons/align-left.svg");
    assert.equal(
        app.maskUrlFromComputed("url(http://127.0.0.1:8000/static/icons/align-left.svg)"),
        "http://127.0.0.1:8000/static/icons/align-left.svg");
    assert.equal(app.maskUrlFromComputed("url('a/b.svg')"), "a/b.svg");
    // A data: URI inlined with single-quoted SVG attributes: the URL
    // contains single quotes, so the outer double quoting must win
    // (a naive [^"')]+ match would truncate at the first ')
    const dataUri =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24'/%3E";
    assert.equal(
        app.maskUrlFromComputed(`url("${dataUri}")`),
        dataUri);
    assert.equal(
        app.maskUrlFromComputed(`url('${dataUri.replace(/'/g, '"')}')`),
        dataUri.replace(/'/g, '"'));
    // No url() → null (the fallback text stays)
    assert.equal(app.maskUrlFromComputed("none"), null);
    assert.equal(app.maskUrlFromComputed(""), null);
    assert.equal(app.maskUrlFromComputed(null), null);
});

