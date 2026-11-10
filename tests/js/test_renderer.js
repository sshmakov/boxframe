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

test("deep nesting (grandchildren)", () => {
    // Three levels: a grandchild is drawn inside its container
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 24, height: 10,
            content: "", border_style: "solid",
        },
        {
            id: "c", block_type: "box",
            x: 1, y: 1, width: 16, height: 6,
            content: "", border_style: "solid",
            parent_id: "p",
        },
        {
            id: "g", block_type: "text",
            x: 1, y: 1, width: 6, height: 1,
            content: "Deep", border_style: "none",
            parent_id: "c",
        },
    ]);
    const ls = lines(result);
    // Child absolute position: (0+1+1, 0+1+1) = (2, 2); grandchild:
    // (2+1+1, 2+1+1) = (4, 4)
    assert.ok(ls[4].includes("Deep"));
});

test("borderless box renders children", () => {
    // A borderless container renders its children: the child's border is
    // drawn at the same 1-cell padding as inside a framed container
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 20, height: 8,
            content: "", border_style: "none",
        },
        {
            id: "c", block_type: "content",
            x: 2, y: 2, width: 10, height: 3,
            content: "", border_style: "solid",
            parent_id: "p",
        },
    ]);
    const ls = lines(result);
    // Child absolute rect: (0+1+2, 0+1+2) = (3, 3), 10×3
    assert.equal(ls[3][3], "┌");
    assert.equal(ls[3][12], "┐");
    assert.equal(ls[5][3], "└");
    assert.equal(ls[5][12], "┘");
    // The lorem placeholder is drawn inside the child
    assert.ok(ls[4].includes("lorem"));
    // The borderless parent draws nothing of its own (rows 0–2 are empty)
    assert.equal(ls[0], "");
    assert.equal(ls[1], "");
    assert.equal(ls[2], "");
});

test("borderless box clips children to the inner area", () => {
    // A borderless container clips children to the same inner area as a
    // framed one (1 cell inside the block's edge)
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 10, height: 4,
            content: "", border_style: "none",
        },
        {
            id: "c", block_type: "box",
            x: 0, y: 0, width: 20, height: 10,
            content: "", border_style: "solid",
            parent_id: "p",
        },
    ]);
    const ls = lines(result);
    // Child absolute rect: (1, 1)–(21, 11); clipped to (1, 1)–(9, 3):
    // row 1 — "┌" + top border to the clip edge (no ┐), row 2 — "│" + the
    // child's [box] hint (cols 2–6), nothing at col 8 (right border
    // clipped away), the bottom border is clipped away too
    assert.equal(ls[1][1], "┌");
    assert.equal(ls[1][8], "─");
    assert.equal(ls[1].length, 9);
    assert.equal(ls[2], " │[box]");
    assert.equal(ls.length, 3);
});

test("borderless box deep nesting", () => {
    // Borderless containers compose: every level keeps its 1-cell padding
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 24, height: 10,
            content: "", border_style: "none",
        },
        {
            id: "c", block_type: "box",
            x: 1, y: 1, width: 16, height: 6,
            content: "", border_style: "none",
            parent_id: "p",
        },
        {
            id: "g", block_type: "text",
            x: 1, y: 1, width: 6, height: 1,
            content: "Deep", border_style: "none",
            parent_id: "c",
        },
    ]);
    const ls = lines(result);
    // Grandchild absolute position: (0+1+1+1+1, 0+1+1+1+1) = (4, 4)
    assert.ok(ls[4].includes("Deep"));
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
    // Every framed type is in the matrix (task 0073)
    for (const t of ["button", "input", "textarea", "text"]) {
        assert.equal(PG.fillChar(t, { fill: "░" }), "░");
    }
    // Lines are not frames — not in the fill matrix
    for (const t of ["divider", "hline", "vline"]) {
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

test("fill ignored for lines (matrix, task 0073)", () => {
    const cases = [
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

test("fill input block: hint suppressed, area filled (task 0073)", () => {
    const result = render([{
        id: "b1", block_type: "input",
        x: 0, y: 0, width: 10, height: 3,
        content: "", border_style: "solid",
        meta: { fill: "░" },
    }]);
    const ls = lines(result);
    assert.equal(ls[0], "┌────────┐");
    assert.equal(ls[1], "│░░░░░░░░│");
    assert.equal(ls[2], "└────────┘");
    assert.ok(!result.includes("[input]"));
});

test("fill textarea block: hint suppressed, area filled (task 0073)", () => {
    const result = render([{
        id: "b1", block_type: "textarea",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "solid",
        meta: { fill: "▒" },
    }]);
    const ls = lines(result);
    assert.equal(ls[0], "┌────────┐");
    assert.equal(ls[1], "│▒▒▒▒▒▒▒▒│");
    assert.equal(ls[2], "│▒▒▒▒▒▒▒▒│");
    assert.equal(ls[3], "└────────┘");
    assert.ok(!result.includes("[textarea]"));
});

test("fill text block: content over the fill, borderless fills all (task 0073)", () => {
    const result = render([{
        id: "b1", block_type: "text",
        x: 0, y: 0, width: 8, height: 3,
        content: "Hi", border_style: "solid",
        meta: { fill: "░" },
    }]);
    const ls = lines(result);
    assert.equal(ls[0], "┌──────┐");
    assert.equal(ls[1], "│Hi░░░░│");
    assert.equal(ls[2], "└──────┘");
    const borderless = render([{
        id: "b1", block_type: "text",
        x: 0, y: 0, width: 6, height: 2,
        content: "", border_style: "none",
        meta: { fill: "▓" },
    }]);
    const bls = lines(borderless);
    assert.equal(bls[0], "▓▓▓▓▓▓");
    assert.equal(bls[1], "▓▓▓▓▓▓");
});

test("fill button block: inner area per height form, label on top (task 0073)", () => {
    // h=1: [label] — the row between the brackets fills (label centered:
    // 3 fill cells left, 4 right)
    let result = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 12, height: 1,
        content: "Btn", border_style: "solid",
        meta: { fill: "░" },
    }]);
    assert.equal(result, "[░░░Btn░░░░]");
    // h=2: no top border — the single inner row fills, the bottom border stays
    result = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 12, height: 2,
        content: "Btn", border_style: "solid",
        meta: { fill: "░" },
    }]);
    let ls = lines(result);
    assert.equal(ls[0], "│░░░Btn░░░░│");
    assert.equal(ls[1], "└──────────┘");
    // h>=3: full box — the area between the borders fills
    result = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 12, height: 4,
        content: "Btn", border_style: "solid",
        meta: { fill: "░" },
    }]);
    ls = lines(result);
    assert.equal(ls[0], "┌──────────┐");
    assert.equal(ls[1], "│░░░Btn░░░░│");
    assert.equal(ls[2], "│░░░░░░░░░░│");
    assert.equal(ls[3], "└──────────┘");
    // border none: the whole block fills
    result = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 6, height: 2,
        content: "Hi", border_style: "none",
        meta: { fill: "▒" },
    }]);
    ls = lines(result);
    assert.equal(ls[0], "▒▒Hi▒▒");
    assert.equal(ls[1], "▒▒▒▒▒▒");
});

test("fill button: hide_text suppresses the label, the fill stays (task 0073)", () => {
    const result = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 10, height: 3,
        content: "Btn", border_style: "solid",
        meta: { fill: "░", hide_text: true },
    }]);
    const ls = lines(result);
    assert.equal(ls[0], "┌────────┐");
    assert.equal(ls[1], "│░░░░░░░░│");
    assert.equal(ls[2], "└────────┘");
    assert.ok(!result.includes("Btn"));
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

// ── Hide text (meta.hide_text) ──────────────────────────────

test("hide text: box content suppressed, the border stays", () => {
    const plain = render(alignBox(null, "Hi"));
    const hidden = render(alignBox({ hide_text: true }, "Hi"));
    assert.ok(!hidden.includes("Hi"));
    assert.equal(hidden, "┌────────┐\n│        │\n│        │\n└────────┘");
    // The border rows are identical to the visible render
    assert.equal(lines(hidden)[0], lines(plain)[0]);
    assert.equal(lines(hidden).pop(), lines(plain).pop());
});

test("hide text: the [type] hint is suppressed too", () => {
    const hidden = render([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "solid",
        meta: { hide_text: true },
    }]);
    assert.ok(!hidden.includes("[box]"));
    assert.equal(hidden, "┌────────┐\n│        │\n│        │\n└────────┘");
});

test("hide text: absent or false renders as before", () => {
    const plain = render(alignBox(null));
    const false_ = render(alignBox({ hide_text: false }));
    assert.equal(plain, false_);
});

test("hide text: the fill stays", () => {
    const result = render(alignBox({ hide_text: true, fill: "░" }));
    const ls = lines(result);
    assert.equal(ls[1], "│░░░░░░░░│");
    assert.equal(ls[2], "│░░░░░░░░│");
});

test("hide text: the lorem placeholder is suppressed", () => {
    const result = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 12, height: 3,
        content: "", border_style: "solid",
        meta: { hide_text: true },
    }]);
    assert.equal(result, "┌──────────┐\n│          │\n└──────────┘");
});

test("hide text: the button label is suppressed, the frame stays", () => {
    const result = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 16, height: 3,
        content: "Button", border_style: "solid",
        meta: { hide_text: true },
    }]);
    assert.equal(result, "┌──────────────┐\n│              │\n└──────────────┘");
});

test("hide text: h=1 button keeps the brackets", () => {
    const result = render([{
        id: "b1", block_type: "button",
        x: 0, y: 0, width: 10, height: 1,
        content: "Button", border_style: "solid",
        meta: { hide_text: true },
    }]);
    assert.equal(result, "[        ]");
});

test("hide text: the divider label is suppressed, the line stays", () => {
    const result = render([{
        id: "b1", block_type: "divider",
        x: 0, y: 0, width: 10, height: 1,
        content: "or", border_style: "solid",
        meta: { hide_text: true },
    }]);
    assert.equal(result, "──────────");
});

test("hide text: a borderless text block becomes empty", () => {
    const result = render([{
        id: "b1", block_type: "text",
        x: 0, y: 0, width: 10, height: 2,
        content: "Hi", border_style: "none",
        meta: { hide_text: true },
    }]);
    assert.equal(result, "");
});

// ── Button tests (tasks/0021-0030/0022-button.md, 0060) ─────

function button(height, width = 16, content = "Button", border_style = "solid",
               meta = {}) {
    return [{
        id: "b1", block_type: "button",
        x: 0, y: 0, width, height,
        content, border_style, meta,
    }];
}

test("button height 1", () => {
    const result = render(button(1));
    assert.equal(lines(result)[0], "[    Button    ]");
});

test("button height 2", () => {
    const result = render(button(2));
    const ls = lines(result);
    assert.equal(ls[0], "│    Button    │");
    assert.equal(ls[1], "└──────────────┘");
});

test("button height 3", () => {
    const result = render(button(3));
    const ls = lines(result);
    assert.equal(ls[0], "┌──────────────┐");
    assert.equal(ls[1], "│    Button    │");
    assert.equal(ls[2], "└──────────────┘");
});

test("button height 4 label upper middle", () => {
    const result = render(button(4));
    const ls = lines(result);
    assert.equal(ls[0], "┌──────────────┐");
    assert.equal(ls[1], "│    Button    │");
    assert.equal(ls[2], "│              │");
    assert.equal(ls[3], "└──────────────┘");
});

test("button height 5 label centered", () => {
    const result = render(button(5));
    const ls = lines(result);
    assert.equal(ls[0], "┌──────────────┐");
    assert.equal(ls[1], "│              │");
    assert.equal(ls[2], "│    Button    │");
    assert.equal(ls[3], "│              │");
    assert.equal(ls[4], "└──────────────┘");
});

test("button border styles", () => {
    // h=2: side + bottom border use the style characters
    let ls = lines(render(button(2, 16, "Button", "dashed")));
    assert.equal(ls[0], "┆    Button    ┆");
    assert.equal(ls[1], "└" + "┄".repeat(14) + "┘");

    // h=3: full box in the style
    ls = lines(render(button(3, 16, "Button", "double")));
    assert.equal(ls[0], "╔══════════════╗");
    assert.equal(ls[1], "║    Button    ║");
    assert.equal(ls[2], "╚══════════════╝");

    // h=1: [label] for any style
    for (const style of ["solid", "dashed", "dotted", "double"]) {
        assert.equal(lines(render(button(1, 16, "Button", style)))[0],
            "[    Button    ]", style);
    }
});

test("button border none", () => {
    const ls = lines(render(button(3, 16, "Button", "none")));
    assert.equal(ls[0], "");
    assert.equal(ls[1], "     Button");
    assert.equal(ls.length, 2); // trailing empty rows are stripped
});

test("button label word wrapped", () => {
    // The label is word-wrapped to the inner width; lines past the inner
    // height are not drawn (manual resize smaller than the fit)
    const ls = lines(render(button(3, 10, "A very long label")));
    // Inner 8×1: "A very " / "long " / "label" → only the first line
    assert.equal(ls[0], "┌" + "─".repeat(8) + "┐");
    assert.equal(ls[1], "│A very  │");
    assert.equal(ls[2], "└" + "─".repeat(8) + "┘");
});

test("button multiline", () => {
    // Explicit newlines are kept: each line on its row, centered
    const ls = lines(render(button(4, 7, "hi\nthere")));
    assert.equal(ls[0], "┌─────┐");
    assert.equal(ls[1], "│ hi  │");
    assert.equal(ls[2], "│there│");
    assert.equal(ls[3], "└─────┘");
});

test("button multiline h1 clips to first line", () => {
    assert.equal(lines(render(button(1, 12, "a\nb")))[0], "[    a     ]");
});

test("button multiline h2 manual form", () => {
    // The manual h=2 form (no top border) keeps one inner row
    const result = render(button(2, 16, "Line1\nLine2"));
    const ls = lines(result);
    assert.equal(ls[0], "│    Line1     │");
    assert.equal(ls[1], "└──────────────┘");
    assert.ok(!result.includes("Line2"));
});

