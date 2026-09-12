/**
 * Layout import: parse an exported layout JSON into the editor's flat block
 * representation and prepare it for application.
 *
 * The export format (see LayoutService.export_json / buildExportJson) is
 * nested: root blocks carry their children inline and use the `type` /
 * `metadata` field names. The editor works with a flat list where every
 * block has `block_type` / `meta` / `parent_id`. This module bridges the
 * two.
 *
 *   parseLayoutJson(json)  -> { width, height, blocks }
 *       blocks — flat list in document order. `order` is preserved when the
 *       export carries it (new exports) and assigned sequentially otherwise
 *       (older exports have no `order`).
 *
 *   prepareImport(blocks, existingBlocks, mode)  -> blocks
 *       mode "replace" — the imported layout becomes the whole content:
 *                        fresh ids (no collisions), orders kept.
 *       mode "add"     — the imported blocks are appended on top of the
 *                        existing ones: fresh ids, orders shifted above the
 *                        current maximum.
 *
 * Run with: node --test tests/js/
 */

(function (global) {
    "use strict";

    function newId() {
        if (global.crypto && global.crypto.randomUUID) {
            return global.crypto.randomUUID();
        }
        return "blk-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    }

    function num(value, fallback) {
        return typeof value === "number" && isFinite(value) ? value : fallback;
    }

    // Parse an exported layout JSON into a flat block list.
    // Accepts the nested export format (type/metadata/children) and
    // normalizes it to the editor's flat representation.
    function parseLayoutJson(json) {
        if (!json || typeof json !== "object" || !Array.isArray(json.blocks)) {
            throw new Error("Invalid layout file: expected a JSON object with a 'blocks' array");
        }
        var flat = [];
        var nextOrder = 0;

        function addBlock(b, parentId) {
            if (!b || typeof b !== "object") return;
            var block = {
                id: typeof b.id === "string" && b.id ? b.id : newId(),
                block_type: b.type || b.block_type || "box",
                x: num(b.x, 0),
                y: num(b.y, 0),
                width: num(b.width, 20),
                height: num(b.height, 3),
                content: b.content != null ? String(b.content) : "",
                border_style: b.border_style || "solid",
                meta: b.metadata != null ? b.metadata : (b.meta != null ? b.meta : {}),
                parent_id: parentId,
            };
            // Preserve the z-order when the export carries it; otherwise
            // fall back to document order (older exports have no `order`).
            if (typeof b.order === "number") {
                block.order = b.order;
                if (b.order >= nextOrder) nextOrder = b.order + 1;
            } else {
                block.order = nextOrder++;
            }
            flat.push(block);
            var children = Array.isArray(b.children) ? b.children : [];
            for (var i = 0; i < children.length; i++) {
                addBlock(children[i], block.id);
            }
        }

        for (var i = 0; i < json.blocks.length; i++) {
            addBlock(json.blocks[i], null);
        }

        return {
            width: json.width != null ? json.width : null,
            height: json.height != null ? json.height : null,
            blocks: flat,
        };
    }

    // Prepare parsed import blocks for application.
    //   mode "replace" — the imported layout becomes the whole content:
    //                     fresh ids (no collisions), orders kept.
    //   mode "add"     — the imported blocks are appended on top of the
    //                     existing ones: fresh ids, orders shifted above
    //                     the current maximum.
    // existingBlocks is only used in "add" mode (to compute the order base).
    function prepareImport(blocks, existingBlocks, mode) {
        existingBlocks = existingBlocks || [];
        var base = 0;
        if (mode === "add") {
            for (var i = 0; i < existingBlocks.length; i++) {
                var o = existingBlocks[i].order;
                if (typeof o === "number" && o >= base) base = o + 1;
            }
        }
        var idMap = {};
        for (var j = 0; j < blocks.length; j++) {
            idMap[blocks[j].id] = newId();
        }
        return blocks.map(function (b) {
            return {
                id: idMap[b.id],
                block_type: b.block_type,
                x: b.x,
                y: b.y,
                width: b.width,
                height: b.height,
                content: b.content,
                border_style: b.border_style,
                meta: b.meta,
                parent_id: b.parent_id ? idMap[b.parent_id] : null,
                order: b.order + base,
            };
        });
    }

    global.parseLayoutJson = parseLayoutJson;
    global.prepareImport = prepareImport;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { parseLayoutJson: parseLayoutJson, prepareImport: prepareImport };
    }
})(typeof window !== "undefined" ? window : globalThis);
