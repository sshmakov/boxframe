/**
 * Snapshot-based undo/redo history for a layout store.
 *
 * withHistory(store, options) wraps any store (fetch / memory / local)
 * and adds:
 *
 *   undo() / redo()       → restore the previous / next snapshot
 *   canUndo / canRedo     → booleans
 *   undoCount / redoCount → stack sizes
 *
 * How it works:
 *   - Before each mutation (createBlock / updateBlock / deleteBlock /
 *     clear / replaceState) the current state is snapshotted and pushed
 *     onto the undo stack; the redo stack is cleared.
 *   - undo() pushes the current state onto the redo stack, pops the undo
 *     stack, and restores that snapshot through the inner store
 *     (replaceState for local stores, the batch replaceBlocks endpoint
 *     for the fetch store). redo() is the mirror image.
 *
 * The stacks are capped at options.maxSnapshots entries (default 50) —
 * the oldest snapshots are dropped first.
 *
 * Persistence (optional): pass options.storage — an object with
 * getItem/setItem (the browser's localStorage, or a test double) — and
 * optionally options.historyKey (default "boxframe.static.history").
 * The stacks, plus the current state they were built against, are saved
 * after every change and restored on the next load(), so the undo
 * buffer survives page reloads. The restore is validated: if the state
 * loaded from the store no longer matches the saved one (the layout was
 * changed elsewhere — another tab, another client, the API), the stale
 * stacks are dropped and the record removed. In web mode scope the key
 * per layout (e.g. "boxframe.history.layout.<layoutId>").
 *
 * State tracking (no extra requests):
 *   The current state is kept in a cache, not re-fetched per mutation:
 *   - it is seeded from the store's own load() calls (the editor loads
 *     the layout on init and after every undo/redo),
 *   - it is updated from each mutation's result (the created/updated
 *     block, the deleted id, ...),
 *   - it falls back to a single load() if no load has happened yet.
 *   So a mutation costs exactly one request (the mutation itself) and
 *   undo/redo cost exactly one (the batch replace in web mode).
 *
 * Coalescing: consecutive updateBlock calls for the same block within
 * options.coalesceWindowMs (default 500) count as a single history
 * entry — the first snapshot of the burst is kept, so typing in the
 * properties panel does not flood the buffer.
 *
 * options.onChange — called synchronously after every stack change with
 * { undoCount, redoCount }; the editor uses it to keep its reactive UI
 * counters in sync.
 */

