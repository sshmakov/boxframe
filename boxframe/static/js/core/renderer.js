/**
 * Pseudo-graphic renderer (JavaScript port of boxframe/services/renderer.py).
 *
 * Converts a flat list of blocks into ASCII art on a character grid using
 * Unicode box-drawing characters, and generates the HTML overlay (positioned
 * block previews with resize handles) that the editor draws on top of the
 * .ascii-art canvas layer.
 *
 * IMPORTANT: this file must stay in sync with the Python renderer — the
 * pseudo-graphic format is the core of the product. The Python test suite
 * (tests/test_renderer.py) and the JS suite (tests/js/test_renderer.js)
 * mirror each other, and tests/test_js_renderer_parity.py runs both
 * implementations on the same input and compares the output.
 *
 * Block shape (flat list, same fields as the API's BlockOut):
 *   { id, block_type, x, y, width, height, content, border_style,
 *     order, parent_id? }
 * Child blocks reference their parent via parent_id; their x/y are
 * relative to the parent (same convention as the database).
 */

(function (global) {
    "use strict";

    // Border character maps: {style: {tl, tr, bl, br, h, v, t_l, t_r, t_t, b_l, b_b}}
    var BORDERS = {
        solid: {
            tl: "┌", tr: "┐", bl: "└", br: "┘",
            h: "─", v: "│",
            t_l: "├", t_r: "┤", t_t: "┬", b_l: "┴", b_b: "┼",
        },
        dashed: {
            tl: "┌", tr: "┐", bl: "└", br: "┘",
            h: "┄", v: "┆",
            t_l: "├", t_r: "┤", t_t: "┬", b_l: "┴", b_b: "┼",
        },
        dotted: {
            tl: "┌", tr: "┐", bl: "└", br: "┘",
            h: "┈", v: "┊",
            t_l: "├", t_r: "┤", t_t: "┬", b_l: "┴", b_b: "┼",
        },
        double: {
            tl: "╔", tr: "╗", bl: "╚", br: "╝",
            h: "═", v: "║",
            t_l: "╠", t_r: "╣", t_t: "╦", b_l: "╩", b_b: "╬",
        },
    };

    // Same lists as boxframe/models/block.py — keep in sync.
    var BLOCK_TYPES = [
        "box", "header", "footer", "sidebar", "content", "button",
        "input", "textarea", "image", "divider", "hline", "vline",
        "text", "grid",
    ];
    var BORDER_STYLES = ["solid", "dashed", "dotted", "double", "none"];

    // Default canvas size for layouts without set dimensions — the working
    // area the editor shows when nothing else determines the canvas size.
    // Mirrors DEFAULT_CANVAS_WIDTH/HEIGHT in services/renderer.py.
    var DEFAULT_CANVAS_WIDTH = 80;
    var DEFAULT_CANVAS_HEIGHT = 24;

    // Block types whose content area can be painted with a fill character
    // (meta.fill, tasks/0051 phase 2; extended to every framed block type
    // in task 0073 — button, input, textarea, text). Lines (divider,
    // hline, vline) are not frames and stay out of the matrix. Mirrors
    // FILL_TYPES in services/renderer.py.
    var FILL_TYPES = {
        box: true, header: true, footer: true, sidebar: true,
        content: true, grid: true, image: true,
        button: true, input: true, textarea: true, text: true,
    };

    // Fixed lorem source for the content-block placeholder (todo-0004).
    // Mirrors LOREM_PLACEHOLDER in services/renderer.py.
    var LOREM_PLACEHOLDER =
        "lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do " +
        "eiusmod tempor incididunt ut labore et dolore magna aliqua. ut " +
        "enim ad minim veniam, quis nostrud exercitation ullamco laboris " +
        "nisi ut aliquip ex ea commodo consequat.";

    // Port of fill_char in services/renderer.py: the block's fill
    // character (meta.fill), if applicable. fill applies only to
    // FILL_TYPES; the value must be exactly one cell (a wide character
    // would break the monospace grid). An absent or invalid value means
    // no fill.
    function fillChar(blockType, meta) {
        if (!FILL_TYPES[blockType]) return "";
        meta = meta || {};
        var fill = meta.fill;
        if (typeof fill === "string" && fill.length === 1) return fill;
        return "";
    }

    // Arrow glyphs for line ends (meta.arrow_start / meta.arrow_end,
    // tasks/0051 phase 3). Mirrors ARROW_GLYPHS / arrow_glyph in
    // services/renderer.py: six head shapes per line direction; "none"
    // (or an absent/invalid value) means no arrow.
    var ARROW_GLYPHS = {
        hline: {
            "arrow": { start: "◀", end: "▶" },
            "arrow-open": { start: "◁", end: "▷" },
            "diamond": { start: "◆", end: "◆" },
            "diamond-open": { start: "◇", end: "◇" },
            "circle": { start: "●", end: "●" },
            "circle-open": { start: "○", end: "○" },
        },
        vline: {
            "arrow": { start: "▲", end: "▼" },
            "arrow-open": { start: "△", end: "▽" },
            "diamond": { start: "◆", end: "◆" },
            "diamond-open": { start: "◇", end: "◇" },
            "circle": { start: "●", end: "●" },
            "circle-open": { start: "○", end: "○" },
        },
    };

    function arrowGlyph(blockType, value, end) {
        if (typeof value !== "string") return "";
        var glyphs = ARROW_GLYPHS[blockType];
        if (!glyphs || (end !== "start" && end !== "end")) return "";
        return glyphs[value] ? glyphs[value][end] : "";
    }

    // Port of h_align_offset in services/renderer.py: the left offset of
    // a line inside the content area (left — 0).
    function hAlignOffset(lineLen, width, align) {
        if ((align !== "center" && align !== "right") || width <= 0) return 0;
        var gap = width - lineLen;
        if (gap <= 0) return 0;
        return align === "center" ? Math.floor(gap / 2) : gap;
    }

    // Port of v_align_offset in services/renderer.py: the top offset of
    // the line block inside the content area (top — 0).
    function vAlignOffset(nLines, height, valign) {
        if (valign !== "middle" && valign !== "bottom") return 0;
        if (height <= 0) return 0;
        if (valign === "middle") return Math.max(0, Math.floor((height - nLines) / 2));
        return Math.max(0, height - nLines);
    }

    // ── Text wrapping (port of PseudoGraphicRenderer._wrap_text) ──

    function wrapText(text, width) {
        var wrapped = [];
        var rawLines = String(text == null ? "" : text).split("\n");
        for (var li = 0; li < rawLines.length; li++) {
            // Words and runs of spaces — spaces are formatting, not separators
            var tokens = rawLines[li].match(/\S+| +/g) || [];
            var current = "";
            for (var ti = 0; ti < tokens.length; ti++) {
                var token = tokens[ti];
                if (token[0] === " ") {
                    if (current && current.length + token.length <= width) {
                        current += token;
                    } else if (current) {
                        // Gap doesn't fit — wrap to the next line, drop the gap
                        wrapped.push(current);
                        current = "";
                    } else {
                        current += token; // leading spaces
                    }
                } else {
                    var word = token;
                    while (word.length > width) {
                        if (current) { wrapped.push(current); current = ""; }
                        wrapped.push(word.slice(0, width));
                        word = word.slice(width);
                    }
                    if (!word) continue;
                    if (!current) {
                        current = word;
                    } else if (current.length + word.length <= width) {
                        current += word;
                    } else {
                        wrapped.push(current);
                        current = word;
                    }
                }
            }
            if (current) {
                wrapped.push(current);
            } else if (tokens.length === 0) {
                wrapped.push("");
            }
        }
        return wrapped;
    }

    // Port of PseudoGraphicRenderer.placeholder_lines: lorem placeholder
    // lines for an empty content block (todo-0004). Wraps the fixed lorem
    // source to width w, takes the first h lines, and shortens the last
    // line to ~70% of w (only when h >= 2 and w >= 4) — "like a paragraph".
    // Regenerated on each render (live re-layout on resize).
    function placeholderLines(w, h) {
        if (w <= 0 || h <= 0) return [];
        var text = "";
        for (var i = 0; i < h + 1; i++) text += LOREM_PLACEHOLDER + " ";
        var lines = wrapText(text, w).slice(0, h);
        if (h >= 2 && w >= 4 && lines.length > 0) {
            var last = lines.length - 1;
            lines[last] = lines[last].slice(0, Math.max(3, Math.floor(w * 7 / 10)));
        }
        return lines;
    }

    // Port of text_block_size in services/renderer.py: the fit size of a
    // text block — the content's extent plus the border. The text is not
    // wrapped, the block grows to fit every explicit line. Empty content
    // is one empty line; a border (any style except "none") adds one cell
    // on each side. The result is at least 1×1.
    function textBlockSize(content, borderStyle) {
        var lines = String(content == null ? "" : content).split("\n");
        var textW = 0;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].length > textW) textW = lines[i].length;
        }
        var textH = Math.max(1, lines.length);
        if (borderStyle !== "none") {
            return [textW + 2, textH + 2];
        }
        return [Math.max(1, textW), textH];
    }

    // Port of button_block_size in services/renderer.py: the fit size of
    // a button (task 0060) — the content's extent plus the button's
    // border, which depends on the height. One line (including empty)
    // fits the canonical h=1 form ([label]; an empty label keeps one
    // inner cell: [ ]); N>=2 lines fit a full box, the label flush with
    // the border (like text). A border (any style except "none") adds
    // the frame cells; "none" is the text's extent (min 1x1).
    function buttonBlockSize(content, borderStyle) {
        var lines = String(content == null ? "" : content).split("\n");
        var textW = 0;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].length > textW) textW = lines[i].length;
        }
        var nLines = Math.max(1, lines.length);
        if (borderStyle === "none") {
            return [Math.max(1, textW), nLines];
        }
        if (nLines === 1) {
            return [Math.max(3, textW + 2), 1];
        }
        return [textW + 2, nLines + 2];
    }

    // Port of divider_fit_size in services/renderer.py: the grow-only
    // fit size of a divider (variant E, tasks/0003) — the stored size
    // grown to fit the content, never shrunk (unlike textBlockSize,
    // which is an exact fit).
    function dividerFitSize(content, width, height) {
        var lines = String(content == null ? "" : content).split("\n");
        var longest = 0;
        for (var i = 0; i < lines.length; i++) {
            if (lines[i].length > longest) longest = lines[i].length;
        }
        var nLines = Math.max(1, lines.length);
        return [Math.max(width, longest), Math.max(height, nLines)];
    }

    // Port of grid_meta_int in services/renderer.py: a grid's cols/rows
    // from meta (todo-0005) — a positive int, or the default. An absent
    // or invalid value (not an integer, < 1) falls back — the renderer
    // is tolerant, like fillChar.
    function gridMetaInt(meta, key, dflt) {
        var v = meta ? meta[key] : undefined;
        if (typeof v !== "number" || !isFinite(v) || v < 1 || Math.floor(v) !== v) {
            return dflt;
        }
        return v;
    }

    // Port of grid_has_structure in services/renderer.py: whether a grid
    // has explicit structure in its meta (0069, backward compat) — a
    // valid cols or rows (a positive int). A grid without one (created
    // before partitions existed) renders as a plain box — border,
    // [grid] hint, children — exactly as before partitions were
    // introduced.
    function gridHasStructure(meta) {
        return gridMetaInt(meta, "cols", 0) >= 1 || gridMetaInt(meta, "rows", 0) >= 1;
    }

    // Port of grid_create_meta in services/renderer.py: the meta of a
    // NEW grid block (0069) — the given meta with cols/rows defaulted
    // (3/2) when absent or invalid, so the block renders with partitions.
    // Creation is the only place the defaults are injected (updates and
    // replace restore the stored meta as-is).
    function gridCreateMeta(meta) {
        var m = {};
        if (meta) {
            for (var k in meta) {
                if (Object.prototype.hasOwnProperty.call(meta, k)) m[k] = meta[k];
            }
        }
        m.cols = gridMetaInt(m, "cols", 3);
        m.rows = gridMetaInt(m, "rows", 2);
        return m;
    }

    // Port of grid_meta_widths in services/renderer.py: a grid's
    // col_widths/row_heights from meta (0067) — a non-empty array of
    // integers >= 1 (cells), or null when absent/invalid — the caller
    // falls back to the even split.
    function gridMetaWidths(meta, key) {
        var v = meta ? meta[key] : undefined;
        if (!Array.isArray(v) || !v.length) return null;
        for (var i = 0; i < v.length; i++) {
            if (typeof v[i] !== "number" || !isFinite(v[i]) ||
                Math.floor(v[i]) !== v[i] || v[i] < 1) {
                return null;
            }
        }
        return v;
    }

    // Port of _split_axis in services/renderer.py: boundary positions
    // x[0..n] (x[0] = 0, x[n] = total) for n columns/rows across
    // `total` cells (0067). Even split (integer division, the remainder
    // goes to the last one) when widths is null or its length != n.
    // Otherwise the prefix sums of the widths, clamped so every
    // column/row keeps at least 1 cell — the last one absorbs the delta
    // when the widths don't sum to total (an outer resize of the grid
    // block, or a stale array).
    function splitAxis(widths, n, total) {
        if (widths === null || widths.length !== n) {
            var even = [];
            for (var i = 0; i <= n; i++) even.push(Math.floor((i * total) / n));
            return even;
        }
        var x = [0];
        for (var j = 1; j < n; j++) {
            x.push(Math.min(x[x.length - 1] + widths[j - 1], total - (n - j)));
        }
        x.push(total);
        return x;
    }

    // Port of grid_split in services/renderer.py: a grid's effective
    // structure (todo-0005 + 0067) — the effective column/row counts
    // (clamped to the inner area, every column/row is at least 1 cell)
    // and the partition boundary positions colX/rowY.
    function gridSplit(meta, innerW, innerH) {
        var effCols = Math.min(gridMetaInt(meta, "cols", 3), innerW);
        var effRows = Math.min(gridMetaInt(meta, "rows", 2), innerH);
        return {
            effCols: effCols,
            effRows: effRows,
            colX: splitAxis(gridMetaWidths(meta, "col_widths"), effCols, innerW),
            rowY: splitAxis(gridMetaWidths(meta, "row_heights"), effRows, innerH),
        };
    }

    // A grid's custom widths reshaped for a cols/rows change (0067,
    // editor-side — not part of the render parity): null input (no
    // custom widths, or a stale array) → null (the even split); growth
    // — the last column/row is split in half (floor/ceil), a 1-cell
    // last one borrows a cell from the nearest wider one to its left
    // (none wider → null); shrink — the last two are merged.
    function gridReshapeWidths(widths, oldCount, newCount) {
        if (!Array.isArray(widths) || widths.length !== oldCount) return null;
        for (var i = 0; i < widths.length; i++) {
            if (typeof widths[i] !== "number" || !isFinite(widths[i]) ||
                Math.floor(widths[i]) !== widths[i] || widths[i] < 1) {
                return null;
            }
        }
        if (newCount === oldCount) return widths.slice();
        var w = widths.slice();
        if (newCount > oldCount) {
            for (var a = oldCount; a < newCount; a++) {
                var last = w[w.length - 1];
                if (last >= 2) {
                    var left = Math.floor(last / 2);
                    w[w.length - 1] = left;
                    w.push(last - left);
                } else {
                    var bi = -1;
                    for (var k = w.length - 2; k >= 0; k--) {
                        if (w[k] >= 2) { bi = k; break; }
                    }
                    if (bi === -1) return null;
                    w[bi] = w[bi] - 1;
                    w.push(1);
                }
            }
        } else {
            for (var b = newCount; b < oldCount; b++) {
                w[w.length - 2] = w[w.length - 2] + w[w.length - 1];
                w.pop();
            }
        }
        return w;
    }

    // Port of _grid_junction in services/renderer.py: the box-drawing
    // character of a grid junction (an interior cross or a frame node)
    // from the four partition segments actually drawn around it (0063).
    // A suppressed segment (under a child's span, 0062) degrades the
    // node — ┼ → ├/┤/┬/┴/│/─ — so no line ends stick out of a spanned
    // cell. null — no segment is drawn, nothing to place.
    function gridJunction(part, up, down, left, right) {
        if (up && down) {
            if (left && right) return part.b_b;
            if (left) return part.t_r;
            if (right) return part.t_l;
            return part.v;
        }
        if (left && right) {
            if (up) return part.b_l;
            if (down) return part.t_t;
            return part.h;
        }
        if (up && left) return part.bl;
        if (up && right) return part.tr;
        if (down && left) return part.br;
        if (down && right) return part.tl;
        if (up || down) return part.v;
        if (left || right) return part.h;
        return null;
    }

    // Mixed junctions when an attached header/footer's line style differs
    // from the parent box border (Unicode has dedicated symbols for the
    // solid×double combinations; dashed/dotted fall back to the box's).
    var MIXED_LEFT = { "solid|double": "╞", "double|solid": "╟" };
    var MIXED_RIGHT = { "solid|double": "╡", "double|solid": "╢" };
    // Mixed junctions where an attached sidebar's VERTICAL line meets the
    // box's HORIZONTAL border (todo-0009): box double/child single → ╤
    // (top) / ╧ (bottom); box single/child double → ╥ (top) / ╨ (bottom).
    var MIXED_TOP = { "double|solid": "╤", "solid|double": "╥" };
    var MIXED_BOTTOM = { "double|solid": "╧", "solid|double": "╨" };

    function attachedVJunction(boxStyle, childStyle, end) {
        function fallback() {
            var map = BORDERS[boxStyle] || BORDERS.solid;
            return end === "top" ? map.t_t : map.b_l;
        }
        if (boxStyle === childStyle) return fallback();
        var table = end === "top" ? MIXED_TOP : MIXED_BOTTOM;
        var ch = table[boxStyle + "|" + childStyle];
        if (ch) return ch;
        return fallback();
    }

    // Corner T-junction where an attached block trimmed by a dominant
    // orthogonal block meets the dominant line (todo-0009). throughStyle
    // is the dominant (two-arm) line, stemStyle the subordinate stem;
    // orient is the stem direction: "down"(┬)/"up"(┴)/"right"(├)/"left"(┤).
    // Same styles → the style map glyph; mixed → the dominant style's
    // glyph (the mixed ╤╥╧╨ set is reserved for sidebar-vs-border).
    function twoLineJunction(throughStyle, stemStyle, orient) {
        var key = { down: "t_t", up: "b_l", right: "t_l", left: "t_r" }[orient];
        var map = BORDERS[throughStyle] || BORDERS.solid;
        return map[key];
    }

    function mixedAttachedJunction(boxStyle, childStyle, side) {
        function fallback() {
            var map = BORDERS[boxStyle] || BORDERS.solid;
            return side === "left" ? map.t_l : map.t_r;
        }
        if (boxStyle === childStyle) return fallback();
        var table = side === "left" ? MIXED_LEFT : MIXED_RIGHT;
        var ch = table[boxStyle + "|" + childStyle];
        if (ch) return ch;
        return fallback();
    }

    // ── Grid drawing (ports of the PseudoGraphicRenderer methods) ──

    // Write a cell, respecting the grid bounds and the active clip rect
    // (half-open [x1, x2) × [y1, y2)) — the clip keeps a container's
    // children from being drawn past the parent's border.
    function setCell(grid, gw, gh, clip, x, y, ch) {
        if (x < 0 || y < 0 || x >= gw || y >= gh) return;
        if (clip && (x < clip[0] || y < clip[1] || x >= clip[2] || y >= clip[3])) return;
        grid[y][x] = ch;
    }

    // Port of PseudoGraphicRenderer._draw_border
    function drawBorder(block, style, grid, gw, gh, clip) {
        var x = Math.max(0, Math.min(block.x, gw - 2));
        var y = Math.max(0, Math.min(block.y, gh - 2));
        var w = Math.min(block.width, gw - x);
        var h = Math.min(block.height, gh - y);

        if (w < 2 || h < 2) return;

        // Corners
        setCell(grid, gw, gh, clip, x, y, style.tl);
        setCell(grid, gw, gh, clip, x + w - 1, y, style.tr);
        setCell(grid, gw, gh, clip, x, y + h - 1, style.bl);
        setCell(grid, gw, gh, clip, x + w - 1, y + h - 1, style.br);

        // Top and bottom edges
        for (var i = 1; i < w - 1; i++) {
            setCell(grid, gw, gh, clip, x + i, y, style.h);
            setCell(grid, gw, gh, clip, x + i, y + h - 1, style.h);
        }

        // Left and right edges
        for (var j = 1; j < h - 1; j++) {
            setCell(grid, gw, gh, clip, x, y + j, style.v);
            setCell(grid, gw, gh, clip, x + w - 1, y + j, style.v);
        }
    }

    // Port of PseudoGraphicRenderer._draw_line: style characters + arrows
    // (meta.arrow_start / meta.arrow_end) replacing the end cells; a line
    // shorter than 2 cells has no arrows.
    function drawLine(block, style, grid, gw, gh, clip) {
        var x = Math.max(0, Math.min(block.x, gw - 1));
        var y = Math.max(0, Math.min(block.y, gh - 1));
        var meta = block.meta || {};

        if (block.block_type === "hline") {
            var w = Math.min(block.width, gw - x);
            var n = Math.max(1, w);
            for (var i = 0; i < n; i++) {
                setCell(grid, gw, gh, clip, x + i, y, style.h);
            }
            if (n >= 2) {
                var start = arrowGlyph("hline", meta.arrow_start, "start");
                if (start) setCell(grid, gw, gh, clip, x, y, start);
                var end = arrowGlyph("hline", meta.arrow_end, "end");
                if (end) setCell(grid, gw, gh, clip, x + n - 1, y, end);
            }
        } else { // vline
            var h = Math.min(block.height, gh - y);
            var n2 = Math.max(1, h);
            for (var j = 0; j < n2; j++) {
                setCell(grid, gw, gh, clip, x, y + j, style.v);
            }
            if (n2 >= 2) {
                var start2 = arrowGlyph("vline", meta.arrow_start, "start");
                if (start2) setCell(grid, gw, gh, clip, x, y, start2);
                var end2 = arrowGlyph("vline", meta.arrow_end, "end");
                if (end2) setCell(grid, gw, gh, clip, x, y + n2 - 1, end2);
            }
        }
    }

    // Port of PseudoGraphicRenderer._draw_button: the shape depends on
    // the height (h=1 [label]; h=2 no top border; h>=3 full box). The
    // label is word-wrapped to the inner width (explicit newlines are
    // kept); the line block is vertically aligned (meta.vertical_align,
    // default middle — unlike box, whose default is top) and each line
    // is horizontally aligned (meta.text_align, default center — unlike
    // box, whose default is left). Lines past the inner height are not
    // drawn (the border is drawn first and is not overwritten).
    // Fill (meta.fill) paints the inner area (task 0073); the label is
    // drawn on top.
    function drawButton(block, style, grid, gw, gh, clip) {
        var x = Math.max(0, Math.min(block.x, gw - 2));
        var y = Math.max(0, Math.min(block.y, gh - 2));
        var w = Math.min(block.width, gw - x);
        var h = Math.min(block.height, gh - y);

        if (w < 1 || h < 1) return;

        var framed = block.border_style !== "none" && w >= 2;

        if (framed) {
            if (h === 1) {
                setCell(grid, gw, gh, clip, x, y, "[");
                setCell(grid, gw, gh, clip, x + w - 1, y, "]");
            } else {
                // Side borders on all rows
                for (var j = 0; j < h; j++) {
                    setCell(grid, gw, gh, clip, x, y + j, style.v);
                    setCell(grid, gw, gh, clip, x + w - 1, y + j, style.v);
                }
                // Bottom border
                setCell(grid, gw, gh, clip, x, y + h - 1, style.bl);
                setCell(grid, gw, gh, clip, x + w - 1, y + h - 1, style.br);
                for (var i = 1; i < w - 1; i++) {
                    setCell(grid, gw, gh, clip, x + i, y + h - 1, style.h);
                }
                if (h >= 3) {
                    // Top border
                    setCell(grid, gw, gh, clip, x, y, style.tl);
                    setCell(grid, gw, gh, clip, x + w - 1, y, style.tr);
                    for (var k = 1; k < w - 1; k++) {
                        setCell(grid, gw, gh, clip, x + k, y, style.h);
                    }
                }
            }
        }

        // The inner area: h=1/h=2 — one row (row y), h>=3 — the rows
        // between the borders, none — the whole block.
        var innerX, innerY, innerW, innerH;
        if (framed) {
            innerX = x + 1;
            innerW = w - 2;
            if (h >= 3) {
                innerY = y + 1;
                innerH = h - 2;
            } else {
                innerY = y;
                innerH = 1;
            }
        } else {
            innerX = x;
            innerY = y;
            innerW = w;
            innerH = h;
        }

        // Fill (meta.fill) paints the inner area; the label is drawn on
        // top (label wins).
        var fill = fillChar(block.block_type, block.meta);
        if (fill && innerW > 0 && innerH > 0) {
            for (var fj = 0; fj < innerH; fj++) {
                var frow = innerY + fj;
                if (frow >= gh) break;
                for (var fi = 0; fi < innerW; fi++) {
                    setCell(grid, gw, gh, clip, innerX + fi, frow, fill);
                }
            }
        }

        // Label — word-wrapped to the inner width, the line block
        // vertically aligned (meta.vertical_align, default middle) and
        // each line horizontally aligned (meta.text_align, default
        // center). meta.hide_text suppresses the label (the frame and
        // the fill stay).
        if (block.content && !(block.meta || {}).hide_text) {
            if (innerW > 0 && innerH > 0) {
                var meta = block.meta || {};
                var align = meta.text_align;
                if (align !== "left" && align !== "center" && align !== "right") align = "center";
                var valign = meta.vertical_align;
                if (valign !== "top" && valign !== "middle" && valign !== "bottom") valign = "middle";
                var lines = wrapText(block.content, innerW);
                var vOff = vAlignOffset(lines.length, innerH, valign);
                for (var li = 0; li < lines.length; li++) {
                    if (li + vOff >= innerH) break;
                    var row = innerY + li + vOff;
                    if (row >= gh) break;
                    var off = hAlignOffset(lines[li].length, innerW, align);
                    for (var c = 0; c < lines[li].length; c++) {
                        setCell(grid, gw, gh, clip, innerX + off + c, row, lines[li][c]);
                    }
                }
            }
        }
    }

    // Port of PseudoGraphicRenderer._draw_divider: a line on every row
    // of the stored size, the label lines over their rows as-is (no
    // word wrap, no whitespace collapse), each line aligned
    // independently (meta.text_align, default center); the line block
    // is shifted vertically inside the stored height
    // (meta.vertical_align, default middle — unlike box, whose default
    // is top). Drawn within the stored size — no recalculation (the
    // grow-only autosize lives in the store / LayoutService). Children
    // are ignored (a line is an atomic element).
    function drawDivider(block, style, grid, gw, gh, clip) {
        var x = Math.max(0, Math.min(block.x, gw - 1));
        var y = Math.max(0, Math.min(block.y, gh - 1));
        var w = Math.min(block.width, gw - x);
        var h = Math.min(block.height, gh - y);

        if (w < 1 || h < 1) return;

        // Line on every row (border_style none → invisible)
        if (block.border_style !== "none") {
            for (var j = 0; j < h; j++) {
                for (var i = 0; i < w; i++) {
                    setCell(grid, gw, gh, clip, x + i, y + j, style.h);
                }
            }
        }

        // Label: each content line over its row, as-is, truncated to the
        // stored width, aligned (meta.text_align, default center); the
        // line block is shifted vertically (meta.vertical_align, default
        // middle), lines past the bottom are not drawn.
        // meta.hide_text suppresses the label (the line stays).
        var meta = block.meta || {};
        if (!meta.hide_text) {
            var align = meta.text_align;
            if (align !== "left" && align !== "center" && align !== "right") align = "center";
            var valign = meta.vertical_align;
            if (valign !== "top" && valign !== "middle" && valign !== "bottom") valign = "middle";
            var lines = String(block.content == null ? "" : block.content).split("\n");
            var vOff = vAlignOffset(lines.length, h, valign);
            for (var li = 0; li < lines.length; li++) {
                if (li + vOff >= h) break;
                var row = y + vOff + li;
                if (row >= gh) break;
                var line = lines[li].slice(0, w);
                var off = hAlignOffset(line.length, w, align);
                for (var c = 0; c < line.length; c++) {
                    setCell(grid, gw, gh, clip, x + off + c, row, line[c]);
                }
            }
        }
    }

    // Port of PseudoGraphicRenderer._draw_attached: a header attached to
    // the top of its box parent (todo-0007) or a footer attached to the
    // bottom (todo-0008). The effective geometry (set by
    // renderChildrenInContainer) is flush with the box's inner area at
    // the full inner width — at the top for a header, at the bottom for
    // a footer. No border on the three outer sides — only the line
    // across the full effective width (the block's own border_style):
    // the last row of the effective rectangle for a header, the first
    // row for a footer; the content area is the full width × h−1 rows on
    // the other side of the line (× h rows when the border style is none
    // — there is no line). The line and the content are clipped by the
    // container's inner area when the block is taller than it. The
    // junctions with the box's border (├/┤) are drawn by the parent
    // (drawGrid's frame-node pattern, 0063).
    function drawAttached(block, style, grid, gw, gh, clip) {
        var x = Math.max(0, Math.min(block.x, gw - 2));
        var y = Math.max(0, Math.min(block.y, gh - 2));
        var w = Math.min(block.width, gw - x);
        var h = Math.min(block.height, gh - y);

        if (w < 1 || h < 1) return;

        var side = block.attached_side;
        var vertical = (side === "left" || side === "right");
        var hasLine = block.border_style !== "none";
        var contentX, contentY, contentW, contentH;

        if (vertical) {
            if (hasLine) {
                // The vertical line: the right column of the effective
                // rectangle for a left sidebar, the left column for a
                // right sidebar, full effective height.
                var lineCol = (side === "left") ? (x + w - 1) : x;
                for (var vj = 0; vj < h; vj++) {
                    setCell(grid, gw, gh, clip, lineCol, y + vj, style.v);
                }
            }
            if (hasLine && side === "left") { contentX = x; contentW = w - 1; }
            else if (hasLine && side === "right") { contentX = x + 1; contentW = w - 1; }
            else { contentX = x; contentW = w; }
            contentY = y; contentH = h;
        } else {
            var isFooter = (side === "bottom");
            if (hasLine) {
                // The line: the first row of the effective rectangle for a
                // footer (bottom attach), the last row for a header (top
                // attach), full effective width.
                var lineRow = isFooter ? y : y + h - 1;
                for (var i = 0; i < w; i++) {
                    setCell(grid, gw, gh, clip, x + i, lineRow, style.h);
                }
            }
            // Content area: full width × h−1 rows on the other side of
            // the line (× h when there is no line).
            contentX = x; contentY = y;
            if (hasLine && isFooter) contentY = y + 1;
            contentW = w;
            contentH = h - (hasLine ? 1 : 0);
        }

        // Fill (meta.fill) paints the content area first; the content is
        // drawn on top (content wins) and the [type] hint is suppressed.
        var fill = fillChar(block.block_type, block.meta);
        if (fill && contentW > 0 && contentH > 0) {
            for (var fj = 0; fj < contentH; fj++) {
                var frow = contentY + fj;
                if (frow >= gh) break;
                for (var fi = 0; fi < contentW; fi++) {
                    setCell(grid, gw, gh, clip, contentX + fi, frow, fill);
                }
            }
        }

        // Hide text (meta.hide_text): the content and the [type] hint are
        // not drawn — the fill (above) and the line remain.
        if ((block.meta || {}).hide_text) return;

        if (!block.content) {
            if (hasLine && contentW >= 4 && contentH > 0 && !fill) {
                var hint = "[" + block.block_type + "]";
                for (var hi = 0; hi < hint.length; hi++) {
                    if (contentX + hi < contentX + contentW && contentY < gh) {
                        setCell(grid, gw, gh, clip, contentX + hi, contentY, hint[hi]);
                    }
                }
            }
            return;
        }

        if (contentW <= 0 || contentH <= 0) return;

        // Wrap content by words to fit the content area, then align (the
        // same rules as drawContent: meta.text_align / vertical_align;
        // a sidebar keeps the box default top/left — no type override).
        var lines = wrapText(block.content, contentW);
        var vOff = vAlignOffset(lines.length, contentH, (block.meta || {}).vertical_align);
        var hAlign = (block.meta || {}).text_align;
        for (var lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            if (lineIdx + vOff >= contentH) break;
            var row = contentY + lineIdx + vOff;
            if (row >= gh) break;
            var line = lines[lineIdx];
            var off = hAlignOffset(line.length, contentW, hAlign);
            for (var colIdx = 0; colIdx < line.length; colIdx++) {
                setCell(grid, gw, gh, clip, contentX + off + colIdx, row, line[colIdx]);
            }
        }
    }

    // Port of PseudoGraphicRenderer._dominant_corner: which of an
    // attached horizontal (header/footer, hr) and vertical (sidebar, vr)
    // block owns their shared corner (todo-0009). "H" → horizontal full,
    // sidebar trimmed; "V" → sidebar full, horizontal trimmed; null →
    // no interaction. Saved positions decide first (the block placed away
    // from the corner is subordinate); else higher order; tie → H.
    function dominantCorner(hr, vr) {
        var hTop = hr.side === "top", vLeft = vr.side === "left";
        var awayH = vLeft ? (hr.cx >= vr.cx + vr.cw) : (hr.cx + hr.cw <= vr.cx);
        var awayV = hTop ? (vr.cy >= hr.cy + hr.ch) : (vr.cy + vr.ch <= hr.cy);
        if (awayH && awayV) return null;
        if (awayH) return "V";
        if (awayV) return "H";
        var ho = hr.c.order || 0, vo = vr.c.order || 0;
        if (vo > ho) return "V";
        return "H";
    }

    // Port of PseudoGraphicRenderer._plan_attached: plan attached
    // header/footer/sidebar children of a box parent (todo-0007/0008/
    // 0009). Returns {borderOps, meetingOps, plan}: plan maps child id →
    // {attached, side, x, y, width, height} (effective absolute geometry,
    // trimmed at a shared corner); borderOps/meetingOps are [col,row,ch]
    // the parent draws (border junctions outside the inner clip, inner
    // corner T-junctions over the child lines).
    function planAttached(parent, allBlocks) {
        var borderOps = [], meetingOps = [], plan = {};
        if (parent.block_type !== "box") return { borderOps: borderOps, meetingOps: meetingOps, plan: plan };
        var px = parent.x, py = parent.y, pw = parent.width, ph = parent.height;
        var innerW = pw - 2, innerH = ph - 2, boxStyle = parent.border_style;

        var children = allBlocks.filter(function (b) { return b.parent_id === parent.id; });
        var i;
        for (i = 0; i < children.length; i++) plan[children[i].id] = { attached: false, side: "" };
        if (innerW < 1 || innerH < 1) return { borderOps: borderOps, meetingOps: meetingOps, plan: plan };

        var recs = [];
        for (i = 0; i < children.length; i++) {
            var c = children[i];
            var t = c.block_type, cx = c.x, cy = c.y, cw = c.width, chh = c.height;
            var side, clipped, eff;
            if (t === "header" && cy < 0) {
                side = "top"; clipped = chh > innerH; eff = [px + 1, py + 1, innerW, Math.max(1, chh)];
            } else if (t === "footer" && cy + chh > innerH) {
                side = "bottom"; clipped = chh > innerH;
                eff = [px + 1, py + 1 + innerH - Math.max(1, chh), innerW, Math.max(1, chh)];
            } else if (t === "sidebar" && cx < 0) {
                side = "left"; clipped = cw > innerW; eff = [px + 1, py + 1, Math.max(1, cw), innerH];
            } else if (t === "sidebar" && cx + cw > innerW) {
                side = "right"; clipped = cw > innerW;
                eff = [px + 1 + innerW - Math.max(1, cw), py + 1, Math.max(1, cw), innerH];
            } else {
                continue;
            }
            recs.push({
                c: c, side: side, cx: cx, cy: cy, cw: cw, ch: chh, eff: eff, clipped: clipped,
                trimLeft: false, trimRight: false, trimTop: false, trimBottom: false,
            });
        }

        function lineCol(vr) { return vr.side === "left" ? vr.eff[0] + vr.eff[2] - 1 : vr.eff[0]; }
        function lineRow(hr) { return hr.side === "top" ? hr.eff[1] + hr.eff[3] - 1 : hr.eff[1]; }

        for (var hi = 0; hi < recs.length; hi++) {
            var hr = recs[hi];
            if (hr.side !== "top" && hr.side !== "bottom") continue;
            if (hr.clipped) continue;
            for (var vi = 0; vi < recs.length; vi++) {
                var vr = recs[vi];
                if (vr.side !== "left" && vr.side !== "right") continue;
                if (vr.clipped) continue;
                var dom = dominantCorner(hr, vr);
                if (dom === "H") {
                    var lr = lineRow(hr), col = lineCol(vr), orient;
                    if (hr.side === "top") {
                        vr.eff[1] = lr + 1;
                        vr.eff[3] = (py + ph - 1) - (lr + 1);
                        vr.trimTop = true; orient = "down";
                    } else {
                        vr.eff[3] = (lr - 1) - (py + 1) + 1;
                        vr.trimBottom = true; orient = "up";
                    }
                    if (vr.eff[3] < 1) vr.eff[3] = 1;
                    meetingOps.push([col, lr, twoLineJunction(hr.c.border_style, vr.c.border_style, orient)]);
                } else if (dom === "V") {
                    var col2 = lineCol(vr), lr2 = lineRow(hr), orient2;
                    if (vr.side === "left") {
                        hr.eff[0] = col2 + 1;
                        hr.eff[2] = (px + pw - 1) - (col2 + 1);
                        hr.trimLeft = true; orient2 = "right";
                    } else {
                        hr.eff[2] = (col2 - 1) - (px + 1) + 1;
                        hr.trimRight = true; orient2 = "left";
                    }
                    if (hr.eff[2] < 1) hr.eff[2] = 1;
                    meetingOps.push([col2, lr2, twoLineJunction(vr.c.border_style, hr.c.border_style, orient2)]);
                }
            }
        }

        for (var ri = 0; ri < recs.length; ri++) {
            var r = recs[ri], cc = r.c;
            plan[cc.id] = {
                attached: true, side: r.side,
                x: r.eff[0], y: r.eff[1], width: r.eff[2], height: r.eff[3],
            };
            if (r.clipped || cc.border_style === "none" || boxStyle === "none") continue;
            var s = r.side;
            if (s === "top" || s === "bottom") {
                var row = (s === "top") ? r.eff[1] + r.eff[3] - 1 : r.eff[1];
                if (!r.trimLeft) borderOps.push([px, row, mixedAttachedJunction(boxStyle, cc.border_style, "left")]);
                if (!r.trimRight) borderOps.push([px + pw - 1, row, mixedAttachedJunction(boxStyle, cc.border_style, "right")]);
            } else {
                var col3 = (s === "left") ? r.eff[0] + r.eff[2] - 1 : r.eff[0];
                if (!r.trimTop) borderOps.push([col3, py, attachedVJunction(boxStyle, cc.border_style, "top")]);
                if (!r.trimBottom) borderOps.push([col3, py + ph - 1, attachedVJunction(boxStyle, cc.border_style, "bottom")]);
            }
        }
        return { borderOps: borderOps, meetingOps: meetingOps, plan: plan };
    }

    // Port of PseudoGraphicRenderer._draw_grid: the outer border (per
    // border_style) plus inner partitions — vertical (eff_cols − 1) and
    // horizontal (eff_rows − 1) — with junction nodes from the style map.
    // meta.cols / meta.rows (defaults 3/2, invalid → default) give the
    // requested number of columns/rows; the effective count is clamped to
    // the inner area (every column/row is at least 1 cell). The inner area
    // is split evenly with integer division (the remainder goes to the
    // last column/row) unless meta.col_widths / meta.row_heights (0067)
    // give custom per-column/row widths in cells — then the partitions
    // sit at the prefix sums of the widths, and the last column/row
    // absorbs the delta when the widths don't sum to the inner size (an
    // outer resize). The content is not rendered (a grid is a structural
    // element, like a line) and the [type] hint is suppressed;
    // fill (meta.fill) is painted under the partitions; children are
    // rendered over the partitions (by the caller). border_style none —
    // no outer border, solid partitions.
    // Partitions are not drawn under the children's rectangles (0062):
    // a child spanning several cells looks like one intact cell. The skip
    // is applied at draw time (the fill/space under a skipped partition
    // cell is left untouched). The frame nodes on the outer border and
    // the interior junctions reflect the segments actually drawn around
    // them (0063): a suppressed segment degrades the node (┬ → ─,
    // ├ → │, ┼ → ├/┬/│/─), so no line ends stick out of a spanned cell.
    function drawGrid(block, style, grid, gw, gh, clip, allBlocks) {
        var x = Math.max(0, Math.min(block.x, gw - 2));
        var y = Math.max(0, Math.min(block.y, gh - 2));
        var w = Math.min(block.width, gw - x);
        var h = Math.min(block.height, gh - y);

        if (w < 1 || h < 1) return;

        var framed = block.border_style !== "none" && w >= 2 && h >= 2;
        var innerX, innerY, innerW, innerH;
        if (framed) {
            drawBorder(block, style, grid, gw, gh, clip);
            innerX = x + 1;
            innerY = y + 1;
            innerW = w - 2;
            innerH = h - 2;
        } else {
            innerX = x;
            innerY = y;
            innerW = w;
            innerH = h;
        }

        if (innerW <= 0 || innerH <= 0) return;

        // Fill under the partitions (meta.fill)
        var fill = fillChar(block.block_type, block.meta);
        if (fill) {
            for (var fj = 0; fj < innerH; fj++) {
                var frow = innerY + fj;
                if (frow >= gh) break;
                for (var fi = 0; fi < innerW; fi++) {
                    setCell(grid, gw, gh, clip, innerX + fi, frow, fill);
                }
            }
        }

        // Partitions: the frame's style (none → solid)
        var part = framed ? style : BORDERS.solid;

        var split = gridSplit(block.meta, innerW, innerH);
        var effCols = split.effCols;
        var effRows = split.effRows;
        var colX = split.colX;
        var rowY = split.rowY;

        // Span regions (absolute, half-open): the union of the whole grid
        // cells each child's rectangle touches (0062, refined in 0064,
        // re-refined in 0065, re-refined in 0066, re-refined in 0068) —
        // the child's half-open rect intersects the cell's closed range:
        // a left/top edge flush with a cell boundary spans the cell on
        // the other side of it (the child's border is drawn over the
        // boundary, 0066), but a right/bottom edge flush does not (the
        // child's border sits one cell short of the boundary, which stays
        // drawn, 0068). A partition is suppressed only where the child
        // actually crosses it (0065): a vertical partition is removed
        // across the spanned rows only if the child straddles it, a
        // horizontal one across the spanned columns only if the child
        // straddles it; at a crossing of the two the cell is removed only
        // if the child straddles both — so a spanned cell keeps the
        // borders of the cells it does not cross. A partition under the
        // child's own left/top border counts as crossed (0066): the
        // child's border is drawn over it, so it is hidden. Same origin
        // as renderChildrenInContainer (1-cell padding), clipped to the
        // inner area.
        var vParts = {}, hParts = {};
        for (var vp = 1; vp < effCols; vp++) vParts[innerX + colX[vp]] = true;
        for (var hp = 1; hp < effRows; hp++) hParts[innerY + rowY[hp]] = true;
        var childSpans = [];
        for (var ci = 0; ci < allBlocks.length; ci++) {
            var cb = allBlocks[ci];
            if (cb.parent_id !== block.id) continue;
            if ((cb.width || 0) < 1 || (cb.height || 0) < 1) continue;
            var rx0 = Math.max(block.x + 1 + cb.x, innerX);
            var ry0 = Math.max(block.y + 1 + cb.y, innerY);
            var rx1 = Math.min(block.x + 1 + cb.x + cb.width, innerX + innerW);
            var ry1 = Math.min(block.y + 1 + cb.y + cb.height, innerY + innerH);
            if (!(rx1 > rx0 && ry1 > ry0)) continue;
            var ix0 = rx0 - innerX, iy0 = ry0 - innerY;
            var ix1 = rx1 - innerX, iy1 = ry1 - innerY;
            // The child's half-open rect [ix0, ix1) intersects the cell's
            // closed range [colX[si], colX[si+1]]: the left/top edge flush
            // with a boundary counts (the child's border is drawn over it,
            // 0066), the right/bottom edge flush does not (its border sits
            // one cell short of the boundary, which stays drawn, 0068).
            var sCol0 = -1, sCol1 = -1, sRow0 = -1, sRow1 = -1;
            for (var si = 0; si < effCols; si++) {
                if (colX[si] < ix1 && colX[si + 1] >= ix0) {
                    if (sCol0 < 0) sCol0 = si;
                    sCol1 = si;
                }
            }
            for (var sj = 0; sj < effRows; sj++) {
                if (rowY[sj] < iy1 && rowY[sj + 1] >= iy0) {
                    if (sRow0 < 0) sRow0 = sj;
                    sRow1 = sj;
                }
            }
            if (sCol0 < 0 || sRow0 < 0) continue;
            var crossedV = {}, crossedH = {};
            for (var cvp in vParts) {
                if (rx0 <= Number(cvp) && Number(cvp) < rx1) crossedV[cvp] = true;
            }
            for (var chp in hParts) {
                if (ry0 <= Number(chp) && Number(chp) < ry1) crossedH[chp] = true;
            }
            childSpans.push([
                innerX + colX[sCol0],
                innerY + rowY[sRow0],
                innerX + colX[sCol1 + 1],
                innerY + rowY[sRow1 + 1],
                crossedV,
                crossedH
            ]);
        }

        // r = [sx0, sy0, sx1, sy1, crossedV, crossedH]
        function coveredBySpan(px, py) {
            var pxV = !!vParts[px];
            var pyH = !!hParts[py];
            for (var k = 0; k < childSpans.length; k++) {
                var r = childSpans[k];
                if (!(px >= r[0] && px < r[2] && py >= r[1] && py < r[3])) continue;
                if (pxV && r[4][px] && (!pyH || r[5][py])) return true;
                if (pyH && r[5][py] && (!pxV || r[4][px])) return true;
            }
            return false;
        }

        // Vertical partitions
        for (var vi = 1; vi < effCols; vi++) {
            var cx = innerX + colX[vi];
            for (var vj = 0; vj < innerH; vj++) {
                if (coveredBySpan(cx, innerY + vj)) continue;
                setCell(grid, gw, gh, clip, cx, innerY + vj, part.v);
            }
        }

        // Horizontal partitions
        for (var hj = 1; hj < effRows; hj++) {
            var ry = innerY + rowY[hj];
            for (var hi = 0; hi < innerW; hi++) {
                if (coveredBySpan(innerX + hi, ry)) continue;
                setCell(grid, gw, gh, clip, innerX + hi, ry, part.h);
            }
        }

        // Frame nodes and interior junctions reflect the partition
        // segments actually drawn around them (0063): a segment
        // suppressed by a child's span (0062/0064) degrades the node, so
        // no line ends stick out of a spanned cell.
        if (framed) {
            for (var fi = 1; fi < effCols; fi++) {
                var fcx = innerX + colX[fi];
                setCell(grid, gw, gh, clip, fcx, y,
                    coveredBySpan(fcx, innerY) ? part.h : part.t_t);
                setCell(grid, gw, gh, clip, fcx, y + h - 1,
                    coveredBySpan(fcx, innerY + innerH - 1) ? part.h : part.b_l);
            }
            for (var fj = 1; fj < effRows; fj++) {
                var fry = innerY + rowY[fj];
                setCell(grid, gw, gh, clip, x, fry,
                    coveredBySpan(innerX, fry) ? part.v : part.t_l);
                setCell(grid, gw, gh, clip, x + w - 1, fry,
                    coveredBySpan(innerX + innerW - 1, fry) ? part.v : part.t_r);
            }
        }

        for (var ii = 1; ii < effCols; ii++) {
            for (var ij = 1; ij < effRows; ij++) {
                var px = innerX + colX[ii];
                var py = innerY + rowY[ij];
                if (coveredBySpan(px, py)) continue;
                var jch = gridJunction(part,
                    !coveredBySpan(px, py - 1),
                    !coveredBySpan(px, py + 1),
                    !coveredBySpan(px - 1, py),
                    !coveredBySpan(px + 1, py));
                if (jch) setCell(grid, gw, gh, clip, px, py, jch);
            }
        }
    }

    function drawContent(block, grid, gw, gh, clip) {
        var x = Math.max(0, Math.min(block.x, gw - 2));
        var y = Math.max(0, Math.min(block.y, gh - 2));
        var w = Math.min(block.width, gw - x);
        var h = Math.min(block.height, gh - y);

        if (w < 1 || h < 1) return;

        // The content is inset by one cell where a border is drawn
        var hasBorder = block.border_style !== "none";
        if (hasBorder && (w < 2 || h < 2)) return;

        var contentX = x + (hasBorder ? 1 : 0);
        var contentY = y + (hasBorder ? 1 : 0);
        var contentW = w - (hasBorder ? 2 : 0);
        var contentH = h - (hasBorder ? 2 : 0);

        // Fill (meta.fill) paints the content area first; the content is
        // drawn on top (content wins) and the [type] hint is suppressed.
        // A block without a border fills its whole area.
        var fill = fillChar(block.block_type, block.meta);
        if (fill && contentW > 0 && contentH > 0) {
            for (var fj = 0; fj < contentH; fj++) {
                var frow = contentY + fj;
                if (frow >= gh) break;
                for (var fi = 0; fi < contentW; fi++) {
                    setCell(grid, gw, gh, clip, contentX + fi, frow, fill);
                }
            }
        }

        // Hide text (meta.hide_text): the content, the lorem placeholder
        // and the [type] hint are not drawn — the fill (above) and the
        // border (drawn by the caller) remain.
        if ((block.meta || {}).hide_text) return;

        if (!block.content) {
            if (block.block_type === "content" && !fill && contentW > 0 && contentH > 0) {
                // Lorem placeholder (todo-0004): deterministic lines wrapped
                // to the content area, last line shorter — "like a paragraph".
                // Regenerated on each render (live re-layout on resize).
                var phLines = placeholderLines(contentW, contentH);
                var phVOff = vAlignOffset(phLines.length, contentH, (block.meta || {}).vertical_align);
                var phHAlign = (block.meta || {}).text_align;
                for (var pli = 0; pli < phLines.length; pli++) {
                    if (pli + phVOff >= contentH) break;
                    var prow = contentY + pli + phVOff;
                    if (prow >= gh) break;
                    var pline = phLines[pli];
                    var poff = hAlignOffset(pline.length, contentW, phHAlign);
                    for (var pcol = 0; pcol < pline.length; pcol++) {
                        setCell(grid, gw, gh, clip, contentX + poff + pcol, prow, pline[pcol]);
                    }
                }
            } else if (hasBorder && w >= 4 && !fill) {
                var hint = "[" + block.block_type + "]";
                for (var i = 0; i < hint.length; i++) {
                    if (contentX + i < contentX + contentW && contentY < gh) {
                        setCell(grid, gw, gh, clip, contentX + i, contentY, hint[i]);
                    }
                }
            }
            return;
        }

        if (contentW <= 0 || contentH <= 0) return;

        var lines = wrapText(block.content, contentW);
        // Align: each line horizontally inside contentW (meta.text_align)
        // and the line block vertically inside contentH (meta.vertical_align).
        // Only the line's own cells are written — the offsets leave the
        // rest of the area untouched (fill / show-through intact).
        var vOff = vAlignOffset(lines.length, contentH, (block.meta || {}).vertical_align);
        var hAlign = (block.meta || {}).text_align;
        for (var lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            if (lineIdx + vOff >= contentH) break;
            var row = contentY + lineIdx + vOff;
            if (row >= gh) break;
            var line = lines[lineIdx];
            var off = hAlignOffset(line.length, contentW, hAlign);
            for (var colIdx = 0; colIdx < line.length; colIdx++) {
                setCell(grid, gw, gh, clip, contentX + off + colIdx, row, line[colIdx]);
            }
        }
    }

    // Children are placed at the parent's origin + 1-cell padding + their
    // relative coordinates and clipped to the parent's inner area (the
    // border is not overdrawn) — mirrors Python's
    // PseudoGraphicRenderer._render_children_in_container.
    function renderChildrenInContainer(parent, style, grid, gw, gh, allBlocks, clip) {
        var padX = 1, padY = 1;
        // Sort by order (ascending) — higher order renders on top, same
        // z-index rule as root blocks in render(). Stable: ties keep the
        // store's insertion order.
        var children = allBlocks
            .filter(function (b) { return b.parent_id === parent.id; })
            .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

        // Inner area of the parent (half-open), in absolute grid coordinates
        var inner = [
            parent.x + padX,
            parent.y + padY,
            parent.x + parent.width - padX,
            parent.y + parent.height - padY,
        ];
        if (inner[2] <= inner[0] || inner[3] <= inner[1]) return; // no inner area
        // Intersect with the active clip (nested containers clip cumulatively)
        if (clip) {
            inner = [
                Math.max(inner[0], clip[0]),
                Math.max(inner[1], clip[1]),
                Math.min(inner[2], clip[2]),
                Math.min(inner[3], clip[3]),
            ];
            if (inner[2] <= inner[0] || inner[3] <= inner[1]) return;
        }

        // Attached header/footer/sidebar children of a box: effective
        // geometry + corner dominance are planned here (todo-0007/0008/
        // 0009). plan gives each attached child's effective absolute
        // geometry (trimmed at a shared corner) plus the parent-drawn
        // junction cells (border junctions outside the inner clip; inner
        // corner T-junctions over the child lines).
        var planned = planAttached(parent, allBlocks);

        // Border junctions live on the parent's border cells — outside the
        // inner clip — so draw them under the outer clip, before it narrows.
        var bi;
        for (bi = 0; bi < planned.borderOps.length; bi++) {
            var bo = planned.borderOps[bi];
            setCell(grid, gw, gh, clip, bo[0], bo[1], bo[2]);
        }

        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            var p = planned.plan[child.id];
            // Adjusted copy — never mutate the store's blocks. An attached
            // child carries its planned effective geometry + side; a
            // normal child is placed at the inner origin + relative coords.
            var c;
            if (p && p.attached) {
                c = {
                    id: child.id,
                    x: p.x, y: p.y, width: p.width, height: p.height,
                    block_type: child.block_type,
                    content: child.content,
                    border_style: child.border_style,
                    meta: child.meta,
                    order: child.order,
                    parent_id: child.parent_id,
                    attached: true,
                    attached_side: p.side,
                };
            } else {
                c = {
                    id: child.id,
                    x: parent.x + padX + child.x,
                    y: parent.y + padY + child.y,
                    width: child.width, height: child.height,
                    block_type: child.block_type,
                    content: child.content,
                    border_style: child.border_style,
                    meta: child.meta,
                    order: child.order,
                    parent_id: child.parent_id,
                    attached: false,
                    attached_side: "",
                };
            }
            renderBlock(c, grid, gw, gh, allBlocks, inner);
        }

        // Inner corner T-junctions: drawn after the children so the
        // junction overrides the trimmed block's line end (both child
        // lines pass through the meeting cell).
        var mi;
        for (mi = 0; mi < planned.meetingOps.length; mi++) {
            var mo = planned.meetingOps[mi];
            setCell(grid, gw, gh, inner, mo[0], mo[1], mo[2]);
        }
    }

    function renderBlock(block, grid, gw, gh, allBlocks, clip) {
        var style = BORDERS[block.border_style] || BORDERS.solid;

        if (block.block_type === "hline" || block.block_type === "vline") {
            if (block.border_style !== "none") {
                drawLine(block, style, grid, gw, gh, clip);
            }
            return;
        }

        if (block.block_type === "button") {
            drawButton(block, style, grid, gw, gh, clip);
            return;
        }

        if (block.block_type === "divider") {
            drawDivider(block, style, grid, gw, gh, clip);
            return;
        }

        // A header attached to the top of its box parent (todo-0007), a
        // footer attached to the bottom (todo-0008), or a sidebar attached
        // to the left/right (todo-0009): no border on the three outer
        // sides — only the line across the box's inner extent, the content
        // on the other side of it. The junctions with the box's border and
        // the inner corner junctions are drawn by the parent (in
        // renderChildrenInContainer — the child is clipped to the inner
        // area).
        if ((block.block_type === "header" || block.block_type === "footer"
                || block.block_type === "sidebar") && block.attached) {
            drawAttached(block, style, grid, gw, gh, clip);
            var hasAttachedChildren = allBlocks.some(function (b) { return b.parent_id === block.id; });
            if (hasAttachedChildren) {
                renderChildrenInContainer(block, style, grid, gw, gh, allBlocks, clip);
            }
            return;
        }

        // A grid with explicit structure in meta (a valid cols or rows)
        // renders the partitions; a legacy grid (no cols/rows — created
        // before partitions existed) falls through to the plain box path
        // (border + [grid] hint + children), as before (0069).
        if (block.block_type === "grid" && gridHasStructure(block.meta)) {
            drawGrid(block, style, grid, gw, gh, clip, allBlocks);
            var hasGridChildren = allBlocks.some(function (b) { return b.parent_id === block.id; });
            if (hasGridChildren) {
                renderChildrenInContainer(block, style, grid, gw, gh, allBlocks, clip);
            }
            return;
        }

        var hasBorder = block.border_style !== "none"
            && block.width >= 2 && block.height >= 2;

        if (hasBorder) {
            drawBorder(block, style, grid, gw, gh, clip);
        }
        drawContent(block, grid, gw, gh, clip);
        // Children are rendered regardless of the parent's border: a
        // borderless container keeps the same 1-cell padding and inner
        // clip as a framed one (the HTML overlay and the editor's
        // coordinate math assume the padding unconditionally).
        var hasChildren = allBlocks.some(function (b) { return b.parent_id === block.id; });
        if (hasChildren) {
            renderChildrenInContainer(block, style, grid, gw, gh, allBlocks, clip);
        }
    }

    /**
     * Canvas dimensions: the max of the blocks' extent, the set dimensions,
     * and the default canvas size (80×24). The default size is the editor's
     * working area: it applies when a dimension is unset (null/undefined)
     * and when the set dimension is smaller than the default (the bounds
     * line must stay inside the canvas). Set dimensions only raise the
     * floor for their axis — they are a visual bounds line, not a
     * constraint. Blocks are not restricted to the layout bounds — the
     * canvas grows to the right/bottom so out-of-bounds blocks are fully
     * visible. Children are counted with their 1-cell container padding
     * (same as Python's PseudoGraphicRenderer.canvas_size).
     */
    function canvasSize(blocks, width, height) {
        var maxX = width != null ? Math.max(width, DEFAULT_CANVAS_WIDTH) : DEFAULT_CANVAS_WIDTH;
        var maxY = height != null ? Math.max(height, DEFAULT_CANVAS_HEIGHT) : DEFAULT_CANVAS_HEIGHT;
        var byId = new Map(blocks.map(function (b) { return [b.id, b]; }));
        var roots = blocks.filter(function (b) {
            return !b.parent_id || !byId.has(b.parent_id);
        });

        function walk(list, ox, oy) {
            for (var i = 0; i < list.length; i++) {
                var b = list[i];
                var ax = ox + (b.x || 0), ay = oy + (b.y || 0);
                if (ax + (b.width || 0) > maxX) maxX = ax + (b.width || 0);
                if (ay + (b.height || 0) > maxY) maxY = ay + (b.height || 0);
                var children = blocks.filter(function (c) { return c.parent_id === b.id; });
                if (children.length) walk(children, ax + 1, ay + 1);
            }
        }
        walk(roots, 0, 0);
        return [maxX, maxY];
    }

    /**
     * Render a flat list of blocks into a pseudo-graphic string.
     * Root blocks are drawn in ascending `order` (higher order on top);
     * children are drawn inside their parent with 1-cell padding.
     * The canvas is at least width×height but expands to fit blocks placed
     * outside the layout bounds. Trailing empty rows are stripped — the
     * layout height is metadata, not part of the art.
     */
    function render(blocks, width, height) {
        var canvas = canvasSize(blocks, width, height);
        var grid = [];
        for (var y = 0; y < canvas[1]; y++) {
            grid.push(new Array(canvas[0]).fill(" "));
        }

        var byId = new Map(blocks.map(function (b) { return [b.id, b]; }));
        var roots = blocks.filter(function (b) {
            return !b.parent_id || !byId.has(b.parent_id);
        });
        // Stable sort — ties keep insertion order (same as Python's sorted())
        var sorted = roots.slice().sort(function (a, b) {
            return (a.order || 0) - (b.order || 0);
        });

        for (var i = 0; i < sorted.length; i++) {
            renderBlock(sorted[i], grid, canvas[0], canvas[1], blocks, null);
        }

        var lines = grid.map(function (row) { return row.join("").replace(/\s+$/, ""); });
        // Drop trailing empty rows (same as Python's PseudoGraphicRenderer.render)
        while (lines.length && lines[lines.length - 1] === "") lines.pop();
        return lines.join("\n");
    }

    // ── HTML preview (port of RenderBlock.to_html_preview) ──

    function round1(v) {
        return Math.round(v * 10) / 10;
    }

    function fmtPx(v) {
        // Mirror Python's _fmt: integers without a decimal part
        return Number.isInteger(v) ? v + "px" : v + "px";
    }

    function borderHtml(block) {
        var styleMap = {
            solid: "solid", dashed: "dashed", dotted: "dotted",
            double: "double", none: "none",
        };
        var style = styleMap[block.border_style] || "solid";

        if (block.block_type === "hline" || block.block_type === "vline") {
            var direction = block.block_type === "hline" ? "h" : "v";
            return '<div class="block-line block-line--' + direction + " block-line--" + style + '"></div>';
        }

        return '<div class="block-border block-border--' + style +
            '" style="width:100%;height:100%;"></div>';
    }

    // Port of _line_segment_html: one divider line segment — a
    // zero-height div with a border-top at the row's vertical center
    // (same alignment as .block-line--h top:50%).
    function lineSegmentHtml(top, col, length, charWidthPx, style) {
        var left = round1(col * charWidthPx);
        var w = round1(length * charWidthPx);
        return '<div class="block-line block-line--h block-line--seg block-line--' + style +
            '" style="top:' + fmtPx(top) + ";left:" + fmtPx(left) + ";width:" + fmtPx(w) + ';"></div>';
    }

    // Port of _divider_segments_html: the HTML overlay of a divider
    // (variant E) — a line segment per row (up to two divs around the
    // label); empty content — one div per row. The label's row accounts
    // for the vertical shift (meta.vertical_align, default middle).
    function dividerSegmentsHtml(bd, opts, style) {
        var width = bd.width != null ? bd.width : 20;
        var height = bd.height != null ? bd.height : 3;
        var content = bd.content || "";
        var meta = bd.meta || {};
        var align = meta.text_align;
        if (align !== "left" && align !== "center" && align !== "right") align = "center";
        var valign = meta.vertical_align;
        if (valign !== "top" && valign !== "middle" && valign !== "bottom") valign = "middle";

        var lines = content.split("\n");
        var vOff = vAlignOffset(lines.length, height, valign);
        var parts = [];
        for (var row = 0; row < height; row++) {
            var idx = row - vOff;
            var line = (idx >= 0 && idx < lines.length) ? lines[idx].slice(0, width) : "";
            // An empty line has no offset (alignment is a no-op) — one
            // full-width segment per row
            var off = line ? hAlignOffset(line.length, width, align) : 0;
            var top = round1(row * opts.charHeightPx + opts.charHeightPx / 2);
            if (off > 0) parts.push(lineSegmentHtml(top, 0, off, opts.charWidthPx, style));
            var right = width - off - line.length;
            if (right > 0) parts.push(lineSegmentHtml(top, off + line.length, right, opts.charWidthPx, style));
        }
        return parts.join("");
    }

    // Port of _attached_line_html: the HTML overlay of an attached
    // header/footer/sidebar's line (todo-0007/0008/0009). Header/footer
    // (side "top"/"bottom"): a zero-height div with a border-top at the
    // line row's vertical center — the last row for a header, the first
    // for a footer. Sidebar (side "left"/"right"): a zero-width div with a
    // border-left at the line column's horizontal center — the last
    // column for a left sidebar, the first for a right sidebar.
    function attachedLineHtml(width, height, charWidthPx, charHeightPx, style, side) {
        if (side === "left" || side === "right") {
            var left = round1(((side === "left") ? width - 0.5 : 0.5) * charWidthPx);
            return '<div class="block-line block-line--v block-line--seg block-line--' + style +
                '" style="left:' + fmtPx(left) + ";top:0;height:100%;\"></div>";
        }
        var top = round1((side === "bottom" ? 0.5 : height - 0.5) * charHeightPx);
        return '<div class="block-line block-line--h block-line--seg block-line--' + style +
            '" style="top:' + fmtPx(top) + ";left:0;width:100%;\"></div>";
    }

    // Build the HTML for a block and its nested children (recursive).
    // A root block is positioned relative to the canvas (paddingOffset +
    // grid * charSize). A child is positioned relative to its parent's div
    // (1-cell container padding + relative grid * charSize); children are
    // wrapped in a .block-clip div (overflow:hidden, inset 0) that clips
    // them at the container border — mirroring the ASCII clip. The clip
    // lives on the wrapper, not on .block-preview itself, so the
    // container's own outline (drawn OUTSIDE its border box) is not
    // clipped. effective/attached (todo-0007/0008): a header whose top
    // border is clipped by the box's top edge (relative y < 0) or a
    // footer whose bottom border is clipped by the box's bottom edge
    // (relative y + h > inner_h) is attached — the caller passes its
    // effective geometry (flush with the top/bottom of the inner area,
    // full inner width) and the line (bottom for a header, top for a
    // footer) is drawn instead of the full outline. Must stay in sync
    // with Python's _block_preview_html.
    function _blockPreviewHtml(bd, opts, isRoot, effective, attached, attachedSide) {
        var x = bd.x || 0;
        var y = bd.y || 0;
        var width = bd.width != null ? bd.width : 20;
        var height = bd.height != null ? bd.height : 3;
        var order = bd.order || 0;
        var blockType = bd.block_type || "box";
        var borderStyle = bd.border_style || "solid";
        if (effective) {
            x = effective[0]; y = effective[1];
            width = effective[2]; height = effective[3];
        }

        var left, top;
        if (isRoot) {
            left = round1(opts.paddingOffset + x * opts.charWidthPx);
            top = round1(opts.paddingOffset + y * opts.charHeightPx);
        } else {
            left = round1((1 + x) * opts.charWidthPx);
            top = round1((1 + y) * opts.charHeightPx);
        }
        var widthPx = round1(width * opts.charWidthPx);
        var heightPx = round1(height * opts.charHeightPx);

        var children = bd.children || [];
        // fmtPx already appends "px" (mirrors Python's _fmt_px + "px")
        var style = "position:absolute;left:" + fmtPx(left) + ";top:" + fmtPx(top) + ";width:" + fmtPx(widthPx) + ";height:" + fmtPx(heightPx) + ";z-index:" + (10 + order) + ";";

        var borderMap = { solid: "solid", dashed: "dashed", dotted: "dotted", double: "double", none: "none" };
        var bs = borderMap[borderStyle] || "solid";
        var borderHtml;
        if (blockType === "hline" || blockType === "vline") {
            var direction = blockType === "hline" ? "h" : "v";
            borderHtml = '<div class="block-line block-line--' + direction + ' block-line--' + bs + '"></div>';
        } else if (blockType === "divider") {
            borderHtml = dividerSegmentsHtml(bd, opts, bs);
        } else if (attached) {
            var side = attachedSide || (blockType === "footer" ? "bottom" : "top");
            borderHtml = attachedLineHtml(width, height, opts.charWidthPx, opts.charHeightPx, bs, side);
        } else {
            borderHtml = '<div class="block-border block-border--' + bs +
                '" style="width:100%;height:100%;"></div>';
        }

        var childrenHtml = "";
        children.forEach(function (c) {
            // A header whose top border is clipped (y < 0), a footer whose
            // bottom border is clipped (y + h > inner_h), or a sidebar
            // whose left/right border is clipped (x < 0 / x + w > inner_w)
            // is attached (todo-0007/0008/0009): effective geometry — flush
            // with the inner area at the full inner extent, the line
            // instead of the full outline. A block merely touching an edge
            // stays detached.
            var eff = null, att = false, attSide = "";
            var cType = c.block_type || "box";
            var cX = c.x || 0;
            var cY = c.y || 0;
            var cW = c.width != null ? c.width : 20;
            var cH = c.height != null ? c.height : 3;
            var innerW = Math.max(0, width - 2);
            var innerH = Math.max(0, height - 2);
            if (blockType === "box" && cType === "header" && cY < 0) {
                att = true; attSide = "top"; eff = [0, 0, innerW, cH];
            } else if (blockType === "box" && cType === "footer" && cY + cH > innerH) {
                att = true; attSide = "bottom"; eff = [0, innerH - cH, innerW, cH];
            } else if (blockType === "box" && cType === "sidebar" && cX < 0) {
                att = true; attSide = "left"; eff = [0, 0, cW, innerH];
            } else if (blockType === "box" && cType === "sidebar" && cX + cW > innerW) {
                att = true; attSide = "right"; eff = [innerW - cW, 0, cW, innerH];
            }
            childrenHtml += _blockPreviewHtml(c, opts, false, eff, att, attSide);
        });
        if (children.length) {
            // Clip wrapper: children are clipped at the container border here,
            // while the container's own outline (outside its border box) stays
            // unclipped — .block-preview itself has no overflow.
            childrenHtml = '<div class="block-clip">' + childrenHtml + '</div>';
        }

        return '<div class="block-preview" data-block-id="' + bd.id + '" style="' + style + '" data-order="' + order + '">' +
            '<div class="block-inner block-' + blockType + '">' +
            borderHtml +
            '</div>' +
            '<div class="resize-handle" title="Drag to resize"></div>' +
            childrenHtml +
            '</div>';
    }

    function _previewOpts(opts) {
        opts = opts || {};
        return {
            charWidthPx: opts.charWidthPx != null ? opts.charWidthPx : 12.0,
            charHeightPx: opts.charHeightPx != null ? opts.charHeightPx : 14.4,
            paddingOffset: opts.paddingOffset != null ? opts.paddingOffset : 16.0,
        };
    }

    /**
     * Generate an HTML preview div for one block with a resize handle.
     * opts: { charWidthPx, charHeightPx, paddingOffset }
     */
    function toHtmlPreview(block, opts) {
        return _blockPreviewHtml(block, _previewOpts(opts), true);
    }

    /**
     * Generate HTML previews for all blocks. Takes a flat list (children
     * reference their parent via parent_id) and nests the children inside
     * their parent's div, wrapped in a .block-clip div that clips them at
     * the container border — mirroring the ASCII clip and the Python
     * renderer (the parent's own outline stays unclipped).
     */
    function renderHtmlPreview(blocks, opts) {
        var o = _previewOpts(opts);
        var nodes = new Map();
        blocks.forEach(function (b) {
            nodes.set(b.id, {
                id: b.id,
                x: b.x, y: b.y,
                width: b.width, height: b.height,
                block_type: b.block_type,
                content: b.content,
                border_style: b.border_style,
                meta: b.meta,
                order: b.order,
                children: [],
            });
        });
        var roots = [];
        blocks.forEach(function (b) {
            var node = nodes.get(b.id);
            if (b.parent_id && nodes.has(b.parent_id)) {
                nodes.get(b.parent_id).children.push(node);
            } else {
                roots.push(node);
            }
        });
        return roots.map(function (r) { return _blockPreviewHtml(r, o, true); }).join("\n");
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    /**
     * Generate the layout bounds overlay for the editor canvas (port of
     * PseudoGraphicRenderer.render_bounds_html). A set width draws a
     * vertical line at x=width; a set height draws a horizontal line at
     * y=height. The lines are a visual guide only — they do not constrain
     * block placement or the canvas size, and they are not part of the
     * pseudo-graphic format (ASCII art).
     *
     * opts: { width, height, charWidthPx, charHeightPx, paddingOffset }
     */
    function renderBoundsHtml(opts) {
        opts = opts || {};
        var charWidthPx = opts.charWidthPx != null ? opts.charWidthPx : 12.0;
        var charHeightPx = opts.charHeightPx != null ? opts.charHeightPx : 14.4;
        var paddingOffset = opts.paddingOffset != null ? opts.paddingOffset : 16.0;
        var parts = [];

        if (opts.width) {
            var left = round1(paddingOffset + opts.width * charWidthPx);
            parts.push(
                '<div class="layout-bounds layout-bounds--v" ' +
                'style="left:' + fmtPx(left) + ";top:" + fmtPx(paddingOffset) + ";" +
                "bottom:" + fmtPx(paddingOffset) + ';"></div>'
            );
        }
        if (opts.height) {
            var top = round1(paddingOffset + opts.height * charHeightPx);
            parts.push(
                '<div class="layout-bounds layout-bounds--h" ' +
                'style="top:' + fmtPx(top) + ";left:" + fmtPx(paddingOffset) + ";" +
                "right:" + fmtPx(paddingOffset) + ';"></div>'
            );
        }
        return parts.join("\n");
    }

    /**
     * Build the full canvas HTML (render-wrapper + ascii-art div + block
     * previews) — mirrors the markup of
     * GET /api/layouts/{id}/render so both modes share the same CSS and
     * overlay behavior.
     *
     * The art is a <div class="ascii-art">, NOT a <pre>: the HTML parser
     * strips the first newline right after a <pre> start tag, so art that
     * starts with an empty row (topmost block not at y=0) would lose its
     * first line and shift up one row relative to the overlays.
     *
     * opts: { width, height, charWidthPx, charHeightPx, paddingOffset }
     */
    function renderHtml(ascii, blocks, opts) {
        opts = opts || {};
        var charWidthPx = opts.charWidthPx != null ? opts.charWidthPx : 12.0;
        var charHeightPx = opts.charHeightPx != null ? opts.charHeightPx : 14.4;
        var paddingOffset = opts.paddingOffset != null ? opts.paddingOffset : 16.0;

        // Canvas = layout size expanded to fit blocks outside the bounds
        var canvas = canvasSize(blocks, opts.width, opts.height);
        var preWidth = canvas[0] * charWidthPx;
        var preHeight = round1(canvas[1] * charHeightPx);

        var asciiHtml =
            '<div class="ascii-art" style="font-family: monospace; font-size: 12px; ' +
            "line-height: 1.2; display: block; white-space: pre; " +
            "width:" + preWidth + "px; height:" + preHeight + "px; " +
            'background: #1a1a2e; color: #e0e0e0;">' +
            escapeHtml(ascii) + "</div>";

        var previews = renderHtmlPreview(blocks, {
            charWidthPx: charWidthPx,
            charHeightPx: charHeightPx,
            paddingOffset: paddingOffset,
        });

        // Layout bounds overlay: a set width/height draws a visual line on
        // the editor canvas (not part of the ASCII art).
        var bounds = renderBoundsHtml({
            width: opts.width,
            height: opts.height,
            charWidthPx: charWidthPx,
            charHeightPx: charHeightPx,
            paddingOffset: paddingOffset,
        });

        return (
            '<div class="render-wrapper" ' +
            'style="width:' + preWidth + "px; height:" + preHeight + 'px;">' +
            asciiHtml + bounds + previews +
            "</div>"
        );
    }

    // ── Public API ──

    var PGRenderer = {
        BORDERS: BORDERS,
        BLOCK_TYPES: BLOCK_TYPES,
        BORDER_STYLES: BORDER_STYLES,
        render: render,
        canvasSize: canvasSize,
        fillChar: fillChar,
        arrowGlyph: arrowGlyph,
        hAlignOffset: hAlignOffset,
        vAlignOffset: vAlignOffset,
        wrapText: wrapText,
        textBlockSize: textBlockSize,
        buttonBlockSize: buttonBlockSize,
        dividerFitSize: dividerFitSize,
        gridMetaInt: gridMetaInt,
        gridHasStructure: gridHasStructure,
        gridCreateMeta: gridCreateMeta,
        gridMetaWidths: gridMetaWidths,
        splitAxis: splitAxis,
        gridSplit: gridSplit,
        gridReshapeWidths: gridReshapeWidths,
        gridJunction: gridJunction,
        mixedAttachedJunction: mixedAttachedJunction,
        attachedVJunction: attachedVJunction,
        twoLineJunction: twoLineJunction,
        dominantCorner: dominantCorner,
        planAttached: planAttached,
        toHtmlPreview: toHtmlPreview,
        renderHtmlPreview: renderHtmlPreview,
        renderBoundsHtml: renderBoundsHtml,
        renderHtml: renderHtml,
        escapeHtml: escapeHtml,
    };

    global.PGRenderer = PGRenderer;

    // Node.js (tests) — plain script in the browser, CommonJS export in Node
    if (typeof module !== "undefined" && module.exports) {
        module.exports = PGRenderer;
    }
})(typeof window !== "undefined" ? window : globalThis);
