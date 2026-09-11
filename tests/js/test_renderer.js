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
