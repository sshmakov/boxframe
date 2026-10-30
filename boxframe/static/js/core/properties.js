/**
 * Declarative schema of block properties + the properties-panel generator.
 *
 * The schema is the single source of truth for the floating properties
 * panel in both editors (web and static): the panel body markup is
 * generated from it (buildPropsPanelHTML), so adding a property is a
 * schema entry + renderer support (Python + JS + parity) — no template
 * edits.
 *
 * Descriptor fields:
 *   key      — data key
 *   meta     — true → block.meta[key], false → block[key]
 *   label    — panel label
 *   kind     — number | segmented | select | charpicker | text |
 *               textarea (multi-line text, the modal's Content field)
 *   options  — for segmented / select / charpicker
 *   icons    — optional option → glyph map (button labels, or the
 *               option text for select), or a (blockType, option) →
 *               glyph function for type-dependent glyphs (arrow
 *               direction)
 *   iconPrefix — optional: the button shows an SVG icon instead of a
 *               glyph — the option gets the `style-btn--<iconPrefix>-
 *               <option>` CSS class (the mask of static/icons/
 *               <iconPrefix>-<option>.svg, see editor.css). The option
 *               text stays in the button as a FALLBACK: it is hidden
 *               (font-size: 0) only after the editor verifies the mask
 *               image actually loads (the `align-icons-ok` class on the
 *               editor root, editor.js) — on file:// with restricted
 *               subresource access, or a missing icons/ dir, the
 *               buttons keep their text
 *   group    — section name (sections = unique groups, declaration order)
 *   panel    — "primary" → the property also appears in the FLOATING
 *               properties panel (actions + the frequently used controls:
 *               style, fill, alignment, arrows); omitted = secondary —
 *               the all-properties modal only (geometry, text). New
 *               properties default to secondary so the floating panel
 *               stays compact
 *   row      — row name: consecutive properties sharing a row render as
 *               ONE grid row with a button group per property (the
 *               Align pair); rowLabel gives the shared row label
 *   cols     — grid column count for the section body (Geometry: 3)
 *   wide     — for select: span the full row (default: one grid cell,
 *               so two selects share a row)
 *   types    — applicable block_type; omitted = all
 *   default  — value when absent (null = inherit/none)
 *   typeDefaults — optional block_type → default override (a divider's
 *               label is centered by default)
 *   noneValue — value applied when the "none" option is picked (null
 *               clears the meta key); omitted → "none" is stored as-is
 *   clearDefault — true → picking the default value clears the meta key
 *               (the default is implicit; alignment properties)
 *   min/max  — for number
 *
 * Requires core/renderer.js (PGRenderer.BORDER_STYLES).
 */
