# Суть проблемы

`divider` дублировал роль `hline`, но рендерился как обычный блок с полной
рамкой (дефолт 20×3, hint `[divider]`) — особой отрисовки не было (пробел
зафиксирован в 0014, замечание 1; повторный аудит 2026-10-22 в
todo-0001). В бэклоге (todo-0001, приоритет 1) стояло решение: «убрать из
`BLOCK_TYPES` (роль закрывает `hline`) или дать отрисовку линии». Все пять
дизайн-вариантов (удаление / алиас `hline` / labeled divider одной строки /
D — многострочная подпись с autosize / E — мультилинейный) зафиксированы в
`tasks/backlog/todo-0003-divider-design.md`. 2026-10-28 принято финальное
решение: **вариант E** (линия на каждой строке, подпись поверх каждой
строки, autosize только роста).

# Задача

Реализовать вариант E для `divider`:

- линия на **каждой** строке сохранённого размера (символ по
  `border_style`, `none` → невидима);
- подпись (content) — строками **как есть** (без word-wrap и схлопывания
  пробелов), поверх линии строки (контент выигрывает); пробелы подписи
  «раздвигают» линию;
- выравнивание каждой строки независимо (`meta.text_align`, дефолт
  `center`); `vertical_align`, стрелки, fill — не применяются
  (`vertical_align` включён позже — 0058, дефолт `middle`);
- autosize **только роста**: при создании/обновлении
  `width = max(width, самая длинная строка)`, `height = max(height,
  число строк)`; сжатие при уменьшении контента не выполняется (в отличие
  от `text` 0049); ручной resize свободный (min 1×1); `replace_blocks`
  (undo/redo) без пересчёта;
- старые макеты не мигрируются: рендер в рамках сохранённого размера
  (пустой 20×3 → 3 параллельные линии);
- дети не поддерживаются (атомарный элемент);
- HTML-оверлей — сегменты линии (до 2 div на строку вокруг подписи), т.к.
  оверлей лежит поверх ASCII-слоя;
- поведение одинаковое в web-режиме (API) и static-режиме (JS-стор) —
  инвариант parity проекта.

# План работ

- [x] Составить план работ (спека — `tasks/backlog/todo-0003-divider-design.md`)
- [x] `services/renderer.py` — `divider_fit_size()` + `_draw_divider()`
      (линия на каждой строке + строки подписи поверх, выравнивание
      `h_align_offset()` + `meta.text_align`) + ветка в `_render_block()`;
      HTML-превью — `_line_segment_html()` / `_divider_segments_html()`
- [x] `static/js/core/renderer.js` — порт (parity побайтово):
      `dividerFitSize`, `drawDivider`, `lineSegmentHtml`,
      `dividerSegmentsHtml`
- [x] `services/layout_service.py` — autosize только роста:
      `create_block`, `update_block` (триггеры `content`/`block_type`),
      `batch_blocks` (create + update); `replace_blocks` — без пересчёта
- [x] `static/js/core/store.js` — `normalizeDivider` +
      `dividerAutosizeTriggered` в `createBlock`, `updateBlock`,
      `batchBlocks`; `replaceState` — без нормализации
- [x] `static/js/editor.js` — `_blockDefaults`: `divider` → 20×1,
      content `''`; min 1×1 при resize (одиночный + групповой);
      `_childrenRendered`: divider → false
- [x] `static/js/core/properties.js` — `text_align`: `typeDefaults:
      { divider: "center" }` + `clearDefault`; `vertical_align`: divider
      убран из `types`
- [x] CSS — `.block-line--seg` (сегменты линии: inline top/left/width,
      `left/right/top: auto`)
- [x] Тесты: `tests/test_renderer.py`, `tests/js/test_renderer.js`,
      `tests/test_js_renderer_parity.py`, `tests/api/test_layouts.py`,
      `tests/js/test_store.js`
