/**
 * Editor app: manages block state, rendering, and export.
 */

function editorApp() {
    return {
        layoutId: null,
        blocks: [],
        blockTypes: [],
        borderStyles: [],
        rawText: '',
        htmlPreview: '',
        loading: true,
        // Layout dimensions (visual bounds line). Tracked so an import in
        // "add" mode can keep the current bounds instead of the file's.
        layoutWidth: null,
        layoutHeight: null,

        // ── Undo/redo (kept in sync by the history store's onChange) ──
        undoCount: 0,
        redoCount: 0,

        // ── Inline content editing state ────────────────────
        editingBlock: null,    // block being edited (null = editor closed)
        editText: '',          // textarea content while editing

        // ── Selection state ─────────────────────────────────────
        // Multi-selection: the list of selected block ids. The first id is
        // the "primary" block — the properties panel anchors to it and its
        // values seed the panel inputs.
        selectedIds: [],
        pendingBlock: null,    // block under cursor on mousedown (click vs drag)
        pendingToggle: false,  // shift/ctrl+click on a block → toggle on mouseup

        // ── Marquee (rubber-band) selection state ──────────────
        marquee: null,         // { startX, startY, curX, curY, add } in content px
        marqueeEl: null,

        // ── Drag state ──────────────────────────────────────────
        dragMode: null,          // 'palette' | 'pending' | 'move' | 'resize' | 'marquee' | null
        dragType: null,          // block type string (palette drag)
        dragBlock: null,         // block object (move / resize drag)
        dragGroup: false,        // move drag of a whole multi-selection
        dragGroupOriginal: null, // [{id, x, y}] of the selected blocks at drag start
        dragGroupDx: 0,          // committed group delta (grid cells)
        dragGroupDy: 0,
        dragStartX: 0,
        dragStartY: 0,
        dragOffsetX: 0,
        dragOffsetY: 0,
        dragGridX: -1,
        dragGridY: -1,

        // ── Resize state ───────────────────────────────────────
        resizeStartW: 0,         // block (or group bbox) width at resize start
        resizeStartH: 0,         // block (or group bbox) height at resize start
        resizeStartClientX: 0,   // mouse X at resize start (client coords)
        resizeStartClientY: 0,   // mouse Y at resize start (client coords)
        resizePreviewW: 0,       // preview width during drag (grid cells)
        resizePreviewH: 0,       // preview height during drag (grid cells)
        resizeGroup: false,      // resize drag of a whole multi-selection
        resizeOriginal: null,    // [{id, width, height}] of the selected blocks
        resizePreviewX: 0,       // preview origin (grid cells)
        resizePreviewY: 0,

        previewEl: null,
        charWidth: 0,
        charHeight: 0,

        async init() {
            // Web mode: the server-rendered page sets data-layout-id → talk
            // to the API. Static mode (no layout id) → localStorage store
            // (the layout survives page reloads).
            const root = document.querySelector('[data-layout-id]');
            this.layoutId = root?.dataset.layoutId || null;
            // The undo/redo buffer also survives page reloads: the snapshot
            // stacks are persisted to localStorage (scoped per layout in
            // web mode, where several layouts share one browser).
            const historyOptions = {
                onChange: (counts) => {
                    this.undoCount = counts.undoCount;
                    this.redoCount = counts.redoCount;
                },
                storage: typeof localStorage !== "undefined" ? localStorage : null,
            };
            if (this.layoutId) {
                historyOptions.historyKey = "boxframe.history.layout." + this.layoutId;
            }
            this.store = withHistory(this.layoutId
                ? createFetchStore(this.layoutId, root.dataset.projectId)
                : createLocalStorageStore(), historyOptions);

            await Promise.all([
                this.fetchInfo(),
                this.fetchBlocks(),
                this.refreshRender()
            ]);

            // Measure char size AFTER Alpine.js has rendered the .ascii-art
            // layer, then re-render with exact pixel dimensions so overlays
            // align.
            this.$nextTick(() => {
                this._measureCharSize();
                this.refreshRender();
            });

            this._bindGlobalMouseUp();
            this._bindGlobalMouseMove();
            this._bindKeys();
            // Defer binding until Alpine.js has updated the DOM via x-html
            this.$nextTick(() => this._bindResizeHandles());
            this.loading = false;
        },

        // ── Keyboard shortcuts ─────────────────────────────────

        // Global shortcuts. Skipped while a text field has focus so native
        // input editing keeps working (inline content editor, properties
        // panel inputs):
        //   Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — undo / redo
        //   Ctrl+D                          — duplicate the selection
        //   Delete / Backspace              — delete the selection
        //   Escape                          — clear the selection
        //   Arrow keys (Shift = ×10)        — nudge the selection
        _bindKeys() {
            document.addEventListener('keydown', (e) => {
                const t = e.target;
                const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                                      t.tagName === 'SELECT' || t.isContentEditable);

                if ((e.ctrlKey || e.metaKey) && !inField) {
                    const key = e.key.toLowerCase();
                    if (key === 'z') {
                        e.preventDefault();
                        if (e.shiftKey) this.redo();
                        else this.undo();
                        return;
                    }
                    if (key === 'y') {
                        e.preventDefault();
                        this.redo();
                        return;
                    }
                    if (key === 'd') {
                        e.preventDefault();
                        this.duplicateBlock();
                        return;
                    }
                }

                if (inField) return;

                if (e.key === 'Escape') {
                    this.clearSelection();
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    if (this.selectedIds.length) {
                        e.preventDefault();
                        this.deleteSelection();
                    }
                } else if (this.selectedIds.length && e.key.startsWith('Arrow')) {
                    e.preventDefault();
                    const step = e.shiftKey ? 10 : 1;
                    const dx = e.key === 'ArrowLeft' ? -step
                        : e.key === 'ArrowRight' ? step : 0;
                    const dy = e.key === 'ArrowUp' ? -step
                        : e.key === 'ArrowDown' ? step : 0;
                    this._nudgeSelection(dx, dy);
                }
            });
        },

        async undo() {
            if (!this.store.canUndo) return;
            await this.store.undo();
            await this._syncStateFromStore();
        },

        async redo() {
            if (!this.store.canRedo) return;
            await this.store.redo();
            await this._syncStateFromStore();
        },

        // After undo/redo the store is the source of truth — reload the
        // block list and re-render, dropping selection/edit state for
        // blocks that no longer exist.
        async _syncStateFromStore() {
            const data = await this.store.load();
            this.blocks = this._flattenBlocks(data.blocks || []);
            this.layoutWidth = data.width != null ? data.width : null;
            this.layoutHeight = data.height != null ? data.height : null;
            this._reorderBlocks();
            // Drop selected ids of blocks that no longer exist
            this.selectedIds = this.selectedIds.filter(id =>
                this.blocks.some(b => b.id === id));
            if (this.editingBlock && !this.blocks.some(b => b.id === this.editingBlock.id)) {
                this.editingBlock = null;
            }
            await this.refreshRender();
        },

        // ── Char-size measurement ───────────────────────────────

        _measureCharSize() {
            const art = document.querySelector('.canvas-container .ascii-art');
            if (!art) return;
            // Measure character width from a span (getBoundingClientRect works)
            const sample = document.createElement('span');
            sample.style.fontFamily = getComputedStyle(art).fontFamily;
            sample.style.fontSize = getComputedStyle(art).fontSize;
            sample.style.fontWeight = getComputedStyle(art).fontWeight;
            sample.textContent = 'W';
            art.appendChild(sample);
            this.charWidth = sample.getBoundingClientRect().width;
            art.removeChild(sample);
            // Use computed line-height — it's the actual pixel value
            // the browser uses for each row, regardless of how
            // line-height: 1.2 is parsed (unitless vs %).
            const lh = getComputedStyle(art).lineHeight;
            this.charHeight = parseFloat(lh) || 14;
        },

        // ── Pixel → grid conversion ─────────────────────────────
        // Coordinate origin: top-left of .render-wrapper content area.
        // Offset = wrapper padding only (container has no padding now).
        // "Content px" — coordinates in the scrollable canvas content
        // (they scroll with the art, like the block overlays).

        _clientToContent(clientX, clientY) {
            const container = document.querySelector('.canvas-container');
            if (!container) return { x: 0, y: 0 };
            const rect = container.getBoundingClientRect();
            // The canvas may be scrolled — account for the scroll offset so
            // the mapping stays correct when the art is scrolled under the
            // cursor (or the cursor is outside the visible area).
            return {
                x: clientX - rect.left + container.scrollLeft,
                y: clientY - rect.top + container.scrollTop,
            };
        },

        _pixelToGrid(px, py) {
            if (!this.charWidth) return { x: 0, y: 0 };
            const c = this._clientToContent(px, py);
            const pad = 16; // wrapper padding only
            const gx = Math.max(0, (c.x - pad) / this.charWidth);
            const gy = Math.max(0, (c.y - pad) / this.charHeight);
            // Blocks may be placed outside the layout bounds — the canvas
            // origin (0,0) is the only hard limit; there is no upper limit.
            return { x: Math.floor(gx), y: Math.floor(gy) };
        },

        _contentToGrid(cx, cy) {
            if (!this.charWidth) return { x: 0, y: 0 };
            const pad = 16;
            return {
                x: Math.max(0, (cx - pad) / this.charWidth),
                y: Math.max(0, (cy - pad) / this.charHeight),
            };
        },

        // ── Container (nesting) geometry ───────────────────────
        // this.blocks is a flat list: children carry coordinates RELATIVE
        // to their parent. The renderer places a child at the parent's
        // origin + 1-cell padding + the child's relative offset, so every
        // geometry check (hit-test, selection, overlays) must work in
        // absolute (canvas) coordinates.

        // Absolute (canvas) rectangle of a block — walks up the parent
        // chain, adding the 1-cell container padding at each level.
        _absoluteRect(block) {
            let x = block.x;
            let y = block.y;
            let pid = block.parent_id;
            while (pid) {
                const parent = this.blocks.find(b => b.id === pid);
                if (!parent) break;
                x = parent.x + 1 + x;
                y = parent.y + 1 + y;
                pid = parent.parent_id;
            }
            return { x, y, width: block.width, height: block.height };
        },

        // Convert an absolute (canvas) position to the relative position
        // inside the given parent (the 1-cell container padding is removed).
        _absToRel(absX, absY, parent) {
            const pr = this._absoluteRect(parent);
            return { x: absX - (pr.x + 1), y: absY - (pr.y + 1) };
        },

        // Ids of a block and all of its descendants (BFS over the flat list).
        _subtreeIds(blockId) {
            const ids = [blockId];
            for (let i = 0; i < ids.length; i++) {
                const current = ids[i];
                for (const b of this.blocks) {
                    if (b.parent_id === current) ids.push(b.id);
                }
            }
            return ids;
        },

        // Number of ancestors of a block (root = 0).
        _depth(blockId) {
            let d = 0;
            let pid = (this.blocks.find(b => b.id === blockId) || {}).parent_id;
            while (pid) {
                d++;
                pid = (this.blocks.find(b => b.id === pid) || {}).parent_id;
            }
            return d;
        },

        // The container (box) that a point falls into: the innermost box
        // whose absolute area contains the point. excludeIds — block ids to
        // ignore (the dragged block's own subtree, so a box cannot be
        // dropped into itself or its descendants — that would be a cycle).
        _findDropContainer(cx, cy, excludeIds) {
            const candidates = this.blocks.filter(b => {
                if (b.block_type !== 'box') return false;
                if (excludeIds && excludeIds.includes(b.id)) return false;
                const r = this._absoluteRect(b);
                return cx >= r.x && cy >= r.y &&
                    cx < r.x + r.width && cy < r.y + r.height;
            });
            if (!candidates.length) return null;
            // Innermost = the candidate with the most ancestors
            let best = candidates[0];
            let bestDepth = this._depth(best.id);
            for (const c of candidates) {
                const d = this._depth(c.id);
                if (d > bestDepth) { best = c; bestDepth = d; }
            }
            return best;
        },

        // ── Preview overlay ─────────────────────────────────────

        _showPreview(gx, gy) {
            this.dragGridX = gx;
            this.dragGridY = gy;
            if (this.previewEl) {
                // padding_offset matches .render-wrapper padding (16px) so the
                // drag preview aligns with server-rendered block overlays.
                const pad = 16;
                this.previewEl.style.left = (pad + gx * this.charWidth) + 'px';
                this.previewEl.style.top = (pad + gy * this.charHeight) + 'px';
            }
        },

        _ensurePreviewEl() {
            if (this.previewEl) return this.previewEl;
            const container = document.querySelector('.canvas-container');
            if (!container) return null;
            const el = document.createElement('div');
            el.className = 'drag-preview';
            el.style.position = 'absolute';
            el.style.pointerEvents = 'none';
            el.style.width = (20 * this.charWidth) + 'px';
            el.style.height = (3 * this.charHeight) + 'px';
            el.style.border = '2px dashed #e94560';
            el.style.borderRadius = '4px';
            el.style.background = 'rgba(233, 69, 96, 0.15)';
            el.style.display = 'none';
            const overlay = container.querySelector('.canvas-drag-overlay');
            if (overlay) {
                overlay.appendChild(el);
                this.previewEl = el;
            }
            return el;
        },

        _hidePreview() {
            if (this.previewEl) {
                this.previewEl.style.display = 'none';
            }
        },

        _setPreviewMode(mode) {
            if (!this.previewEl) return;
            if (mode === 'resize') {
                this.previewEl.style.border = '2px solid #2ecc71';
                this.previewEl.style.background = 'rgba(46, 204, 113, 0.15)';
            } else {
                this.previewEl.style.border = '2px dashed #e94560';
                this.previewEl.style.background = 'rgba(233, 69, 96, 0.15)';
            }
        },

        // ── Marquee (rubber-band) selection ─────────────────────

        _ensureMarqueeEl() {
            if (this.marqueeEl) return this.marqueeEl;
            const overlay = document.querySelector('.canvas-container .canvas-drag-overlay');
            if (!overlay) return null;
            const el = document.createElement('div');
            el.className = 'marquee';
            el.style.display = 'none';
            overlay.appendChild(el);
            this.marqueeEl = el;
            return el;
        },

        _updateMarquee() {
            const m = this.marquee;
            const el = this.marqueeEl;
            if (!m || !el) return;
            el.style.left = Math.min(m.startX, m.curX) + 'px';
            el.style.top = Math.min(m.startY, m.curY) + 'px';
            el.style.width = Math.abs(m.curX - m.startX) + 'px';
            el.style.height = Math.abs(m.curY - m.startY) + 'px';
            el.style.display = 'block';
        },

        _hideMarquee() {
            if (this.marqueeEl) {
                this.marqueeEl.style.display = 'none';
            }
        },

        // The marquee rectangle in (fractional) grid coordinates.
        _marqueeGridRect() {
            const m = this.marquee;
            const a = this._contentToGrid(Math.min(m.startX, m.curX), Math.min(m.startY, m.curY));
            const b = this._contentToGrid(Math.max(m.startX, m.curX), Math.max(m.startY, m.curY));
            return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
        },

        // Blocks fully inside the marquee rectangle (partial overlap
        // does not select). The marquee rect is in absolute (canvas)
        // coordinates, so compare against each block's absolute rect.
        _marqueeHits() {
            const r = this._marqueeGridRect();
            return this.blocks.filter(bl => {
                const ar = this._absoluteRect(bl);
                return ar.x >= r.x1 && ar.y >= r.y1 &&
                    ar.x + ar.width <= r.x2 && ar.y + ar.height <= r.y2;
            });
        },

        // ── Global mouse-up (catches drops outside canvas) ──────

        _bindGlobalMouseUp() {
            document.addEventListener('mouseup', () => this._onGlobalMouseUp());
        },

        // ── Global mouse-move (drag continues outside the canvas) ──
        // Bound on document so a move/resize drag keeps tracking when the
        // cursor leaves the canvas — blocks may be placed past the right
        // and bottom edge of the visible area.

        _bindGlobalMouseMove() {
            document.addEventListener('mousemove', (e) => this._onGlobalMouseMove(e));
        },

        _onGlobalMouseMove(e) {
            if (!this.dragMode) return;
            this._autoScrollCanvas(e);
            this.onCanvasMouseMove(e);
        },

        // Edge auto-scroll: while dragging near the canvas edge, scroll the
        // canvas so the drag target stays visible.
        _autoScrollCanvas(e) {
            const container = document.querySelector('.canvas-container');
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const margin = 40;
            const maxStep = 16;

            if (e.clientX > rect.right - margin &&
                container.scrollLeft + container.clientWidth < container.scrollWidth) {
                const over = (e.clientX - (rect.right - margin)) / margin;
                container.scrollLeft += Math.min(maxStep, over * maxStep);
            } else if (e.clientX < rect.left + margin && container.scrollLeft > 0) {
                const over = ((rect.left + margin) - e.clientX) / margin;
                container.scrollLeft -= Math.min(maxStep, over * maxStep);
            }

            if (e.clientY > rect.bottom - margin &&
                container.scrollTop + container.clientHeight < container.scrollHeight) {
                const over = (e.clientY - (rect.bottom - margin)) / margin;
                container.scrollTop += Math.min(maxStep, over * maxStep);
            } else if (e.clientY < rect.top + margin && container.scrollTop > 0) {
                const over = ((rect.top + margin) - e.clientY) / margin;
                container.scrollTop -= Math.min(maxStep, over * maxStep);
            }
        },

        _onGlobalMouseUp() {
            if (!this.dragMode) return;

            if (this.dragMode === 'pending') {
                // Mouse didn't move past the threshold: it's a click, not a drag.
                if (this.pendingToggle && this.pendingBlock) {
                    // Shift/Ctrl+click on a block → toggle it in the selection
                    this.toggleSelect(this.pendingBlock.id);
                } else if (this.pendingBlock) {
                    // Plain click on a block → select it alone
                    this.selectBlock(this.pendingBlock.id);
                } else {
                    this.clearSelection();
                }
                this._clearDragState();
                return;
            }

            if (this.dragMode === 'marquee' && this.marquee) {
                const m = this.marquee;
                const moved = Math.hypot(m.curX - m.startX, m.curY - m.startY) > 3;
                if (moved) {
                    const hits = this._marqueeHits().map(b => b.id);
                    if (m.add) {
                        // Shift+marquee: add to the current selection
                        const merged = this.selectedIds.slice();
                        for (const id of hits) {
                            if (!merged.includes(id)) merged.push(id);
                        }
                        this.selectedIds = merged;
                    } else {
                        this.selectedIds = hits;
                    }
                    this._markSelectedPreviews();
                } else if (!m.add) {
                    // A plain click on empty canvas clears the selection
                    this.clearSelection();
                }
                this._clearDragState();
                return;
            }

            if (this.dragMode === 'move' && this.dragBlock) {
                if (this.dragGroup) {
                    this._commitGroupMove();
                } else if (this.dragGridX >= 0) {
                    this._commitBlockMove();
                }
            }

            if (this.dragMode === 'resize' && this.dragBlock) {
                this._commitBlockResize();
            }

            this._clearDragState();
        },

        _clearDragState() {
            this.dragMode = null;
            this.dragType = null;
            this.dragBlock = null;
            this.dragGroup = false;
            this.dragGroupOriginal = null;
            this.dragGroupDx = 0;
            this.dragGroupDy = 0;
            this.resizeGroup = false;
            this.resizeOriginal = null;
            this.pendingBlock = null;
            this.pendingToggle = false;
            this.marquee = null;
            this._hidePreview();
            this.previewEl = null;
            this._hideMarquee();
        },

        // ── Resize handle binding ───────────────────────────────

        _bindResizeHandles() {
            const canvas = document.querySelector('.canvas-container');
            if (!canvas) return;
            const previews = canvas.querySelectorAll('.block-preview');
            console.log('[editor] Found', previews.length, 'block previews');
            previews.forEach(preview => {
                const handle = preview.querySelector('.resize-handle');
                if (!handle) return;

                // Remove old listener by cloning (preserves other listeners)
                const newHandle = handle.cloneNode(true);
                handle.parentNode.replaceChild(newHandle, handle);
                newHandle.addEventListener('mousedown', (e) => this.onResizeHandleMouseDown(e));

                // JS-based hover: toggle .visible class on resize handle.
                // A selected block shows the selection frame's own handle,
                // so suppress the hover handle to avoid a double icon.
                preview.addEventListener('mouseenter', () => {
                    if (this.selectedIds.includes(preview.dataset.blockId)) return;
                    newHandle.classList.add('visible');
                });
                preview.addEventListener('mouseleave', () => {
                    newHandle.classList.remove('visible');
                });
            });
        },

        onResizeHandleMouseDown(e) {
            if (e.button !== 0) return;

            const blockPreview = e.target.closest('.block-preview');
            if (!blockPreview) return;

            const block = this.blocks.find(b => b.id === blockPreview.dataset.blockId);
            if (!block) return;

            // Hover-resize selects the block first — the selection frame
            // takes over the handle from here on.
            this.selectBlock(block.id);
            this._startResizeDrag(e);
        },

        // Resize handle on the selection frame (visible while a block is
        // selected, no hover needed). For a multi-selection the frame is
        // the group's bounding box — the handle resizes the whole group.
        onSelectionResizeMouseDown(e) {
            if (e.button !== 0) return;

            if (!this.selectedBlock) return;

            this._startResizeDrag(e);
        },

        _startResizeDrag(e) {
            const sel = this.selectedBlocks;
            if (!sel.length) return;
            const block = sel[0];

            this.dragMode = 'resize';
            this.dragBlock = block;
            this.resizeGroup = sel.length > 1;
            if (this.resizeGroup) {
                // Group bbox: the preview tracks the bounding box, each
                // block is resized by the same delta on commit.
                this.resizeOriginal = sel.map(b => ({ id: b.id, width: b.width, height: b.height }));
                // Absolute (canvas) coords — children carry relative coords
                const rects = sel.map(b => this._absoluteRect(b));
                const minX = Math.min(...rects.map(r => r.x));
                const minY = Math.min(...rects.map(r => r.y));
                this.resizePreviewX = minX;
                this.resizePreviewY = minY;
                this.resizeStartW = Math.max(...rects.map(r => r.x + r.width)) - minX;
                this.resizeStartH = Math.max(...rects.map(r => r.y + r.height)) - minY;
            } else {
                const r = this._absoluteRect(block);
                this.resizePreviewX = r.x;
                this.resizePreviewY = r.y;
                this.resizeStartW = block.width;
                this.resizeStartH = block.height;
            }
            this.resizeStartClientX = e.clientX;
            this.resizeStartClientY = e.clientY;
            this.resizePreviewW = this.resizeStartW;
            this.resizePreviewH = this.resizeStartH;

            if (!this.charWidth) {
                this._measureCharSize();
            }

            const preview = this._ensurePreviewEl();
            if (preview) {
                preview.style.width = (this.resizeStartW * this.charWidth) + 'px';
                preview.style.height = (this.resizeStartH * this.charHeight) + 'px';
                preview.style.display = 'block';
                this._setPreviewMode('resize');
                this._showPreview(this.resizePreviewX, this.resizePreviewY);
            }

            e.preventDefault();
            e.stopPropagation();
        },

        // ── Palette drag ────────────────────────────────────────

        onPaletteDragStart(e) {
            this.dragMode = 'palette';
            this.dragType = e.target.closest('.palette-btn')?.dataset?.blockType;
            if (!this.dragType) {
                this.dragMode = null;
                return;
            }
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', this.dragType);
            // Delay visual so the button doesn't look "dragging"
            requestAnimationFrame(() => {
                if (e.target.closest('.palette-btn')) {
                    e.target.closest('.palette-btn').style.opacity = '0.5';
                }
            });
        },

        onPaletteDragEnd(e) {
            const btn = e.target.closest('.palette-btn');
            if (btn) btn.style.opacity = '';
            if (this.dragMode === 'palette') {
                this._clearDragState();
            }
        },

        onCanvasDragOver(e) {
            if (this.dragMode === 'palette') {
                e.currentTarget.classList.add('drag-over');
            }
        },

        onCanvasDragLeave(e) {
            e.currentTarget.classList.remove('drag-over');
        },

        // ── Canvas drop (palette → new block) ───────────────────

    onCanvasDrop(e) {
            e.preventDefault();
            if (this.dragMode !== 'palette' || !this.dragType) return;

            const pos = this._pixelToGrid(e.clientX, e.clientY);
            const defaults = this._blockDefaults(this.dragType);
            const w = defaults.width;
            const h = defaults.height;

            const maxOrder = this.blocks.length > 0
                ? Math.max(...this.blocks.map(b => b.order))
                : 0;

            // Drop into a box: the new block becomes the box's child with
            // coordinates relative to it. The target is the innermost box
            // whose absolute area contains the block's center. Otherwise the
            // block lands on the canvas (absolute coordinates).
            const cx = pos.x + w / 2;
            const cy = pos.y + h / 2;
            const container = this._findDropContainer(cx, cy, null);

            const payload = {
                block_type: this.dragType,
                width: w,
                height: h,
                content: defaults.content,
                order: maxOrder + 1,
            };
            if (container) {
                const rel = this._absToRel(pos.x, pos.y, container);
                payload.x = rel.x;
                payload.y = rel.y;
                payload.parent_id = container.id;
            } else {
                payload.x = pos.x;
                payload.y = pos.y;
            }

            this.store.createBlock(payload).then(block => {
                this.blocks.push(block);
                this._reorderBlocks();
                this.refreshRender();
            });

            this._clearDragState();
        },

        // ── Canvas mouse drag (move existing block) ─────────────

        onCanvasMouseDown(e) {
            // Only left button
            if (e.button !== 0) return;

            // Ignore clicks inside the inline content editor
            if (e.target.closest('.block-edit-overlay')) return;

            // Ignore clicks on the selection frame icons — the icon sits at the
            // block corner (half outside it), so the cursor maps to a grid cell
            // outside the block and would clear the selection on mouseup.
            if (e.target.closest('.block-selection')) return;

            // Ignore clicks inside the floating properties panel
            if (e.target.closest('.block-props')) return;

            // Find the topmost block whose ABSOLUTE area contains the cursor
            // (this.blocks is sorted by order descending; children carry
            // relative coords, so hit-test in canvas coordinates)
            const pos = this._pixelToGrid(e.clientX, e.clientY);
            const block = this.blocks.find(b => {
                const r = this._absoluteRect(b);
                return pos.x >= r.x && pos.y >= r.y &&
                    pos.x < r.x + r.width && pos.y < r.y + r.height;
            });

            if (block) {
                // Pending: becomes a move-drag if the mouse moves past a
                // threshold, or a select/toggle click if it doesn't.
                const r = this._absoluteRect(block);
                this.dragMode = 'pending';
                this.pendingBlock = block;
                this.pendingToggle = e.shiftKey || e.ctrlKey || e.metaKey;
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                this.dragOffsetX = pos.x - r.x;
                this.dragOffsetY = pos.y - r.y;
                this.dragGridX = r.x;
                this.dragGridY = r.y;
                e.preventDefault();
                return;
            }

            // Empty canvas: marquee (rubber-band) selection.
            // Shift = add to the current selection.
            const c = this._clientToContent(e.clientX, e.clientY);
            this.dragMode = 'marquee';
            this.marquee = { startX: c.x, startY: c.y, curX: c.x, curY: c.y, add: e.shiftKey };
            this._ensureMarqueeEl();
            e.preventDefault();
        },

        onCanvasMouseMove(e) {
            if (this.dragMode === 'marquee' && this.marquee) {
                const c = this._clientToContent(e.clientX, e.clientY);
                this.marquee.curX = c.x;
                this.marquee.curY = c.y;
                if (Math.hypot(c.x - this.marquee.startX, c.y - this.marquee.startY) > 3) {
                    this._updateMarquee();
                }
                e.preventDefault();
                return;
            }

            if (this.dragMode === 'pending') {
                const dx = e.clientX - this.dragStartX;
                const dy = e.clientY - this.dragStartY;
                if (this.pendingBlock && !this.pendingToggle && Math.hypot(dx, dy) > 3) {
                    // Mouse moved past the click threshold: start the move-drag
                    this.dragMode = 'move';
                    this.dragBlock = this.pendingBlock;

                    // Dragging a block that is part of a multi-selection
                    // moves the whole selection (relative offsets kept).
                    this.dragGroup = this.selectedIds.length > 1 &&
                        this.selectedIds.includes(this.dragBlock.id);
                    if (this.dragGroup) {
                        this.dragGroupOriginal = this.selectedBlocks.map(b => ({
                            id: b.id, x: b.x, y: b.y,
                        }));
                    } else {
                        // Selecting a single block on drag start
                        this.selectBlock(this.dragBlock.id);
                        const preview = this._ensurePreviewEl();
                        if (preview) {
                            preview.style.width = (this.dragBlock.width * this.charWidth) + 'px';
                            preview.style.height = (this.dragBlock.height * this.charHeight) + 'px';
                            preview.style.display = 'block';
                            const r = this._absoluteRect(this.dragBlock);
                            this._showPreview(r.x, r.y);
                        }
                    }
                }
                return;
            }

            if (this.dragMode === 'move' && this.dragBlock) {
                const pos = this._pixelToGrid(e.clientX, e.clientY);
                // No layout-bounds clamping — blocks may be placed outside
                // the layout; only the canvas origin (0,0) is a hard limit.
                const gx = Math.max(0, pos.x - this.dragOffsetX);
                const gy = Math.max(0, pos.y - this.dragOffsetY);
                this.dragGridX = gx;
                this.dragGridY = gy;

                if (this.dragGroup) {
                    // Group move: shift every selected block by the same
                    // delta, clamped so no block crosses the canvas origin.
                    const orig = this.dragGroupOriginal.find(o => o.id === this.dragBlock.id);
                    let dx = gx - orig.x;
                    let dy = gy - orig.y;
                    const minX = Math.min(...this.dragGroupOriginal.map(o => o.x));
                    const minY = Math.min(...this.dragGroupOriginal.map(o => o.y));
                    dx = Math.max(dx, -minX);
                    dy = Math.max(dy, -minY);
                    this.dragGroupDx = dx;
                    this.dragGroupDy = dy;
                    this._applyGroupTransform(dx, dy);
                } else {
                    this._showPreview(gx, gy);
                }
                e.preventDefault();
                return;
            }

            if (this.dragMode === 'resize' && this.dragBlock) {
                const dx = e.clientX - this.resizeStartClientX;
                const dy = e.clientY - this.resizeStartClientY;
                const gridDx = dx / this.charWidth;
                const gridDy = dy / this.charHeight;

                let newW = this.resizeStartW + gridDx;
                let newH = this.resizeStartH + gridDy;

                // Snap to grid (0.5 char threshold)
                newW = Math.round(newW * 2) / 2;
                newH = Math.round(newH * 2) / 2;

                if (this.resizeGroup) {
                    // Group resize: the bounding box grows; per-block
                    // minimums and line thickness are applied on commit.
                    this.resizePreviewW = Math.max(1, newW);
                    this.resizePreviewH = Math.max(1, newH);
                } else {
                    // Lines are always 1 cell thick — the thin dimension is fixed
                    if (this.dragBlock.block_type === 'hline') newH = 1;
                    if (this.dragBlock.block_type === 'vline') newW = 1;

                    // Clamp to minimum size only — blocks may extend beyond
                    // the layout bounds. Buttons support height 1 ([label]).
                    const minW = this.dragBlock.block_type === 'vline' ? 1 : 2;
                    const minH = (this.dragBlock.block_type === 'hline' || this.dragBlock.block_type === 'button') ? 1 : 2;
                    newW = Math.max(minW, newW);
                    newH = Math.max(minH, newH);
                    this.resizePreviewW = newW;
                    this.resizePreviewH = newH;
                }

                // Update preview dimensions
                if (this.previewEl) {
                    this.previewEl.style.width = (this.resizePreviewW * this.charWidth) + 'px';
                    this.previewEl.style.height = (this.resizePreviewH * this.charHeight) + 'px';
                }

                e.preventDefault();
                e.stopPropagation();
            }
        },

        // Live group-move feedback: shift the selected blocks' DOM overlays
        // by the drag delta (the real move is committed on mouseup).
        _applyGroupTransform(dx, dy) {
            const canvas = document.querySelector('.canvas-container');
            if (!canvas) return;
            const t = (dx === 0 && dy === 0)
                ? ''
                : 'translate(' + (dx * this.charWidth) + 'px, ' + (dy * this.charHeight) + 'px)';
            for (const id of this.selectedIds) {
                const el = canvas.querySelector('.block-preview[data-block-id="' + id + '"]');
                if (el) el.style.transform = t;
            }
        },

        // ── Inline content editing (double-click a block) ─────

        get editOverlayStyle() {
            if (!this.editingBlock) return 'display:none';
            const pad = 16; // matches .render-wrapper padding
            const b = this.editingBlock;
            const r = this._absoluteRect(b);
            return (
                `left:${pad + r.x * this.charWidth}px;` +
                `top:${pad + r.y * this.charHeight}px;` +
                `width:${b.width * this.charWidth}px;` +
                `height:${b.height * this.charHeight}px;`
            );
        },

        onCanvasDblClick(e) {
            if (e.target.closest('.resize-handle')) return;
            if (e.target.closest('.sel-resize')) return;
            if (e.target.closest('.block-edit-overlay')) return;
            if (e.target.closest('.block-props')) return;

            // Commit the in-progress edit before switching blocks
            if (this.editingBlock) {
                this._commitEdit();
            }

            const pos = this._pixelToGrid(e.clientX, e.clientY);
            const block = this.blocks.find(b => {
                const r = this._absoluteRect(b);
                return pos.x >= r.x && pos.y >= r.y &&
                    pos.x < r.x + r.width && pos.y < r.y + r.height;
            });
            if (!block) return;

            // Clear move-drag state left over from the preceding mousedowns
            this._clearDragState();
            this.editingBlock = block;
            this.editText = block.content || '';
            this.$nextTick(() => {
                const ta = this.$refs.editInput;
                if (ta) {
                    ta.focus();
                    ta.select();
                }
            });
            e.preventDefault();
        },

        saveBlockContent() {
            this._commitEdit();
        },

        cancelBlockEdit() {
            this.editingBlock = null;
        },

        onEditKeydown(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.saveBlockContent();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                this.cancelBlockEdit();
            }
        },

        async _commitEdit() {
            const block = this.editingBlock;
            if (!block) return;
            const newContent = this.editText;
            this.editingBlock = null;
            if (newContent === block.content) return;

            try {
                await this.store.updateBlock(block.id, { content: newContent });
                block.content = newContent;
                await this.refreshRender();
            } catch (err) {
                // Reopen the editor so the user can retry
                console.error('Failed to save block content:', err);
                this.editingBlock = block;
                this.editText = newContent;
            }
        },

        async _commitBlockMove() {
            if (!this.dragBlock || this.dragGridX < 0) return;
            const block = this.dragBlock;
            const old = { x: block.x, y: block.y, parent_id: block.parent_id };

            // dragGridX/Y is the block's new ABSOLUTE (canvas) top-left.
            // The drop container is the innermost box whose absolute area
            // contains the block's center — excluding the block's own
            // subtree so a box cannot be dropped into itself (a cycle).
            const cx = this.dragGridX + block.width / 2;
            const cy = this.dragGridY + block.height / 2;
            const container = this._findDropContainer(
                cx, cy, this._subtreeIds(block.id)
            );

            let props;
            if (container) {
                // (Re-)parent into the box: convert to relative coordinates
                const rel = this._absToRel(this.dragGridX, this.dragGridY, container);
                props = { x: rel.x, y: rel.y, parent_id: container.id };
            } else if (block.parent_id) {
                // Dragged out of its container onto the canvas → back to root
                props = { x: this.dragGridX, y: this.dragGridY, parent_id: null };
            } else {
                props = { x: this.dragGridX, y: this.dragGridY };
            }

            try {
                const updated = await this.store.updateBlock(block.id, props);
                Object.assign(block, updated);
                await this.refreshRender();
            } catch (err) {
                // Rollback on error
                Object.assign(block, old);
                console.error('Failed to move block:', err);
            }
        },

        // Commit a group move: one batch update for all selected blocks,
        // so the whole move is a single undo step.
        async _commitGroupMove() {
            const dx = this.dragGroupDx;
            const dy = this.dragGroupDy;
            if (!this.dragGroupOriginal || (dx === 0 && dy === 0)) return;

            const updates = this.dragGroupOriginal.map(o => ({
                id: o.id, x: o.x + dx, y: o.y + dy,
            }));
            try {
                const result = await this.store.batchBlocks({ update: updates });
                this._applyBatchResult(result);
                await this.refreshRender();
            } catch (err) {
                // The local state was not modified — drop the visual offset
                this._applyGroupTransform(0, 0);
                console.error('Failed to move blocks:', err);
            }
        },

        // Merge a batchBlocks result into the local block list.
        _applyBatchResult(result) {
            const byId = {};
            for (const b of (result.updated || [])) byId[b.id] = b;
            for (const b of this.blocks) {
                if (byId[b.id]) Object.assign(b, byId[b.id]);
            }
            for (const b of (result.created || [])) {
                this.blocks.push(b);
            }
        },

        async _commitBlockResize() {
            if (!this.dragBlock) return;

            // Calculate new dimensions from preview
            const newW = Math.round(this.resizePreviewW);
            const newH = Math.round(this.resizePreviewH);

            if (this.resizeGroup) {
                // Group resize: every selected block grows by the same
                // delta, clamped to its own minimums (lines stay 1 cell
                // thick). One batch update = one undo step.
                const dw = newW - this.resizeStartW;
                const dh = newH - this.resizeStartH;
                if (dw === 0 && dh === 0) return;

                const updates = [];
                for (const o of this.resizeOriginal) {
                    const b = this.blocks.find(bl => bl.id === o.id);
                    if (!b) continue;
                    const minW = b.block_type === 'vline' ? 1 : 2;
                    const minH = (b.block_type === 'hline' || b.block_type === 'button') ? 1 : 2;
                    let w = Math.max(minW, o.width + dw);
                    let h = Math.max(minH, o.height + dh);
                    if (b.block_type === 'hline') h = 1;
                    if (b.block_type === 'vline') w = 1;
                    if (w === o.width && h === o.height) continue;
                    updates.push({ id: o.id, width: w, height: h });
                }
                if (!updates.length) return;

                try {
                    const result = await this.store.batchBlocks({ update: updates });
                    this._applyBatchResult(result);
                    await this.refreshRender();
                } catch (err) {
                    console.error('Failed to resize blocks:', err);
                }
                return;
            }

            const block = this.dragBlock;
            const oldW = block.width;
            const oldH = block.height;

            // Minimum size: 2x2; lines are always 1 cell thick;
            // buttons support height 1 ([label])
            const minW = block.block_type === 'vline' ? 1 : 2;
            const minH = (block.block_type === 'hline' || block.block_type === 'button') ? 1 : 2;
            let clampedW = Math.max(minW, newW);
            let clampedH = Math.max(minH, newH);
            if (block.block_type === 'hline') clampedH = 1;
            if (block.block_type === 'vline') clampedW = 1;

            if (clampedW === oldW && clampedH === oldH) {
                return; // No change
            }

            try {
                const updated = await this.store.updateBlock(block.id, {
                    width: clampedW, height: clampedH
                });
                Object.assign(block, updated);
                await this.refreshRender();
            } catch (err) {
                block.width = oldW;
                block.height = oldH;
                console.error('Failed to resize block:', err);
            }
        },

        async fetchInfo() {
            const data = await this.store.info();
            this.blockTypes = data.block_types || [];
            this.borderStyles = data.border_styles || [];
        },

        _blockDefaults(type) {
            if (type === 'button') return { width: 16, height: 1, content: 'Button' };
            if (type === 'hline') return { width: 20, height: 1, content: '' };
            if (type === 'vline') return { width: 1, height: 5, content: '' };
            return { width: 20, height: 3, content: `[${type}]` };
        },

        async fetchBlocks() {
            // Load all blocks for this layout
            const data = await this.store.load();
            // Blocks are nested in the layout response
            this.blocks = this._flattenBlocks(data.blocks || []);
            this.layoutWidth = data.width != null ? data.width : null;
            this.layoutHeight = data.height != null ? data.height : null;
            this._reorderBlocks();
        },

        _flattenBlocks(blocks) {
            const flat = [];
            for (const b of blocks) {
                flat.push(b);
                if (b.children) {
                    flat.push(...this._flattenBlocks(b.children));
                }
            }
            return flat;
        },

        _reorderBlocks() {
            // Sort blocks by order descending — highest order (top layer) first
            this.blocks.sort((a, b) => b.order - a.order);
        },

        get maxOrder() {
            if (this.blocks.length === 0) return 0;
            return Math.max(...this.blocks.map(b => b.order));
        },

        async moveBlockOrder(blockId, delta) {
            const block = this.blocks.find(b => b.id === blockId);
            if (!block) return;

            const oldOrder = block.order;
            const newOrder = block.order + delta;
            if (newOrder < 0) return;

            // Find another block at the target order to swap with
            const other = this.blocks.find(b => b.id !== blockId && b.order === newOrder);
            if (other) {
                // Swap orders
                const temp = other.order;
                other.order = block.order;
                block.order = temp;
            } else {
                block.order = newOrder;
            }

            try {
                await this.store.updateBlock(blockId, { order: block.order });
                // Re-sort list so position reflects z-order
                this._reorderBlocks();
                await this.refreshRender();
            } catch (err) {
                // Rollback on error
                block.order = oldOrder;
                if (other) {
                    other.order = newOrder;
                }
                console.error('Failed to move block order:', err);
            }
        },

        // ── Selection (single + multi) ─────────────────────────

        selectBlock(blockId) {
            this.selectedIds = [blockId];
            this._markSelectedPreviews();
        },

        toggleSelect(blockId) {
            const i = this.selectedIds.indexOf(blockId);
            if (i === -1) this.selectedIds.push(blockId);
            else this.selectedIds.splice(i, 1);
            this._markSelectedPreviews();
        },

        clearSelection() {
            this.selectedIds = [];
            this._markSelectedPreviews();
        },

        // Sidebar list item click: plain = select alone,
        // shift/ctrl = toggle in the multi-selection.
        onListItemClick(e, blockId) {
            if (e.shiftKey || e.ctrlKey || e.metaKey) this.toggleSelect(blockId);
            else this.selectBlock(blockId);
        },

        get selectedBlocks() {
            const sel = [];
            for (const id of this.selectedIds) {
                const b = this.blocks.find(bl => bl.id === id);
                if (b) sel.push(b);
            }
            return sel;
        },

        get selectedBlock() {
            return this.selectedBlocks[0] || null;
        },

        get isMultiSelect() {
            return this.selectedIds.length > 1;
        },

        // Panel header: the block type for a single selection,
        // the count for a multi-selection.
        get panelTitle() {
            const sel = this.selectedBlocks;
            if (sel.length === 1) return sel[0].block_type;
            if (sel.length > 1) return sel.length + ' selected';
            return '';
        },

        // Line Style button state: active when every selected block
        // already has that style.
        styleActive(style) {
            const sel = this.selectedBlocks;
            return sel.length > 0 && sel.every(b => b.border_style === style);
        },

        // The selection frame: the block itself for a single selection,
        // the bounding box of all selected blocks for a multi-selection.
        get selectionStyle() {
            const sel = this.selectedBlocks;
            if (!sel.length) return 'display:none';
            const pad = 16; // matches .render-wrapper padding
            // Absolute (canvas) coords — children carry relative coords
            const rects = sel.map(b => this._absoluteRect(b));
            const x = Math.min(...rects.map(r => r.x));
            const y = Math.min(...rects.map(r => r.y));
            const w = Math.max(...rects.map(r => r.x + r.width)) - x;
            const h = Math.max(...rects.map(r => r.y + r.height)) - y;
            return (
                `left:${pad + x * this.charWidth}px;` +
                `top:${pad + y * this.charHeight}px;` +
                `width:${w * this.charWidth}px;` +
                `height:${h * this.charHeight}px;`
            );
        },

        // Position of the floating properties panel: next to the selection
        // (right side preferred, left as fallback, below as last resort)
        get propsPanelStyle() {
            const sel = this.selectedBlocks;
            if (!sel.length) return 'display:none';
            const pad = 16; // matches .render-wrapper padding
            const container = document.querySelector('.canvas-container');
            const panelW = 264;
            const panelH = 300; // approximate height, for vertical clamping

            // Absolute (canvas) coords — children carry relative coords
            const rects = sel.map(b => this._absoluteRect(b));
            const bx = Math.min(...rects.map(r => r.x));
            const by = Math.min(...rects.map(r => r.y));
            const bw = Math.max(...rects.map(r => r.x + r.width)) - bx;
            const bh = Math.max(...rects.map(r => r.y + r.height)) - by;

            const bxPx = pad + bx * this.charWidth;
            const byPx = pad + by * this.charHeight;
            const bwPx = bw * this.charWidth;
            const bhPx = bh * this.charHeight;

            let left, top;
            const rightSpace = container
                ? container.clientWidth + container.scrollLeft - (bxPx + bwPx)
                : Infinity;
            if (rightSpace >= panelW + 16) {
                left = bxPx + bwPx + 12;
                top = byPx;
            } else if (bxPx - panelW - 12 >= 8) {
                left = bxPx - panelW - 12;
                top = byPx;
            } else {
                left = Math.max(8, bxPx);
                top = byPx + bhPx + 12;
            }

            // Keep the panel inside the visible canvas area
            if (container) {
                const maxTop = container.clientHeight + container.scrollTop - panelH - 8;
                if (top > maxTop) top = Math.max(8, maxTop);
            }

            return `left:${left}px; top:${top}px; width:${panelW}px;`;
        },

        // Duplicate the selection: every selected block is copied with a
        // one-cell offset (one batch create = one undo step). The copies
        // become the new selection.
        async duplicateBlock() {
            const sel = this.selectedBlocks;
            if (!sel.length) return;

            const maxOrder = this.maxOrder;
            // A duplicated child keeps its parent (the copy is a sibling with
            // a one-cell offset inside the same container).
            const creates = sel.map((b, i) => ({
                block_type: b.block_type,
                x: b.parent_id ? b.x + 1 : Math.max(0, b.x + 1),
                y: b.parent_id ? b.y + 1 : Math.max(0, b.y + 1),
                width: b.width,
                height: b.height,
                content: b.content,
                border_style: b.border_style,
                parent_id: b.parent_id || null,
                order: maxOrder + 1 + i,
            }));

            const result = await this.store.batchBlocks({ create: creates });
            const created = result.created || [];
            this.blocks.push(...created);
            this._reorderBlocks();
            this.selectedIds = created.map(b => b.id);
            await this.refreshRender();
        },

        // Delete the selection (one batch delete = one undo step).
        async deleteSelection() {
            const sel = this.selectedBlocks;
            if (!sel.length) return;
            const n = sel.length;
            if (!confirm(n > 1 ? 'Delete ' + n + ' blocks?' : 'Delete this block?')) return;

            const ids = sel.map(b => b.id);
            const result = await this.store.batchBlocks({ delete: ids });
            // Cascade: the store reports every removed id (the whole subtree
            // of each deleted container) — drop all of them locally.
            const removed = new Set(result.deleted || ids);
            this.blocks = this.blocks.filter(b => !removed.has(b.id));
            this.selectedIds = [];
            this._reorderBlocks();
            await this.refreshRender();
        },

        // Nudge the selection by (dx, dy) grid cells (arrow keys).
        async _nudgeSelection(dx, dy) {
            const sel = this.selectedBlocks;
            if (!sel.length) return;
            // No block may cross the canvas origin (0,0) — clamp on the
            // ABSOLUTE position (children carry relative coords, but a
            // relative delta equals the absolute delta).
            const rects = sel.map(b => this._absoluteRect(b));
            const minX = Math.min(...rects.map(r => r.x));
            const minY = Math.min(...rects.map(r => r.y));
            dx = Math.max(dx, -minX);
            dy = Math.max(dy, -minY);
            if (dx === 0 && dy === 0) return;

            const updates = sel.map(b => ({ id: b.id, x: b.x + dx, y: b.y + dy }));
            try {
                // Coalescing key: a burst of nudges is one undo step
                const result = await this.store.batchBlocks({ update: updates }, 'nudge');
                this._applyBatchResult(result);
                await this.refreshRender();
            } catch (err) {
                console.error('Failed to move blocks:', err);
            }
        },

        // ── Properties panel (floating, next to selected block) ──

        // Glyph for a border style in the panel's Line Style buttons —
        // the box-drawing character the style renders with.
        styleIcon(style) {
            const icons = { solid: '─', dashed: '┄', dotted: '┈', double: '═', none: '∅' };
            return icons[style] || style;
        },

        // Apply property values to the selection. Single selection → one
        // block update; multi-selection → the same values for every
        // selected block in one batch update (one undo step). Lines keep
        // their 1-cell thickness (normalized by the store).
        async updateSelectedBlock(props) {
            const sel = this.selectedBlocks;
            if (!sel.length) return;

            if (sel.length === 1) {
                const b = sel[0];
                const old = {};
                for (const key of Object.keys(props)) old[key] = b[key];

                try {
                    const updated = await this.store.updateBlock(b.id, props);
                    Object.assign(b, updated);
                    await this.refreshRender();
                } catch (err) {
                    Object.assign(b, old);
                    console.error('Failed to update block:', err);
                }
                return;
            }

            const updates = sel.map(b => {
                const u = Object.assign({ id: b.id }, props);
                if (u.width != null) u.width = Math.max(1, u.width);
                if (u.height != null) u.height = Math.max(1, u.height);
                return u;
            });
            try {
                const result = await this.store.batchBlocks({ update: updates });
                this._applyBatchResult(result);
                await this.refreshRender();
            } catch (err) {
                console.error('Failed to update blocks:', err);
            }
        },

        // Inputs of the floating properties panel, in DOM order:
        // [0]=X [1]=Y [2]=W [3]=H [4]=Order [5]=Content
        _panelInputs() {
            const panel = document.querySelector('.block-props');
            return panel ? Array.from(panel.querySelectorAll('.prop input')) : [];
        },

        updateSelectedXY(e) {
            const b = this.selectedBlock;
            if (!b) return;
            const inputs = this._panelInputs();
            const x = parseInt(inputs[0].value, 10);
            const y = parseInt(inputs[1].value, 10);
            if (Number.isNaN(x) || Number.isNaN(y)) {
                inputs[0].value = b.x;
                inputs[1].value = b.y;
                return;
            }
            // No layout-bounds clamping — only the canvas origin (0,0)
            this.updateSelectedBlock({
                x: Math.max(0, x),
                y: Math.max(0, y)
            });
        },

        updateSelectedWH(e) {
            const b = this.selectedBlock;
            if (!b) return;
            const inputs = this._panelInputs();
            const w = parseInt(inputs[2].value, 10);
            const h = parseInt(inputs[3].value, 10);
            if (Number.isNaN(w) || Number.isNaN(h)) {
                inputs[2].value = b.width;
                inputs[3].value = b.height;
                return;
            }
            // Minimum size only — blocks may extend beyond the layout
            // bounds; line thickness is normalized by the store
            this.updateSelectedBlock({ width: Math.max(1, w), height: Math.max(1, h) });
        },

        updateSelectedOrder(e) {
            const b = this.selectedBlock;
            if (!b) return;
            const order = parseInt(e.target.value, 10);
            if (Number.isNaN(order) || order < 0) {
                e.target.value = b.order;
                return;
            }
            this.updateSelectedBlock({ order });
        },

        updateSelectedContent(e) {
            const b = this.selectedBlock;
            if (!b) return;
            this.updateSelectedBlock({ content: e.target.value });
        },

        async refreshRender() {
            // Measure real character size and pass it to the store so overlays
            // use exact pixel dimensions instead of assuming 1em = font-size.
            if (!this.charWidth) {
                this._measureCharSize();
            }
            const cw = this.charWidth || 12;
            const ch = this.charHeight || 14.4;
            const data = await this.store.render(cw, ch);
            this.rawText = data.ascii;
            this.htmlPreview = data.html;
            // Re-bind resize handle listeners and the multi-selection
            // highlight after Alpine.js updates the DOM
            this.$nextTick(() => {
                this._bindResizeHandles();
                this._markSelectedPreviews();
            });
        },

        // Highlight the blocks that are part of the current selection
        // (the selection frame itself covers the group's bounding box).
        _markSelectedPreviews() {
            const canvas = document.querySelector('.canvas-container');
            if (!canvas) return;
            canvas.querySelectorAll('.block-preview').forEach(el => {
                el.classList.remove('block-preview--selected');
            });
            for (const id of this.selectedIds) {
                const el = canvas.querySelector('.block-preview[data-block-id="' + id + '"]');
                if (el) el.classList.add('block-preview--selected');
            }
        },

        async addBlock(type) {
            const maxOrder = this.blocks.length > 0
                ? Math.max(...this.blocks.map(b => b.order))
                : 0;
            const defaults = this._blockDefaults(type);
            const block = await this.store.createBlock({
                block_type: type,
                x: 1,
                y: 1,
                width: defaults.width,
                height: defaults.height,
                content: defaults.content,
                order: maxOrder + 1
            });
            this.blocks.push(block);
            this._reorderBlocks();
            await this.refreshRender();
        },

        async deleteBlock(blockId) {
            if (!confirm('Delete this block?')) return;
            await this.store.deleteBlock(blockId);
            // Cascade: the store removes the whole subtree, mirror it locally
            const removed = new Set(this._subtreeIds(blockId));
            this.blocks = this.blocks.filter(b => !removed.has(b.id));
            this.selectedIds = this.selectedIds.filter(id => !removed.has(id));
            this._reorderBlocks();
            await this.refreshRender();
        },

        // Clear the entire layout. Asks for confirmation before removing all
        // blocks. Works in both web mode (fetch store) and static mode (local
        // store) — both expose a clear() method.
        async clearLayout() {
            if (typeof this.store.clear !== 'function') return;
            if (!confirm('Clear the entire layout? All blocks will be removed.')) return;
            await this.store.clear();
            this.blocks = [];
            this.selectedIds = [];
            this.editingBlock = null;
            await this.refreshRender();
        },

        async syncFromRaw() {
            // In a full implementation, parse the raw text and update blocks
            // For now, just refresh from server
            await this.refreshRender();
        },

        async copyRaw() {
            await navigator.clipboard.writeText(this.rawText);
            const btn = document.querySelector('.copy-btn');
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = orig, 1500);
            }
        },

        async exportAs(format) {
            const data = await this.store.export();

            const name = this.layoutId || 'layout';
            let content, filename, mime;

            switch (format) {
                case 'json':
                    content = JSON.stringify(data.json, null, 2);
                    filename = `${name}.json`;
                    mime = 'application/json';
                    break;
                case 'markdown':
                    content = data.markdown || '';
                    filename = `${name}.md`;
                    mime = 'text/markdown';
                    break;
                case 'ascii':
                    content = data.ascii || '';
                    filename = `${name}.txt`;
                    mime = 'text/plain';
                    break;
            }

            const blob = new Blob([content], { type: mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        },

        // ── Import from a JSON file ────────────────────────────

        // Triggered by the hidden file input's change event. Reads the
        // selected file and hands its text to _applyImport.
        onImportFile(e) {
            const input = e.target;
            const file = input.files && input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                input.value = ''; // allow re-importing the same file
                this._applyImport(String(reader.result));
            };
            reader.onerror = () => {
                input.value = '';
                alert('Could not read the file.');
            };
            reader.readAsText(file);
        },

        // Parse the layout JSON and apply it. When the editor already has
        // blocks, ask whether to add the imported blocks on top or replace
        // everything. The whole operation goes through the store's
        // replaceState, so it is a single undo/redo step.
        async _applyImport(text) {
            let json;
            try {
                json = JSON.parse(text);
            } catch (err) {
                alert('Not a valid JSON file: ' + err.message);
                return;
            }

            let parsed;
            try {
                parsed = parseLayoutJson(json);
            } catch (err) {
                alert(err.message);
                return;
            }
            if (parsed.blocks.length === 0) {
                alert('The file contains no blocks.');
                return;
            }

            let state;
            if (this.blocks.length > 0) {
                const add = confirm(
                    'The editor already contains blocks.\n\n' +
                    'OK — add the imported blocks to the current layout.\n' +
                    'Cancel — replace all content with the imported layout.'
                );
                if (add) {
                    const merged = this.blocks.concat(
                        prepareImport(parsed.blocks, this.blocks, 'add')
                    );
                    // Keep the current bounds — the file's blocks are just
                    // being added inside the existing layout.
                    state = { width: this.layoutWidth, height: this.layoutHeight, blocks: merged };
                } else {
                    state = {
                        width: parsed.width,
                        height: parsed.height,
                        blocks: prepareImport(parsed.blocks, null, 'replace'),
                    };
                }
            } else {
                state = {
                    width: parsed.width,
                    height: parsed.height,
                    blocks: prepareImport(parsed.blocks, null, 'replace'),
                };
            }

            try {
                await this.store.replaceState(state);
                await this._syncStateFromStore();
            } catch (err) {
                console.error('Failed to import layout:', err);
                alert('Failed to import the layout: ' + err.message);
            }
        }
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { editorApp: editorApp };
}
