/**
 * Editor app: manages block state, rendering, and export.
 */

function editorApp() {
    return {
        layoutId: null,
        blocks: [],
        blockTypes: [],
        rawText: '',
        htmlPreview: '',
        loading: true,

        // ── Drag state ──────────────────────────────────────────
        dragMode: null,          // 'palette' | 'move' | 'resize' | null
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
        layoutWidth: 80,
        layoutHeight: 24,

        async init() {
            // Extract layout ID from page (set by server)
            this.layoutId = document.querySelector('[data-layout-id]')?.dataset.layoutId;
            if (!this.layoutId) {
                console.error('No layout ID found');
                return;
            }

            await Promise.all([
                this.fetchInfo(),
                this.fetchBlocks(),
                this.refreshRender()
            ]);

            // Measure char size AFTER Alpine.js has rendered the <pre>,
            // then re-render with exact pixel dimensions so overlays align.
            this.$nextTick(() => {
                this._measureCharSize();
                this.refreshRender();
            });

            this._bindGlobalMouseUp();
            // Defer binding until Alpine.js has updated the DOM via x-html
            this.$nextTick(() => this._bindResizeHandles());
            this.loading = false;
        },

        // ── Char-size measurement ───────────────────────────────

        _measureCharSize() {
            const pre = document.querySelector('.canvas-container pre');
            if (!pre) return;
            // Measure character width from a span (getBoundingClientRect works)
            const sample = document.createElement('span');
            sample.style.fontFamily = getComputedStyle(pre).fontFamily;
            sample.style.fontSize = getComputedStyle(pre).fontSize;
            sample.style.fontWeight = getComputedStyle(pre).fontWeight;
            sample.textContent = 'W';
            pre.appendChild(sample);
            this.charWidth = sample.getBoundingClientRect().width;
            pre.removeChild(sample);
            // Use computed line-height — it's the actual pixel value
            // the browser uses for each row, regardless of how
            // line-height: 1.2 is parsed (unitless vs %).
            const lh = getComputedStyle(pre).lineHeight;
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
            const gx = Math.max(0, Math.min(
                (px - rect.left - pad) / this.charWidth,
                this.layoutWidth - 1
            ));
            const gy = Math.max(0, Math.min(
                (py - rect.top - pad) / this.charHeight,
                this.layoutHeight - 1
            ));
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

        _onGlobalMouseUp() {
            if (!this.dragMode) return;

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

                // JS-based hover: toggle .visible class on resize handle
                preview.addEventListener('mouseenter', () => {
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

            const blockId = blockPreview.dataset.blockId;
            const block = this.blocks.find(b => b.id === blockId);
            if (!block) return;

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
            const w = this.dragType === 'button' ? 12 : 20;
            const h = this.dragType === 'button' ? 1 : 3;

            // Clamp to layout bounds
            pos.x = Math.max(0, Math.min(pos.x, this.layoutWidth - w));
            pos.y = Math.max(0, Math.min(pos.y, this.layoutHeight - h));

            const maxOrder = this.blocks.length > 0
                ? Math.max(...this.blocks.map(b => b.order))
                : 0;

            fetch(`/api/layouts/${this.layoutId}/blocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    block_type: this.dragType,
                    x: pos.x,
                    y: pos.y,
                    width: w,
                    height: h,
                    content: this.dragType === 'button' ? 'Button' : `[${this.dragType}]`,
                    order: maxOrder + 1
                })
            }).then(r => r.json()).then(block => {
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

            // Find block under cursor by checking block-list order
            // and using the canvas overlay position
            const pos = this._pixelToGrid(e.clientX, e.clientY);

            // Find the block whose area contains the cursor
            const block = this.blocks.find(b =>
                pos.x >= b.x && pos.y >= b.y &&
                pos.x < b.x + b.width && pos.y < b.y + b.height
            );
            if (!block) return;

            // Don't drag if clicking delete button
            if (e.target.closest('.delete-block')) return;

            this.dragMode = 'move';
            this.dragBlock = block;
            this.dragStartX = e.clientX;
            this.dragStartY = e.clientY;
            this.dragOffsetX = pos.x - block.x;
            this.dragOffsetY = pos.y - block.y;
            this.dragGridX = block.x;
            this.dragGridY = block.y;

            // Show preview
            const preview = this._ensurePreviewEl();
            if (preview) {
                preview.style.width = (block.width * this.charWidth) + 'px';
                preview.style.height = (block.height * this.charHeight) + 'px';
                preview.style.display = 'block';
                this._showPreview(block.x, block.y);
            }

            e.preventDefault();
        },

        onCanvasMouseMove(e) {
            if (this.dragMode === 'move' && this.dragBlock) {
                const pos = this._pixelToGrid(e.clientX, e.clientY);
                const gx = Math.max(0, pos.x - this.dragOffsetX);
                const gy = Math.max(0, pos.y - this.dragOffsetY);
                const block = this.dragBlock;

                // Clamp to layout bounds
                const clampedX = Math.min(gx, this.layoutWidth - block.width);
                const clampedY = Math.min(gy, this.layoutHeight - block.height);

                this._showPreview(clampedX, clampedY);
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

                // Clamp to minimum and layout bounds
                newW = Math.max(2, Math.min(newW, this.layoutWidth - this.dragBlock.x));
                newH = Math.max(2, Math.min(newH, this.layoutHeight - this.dragBlock.y));

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

        async _commitBlockMove() {
            if (!this.dragBlock || this.dragGridX < 0) return;
            const block = this.dragBlock;
            const oldX = block.x;
            const oldY = block.y;

            try {
                await fetch(`/api/layouts/${this.layoutId}/blocks/${block.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ x: this.dragGridX, y: this.dragGridY })
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

            // Minimum size: 2x2
            const clampedW = Math.max(2, newW);
            const clampedH = Math.max(2, newH);

            if (clampedW === oldW && clampedH === oldH) {
                return; // No change
            }

            try {
                await fetch(`/api/layouts/${this.layoutId}/blocks/${block.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ width: clampedW, height: clampedH })
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
            const root = document.querySelector('[data-layout-id]');
            const projectId = root?.dataset.projectId;
            if (!projectId) return;

            const res = await fetch(`/api/projects/${projectId}/info`);
            const data = await res.json();
            this.blockTypes = data.block_types || [];
        },

        async fetchBlocks() {
            // Fetch all blocks for this layout
            const res = await fetch(`/api/layouts/${this.layoutId}`);
            const data = await res.json();
            // Capture layout dimensions for drag calculations
            this.layoutWidth = data.width || 80;
            this.layoutHeight = data.height || 24;
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
            // Sort blocks by order so list position matches z-order
            this.blocks.sort((a, b) => a.order - b.order);
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
                await fetch(`/api/layouts/${this.layoutId}/blocks/${blockId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ order: block.order })
                });
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

        async refreshRender() {
            // Measure real character size and pass it to the server so overlays
            // use exact pixel dimensions instead of assuming 1em = font-size.
            if (!this.charWidth) {
                this._measureCharSize();
            }
            const cw = this.charWidth || 12;
            const ch = this.charHeight || 14.4;
            const res = await fetch(
                `/api/layouts/${this.layoutId}/render`
                + `?char_width_px=${cw.toFixed(2)}`
                + `&char_height_px=${ch.toFixed(2)}`
            );
            const data = await res.json();
            this.rawText = data.ascii;
            this.htmlPreview = data.html;
            // Re-bind resize handle listeners after Alpine.js updates the DOM
            this.$nextTick(() => this._bindResizeHandles());
        },

        async addBlock(type) {
            const maxOrder = this.blocks.length > 0
                ? Math.max(...this.blocks.map(b => b.order))
                : 0;
            const res = await fetch(`/api/layouts/${this.layoutId}/blocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    block_type: type,
                    x: 1,
                    y: 1,
                    width: type === 'button' ? 12 : 20,
                    height: type === 'button' ? 1 : 3,
                    content: type === 'button' ? 'Button' : `[${type}]`,
                    order: maxOrder + 1
                })
            });
            const block = await res.json();
            this.blocks.push(block);
            this._reorderBlocks();
            await this.refreshRender();
        },

        async deleteBlock(blockId) {
            if (!confirm('Delete this block?')) return;
            await fetch(`/api/layouts/${this.layoutId}/blocks/${blockId}`, {
                method: 'DELETE'
            });
            this.blocks = this.blocks.filter(b => b.id !== blockId);
            this._reorderBlocks();
            await this.refreshRender();
        },

        async syncFromRaw() {
            // In a full implementation, parse the raw text and update blocks
            // For now, just refresh from server
            await this.refreshRender();
        },

        async copyRaw() {
            await navigator.clipboard.writeText(this.rawText);
            const btn = document.querySelector('.raw-actions .btn:last-child');
            if (btn) {
                const orig = btn.textContent;
                btn.textContent = 'Copied!';
                setTimeout(() => btn.textContent = orig, 1500);
            }
        },

        async exportAs(format) {
            const res = await fetch(`/api/layouts/${this.layoutId}/export`);
            const data = await res.json();

            let content, filename, mime;

            switch (format) {
                case 'json':
                    content = JSON.stringify(data.json, null, 2);
                    filename = `${this.layoutId}.json`;
                    mime = 'application/json';
                    break;
                case 'markdown':
                    content = data.markdown || '';
                    filename = `${this.layoutId}.md`;
                    mime = 'text/markdown';
                    break;
                case 'ascii':
                    content = data.ascii || '';
                    filename = `${this.layoutId}.txt`;
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