(function (global) {
    "use strict";

    var DEFAULT_HISTORY_KEY = "boxframe.static.history";
    var DEFAULT_MAX_SNAPSHOTS = 50;

    function deepCopy(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function sameState(a, b) {
        if (!a || !b) return false;
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function withHistory(store, options) {
        options = options || {};
        var coalesceWindowMs = options.coalesceWindowMs != null
            ? options.coalesceWindowMs
            : 500;
        var maxSnapshots = options.maxSnapshots != null
            ? options.maxSnapshots
            : DEFAULT_MAX_SNAPSHOTS;
        var storage = options.storage || null;
        var historyKey = options.historyKey || DEFAULT_HISTORY_KEY;

        var history = {
            undoStack: [],
            redoStack: [],
            _lastKey: null,
            _lastTime: 0,
            _state: null, // cached current state { width, height, blocks }
            _pending: null, // persisted record awaiting validation on load

            _seedState: function (data) {
                history._state = deepCopy({
                    width: data.width,
                    height: data.height,
                    blocks: data.blocks || [],
                });
            },

            // Ensure the cached state exists (lazy load if no load() has
            // happened yet — normally the editor's init load seeds it).
            _ensureState: function () {
                if (history._state) return Promise.resolve(history._state);
                return store.load().then(function (data) {
                    history._seedState(data);
                    history._settlePending();
                    return history._state;
                });
            },

            // Validate the persisted record (read at creation) against the
            // freshly loaded state; restore the stacks if they still match.
            _settlePending: function () {
                if (!history._pending) return;
                var record = history._pending;
                history._pending = null;
                if (sameState(record.state, history._state)) {
                    history.undoStack = record.undoStack;
                    history.redoStack = record.redoStack;
                    history._cap(history.undoStack);
                    history._cap(history.redoStack);
                    history._lastKey = record.lastKey || null;
                    history._lastTime = record.lastTime || 0;
                    history._notify();
                } else {
                    // The layout changed since the stacks were saved
                    // (another tab / client / API call) — the snapshots
                    // are stale, drop the record.
                    if (typeof storage.removeItem === "function") {
                        try {
                            storage.removeItem(historyKey);
                        } catch (err) { /* best effort */ }
                    }
                }
            },

            // Save the stacks (and the current state they were built
            // against) so the buffer survives a page reload.
            _persist: function () {
                if (!storage) return;
                try {
                    storage.setItem(historyKey, JSON.stringify({
                        undoStack: history.undoStack,
                        redoStack: history.redoStack,
                        lastKey: history._lastKey,
                        lastTime: history._lastTime,
                        state: history._state,
                    }));
                } catch (err) {
                    // QuotaExceeded / private mode — history keeps working
                    // in memory, it just will not survive a reload.
                    console.warn("Failed to save history to localStorage:", err);
                }
            },

            _cap: function (stack) {
                if (stack.length > maxSnapshots) {
                    stack.splice(0, stack.length - maxSnapshots);
                }
            },

            // Sync the cache with the server after a restore: the batch
            // replace response (fetch store) carries the authoritative
            // block list; local stores return { ok } and the applied
            // snapshot is authoritative.
            _stateAfterRestore: function (applied, result) {
                if (result && Array.isArray(result.blocks)) {
                    history._seedState({
                        width: applied.width,
                        height: applied.height,
                        blocks: result.blocks,
                    });
                } else {
                    history._seedState(applied);
                }
            },

            // Restore a snapshot through the inner store. Local stores
            // expose replaceState(state); the fetch store replaces the
            // block set via the batch endpoint (replaceBlocks).
            _applyState: function (state) {
                if (typeof store.replaceState === "function") {
                    return store.replaceState(state);
                }
                if (typeof store.replaceBlocks === "function") {
                    return store.replaceBlocks(state.blocks);
                }
                return Promise.reject(new Error("Store does not support state restore"));
            },

            _notify: function () {
                if (options.onChange) {
                    options.onChange({
                        undoCount: history.undoStack.length,
                        redoCount: history.redoStack.length,
                    });
                }
            },

            // Record the pre-mutation state. key — coalescing key
            // ("update:<blockId>" for block updates, null otherwise).
            _record: function (key) {
                var now = Date.now();
                if (key && history._lastKey === key &&
                    now - history._lastTime <= coalesceWindowMs &&
                    history.undoStack.length > 0) {
                    // Same block updated again within the window: keep the
                    // first snapshot of the burst (undo reverts to the state
                    // before the burst) and just extend the window.
                    history._lastTime = now;
                    return Promise.resolve();
                }
                return history._ensureState().then(function () {
                    history.undoStack.push(deepCopy(history._state));
                    history._cap(history.undoStack);
                    history.redoStack.length = 0;
                    history._lastKey = key || null;
                    history._lastTime = now;
                    history._notify();
                });
            },

            undo: function () {
                if (history.undoStack.length === 0) return Promise.resolve(null);
                var current = deepCopy(history._state);
                var previous = history.undoStack.pop();
                history.redoStack.push(current);
                history._cap(history.redoStack);
                history._lastKey = null;
                history._notify();
                return history._applyState(previous).then(function (result) {
                    history._stateAfterRestore(previous, result);
                    history._persist();
                    return result;
                });
            },

            redo: function () {
                if (history.redoStack.length === 0) return Promise.resolve(null);
                var current = deepCopy(history._state);
                var next = history.redoStack.pop();
                history.undoStack.push(current);
                history._cap(history.undoStack);
                history._lastKey = null;
                history._notify();
                return history._applyState(next).then(function (result) {
                    history._stateAfterRestore(next, result);
                    history._persist();
                    return result;
                });
            },

            get canUndo() { return history.undoStack.length > 0; },
            get canRedo() { return history.redoStack.length > 0; },
            get undoCount() { return history.undoStack.length; },
            get redoCount() { return history.redoStack.length; },
        };

        // Read the persisted record (if any) — it is validated against
        // the store's current state on the first load() (_settlePending).
        if (storage) {
            var raw = null;
            try {
                raw = storage.getItem(historyKey);
            } catch (err) {
                raw = null; // storage unavailable — in-memory only
            }
            if (raw) {
                var record = null;
                try {
                    record = JSON.parse(raw);
                } catch (err) {
                    record = null; // corrupted — start with empty stacks
                }
                if (record && Array.isArray(record.undoStack) &&
                    Array.isArray(record.redoStack)) {
                    history._pending = record;
                }
            }
        }

        // load() seeds the state cache — the editor calls it on init and
        // after every undo/redo, so the cache tracks the store. It also
        // settles the persisted stacks (validation + restore).
        history.load = function () {
            return store.load().then(function (data) {
                history._seedState(data);
                history._settlePending();
                return data;
            });
        };

        // Wrapped mutations: snapshot first, then delegate to the inner
        // store and sync the cache from the result. The stacks are
        // persisted only after the mutation succeeds, so a failed
        // mutation leaves the saved buffer consistent with the store.
        history.createBlock = function (data) {
            return history._record(null).then(function () {
                return store.createBlock(data).then(function (block) {
                    history._state.blocks.push(deepCopy(block));
                    history._persist();
                    return block;
                });
            });
        };

        history.updateBlock = function (blockId, props) {
            return history._record("update:" + blockId).then(function () {
                return store.updateBlock(blockId, props).then(function (block) {
                    var idx = -1;
                    for (var i = 0; i < history._state.blocks.length; i++) {
                        if (history._state.blocks[i].id === block.id) {
                            idx = i;
                            break;
                        }
                    }
                    if (idx !== -1) history._state.blocks[idx] = deepCopy(block);
                    else history._state.blocks.push(deepCopy(block));
                    history._persist();
                    return block;
                });
            });
        };

        history.deleteBlock = function (blockId) {
            return history._record(null).then(function () {
                return store.deleteBlock(blockId).then(function (result) {
                    history._state.blocks = history._state.blocks.filter(
                        function (b) { return b.id !== blockId; }
                    );
                    history._persist();
                    return result;
                });
            });
        };

        history.clear = function () {
            if (typeof store.clear !== "function") return undefined;
            return history._record(null).then(function () {
                return store.clear().then(function (result) {
                    history._state.blocks = [];
                    history._persist();
                    return result;
                });
            });
        };

        history.replaceState = function (state) {
            return history._record(null).then(function () {
                return history._applyState(state).then(function (result) {
                    history._stateAfterRestore(state, result);
                    history._persist();
                    return result;
                });
            });
        };

        // Pass through everything else (info, render, export, mode, ...).
        Object.keys(store).forEach(function (key) {
            if (key in history) return;
            history[key] = store[key];
        });

        return history;
    }

    global.withHistory = withHistory;

    if (typeof module !== "undefined" && module.exports) {
        module.exports = { withHistory: withHistory };
    }
})(typeof window !== "undefined" ? window : globalThis);
