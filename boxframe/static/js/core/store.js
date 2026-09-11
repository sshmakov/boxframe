/**
 * Persistence stores for the boxframe editor.
 *
 * The editor (editor.js) never talks to fetch() directly — it uses a store
 * with this async interface:
 *
 *   info()               → { block_types, border_styles }
 *   load()               → { width, height, blocks }
 *   render(cw, ch)       → { ascii, html }
 *   createBlock(data)    → block
 *   updateBlock(id, p)   → block
 *   deleteBlock(id)      → { ok }
 *   replaceState(state)  → { ok }   (all stores)
 *   export()             → { json, markdown, ascii }
 *   clear()              → { ok }   (all stores)
 *
 * createFetchStore(layoutId, projectId) — web mode: talks to the boxframe
 * REST API (server-rendered page with data-layout-id).
 *
 * createMemoryStore(options) — static mode: keeps the layout in memory,
 * renders with the local PGRenderer (core/renderer.js). No backend needed;
 * state is lost on reload.
 *
 * createLocalStorageStore(options) — static mode with browser persistence:
 * same as the memory store, but the layout is restored from localStorage on
 * load and saved after every mutation. options.key — storage key (default
 * "boxframe.static.layout"); options.storage — injectable { getItem,
 * setItem } object (tests); falls back to the in-memory behavior when the
 * browser has no localStorage.
 *
 * clear() removes all blocks (and the saved state for the local store).
 */

