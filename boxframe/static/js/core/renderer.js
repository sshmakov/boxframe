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
    // (meta.fill, tasks/0051 phase 2). Mirrors FILL_TYPES in
    // services/renderer.py.
    var FILL_TYPES = {
        box: true, header: true, footer: true, sidebar: true,
        content: true, grid: true, image: true,
    };

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

    // Port of PseudoGraphicRenderer._draw_button
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

        // Label — single line, vertically centered, truncated to fit,
        // horizontally aligned (meta.text_align)
        if (block.content) {
            var row = y + Math.floor((h - 1) / 2);
            var innerX = x + (framed ? 1 : 0);
            var innerW = w - (framed ? 2 : 0);
            if (innerW > 0 && row < gh) {
                var label = String(block.content).split("\n")[0].slice(0, innerW);
                var off = hAlignOffset(label.length, innerW, (block.meta || {}).text_align);
                for (var c = 0; c < label.length; c++) {
                    setCell(grid, gw, gh, clip, innerX + off + c, row, label[c]);
                }
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

        if (!block.content) {
            // Show type hint if no content and no fill
            if (hasBorder && w >= 4 && !fill) {
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

        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            // Adjusted copy — never mutate the store's blocks
            var c = {
                id: child.id,
                x: parent.x + padX + child.x,
                y: parent.y + padY + child.y,
                width: child.width,
                height: child.height,
                block_type: child.block_type,
                content: child.content,
                border_style: child.border_style,
                meta: child.meta,
                order: child.order,
                parent_id: child.parent_id,
            };
            renderBlock(c, grid, gw, gh, allBlocks, inner);
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

        var hasBorder = block.border_style !== "none"
            && block.width >= 2 && block.height >= 2;

        if (hasBorder) {
            drawBorder(block, style, grid, gw, gh, clip);
            drawContent(block, grid, gw, gh, clip);
            var hasChildren = allBlocks.some(function (b) { return b.parent_id === block.id; });
            if (hasChildren) {
                renderChildrenInContainer(block, style, grid, gw, gh, allBlocks, clip);
            }
        } else {
            drawContent(block, grid, gw, gh, clip);
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

    // Build the HTML for a block and its nested children (recursive).
    // A root block is positioned relative to the canvas (paddingOffset +
    // grid * charSize). A child is positioned relative to its parent's div
    // (1-cell container padding + relative grid * charSize); the parent's
    // overflow:hidden clips it at the container border — mirroring the ASCII
    // clip. Must stay in sync with Python's _block_preview_html.
    function _blockPreviewHtml(bd, opts, isRoot) {
        var x = bd.x || 0;
        var y = bd.y || 0;
        var width = bd.width != null ? bd.width : 20;
        var height = bd.height != null ? bd.height : 3;
        var order = bd.order || 0;
        var blockType = bd.block_type || "box";
        var borderStyle = bd.border_style || "solid";

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
        if (children.length) {
            style += "overflow:hidden;";
        }

        var borderMap = { solid: "solid", dashed: "dashed", dotted: "dotted", double: "double", none: "none" };
        var bs = borderMap[borderStyle] || "solid";
        var borderHtml;
        if (blockType === "hline" || blockType === "vline") {
            var direction = blockType === "hline" ? "h" : "v";
            borderHtml = '<div class="block-line block-line--' + direction + ' block-line--' + bs + '"></div>';
        } else {
            borderHtml = '<div class="block-border block-border--' + bs +
                '" style="width:100%;height:100%;"></div>';
        }

        var childrenHtml = "";
        children.forEach(function (c) {
            childrenHtml += _blockPreviewHtml(c, opts, false);
        });

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
     * their parent's div so the parent's overflow:hidden clips them —
     * mirroring the ASCII clip and the Python renderer.
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