test("button vertical align", () => {
    // vertical_align shifts the line block inside the inner height
    // (default middle)
    const expected = {
        top: [1, 2],
        middle: [2, 3],
        bottom: [3, 4],
    };
    for (const [valign, [hiRow, thereRow]] of Object.entries(expected)) {
        const ls = lines(render(button(6, 7, "hi\nthere", "solid",
            { vertical_align: valign })));
        assert.equal(ls[hiRow], "│ hi  │", valign);
        assert.equal(ls[thereRow], "│there│", valign);
    }
});

test("button text align multiline", () => {
    // text_align aligns each line (default center)
    const expected = {
        left: ["│hi   │", "│there│"],
        center: ["│ hi  │", "│there│"],
        right: ["│   hi│", "│there│"],
    };
    for (const [align, [hi, there]] of Object.entries(expected)) {
        const ls = lines(render(button(4, 7, "hi\nthere", "solid",
            { text_align: align })));
        assert.equal(ls[1], hi, align);
        assert.equal(ls[2], there, align);
    }
});

test("button border none multiline", () => {
    const ls = lines(render(button(2, 5, "hi\nthere", "none")));
    assert.equal(ls[0], " hi"); // rstripped
    assert.equal(ls[1], "there");
});

test("button empty content", () => {
    const ls = lines(render(button(3, 16, "")));
    assert.equal(ls[0], "┌──────────────┐");
    assert.equal(ls[1], "│              │");
    assert.equal(ls[2], "└──────────────┘");
});

test("button empty content h1", () => {
    // An empty framed button keeps the canonical h=1 form
    assert.equal(lines(render(button(1, 3, "")))[0], "[ ]");
});

// ── buttonBlockSize tests (task 0060) ─────────────────────

test("button block size unit", () => {
    // Fit size: 1 line → [label] (h=1), N>=2 lines → full box (h=N+2),
    // none → the text's extent
    assert.deepEqual(PG.buttonBlockSize("", "solid"), [3, 1]);
    assert.deepEqual(PG.buttonBlockSize("Button", "solid"), [8, 1]);
    assert.deepEqual(PG.buttonBlockSize("a", "solid"), [3, 1]);
    assert.deepEqual(PG.buttonBlockSize("a\nb", "solid"), [3, 4]);
    assert.deepEqual(PG.buttonBlockSize("hi\nthere", "solid"), [7, 4]);
    assert.deepEqual(PG.buttonBlockSize("a\n", "solid"), [3, 4]);
    assert.deepEqual(PG.buttonBlockSize("hi\nthere", "dashed"), [7, 4]);
    assert.deepEqual(PG.buttonBlockSize("", "none"), [1, 1]);
    assert.deepEqual(PG.buttonBlockSize("hi", "none"), [2, 1]);
    assert.deepEqual(PG.buttonBlockSize("a\nbb", "none"), [2, 2]);
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

// ── Divider tests (variant E, tasks/0003) ─────────────────

function dividerBlock(content = "", width = 20, height = 1, meta, border_style = "solid") {
    const data = {
        id: "b1", block_type: "divider",
        x: 0, y: 0, width, height,
        content, border_style,
    };
    if (meta != null) data.meta = meta;
    return [data];
}

test("dividerFitSize: grow-only fit", () => {
    // Empty content — one empty line, the size is kept
    assert.deepEqual(PG.dividerFitSize("", 20, 1), [20, 1]);
    // Height grows to the line count
    assert.deepEqual(PG.dividerFitSize("a\nbb\nccc", 20, 1), [20, 3]);
    // Width grows to the longest line
    assert.deepEqual(PG.dividerFitSize("a\nbb\nccc", 2, 3), [3, 3]);
    // Stored width larger than the longest line — no shrink
    assert.deepEqual(PG.dividerFitSize("a\nbb\nccc", 4, 3), [4, 3]);
    // Smaller content (down to empty) — no shrink
    assert.deepEqual(PG.dividerFitSize("a", 20, 3), [20, 3]);
    assert.deepEqual(PG.dividerFitSize("", 20, 3), [20, 3]);
    // A trailing newline adds an empty line
    assert.deepEqual(PG.dividerFitSize("a\n", 20, 1), [20, 2]);
});

test("divider empty: a line on every row", () => {
    // Empty content: a line on every row (old 20×3 → 3 parallel lines)
    const result = render(dividerBlock("", 20, 3));
    const ls = lines(result);
    for (let i = 0; i < 3; i++) {
        assert.equal(ls[i].slice(0, 20), "─".repeat(20));
    }
});

test("divider label centered by default", () => {
    const result = render(dividerBlock("or"));
    assert.equal(lines(result)[0].slice(0, 20), "─".repeat(9) + "or" + "─".repeat(9));
});

test("divider multiline label", () => {
    // Each content line is drawn over its row, as-is (no wrap, no
    // collapse), each line aligned independently
    const result = render(dividerBlock("a\nbb\nccc", 20, 3));
    const ls = lines(result);
    assert.equal(ls[0].slice(0, 20), "─".repeat(9) + "a" + "─".repeat(10));
    assert.equal(ls[1].slice(0, 20), "─".repeat(9) + "bb" + "─".repeat(9));
    assert.equal(ls[2].slice(0, 20), "─".repeat(8) + "ccc" + "─".repeat(9));
});

test("divider spaces spread the line", () => {
    // The label's own spaces spread the line (spaces matter in
    // pseudo-graphics)
    const result = render(dividerBlock("  a  \n  bb  \n  ccc  ", 20, 3));
    const ls = lines(result);
    assert.equal(ls[0].slice(0, 20), "─".repeat(7) + "  a  " + "─".repeat(8));
    assert.equal(ls[1].slice(0, 20), "─".repeat(7) + "  bb  " + "─".repeat(7));
    assert.equal(ls[2].slice(0, 20), "─".repeat(6) + "  ccc  " + "─".repeat(7));
});

test("divider alignment", () => {
    // meta.text_align aligns every line (left/right)
    let ls = lines(render(dividerBlock("a\nbb\nccc", 20, 3, { text_align: "left" })));
    assert.equal(ls[0].slice(0, 20), "a" + "─".repeat(19));
    assert.equal(ls[1].slice(0, 20), "bb" + "─".repeat(18));
    assert.equal(ls[2].slice(0, 20), "ccc" + "─".repeat(17));

    ls = lines(render(dividerBlock("a\nbb\nccc", 20, 3, { text_align: "right" })));
    assert.equal(ls[0].slice(0, 20), "─".repeat(19) + "a");
    assert.equal(ls[1].slice(0, 20), "─".repeat(18) + "bb");
    assert.equal(ls[2].slice(0, 20), "─".repeat(17) + "ccc");
});

test("divider vertical align: default middle", () => {
    // The label block is vertically centered by default (meta.vertical_align
    // absent — unlike box, whose default is top)
    const result = render(dividerBlock("or", 20, 3));
    const ls = lines(result);
    assert.equal(ls[0].slice(0, 20), "─".repeat(20));
    assert.equal(ls[1].slice(0, 20), "─".repeat(9) + "or" + "─".repeat(9));
    assert.equal(ls[2].slice(0, 20), "─".repeat(20));
});

test("divider vertical align: top / bottom", () => {
    let ls = lines(render(dividerBlock("or", 20, 3, { vertical_align: "top" })));
    assert.equal(ls[0].slice(0, 20), "─".repeat(9) + "or" + "─".repeat(9));
    assert.equal(ls[1].slice(0, 20), "─".repeat(20));
    assert.equal(ls[2].slice(0, 20), "─".repeat(20));

    ls = lines(render(dividerBlock("or", 20, 3, { vertical_align: "bottom" })));
    assert.equal(ls[0].slice(0, 20), "─".repeat(20));
    assert.equal(ls[1].slice(0, 20), "─".repeat(20));
    assert.equal(ls[2].slice(0, 20), "─".repeat(9) + "or" + "─".repeat(9));
});

test("divider vertical align: multiline block shift", () => {
    // A multiline label: the whole line block is shifted (middle — the
    // extra row goes to the bottom)
    const result = render(dividerBlock("a\nbb", 20, 5, { vertical_align: "middle" }));
    const ls = lines(result);
    // vOff = (5-2)//2 = 1
    assert.equal(ls[0].slice(0, 20), "─".repeat(20));
    assert.equal(ls[1].slice(0, 20), "─".repeat(9) + "a" + "─".repeat(10));
    assert.equal(ls[2].slice(0, 20), "─".repeat(9) + "bb" + "─".repeat(9));
    assert.equal(ls[3].slice(0, 20), "─".repeat(20));
    assert.equal(ls[4].slice(0, 20), "─".repeat(20));
});

test("divider vertical align: overflow is not shifted", () => {
    // Content taller than the block: no shift, the tail is clipped
    const result = render(dividerBlock("a\nbb\nccc\ndddd", 20, 2, { vertical_align: "bottom" }));
    const ls = lines(result);
    assert.equal(ls[0].slice(0, 20), "─".repeat(9) + "a" + "─".repeat(10));
    assert.equal(ls[1].slice(0, 20), "─".repeat(9) + "bb" + "─".repeat(9));
    assert.ok(!result.includes("ccc"));
    assert.ok(!result.includes("dddd"));
});

test("divider truncates to width", () => {
    // A line longer than the stored width is truncated (no word wrap)
    const result = render(dividerBlock("abcdefghij", 8, 1));
    assert.equal(lines(result)[0].slice(0, 8), "abcdefgh");
});

test("divider more lines than height", () => {
    // Content lines beyond the stored height are not drawn
    const result = render(dividerBlock("a\nbb\nccc\ndddd", 20, 2));
    const ls = lines(result);
    assert.equal(ls[0].slice(0, 20), "─".repeat(9) + "a" + "─".repeat(10));
    assert.equal(ls[1].slice(0, 20), "─".repeat(9) + "bb" + "─".repeat(9));
    assert.ok(!result.includes("ccc"));
    assert.ok(!result.includes("dddd"));
});

test("divider all styles", () => {
    const chars = { solid: "─", dashed: "┄", dotted: "┈", double: "═" };
    for (const [style, ch] of Object.entries(chars)) {
        const ls = lines(render(dividerBlock("x", 20, 2, null, style)));
        assert.equal(ls[0].slice(0, 20), ch.repeat(9) + "x" + ch.repeat(10), style);
        assert.equal(ls[1].slice(0, 20), ch.repeat(20), style);
    }
});

test("divider none: line invisible, label drawn", () => {
    const result = render(dividerBlock("or", 20, 1, null, "none"));
    assert.equal(lines(result)[0], "         or");
});

test("divider ignores children", () => {
    // Children are not drawn (a line is an atomic element)
    const result = render([
        {
            id: "d", block_type: "divider",
            x: 0, y: 0, width: 20, height: 3,
            content: "", border_style: "solid",
        },
        {
            id: "c", block_type: "text",
            x: 1, y: 1, width: 8, height: 1,
            content: "child", border_style: "none", parent_id: "d",
        },
    ]);
    assert.ok(!result.includes("child"));
    const ls = lines(result);
    assert.equal(ls.length, 3);
    for (let i = 0; i < 3; i++) {
        assert.equal(ls[i].slice(0, 20), "─".repeat(20));
    }
});

test("divider ignores arrows and fill", () => {
    const base = {
        id: "b1", block_type: "divider",
        x: 0, y: 0, width: 20, height: 1,
        content: "or", border_style: "solid",
    };
    const plain = render([base]);
    const withMeta = render([Object.assign({}, base,
        { meta: { arrow_start: "arrow", arrow_end: "diamond", fill: "░" } })]);
    assert.equal(withMeta, plain);
});

test("divider in container", () => {
    // A divider as a child is clipped to the container's inner area
    const result = render([
        {
            id: "p", block_type: "box",
            x: 0, y: 0, width: 12, height: 6,
            content: "", border_style: "solid",
        },
        {
            id: "d", block_type: "divider",
            x: 0, y: 1, width: 10, height: 2,
            content: "wide", border_style: "solid", parent_id: "p",
        },
    ]);
    const ls = lines(result);
    assert.equal(ls[2], "│───wide───│");
    assert.equal(ls[3], "│──────────│");
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
    // The clip lives on a .block-clip wrapper inside the parent (NOT on
    // .block-preview itself, so the parent's outline is not clipped);
    // the child has no clip wrapper of its own
    assert.ok(!parentTag.includes("overflow:hidden"));
    assert.ok(html.indexOf('class="block-clip"') > html.indexOf('data-block-id="parent"'));
    assert.ok(html.indexOf('class="block-clip"') < html.indexOf('data-block-id="child-1"'));
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
    // Both containers wrap their children in .block-clip; no block preview
    // itself carries overflow (the clip lives on the wrapper)
    assert.ok(!outerTag.includes("overflow:hidden"));
    assert.ok(!innerTag.includes("overflow:hidden"));
    assert.ok(!leafTag.includes("overflow:hidden"));
    assert.equal(html.split('class="block-clip"').length - 1, 2);
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
    // The oversized child is still nested and clipped by the parent's
    // .block-clip wrapper
    assert.ok(!parentTag.includes("overflow:hidden"));
    assert.ok(html.includes('class="block-clip"'));
    assert.ok(html.indexOf('data-block-id="parent"') < html.indexOf('data-block-id="big"'));
    assert.ok(bigTag.includes("width:360px"));   // 30*12
    assert.ok(bigTag.includes("height:144px"));  // 10*14.4
});

test("renderHtmlPreview border classes", () => {
    const dashed = PG.renderHtmlPreview([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "dashed",
    }]);
    assert.ok(dashed.includes('class="block-border block-border--dashed"'));

    const double = PG.renderHtmlPreview([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "double",
    }]);
    assert.ok(double.includes('class="block-border block-border--double"'));

    const none = PG.renderHtmlPreview([{
        id: "b1", block_type: "box",
        x: 0, y: 0, width: 10, height: 4,
        content: "", border_style: "none",
    }]);
    assert.ok(none.includes('class="block-border block-border--none"'));
});

