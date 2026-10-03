/**
 * Tests for the JS pseudo-graphic renderer (mirror of tests/test_renderer.py).
 *
 * Run with: node --test tests/js/
 *
 * The JS renderer takes a FLAT block list (children reference the parent via
 * parent_id, x/y relative to the parent) — the same shape the editor store
 * works with. The Python render_simple() takes nested dicts with `children`;
 * the scenarios below are the same, just flattened.
 */

const { test } = require("node:test");
const assert = require("node:assert");
const PG = require("../../boxframe/static/js/core/renderer.js");

function render(blocks, width = 40, height = 12) {
    return PG.render(blocks, width, height);
}

function lines(s) {
    return s.split("\n");
}

test("empty layout", () => {
    const result = render([], 40, 12);
    assert.ok(lines(result.trim()).length <= 12);
});

test("render strips trailing empty rows", () => {
    // Trailing empty rows are not part of the art (clean exports/copies)
    const result = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "solid",
    }], 40, 12);
    const ls = lines(result);
    assert.equal(ls.length, 4); // canvas is 40×12, the box ends at row 3
    assert.ok(!result.endsWith("\n"));
});

test("render empty layout is empty string", () => {
    assert.equal(render([], 40, 12), "");
});

test("single box", () => {
    const result = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "solid",
    }]);
    const ls = lines(result);
    // Top border
    assert.equal(ls[0][0], "┌");
    assert.equal(ls[0][9], "┐");
    assert.ok([...ls[0].slice(1, 9)].every(c => c === "─"));
    // Middle row
    assert.equal(ls[1][0], "│");
    assert.equal(ls[1][9], "│");
    // Bottom border
    assert.equal(ls[3][0], "└");
    assert.equal(ls[3][9], "┘");
    assert.ok([...ls[3].slice(1, 9)].every(c => c === "─"));
});

test("box with content", () => {
    const result = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 12, height: 3,
        content: "Submit", border_style: "solid",
    }]);
    assert.ok(lines(result)[1].includes("Submit"));
});

test("nested blocks", () => {
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 20, height: 6,
            content: "", border_style: "solid",
        },
        {
            id: "c", block_type: "text",
            x: 1, y: 1, width: 8, height: 1,
            content: "Hello", border_style: "none",
            parent_id: "p",
        },
    ]);
    const ls = lines(result);
    assert.equal(ls[0][0], "┌");
    // "Hello" should be inside the box (parent y=0 + pad 1 + child y=1 → row 2)
    assert.ok(ls[2].includes("Hello"));
});

test("border styles", () => {
    const corners = {
        solid: ["┌", "┐"],
        dashed: ["┌", "┐"],
        dotted: ["┌", "┐"],
        double: ["╔", "╗"],
    };
    for (const style of ["solid", "dashed", "dotted", "double"]) {
        const result = render([{
            id: "b1", block_type: "box",
            x: 0, y: 0, width: 6, height: 3,
            content: "", border_style: style,
        }]);
        const ls = lines(result);
        assert.equal(ls[0][0], corners[style][0]);
        assert.equal(ls[0][5], corners[style][1]);
    }
});

test("no border", () => {
    const result = render([{
        id: "b1", block_type: "text",
        x: 2, y: 2, width: 10, height: 2,
        content: "Free text", border_style: "none",
    }]);
    assert.ok(lines(result)[2].includes("Free text"));
});

test("multiple blocks", () => {
    const result = render([
        {
            id: "b1", block_type: "header",
            x: 0, y: 0, width: 30, height: 3,
            content: "My App", border_style: "solid",
        },
        {
            id: "b2", block_type: "content",
            x: 0, y: 3, width: 30, height: 6,
            content: "Main content area", border_style: "solid",
        },
    ]);
    const ls = lines(result);
    assert.ok(ls[1].includes("My App"));
    assert.ok(ls[4].includes("Main content area"));
});

test("grid expansion", () => {
    const result = render([{
        id: "b1", block_type: "box",
        x: 35, y: 10, width: 10, height: 4,
        content: "", border_style: "solid",
    }], 40, 14);
    const ls = lines(result);
    // Canvas is the 80×24 default floor — the full box is drawn, not clamped
    assert.equal(ls[10][35], "┌");
    assert.equal(ls[10][44], "┐");
    assert.equal(ls[13][35], "└");
    assert.equal(ls[13][44], "┘");
});

test("canvasSize expands to fit blocks", () => {
    // Set dimensions below the default floor keep the floor
    assert.deepEqual(PG.canvasSize([], 40, 12), [80, 24]);
    assert.deepEqual(PG.canvasSize([{
        id: "b1", block_type: "box",
        x: 35, y: 10, width: 10, height: 4,
    }], 40, 14), [80, 24]);
    // Children counted with 1-cell container padding:
    // child absolute x = 70 + 1 + 5 = 76, extends to 86 > 80
    assert.deepEqual(PG.canvasSize([
        { id: "p", block_type: "box", x: 70, y: 0, width: 10, height: 10 },
        { id: "c", block_type: "text", x: 5, y: 0, width: 10, height: 2, parent_id: "p" },
    ], 80, 24), [86, 24]);
});

test("canvasSize without dimensions", () => {
    // Unset dimensions (null) fall back to the default canvas (80×24)
    assert.deepEqual(PG.canvasSize([], null, null), [80, 24]);
    assert.deepEqual(PG.canvasSize([{
        id: "b1", block_type: "box",
        x: 5, y: 2, width: 10, height: 3,
    }], null, null), [80, 24]);
    // A set dimension smaller than the default keeps the default floor
    assert.deepEqual(PG.canvasSize([{
        id: "b1", block_type: "box",
        x: 5, y: 2, width: 10, height: 3,
    }], 40, null), [80, 24]);
    // A set dimension larger than the default raises the floor for that axis
    assert.deepEqual(PG.canvasSize([{
        id: "b1", block_type: "box",
        x: 5, y: 2, width: 10, height: 3,
    }], 100, null), [100, 24]);
});

test("renderBoundsHtml draws a line for set dimensions only", () => {
    const html = PG.renderBoundsHtml({ width: 40, height: 12, charWidthPx: 12, charHeightPx: 14.4, paddingOffset: 16 });
    assert.ok(html.includes('class="layout-bounds layout-bounds--v"'));
    assert.ok(html.includes('class="layout-bounds layout-bounds--h"'));
    // Vertical line at x=40: 16 + 40*12 = 496px; horizontal at y=12: 16 + 12*14.4
    assert.ok(html.includes("left:496px"));
    assert.ok(html.includes("top:188.8px"));

    assert.equal(PG.renderBoundsHtml({ width: null, height: null }), "");
    assert.ok(!PG.renderBoundsHtml({ width: null, height: 12 }).includes("layout-bounds--v"));
    assert.ok(!PG.renderBoundsHtml({ width: 40, height: null }).includes("layout-bounds--h"));
});

