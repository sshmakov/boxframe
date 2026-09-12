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

        // ── Undo/redo (kept in sync by the history store's onChange) ──
        undoCount: 0,
        redoCount: 0,

        // ── Inline content editing state ────────────────────
        editingBlock: null,    // block being edited (null = editor closed)
        editText: '',          // textarea content while editing

        // ── Selection state (single click) ─────────────────────
        selectedBlockId: null, // id of the block selected by a single click
        pendingBlock: null,    // block under cursor on mousedown (click vs drag)

        // ── Drag state ──────────────────────────────────────────
        dragMode: null,          // 'palette' | 'pending' | 'move' | 'resize' | null
        dragType: null,          // block type string (palette drag)
        dragBlock: null,         // block object (move / resize drag)
        dragStartX: 0,
        dragStartY: 0,
        dragOffsetX: 0,
        dragOffsetY: 0,
        dragGridX: -1,
        dragGridY: -1,

        // ── Resize state ───────────────────────────────────────
        resizeStartW: 0,         // block width at resize start (grid cells)
        resizeStartH: 0,         // block height at resize start (grid cells)
        resizeStartClientX: 0,   // mouse X at resize start (client coords)
        resizeStartClientY: 0,   // mouse Y at resize start (client coords)
        resizePreviewW: 0,       // preview width during drag (grid cells)
        resizePreviewH: 0,       // preview height during drag (grid cells)

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
            this._bindUndoRedoKeys();
            // Defer binding until Alpine.js has updated the DOM via x-html
            this.$nextTick(() => this._bindResizeHandles());
            this.loading = false;
        },

        // ── Undo/redo ─────────────────────────────────────────

        // Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) — global shortcuts. Skipped
        // while a text field has focus so native input undo keeps working
        // (inline content editor, properties panel inputs).
        _bindUndoRedoKeys() {
            document.addEventListener('keydown', (e) => {
                if (!(e.ctrlKey || e.metaKey)) return;
                const key = e.key.toLowerCase();
                if (key !== 'z' && key !== 'y') return;
                const t = e.target;
                if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                          t.tagName === 'SELECT' || t.isContentEditable)) return;
                e.preventDefault();
                if (key === 'z' && !e.shiftKey) {
                    this.undo();
                } else {
                    this.redo();
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
            this._reorderBlocks();
            if (this.selectedBlockId && !this.blocks.some(b => b.id === this.selectedBlockId)) {
                this.selectedBlockId = null;
            }
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

        _pixelToGrid(px, py) {
            const container = document.querySelector('.canvas-container');
            if (!container || !this.charWidth) return { x: 0, y: 0 };
            const rect = container.getBoundingClientRect();
            const pad = 16; // wrapper padding only
            // The canvas may be scrolled — account for the scroll offset so
            // the mapping stays correct when the art is scrolled under the
            // cursor (or the cursor is outside the visible area).
            const gx = Math.max(0, (px - rect.left + container.scrollLeft - pad) / this.charWidth);
            const gy = Math.max(0, (py - rect.top + container.scrollTop - pad) / this.charHeight);
            // Blocks may be placed outside the layout bounds — the canvas
            // origin (0,0) is the only hard limit; there is no upper limit.
            return { x: Math.floor(gx), y: Math.floor(gy) };
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
                // Click on a block → select it, click on empty canvas → deselect.
                this.selectedBlockId = this.pendingBlock ? this.pendingBlock.id : null;
                this._clearDragState();
                return;
            }

            if (this.dragMode === 'move' && this.dragBlock && this.dragGridX >= 0) {
                this._commitBlockMove();
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
            this.pendingBlock = null;
            this._hidePreview();
            this.previewEl = null;
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
                    if (preview.dataset.blockId === this.selectedBlockId) return;
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

            this._startResizeDrag(block, e);
        },

        // Resize handle on the selection frame (visible while a block is
        // selected, no hover needed)
        onSelectionResizeMouseDown(e) {
            if (e.button !== 0) return;

            const block = this.selectedBlock;
            if (!block) return;

            this._startResizeDrag(block, e);
        },

        _startResizeDrag(block, e) {
            this.dragMode = 'resize';
            this.dragBlock = block;
            this.resizeStartW = block.width;
            this.resizeStartH = block.height;
            this.resizeStartClientX = e.clientX;
            this.resizeStartClientY = e.clientY;
            this.resizePreviewW = block.width;
            this.resizePreviewH = block.height;

            if (!this.charWidth) {
                this._measureCharSize();
            }

            const preview = this._ensurePreviewEl();
            if (preview) {
                preview.style.width = (block.width * this.charWidth) + 'px';
                preview.style.height = (block.height * this.charHeight) + 'px';
                preview.style.display = 'block';
                this._setPreviewMode('resize');
                this._showPreview(block.x, block.y);
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

            this.store.createBlock({
                block_type: this.dragType,
                x: pos.x,
                y: pos.y,
                width: w,
                height: h,
                content: defaults.content,
                order: maxOrder + 1
            }).then(block => {
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

            // Find the block whose area contains the cursor
            const pos = this._pixelToGrid(e.clientX, e.clientY);
            const block = this.blocks.find(b =>
                pos.x >= b.x && pos.y >= b.y &&
                pos.x < b.x + b.width && pos.y < b.y + b.height
            );

            // Pending: becomes a move-drag if the mouse moves past a
            // threshold, or a select/deselect click if it doesn't.
            this.dragMode = 'pending';
            this.pendingBlock = block;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragOffsetX = pos.x - (block ? block.x : 0);
            this.dragOffsetY = pos.y - (block ? block.y : 0);
            this.dragGridX = block ? block.x : -1;
            this.dragGridY = block ? block.y : -1;

            if (block) {
                e.preventDefault();
            }
        },

        onCanvasMouseMove(e) {
            if (this.dragMode === 'pending') {
                const dx = e.clientX - this.dragStartX;
                const dy = e.clientY - this.dragStartY;
                if (this.pendingBlock && Math.hypot(dx, dy) > 3) {
                    // Mouse moved past the click threshold: start the move-drag
                    this.dragMode = 'move';
                    this.dragBlock = this.pendingBlock;

                    const preview = this._ensurePreviewEl();
                    if (preview) {
                        preview.style.width = (this.dragBlock.width * this.charWidth) + 'px';
                        preview.style.height = (this.dragBlock.height * this.charHeight) + 'px';
                        preview.style.display = 'block';
                        this._showPreview(this.dragBlock.x, this.dragBlock.y);
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

                this._showPreview(gx, gy);
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

                // Update preview dimensions
                if (this.previewEl) {
                    this.previewEl.style.width = (newW * this.charWidth) + 'px';
                    this.previewEl.style.height = (newH * this.charHeight) + 'px';
                }

                e.preventDefault();
                e.stopPropagation();
            }
        },

        // ── Inline content editing (double-click a block) ─────

        get editOverlayStyle() {
            if (!this.editingBlock) return 'display:none';
            const pad = 16; // matches .render-wrapper padding
            const b = this.editingBlock;
            return (
                `left:${pad + b.x * this.charWidth}px;` +
                `top:${pad + b.y * this.charHeight}px;` +
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
            const block = this.blocks.find(b =>
                pos.x >= b.x && pos.y >= b.y &&
                pos.x < b.x + b.width && pos.y < b.y + b.height
            );
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
            const oldX = block.x;
            const oldY = block.y;

            try {
                await this.store.updateBlock(block.id, {
                    x: this.dragGridX, y: this.dragGridY
                });
                block.x = this.dragGridX;
                block.y = this.dragGridY;
                await this.refreshRender();
            } catch (err) {
                // Rollback on error
                block.x = oldX;
                block.y = oldY;
                console.error('Failed to move block:', err);
            }
        },

        async _commitBlockResize() {
            if (!this.dragBlock) return;
            const block = this.dragBlock;
            const oldW = block.width;
            const oldH = block.height;

            // Calculate new dimensions from preview
            const newW = Math.round(this.resizePreviewW);
            const newH = Math.round(this.resizePreviewH);

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
                await this.store.updateBlock(block.id, {
                    width: clampedW, height: clampedH
                });
                block.width = clampedW;
                block.height = clampedH;
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

        // ── Selection (single click) ───────────────────────────

        selectBlock(blockId) {
            this.selectedBlockId = blockId;
        },

        get selectedBlock() {
            if (!this.selectedBlockId) return null;
            return this.blocks.find(b => b.id === this.selectedBlockId) || null;
        },

        get selectionStyle() {
            const b = this.selectedBlock;
            if (!b) return 'display:none';
            const pad = 16; // matches .render-wrapper padding
            return (
                `left:${pad + b.x * this.charWidth}px;` +
                `top:${pad + b.y * this.charHeight}px;` +
                `width:${b.width * this.charWidth}px;` +
                `height:${b.height * this.charHeight}px;`
            );
        },

        // Position of the floating properties panel: next to the selected
        // block (right side preferred, left as fallback, below as last resort)
        get propsPanelStyle() {
            const b = this.selectedBlock;
            if (!b) return 'display:none';
            const pad = 16; // matches .render-wrapper padding
            const container = document.querySelector('.canvas-container');
            const panelW = 208;
            const panelH = 300; // approximate height, for vertical clamping

            const bx = pad + b.x * this.charWidth;
            const by = pad + b.y * this.charHeight;
            const bw = b.width * this.charWidth;
            const bh = b.height * this.charHeight;

            let left, top;
            const rightSpace = container
                ? container.clientWidth + container.scrollLeft - (bx + bw)
                : Infinity;
            if (rightSpace >= panelW + 16) {
                left = bx + bw + 12;
                top = by;
            } else if (bx - panelW - 12 >= 8) {
                left = bx - panelW - 12;
                top = by;
            } else {
                left = Math.max(8, bx);
                top = by + bh + 12;
            }

            // Keep the panel inside the visible canvas area
            if (container) {
                const maxTop = container.clientHeight + container.scrollTop - panelH - 8;
                if (top > maxTop) top = Math.max(8, maxTop);
            }

            return `left:${left}px; top:${top}px; width:${panelW}px;`;
        },

        async duplicateBlock() {
            const b = this.selectedBlock;
            if (!b) return;

            // Offset the copy by one cell (no layout-bounds clamping)
            const x = Math.max(0, b.x + 1);
            const y = Math.max(0, b.y + 1);

            const block = await this.store.createBlock({
                block_type: b.block_type,
                x,
                y,
                width: b.width,
                height: b.height,
                content: b.content,
                border_style: b.border_style,
                order: this.maxOrder + 1
            });
            this.blocks.push(block);
            this._reorderBlocks();
            this.selectedBlockId = block.id;
            await this.refreshRender();
        },

        async updateBlockStyle(blockId, style) {
            const block = this.blocks.find(b => b.id === blockId);
            if (!block) return;

            const oldStyle = block.border_style;
            try {
                await this.store.updateBlock(blockId, { border_style: style });
                block.border_style = style;
                await this.refreshRender();
            } catch (err) {
                block.border_style = oldStyle;
                console.error('Failed to update border style:', err);
            }
        },

        // ── Properties panel (floating, next to selected block) ──

        async updateSelectedBlock(props) {
            const b = this.selectedBlock;
            if (!b) return;

            const old = {};
            for (const key of Object.keys(props)) old[key] = b[key];

            try {
                await this.store.updateBlock(b.id, props);
                Object.assign(b, props);
                await this.refreshRender();
            } catch (err) {
                Object.assign(b, old);
                console.error('Failed to update block:', err);
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
            // Minimum size only — blocks may extend beyond the layout bounds
            let newW = Math.max(1, w);
            let newH = Math.max(1, h);
            if (b.block_type === 'hline') newH = 1;
            if (b.block_type === 'vline') newW = 1;
            this.updateSelectedBlock({ width: newW, height: newH });
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
            // Re-bind resize handle listeners after Alpine.js updates the DOM
            this.$nextTick(() => this._bindResizeHandles());
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
            this.blocks = this.blocks.filter(b => b.id !== blockId);
            if (this.selectedBlockId === blockId) {
                this.selectedBlockId = null;
            }
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
            this.selectedBlockId = null;
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
        }
    };
}
