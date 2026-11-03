# Суть проблемы

В панели свойств секция `Align` покрывала только выравнивание текста, а
скрываемость текста в панели отсутствовала: чтобы показать блок без
текста (рамка без подписи, «заглушка»-бокс, divider без label) приходилось
вычищать `content` вручную — а hint `[type]`, lorem-плейсхолдер `content`
и label `button`/`divider` при этом продолжали рисоваться. Название
секции не отражало полного набора текстовых свойств блока.

# Задача

Переименовать секцию `ALIGN` в `TEXT` и добавить в неё иконку для скрытия
текста: один переключатель (eye / eye-off), который пишет
`meta.hide_text` — подавляет контент, hint `[type]`, lorem-плейсхолдер,
label кнопки и подпись divider; рамка и `meta.fill` сохраняются.

# План работ

- [x] Составить план работ
- [x] `core/properties.js` — секция `Text` (бывш. `Align`), новое
      свойство `hide_text` (`kind: "toggle"`, `iconPrefix: "text"`)
- [x] `editor.js` — `toggleOpt`/`toggleTitle`, `styleBtnClasses` для
      toggle, `onPropSelect` (flip: все скрыты → показать, иначе скрыть
      всех)
- [x] `services/renderer.py` + `static/js/core/renderer.js` —
      подавление текста при `meta.hide_text` в `_draw_content` /
      `_draw_button` / `_draw_divider` (parity)