test("renderHtml includes bounds for set dimensions", () => {
    const blocks = [{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 3,
        content: "", border_style: "solid", order: 0,
    }];
    const withBounds = PG.renderHtml(
        PG.render(blocks, 40, 12), blocks,
        { width: 40, height: 12, charWidthPx: 12, charHeightPx: 14.4, paddingOffset: 16 }
    );
    assert.ok(withBounds.includes("layout-bounds--v"));
    assert.ok(withBounds.includes("layout-bounds--h"));

    const noBounds = PG.renderHtml(
        PG.render(blocks, null, null), blocks,
        { width: null, height: null, charWidthPx: 12, charHeightPx: 14.4, paddingOffset: 16 }
    );
    assert.ok(!noBounds.includes("layout-bounds"));
});

test("double border", () => {
    const result = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 6, height: 3,
        content: "", border_style: "double",
    }]);
    const ls = lines(result);
    assert.equal(ls[0][0], "╔");
    assert.equal(ls[0][5], "╗");
    assert.ok([...ls[0].slice(1, 5)].every(c => c === "═"));
});

// ── Per-side border tests (tasks/0051, phase 1) ───────────

function psBox(meta, extra) {
    return Object.assign({
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 8, height: 4,
        content: "", border_style: "solid",
    }, meta ? { meta } : {}, extra || {});
}

test("effectiveBorderStyles: absent keys inherit the base style", () => {
    assert.deepEqual(PG.effectiveBorderStyles("solid", null), ["solid", "solid"]);
    assert.deepEqual(PG.effectiveBorderStyles("solid", {}), ["solid", "solid"]);
    assert.deepEqual(PG.effectiveBorderStyles("solid", { border_h: "dashed" }), ["dashed", "solid"]);
    assert.deepEqual(PG.effectiveBorderStyles("solid", { border_v: "none" }), ["solid", "none"]);
    assert.deepEqual(PG.effectiveBorderStyles("none", { border_v: "double" }), ["none", "double"]);
    // An empty string inherits the base style
    assert.deepEqual(PG.effectiveBorderStyles("dotted", { border_h: "" }), ["dotted", "dotted"]);
});

test("per-side solid/dashed: solid horizontals, dashed verticals", () => {
    const result = render([psBox({ border_h: "solid", border_v: "dashed" })]);
    const ls = lines(result);
    assert.equal(ls[0], "┌──────┐");
    assert.equal(ls[1], "┆[box] ┆");
    assert.equal(ls[2], "┆      ┆");
    assert.equal(ls[3], "└──────┘");
});

test("per-side solid/double (spec example): double corners win", () => {
    const result = render([psBox({ border_h: "solid", border_v: "double" })]);
    const ls = lines(result);
    assert.equal(ls[0], "╔──────╗");
    assert.equal(ls[1], "║[box] ║");
    assert.equal(ls[2], "║      ║");
    assert.equal(ls[3], "╚──────╝");
});

test("per-side dashed/double: double corners, styled edges", () => {
    const result = render([psBox({ border_h: "dashed", border_v: "double" })]);
    const ls = lines(result);
    assert.equal(ls[0], "╔┄┄┄┄┄┄╗");
    assert.equal(ls[1], "║[box] ║");
    assert.equal(ls[3], "╚┄┄┄┄┄┄╝");
});

test("per-side h=none: no top/bottom edges or corners, verticals end to end", () => {
    const result = render([psBox({ border_h: "none" })]);
    const ls = lines(result);
    assert.equal(ls[0], "│[box] │"); // no top edge, hint on the first row
    assert.equal(ls[1], "│      │");
    assert.equal(ls[2], "│      │");
    assert.equal(ls[3], "│      │"); // no bottom edge, verticals span full height
});

test("per-side v=none: no left/right edges or corners", () => {
    const result = render([psBox({ border_v: "none" })]);
    const ls = lines(result);
    assert.equal(ls[0], "─".repeat(8));
    assert.equal(ls[1], "[box]");
    assert.equal(ls[2], "");
    assert.equal(ls[3], "─".repeat(8));
});

test("per-side double h only: no corners or verticals", () => {
    const result = render([psBox({ border_h: "double", border_v: "none" })]);
    const ls = lines(result);
    assert.equal(ls[0], "═".repeat(8));
    assert.equal(ls[1], "[box]");
    assert.equal(ls[3], "═".repeat(8));
});

test("per-side both none: no border, no type hint", () => {
    const result = render([psBox({ border_h: "none", border_v: "none" })]);
    assert.equal(result.trim(), "");
});

test("per-side base none + v override: verticals only, hint at content origin", () => {
    const result = render([psBox({ border_v: "solid" }, { border_style: "none" })]);
    const ls = lines(result);
    assert.equal(ls[0], "│[box] │");
    assert.equal(ls[1], "│      │");
    assert.equal(ls[2], "│      │");
    assert.equal(ls[3], "│      │");
});

test("per-side content inset only where a border is drawn", () => {
    const result = render([psBox({ border_h: "none" }, { content: "Hi" })]);
    const ls = lines(result);
    assert.equal(ls[0], "│Hi    │"); // content on the first row (no top inset)
    assert.equal(ls[1], "│      │");
    assert.equal(ls[2], "│      │");
    assert.equal(ls[3], "│      │");
});

test("per-side empty meta inherits the base style", () => {
    const plain = render([psBox(null)]);
    const emptyMeta = render([psBox({})]);
    assert.equal(plain, emptyMeta);
});

test("per-side button ignores meta (global border_style)", () => {
    const plain = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 16, height: 3,
        content: "Button", border_style: "solid",
    }]);
    const withMeta = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 16, height: 3,
        content: "Button", border_style: "solid",
        meta: { border_h: "dashed", border_v: "dotted" },
    }]);
    assert.equal(withMeta, plain);
});

test("per-side lines ignore meta (global line style)", () => {
    const plain = render([{
        id: "b1", block_type: "hline",
        x: 0, y: 0, width: 8, height: 1,
        content: "", border_style: "solid",
    }]);
    const withMeta = render([{
        id: "b1", block_type: "hline",
        x: 0, y: 0, width: 8, height: 1,
        content: "", border_style: "solid",
        meta: { border_h: "double", border_v: "dashed" },
    }]);
    assert.equal(withMeta, plain);
});

test("per-side children container: 1-cell padding and clip", () => {
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 20, height: 6,
            content: "", border_style: "solid",
            meta: { border_v: "none" },
        },
        {
            id: "c", block_type: "text",
            x: 1, y: 1, width: 8, height: 1,
            content: "Hello", border_style: "none",
            parent_id: "p",
        },
    ]);
    const ls = lines(result);
    assert.equal(ls[0], "─".repeat(20)); // top edge end to end (V=none → no corners)
    assert.equal(ls[2], "  Hello");      // child at parent origin + 1-cell padding
    assert.equal(ls[5], "─".repeat(20)); // bottom edge end to end
});

// ── Fill tests (tasks/0051, phase 2) ──────────────────────

function fillBox(meta, extra) {
    return Object.assign({
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 8, height: 4,
        content: "", border_style: "solid",
    }, meta ? { meta } : {}, extra || {});
}