test("renderHtmlPreview border none with children", () => {
    // A borderless box with children still gets the (weak) block-border
    // overlay and clips its children — the border div is generated
    // regardless of border_style.
    const html = PG.renderHtmlPreview([
        {
            id: "parent", block_type: "box",
            x: 0, y: 0, width: 20, height: 8,
            content: "", border_style: "none",
        },
        {
            id: "child-1", block_type: "text",
            x: 1, y: 1, width: 8, height: 3,
            content: "hi", border_style: "solid",
            parent_id: "parent",
        },
    ]);
    const parentTag = openingTag(html, "parent");
    const childTag = openingTag(html, "child-1");
    assert.ok(html.includes('class="block-border block-border--none"'));
    // The child is nested inside the parent and clipped by the parent's
    // .block-clip wrapper — the parent's own outline is not clipped
    assert.ok(!parentTag.includes("overflow:hidden"));
    assert.ok(html.includes('class="block-clip"'));
    assert.ok(!childTag.includes("overflow:hidden"));
    assert.ok(html.indexOf('data-block-id="parent"') < html.indexOf('data-block-id="child-1"'));
    // Child positioned relative to the parent: (1+1)*12=24px, (1+1)*14.4=28.8px
    assert.ok(childTag.includes("left:24px"));
    assert.ok(childTag.includes("top:28.8px"));
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

test("renderHtmlPreview divider empty: one full segment per row", () => {
    const html = PG.renderHtmlPreview([{
        id: "d1", block_type: "divider",
        x: 0, y: 0, width: 10, height: 3,
        content: "", border_style: "solid",
    }]);
    assert.equal(html.split('class="block-line block-line--h block-line--seg').length - 1, 3);
    // Row centers: 7.2 / 21.6 / 36 px (char_height_px=14.4)
    assert.ok(html.includes('style="top:7.2px;left:0px;width:120px;"'));
    assert.ok(html.includes('style="top:21.6px;left:0px;width:120px;"'));
    assert.ok(html.includes('style="top:36px;left:0px;width:120px;"'));
});

test("renderHtmlPreview divider segments around the label", () => {
    const html = PG.renderHtmlPreview([{
        id: "d2", block_type: "divider",
        x: 0, y: 0, width: 20, height: 2,
        content: "or\n", border_style: "dashed",
    }]);
    assert.ok(html.includes('block-line--seg block-line--dashed'));
    // "or" centered in 20: offset 9 → left segment 9 cells (108px),
    // right segment 9 cells (108px) at left 11*12=132px
    assert.ok(html.includes('style="top:7.2px;left:0px;width:108px;"'));
    assert.ok(html.includes('style="top:7.2px;left:132px;width:108px;"'));
    // The empty second line — one full-width segment
    assert.ok(html.includes('style="top:21.6px;left:0px;width:240px;"'));
    assert.equal(html.split('block-line--seg').length - 1, 3);
});

test("renderHtmlPreview divider label fills the row: no segments", () => {
    const html = PG.renderHtmlPreview([{
        id: "d3", block_type: "divider",
        x: 0, y: 0, width: 4, height: 1,
        content: "abcd", border_style: "solid",
    }]);
    assert.ok(!html.includes("block-line--seg"));
});

test("renderHtmlPreview divider vertical align: segments follow the shift", () => {
    // Default middle: the label sits on the middle row (center 21.6px)
    let html = PG.renderHtmlPreview([{
        id: "d4", block_type: "divider",
        x: 0, y: 0, width: 20, height: 3,
        content: "or", border_style: "solid",
    }]);
    // "or" centered in 20: offset 9 → 9-cell segments (108px) at 0 and
    // 132px; rows 0 and 2 are full-width
    assert.ok(html.includes('style="top:7.2px;left:0px;width:240px;"'));
    assert.ok(html.includes('style="top:21.6px;left:0px;width:108px;"'));
    assert.ok(html.includes('style="top:21.6px;left:132px;width:108px;"'));
    assert.ok(html.includes('style="top:36px;left:0px;width:240px;"'));
    assert.equal(html.split('block-line--seg').length - 1, 4);

    // top: the label sits on row 0 (center 7.2px)
    html = PG.renderHtmlPreview([{
        id: "d5", block_type: "divider",
        x: 0, y: 0, width: 20, height: 3,
        content: "or", border_style: "solid",
        meta: { vertical_align: "top" },
    }]);
    assert.ok(html.includes('style="top:7.2px;left:0px;width:108px;"'));
    assert.ok(html.includes('style="top:7.2px;left:132px;width:108px;"'));
    assert.ok(html.includes('style="top:21.6px;left:0px;width:240px;"'));
    assert.ok(html.includes('style="top:36px;left:0px;width:240px;"'));
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

// ── Content placeholder (todo-0004) ──────────────────────────────

test("content placeholder default size", () => {
    const result = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 40, height: 10,
        content: "", border_style: "solid",
    }], 40, 10);
    const ls = lines(result);
    assert.equal(ls.length, 10);
    // Border rows
    assert.equal(ls[0][0], "┌");
    assert.equal(ls[0][39], "┐");
    assert.equal(ls[9][0], "└");
    assert.equal(ls[9][39], "┘");
    // Content rows: 8 lines (rows 1–8)
    const contentLines = [];
    for (let i = 1; i < 9; i++) {
        assert.equal(ls[i][0], "│");
        assert.equal(ls[i][39], "│");
        contentLines.push(ls[i].slice(1, 39));
    }
    // First line starts with "lorem"
    assert.ok(contentLines[0].startsWith("lorem"));
    // Last line is shorter than the others
    assert.ok(contentLines[contentLines.length - 1].replace(/\s+$/, "").length <
              contentLines[0].replace(/\s+$/, "").length);
    // All lines are non-empty
    for (const cl of contentLines) {
        assert.ok(cl.trim().length > 0);
    }
});

test("content placeholder deterministic", () => {
    const block = {
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 30, height: 6,
        content: "", border_style: "solid",
    };
    const r1 = render([block], 30, 6);
    const r2 = render([block], 30, 6);
    assert.equal(r1, r2);
});

test("content placeholder resize rewraps", () => {
    const small = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 20, height: 4,
        content: "", border_style: "solid",
    }], 20, 4);
    const large = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 40, height: 10,
        content: "", border_style: "solid",
    }], 40, 10);
    const smallContent = lines(small).slice(1, 3).map(l => l.slice(1, 19)).join("\n");
    const largeContent = lines(large).slice(1, 9).map(l => l.slice(1, 39)).join("\n");
    assert.notEqual(smallContent, largeContent);
    assert.ok(smallContent.startsWith("lorem"));
    assert.ok(largeContent.startsWith("lorem"));
});

test("content placeholder last line shorter", () => {
    const result = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 40, height: 10,
        content: "", border_style: "solid",
    }], 40, 10);
    const ls = lines(result);
    const contentLines = ls.slice(1, 9).map(l => l.slice(1, 39));
    // Content width is 38; last line should be <= 26 chars (38*7//10=26)
    const lastLen = contentLines[contentLines.length - 1].replace(/\s+$/, "").length;
    assert.ok(lastLen <= 26);
    assert.ok(lastLen >= 3);
    // Last line is shorter than the longest content line
    const maxLen = Math.max(...contentLines.slice(0, -1).map(cl => cl.replace(/\s+$/, "").length));
    assert.ok(lastLen < maxLen);
});

test("content nonempty content no placeholder", () => {
    const result = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 20, height: 5,
        content: "Hello World", border_style: "solid",
    }], 20, 5);
    const ls = lines(result);
    const contentText = ls.slice(1, 4).map(l => l.slice(1, 19)).join("\n");
    assert.ok(contentText.includes("Hello"));
    assert.ok(!contentText.includes("lorem"));
});

test("content fill suppresses placeholder", () => {
    const result = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 20, height: 5,
        content: "", border_style: "solid",
        meta: { fill: "░" },
    }], 20, 5);
    const ls = lines(result);
    for (let i = 1; i < 4; i++) {
        const row = ls[i].slice(1, 19);
        assert.ok(!row.includes("lorem"));
        assert.ok([...row].every(c => c === "░"));
    }
});

test("content placeholder text align", () => {
    const left = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 30, height: 4,
        content: "", border_style: "solid",
        meta: { text_align: "left" },
    }], 30, 4);
    const center = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 30, height: 4,
        content: "", border_style: "solid",
        meta: { text_align: "center" },
    }], 30, 4);
    // Last content line (row 2, shorter) should be positioned differently
    const leftLast = lines(left)[2].slice(1, 29);
    const centerLast = lines(center)[2].slice(1, 29);
    assert.notEqual(leftLast, centerLast);
    // Left-aligned: starts at position 0 (no leading spaces)
    assert.ok(leftLast[0] !== " ");
    // Center-aligned: has leading spaces (shorter line centered)
    assert.ok(centerLast[0] === " ");
});

test("content placeholder no border", () => {
    const result = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 20, height: 4,
        content: "", border_style: "none",
    }], 20, 4);
    const ls = lines(result);
    assert.equal(ls.length, 4);
    // No border characters, content starts at column 0
    assert.ok(ls[0].startsWith("lorem"));
});

test("content placeholder small block", () => {
    const result = render([{
        id: "b1", block_type: "content",
        x: 0, y: 0, width: 2, height: 2,
        content: "", border_style: "solid",
    }], 20, 10);
    const ls = lines(result);
    // 2×2 block: just border, no content area
    assert.equal(ls[0], "┌┐");
    assert.equal(ls[1], "└┘");
    assert.ok(!result.includes("lorem"));
});

// ── Grid tests (variant 1 — partitions, todo-0005) ─────────────────

// A grid block. meta == undefined means a NEW grid — explicit structure
// {cols: 3, rows: 2} (what the editor/API create, 0069); pass meta: {}
// for a LEGACY grid (no cols/rows — renders as a plain box).
function gridBlock(width = 24, height = 8, meta, border_style = "solid",
                   x = 0, y = 0, content = "") {
    const b = {
        id: "g1", block_type: "grid",
        x, y, width, height, content, border_style,
    };
    b.meta = meta === undefined ? { cols: 3, rows: 2 } : meta;
    return [b];
}

test("gridMetaInt: positive int or default", () => {
    assert.equal(PG.gridMetaInt(null, "cols", 3), 3);
    assert.equal(PG.gridMetaInt({}, "cols", 3), 3);
    assert.equal(PG.gridMetaInt({ cols: 5 }, "cols", 3), 5);
    assert.equal(PG.gridMetaInt({ cols: 1 }, "cols", 3), 1);
    assert.equal(PG.gridMetaInt({ cols: 0 }, "cols", 3), 3);
    assert.equal(PG.gridMetaInt({ cols: -1 }, "cols", 3), 3);
    assert.equal(PG.gridMetaInt({ cols: "5" }, "cols", 3), 3);
    assert.equal(PG.gridMetaInt({ cols: true }, "cols", 3), 3);
    assert.equal(PG.gridMetaInt({ cols: 2.5 }, "cols", 3), 3);
    assert.equal(PG.gridMetaInt({ rows: 4 }, "rows", 2), 4);
});

test("gridHasStructure: valid cols or rows", () => {
    assert.equal(PG.gridHasStructure(null), false);
    assert.equal(PG.gridHasStructure({}), false);
    assert.equal(PG.gridHasStructure({ fill: "░" }), false);
    assert.equal(PG.gridHasStructure({ cols: 3 }), true);
    assert.equal(PG.gridHasStructure({ rows: 2 }), true);
    assert.equal(PG.gridHasStructure({ cols: 1 }), true);
    assert.equal(PG.gridHasStructure({ cols: 0 }), false);
    assert.equal(PG.gridHasStructure({ cols: -1 }), false);
    assert.equal(PG.gridHasStructure({ cols: "3" }), false);
    assert.equal(PG.gridHasStructure({ cols: true }), false);
    assert.equal(PG.gridHasStructure({ cols: 2.5 }), false);
    assert.equal(PG.gridHasStructure({ cols: 0, rows: 4 }), true);
});

test("gridCreateMeta: default cols/rows to 3/2", () => {
    assert.deepEqual(PG.gridCreateMeta(null), { cols: 3, rows: 2 });
    assert.deepEqual(PG.gridCreateMeta({}), { cols: 3, rows: 2 });
    assert.deepEqual(PG.gridCreateMeta({ cols: 4 }), { cols: 4, rows: 2 });
    assert.deepEqual(PG.gridCreateMeta({ rows: 3 }), { cols: 3, rows: 3 });
    assert.deepEqual(PG.gridCreateMeta({ cols: 4, rows: 3 }), { cols: 4, rows: 3 });
    assert.deepEqual(PG.gridCreateMeta({ cols: 0 }), { cols: 3, rows: 2 });
    assert.deepEqual(PG.gridCreateMeta({ cols: "4", rows: -1 }), { cols: 3, rows: 2 });
    assert.deepEqual(PG.gridCreateMeta({ fill: "░" }), { fill: "░", cols: 3, rows: 2 });
    // the input object is not mutated
    const src = { fill: "░" };
    PG.gridCreateMeta(src);
    assert.deepEqual(src, { fill: "░" });
});

test("grid legacy (no meta) renders as a plain box", () => {
    // A legacy grid (no cols/rows in meta) renders as a plain box — the
    // border and the [grid] hint, no partitions (0069).
    const result = render(gridBlock(24, 8, {}));
    const expected = [
        "┌" + "─".repeat(22) + "┐",
        "│[grid]" + " ".repeat(16) + "│",
        "│" + " ".repeat(22) + "│",
        "│" + " ".repeat(22) + "│",
        "│" + " ".repeat(22) + "│",
        "│" + " ".repeat(22) + "│",
        "│" + " ".repeat(22) + "│",
        "└" + "─".repeat(22) + "┘",
    ].join("\n");
    assert.equal(result, expected);
    assert.ok(!result.includes("┬") && !result.includes("┼") && !result.includes("┴"));
});

test("grid legacy none border renders empty", () => {
    // A legacy grid without a border renders nothing (0069)
    const result = render(gridBlock(24, 8, {}, "none"));
    assert.equal(result.trim(), "");
});

test("grid legacy double border", () => {
    // A legacy grid with a double border: the double frame and the
    // [grid] hint, no partitions (0069)
    const result = render(gridBlock(24, 8, {}, "double"));
    const ls = lines(result);
    assert.equal(ls[0][0], "╔");
    assert.equal(ls[0][23], "╗");
    assert.equal(ls[7][0], "╚");
    assert.equal(ls[7][23], "╝");
    assert.equal(ls[1].slice(1, 7), "[grid]");
    assert.ok(!result.includes("╦") && !result.includes("╬"));
});