- [x] Документация: AGENTS.md (секция `divider`), todo-0001 (пункт
      закрыт), todo-0003 (решение зафиксировано, план отмечен выполненным)
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/` (сервер на :8000)

# Исследование

1. **Дизайн-основа.** Все варианты и их трейд-оффы — в
   `tasks/backlog/todo-0003-divider-design.md` (обсуждения 2026-10-22,
   2026-10-25; правила E уточнены 2026-10-28). Вариант E — развитие D:
   вместо одной линии на средней строке — линия на каждой строке (нет
   расчёта средней строки, цикл проще), но новый HTML-оверлей (сегменты).
2. **Autosize только роста — новый паттерн.** У `text` (0049) fit-размер
   точный (`text_block_size`): блок всегда равен размеру контента +
   рамки. У divider размеры — «не меньше контента»: `max(сохранённое,
   контент)`. Отдельная функция `divider_fit_size(content, width, height)`
   (не переиспользовать `text_block_size` — разные правила). Триггеры
   пересчёта — `content`/`block_type` (в отличие от `text`, где ещё и
   `border_style` — рамка divider не влияет на размер).
3. **HTML-оверлей — два независимых пути.** Активный путь редактора/API —
   `PseudoGraphicRenderer.render_html_preview()` / `_block_preview_html()`
   (Python) и `renderHtmlPreview` / `_blockPreviewHtml` (JS). Второй путь —
   `RenderBlock.to_html_preview()` / `_border_html()` (Python) и
   `toHtmlPreview` (JS) — отдельная реализация, которая **не** дублирует
   первую: divider-ветку нужно добавлять в обе. В JS-пути
   `renderHtmlPreview` строит node из плоского блока — `content` в него
   копировать явно (иначе divider видит пустой контент).
4. **Сегменты вместо сплошной линии.** Оверлей лежит поверх ASCII-слоя:
   сплошной CSS-линией на всю строку пересекли бы текст подписи. На
   каждую строку — до 2 div (левый/правый отрезок вокруг подписи),
   позиция/ширина вычисляются из выравнивания строки
   (`h_align_offset`); пустая строка — один div на всю ширину.
   Style-классы (dashed/dotted/double) переиспользуются.
5. **Совместимость.** `block_type` в БД — свободная строка; старые 20×3
   `divider` не мигрируются и рендерятся в рамках сохранённого размера по
   новым правилам (пустой → 3 параллельные линии, подписанный → подпись
   поверх каждой строки). `BLOCK_TYPES` не меняется — палитра остаётся 14,
   e2e-тесты на число кнопок не трогаются.
6. **Дефолт `text_align`.** Механизм `typeDefaults` в `properties.js`
   (0051–0054) позволяет задать type-specific default без изменения общей
   схемы: `divider` → `center`, `clearDefault: true`.

# Выполнение задачи

## Python

- `services/renderer.py`:
  - `divider_fit_size(content, width, height)` — grow-only fit (модульная
    функция рядом с `text_block_size`);
  - `_draw_divider()` — цикл по строкам: линия `style["h"]` на всю ширину
    (`none` → не рисуется), строка подписи поверх как есть, смещение —
    `h_align_offset(len(line), width, align)`; дети/стрелки/fill
    игнорируются;
  - ветка `elif block_type == "divider"` в `_render_block()`;
  - `_line_segment_html()` / `_divider_segments_html()` — сегменты
    HTML-оверлея; ветки в `_block_preview_html()` **и** `_border_html()`
    (второй путь `to_html_preview`);
- `services/layout_service.py`:
  - `create_block`: `width, height = divider_fit_size(content, width,
    height)` для `divider`;
  - `update_block`: пересчёт при `"content" in kwargs or "block_type" in
    kwargs`;
  - `batch_blocks`: create + update — то же;
  - `replace_blocks`: без пересчёта (комментарий: text и divider
    восстанавливаются как есть).

## JS (parity)

- `core/renderer.js` — `dividerFitSize`, `drawDivider`,
  `lineSegmentHtml`, `dividerSegmentsHtml`; ветки в `renderBlock` и
  `_blockPreviewHtml`; `dividerFitSize` экспортируется в `PGRenderer`.
- `core/store.js`:
  - `normalizeDivider(block)` (grow-only через
    `PGRenderer.dividerFitSize`) + `dividerAutosizeTriggered(props)`
    (`"content" in props || "block_type" in props`);
  - `createBlock` — нормализация всегда для `divider`; `updateBlock` /
    `batchBlocks.update` — по триггеру; `replaceState` — без нормализации.
- `editor.js`:
  - `_blockDefaults("divider")` → `{ width: 20, height: 1, content: '' }`;
  - min-размер при resize: `divider` → 1×1 (одиночный mousemove-путь и
    групповой commit-путь);
  - `_childrenRendered`: divider → false (атомарный).
- `properties.js`: `text_align` — `typeDefaults: { divider: "center" }` +
  `clearDefault: true`; `vertical_align` — divider убран из `types`.
- `editor.css`: `.block-line--seg` (сброс `left/right/top` до inline-значений).

## Тесты

- `tests/test_renderer.py` — 13 ASCII-тестов (fit size, пустой = N линий,
  центрирование, многострочный, пробелы раздвигают линию, выравнивание
  left/center/right, обрезка по ширине, рост строк, все стили, `none`,
  игнор детей, игнор arrows/fill, в контейнере) + 3 HTML-теста (пустой —
  один div, сегменты вокруг подписи, подпись на всю строку).
- `tests/js/test_renderer.js` — зеркала тех же 13 + 3 HTML-кейса.
- `tests/test_js_renderer_parity.py` — `test_parity_divider_ascii` (13
  кейсов), `test_parity_divider_in_container`, `test_parity_divider_html`
  (5 кейсов), `test_parity_divider_fit_size` (8 кейсов) — Python ↔ JS
  побайтово.
- `tests/api/test_layouts.py` — 7 тестов autosize: рост при создании
  ((2,1)+«a\nbb\nccc»→(3,3)), пустой сохраняет размер, рост при обновлении
  (20×1→20×3), отсутствие сжатия (20×3→«a»→""→20×3), ручной resize
  сохраняется (20×1→1×1→«abcdefgh»→8×1), перевод box→divider, batch
  (create+update); `replace_blocks` — без пересчёта (5×1 с «abcdefgh» и
  20×3 пустой восстанавливаются как есть).
- `tests/js/test_store.js` — 5 тестов (рост при создании, рост без
  сжатия, ручной resize до следующего изменения контента, batch,
  replaceState как есть).

## Проверка

- `pytest tests/ --ignore=tests/e2e` — 223 passed;
- `node --test "tests/js/*.js"` — 296 passed;
- `pytest tests/e2e/` (сервер на :8000, `scripts/server.sh`) — 84 passed.

# Замечания

1. **Два паттерна autosize сосуществуют.** `text` — точный fit
   (`text_block_size`), `divider` — grow-only (`divider_fit_size`).
   Функции не переиспользуют друг друга — правила разные; при добавлении
   типов с особым размером не «чинить» одну через другую.
2. **HTML-превью — два пути, править оба.** `render_html_preview`/
   `_block_preview_html` (активный) и `to_html_preview`/`_border_html`
   (второй) — независимые реализации; особая отрисовка типа нужна в обеих.
   В JS-пути `renderHtmlPreview` node строится из плоского блока — новые
   поля (как `content` для divider) копировать явно.
3. **Сегменты — общий приём для «линия + текст» в оверлее.** Если
   появятся другие типы с текстом поверх линии (например, реализация
   варианта D для `hline`), переиспользовать `_line_segment_html`/
   `lineSegmentHtml`, а не рисовать сплошную линию.
4. **Старые макеты не мигрируются — осознанно.** Пустой 20×3 `divider`
   теперь отрисовывается как 3 параллельные линии. Если это назовут
   регрессией — решение зафиксировано в todo-0003 (вопрос 4), миграция не
   планируется.
5. **Триггеры autosize divider уже уже, чем у text.** `border_style`
   не пересчитывает размер divider (рамки нет — только символ линии).
   Не расширять триггеры без изменения спеки.
6. **Палитра без изменений (14).** `BLOCK_TYPES` не тронут — e2e-тесты на
   число кнопок статической палитры (2 места в `test_editor.py`) не
   требовали правок.
7. **Кросс-ссылки:** todo-0001 (пункт `divider` закрыт), todo-0003
   (финальное решение + закрытый план), 0014 (замечание 1), 0051–0054
   (механизм `meta`/`typeDefaults`), 0058 (вертикальное выравнивание
   подписи + дефолты нового блока 30×1 `[divider]` — правило
   «vertical_align не применяется» заменено).