test("fillChar: single-cell values for applicable types only", () => {
    assert.equal(PG.fillChar("box", { fill: "░" }), "░");
    assert.equal(PG.fillChar("image", { fill: "█" }), "█");
    assert.equal(PG.fillChar("box", { fill: " " }), " "); // space is a valid fill
    assert.equal(PG.fillChar("box", null), "");
    assert.equal(PG.fillChar("box", {}), "");
    assert.equal(PG.fillChar("box", { fill: "" }), "");
    assert.equal(PG.fillChar("box", { fill: "ab" }), ""); // more than one cell
    assert.equal(PG.fillChar("box", { fill: 5 }), "");    // not a string
    // Not in the fill matrix
    for (const t of ["button", "input", "textarea", "text", "divider", "hline", "vline"]) {
        assert.equal(PG.fillChar(t, { fill: "░" }), "");
    }
});

test("fill empty box: content area painted, hint suppressed", () => {
    const result = render([fillBox({ fill: "░" })]);
    const ls = lines(result);
    assert.equal(ls[0], "┌──────┐");
    assert.equal(ls[1], "│░░░░░░│");
    assert.equal(ls[2], "│░░░░░░│");
    assert.equal(ls[3], "└──────┘");
});

test("fill suppresses the type hint", () => {
    const result = render([fillBox({ fill: "█" })]);
    assert.ok(!result.includes("[box]"));
});

test("fill content on top: content wins", () => {
    const result = render([fillBox({ fill: "░" }, { content: "Hi" })]);
    const ls = lines(result);
    assert.equal(ls[1], "│Hi░░░░│");
    assert.equal(ls[2], "│░░░░░░│");
});

test("fill wrapped content: each line over the fill", () => {
    // The wrap keeps the trailing space of the first line (spaces are
    // formatting) — it is drawn over the fill like any content cell.
    const result = render([fillBox({ fill: "·" }, { content: "Hello World" })]);
    const ls = lines(result);
    assert.equal(ls[1], "│Hello │"); // trailing space overwrites the fill
    assert.equal(ls[2], "│World·│");
});

test("fill no border: the whole area is filled", () => {
    const result = render([fillBox({ fill: "▒" }, { border_style: "none", width: 6, height: 3 })]);
    const ls = lines(result);
    assert.equal(ls[0], "▒▒▒▒▒▒");
    assert.equal(ls[1], "▒▒▒▒▒▒");
    assert.equal(ls[2], "▒▒▒▒▒▒");
});

test("fill respects the per-side inset (H=none → no top/bottom inset)", () => {
    const result = render([fillBox({ fill: "░", border_h: "none" })]);
    const ls = lines(result);
    assert.equal(ls[0], "│░░░░░░│");
    assert.equal(ls[1], "│░░░░░░│");
    assert.equal(ls[2], "│░░░░░░│");
    assert.equal(ls[3], "│░░░░░░│");
});

test("fill ignored for other types (matrix)", () => {
    const cases = [
        { block_type: "button", width: 12, height: 3, content: "Btn" },
        { block_type: "text", width: 10, height: 2, content: "t", border_style: "none" },
        { block_type: "input", width: 10, height: 2, content: "" },
        { block_type: "divider", width: 10, height: 1, content: "" },
        { block_type: "hline", width: 10, height: 1, content: "" },
        { block_type: "vline", width: 1, height: 5, content: "" },
    ];
    for (const c of cases) {
        const base = { id: "b1", x: 0, y: 0, border_style: "solid", order: 0 };
        const plain = render([Object.assign({}, c, base)]);
        const withFill = render([Object.assign({}, c, base, { meta: { fill: "░" } })]);
        assert.equal(withFill, plain, c.block_type);
    }
});

test("fill invalid values: no fill", () => {
    const plain = render([fillBox(null)]);
    for (const bad of ["ab", "", 5, null]) {
        assert.equal(render([fillBox({ fill: bad })]), plain, String(bad));
    }
});

test("fill image block: hint suppressed, area filled", () => {
    const result = render([{
        id: "b1", block_type: "image",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "solid",
        meta: { fill: "█" },
    }]);
    const ls = lines(result);
    assert.equal(ls[0], "┌────────┐");
    assert.equal(ls[1], "│████████│");
    assert.equal(ls[2], "│████████│");
    assert.equal(ls[3], "└────────┘");
});

test("fill children container: children drawn over the fill", () => {
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 20, height: 6,
            content: "", border_style: "solid",
            meta: { fill: "░" },
        },
        {
            id: "c", block_type: "text",
            x: 1, y: 1, width: 8, height: 1,
            content: "Hello", border_style: "none",
            parent_id: "p",
        },
    ]);
    const ls = lines(result);
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[1], "│" + "░".repeat(18) + "│");
    assert.equal(ls[2], "│░Hello" + "░".repeat(12) + "│");
    assert.equal(ls[3], "│" + "░".repeat(18) + "│");
    assert.equal(ls[4], "│" + "░".repeat(18) + "│");
    assert.equal(ls[5], "└" + "─".repeat(18) + "┘");
});

test("fill space: erases the block below (show-through)", () => {
    // A space fill (meta.fill=" ") erases the block underneath. Without a
    // fill the lower content shows through (the upper [box] hint covers the
    // first cells, the rest stays visible); with a space fill the upper
    // block's blank fill overwrites it (the grid is space-initialized).
    const lower = {
        id: "a", block_type: "box",
        x: 0, y: 0, width: 12, height: 3,
        content: "ABCDEFGHIJ", border_style: "solid", order: 0,
    };
    const showThrough = render([
        lower,
        Object.assign({}, lower, { id: "b", content: "", order: 1 }),
    ]);
    assert.ok(showThrough.includes("FGHIJ"));

    const result = render([
        lower,
        Object.assign({}, lower, { id: "b", content: "", order: 1, meta: { fill: " " } }),
    ]);
    const ls = lines(result);
    assert.equal(ls[0], "┌──────────┐");
    assert.equal(ls[1], "│          │"); // 10 spaces — the lower content is erased
    assert.equal(ls[2], "└──────────┘");
    assert.ok(!result.includes("ABCDEFGHIJ"));
});

// ── Line block tests (hline / vline) ──────────────────────

test("hline solid", () => {
    const result = render([{
        id: "b1", block_type: "hline",
        x: 2, y: 3, width: 8, height: 1,
        content: "", border_style: "solid",
    }]);
    assert.equal(lines(result)[3].slice(2, 10), "────────");
});

test("hline all styles", () => {
    const chars = { solid: "─", dashed: "┄", dotted: "┈", double: "═" };
    for (const [style, ch] of Object.entries(chars)) {
        const result = render([{
            id: "b1", block_type: "hline",
            x: 0, y: 0, width: 5, height: 1,
            content: "", border_style: style,
        }]);
        assert.equal(lines(result)[0].slice(0, 5), ch.repeat(5));
    }
});

test("vline solid", () => {
    const result = render([{
        id: "b1", block_type: "vline",
        x: 4, y: 1, width: 1, height: 4,
        content: "", border_style: "solid",
    }]);
    const ls = lines(result);
    for (let i = 1; i < 5; i++) {
        assert.equal(ls[i][4], "│");
    }
});

test("vline all styles", () => {
    const chars = { solid: "│", dashed: "┆", dotted: "┊", double: "║" };
    for (const [style, ch] of Object.entries(chars)) {
        const result = render([{
            id: "b1", block_type: "vline",
            x: 0, y: 0, width: 1, height: 4,
            content: "", border_style: style,
        }]);
        const ls = lines(result);
        for (let i = 0; i < 4; i++) {
            assert.equal(ls[i][0], ch);
        }
    }
});