test("grid legacy fill inset by border", () => {
    // A legacy grid with fill: the fill is inset by the border (the box
    // path), no partitions, the hint is suppressed by the fill (0069)
    const result = render(gridBlock(24, 8, { fill: "░" }));
    const ls = lines(result);
    assert.equal(ls[0], "┌" + "─".repeat(22) + "┐");
    assert.equal(ls[1], "│" + "░".repeat(22) + "│");
    assert.equal(ls[7], "└" + "─".repeat(22) + "┘");
    assert.ok(!result.includes("[grid]"));
    assert.ok(!result.includes("┬") && !result.includes("┼"));
});

test("grid legacy children render without partitions", () => {
    // A legacy grid with a child: the child renders in the inner area,
    // no partitions are drawn (0069)
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 24, height: 8,
          content: "", border_style: "solid", meta: {} },
        { id: "c1", block_type: "box", parent_id: "g1", x: 0, y: 0,
          width: 10, height: 3, content: "0123456789", border_style: "solid" },
    ]);
    const ls = lines(result);
    // child box at abs (1,1) 10×3
    assert.equal(ls[1].slice(1, 11), "┌────────┐");
    assert.equal(ls[2].slice(1, 11), "│01234567│");
    assert.ok(!result.includes("┬") && !result.includes("┼") && !result.includes("┴"));
});

test("grid cols only activates structure", () => {
    // A grid with only meta.cols (no rows) has structure — it renders
    // the partitions with the default rows=2 (0069)
    const result = render(gridBlock(24, 8, { cols: 4 }));
    const ls = lines(result);
    // inner 22, 4 cols → partitions at inner 5, 11, 16 → abs 6, 12, 17
    assert.equal(ls[0][6], "┬");
    assert.equal(ls[0][12], "┬");
    assert.equal(ls[0][17], "┬");
    // rows default 2 → the horizontal partition at inner 3 → abs row 4
    assert.equal(ls[4][0], "├");
    assert.ok(!result.includes("[grid]"));
});

test("grid invalid meta is legacy", () => {
    // A grid whose meta carries only invalid cols/rows has no structure
    // — it renders as a plain box (0069)
    const result = render(gridBlock(24, 8, { cols: "3", rows: 2.5 }));
    const ls = lines(result);
    assert.equal(ls[0], "┌" + "─".repeat(22) + "┐");
    assert.equal(ls[1].slice(1, 7), "[grid]");
    assert.ok(!result.includes("┬") && !result.includes("┼"));
});

test("grid default 3x2", () => {
    // A new grid (meta cols=3/rows=2 — the create default, 0069), solid
    // border: the outer frame plus inner partitions with junction nodes;
    // empty content area.
    const result = render(gridBlock());
    const expected = [
        "┌───────┬──────┬───────┐",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ].join("\n");
    assert.equal(result, expected);
});

test("grid split with remainder", () => {
    // 21×7 → inner 19×5, cols=4 → partitions at inner 4, 9, 14
    const result = render(gridBlock(21, 7, { cols: 4, rows: 2 }));
    const ls = lines(result);
    // inner_x = 1, so partitions at absolute cols 5, 10, 15
    assert.equal(ls[0][5], "┬");
    assert.equal(ls[0][10], "┬");
    assert.equal(ls[0][15], "┬");
    assert.equal(ls[6][5], "┴");
    assert.equal(ls[6][10], "┴");
    assert.equal(ls[6][15], "┴");
    // rows=2 → the single horizontal partition at inner 2 → absolute row 3
    assert.equal(ls[3][0], "├");
    assert.equal(ls[3][20], "┤");
    assert.equal(ls[3][5], "┼");
    assert.equal(ls[3][10], "┼");
    assert.equal(ls[3][15], "┼");
});

test("grid clamps cols to inner width", () => {
    // 10×10 (inner 8) with cols=20 → 8 columns
    const result = render(gridBlock(10, 10, { cols: 20, rows: 2 }));
    const ls = lines(result);
    // inner_x=1, inner_w=8 → partitions at every inner col 1..7 → abs 2..8
    for (let col = 2; col <= 8; col++) {
        assert.equal(ls[0][col], "┬");
        assert.equal(ls[1][col], "│");
    }
});

test("grid clamps rows to inner height", () => {
    // 10×10 (inner 8) with rows=20 → 8 rows
    const result = render(gridBlock(10, 10, { cols: 2, rows: 20 }));
    const ls = lines(result);
    // inner_y=1, inner_h=8 → partitions at every inner row 1..7 → abs 2..8
    for (let row = 2; row <= 8; row++) {
        assert.equal(ls[row][1], "─");
        assert.equal(ls[row][8], "─");
    }
});

test("grid none border", () => {
    // border_style none — no outer border, solid partitions over the
    // whole block area
    const result = render(gridBlock(24, 8, { cols: 3, rows: 2 }, "none"));
    const ls = lines(result);
    // 24×8, inner = whole block, cols=3 → partitions at inner 8, 16;
    // rows=2 → the horizontal partition at inner 4
    assert.equal(ls[0][8], "│");
    assert.equal(ls[0][16], "│");
    assert.equal(ls[4][0], "─");
    assert.equal(ls[4][8], "┼");
    assert.equal(ls[4][16], "┼");
    assert.equal(ls[7][8], "│");
    // no outer border characters
    assert.ok(!result.includes("┌") && !result.includes("┐"));
    assert.ok(!result.includes("└") && !result.includes("┘"));
});

test("grid fill under partitions", () => {
    const result = render(gridBlock(12, 6, { cols: 2, rows: 2, fill: "░" }));
    const ls = lines(result);
    // inner 10×4, partition at inner 5 → abs col 6 (the partition takes a
    // cell, so the columns are 5 and 4 wide); row partition at abs 3
    assert.equal(ls[1], "│░░░░░│░░░░│");
    assert.equal(ls[2], "│░░░░░│░░░░│");
    assert.equal(ls[3], "├─────┼────┤");
    assert.equal(ls[4], "│░░░░░│░░░░│");
});

test("grid children render over partitions", () => {
    // Children are drawn after the partitions: the partition under the
    // child is not drawn at all (0062), the child's border and content
    // are drawn there; the partition stays visible outside the child's
    // span. Under 0066 the child's bottom edge sits on the row boundary,
    // so the span extends into the row below and the crossed partition
    // x=8 is suppressed there; the uncrossed partition x=15 stays visible.
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 24, height: 8,
          content: "", border_style: "solid", meta: { cols: 3, rows: 2 } },
        { id: "c1", block_type: "box", parent_id: "g1", x: 0, y: 0,
          width: 10, height: 3, content: "0123456789", border_style: "solid" },
    ]);
    const ls = lines(result);
    // child box at abs (1,1) 10×3 covers the partition at abs col 8, rows 1..3
    assert.equal(ls[1][8], "─"); // child top border overwrote the partition
    assert.equal(ls[2][8], "6"); // child content overwrote the partition
    assert.equal(ls[3][8], "─"); // child bottom border overwrote the partition
    assert.equal(ls[5][15], "│"); // uncrossed partition x=15 stays visible
});

test("grid degenerate 2x2 is plain border", () => {
    // A 2×2 grid has no inner area → just the border, no partitions
    const result = render(gridBlock(2, 2));
    const ls = lines(result);
    assert.equal(ls[0], "┌┐");
    assert.equal(ls[1], "└┘");
});

test("grid hint suppressed", () => {
    // A grid is a structural element: no [grid] hint is drawn
    const result = render(gridBlock());
    assert.ok(!result.includes("[grid]"));
});

test("grid content not rendered", () => {
    // A structured grid's content is not rendered (like a line)
    const result = render(gridBlock(24, 8, { cols: 3, rows: 2 }, "solid", 0, 0, "hello"));
    assert.ok(!result.includes("hello"));
});

test("grid single col single row", () => {
    // cols=1, rows=1 → no partitions, just the outer border
    const result = render(gridBlock(24, 8, { cols: 1, rows: 1 }));
    const ls = lines(result);
    assert.equal(ls[0], "┌" + "─".repeat(22) + "┐");
    assert.equal(ls[3], "│" + " ".repeat(22) + "│");
    assert.equal(ls[7], "└" + "─".repeat(22) + "┘");
    // no interior partition nodes
    assert.ok(!result.includes("┬") && !result.includes("┼") && !result.includes("┴"));
});

test("grid double border", () => {
    // border_style double — the frame and the partitions use the double
    // style map
    const result = render(gridBlock(24, 8, { cols: 3, rows: 2 }, "double"));
    const ls = lines(result);
    assert.equal(ls[0][0], "╔");
    assert.equal(ls[0][8], "╦");
    assert.equal(ls[0][15], "╦");
    assert.equal(ls[0][23], "╗");
    assert.equal(ls[1][0], "║");
    assert.equal(ls[1][8], "║");
    assert.equal(ls[4][0], "╠");
    assert.equal(ls[4][8], "╬");
    assert.equal(ls[4][23], "╣");
    assert.equal(ls[7][0], "╚");
    assert.equal(ls[7][8], "╩");
    assert.equal(ls[7][23], "╝");
});

// ── Grid span: partitions are not drawn under children (0062) ─────────

function gridWithChild(child) {
    return [
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 24, height: 8,
          content: "", border_style: "solid", meta: { cols: 3, rows: 2 } },
        Object.assign({ id: "c1", parent_id: "g1", content: "",
                        border_style: "none" }, child),
    ];
}

test("grid span suppresses partitions under child", () => {
    // A borderless child at the top-left (14×3) spans cols 1–2 × the top
    // row (0064): its right edge sits inside the second column and its
    // bottom edge is flush with the row boundary, which does not extend
    // the span (0068). The partition x=8 the child straddles is
    // suppressed across the spanned rows, the horizontal partition y=4
    // stays fully drawn (the child does not straddle it), the junction
    // (8,4) keeps only the drawn arms (┬) and the frame node over x=8
    // degrades to a plain line (0063).
    const result = render(gridWithChild({ block_type: "text",
        x: 0, y: 0, width: 14, height: 3, content: "SPAN" }));
    assert.equal(result, [
        "┌──────────────┬───────┐",
        "│SPAN          │       │",
        "│              │       │",
        "│              │       │",
        "├───────┬──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ].join("\n"));
});

test("grid span vertical", () => {
    // A child at the left (7×6) spans the first column × both rows
    // (0064): its right edge is flush with the column boundary, which
    // does not extend the span (0068). The horizontal partition y=4 the
    // child straddles is suppressed across the spanned column (x=1..7),
    // the vertical partitions stay, and the junction (8,4) keeps only
    // the drawn arms (├) (0063).
    const result = render(gridWithChild({ block_type: "text",
        x: 0, y: 0, width: 7, height: 6 }));
    assert.equal(result, [
        "┌───────┬──────┬───────┐",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "│       ├──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ].join("\n"));
});

test("grid span 2x2", () => {
    // A child at the top-left (14×6) spans cols 1–2 × both rows (0064):
    // its right edge is flush with the column boundary, which does not
    // extend the span (0068). The partition x=8 the child straddles is
    // suppressed across the full height, the horizontal partition y=4 is
    // suppressed across the spanned columns (the junction at x=15, which
    // the child does not straddle, degrades to ├), and the frame nodes
    // over the suppressed segments degrade to plain lines (0063).
    const result = render(gridWithChild({ block_type: "text",
        x: 0, y: 0, width: 14, height: 6 }));
    assert.equal(result, [
        "┌──────────────┬───────┐",
        "│              │       │",
        "│              │       │",
        "│              │       │",
        "│              ├───────┤",
        "│              │       │",
        "│              │       │",
        "└──────────────┴───────┘",
    ].join("\n"));
});

test("grid span misaligned child", () => {
    // A child not aligned to the cell boundaries spans the whole cells
    // it touches (0064): the partitions inside the spanned cells are not
    // drawn, including segments outside the child's own rectangle; the
    // partitions outside the spanned cells stay.
    const result = render(gridWithChild({ block_type: "text",
        x: 2, y: 2, width: 10, height: 3 }));
    const ls = lines(result);
    // child at abs (3,3) 10×3 intersects cols 1–2 (abs x [1,15)) and both
    // rows (abs y [1,7)) — the span region is the whole 2×2 block
    assert.equal(ls[1][8], " "); // col partition inside the span — suppressed
    assert.equal(ls[3][8], " "); // under the child
    assert.equal(ls[6][8], " "); // ...including above/below the child's rect
    assert.equal(ls[1][15], "│"); // col partition outside the span — stays
    assert.equal(ls[4][15], "├"); // junction: the left arm is suppressed
    assert.equal(ls[4][2], " "); // row partition inside the span — suppressed
    assert.equal(ls[4][14], " ");
    assert.equal(ls[4][16], "─"); // row partition outside the span — stays
    assert.equal(ls[0][8], "─"); // frame node over a suppressed segment
    assert.equal(ls[0][15], "┬");
    assert.equal(ls[7][8], "─");
    assert.equal(ls[7][15], "┴");
});

test("grid span fill kept under child", () => {
    // meta.fill is kept under the child: a suppressed partition cell
    // shows the fill, not a space. The child (10×2 at the top) spans
    // both columns × the top row (0064): its bottom edge is flush with
    // the row boundary, which does not extend the span (0068). The
    // partition x=6 the child straddles is suppressed across the spanned
    // row (showing the fill), and the horizontal partition y=3 stays
    // fully drawn (the child does not straddle it).
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 12, height: 6,
          content: "", border_style: "solid",
          meta: { cols: 2, rows: 2, fill: "░" } },
        { id: "c1", block_type: "text", parent_id: "g1", x: 0, y: 0,
          width: 10, height: 2, content: "", border_style: "none" },
    ]);
    const ls = lines(result);
    assert.equal(ls[0], "┌" + "─".repeat(10) + "┐"); // top frame node degraded (0063)
    assert.equal(ls[1], "│░░░░░░░░░░│");
    assert.equal(ls[2], "│░░░░░░░░░░│");
    assert.equal(ls[3], "├─────┬────┤"); // y=3 stays drawn (not straddled)
    assert.equal(ls[4], "│░░░░░│░░░░│"); // x=6 drawn in the bottom row
    assert.equal(ls[5], "└─────┴────┘"); // bottom frame node over x=6
});

test("grid span child covers whole inner area", () => {
    // A child covering the whole inner area — no inner partitions and
    // the frame nodes on the outer border degrade to plain line
    // characters (0063): no line ends stick out of the spanned cell.
    const result = render(gridWithChild({ block_type: "text",
        x: 0, y: 0, width: 22, height: 6 }));
    const ls = lines(result);
    assert.equal(ls[0], "┌" + "─".repeat(22) + "┐");
    assert.equal(ls[7], "└" + "─".repeat(22) + "┘");
    assert.equal(ls[4], "│" + " ".repeat(22) + "│");
    assert.ok(!result.includes("┼"));
});

test("grid span none border", () => {
    // border_style none (solid partitions over the whole area) — the
    // suppression works the same: the child spans the whole cells it
    // touches (0064), so the partitions inside them are not drawn and
    // the junction at the span's edge keeps only the drawn arms.
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 24, height: 8,
          content: "", border_style: "none", meta: { cols: 3, rows: 2 } },
        { id: "c1", block_type: "text", parent_id: "g1", x: 0, y: 0,
          width: 8, height: 4, content: "", border_style: "none" },
    ]);
    const ls = lines(result);
    // child at abs (1,1) 8×4 intersects cols 1–2 (abs x [0,16)) and both
    // rows (abs y [0,8)) — the span region is the whole 2×2 block
    assert.equal(ls[0][8], " "); // col partition inside the span — suppressed
    assert.equal(ls[2][8], " ");
    assert.equal(ls[5][8], " "); // ...including above/below the child's rect
    assert.equal(ls[4][0], " "); // row partition inside the span — suppressed
    assert.equal(ls[4][1], " ");
    assert.equal(ls[4][8], " "); // junction inside the span — suppressed
    assert.equal(ls[4][16], "├"); // junction at the span's edge: left arm gone
    assert.equal(ls[2][16], "│"); // the other vertical partition stays
});

