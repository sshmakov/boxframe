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
 *   kind     — number | segmented | select | charpicker | text
 *   options  — for segmented / select / charpicker
 *   icons    — optional option → glyph map (button labels)
 *   group    — section name (sections = unique groups, declaration order)
 *   types    — applicable block_type; omitted = all
 *   default  — value when absent (null = inherit/none)
 *   min/max  — for number
 *
 * Requires core/renderer.js (PGRenderer.BORDER_STYLES).
 */
(function (global) {
    "use strict";

    var BORDER_STYLES = global.PGRenderer.BORDER_STYLES;

    // The current properties first (phase 0 of tasks/0051): the panel is
    // reorganized into sections generated from this schema. New properties
    // (border_h/border_v, fill, arrows, alignment) are appended here in
    // phases 1-3.
    var PROPERTY_SCHEMA = [
        {
            key: "border_style",
            label: "Line Style",
            kind: "segmented",
            options: BORDER_STYLES,
            icons: { solid: "─", dashed: "┄", dotted: "┈", double: "═", none: "∅" },
            group: "Style",
        },
        // Per-side border overrides (phase 1 of tasks/0051): meta keys,
        // absent = inherit the base border_style. Not applicable to
        // button (its shapes don't map to 4 sides) or lines (global style).
        {
            key: "border_h",
            meta: true,
            label: "H",
            kind: "segmented",
            options: BORDER_STYLES,
            icons: { solid: "─", dashed: "┄", dotted: "┈", double: "═", none: "∅" },
            group: "Borders",
            types: ["box", "header", "footer", "sidebar", "content", "grid",
                    "input", "textarea", "text", "divider"],
            default: null,
        },
        {
            key: "border_v",
            meta: true,
            label: "V",
            kind: "segmented",
            options: BORDER_STYLES,
            icons: { solid: "─", dashed: "┄", dotted: "┈", double: "═", none: "∅" },
            group: "Borders",
            types: ["box", "header", "footer", "sidebar", "content", "grid",
                    "input", "textarea", "text", "divider"],
            default: null,
        },
        { key: "x", label: "X", kind: "number", group: "Geometry", min: 0 },
        { key: "y", label: "Y", kind: "number", group: "Geometry", min: 0 },
        { key: "width", label: "W", kind: "number", group: "Geometry", min: 1 },
        { key: "height", label: "H", kind: "number", group: "Geometry", min: 1 },
        { key: "order", label: "Order", kind: "number", group: "Geometry", min: 0 },
        { key: "content", label: "Content", kind: "text", group: "Text" },
    ];

    function findProperty(key) {
        for (var i = 0; i < PROPERTY_SCHEMA.length; i++) {
            if (PROPERTY_SCHEMA[i].key === key) return PROPERTY_SCHEMA[i];
        }
        return null;
    }

    // The effective value of a property on a block: meta properties read
    // block.meta[key] (absent → default), the rest read block[key].
    function readPropValue(block, prop) {
        var v = prop.meta
            ? (block.meta ? block.meta[prop.key] : undefined)
            : block[prop.key];
        if (v === undefined || v === null) {
            return prop.default !== undefined ? prop.default : null;
        }
        return v;
    }

    // Sections for a block type: unique groups in declaration order, each
    // with the properties applicable to the type (types omitted = all).
    // Groups with no applicable property are dropped.
    function sectionsForType(blockType) {
        var sections = [];
        var byName = {};
        for (var i = 0; i < PROPERTY_SCHEMA.length; i++) {
            var prop = PROPERTY_SCHEMA[i];
            if (prop.types && prop.types.indexOf(blockType) === -1) continue;
            if (!byName[prop.group]) {
                byName[prop.group] = { name: prop.group, props: [] };
                sections.push(byName[prop.group]);
            }
            byName[prop.group].props.push(prop);
        }
        return sections;
    }

    // The panel body markup. A constant string — the reactivity lives in
    // the host app's panelSections getter and the per-property bindings.
    // The Alpine directives resolve against the editor app:
    //   panelSections — sections for the selected block's type
    //   isSectionOpen / toggleSection — open/closed state (persisted)
    //   propValue / isMixedProp / propActive — selection values (mixed =
    //   the values differ across the multi-selection)
    //   onPropNumber / onPropText / onPropSelect — change handlers
    function buildPropsPanelHTML() {
        return `
<template x-for="section in panelSections" :key="section.name">
  <div class="props-section">
    <button type="button" class="props-section__head"
            @click="toggleSection(section.name)">
      <span class="props-section__title" x-text="section.name"></span>
      <span class="props-section__chev"
            :class="{ 'props-section__chev--open': isSectionOpen(section.name) }">▸</span>
    </button>
    <div class="props-section__body" x-show="isSectionOpen(section.name)" x-cloak>
      <!-- Alpine's x-for/x-if clone only the FIRST element child of the
         template content, so each iteration needs a single root: the
         .prop-cell wrapper (display:contents — the inner control stays
         the grid item). -->
      <template x-for="prop in section.props" :key="prop.key">
        <div class="prop-cell">
          <template x-if="prop.kind === 'number'">
            <label class="prop prop--inline">
              <span x-text="prop.label"></span>
              <input type="number" :min="prop.min != null ? prop.min : 0"
                     :value="propValue(prop.key)"
                     :placeholder="isMixedProp(prop.key) ? '—' : ''"
                     @change="onPropNumber(prop, $event)">
            </label>
          </template>
          <template x-if="prop.kind === 'segmented' || prop.kind === 'charpicker'">
            <div class="prop prop--wide">
              <span x-text="prop.label"></span>
              <div class="style-btns">
                <template x-for="opt in prop.options" :key="opt">
                  <button type="button" class="style-btn"
                          :class="{ 'style-btn--active': propActive(prop.key, opt) }"
                          :title="String(opt)"
                          @click="onPropSelect(prop, opt)"
                          x-text="(prop.icons && prop.icons[opt]) || opt"></button>
                </template>
              </div>
            </div>
          </template>
          <template x-if="prop.kind === 'select'">
            <label class="prop prop--wide">
              <span x-text="prop.label"></span>
              <select :value="propValue(prop.key)"
                      @change="onPropSelect(prop, $event.target.value)">
                <template x-for="opt in prop.options" :key="opt">
                  <option :value="opt" x-text="String(opt)"></option>
                </template>
              </select>
            </label>
          </template>
          <template x-if="prop.kind === 'text'">
            <label class="prop prop--wide">
              <span x-text="prop.label"></span>
              <input type="text" :value="propValue(prop.key)"
                     :placeholder="isMixedProp(prop.key) ? '—' : ''"
                     @change="onPropText(prop, $event)">
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
        sectionsForType: sectionsForType,
        buildPropsPanelHTML: buildPropsPanelHTML,
    };

    global.PGProperties = PGProperties;

    // Node.js (tests) — plain script in the browser, CommonJS export in Node
    if (typeof module !== "undefined" && module.exports) {
        module.exports = PGProperties;
    }
})(typeof window !== "undefined" ? window : globalThis);