test("line none is invisible", () => {
    const result = render([{
        id: "b1", block_type: "hline",
        x: 0, y: 0, width: 5, height: 1,
        content: "", border_style: "none",
    }]);
    assert.equal(result.trim(), "");
});

test("line ignores content", () => {
    const result = render([{
        id: "b1", block_type: "hline",
        x: 0, y: 0, width: 8, height: 1,
        content: "text", border_style: "solid",
    }]);
    assert.equal(lines(result)[0], "────────");
});

test("hline beyond layout", () => {
    const result = render([{
        id: "b1", block_type: "hline",
        x: 35, y: 0, width: 20, height: 1,
        content: "", border_style: "solid",
    }], 40, 12);
    // Canvas is the 80×24 default floor — the full line is drawn
    assert.equal(lines(result)[0].slice(35), "─".repeat(20));
});

// ── Line arrows (tasks/0051 phase 3) ──────────────────────

test("arrowGlyph: line-end glyphs for applicable types only", () => {
    const hline = {
        "arrow": ["◀", "▶"],
        "arrow-open": ["◁", "▷"],
        "diamond": ["◆", "◆"],
        "diamond-open": ["◇", "◇"],
        "circle": ["●", "●"],
        "circle-open": ["○", "○"],
    };
    const vline = {
        "arrow": ["▲", "▼"],
        "arrow-open": ["△", "▽"],
        "diamond": ["◆", "◆"],
        "diamond-open": ["◇", "◇"],
        "circle": ["●", "●"],
        "circle-open": ["○", "○"],
    };
    for (const [value, [start, end]] of Object.entries(hline)) {
        assert.equal(PG.arrowGlyph("hline", value, "start"), start);
        assert.equal(PG.arrowGlyph("hline", value, "end"), end);
    }
    for (const [value, [start, end]] of Object.entries(vline)) {
        assert.equal(PG.arrowGlyph("vline", value, "start"), start);
        assert.equal(PG.arrowGlyph("vline", value, "end"), end);
    }
    // Absent / "none" / invalid → no arrow (the legacy "double" is invalid)
    for (const value of [null, "none", "", "foo", 5, "double"]) {
        assert.equal(PG.arrowGlyph("hline", value, "start"), "");
        assert.equal(PG.arrowGlyph("vline", value, "end"), "");
    }
    // Not a line type
    assert.equal(PG.arrowGlyph("box", "arrow", "start"), "");
});

test("hline arrow both ends", () => {
    const result = render([{
        id: "b1", block_type: "hline",
        x: 0, y: 0, width: 8, height: 1,
        content: "", border_style: "solid",
        meta: { arrow_start: "arrow", arrow_end: "arrow" },
    }]);
    assert.equal(lines(result)[0].slice(0, 8), "◀──────▶");
});

test("hline all arrow shapes", () => {
    const shapes = {
        "arrow": "◀──────▶",
        "arrow-open": "◁──────▷",
        "diamond": "◆──────◆",
        "diamond-open": "◇──────◇",
        "circle": "●──────●",
        "circle-open": "○──────○",
    };
    for (const [value, expected] of Object.entries(shapes)) {
        const result = render([{
            id: "b1", block_type: "hline",
            x: 0, y: 0, width: 8, height: 1,
            content: "", border_style: "solid",
            meta: { arrow_start: value, arrow_end: value },
        }]);
        assert.equal(lines(result)[0].slice(0, 8), expected, value);
    }
});

test("hline arrow one end", () => {
    const result = render([{
        id: "b1", block_type: "hline",
        x: 0, y: 0, width: 8, height: 1,
        content: "", border_style: "solid",
        meta: { arrow_end: "arrow" },
    }]);
    assert.equal(lines(result)[0].slice(0, 8), "───────▶");
});

test("vline arrow both ends", () => {
    const result = render([{
        id: "b1", block_type: "vline",
        x: 0, y: 0, width: 1, height: 8,
        content: "", border_style: "solid",
        meta: { arrow_start: "arrow", arrow_end: "arrow" },
    }]);
    const ls = lines(result);
    assert.equal(ls[0][0], "▲");
    assert.equal(ls[7][0], "▼");
    for (let i = 1; i < 7; i++) {
        assert.equal(ls[i][0], "│");
    }
});

test("vline all arrow shapes", () => {
    const shapes = {
        "arrow": ["▲", "▼"],
        "arrow-open": ["△", "▽"],
        "diamond": ["◆", "◆"],
        "diamond-open": ["◇", "◇"],
        "circle": ["●", "●"],
        "circle-open": ["○", "○"],
    };
    for (const [value, [top, bottom]] of Object.entries(shapes)) {
        const result = render([{
            id: "b1", block_type: "vline",
            x: 0, y: 0, width: 1, height: 8,
            content: "", border_style: "solid",
            meta: { arrow_start: value, arrow_end: value },
        }]);
        const ls = lines(result);
        assert.equal(ls[0][0], top, value);
        assert.equal(ls[7][0], bottom, value);
    }
});

test("arrow short line ignored", () => {
    // A line shorter than 2 cells has no arrows
    const result = render([{
        id: "b1", block_type: "hline",
        x: 0, y: 0, width: 1, height: 1,
        content: "", border_style: "solid",
        meta: { arrow_start: "arrow", arrow_end: "arrow" },
    }]);
    assert.equal(lines(result)[0].slice(0, 1), "─");
});

test("arrow two-cell line", () => {
    // A 2-cell line is exactly the two arrow cells
    const result = render([{
        id: "b1", block_type: "hline",
        x: 0, y: 0, width: 2, height: 1,
        content: "", border_style: "solid",
        meta: { arrow_start: "arrow", arrow_end: "arrow" },
    }]);
    assert.equal(lines(result)[0].slice(0, 2), "◀▶");
});

test("arrow all line styles", () => {
    const chars = { solid: "─", dashed: "┄", dotted: "┈", double: "═" };
    for (const [style, ch] of Object.entries(chars)) {
        const result = render([{
            id: "b1", block_type: "hline",
            x: 0, y: 0, width: 5, height: 1,
            content: "", border_style: style,
            meta: { arrow_start: "arrow", arrow_end: "arrow" },
        }]);
        assert.equal(lines(result)[0].slice(0, 5), "◀" + ch.repeat(3) + "▶");
    }
});

test("arrow ignored for other types (matrix)", () => {
    // Arrows apply only to hline/vline: other blocks render identically
    // with and without meta.arrow_*
    const cases = [
        { block_type: "box", width: 10, height: 3, content: "x" },
        { block_type: "button", width: 10, height: 1, content: "B" },
        { block_type: "text", width: 10, height: 2, content: "t", border_style: "none" },
    ];
    const meta = { arrow_start: "arrow", arrow_end: "diamond" };
    for (const c of cases) {
        const base = { id: "b1", x: 0, y: 0, border_style: "solid", order: 0 };
        const plain = render([Object.assign({}, c, base)]);
        const withArrows = render([Object.assign({}, c, base, { meta })]);
        assert.equal(withArrows, plain, c.block_type);
    }
});