test("grid span frame nodes full picture", () => {
    // A child at the top-left (24×9) spans cols 1–2 × both rows (0064):
    // its right edge is flush with the column boundary, which does not
    // extend the span (0068). The partition x=13 the child straddles is
    // suppressed across the full height, the horizontal partition y=5 is
    // suppressed across the spanned columns (the junction at x=25, which
    // the child does not straddle, degrades to ├), and the frame nodes
    // over the suppressed segments degrade to plain lines (0063).
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 38, height: 11,
          content: "", border_style: "solid", meta: { cols: 3, rows: 2 } },
        { id: "c1", block_type: "text", parent_id: "g1", x: 0, y: 0,
          width: 24, height: 9, content: "", border_style: "none" },
    ], 40, 12);
    const expected = [
        "┌────────────────────────┬───────────┐",
        "│                        │           │",
        "│                        │           │",
        "│                        │           │",
        "│                        │           │",
        "│                        ├───────────┤",
        "│                        │           │",
        "│                        │           │",
        "│                        │           │",
        "│                        │           │",
        "└────────────────────────┴───────────┘",
    ].join("\n");
    assert.equal(result, expected);
});

test("grid span TO BE change-cells", () => {
    // The TO BE picture from tasks/0061-0070/change-cells-span.md, case
    // «grid с одним дочерним элементом, пересекающим внутренние границы»:
    // a child smaller than the spanned cells still spans the whole cells
    // it touches (0064) — the partition column between cells 1–2 is not
    // drawn above/below the child either, and the row partition starts at
    // the span's edge (├, not ┼).
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 38, height: 11,
          content: "", border_style: "solid", meta: { cols: 3, rows: 2 } },
        { id: "c1", block_type: "box", parent_id: "g1", x: 2, y: 2,
          width: 19, height: 5,
          content: "lorem ipsum dolor\nsit amet,\nconsectetur",
          border_style: "double" },
    ], 40, 12);
    const expected = [
        "┌────────────────────────┬───────────┐",
        "│                        │           │",
        "│                        │           │",
        "│  ╔═════════════════╗   │           │",
        "│  ║lorem ipsum dolor║   │           │",
        "│  ║sit amet,        ║   ├───────────┤",
        "│  ║consectetur      ║   │           │",
        "│  ╚═════════════════╝   │           │",
        "│                        │           │",
        "│                        │           │",
        "└────────────────────────┴───────────┘",
    ].join("\n");
    assert.equal(result, expected);
});

test("grid span TO BE change-cells 2", () => {
    // The TO BE picture from tasks/0061-0070/change-cells-span2.md: a
    // child in the bottom-right area (rel (16,5), 18×3) crossing only the
    // vertical partition x=25 — under the crossing rule (0065) the
    // horizontal partition y=5 stays fully drawn (the child does not
    // straddle it), the left partition x=13 stays drawn (not crossed),
    // and only x=25 is removed across the spanned rows; the junction
    // (25,5) and the bottom frame nodes keep only the drawn arms
    // ((25,5) → ┴, (25,10) → ─, (13,10) → ┴).
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 38, height: 11,
          content: "", border_style: "solid", meta: { cols: 3, rows: 2 } },
        { id: "c1", block_type: "box", parent_id: "g1", x: 16, y: 5,
          width: 18, height: 3, content: "lorem ipsum",
          border_style: "double" },
    ], 40, 12);
    const expected = [
        "┌────────────┬───────────┬───────────┐",
        "│            │           │           │",
        "│            │           │           │",
        "│            │           │           │",
        "│            │           │           │",
        "├────────────┼───────────┴───────────┤",
        "│            │   ╔════════════════╗  │",
        "│            │   ║lorem ipsum     ║  │",
        "│            │   ╚════════════════╝  │",
        "│            │                       │",
        "└────────────┴───────────────────────┘",
    ].join("\n");
    assert.equal(result, expected);
});

test("grid span TO BE change-cells 3 (1)", () => {
    // The TO BE (1) picture from tasks/0061-0070/change-cells-span3.md:
    // a child whose LEFT edge sits exactly on the vertical partition
    // x=13 (rel (12,0), 14×3, abs x[13,27) y[1,4)). Under the
    // boundary-inclusive crossing rule (0066) the partition x=13 is
    // counted as crossed (rx0 <= p) and suppressed; x=25 is also
    // crossed (the child's right edge x=26 is past it). The span is all
    // 3 columns × row 1 (the child is entirely in row 1), so both
    // vertical partitions are removed across row 1; the horizontal
    // partition y=5 is not crossed (ry1=4 < 5) and stays drawn, and the
    // junctions (13,5)/(25,5) lose their upper arm (┼ → ┬).
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 38, height: 11,
          content: "", border_style: "solid", meta: { cols: 3, rows: 2 } },
        { id: "c1", block_type: "box", parent_id: "g1", x: 12, y: 0,
          width: 14, height: 3, content: "lorem ipsum",
          border_style: "double" },
    ], 40, 12);
    const expected = [
        "┌────────────────────────────────────┐",
        "│            ╔════════════╗          │",
        "│            ║lorem ipsum ║          │",
        "│            ╚════════════╝          │",
        "│                                    │",
        "├────────────┬───────────┬───────────┤",
        "│            │           │           │",
        "│            │           │           │",
        "│            │           │           │",
        "│            │           │           │",
        "└────────────┴───────────┴───────────┘",
    ].join("\n");
    assert.equal(result, expected);
});

test("grid span TO BE change-cells 3 (2)", () => {
    // The TO BE (2) picture from tasks/0061-0070/change-cells-span3.md:
    // a child whose TOP edge sits exactly on the horizontal partition
    // y=5 (rel (12,4), 14×3, abs x[13,27) y[5,8)). Under the
    // closed-interval cell intersection (0066) the span extends into the
    // row above (the child touches row 1's bottom boundary at y=5), so
    // the span is all 3 columns × both rows; under the
    // boundary-inclusive crossing rule the partition y=5 is counted as
    // crossed (ry0 <= q) and suppressed, and x=13/x=25 are crossed too —
    // every partition is removed, leaving only the outer frame.
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 38, height: 11,
          content: "", border_style: "solid", meta: { cols: 3, rows: 2 } },
        { id: "c1", block_type: "box", parent_id: "g1", x: 12, y: 4,
          width: 14, height: 3, content: "lorem ipsum",
          border_style: "double" },
    ], 40, 12);
    const expected = [
        "┌────────────────────────────────────┐",
        "│                                    │",
        "│                                    │",
        "│                                    │",
        "│                                    │",
        "│            ╔════════════╗          │",
        "│            ║lorem ipsum ║          │",
        "│            ╚════════════╝          │",
        "│                                    │",
        "│                                    │",
        "└────────────────────────────────────┘",
    ].join("\n");
    assert.equal(result, expected);
});

test("grid span TO BE change-cells 4", () => {
    // The TO BE picture from tasks/0061-0070/change-cells-span4.md: a
    // 4×4 double grid with custom col_widths/row_heights (partitions at
    // abs x=8,21,32 and y=2,5,8) and a content child 23×5 at abs x[9,32)
    // y[3,8) whose right edge is flush with the C2|C3 partition (x=32)
    // and its bottom edge with the R1|R2 partition (y=8). Under 0068 a
    // right/bottom edge flush with a boundary does not extend the span,
    // so the span is cols 2–3 × rows 2–3 (abs x[8,32) y[2,8)): the
    // partition x=21 the child straddles is suppressed across the
    // spanned rows, the partition y=5 across the spanned columns, and
    // the boundaries x=32 / y=8 (and the cells beyond them) stay fully
    // drawn.
    const result = render([
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 38, height: 11,
          content: "", border_style: "double",
          meta: { cols: 4, rows: 4, col_widths: [7, 13, 11, 5],
                  row_heights: [1, 3, 3, 2] } },
        { id: "c1", block_type: "content", parent_id: "g1", x: 8, y: 2,
          width: 23, height: 5, content: "", border_style: "solid" },
    ], 38, 11);
    const expected = [
        "╔═══════╦════════════╦══════════╦════╗",
        "║       ║            ║          ║    ║",
        "╠═══════╬════════════╩══════════╬════╣",
        "║       ║┌─────────────────────┐║    ║",
        "║       ║│lorem ipsum dolor sit│║    ║",
        "╠═══════╣│amet, consectetur    │╠════╣",
        "║       ║│adipiscing eli       │║    ║",
        "║       ║└─────────────────────┘║    ║",
        "╠═══════╬════════════╦══════════╬════╣",
        "║       ║            ║          ║    ║",
        "╚═══════╩════════════╩══════════╩════╝",
    ].join("\n");
    assert.equal(result, expected);
});

function grid3x3WithChild(child) {
    // A 24×12 grid (3 cols × 3 rows, solid) with one borderless, empty
    // child — the child renders nothing, only its span region is visible.
    // Inner x[1,23) y[1,11); vertical partitions at abs x=8,15;
    // horizontal at abs y=4,7; cells C1 x[1,8), C2 x[8,15), C3 x[15,23),
    // R1 y[1,4), R2 y[4,7), R3 y[7,11).
    return [
        { id: "g1", block_type: "grid", x: 0, y: 0, width: 24, height: 12,
          content: "", border_style: "solid", meta: { cols: 3, rows: 3 } },
        Object.assign({ id: "c1", parent_id: "g1", block_type: "text",
                        content: "", border_style: "none" }, child),
    ];
}