(function (global) {
    "use strict";

    // ── FetchStore (web mode) ───────────────────────────────

    function createFetchStore(layoutId, projectId) {
        function api(path, opts) {
            return fetch(path, opts).then(function (r) {
                if (!r.ok) throw new Error("API " + r.status + ": " + path);
                return r.json();
            });
        }

        return {
            mode: "fetch",

            info: function () {
                return api("/api/projects/" + projectId + "/info");
            },

            load: function () {
                return api("/api/layouts/" + layoutId).then(function (data) {
                    return { width: data.width, height: data.height, blocks: data.blocks };
                });
            },

            render: function (charWidthPx, charHeightPx) {
                return api(
                    "/api/layouts/" + layoutId + "/render" +
                    "?char_width_px=" + charWidthPx.toFixed(2) +
                    "&char_height_px=" + charHeightPx.toFixed(2)
                );
            },

            createBlock: function (data) {
                return api("/api/layouts/" + layoutId + "/blocks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data),
                });
            },

            updateBlock: function (blockId, props) {
                return api("/api/layouts/" + layoutId + "/blocks/" + blockId, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(props),
                });
            },

            deleteBlock: function (blockId) {
                return api("/api/layouts/" + layoutId + "/blocks/" + blockId, {
                    method: "DELETE",
                });
            },

            clear: function () {
                return api("/api/layouts/" + layoutId + "/blocks", {
                    method: "DELETE",
                });
            },

            // Full state restore (undo/redo): the server replaces all blocks
            // with the given set in one request. Block ids are preserved.
            replaceBlocks: function (blocks) {
                return api("/api/layouts/" + layoutId + "/blocks", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ blocks: blocks }),
                });
            },

            export: function () {
                return api("/api/layouts/" + layoutId + "/export").then(function (data) {
                    // The API field is `layout_json`; normalize to `json`
                    // (the old editor.js read data.json, which was undefined).
                    return { json: data.layout_json, markdown: data.markdown, ascii: data.ascii };
                });
            },
        };
    }

    // ── Layout store core (shared by memory / localStorage) ─

    function newId() {
        if (global.crypto && global.crypto.randomUUID) {
            return global.crypto.randomUUID();
        }
        return "blk-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
    }

    function buildExportJson(layout) {
        // Mirrors LayoutService.export_json: root blocks + their direct children
        return {
            id: layout.id,
            name: layout.name,
            width: layout.width,
            height: layout.height,
            blocks: layout.blocks
                .filter(function (b) { return !b.parent_id; })
                .map(function (b) {
                    return {
                        id: b.id,
                        type: b.block_type,
                        x: b.x,
                        y: b.y,
                        width: b.width,
                        height: b.height,
                        content: b.content,
                        border_style: b.border_style,
                        metadata: b.meta,
                        children: layout.blocks
                            .filter(function (c) { return c.parent_id === b.id; })
                            .map(function (c) {
                                return {
                                    id: c.id,
                                    type: c.block_type,
                                    x: c.x,
                                    y: c.y,
                                    width: c.width,
                                    height: c.height,
                                    content: c.content,
                                    border_style: c.border_style,
                                    metadata: c.meta,
                                };
                            }),
                    };
                }),
        };
    }

    // options: { name, width, height, blocks }
    // onMutate(state) — called after every mutation (create/update/delete/
    // clear) with a deep snapshot { width, height, blocks }; null for a
    // plain in-memory store.
    function createLayoutStore(options, onMutate) {
        options = options || {};

        var layout = {
            id: null,
            name: options.name || "Untitled",
            // Static editor: layout dimensions are considered unset — the
            // canvas is the 80×24 default floor and no bounds line is drawn.
            width: options.width != null ? options.width : null,
            height: options.height != null ? options.height : null,
            blocks: (options.blocks || []).map(function (b) { return Object.assign({}, b); }),
        };

        function snapshot() {
            return {
                width: layout.width,
                height: layout.height,
                blocks: layout.blocks.map(function (b) { return Object.assign({}, b); }),
            };
        }

        function mutate() {
            if (onMutate) onMutate(snapshot());
        }

        function maxOrder() {
            if (layout.blocks.length === 0) return 0;
            return Math.max.apply(null, layout.blocks.map(function (b) { return b.order || 0; }));
        }

        // Lines are always 1 cell thick — mirrors LayoutService rules
        function normalizeLine(block) {
            if (block.block_type === "hline") block.height = 1;
            else if (block.block_type === "vline") block.width = 1;
        }

        return {
            info: function () {
                return Promise.resolve({
                    block_types: PGRenderer.BLOCK_TYPES,
                    border_styles: PGRenderer.BORDER_STYLES,
                });
            },

            load: function () {
                return Promise.resolve({
                    width: layout.width,
                    height: layout.height,
                    blocks: layout.blocks.map(function (b) { return Object.assign({}, b); }),
                });
            },

            createBlock: function (data) {
                // order == 0 (default/unsent) → MAX(order) + 1, same as the API
                var order = data.order ? data.order : maxOrder() + 1;
                var block = {
                    id: newId(),
                    block_type: data.block_type,
                    x: data.x != null ? data.x : 0,
                    y: data.y != null ? data.y : 0,
                    width: data.width != null ? data.width : 20,
                    height: data.height != null ? data.height : 3,
                    content: data.content != null ? data.content : "",
                    border_style: data.border_style || "solid",
                    parent_id: data.parent_id || null,
                    meta: data.meta || {},
                    order: order,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                };
                normalizeLine(block);
                layout.blocks.push(block);
                mutate();
                return Promise.resolve(Object.assign({}, block));
            },

            updateBlock: function (blockId, props) {
                var block = layout.blocks.find(function (b) { return b.id === blockId; });
                if (!block) return Promise.reject(new Error("Block not found: " + blockId));
                Object.keys(props || {}).forEach(function (key) {
                    var value = props[key];
                    if (value !== null && value !== undefined) block[key] = value;
                });
                normalizeLine(block);
                block.updated_at = new Date().toISOString();
                mutate();
                return Promise.resolve(Object.assign({}, block));
            },

            deleteBlock: function (blockId) {
                var idx = layout.blocks.findIndex(function (b) { return b.id === blockId; });
                if (idx === -1) return Promise.reject(new Error("Block not found: " + blockId));
                layout.blocks.splice(idx, 1);
                mutate();
                return Promise.resolve({ ok: true });
            },

            clear: function () {
                layout.width = null;
                layout.height = null;
                layout.blocks = [];
                mutate();
                return Promise.resolve({ ok: true });
            },

            // Full state restore (undo/redo): swap in a snapshot
            // { width, height, blocks }. Blocks are deep-copied so the
            // snapshot stays independent of the live layout.
            replaceState: function (state) {
                state = state || {};
                layout.width = state.width != null ? state.width : null;
                layout.height = state.height != null ? state.height : null;
                layout.blocks = (state.blocks || []).map(function (b) {
                    return Object.assign({}, b);
                });
                mutate();
                return Promise.resolve({ ok: true });
            },

            render: function (charWidthPx, charHeightPx) {
                var ascii = PGRenderer.render(layout.blocks, layout.width, layout.height);
                var html = PGRenderer.renderHtml(ascii, layout.blocks, {
                    width: layout.width,
                    height: layout.height,
                    charWidthPx: charWidthPx,
                    charHeightPx: charHeightPx,
                    paddingOffset: 16,
                });
                return Promise.resolve({ ascii: ascii, html: html });
            },

            export: function () {
                var ascii = PGRenderer.render(layout.blocks, layout.width, layout.height);
                return Promise.resolve({
                    json: buildExportJson(layout),
                    markdown: "```text\n" + ascii + "\n```",
                    ascii: ascii,
                });
            },
        };
    }

    // ── MemoryStore (static mode) ───────────────────────────

    function createMemoryStore(options) {
        var store = createLayoutStore(options, null);
        store.mode = "memory";
        return store;
    }

    // ── LocalStorageStore (static mode, browser persistence) ──

    var DEFAULT_STORAGE_KEY = "boxframe.static.layout";

    function readSavedState(storage, key) {
        var raw = null;
        try {
            raw = storage.getItem(key);
        } catch (err) {
            return null;
        }
        if (!raw) return null;
        var state = null;
        try {
            state = JSON.parse(raw);
        } catch (err) {
            return null; // corrupted JSON — start with an empty layout
        }
        if (!state || !Array.isArray(state.blocks)) return null;
        return state;
    }

    function createLocalStorageStore(options) {
        options = options || {};
        var key = options.key || DEFAULT_STORAGE_KEY;
        var storage = options.storage ||
            (typeof localStorage !== "undefined" ? localStorage : null);

        var width = options.width != null ? options.width : null;
        var height = options.height != null ? options.height : null;
        var blocks = options.blocks || [];

        if (storage) {
            var saved = readSavedState(storage, key);
            if (saved) {
                width = saved.width != null ? saved.width : null;
                height = saved.height != null ? saved.height : null;
                blocks = saved.blocks;
            }
        }

        var store = createLayoutStore(
            { name: options.name, width: width, height: height, blocks: blocks },
            storage ? function (state) {
                try {
                    storage.setItem(key, JSON.stringify(state));
                } catch (err) {
                    // QuotaExceeded / private mode — the layout still works
                    // in memory, it just will not survive a reload.
                    console.warn("Failed to save layout to localStorage:", err);
                }
            } : null
        );
        store.mode = "local";
        store.storageKey = key;
        return store;
    }

    global.createFetchStore = createFetchStore;
    global.createMemoryStore = createMemoryStore;
    global.createLocalStorageStore = createLocalStorageStore;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            createFetchStore: createFetchStore,
            createMemoryStore: createMemoryStore,
            createLocalStorageStore: createLocalStorageStore,
        };
    }
})(typeof window !== "undefined" ? window : globalThis);