test("arrow invalid values: line unchanged", () => {
    const plain = render([{
        id: "b1", block_type: "hline",
        x: 0, y: 0, width: 6, height: 1,
        content: "", border_style: "solid",
    }]);
    for (const bad of ["foo", "", 5, null, "ARROW", "double"]) {
        assert.equal(render([{
            id: "b1", block_type: "hline",
            x: 0, y: 0, width: 6, height: 1,
            content: "", border_style: "solid",
            meta: { arrow_start: bad, arrow_end: bad },
        }]), plain, String(bad));
    }
});

// ── Text alignment (tasks/0051 phase 3) ───────────────────

function alignBox(meta, content = "Hi", width = 10, height = 4) {
    const data = {
        id: "b1", block_type: "box",
        x: 0, y: 0, width, height,
        content, border_style: "solid",
    };
    if (meta != null) data.meta = meta;
    return [data];
}

test("hAlignOffset / vAlignOffset", () => {
    assert.equal(PG.hAlignOffset(2, 8, "left"), 0);
    assert.equal(PG.hAlignOffset(2, 8, null), 0);
    assert.equal(PG.hAlignOffset(2, 8, "center"), 3); // gap 6 → 3 left
    assert.equal(PG.hAlignOffset(1, 8, "center"), 3); // gap 7 → 3 left, 4 right
    assert.equal(PG.hAlignOffset(2, 8, "right"), 6);
    assert.equal(PG.hAlignOffset(8, 8, "center"), 0); // fills the area
    assert.equal(PG.hAlignOffset(9, 8, "right"), 0);  // overflow — not shifted

    assert.equal(PG.vAlignOffset(1, 3, "top"), 0);
    assert.equal(PG.vAlignOffset(1, 3, null), 0);
    assert.equal(PG.vAlignOffset(1, 3, "middle"), 1); // (3-1)//2
    assert.equal(PG.vAlignOffset(1, 4, "middle"), 1); // (4-1)//2 = 1
    assert.equal(PG.vAlignOffset(1, 3, "bottom"), 2);
    assert.equal(PG.vAlignOffset(3, 3, "middle"), 0); // fills the area
    assert.equal(PG.vAlignOffset(5, 3, "bottom"), 0); // overflow — not shifted
});

test("text align center", () => {
    // Each wrapped line is centered inside the content area
    const result = render(alignBox({ text_align: "center" }));
    const ls = lines(result);
    // content_w = 8, "Hi" (2) → offset 3
    assert.equal(ls[1], "│   Hi   │");
});

test("text align right", () => {
    const result = render(alignBox({ text_align: "right" }));
    assert.equal(lines(result)[1], "│      Hi│");
});

test("text align default left unchanged", () => {
    // No meta / left — the current output (regression)
    const plain = render(alignBox(null));
    assert.equal(plain, render(alignBox({ text_align: "left" })));
    assert.equal(lines(plain)[1], "│Hi      │");
});

test("text align wrapped lines", () => {
    // Every wrapped line is aligned independently. content_w = 8:
    // "Hello World" wraps to "Hello " (6) + "World" (5)
    const result = render(alignBox({ text_align: "right" }, "Hello World"));
    const ls = lines(result);
    assert.equal(ls[1], "│  Hello │"); // "Hello " (6 cells) → offset 2
    assert.equal(ls[2], "│   World│"); // "World" (5) → offset 3
});

test("vertical align middle", () => {
    const result = render(alignBox({ vertical_align: "middle" }, "Hi", 10, 5));
    const ls = lines(result);
    // content_h = 3, one line → offset 1
    assert.equal(ls[1], "│        │");
    assert.equal(ls[2], "│Hi      │");
    assert.equal(ls[3], "│        │");
});

test("vertical align bottom", () => {
    const result = render(alignBox({ vertical_align: "bottom" }, "Hi", 10, 5));
    const ls = lines(result);
    // content_h = 3, one line → offset 2
    assert.equal(ls[1], "│        │");
    assert.equal(ls[2], "│        │");
    assert.equal(ls[3], "│Hi      │");
});

test("vertical align overflow not shifted", () => {
    // More lines than content_h: the block is not shifted (top).
    // content_h = 2 (height 4), "a\nb\nc" → 3 lines, only 2 fit
    const result = render(alignBox({ vertical_align: "bottom" }, "a\nb\nc", 10, 4));
    const ls = lines(result);
    assert.equal(ls[1], "│a       │");
    assert.equal(ls[2], "│b       │");
    assert.equal(ls[3], "└────────┘");
});

test("alignment with fill: content over the fill at the offset", () => {
    // Alignment offsets position the content over the fill; the fill
    // stays in the cells the content does not cover.
    const result = render(alignBox({ text_align: "center", fill: "░" }));
    const ls = lines(result);
    // "Hi" at offset 3 over the ░ fill
    assert.equal(ls[1], "│░░░Hi░░░│");
});

test("alignment ignored for lines (matrix)", () => {
    // Alignment applies only to content blocks: lines render identically
    // with and without meta.text_align / meta.vertical_align
    const meta = { text_align: "center", vertical_align: "bottom" };
    const cases = [
        { block_type: "hline", width: 8, height: 1 },
        { block_type: "vline", width: 1, height: 8 },
    ];
    for (const c of cases) {
        const base = { id: "b1", x: 0, y: 0, content: "", border_style: "solid", order: 0 };
        const plain = render([Object.assign({}, c, base)]);
        const withAlign = render([Object.assign({}, c, base, { meta })]);
        assert.equal(withAlign, plain, c.block_type);
    }
});

test("button text align", () => {
    // text_align positions the button label (the label is already
    // vertically centered)
    const expected = {
        left: "│Button      │",
        center: "│   Button   │",
        right: "│      Button│",
    };
    for (const [align, exp] of Object.entries(expected)) {
        const result = render([{
            id: "b1", block_type: "button",
            x: 0, y: 0, width: 14, height: 2,
            content: "Button", border_style: "solid",
            meta: { text_align: align },
        }]);
        assert.equal(lines(result)[0], exp, align);
    }
});

// ── Button tests (tasks/0021-0030/0022-button.md) ────────

function button(height, width = 16, content = "Button", border_style = "solid") {
    return [{
        id: "b1", block_type: "button",
        x: 0, y: 0, width, height,
        content, border_style,
    }];
}

test("button height 1", () => {
    const result = render(button(1));
    assert.equal(lines(result)[0], "[Button        ]");
});

test("button height 2", () => {
    const result = render(button(2));
    const ls = lines(result);
    assert.equal(ls[0], "│Button        │");
    assert.equal(ls[1], "└──────────────┘");
});

test("button height 3", () => {
    const result = render(button(3));
    const ls = lines(result);
    assert.equal(ls[0], "┌──────────────┐");
    assert.equal(ls[1], "│Button        │");
    assert.equal(ls[2], "└──────────────┘");
});

test("button height 4 label upper middle", () => {
    const result = render(button(4));
    const ls = lines(result);
    assert.equal(ls[0], "┌──────────────┐");
    assert.equal(ls[1], "│Button        │");
    assert.equal(ls[2], "│              │");
    assert.equal(ls[3], "└──────────────┘");
});