test("grid span top horizontal", () => {
    // Child in the top row crossing the C1|C2 boundary (x=8): the span is
    // C1-C2 × R1 (abs x[1,15) y[1,4)) — the vertical partition x=8 is not
    // drawn across the whole top row, the top frame node over it degrades
    // to ─, and the junction below the span (8,4) loses its upper arm (┬).
    const result = render(grid3x3WithChild({ x: 1, y: 1, width: 12, height: 1 }));
    assert.equal(result, [
        "┌──────────────┬───────┐",
        "│              │       │",
        "│              │       │",
        "│              │       │",
        "├───────┬──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ].join("\n"));
});

test("grid span right vertical", () => {
    // Child in the right column crossing the R1|R2 boundary (y=4): the
    // span is C3 × R1-R2 (abs x[15,23) y[1,7)) — the child straddles only
    // the horizontal partition y=4, so it is suppressed across the spanned
    // columns (x=16-22) while the vertical partition x=15 is kept (the
    // child does not cross it, 0065); the right frame node at (23,4)
    // degrades to │, and the junctions (15,4)/(15,7) keep only the drawn
    // arms (┤/┼).
    const result = render(grid3x3WithChild({ x: 17, y: 1, width: 4, height: 4 }));
    assert.equal(result, [
        "┌───────┬──────┬───────┐",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┤       │",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ].join("\n"));
});

test("grid span bottom horizontal", () => {
    // Child in the bottom row crossing the C2|C3 boundary (x=15): the span
    // is C2-C3 × R3 (abs x[8,23) y[7,11)) — the child straddles only the
    // vertical partition x=15, so it is suppressed across the spanned rows
    // (y=8-10) while the horizontal partition y=7 is kept (the child does
    // not cross it, 0065); the bottom frame node over x=15 degrades to ─,
    // and the junctions (8,7)/(15,7) keep only the drawn arms (┼/┴).
    const result = render(grid3x3WithChild({ x: 9, y: 7, width: 12, height: 2 }));
    assert.equal(result, [
        "┌───────┬──────┬───────┐",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┴───────┤",
        "│       │              │",
        "│       │              │",
        "│       │              │",
        "└───────┴──────────────┘",
    ].join("\n"));
});

test("grid span middle row horizontal", () => {
    // Child in the middle row crossing the C1|C2 boundary (x=8): the span
    // is C1-C2 × R2 (abs x[1,15) y[4,7)) — the child straddles only the
    // vertical partition x=8, so it is suppressed across the spanned rows
    // (y=5-6) while both horizontal partitions (y=4, y=7) are kept (the
    // child does not cross them, 0065); the junctions (8,4)/(8,7) keep
    // only the drawn arms (┴/┬).
    const result = render(grid3x3WithChild({ x: 1, y: 4, width: 12, height: 1 }));
    assert.equal(result, [
        "┌───────┬──────┬───────┐",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┴──────┼───────┤",
        "│              │       │",
        "│              │       │",
        "├───────┬──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ].join("\n"));
});

test("grid span left vertical", () => {
    // Child in the left column crossing the R2|R3 boundary (y=7): the span
    // is C1 × R2-R3 (abs x[1,8) y[4,11)) — the child straddles only the
    // horizontal partition y=7, so it is suppressed across the spanned
    // columns (x=1-7) while the vertical partition x=8 and the horizontal
    // partition y=4 are kept (the child does not cross them, 0065); the
    // left frame node at (1,7) degrades to │, and the junctions (8,4)/(8,7)
    // keep only the drawn arms (┼/├).
    const result = render(grid3x3WithChild({ x: 1, y: 4, width: 4, height: 4 }));
    assert.equal(result, [
        "┌───────┬──────┬───────┐",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "│       ├──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ].join("\n"));
});

test("grid span center 2x2", () => {
    // Child in the center crossing both the C1|C2 boundary (x=8) and the
    // R1|R2 boundary (y=4): the span is C1-C2 × R1-R2 (abs x[1,15) y[1,7))
    // — a 2×2 block; the vertical partition x=8 and the horizontal
    // partition y=4 are not drawn across it, the top frame node over x=8
    // degrades to ─, the left frame node at (1,4) degrades to │, and the
    // interior junction (8,4) keeps all four drawn arms (┼).
    const result = render(grid3x3WithChild({ x: 1, y: 1, width: 12, height: 4 }));
    assert.equal(result, [
        "┌──────────────┬───────┐",
        "│              │       │",
        "│              │       │",
        "│              │       │",
        "│              ├───────┤",
        "│              │       │",
        "│              │       │",
        "├───────┬──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ].join("\n"));
});

test("grid span single cell no suppression", () => {
    // Control: a child inside a single cell (C1R1) does not cross any
    // boundary — its span region is exactly that cell, which contains no
    // partition cells, so nothing is suppressed and the grid renders
    // normally (all frame nodes and junctions intact).
    const result = render(grid3x3WithChild({ x: 1, y: 1, width: 4, height: 1 }));
    assert.equal(result, [
        "┌───────┬──────┬───────┐",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "├───────┼──────┼───────┤",
        "│       │      │       │",
        "│       │      │       │",
        "│       │      │       │",
        "└───────┴──────┴───────┘",
    ].join("\n"));
});

test("gridJunction char table", () => {
    // The junction character from the four drawn arms (0063) — full
    // crosses, degraded nodes, corners, single arms, and nothing.
    // BORDERS is not exported — the solid map is inlined.
    const j = PG.gridJunction;
    const part = {
        b_b: "┼", t_l: "├", t_r: "┤", t_t: "┬", b_l: "┴",
        v: "│", h: "─", tl: "┌", tr: "┐", bl: "└", br: "┘",
    };
    assert.equal(j(part, true, true, true, true), "┼");
    assert.equal(j(part, true, true, true, false), "┤");
    assert.equal(j(part, true, true, false, true), "├");
    assert.equal(j(part, true, true, false, false), "│");
    assert.equal(j(part, true, false, true, true), "┴");
    assert.equal(j(part, false, true, true, true), "┬");
    assert.equal(j(part, false, false, true, true), "─");
    assert.equal(j(part, true, false, true, false), "└");
    assert.equal(j(part, true, false, false, true), "┐");
    assert.equal(j(part, false, true, true, false), "┘");
    assert.equal(j(part, false, true, false, true), "┌");
    assert.equal(j(part, true, false, false, false), "│");
    assert.equal(j(part, false, true, false, false), "│");
    assert.equal(j(part, false, false, true, false), "─");
    assert.equal(j(part, false, false, false, true), "─");
    assert.equal(j(part, false, false, false, false), null);
});

// ── Grid custom column/row widths (0067) ─────────────────────

test("gridSplit: custom widths", () => {
    const s = PG.gridSplit;
    // No widths — the even split (backward compatible)
    assert.deepEqual(s({}, 22, 6),
        { effCols: 3, effRows: 2, colX: [0, 7, 14, 22], rowY: [0, 3, 6] });
    // Custom widths, exact sum
    assert.deepEqual(s({ cols: 3, col_widths: [4, 10, 8] }, 22, 6),
        { effCols: 3, effRows: 2, colX: [0, 4, 14, 22], rowY: [0, 3, 6] });
    // Sum < total — the last column absorbs the remainder
    assert.deepEqual(s({ cols: 3, col_widths: [8, 8, 4] }, 22, 6),
        { effCols: 3, effRows: 2, colX: [0, 8, 16, 22], rowY: [0, 3, 6] });
    // Sum > total — the last column shrinks (>= 1 cell)
    assert.deepEqual(s({ cols: 3, col_widths: [10, 10, 10] }, 22, 6),
        { effCols: 3, effRows: 2, colX: [0, 10, 20, 22], rowY: [0, 3, 6] });
    // Invalid (wrong length, a zero) — the even split
    assert.deepEqual(s({ cols: 3, col_widths: [4, 10] }, 22, 6),
        { effCols: 3, effRows: 2, colX: [0, 7, 14, 22], rowY: [0, 3, 6] });
    assert.deepEqual(s({ cols: 3, col_widths: [0, 10, 12] }, 22, 6),
        { effCols: 3, effRows: 2, colX: [0, 7, 14, 22], rowY: [0, 3, 6] });
    // Row heights
    assert.deepEqual(s({ rows: 2, row_heights: [2, 4] }, 22, 6),
        { effCols: 3, effRows: 2, colX: [0, 7, 14, 22], rowY: [0, 2, 6] });
});

test("grid custom col_widths", () => {
    // 24×8 (inner 22) with [4, 10, 8] → partitions at inner 4 and 14
    // (absolute 5 and 15)
    const ls = lines(render(gridBlock(24, 8, { cols: 3, col_widths: [4, 10, 8] })));
    assert.equal(ls[0][5], "┬");
    assert.equal(ls[0][15], "┬");
    assert.equal(ls[7][5], "┴");
    assert.equal(ls[7][15], "┴");
    // The even-split positions are gone
    assert.equal(ls[0][8], "─");
    assert.equal(ls[0][14], "─");
    // The rows stay even (no row_heights): the partition at absolute row 4
    assert.equal(ls[4][5], "┼");
    assert.equal(ls[4][15], "┼");
});

test("grid custom widths last absorbs", () => {
    // [8, 8, 4] (sum 20) in an inner 22 → [0, 8, 16, 22]
    const ls = lines(render(gridBlock(24, 8, { cols: 3, col_widths: [8, 8, 4] })));
    // Partitions at inner 8 and 16 (absolute 9 and 17); the even-split
    // positions (absolute 8 and 15) are plain line
    assert.equal(ls[0][9], "┬");
    assert.equal(ls[0][17], "┬");
    assert.equal(ls[0][8], "─");
    assert.equal(ls[0][15], "─");
});

test("grid custom widths overflow clamped", () => {
    // [10, 10, 10] (sum 30) in an inner 22 → [0, 10, 20, 22]
    const ls = lines(render(gridBlock(24, 8, { cols: 3, col_widths: [10, 10, 10] })));
    // Partitions at inner 10 and 20 (absolute 11 and 21)
    assert.equal(ls[0][11], "┬");
    assert.equal(ls[0][21], "┬");
    // The last column is a single cell between the partition and the frame
    assert.equal(ls[1][21], "│");
    assert.equal(ls[1][22], " ");
    assert.equal(ls[1][23], "│");
});

test("grid custom widths invalid fallback", () => {
    // Invalid col_widths (not an array, wrong length, a zero) — the even
    // split (backward compatible)
    const even = render(gridBlock(24, 8, { cols: 3 }));
    for (const bad of ["x", [4, 10], [0, 10, 12], [4.5, 10, 7], true]) {
        assert.equal(render(gridBlock(24, 8, { cols: 3, col_widths: bad })), even);
    }
});

test("grid custom row_heights", () => {
    // Inner 6 with [2, 4] → the partition at inner 2 (absolute row 3),
    // not the even 3 (absolute 4)
    const ls = lines(render(gridBlock(24, 8, { rows: 2, row_heights: [2, 4] })));
    assert.equal(ls[3][0], "├");
    assert.equal(ls[3][23], "┤");
    assert.equal(ls[4][0], "│"); // the even position is a plain border
});

test("grid span with uneven split", () => {
    // Span suppression (0062–0068) on an uneven split (0067): a child
    // spanning cells 0–1 of a [4, 10, 8] grid × the top row suppresses
    // the partition between them (absolute x=5) across the spanned rows,
    // the other partition (absolute x=15) is untouched, and the
    // horizontal partition y=4 stays drawn (the child's bottom edge is
    // flush with it, which does not extend the span, 0068).
    const blocks = [
        { id: "g", block_type: "grid", x: 0, y: 0, width: 24, height: 8,
          content: "", border_style: "solid",
          meta: { cols: 3, col_widths: [4, 10, 8], rows: 2 } },
        { id: "c", block_type: "box", x: 0, y: 0, width: 13, height: 3,
          content: "", border_style: "solid", parent_id: "g" },
    ];
    const ls = lines(render(blocks));
    // The partition x=5 is suppressed across the span (rows 1–3)
    for (let row = 1; row <= 3; row++) {
        assert.notEqual(ls[row][5], "│");
    }
    // ...and drawn again in the bottom row (the span does not reach it)
    assert.equal(ls[5][5], "│");
    assert.equal(ls[6][5], "│");
    // The partition x=15 is drawn where the child doesn't cover it
    assert.equal(ls[1][15], "│");
    assert.equal(ls[5][15], "│");
    // The top frame node over x=5 degrades (suppressed in the top row)
    assert.equal(ls[0][5], "─");
    // ...the bottom one keeps its up arm (x=5 drawn in the bottom row)
    assert.equal(ls[7][5], "┴");
    // The junction at (5,4) keeps only the drawn arms (0063)
    assert.equal(ls[4][5], "┬");
    assert.equal(ls[4][15], "┼");
});

// ── Header attach (todo-0007) ─────────────────────────────

function boxWithHeader(header, boxW = 20, boxH = 8, boxBorder = "solid") {
    // The default header sits at y=-1 — its top border is clipped by the
    // box's top edge (the attach condition, todo-0007)
    const h = header || {
        id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
        content: "Title", border_style: "solid", parent_id: "b",
    };
    return [
        { id: "b", block_type: "box", x: 0, y: 0, width: boxW, height: boxH,
          content: "", border_style: boxBorder },
        h,
    ];
}

test("attached header basic", () => {
    // Attached (y=0): no top/left/right border, the bottom line across the
    // full inner width, ├/┤ junctions, content area full width × h−1 rows
    const ls = lines(render(boxWithHeader()));
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[1].slice(1, 6), "Title");
    assert.equal(ls[1].slice(6, 19), " ".repeat(13));
    assert.equal(ls[2].slice(1, 19), " ".repeat(18));
    assert.equal(ls[3], "├" + "─".repeat(18) + "┤");
    assert.equal(ls[4], "│" + " ".repeat(18) + "│");
    assert.equal(ls[7], "└" + "─".repeat(18) + "┘");
});

test("attached header h=1", () => {
    // ch == 1: the content area is 0 rows — the header is the line only
    const h = { id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 1,
                content: "x", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithHeader(h)));
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[1], "├" + "─".repeat(18) + "┤");
    assert.equal(ls[2], "│" + " ".repeat(18) + "│");
});

test("attached header taller than inner", () => {
    // ch > inner_h: the line is clipped, no junctions
    const h = { id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
                content: "Title", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithHeader(h, 20, 4)));
    assert.equal(ls[1].slice(1, 6), "Title");
    assert.equal(ls[3], "└" + "─".repeat(18) + "┘");
});

test("attached header borderless parent", () => {
    // A borderless box: the line is drawn, but there is no border to join
    const ls = lines(render(boxWithHeader(null, 20, 8, "none")));
    assert.equal(ls[0], "");
    assert.equal(ls[1].slice(0, 6), " Title");
    assert.equal(ls[3], " " + "─".repeat(18));
    assert.equal(ls.length, 4);
});

test("attached header dashed line", () => {
    // The line uses the header's own border_style; junctions use the box's
    const h = { id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
                content: "", border_style: "dashed", parent_id: "b" };
    const ls = lines(render(boxWithHeader(h)));
    assert.equal(ls[3], "├" + "┄".repeat(18) + "┤");
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[7], "└" + "─".repeat(18) + "┘");
});

test("attached header none border", () => {
    // border_style=none on the header: no line, content area full height
    const h = { id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
                content: "Title", border_style: "none", parent_id: "b" };
    const ls = lines(render(boxWithHeader(h)));
    assert.equal(ls[1].slice(1, 6), "Title");
    assert.equal(ls[3], "│" + " ".repeat(18) + "│");
});

test("attached header detached", () => {
    // y > 0: a plain box at the stored position/width, no junctions
    const h = { id: "h", block_type: "header", x: 0, y: 2, width: 18, height: 3,
                content: "Title", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithHeader(h)));
    assert.equal(ls[3], "│" + "┌" + "─".repeat(16) + "┐" + "│");
    assert.equal(ls[4], "│" + "│" + "Title" + " ".repeat(11) + "│" + "│");
    assert.equal(ls[5], "│" + "└" + "─".repeat(16) + "┘" + "│");
    assert.equal(ls[3][0], "│");
    assert.equal(ls[3][19], "│");
});

test("header exact touch not attached", () => {
    // y == 0: the header touches the top edge but its top border is not
    // clipped — it is NOT attached (a plain box at the stored position,
    // full border, no junctions)
    const h = { id: "h", block_type: "header", x: 0, y: 0, width: 18, height: 3,
                content: "Title", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithHeader(h)));
    assert.equal(ls[1], "│" + "┌" + "─".repeat(16) + "┐" + "│");
    assert.equal(ls[2], "│" + "│" + "Title" + " ".repeat(11) + "│" + "│");
    assert.equal(ls[3], "│" + "└" + "─".repeat(16) + "┘" + "│");
    assert.equal(ls[1][0], "│");
    assert.equal(ls[1][19], "│");
});

test("attached header follows box width", () => {
    // The stored x/width are ignored while attached — a box resize
    // stretches the header (render-time)
    const narrow = lines(render(boxWithHeader(null, 20)));
    const wide = lines(render(boxWithHeader(null, 30)));
    assert.equal(narrow[3], "├" + "─".repeat(18) + "┤");
    assert.equal(wide[3], "├" + "─".repeat(28) + "┤");
});

test("attached header empty content hint", () => {
    // Empty content: the [header] hint at the top-left of the content area
    const h = { id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
                content: "", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithHeader(h)));
    assert.equal(ls[1].slice(1, 9), "[header]");
    assert.equal(ls[3], "├" + "─".repeat(18) + "┤");
});

test("attached header fill and hide_text", () => {
    // fill paints the content area (content on top); hide_text suppresses
    // the content and the hint — the line remains
    const filled = { id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
                     content: "Title", border_style: "solid",
                     meta: { fill: "░" }, parent_id: "b" };
    const ls = lines(render(boxWithHeader(filled)));
    assert.equal(ls[1].slice(1, 6), "Title");
    assert.equal(ls[1].slice(6, 19), "░".repeat(13));
    assert.equal(ls[2].slice(1, 19), "░".repeat(18));
    assert.equal(ls[3], "├" + "─".repeat(18) + "┤");

    const hidden = { id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
                     content: "Title", border_style: "solid",
                     meta: { hide_text: true }, parent_id: "b" };
    const out = render(boxWithHeader(hidden));
    const hls = lines(out);
    assert.ok(!out.includes("Title"));
    assert.ok(!out.includes("[header]"));
    assert.equal(hls[3], "├" + "─".repeat(18) + "┤");
});

test("attached header in grid unchanged", () => {
    // A grid parent is out of scope — the header renders as a plain box
    const blocks = [
        { id: "g", block_type: "grid", x: 0, y: 0, width: 24, height: 8,
          content: "", border_style: "solid", meta: { cols: 3, rows: 2 } },
        { id: "h", block_type: "header", x: 0, y: 0, width: 18, height: 3,
          content: "Title", border_style: "solid", parent_id: "g" },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[1][1], "┌");
    assert.equal(ls[1][18], "┐");
    assert.equal(ls[2].slice(2, 7), "Title");
    assert.equal(ls[3][1], "└");
    assert.equal(ls[3][18], "┘");
    // No junctions on the grid's frame (row 3)
    assert.equal(ls[3][0], "│");
    assert.equal(ls[3][23], "│");
    // The vertical partition under the header's span is suppressed...
    assert.notEqual(ls[1][8], "│");
    // ...and drawn again below the span
    assert.equal(ls[5][8], "│");
});

// ── Footer attach (todo-0008) ─────────────────────────────

function boxWithFooter(footer, boxW = 20, boxH = 8, boxBorder = "solid") {
    // The default footer (h=3) sits at y = inner_h − h + 1 = 6 − 3 + 1 = 4
    // — its bottom border is clipped by the box's bottom edge (the attach
    // condition, todo-0008)
    const f = footer || {
        id: "f", block_type: "footer", x: 0, y: 4, width: 18, height: 3,
        content: "Footer", border_style: "solid", parent_id: "b",
    };
    return [
        { id: "b", block_type: "box", x: 0, y: 0, width: boxW, height: boxH,
          content: "", border_style: boxBorder },
        f,
    ];
}

test("attached footer basic", () => {
    // Attached (y+h == inner_h): no bottom/left/right border, the top
    // line across the full inner width, ├/┤ junctions, content area full
    // width × h−1 rows below the line
    const ls = lines(render(boxWithFooter()));
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    // The box's own [box] hint shows through the empty area
    assert.equal(ls[1].slice(1, 6), "[box]");
    assert.equal(ls[2].slice(1, 19), " ".repeat(18));
    assert.equal(ls[3].slice(1, 19), " ".repeat(18));
    // The top line with junctions (row py+1+inner_h−ch = 1+6−3 = 4)
    assert.equal(ls[4], "├" + "─".repeat(18) + "┤");
    assert.equal(ls[5].slice(1, 7), "Footer");
    assert.equal(ls[5].slice(7, 19), " ".repeat(12));
    assert.equal(ls[6].slice(1, 19), " ".repeat(18));
    assert.equal(ls[7], "└" + "─".repeat(18) + "┘");
});

test("attached footer h=1", () => {
    // ch == 1: the content area is 0 rows — the footer is the line only
    const f = { id: "f", block_type: "footer", x: 0, y: 6, width: 18, height: 1,
                content: "x", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithFooter(f)));
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[5], "│" + " ".repeat(18) + "│");
    // The line at the last inner row (py+1+inner_h−ch = 1+6−1 = 6)
    assert.equal(ls[6], "├" + "─".repeat(18) + "┤");
});

