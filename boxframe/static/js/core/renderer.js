/**
 * Pseudo-graphic renderer (JavaScript port of boxframe/services/renderer.py).
 *
 * Converts a flat list of blocks into ASCII art on a character grid using
 * Unicode box-drawing characters, and generates the HTML overlay (positioned
 * block previews with resize handles) that the editor draws on top of the
 * <pre>.
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

    // ── Text wrapping (port of PseudoGraphicRenderer._wrap_text) ──

    function wrapText(text, width) {
        var wrapped = [];
        var rawLines = String(text == null ? "" : text).split("\n");
        for (var li = 0; li < rawLines.length; li++) {
            // Python's str.split() — any whitespace, empty items dropped
            var words = rawLines[li].split(/\s+/).filter(function (w) { return w.length > 0; });
            var current = "";
            for (var wi = 0; wi < words.length; wi++) {
                var word = words[wi];
                while (word.length > width) {
                    if (current) { wrapped.push(current); current = ""; }
                    wrapped.push(word.slice(0, width));
                    word = word.slice(width);
                }
                if (!word) continue;
                if (!current) {
                    current = word;
                } else if (current.length + 1 + word.length <= width) {
                    current = current + " " + word;
                } else {
                    wrapped.push(current);
                    current = word;
                }
            }
            if (current) {
                wrapped.push(current);
            } else if (words.length === 0) {
                wrapped.push("");
            }
        }
        return wrapped;
    }

    // ── Grid drawing (ports of the PseudoGraphicRenderer methods) ──

    function drawBorder(block, style, grid, gw, gh) {
        var x = Math.max(0, Math.min(block.x, gw - 2));
        var y = Math.max(0, Math.min(block.y, gh - 2));
        var w = Math.min(block.width, gw - x);
        var h = Math.min(block.height, gh - y);

        if (w < 2 || h < 2) return;

        grid[y][x] = style.tl;
        grid[y][x + w - 1] = style.tr;
        grid[y + h - 1][x] = style.bl;
        grid[y + h - 1][x + w - 1] = style.br;

        for (var i = 1; i < w - 1; i++) {
            grid[y][x + i] = style.h;
            grid[y + h - 1][x + i] = style.h;
        }
        for (var j = 1; j < h - 1; j++) {
            grid[y + j][x] = style.v;
            grid[y + j][x + w - 1] = style.v;
        }
    }

    function drawLine(block, style, grid, gw, gh) {
        var x = Math.max(0, Math.min(block.x, gw - 1));
        var y = Math.max(0, Math.min(block.y, gh - 1));

        if (block.block_type === "hline") {
            var w = Math.min(block.width, gw - x);
            for (var i = 0; i < Math.max(1, w); i++) {
                grid[y][x + i] = style.h;
            }
        } else { // vline
            var h = Math.min(block.height, gh - y);
            for (var j = 0; j < Math.max(1, h); j++) {
                grid[y + j][x] = style.v;
            }
        }
    }

    function drawContent(block, grid, gw, gh) {
        var x = Math.max(0, Math.min(block.x, gw - 2));
        var y = Math.max(0, Math.min(block.y, gh - 2));
        var w = Math.min(block.width, gw - x);
        var h = Math.min(block.height, gh - y);

        if (w < 1 || h < 1) return;

        var hasBorder = block.border_style !== "none";
        if (hasBorder && (w < 2 || h < 2)) return;

        if (!block.content) {
            // Show type hint if no content
            if (hasBorder && w >= 4) {
                var hint = "[" + block.block_type + "]";
                var hx = x + 1, hy = y + 1;
                for (var i = 0; i < hint.length; i++) {
                    if (hx + i < x + w - 1 && hy < gh) {
                        grid[hy][hx + i] = hint[i];
                    }
                }
            }
            return;
        }

        var contentX = x + (hasBorder ? 1 : 0);
        var contentY = y + (hasBorder ? 1 : 0);
        var contentW = w - (hasBorder ? 2 : 0);
        var contentH = h - (hasBorder ? 2 : 0);

        if (contentW <= 0 || contentH <= 0) return;

        var lines = wrapText(block.content, contentW);
        for (var lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            if (lineIdx >= contentH) break;
            var row = contentY + lineIdx;
            if (row >= gh) break;
            var line = lines[lineIdx];
            for (var colIdx = 0; colIdx < line.length; colIdx++) {
                var col = contentX + colIdx;
                if (col < gw) {
                    grid[row][col] = line[colIdx];
                }
            }
        }
    }

    function renderChildrenInContainer(parent, style, grid, gw, gh, allBlocks) {
        var padX = 1, padY = 1;
        var children = allBlocks
            .filter(function (b) { return b.parent_id === parent.id; })
            .sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });

        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            // Adjusted copy — never mutate the store's blocks
            var c = {
                id: child.id,
                x: parent.x + padX + child.x,
                y: parent.y + padY + child.y,
                width: Math.min(child.width, parent.width - 2 * padX),
                height: Math.min(child.height, parent.height - 2 * padY),
                block_type: child.block_type,
                content: child.content,
                border_style: child.border_style,
                order: child.order,
                parent_id: child.parent_id,
            };
            renderBlock(c, grid, gw, gh, allBlocks);
        }
    }

    function renderBlock(block, grid, gw, gh, allBlocks) {
        var style = BORDERS[block.border_style] || BORDERS.solid;

        if (block.block_type === "hline" || block.block_type === "vline") {
            if (block.border_style !== "none") {
                drawLine(block, style, grid, gw, gh);
            }
            return;
        }

        var hasBorder = block.border_style !== "none" && block.width >= 2 && block.height >= 2;

        if (hasBorder) {
            drawBorder(block, style, grid, gw, gh);
            drawContent(block, grid, gw, gh);
            var hasChildren = allBlocks.some(function (b) { return b.parent_id === block.id; });
            if (hasChildren) {
                renderChildrenInContainer(block, style, grid, gw, gh, allBlocks);
            }
        } else {
            drawContent(block, grid, gw, gh);
        }
    }

    /**
     * Canvas dimensions: at least width×height, expanded to fit all blocks.
     * Blocks are not restricted to the layout bounds — the canvas grows to
     * the right/bottom so out-of-bounds blocks are fully visible. Children
     * are counted with their 1-cell container padding (same as Python's
     * PseudoGraphicRenderer.canvas_size).
     */
    function canvasSize(blocks, width, height) {
        var maxX = width, maxY = height;
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
     * outside the layout bounds.
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
            renderBlock(sorted[i], grid, canvas[0], canvas[1], blocks);
        }

        return grid
            .map(function (row) { return row.join("").replace(/\s+$/, ""); })
            .join("\n");
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

    /**
     * Generate an HTML preview div for one block with a resize handle.
     * opts: { charWidthPx, charHeightPx, paddingOffset }
     */
    function toHtmlPreview(block, opts) {
        opts = opts || {};
        var charWidthPx = opts.charWidthPx != null ? opts.charWidthPx : 12.0;
        var charHeightPx = opts.charHeightPx != null ? opts.charHeightPx : 14.4;
        var paddingOffset = opts.paddingOffset != null ? opts.paddingOffset : 16.0;

        var left = round1(paddingOffset + block.x * charWidthPx);
        var top = round1(paddingOffset + block.y * charHeightPx);
        var w = round1(block.width * charWidthPx);
        var h = round1(block.height * charHeightPx);
        // z-index: base 10 + order so default order=0 → z-index 10
        var zIndex = 10 + (block.order || 0);

        return (
            '<div class="block-preview" data-block-id="' + block.id + '"' +
            ' style="position:absolute;left:' + fmtPx(left) + ";top:" + fmtPx(top) + ";" +
            "width:" + fmtPx(w) + ";height:" + fmtPx(h) + ";z-index:" + zIndex + ';"' +
            ' data-order="' + (block.order || 0) + '">' +
            '<div class="block-inner block-' + block.block_type + '">' +
            borderHtml(block) +
            "</div>" +
            '<div class="resize-handle" title="Drag to resize"></div>' +
            "</div>"
        );
    }

    /**
     * Generate HTML previews for all blocks (children flattened onto the
     * same layer, positioned by their own x/y — same as the server).
     */
    function renderHtmlPreview(blocks, opts) {
        var byId = new Map(blocks.map(function (b) { return [b.id, b]; }));
        var parts = [];
        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            if (block.parent_id && byId.has(block.parent_id)) continue;
            parts.push(toHtmlPreview(block, opts));
            for (var j = 0; j < blocks.length; j++) {
                if (blocks[j].parent_id === block.id) {
                    parts.push(toHtmlPreview(blocks[j], opts));
                }
            }
        }
        return parts.join("\n");
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    /**
     * Build the full canvas HTML (render-wrapper + <pre> + layout bounds +
     * block previews) — mirrors the markup of GET /api/layouts/{id}/render
     * so both modes share the same CSS and overlay behavior.
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
            '<pre style="font-family: monospace; font-size: 12px; ' +
            "line-height: 1.2; display: block; " +
            "width:" + preWidth + "px; height:" + preHeight + "px; " +
            'background: #1a1a2e; color: #e0e0e0;">' +
            escapeHtml(ascii) + "</pre>";

        // Dashed frame marking the layout's logical size — blocks may be
        // placed outside it, the frame shows where the layout ends.
        var boundsHtml =
            '<div class="layout-bounds" style="left:' + paddingOffset + "px;top:" + paddingOffset + 'px;' +
            "width:" + (opts.width * charWidthPx) + "px;height:" + round1(opts.height * charHeightPx) + 'px;"' +
            ' title="Layout bounds: ' + opts.width + '×' + opts.height + ' cells"></div>';

        var previews = renderHtmlPreview(blocks, {
            charWidthPx: charWidthPx,
            charHeightPx: charHeightPx,
            paddingOffset: paddingOffset,
        });

        return (
            '<div class="render-wrapper" ' +
            'style="width:' + preWidth + "px; height:" + preHeight + 'px;">' +
            asciiHtml + boundsHtml + previews +
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
        wrapText: wrapText,
        toHtmlPreview: toHtmlPreview,
        renderHtmlPreview: renderHtmlPreview,
        renderHtml: renderHtml,
        escapeHtml: escapeHtml,
    };

    global.PGRenderer = PGRenderer;

    // Node.js (tests) — plain script in the browser, CommonJS export in Node
    if (typeof module !== "undefined" && module.exports) {
        module.exports = PGRenderer;
    }
})(typeof window !== "undefined" ? window : globalThis);