test("button height 5 label centered", () => {
    const result = render(button(5));
    const ls = lines(result);
    assert.equal(ls[0], "┌──────────────┐");
    assert.equal(ls[1], "│              │");
    assert.equal(ls[2], "│Button        │");
    assert.equal(ls[3], "│              │");
    assert.equal(ls[4], "└──────────────┘");
});

test("button border styles", () => {
    // h=2: side + bottom border use the style characters
    let ls = lines(render(button(2, 16, "Button", "dashed")));
    assert.equal(ls[0], "┆Button        ┆");
    assert.equal(ls[1], "└" + "┄".repeat(14) + "┘");

    // h=3: full box in the style
    ls = lines(render(button(3, 16, "Button", "double")));
    assert.equal(ls[0], "╔══════════════╗");
    assert.equal(ls[1], "║Button        ║");
    assert.equal(ls[2], "╚══════════════╝");

    // h=1: [label] for any style
    for (const style of ["solid", "dashed", "dotted", "double"]) {
        assert.equal(lines(render(button(1, 16, "Button", style)))[0],
            "[Button        ]", style);
    }
});

test("button border none", () => {
    const ls = lines(render(button(3, 16, "Button", "none")));
    assert.equal(ls[0], "");
    assert.equal(ls[1], "Button");
    assert.equal(ls.length, 2); // trailing empty rows are stripped
});

test("button label truncated not wrapped", () => {
    const ls = lines(render(button(3, 10, "A very long label")));
    // Inner width = 8: label truncated, no wrapping
    assert.equal(ls[0], "┌" + "─".repeat(8) + "┐");
    assert.equal(ls[1], "│A very l│");
    assert.equal(ls[2], "└" + "─".repeat(8) + "┘");
});

test("button label ignores newlines", () => {
    const result = render(button(3, 16, "Line1\nLine2"));
    assert.equal(lines(result)[1], "│Line1" + " ".repeat(9) + "│");
    assert.ok(!result.includes("Line2"));
});

test("button empty content", () => {
    const ls = lines(render(button(3, 16, "")));
    assert.equal(ls[0], "┌──────────────┐");
    assert.equal(ls[1], "│              │");
    assert.equal(ls[2], "└──────────────┘");
});

// ── Word wrap tests ───────────────────────────────────────

test("wrap text unit", () => {
    assert.deepEqual(PG.wrapText("hello world", 5), ["hello", "world"]);
    assert.deepEqual(PG.wrapText("hello", 10), ["hello"]);
    assert.deepEqual(PG.wrapText("a b c", 1), ["a", "b", "c"]);
    assert.deepEqual(PG.wrapText("ab\ncd", 3), ["ab", "cd"]);
    assert.deepEqual(PG.wrapText("abcdefgh", 3), ["abc", "def", "gh"]);
    assert.deepEqual(PG.wrapText("", 5), [""]);
});

test("wrap text preserves spaces", () => {
    // Runs of spaces are formatting — kept verbatim, dropped only on wrap
    assert.deepEqual(PG.wrapText("hello    world", 20), ["hello    world"]);
    assert.deepEqual(PG.wrapText("  hello", 10), ["  hello"]);
    assert.deepEqual(PG.wrapText("a   b", 2), ["a", "b"]);
    assert.deepEqual(PG.wrapText("a  b\nc  d", 10), ["a  b", "c  d"]);
});

// ── Text autosize tests ───────────────────────────────────

test("text block size no border", () => {
    // Without a border the fit size is the content's extent (min 1×1)
    assert.deepEqual(PG.textBlockSize("", "none"), [1, 1]);
    assert.deepEqual(PG.textBlockSize("hi", "none"), [2, 1]);
    assert.deepEqual(PG.textBlockSize("hello\nworld", "none"), [5, 2]);
    // The longest line sets the width, every explicit line sets a row
    assert.deepEqual(PG.textBlockSize("ab\ncdef", "none"), [4, 2]);
    // A trailing newline adds an empty line
    assert.deepEqual(PG.textBlockSize("a\n", "none"), [1, 2]);
});

test("text block size with border", () => {
    // A border (any style except none) adds one cell on each side
    assert.deepEqual(PG.textBlockSize("", "solid"), [2, 3]);
    assert.deepEqual(PG.textBlockSize("hi", "solid"), [4, 3]);
    assert.deepEqual(PG.textBlockSize("hi", "double"), [4, 3]);
    assert.deepEqual(PG.textBlockSize("hello\nworld", "dashed"), [7, 4]);
});

test("word wrap in border", () => {
    const result = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 12, height: 4,
        content: "Hello world foo", border_style: "solid",
    }]);
    const ls = lines(result);
    // Content width = 10: "Hello" + " world" = 11 > 10 → wrap
    assert.ok(ls[1].includes("Hello"));
    assert.ok(ls[2].includes("world foo"));
    // Border intact on all content rows
    assert.equal(ls[1][0], "│");
    assert.equal(ls[1][11], "│");
    assert.equal(ls[2][0], "│");
    assert.equal(ls[2][11], "│");
});

test("word wrap hard split long word", () => {
    const result = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 8, height: 4,
        content: "abcdefgh", border_style: "solid",
    }]);
    const ls = lines(result);
    // Content width = 6: "abcdef" / "gh"
    assert.ok(ls[1].includes("abcdef"));
    assert.ok(ls[2].includes("gh"));
});

test("word wrap preserves explicit newlines", () => {
    const result = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 12, height: 5,
        content: "one two\nthree four", border_style: "solid",
    }]);
    const ls = lines(result);
    assert.ok(ls[1].includes("one two"));
    assert.ok(ls[2].includes("three four"));
});

test("word wrap clipped by height", () => {
    const result = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 8, height: 3,
        content: "aa bb cc dd", border_style: "solid",
    }]);
    const ls = lines(result);
    // Content height = 1: only the first wrapped line fits
    assert.ok(ls[1].includes("aa bb"));
    assert.ok(!ls[1].includes("cc"));
    // Bottom border intact
    assert.equal(ls[2][0], "└");
    assert.equal(ls[2][7], "┘");
});

test("word wrap no border", () => {
    const result = render([{
        id: "b1", block_type: "text",
        x: 0, y: 0, width: 8, height: 3,
        content: "hello world", border_style: "none",
    }]);
    const ls = lines(result);
    assert.ok(ls[0].includes("hello"));
    assert.ok(ls[1].includes("world"));
});

test("word wrap preserves spaces in render", () => {
    const result = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 20, height: 3,
        content: "Name        Price", border_style: "solid",
    }]);
    const ls = lines(result);
    // Content width = 18: "Name        Price" (17) fits on one line
    assert.ok(ls[1].includes("Name        Price"));
});

test("word wrap drops gap on wrap", () => {
    const result = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "Name        Price", border_style: "solid",
    }]);
    const ls = lines(result);
    // Content width = 8: "Name" + 8 spaces = 12 > 8 → gap dropped
    assert.ok(ls[1].includes("Name"));
    assert.ok(ls[2].includes("Price"));
});