test("attached footer taller than inner", () => {
    // ch > inner_h: the line is clipped, no junctions
    const f = { id: "f", block_type: "footer", x: 0, y: 0, width: 18, height: 3,
                content: "Footer", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithFooter(f, 20, 4)));
    // Row 0 is the box's top border — no line, no junctions
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    // Content is clipped to the inner area (rows 1–2)
    assert.equal(ls[1].slice(1, 7), "Footer");
    assert.equal(ls[3], "└" + "─".repeat(18) + "┘");
});

test("attached footer borderless parent", () => {
    // A borderless box: the line is drawn, but there is no border to join
    const ls = lines(render(boxWithFooter(null, 20, 8, "none")));
    assert.equal(ls[0], "");
    assert.equal(ls[1], "");
    assert.equal(ls[2], "");
    assert.equal(ls[3], "");
    assert.equal(ls[4], " " + "─".repeat(18));
    assert.equal(ls[5].slice(0, 7), " Footer");
    assert.equal(ls.length, 6);
});

test("attached footer dashed line", () => {
    // The line uses the footer's own border_style; junctions use the box's
    const f = { id: "f", block_type: "footer", x: 0, y: 4, width: 18, height: 3,
                content: "", border_style: "dashed", parent_id: "b" };
    const ls = lines(render(boxWithFooter(f)));
    assert.equal(ls[4], "├" + "┄".repeat(18) + "┤");
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[7], "└" + "─".repeat(18) + "┘");
});

test("attached footer none border", () => {
    // border_style=none on the footer: no line, content area full height
    const f = { id: "f", block_type: "footer", x: 0, y: 4, width: 18, height: 3,
                content: "Footer", border_style: "none", parent_id: "b" };
    const ls = lines(render(boxWithFooter(f)));
    assert.equal(ls[4].slice(1, 7), "Footer");
    assert.equal(ls[4][0], "│");
    assert.equal(ls[4][19], "│");
});

test("attached footer detached", () => {
    // y + h < inner_h: a plain box at the stored position/width, no
    // junctions
    const f = { id: "f", block_type: "footer", x: 0, y: 1, width: 18, height: 3,
                content: "Footer", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithFooter(f)));
    assert.equal(ls[2], "│" + "┌" + "─".repeat(16) + "┐" + "│");
    assert.equal(ls[3], "│" + "│" + "Footer" + " ".repeat(10) + "│" + "│");
    assert.equal(ls[4], "│" + "└" + "─".repeat(16) + "┘" + "│");
    assert.equal(ls[2][0], "│");
    assert.equal(ls[2][19], "│");
});

test("footer exact touch not attached", () => {
    // y + h == inner_h — the footer touches the bottom edge but its
    // bottom border is not clipped — it is NOT attached (a plain box at
    // the stored position, full border, no junctions)
    const f = { id: "f", block_type: "footer", x: 0, y: 3, width: 18, height: 3,
                content: "Footer", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithFooter(f)));
    assert.equal(ls[4], "│" + "┌" + "─".repeat(16) + "┐" + "│");
    assert.equal(ls[5], "│" + "│" + "Footer" + " ".repeat(10) + "│" + "│");
    assert.equal(ls[6], "│" + "└" + "─".repeat(16) + "┘" + "│");
    assert.equal(ls[4][0], "│");
    assert.equal(ls[4][19], "│");
});

test("attached footer follows box size", () => {
    // The stored x/y/width are ignored while attached — a box resize
    // moves the footer (render-time)
    const narrow = lines(render(boxWithFooter(null, 20, 8)));
    const wideFooter = { id: "f", block_type: "footer", x: 0, y: 6, width: 18, height: 3,
                         content: "Footer", border_style: "solid", parent_id: "b" };
    const wide = lines(render(boxWithFooter(wideFooter, 30, 10)));
    // box 20×8: inner 18×6, line at row 1+6−3 = 4
    assert.equal(narrow[4], "├" + "─".repeat(18) + "┤");
    // box 30×10: inner 28×8, line at row 1+8−3 = 6
    assert.equal(wide[6], "├" + "─".repeat(28) + "┤");
});

test("attached footer auto attach on shrink", () => {
    // Shrinking the box so y + h > inner_h attaches the footer
    // automatically (decision 11, accepted temporarily)
    const f = { id: "f", block_type: "footer", x: 0, y: 2, width: 18, height: 3,
                content: "Footer", border_style: "solid", parent_id: "b" };
    // Detached in a 20×8 box (2 + 3 = 5 < 6)...
    const detached = lines(render(boxWithFooter(f, 20, 8)));
    assert.equal(detached[3][1], "┌"); // the full border at the stored position
    // ...attached in a 20×6 box (2 + 3 = 5 > 4)
    const attached = lines(render(boxWithFooter(f, 20, 6)));
    assert.equal(attached[2], "├" + "─".repeat(18) + "┤");
    assert.equal(attached[3].slice(1, 7), "Footer");
});

test("attached footer empty content hint", () => {
    // Empty content: the [footer] hint at the top-left of the content area
    const f = { id: "f", block_type: "footer", x: 0, y: 4, width: 18, height: 3,
                content: "", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithFooter(f)));
    assert.equal(ls[5].slice(1, 9), "[footer]");
    assert.equal(ls[4], "├" + "─".repeat(18) + "┤");
});

test("attached footer fill and hide_text", () => {
    // fill paints the content area (content on top); hide_text suppresses
    // the content and the hint — the line remains
    const filled = { id: "f", block_type: "footer", x: 0, y: 4, width: 18, height: 3,
                     content: "Footer", border_style: "solid",
                     meta: { fill: "░" }, parent_id: "b" };
    const ls = lines(render(boxWithFooter(filled)));
    assert.equal(ls[5].slice(1, 7), "Footer");
    assert.equal(ls[5].slice(7, 19), "░".repeat(12));
    assert.equal(ls[6].slice(1, 19), "░".repeat(18));
    assert.equal(ls[4], "├" + "─".repeat(18) + "┤");

    const hidden = { id: "f", block_type: "footer", x: 0, y: 4, width: 18, height: 3,
                     content: "Footer", border_style: "solid",
                     meta: { hide_text: true }, parent_id: "b" };
    const out = render(boxWithFooter(hidden));
    const fls = lines(out);
    assert.ok(!out.includes("Footer"));
    assert.ok(!out.includes("[footer]"));
    assert.equal(fls[4], "├" + "─".repeat(18) + "┤");
});

test("attached footer in grid unchanged", () => {
    // A grid parent is out of scope — the footer renders as a plain box
    const blocks = [
        { id: "g", block_type: "grid", x: 0, y: 0, width: 24, height: 8,
          content: "", border_style: "solid", meta: { cols: 3, rows: 2 } },
        { id: "f", block_type: "footer", x: 0, y: 0, width: 18, height: 3,
          content: "Footer", border_style: "solid", parent_id: "g" },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[1][1], "┌");
    assert.equal(ls[1][18], "┐");
    assert.equal(ls[2].slice(2, 8), "Footer");
    assert.equal(ls[3][1], "└");
    assert.equal(ls[3][18], "┘");
    // No junctions on the grid's frame (row 3)
    assert.equal(ls[3][0], "│");
    assert.equal(ls[3][23], "│");
    // The vertical partition under the footer's span is suppressed...
    assert.notEqual(ls[1][8], "│");
    // ...and drawn again below the span
    assert.equal(ls[5][8], "│");
});

test("gridReshapeWidths: split/merge the last", () => {
    const r = PG.gridReshapeWidths;
    // No custom widths (or a stale array) → null (the even split)
    assert.equal(r(null, 3, 4), null);
    assert.equal(r([4, 10], 3, 4), null);
    assert.equal(r([0, 10, 12], 3, 4), null);
    // Same count — a copy
    assert.deepEqual(r([4, 10, 8], 3, 3), [4, 10, 8]);
    // Growth — the last column is split in half (floor/ceil)
    assert.deepEqual(r([4, 10, 8], 3, 4), [4, 10, 4, 4]);
    assert.deepEqual(r([4, 10, 9], 3, 4), [4, 10, 4, 5]);
    // A 1-cell last one borrows from the nearest wider left neighbor
    assert.deepEqual(r([5, 1], 2, 3), [4, 1, 1]);
    assert.deepEqual(r([3, 1, 1], 3, 4), [2, 1, 1, 1]);
    // All 1-cell — can't split → null
    assert.equal(r([1, 1], 2, 3), null);
    // Shrink — the last two are merged
    assert.deepEqual(r([4, 10, 4, 4], 4, 3), [4, 10, 8]);
    assert.deepEqual(r([4, 10, 8], 3, 2), [4, 18]);
});

// ── Mixed junctions for attached header/footer (Unicode mixed box-drawing) ──

test("mixedAttachedJunction: unit", () => {
    const J = PG.mixedAttachedJunction;
    // Same style → style-map junction
    assert.equal(J("solid", "solid", "left"), "├");
    assert.equal(J("solid", "solid", "right"), "┤");
    assert.equal(J("double", "double", "left"), "╠");
    assert.equal(J("double", "double", "right"), "╣");
    // Mixed solid/double
    assert.equal(J("solid", "double", "left"), "╞");
    assert.equal(J("solid", "double", "right"), "╡");
    assert.equal(J("double", "solid", "left"), "╟");
    assert.equal(J("double", "solid", "right"), "╢");
    // dashed/dotted → fallback to box's junction
    assert.equal(J("solid", "dashed", "left"), "├");
    assert.equal(J("dashed", "solid", "left"), "├");
    assert.equal(J("solid", "dotted", "left"), "├");
    assert.equal(J("dotted", "solid", "left"), "├");
    assert.equal(J("double", "dashed", "left"), "╠");
    assert.equal(J("dashed", "double", "left"), "├");
});