- [x] Иконки `static/icons/text-eye.svg`, `text-eye-off.svg` + CSS-маски
      в `editor.css` (data: URI, file://-совместимо)
- [x] Тесты: `tests/test_renderer.py` (9), `tests/js/test_renderer.js`
      (9), `tests/test_js_renderer_parity.py` (25 кейсов),
      `tests/js/test_properties.js` (схема + 3 toggle-теста),
      `tests/e2e/test_editor.py` (новый toggle-тест + обновлённые
      локейторы/счётчики секций)
- [x] Проверка: `pytest tests/ --ignore=tests/e2e` (331),
      `node --test "tests/js/*.js"` (399), `pytest tests/e2e/` (106,
      сервер на :8000, перезапущен через `scripts/server.sh restart`)

# Исследование

1. **Панель — schema-driven.** Секции/строки панели генерируются из
   `PROPERTY_SCHEMA` (`core/properties.js`) через
   `buildPropsPanelHTML()` — переименование секции не требует правок
   шаблонов (web и static используют один генератор). Имена секций —
   ключи Alpine `x-for` → должны быть уникальны: переименование
   `Align` → `Text` столкнулось бы с группой textarea `content`
   (тоже `group: "Text"`) → её группа переименована в `Content`.
2. **Новый `kind: "toggle"`.** Одна кнопка, показывающая иконку
   **текущего** состояния (eye — текст виден, eye-off — скрыт); список
   опций для цикла кнопок — `[toggleOpt(prop)]`. Клик инвертирует:
   все выделенные скрыты → показать (null — meta-ключ очищается,
   дефолт имплицитный), иначе/смешанное → скрыть всех. Смешанное
   выделение читается как «виден» (`propValue` → `""` → eye).
3. **Иконки.** По существующему паттерну выравнивания: SVG в
   `static/icons/`, маска data: URI в `editor.css`
   (`.style-btn--text-eye::before` / `--text-eye-off::before`) —
   работает из `file://`; fallback-текст (👁/🚫) скрывается CSS только
   после проверки загрузки маски (`align-icons-ok`).
4. **Область действия.** HTML-оверлей рамку/линии рисует, текст не
   рисует → `hide_text` влияет только на ASCII-слой. `meta` в API —
   свободный `dict` → изменений API-схем не требуется.
5. **Обратная совместимость.** `hide_text` отсутствует/`false` —
   рендер идентичен предыдущим версиям (проверено тестами
   `test_hide_text_false_and_absent_render_as_before` + parity).

# Выполнение задачи

- `core/properties.js`:
  - `text_align`/`vertical_align` — `group: "Text"`, `row: "text"`,
    `rowLabel: "Text"`;
  - новое свойство `hide_text`: `meta: true`, `kind: "toggle"`,
    `iconPrefix: "text"`, `icons: { eye: "👁", "eye-off": "🚫" }`,
    `group: "Text"`, `row: "text"`, `default: false`,
    `panel: "primary"`, `types`: box, header, footer, sidebar,
    content, button, input, textarea, image, divider, text (без
    hline/vline/grid);
  - `content` (textarea) — `group: "Content"` (уникальность имён
    секций);
  - строка группы в `buildPropsPanelHTML`: опции `[toggleOpt(prop)]`,
    `:title="toggleTitle(prop)"`, обёртка с классом
    `style-btns--toggle`.
- `editor.js`:
  - `toggleOpt(prop)` — текущая иконка (`eye-off` ⇔ скрыт);
  - `toggleTitle(prop)` — действие кнопки (`Hide text` / `Show text`);
  - `styleBtnClasses` — для toggle активна кнопка, если значение
    стоит (opt `eye-off`) и выделение не смешанное;
  - `onPropSelect` — ветка toggle: `allHidden ? null : true`.
- `services/renderer.py`:
  - `_draw_content` — после fill: `if (block.meta or {}).get("hide_text"): return`
    (fill остаётся, контент/hint/лолем подавляются);
  - `_draw_button` — label: `if block.content and not …hide_text`;
  - `_draw_divider` — блок подписи под `if not …hide_text` (линия
    остаётся).
- `static/js/core/renderer.js` — зеркально в `drawContent` /
  `drawButton` / `drawDivider` (побайтовый parity).
- `static/icons/text-eye.svg`, `text-eye-off.svg` — контур глаза
  (evenodd + зрачок) и глаз с перечёркивающей диагональю, 24×24.
- `editor.css` — маски `.style-btn--text-eye::before` /
  `.style-btn--text-eye-off::before` (data: URI, percent-encoded);
  `.style-btns--toggle .style-btn { flex: none; width: 30px; }` —
  единственная кнопка в строке группы не растягивается.
- Шаблоны (`templates/pages/editor.html`, `static/editor/index.html`) —
  только комментарии (список секций).

Тесты:
- `tests/test_renderer.py` — секция «Hide text»: box (контент, hint,
  fill остаётся, false/absent как раньше), content-плейсхолдер,
  button (h=3 и h=1), divider, borderless text;
- `tests/js/test_renderer.js` — 9 зеркальных тестов;
- `tests/test_js_renderer_parity.py` — `test_parity_hide_text`: 25
  кейсов (11 типов блоков × комбинации fill/hide_text/border none);
- `tests/js/test_properties.js` — схема (`hide_text` в ключах,
  toggle-атрибуты, панель primary), секции (`["Style", "Fill", "Text",
  "Geometry", "Content"]`, строка группы Text с 3 свойствами),
  3 новых toggle-теста (`toggleOpt`/`toggleTitle`, `styleBtnClasses`,
  flip в `onPropSelect`);
- `tests/e2e/test_editor.py` — `test_properties_panel_hide_text_toggle`
  (иконка eye → клик → `meta.hide_text: true` в БД → eye-off active →
  клик → ключ очищен); секционные локейторы `data-section="Text"` /
  `"Content"`, счётчики кнопок Text-секции 6 → 7.

Проверка: 331 py (unit+API+parity), 399 js, 106 e2e — зелёные.

# Замечания

- Обратная совместимость сохранена: `hide_text` — опция, отсутствующая
  в старых макетах; рендер старых макетов не меняется.
- Имена секций — ключи Alpine `x-for`: при добавлении свойств в
  `properties.js` следить за уникальностью `group` (текст-свойства —
  `Text`, textarea — `Content`).
- Toggle в строке группы — единственный `kind`, у которого кнопка
  показывает текущее состояние, а не опцию; при добавлении новых
  toggle-свойств переиспользовать `toggleOpt`/`toggleTitle`/ветку
  `onPropSelect` (семантика: mixed → «выключено», клик включает всем).
- Смешанное выделение: клик скрывает текст всем (даже если часть уже
  скрыта) — осознанная упрощённая семантика (одна кнопка, два
  состояния).