// ── Order / z-order tests ─────────────────────────────────

test("render sorts by order", () => {
    const result = render([
        {
            id: "b1", block_type: "box",
            x: 0, y: 0, width: 10, height: 5,
            content: "LOW", border_style: "solid", order: 0,
        },
        {
            id: "b2", block_type: "box",
            x: 2, y: 1, width: 10, height: 5,
            content: "HIGH", border_style: "solid", order: 10,
        },
    ]);
    const ls = lines(result);
    // HIGH (order=10) should overwrite LOW at overlapping positions
    assert.ok(ls[2].includes("HIGH"));
    assert.ok(!ls[2].includes("LOW"));
});

test("render default order zero (stable sort)", () => {
    const result = render([
        {
            id: "b1", block_type: "box",
            x: 0, y: 0, width: 10, height: 5,
            content: "A", border_style: "solid",
        },
        {
            id: "b2", block_type: "box",
            x: 2, y: 1, width: 10, height: 5,
            content: "B", border_style: "solid",
        },
    ]);
    const ls = lines(result);
    // Both have order=0, so insertion order decides (B is second → on top)
    assert.ok(ls[2].includes("B"));
});

test("render children sorted by order", () => {
    // Children inside a container render by order, not insertion order.
    // HIGH is inserted first but has the higher order — it must win.
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 20, height: 6,
            content: "", border_style: "solid", order: 0,
        },
        {
            id: "high", block_type: "text",
            x: 2, y: 1, width: 8, height: 2,
            content: "HIGH", border_style: "none", parent_id: "p", order: 10,
        },
        {
            id: "low", block_type: "text",
            x: 2, y: 1, width: 8, height: 2,
            content: "LOW", border_style: "none", parent_id: "p", order: 0,
        },
    ]);
    const ls = lines(result);
    // Both children at the same position: HIGH (order=10) overwrites LOW
    assert.ok(ls[2].includes("HIGH"));
    assert.ok(!ls[2].includes("LOW"));
});

test("render children order beats position", () => {
    // A higher-order child renders on top even when positioned above
    // (smaller y) a lower-order sibling — z-index, not position, decides.
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 20, height: 8,
            content: "", border_style: "solid", order: 0,
        },
        {
            id: "high", block_type: "box",
            x: 2, y: 1, width: 10, height: 3,
            content: "HIGH", border_style: "solid", parent_id: "p", order: 10,
        },
        {
            id: "low", block_type: "box",
            x: 2, y: 2, width: 10, height: 3,
            content: "LOW", border_style: "solid", parent_id: "p", order: 0,
        },
    ]);
    const ls = lines(result);
    // Overlap cell (3,3): HIGH's left border wins over LOW's top-left
    // corner — if position decided, LOW (drawn last) would leave "┌" here.
    assert.equal(ls[3][3], "│");
    // HIGH's content survives the overlap (drawn on top of LOW's border)
    assert.ok(ls[3].includes("HIGH"));
});

// ── HTML preview tests ────────────────────────────────────

test("toHtmlPreview positions and z-index", () => {
    const html = PG.toHtmlPreview({
        id: "block-123", block_type: "box",
        x: 2, y: 1, width: 10, height: 3,
        content: "", border_style: "solid",
    });
    assert.ok(html.includes('data-block-id="block-123"'));
    assert.ok(html.includes('class="block-preview"'));
    assert.ok(html.includes('class="resize-handle"'));
    // Default char_width_px=12, char_height_px=14.4, padding_offset=16
    assert.ok(html.includes("left:40px")); // 16 + 2*12
    assert.ok(html.includes("top:30.4px")); // 16 + 1*14.4
    assert.ok(html.includes("width:120px"));
    assert.ok(html.includes("height:43.2px"));
    assert.ok(html.includes("z-index:10"));
    assert.ok(html.includes('data-order="0"'));
});

test("toHtmlPreview z-index from order", () => {
    const html = PG.toHtmlPreview({
        id: "block-xyz", block_type: "box",
        x: 0, y: 0, width: 10, height: 3,
        content: "", border_style: "solid", order: 5,
    });
    assert.ok(html.includes("z-index:15")); // 10 + 5
    assert.ok(html.includes('data-order="5"'));
});

test("renderHtmlPreview single block", () => {
    const html = PG.renderHtmlPreview([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 20, height: 3,
        content: "Header", border_style: "solid",
    }]);
    assert.ok(html.includes('data-block-id="b1"'));
    assert.ok(html.includes('class="block-preview"'));
    assert.ok(html.includes('class="resize-handle"'));
    assert.ok(html.includes("left:16px"));
    assert.ok(html.includes("width:240px"));
});

test("renderHtmlPreview with children", () => {
    const html = PG.renderHtmlPreview([
        {
            id: "parent", block_type: "box",
            x: 0, y: 0, width: 30, height: 10,
            content: "", border_style: "solid",
        },
        {
            id: "child-1", block_type: "button",
            x: 1, y: 1, width: 10, height: 2,
            content: "Click", border_style: "dashed",
            parent_id: "parent",
        },
    ]);
    assert.ok(html.includes('data-block-id="parent"'));
    assert.ok(html.includes('data-block-id="child-1"'));
    assert.equal(html.split('class="resize-handle"').length - 1, 2);
});

function openingTag(html, blockId) {
    const idx = html.indexOf('data-block-id="' + blockId + '"');
    const start = html.lastIndexOf("<div", idx);
    const end = html.indexOf(">", idx) + 1;
    return html.slice(start, end);
}

test("renderHtmlPreview child nested in parent", () => {
    const html = PG.renderHtmlPreview([
        {
            id: "parent", block_type: "box",
            x: 0, y: 0, width: 30, height: 10,
            content: "", border_style: "solid",
        },
        {
            id: "child-1", block_type: "button",
            x: 1, y: 1, width: 10, height: 2,
            content: "Click", border_style: "dashed",
            parent_id: "parent",
        },
    ]);
    const parentTag = openingTag(html, "parent");
    const childTag = openingTag(html, "child-1");
    assert.ok(parentTag.includes("overflow:hidden"));
    assert.ok(!childTag.includes("overflow:hidden"));
    assert.ok(html.indexOf('data-block-id="parent"') < html.indexOf('data-block-id="child-1"'));
});

test("renderHtmlPreview child positioned relative to parent", () => {
    const html = PG.renderHtmlPreview([
        {
            id: "parent", block_type: "box",
            x: 0, y: 0, width: 30, height: 10,
            content: "", border_style: "solid",
        },
        {
            id: "child-1", block_type: "button",
            x: 1, y: 1, width: 10, height: 2,
            content: "Click", border_style: "dashed",
            parent_id: "parent",
        },
    ]);
    const childTag = openingTag(html, "child-1");
    // (1+1)*12 = 24px, (1+1)*14.4 = 28.8px — NOT 16 + 1*12 = 28px (flattened)
    assert.ok(childTag.includes("left:24px"));
    assert.ok(childTag.includes("top:28.8px"));
});