test("attached header double line in solid box", () => {
    const header = {
        id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
        content: "", border_style: "double", parent_id: "b",
    };
    const ls = lines(render(boxWithHeader(header)));
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[3], "╞" + "═".repeat(18) + "╡");
    assert.equal(ls[4], "│" + " ".repeat(18) + "│");
});

test("attached header solid line in double box", () => {
    const ls = lines(render(boxWithHeader(null, 20, 8, "double")));
    assert.equal(ls[0], "╔" + "═".repeat(18) + "╗");
    assert.equal(ls[3], "╟" + "─".repeat(18) + "╢");
    assert.equal(ls[4], "║" + " ".repeat(18) + "║");
    assert.equal(ls[7], "╚" + "═".repeat(18) + "╝");
});

test("attached header both double", () => {
    const header = {
        id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
        content: "", border_style: "double", parent_id: "b",
    };
    const ls = lines(render(boxWithHeader(header, 20, 8, "double")));
    assert.equal(ls[0], "╔" + "═".repeat(18) + "╗");
    assert.equal(ls[3], "╠" + "═".repeat(18) + "╣");
});

test("attached footer double line in solid box", () => {
    const f = {
        id: "f", block_type: "footer", x: 0, y: 5, width: 18, height: 3,
        content: "", border_style: "double", parent_id: "b",
    };
    const ls = lines(render(boxWithFooter(f)));
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[4], "╞" + "═".repeat(18) + "╡");
    assert.equal(ls[7], "└" + "─".repeat(18) + "┘");
});

test("attached footer solid line in double box", () => {
    const f = {
        id: "f", block_type: "footer", x: 0, y: 5, width: 18, height: 3,
        content: "Footer", border_style: "solid", parent_id: "b",
    };
    const ls = lines(render(boxWithFooter(f, 20, 8, "double")));
    assert.equal(ls[0], "╔" + "═".repeat(18) + "╗");
    assert.equal(ls[4], "╟" + "─".repeat(18) + "╢");
    assert.equal(ls[7], "╚" + "═".repeat(18) + "╝");
});

// ── sidebar-attach (todo-0009) ───────────────────────────────

function boxWithSidebar(sidebar, boxW = 20, boxH = 8, boxBorder = "solid") {
    // The default sidebar (w=6) sits at x=-1 — its left border is clipped
    // by the box's left edge (the attach condition, todo-0009)
    const s = sidebar || {
        id: "s", block_type: "sidebar", x: -1, y: 0, width: 6, height: 3,
        content: "Side", border_style: "solid", parent_id: "b",
    };
    return [
        { id: "b", block_type: "box", x: 0, y: 0, width: boxW, height: boxH,
          content: "", border_style: boxBorder },
        s,
    ];
}

test("attached sidebar basic", () => {
    const ls = lines(render(boxWithSidebar()));
    assert.equal(ls[0], "┌─────┬────────────┐");
    assert.equal(ls[2][6], "│");
    assert.equal(ls[7], "└─────┴────────────┘");
});

test("attached sidebar right", () => {
    const s = { id: "s", block_type: "sidebar", x: 13, y: 0, width: 6, height: 3,
        content: "Side", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithSidebar(s)));
    assert.equal(ls[0], "┌────────────┬─────┐");
    assert.equal(ls[7], "└────────────┴─────┘");
});

test("attached sidebar w=1 line only", () => {
    const s = { id: "s", block_type: "sidebar", x: -1, y: 0, width: 1, height: 3,
        content: "x", border_style: "solid", parent_id: "b" };
    const ls = lines(render(boxWithSidebar(s)));
    assert.equal(ls[0], "┌┬─────────────────┐");
    assert.equal(ls[2].slice(0, 2), "││");
});

test("attached sidebar wider than inner — clipped", () => {
    const s = { id: "s", block_type: "sidebar", x: -1, y: 0, width: 20, height: 3,
        content: "wide", border_style: "solid", parent_id: "b" };
    const art = render(boxWithSidebar(s));
    assert.ok(!art.includes("┬") && !art.includes("┴"));
});

test("attached sidebar borderless parent", () => {
    const art = render(boxWithSidebar(null, 20, 8, "none"));
    assert.ok(!art.includes("┬") && !art.includes("┴"));
});

test("attached sidebar dashed line", () => {
    const s = { id: "s", block_type: "sidebar", x: -1, y: 0, width: 6, height: 3,
        content: "", border_style: "dashed", parent_id: "b" };
    const ls = lines(render(boxWithSidebar(s)));
    assert.equal(ls[0][6], "┬");
    assert.equal(ls[2][6], "┆");
});

test("attached sidebar none border", () => {
    const s = { id: "s", block_type: "sidebar", x: -1, y: 0, width: 6, height: 3,
        content: "Side", border_style: "none", parent_id: "b" };
    const art = render(boxWithSidebar(s));
    assert.ok(!art.includes("┬") && !art.includes("┴"));
});

test("attached sidebar detached (plain box)", () => {
    const s = { id: "s", block_type: "sidebar", x: 2, y: 0, width: 6, height: 3,
        content: "Side", border_style: "solid", parent_id: "b" };
    assert.ok(!lines(render(boxWithSidebar(s)))[0].includes("┬"));
});

test("attached sidebar exact touch not attached", () => {
    const left = { id: "s", block_type: "sidebar", x: 0, y: 0, width: 6, height: 3,
        content: "Side", border_style: "solid", parent_id: "b" };
    assert.ok(!render(boxWithSidebar(left)).includes("┬"));
    const right = { id: "s", block_type: "sidebar", x: 12, y: 0, width: 6, height: 3,
        content: "Side", border_style: "solid", parent_id: "b" };
    assert.ok(!render(boxWithSidebar(right)).includes("┬"));
});

test("attached sidebar double line in solid box", () => {
    const s = { id: "s", block_type: "sidebar", x: -1, y: 0, width: 6, height: 3,
        content: "", border_style: "double", parent_id: "b" };
    const ls = lines(render(boxWithSidebar(s)));
    assert.equal(ls[0], "┌─────╥────────────┐");
    assert.equal(ls[7], "└─────╨────────────┘");
});

test("attached sidebar solid line in double box", () => {
    const ls = lines(render(boxWithSidebar(null, 20, 8, "double")));
    assert.equal(ls[0], "╔═════╤════════════╗");
    assert.equal(ls[7], "╚═════╧════════════╝");
});

// ── corner dominance: header/footer × sidebar (todo-0009) ────

test("corner header dominant (sidebar below header)", () => {
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
          content: "Head", border_style: "solid", parent_id: "b" },
        { id: "s", block_type: "sidebar", x: -1, y: 3, width: 5, height: 3,
          content: "Si", border_style: "solid", parent_id: "b" },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[3], "├────┬─────────────┤");
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
});

test("corner sidebar dominant via order (header offset right)", () => {
    // Position no longer decides: the attached header stretches full width so
    // the effective rects collide; a higher sidebar order → sidebar dominant.
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "h", block_type: "header", x: 7, y: -1, width: 10, height: 3,
          content: "Head", border_style: "solid", parent_id: "b", order: 0 },
        { id: "s", block_type: "sidebar", x: -1, y: 0, width: 6, height: 3,
          content: "Si", border_style: "solid", parent_id: "b", order: 5 },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[0], "┌─────┬────────────┐");
    assert.equal(ls[3], "│     ├────────────┤");
});

test("corner offset tie -> header dominant (position no longer splits)", () => {
    // The variant-B double-framing fix: an offset header stretches full width,
    // collides with the full-height sidebar, and the order tie falls to H.
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "h", block_type: "header", x: 7, y: -1, width: 10, height: 3,
          content: "Head", border_style: "solid", parent_id: "b" },
        { id: "s", block_type: "sidebar", x: -1, y: 0, width: 6, height: 3,
          content: "Si", border_style: "solid", parent_id: "b" },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[3], "├─────┬────────────┤");
});

test("corner tie -> header dominant", () => {
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "h", block_type: "header", x: -1, y: -1, width: 18, height: 3,
          content: "Head", border_style: "solid", parent_id: "b" },
        { id: "s", block_type: "sidebar", x: -1, y: -1, width: 6, height: 3,
          content: "Si", border_style: "solid", parent_id: "b" },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[3], "├─────┬────────────┤");
});

test("corner order tiebreak -> sidebar dominant", () => {
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "h", block_type: "header", x: -1, y: -1, width: 18, height: 3,
          content: "Head", border_style: "solid", parent_id: "b", order: 0 },
        { id: "s", block_type: "sidebar", x: -1, y: -1, width: 6, height: 3,
          content: "Si", border_style: "solid", parent_id: "b", order: 5 },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[3], "│     ├────────────┤");
});

test("corner footer offset merges (no double framing)", () => {
    // Offset footer stretches full width, collides with the full-height
    // sidebar, order tie → footer dominant and the corner merges (┴).
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "f", block_type: "footer", x: 6, y: 8, width: 12, height: 2,
          content: "Foot", border_style: "solid", parent_id: "b" },
        { id: "s", block_type: "sidebar", x: -1, y: 0, width: 5, height: 3,
          content: "Si", border_style: "solid", parent_id: "b" },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[0], "┌────┬─────────────┐");
    assert.equal(ls[7], "├────┴─────────────┤");
});

test("corner three-way header+footer+sidebar (no bleed)", () => {
    // Sidebar trimmed on both opposing sides — the trims compose, the line
    // stops at each chrome line instead of bleeding into the footer body.
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "h", block_type: "header", x: 0, y: -1, width: 18, height: 3,
          content: "H", border_style: "solid", parent_id: "b" },
        { id: "f", block_type: "footer", x: 0, y: 7, width: 18, height: 3,
          content: "F", border_style: "solid", parent_id: "b" },
        { id: "s", block_type: "sidebar", x: -1, y: 0, width: 5, height: 3,
          content: "S", border_style: "solid", parent_id: "b" },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[0], "┌" + "─".repeat(18) + "┐");
    assert.equal(ls[3], "├────┬─────────────┤");
    assert.equal(ls[6], "├────┴─────────────┤");
    assert.equal(ls[7], "│F" + " ".repeat(17) + "│");
    assert.equal(ls[8], "│" + " ".repeat(18) + "│");
    assert.equal(ls[9], "└" + "─".repeat(18) + "┘");
});

test("corner dual sidebar header trimmed both sides (no bleed)", () => {
    // Header between two dominant sidebars — both horizontal trims compose,
    // the header line spans only the columns between the two sidebar lines.
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "h", block_type: "header", x: -1, y: -1, width: 18, height: 3,
          content: "H", border_style: "solid", parent_id: "b", order: 0 },
        { id: "sl", block_type: "sidebar", x: -1, y: 0, width: 4, height: 3,
          content: "L", border_style: "solid", parent_id: "b", order: 5 },
        { id: "sr", block_type: "sidebar", x: 15, y: 0, width: 4, height: 3,
          content: "R", border_style: "solid", parent_id: "b", order: 5 },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[0], "┌───┬──────────┬───┐");
    assert.equal(ls[3], "│   ├──────────┤   │");
    assert.equal(ls[9], "└───┴──────────┴───┘");
});

test("twoLineJunction: unit", () => {
    const J = PG.twoLineJunction;
    // Same style → style-map glyph
    assert.equal(J("solid", "solid", "down"), "┬");
    assert.equal(J("double", "double", "up"), "╩");
    assert.equal(J("double", "double", "right"), "╠");
    assert.equal(J("solid", "solid", "left"), "┤");
    // horizontal through (down/up): stem keeps its own vertical weight
    assert.equal(J("double", "solid", "down"), "╤");
    assert.equal(J("solid", "double", "down"), "╥");
    assert.equal(J("double", "solid", "up"), "╧");
    assert.equal(J("solid", "double", "up"), "╨");
    // vertical through (right/left): stem keeps its own horizontal weight
    assert.equal(J("solid", "double", "right"), "╞");
    assert.equal(J("double", "solid", "right"), "╟");
    assert.equal(J("solid", "double", "left"), "╡");
    assert.equal(J("double", "solid", "left"), "╢");
    // dashed/dotted → fallback to the through line's glyph
    assert.equal(J("solid", "dashed", "up"), "┴");
    assert.equal(J("dashed", "solid", "up"), "┴");
    assert.equal(J("double", "dashed", "down"), "╦");
    assert.equal(J("dashed", "double", "down"), "┬");
    assert.equal(J("double", "dotted", "right"), "╠");
    assert.equal(J("dotted", "double", "right"), "├");
});

test("corner footer double + sidebar solid (footer dominant → ╧)", () => {
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "f", block_type: "footer", x: 0, y: 7, width: 18, height: 3,
          content: "", border_style: "double", parent_id: "b" },
        { id: "s", block_type: "sidebar", x: -1, y: 0, width: 5, height: 3,
          content: "", border_style: "solid", parent_id: "b" },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[6], "╞════╧═════════════╡");
});

test("corner footer solid + sidebar double (footer dominant → ╨)", () => {
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "f", block_type: "footer", x: 0, y: 7, width: 18, height: 3,
          content: "", border_style: "solid", parent_id: "b" },
        { id: "s", block_type: "sidebar", x: -1, y: 0, width: 5, height: 3,
          content: "", border_style: "double", parent_id: "b" },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[6], "├────╨─────────────┤");
});

test("corner sidebar double dominant over solid footer → ╟", () => {
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "f", block_type: "footer", x: 0, y: 7, width: 18, height: 3,
          content: "", border_style: "solid", parent_id: "b" },
        { id: "s", block_type: "sidebar", x: -1, y: 0, width: 5, height: 3,
          content: "", border_style: "double", parent_id: "b", order: 5 },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[6], "│    ╟─────────────┤");
});

test("corner sidebar solid dominant over double footer → ╞", () => {
    const blocks = [
        { id: "b", block_type: "box", x: 0, y: 0, width: 20, height: 10,
          content: "", border_style: "solid" },
        { id: "f", block_type: "footer", x: 0, y: 7, width: 18, height: 3,
          content: "", border_style: "double", parent_id: "b" },
        { id: "s", block_type: "sidebar", x: -1, y: 0, width: 5, height: 3,
          content: "", border_style: "solid", parent_id: "b", order: 5 },
    ];
    const ls = lines(render(blocks));
    assert.equal(ls[6], "│    ╞═════════════╡");
});
