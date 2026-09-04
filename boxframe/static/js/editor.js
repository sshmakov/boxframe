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

            this.loading = false;
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
            // Blocks are nested in the layout response
            this.blocks = this._flattenBlocks(data.blocks || []);
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

        async refreshRender() {
            const res = await fetch(`/api/layouts/${this.layoutId}/render`);
            const data = await res.json();
            this.rawText = data.ascii;
            this.htmlPreview = data.html;
        },

        async addBlock(type) {
            const res = await fetch(`/api/layouts/${this.layoutId}/blocks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    block_type: type,
                    x: 1,
                    y: 1,
                    width: type === 'button' ? 12 : 20,
                    height: type === 'button' ? 1 : 3,
                    content: type === 'button' ? 'Button' : `[${type}]`
                })
            });
            const block = await res.json();
            this.blocks.push(block);
            await this.refreshRender();
        },

        async deleteBlock(blockId) {
            if (!confirm('Delete this block?')) return;
            await fetch(`/api/layouts/${this.layoutId}/blocks/${blockId}`, {
                method: 'DELETE'
            });
            this.blocks = this.blocks.filter(b => b.id !== blockId);
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