test("renderHtmlPreview box in box", () => {
    const html = PG.renderHtmlPreview([
        {
            id: "outer", block_type: "box",
            x: 0, y: 0, width: 40, height: 12,
            content: "", border_style: "solid",
        },
        {
            id: "inner", block_type: "box",
            x: 2, y: 2, width: 20, height: 6,
            content: "", border_style: "dashed",
            parent_id: "outer",
        },
        {
            id: "leaf", block_type: "text",
            x: 1, y: 1, width: 8, height: 2,
            content: "hi", border_style: "none",
            parent_id: "inner",
        },
    ]);
    const outerTag = openingTag(html, "outer");
    const innerTag = openingTag(html, "inner");
    const leafTag = openingTag(html, "leaf");
    assert.ok(outerTag.includes("overflow:hidden"));
    assert.ok(innerTag.includes("overflow:hidden"));
    assert.ok(!leafTag.includes("overflow:hidden"));
    assert.ok(html.indexOf('data-block-id="outer"') < html.indexOf('data-block-id="inner"'));
    assert.ok(html.indexOf('data-block-id="inner"') < html.indexOf('data-block-id="leaf"'));
    // inner relative to outer: (1+2)*12=36px, (1+2)*14.4=43.2px
    assert.ok(innerTag.includes("left:36px"));
    assert.ok(innerTag.includes("top:43.2px"));
    // leaf relative to inner: (1+1)*12=24px, (1+1)*14.4=28.8px
    assert.ok(leafTag.includes("left:24px"));
    assert.ok(leafTag.includes("top:28.8px"));
});

test("renderHtmlPreview child bigger than parent", () => {
    const html = PG.renderHtmlPreview([
        {
            id: "parent", block_type: "box",
            x: 0, y: 0, width: 10, height: 4,
            content: "", border_style: "solid",
        },
        {
            id: "big", block_type: "box",
            x: 2, y: 1, width: 30, height: 10,
            content: "", border_style: "dashed",
            parent_id: "parent",
        },
    ]);
    const parentTag = openingTag(html, "parent");
    const bigTag = openingTag(html, "big");
    assert.ok(parentTag.includes("overflow:hidden"));
    assert.ok(html.indexOf('data-block-id="parent"') < html.indexOf('data-block-id="big"'));
    assert.ok(bigTag.includes("width:360px"));   // 30*12
    assert.ok(bigTag.includes("height:144px"));  // 10*14.4
});

test("renderHtmlPreview per-side border classes", () => {
    // No meta: both axes inherit the base style
    const dashed = PG.renderHtmlPreview([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "dashed",
    }]);
    assert.ok(dashed.includes('class="block-border block-border--h-dashed block-border--v-dashed"'));

    const double = PG.renderHtmlPreview([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "double",
    }]);
    assert.ok(double.includes('class="block-border block-border--h-double block-border--v-double"'));

    const none = PG.renderHtmlPreview([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "none",
    }]);
    assert.ok(none.includes('class="block-border block-border--h-none block-border--v-none"'));

    // meta overrides each axis independently
    const perSide = PG.renderHtmlPreview([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "solid",
        meta: { border_h: "dashed", border_v: "double" },
    }]);
    assert.ok(perSide.includes('class="block-border block-border--h-dashed block-border--v-double"'));
});

test("renderHtmlPreview line blocks", () => {
    const h = PG.renderHtmlPreview([{
        id: "l1", block_type: "hline",
        x: 0, y: 0, width: 10, height: 1,
        content: "", border_style: "dashed",
    }]);
    assert.ok(h.includes('class="block-line block-line--h block-line--dashed"'));

    const v = PG.renderHtmlPreview([{
        id: "l2", block_type: "vline",
        x: 0, y: 0, width: 1, height: 4,
        content: "", border_style: "double",
    }]);
    assert.ok(v.includes('class="block-line block-line--v block-line--double"'));

    const n = PG.renderHtmlPreview([{
        id: "l3", block_type: "hline",
        x: 0, y: 0, width: 10, height: 1,
        content: "", border_style: "none",
    }]);
    assert.ok(n.includes('class="block-line block-line--h block-line--none"'));
});

// ── Full canvas HTML (renderHtml) ─────────────────────────

test("renderHtml builds the canvas wrapper like the API", () => {
    const ascii = PG.render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 3,
        content: "Hi", border_style: "solid",
    }], 20, 5);
    const html = PG.renderHtml(ascii, [{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 3,
        content: "Hi", border_style: "solid",
    }], { width: 20, height: 5, charWidthPx: 12, charHeightPx: 14.4, paddingOffset: 16 });

    assert.ok(html.startsWith('<div class="render-wrapper"'));
    // The 20×5 layout is below the default floor — the canvas keeps 80×24
    assert.ok(html.includes("width:960px")); // 80 * 12
    assert.ok(html.includes("height:345.6px")); // round(24 * 14.4, 1)
    assert.ok(html.includes('<div class="ascii-art"'));
    assert.ok(html.includes('data-block-id="b1"'));
    // Bounds line at the layout size (20×5)
    assert.ok(html.includes('class="layout-bounds layout-bounds--v"'));
    assert.ok(html.includes('class="layout-bounds layout-bounds--h"'));
    // ASCII is escaped inside the .ascii-art layer
    assert.ok(html.includes("Hi"));
});

test("renderHtml art layer is a div, not a pre", () => {
    // Regression: the HTML parser strips the first newline right after a
    // <pre> start tag, so <pre> would drop the first row of art that starts
    // with an empty row (topmost block not at y=0) and shift it up one row
    // relative to the overlays. The art must be a <div> with white-space:pre.
    const blocks = [{
        id: "b1", block_type: "box",
        x: 0, y: 3, width: 10, height: 3,
        content: "", border_style: "solid",
    }];
    const ascii = PG.render(blocks, 20, 5);
    assert.ok(ascii.startsWith("\n\n\n")); // first rows are empty
    const html = PG.renderHtml(ascii, blocks, {
        width: 20, height: 5, charWidthPx: 12, charHeightPx: 14.4,
    });
    assert.ok(!html.includes("<pre"));
    assert.ok(html.includes('<div class="ascii-art"'));
    assert.ok(html.includes("white-space: pre"));
    // All three leading newlines survive verbatim in the markup
    assert.ok(html.includes('color: #e0e0e0;">\n\n\n'));
});

test("renderHtml expands canvas for out-of-bounds blocks", () => {
    const blocks = [{
        id: "b1", block_type: "box",
        x: 75, y: 20, width: 10, height: 5,
        content: "Out", border_style: "solid",
    }];
    const ascii = PG.render(blocks, 20, 5);
    const html = PG.renderHtml(ascii, blocks, {
        width: 20, height: 5, charWidthPx: 12, charHeightPx: 14.4, paddingOffset: 16,
    });
    // Canvas expanded past the 80×24 floor to 85×25 → wrapper 1020×360px
    assert.ok(html.includes("width:1020px"));
    assert.ok(html.includes("height:360px"));
});

test("renderHtml escapes html in ascii", () => {
    const html = PG.renderHtml("<b>&</b>", [], {
        width: 20, height: 5, charWidthPx: 12, charHeightPx: 14.4,
    });
    assert.ok(html.includes("&lt;b&gt;&amp;&lt;/b&gt;"));
    assert.ok(!html.includes("<b>"));
});