(function (global) {
    "use strict";

    var BORDER_STYLES = global.PGRenderer.BORDER_STYLES;

    // The current properties first (phase 0 of tasks/0051): the panel is
    // reorganized into sections generated from this schema. New properties
    // (fill, arrows, alignment) are appended here in phases 2-3.
    var PROPERTY_SCHEMA = [
        {
            key: "border_style",
            label: "Line Style",
            kind: "segmented",
            options: BORDER_STYLES,
            icons: { solid: "─", dashed: "┄", dotted: "┈", double: "═", none: "∅" },
            group: "Style",
            panel: "primary",
        },
        // Fill (phase 2 of tasks/0051): meta.fill paints the block's
        // content area; the content is drawn on top and the [type] hint
        // is suppressed. " " (space) is a real fill value — it erases the
        // block underneath (the grid is space-initialized, so a blank fill
        // overwrites what was drawn before). "none" is a display sentinel
        // for the absent value — picking it clears the meta key
        // (noneValue: null).
        {
            key: "fill",
            meta: true,
            label: "Fill",
            kind: "charpicker",
            options: ["░", "▒", "▓", "█", "·", "×", " ", "none"],
            icons: { none: "∅", " ": "␣" },
            group: "Fill",
            types: ["box", "header", "footer", "sidebar", "content", "grid",
                    "image"],
            default: "none",
            noneValue: null,
            panel: "primary",
        },
        // Text alignment (phase 3 of tasks/0051): meta.text_align /
        // meta.vertical_align position the wrapped content inside the
        // content area (defaults left/top render as before). Picking the
        // default clears the meta key (clearDefault — the default is
        // implicit). Not applicable to lines.
        // typeDefaults: a divider's label is CENTERED by default (variant
        // E, tasks/0003) and a button's label is CENTERED by default
        // (task 0060) — the panel shows center as active without
        // meta.text_align, and picking center clears the key. row:
        // "align" — the two properties share ONE panel row (a button
        // group each, one shared label). iconPrefix: the buttons show
        // SVG icons (static/icons/align-*.svg, masked in editor.css)
        // instead of the option text.
        {
            key: "text_align",
            meta: true,
            label: "H Align",
            kind: "segmented",
            options: ["left", "center", "right"],
            iconPrefix: "align",
            group: "Align",
            row: "align",
            rowLabel: "Align",
            types: ["box", "header", "footer", "sidebar", "content", "button",
                    "input", "textarea", "image", "divider", "text", "grid"],
            default: "left",
            typeDefaults: { divider: "center", button: "center" },
            clearDefault: true,
            panel: "primary",
        },
        // A divider's label block is shifted vertically inside the
        // stored height — default MIDDLE (unlike box, whose default is
        // top); a button's label block is centered vertically by default
        // (task 0060). Picking middle clears the key (typeDefaults +
        // clearDefault).
        {
            key: "vertical_align",
            meta: true,
            label: "V Align",
            kind: "segmented",
            options: ["top", "middle", "bottom"],
            iconPrefix: "align",
            group: "Align",
            row: "align",
            types: ["box", "header", "footer", "sidebar", "content", "button",
                    "input", "textarea", "image", "text", "grid", "divider"],
            default: "top",
            typeDefaults: { divider: "middle", button: "middle" },
            clearDefault: true,
            panel: "primary",
        },
        // Arrows (phase 3 of tasks/0051): meta.arrow_start / meta.arrow_end
        // replace the end cell of an hline/vline (a line shorter than 2
        // cells has no arrows). Six head shapes per line direction; "none"
        // is a display sentinel for the absent value (noneValue: null
        // clears the meta key). kind: select — 14 buttons don't fit the
        // panel width, so Start/End are two selects sharing one row; the
        // option labels are the head glyphs (icons as a function of the
        // line direction).
        {
            key: "arrow_start",
            meta: true,
            label: "Start",
            kind: "select",
            options: ["none", "arrow", "arrow-open", "diamond",
                      "diamond-open", "circle", "circle-open"],
            icons: (type, opt) => {
                const g = type === "vline"
                    ? { none: "∅", arrow: "▲", "arrow-open": "△", diamond: "◆",
                        "diamond-open": "◇", circle: "●", "circle-open": "○" }
                    : { none: "∅", arrow: "◀", "arrow-open": "◁", diamond: "◆",
                        "diamond-open": "◇", circle: "●", "circle-open": "○" };
                return g[opt] || opt;
            },
            group: "Arrows",
            types: ["hline", "vline"],
            default: "none",
            noneValue: null,
            panel: "primary",
        },
        {
            key: "arrow_end",
            meta: true,
            label: "End",
            kind: "select",
            options: ["none", "arrow", "arrow-open", "diamond",
                      "diamond-open", "circle", "circle-open"],
            icons: (type, opt) => {
                const g = type === "vline"
                    ? { none: "∅", arrow: "▼", "arrow-open": "▽", diamond: "◆",
                        "diamond-open": "◇", circle: "●", "circle-open": "○" }
                    : { none: "∅", arrow: "▶", "arrow-open": "▷", diamond: "◆",
                        "diamond-open": "◇", circle: "●", "circle-open": "○" };
                return g[opt] || opt;
            },
            group: "Arrows",
            types: ["hline", "vline"],
            default: "none",
            noneValue: null,
            panel: "primary",
        },
        // cols: 3 — the five fields sit in three columns (X Y W / H
        // Order) instead of two (X Y / W H / Order)
        { key: "x", label: "X", kind: "number", group: "Geometry", min: 0, cols: 3 },
        { key: "y", label: "Y", kind: "number", group: "Geometry", min: 0, cols: 3 },
        { key: "width", label: "W", kind: "number", group: "Geometry", min: 1, cols: 3 },
        { key: "height", label: "H", kind: "number", group: "Geometry", min: 1, cols: 3 },
        { key: "order", label: "Order", kind: "number", group: "Geometry", min: 0, cols: 3 },
        // Content (task 0054): multi-line textarea — the block's text is
        // edited inline on the canvas (double-click) or here in the
        // all-properties modal; secondary (modal only)
        { key: "content", label: "Content", kind: "textarea", group: "Text" },
    ];

    function findProperty(key) {
        for (var i = 0; i < PROPERTY_SCHEMA.length; i++) {
            if (PROPERTY_SCHEMA[i].key === key) return PROPERTY_SCHEMA[i];
        }
        return null;
    }

    // The effective value of a property on a block: meta properties read
    // block.meta[key] (absent → default), the rest read block[key].
    // The default may be type-specific (typeDefaults — e.g. a divider's
    // label is centered by default).
    function readPropValue(block, prop) {
        var v = prop.meta
            ? (block.meta ? block.meta[prop.key] : undefined)
            : block[prop.key];
        if (v === undefined || v === null) {
            var td = prop.typeDefaults ? prop.typeDefaults[block.block_type] : undefined;
            if (td !== undefined && td !== null) return td;
            return prop.default !== undefined ? prop.default : null;
        }
        return v;
    }

    // Grid rows of a section body: consecutive properties sharing a
    // `row` name collapse into one row (a button group per property, one
    // shared label — the Align pair); the rest are single-property rows.
    // A row that ends up with a single property keeps its own label.
    // `kind` ("group" or the single property's kind) and `prop` (the
    // single property) let the generated markup branch on the row kind
    // with sibling x-if's (Alpine doesn't init an x-for that is the
    // direct content of an x-if template).
    function rowsForProps(props) {
        var rows = [];
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            var last = rows[rows.length - 1];
            if (p.row && last && last.rowName === p.row) {
                last.props.push(p);
            } else if (p.row) {
                rows.push({
                    key: p.row,
                    rowName: p.row,
                    label: p.rowLabel || p.label,
                    props: [p],
                });
            } else {
                rows.push({ key: p.key, label: p.label, props: [p] });
            }
        }
        for (var j = 0; j < rows.length; j++) {
            var r = rows[j];
            if (r.props.length > 1) {
                r.kind = "group";
            } else {
                r.kind = r.props[0].kind;
                r.prop = r.props[0];
                if (r.rowName) r.label = r.props[0].label;
            }
        }
        return rows;
    }

    // Sections for a block type: unique groups in declaration order, each
    // with the properties applicable to the type (types omitted = all).
    // Groups with no applicable property are dropped. Each section also
    // carries `rows` (the grid rows, see rowsForProps) and `cols` (the
    // grid column count — the max of the properties' `cols`, default 2).
    // `panel` — "primary" keeps only the primary properties (the floating
    // panel: style, fill, alignment, arrows); "all" (the default) keeps
    // everything (the all-properties modal).
    function sectionsForType(blockType, panel) {
        panel = panel || "all";
        var sections = [];
        var byName = {};
        for (var i = 0; i < PROPERTY_SCHEMA.length; i++) {
            var prop = PROPERTY_SCHEMA[i];
            if (prop.types && prop.types.indexOf(blockType) === -1) continue;
            if (panel === "primary" && prop.panel !== "primary") continue;
            if (!byName[prop.group]) {
                byName[prop.group] = { name: prop.group, props: [] };
                sections.push(byName[prop.group]);
            }
            byName[prop.group].props.push(prop);
        }
        for (var s = 0; s < sections.length; s++) {
            var sec = sections[s];
            sec.rows = rowsForProps(sec.props);
            var cols = 2;
            for (var p = 0; p < sec.props.length; p++) {
                if (sec.props[p].cols > cols) cols = sec.props[p].cols;
            }
            sec.cols = cols;
        }
        return sections;
    }

    // The panel body markup. A constant string — the reactivity lives in
    // the host app's sections getter and the per-property bindings.
    // Sections are always open (no collapse, no headers) — the name is
    // exposed as data-section for tooling/tests. The Alpine directives
    // resolve against the editor app:
    //   panelSections / modalSections — sections for the selected
    //   block's type (each section carries `rows` — the grid rows — and
    //   `cols`); panelSections = the floating panel (primary properties),
    //   modalSections = the all-properties modal (all sections)
    //   propValue / isMixedProp / propActive — selection values (mixed =
    //   the values differ across the multi-selection)
    //   onPropNumber / onPropText / onPropSelect — change handlers
    // `getterName` — the sections getter the fragment iterates: the
    // floating panel (the default) and the modal share this markup.
    function buildPropsPanelHTML(getterName) {
        getterName = getterName || "panelSections";
        return `
<template x-for="section in ${getterName}" :key="section.name">
  <div class="props-section" :data-section="section.name">
    <div class="props-section__body"
         :class="{ 'props-section__body--3col': section.cols === 3 }">
      <!-- Rows: a section's properties grouped into grid rows (see
           rowsForProps). A group row (row: "align") renders one shared
           label and a button group per property; the rest are
           single-property rows rendered by row.kind. Alpine's x-for/x-if
           clone only the FIRST element child of the template content, so
           each iteration needs a single root: the .prop-cell wrapper
           (display:contents — the inner control stays the grid item).
           The kind branches are sibling x-if's (an x-for as the direct
           content of an x-if template is not initialized by Alpine). -->
      <template x-for="row in section.rows" :key="row.key">
        <div class="prop-cell">
          <template x-if="row.kind === 'group'">
            <div class="prop prop--wide">
              <span x-text="row.label"></span>
              <div class="align-row">
                <template x-for="prop in row.props" :key="prop.key">
                  <div class="style-btns">
                    <template x-for="opt in prop.options" :key="opt">
                      <button type="button" class="style-btn"
                              :class="styleBtnClasses(prop, opt)"
                              :title="String(opt)"
                              @click="onPropSelect(prop, opt)"
                              x-text="propIcon(prop, opt)"></button>
                    </template>
                  </div>
                </template>
              </div>
            </div>
          </template>
          <template x-if="row.kind === 'number'">
            <label class="prop prop--inline">
              <span x-text="row.prop.label"></span>
              <input type="number" :min="row.prop.min != null ? row.prop.min : 0"
                     :value="propValue(row.prop.key)"
                     :placeholder="isMixedProp(row.prop.key) ? '—' : ''"
                     @change="onPropNumber(row.prop, $event)">
            </label>
          </template>
          <template x-if="row.kind === 'segmented' || row.kind === 'charpicker'">
            <div class="prop prop--wide">
              <span x-text="row.prop.label"></span>
              <div class="style-btns">
                <template x-for="opt in row.prop.options" :key="opt">
                  <button type="button" class="style-btn"
                          :class="styleBtnClasses(row.prop, opt)"
                          :title="String(opt)"
                          @click="onPropSelect(row.prop, opt)"
                          x-text="propIcon(row.prop, opt)"></button>
                </template>
              </div>
            </div>
          </template>
          <template x-if="row.kind === 'select'">
            <label class="prop" :class="{ 'prop--wide': row.prop.wide }">
              <span x-text="row.prop.label"></span>
              <!-- The current value is bound per OPTION (:selected), not on
                   the select (:value): Alpine initializes an element's own
                   directives before its children, so a :value binding would
                   run while the x-for options don't exist yet and select
                   nothing (the first option shows until the selection
                   changes). The option binding runs when the option is
                   created, and re-runs on state changes like :value did -->
              <select @change="onPropSelect(row.prop, $event.target.value)">
                <template x-for="opt in row.prop.options" :key="opt">
                  <option :value="opt"
                          :selected="propValue(row.prop.key) === opt"
                          x-text="propIcon(row.prop, opt)"></option>
                </template>
              </select>
            </label>
          </template>
          <template x-if="row.kind === 'text'">
            <label class="prop prop--wide">
              <span x-text="row.prop.label"></span>
              <input type="text" :value="propValue(row.prop.key)"
                     :placeholder="isMixedProp(row.prop.key) ? '—' : ''"
                     @change="onPropText(row.prop, $event)">
            </label>
          </template>
          <!-- Multi-line text (the modal's Content field): a textarea,
               committed on blur/Enter like the other fields (@change) -->
          <template x-if="row.kind === 'textarea'">
            <label class="prop prop--wide">
              <span x-text="row.prop.label"></span>
              <textarea rows="6" spellcheck="false"
                        :value="propValue(row.prop.key)"
                        :placeholder="isMixedProp(row.prop.key) ? '—' : ''"
                        @change="onPropText(row.prop, $event)"></textarea>
            </label>
          </template>
        </div>
      </template>
    </div>
  </div>
</template>`;
    }

    var PGProperties = {
        PROPERTY_SCHEMA: PROPERTY_SCHEMA,
        findProperty: findProperty,
        readPropValue: readPropValue,
        rowsForProps: rowsForProps,
        sectionsForType: sectionsForType,
        buildPropsPanelHTML: buildPropsPanelHTML,
    };

    global.PGProperties = PGProperties;

    // Node.js (tests) — plain script in the browser, CommonJS export in Node
    if (typeof module !== "undefined" && module.exports) {
        module.exports = PGProperties;
    }
})(typeof window !== "undefined" ? window : globalThis);
