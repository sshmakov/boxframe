# Суть проблемы

У контейнера с детьми (box/grid) HTML-оверлей рисует рамку через CSS
`outline` на `.block-border` — и `outline` рисуется **снаружи**
border-box. Чтобы клипать детей, выходящих за контейнер, рендерер
добавлял `overflow:hidden` на сам `.block-preview` контейнера
(`renderer.py:523` / `renderer.js:1188`). `overflow:hidden` клипает всё,
что за padding-box элемента — а outline лежит ровно за ним → **outline
контейнера с детьми невидим** (у всех стилей рамки, не только
`border_style=none`).

Для bordered-блоков потеря незаметна: рамка видна в ASCII-слое (─│),
оверлейный outline — лишь полупрозрачный дубль. Для borderless-блока
outline — **единственная** визуальная подсказка о границе, поэтому
именно там бросалось в глаза (borderless box + дети → граница
не видна).

Пиксельная проверка (Playwright, колонка `x=left−1`): до фикса у
контейнера с детьми пиксели снаружи края идентичны фону (клип), без
детей — отличаются (outline виден).

# Задача

Сохранить **внешний** outline контейнера (не переводить во внутренний
`border` — рамка должна оставаться снаружи, как у всех стилей) при
рабочем клипе детей.

# План работ

- [x] Составить план работ
- [x] `services/renderer.py` + `static/js/core/renderer.js` —
      `_block_preview_html()`/`_blockPreviewHtml()`: убрать
      `overflow:hidden` из style `.block-preview`; детей обёрнуть в
      `<div class="block-clip">` (только когда дети есть)
- [x] `static/css/editor.css` — правило `.block-clip`
      (`position:absolute; inset:0; overflow:hidden`)
- [x] `static/js/editor.js` — `_unclipAncestors()`: во время group-move
      отпускать клип на `.block-clip`-обёртках предков (ранее — на
      `overflow` самих `.block-preview`)
- [x] Тесты: `tests/test_renderer.py` (4), `tests/js/test_renderer.js`
      (4), `tests/api/test_layouts.py` (1),
      `tests/test_js_renderer_parity.py` (docstring),
      `tests/e2e/test_editor.py` (1 — проверка клипа во время drag
      теперь по `.block-clip`)
- [x] Проверка: `pytest tests/ --ignore=tests/e2e` (321),
      `node --test "tests/js/*.js"` (387), `pytest tests/e2e/` (105,
      сервер на :8000, перезапущен через `scripts/server.sh restart`);
      пиксельные проверки (tmp/check_outline.py — синтетика,
      tmp/check_real_app.py — реальный редактор)

# Исследование

1. **Почему outline клипается.** CSS `outline` рисуется снаружи
   border-box элемента; `overflow:hidden` на предке клипает всё за его
   padding-box. `.block-border` сидит с `inset:0` внутри
   `.block-preview`, его outline попадает за край родителя → срезан.
   `box-shadow: 0 0 0 1px` клипается так же — внешний вариант
   (outline/box-shadow) при `overflow:hidden` не спасает, это
   поведение спецификации.
2. **Почему bordered-блоки «выглядели с рамкой».** Видимая рамка
   bordered-блока — ASCII-слой (`<pre>` под оверлеем), на который
   `overflow:hidden` оверлея не влияет. Оверлейный outline — дубль.
3. **Геометрия обёртки.** `.block-clip` с `inset:0` совпадает с
   padding-box родителя → координатное происхождение детей
   (`left/top` от padding-box) не меняется; клип-регион тот же.
   Outline родителя (на 1px за его краем) всегда ≥ `char_width−1px`
   внутри клип-региона предка (1-cell padding) → предком не клипается.
4. **Hit-test.** Клик/двойной клик/drag решаются координатно
   (`_blockAt()`), DOM-цель используется только для исключения UI
   (`.block-selection`, `.block-props`, ручки…) → прозрачная обёртка
   клипов не ломает взаимодействие. `_bindResizeHandles()` ищет ручки
   descendant-селектором — не затронуто.
5. **Group-move.** `_unclipAncestors()` (editor.js) во время drag
   группы снимал `overflow:hidden` с предков-`.block-preview`, чтобы
   тащимый блок был виден за границей контейнера. Цепочка предков
   теперь `… → .block-preview → .block-clip → .block-preview → …` —
   обход ведётся до canvas, отпускается каждый встреченный
   `.block-clip`.
6. **Воспроизведение.** Синтетическая страница с точными CSS-правилами
   (tmp/outline_check.html): до фикса кейсы «с детьми» (borderless и
   solid) — пиксели снаружи края = фону; после фикса — отличаются.

# Выполнение задачи

Клип детей перенесён с `.block-preview` на обёртку `.block-clip`:

- `renderer.py` / `renderer.js` — `_block_preview_html()` /
  `_blockPreviewHtml()`: из style `.block-preview` убран
  `overflow:hidden`; `children_html` при наличии детей оборачивается
  в `<div class="block-clip">…</div>` (после `.resize-handle`, как и
  раньше — порядок отрисовки детей поверх рамки родителя сохранён).
- `editor.css` — `.block-clip { position:absolute; inset:0;
  overflow:hidden; }` (общий файл для web- и static-редакторов).
- `editor.js` — `_unclipAncestors()`: обход до canvas, `overflow:
  visible` на каждом `.block-clip` (значения сохраняются для
  `_restoreClipping()`).

Тесты:
- `tests/test_renderer.py` / `tests/js/test_renderer.js` — 4 пары
  тестов переписаны: в теге `.block-preview` нет `overflow:hidden`,
  `.block-clip` присутствует у контейнеров (1 или 2 по глубине) и
  отсутствует у листьев;
- `tests/api/test_layouts.py` — `test_render_nested_three_levels_html_preview`:
  `html.count('class="block-clip"') == 2`;
- `tests/e2e/test_editor.py` — `test_drag_preselected_child_out_of_box_stays_visible`:
  mid-drag проверка `boxClips` теперь по computed overflow
  `.block-clip` контейнера (до фикса — по самому `.block-preview`).

Проверка:
- 321 py (unit+API), 387 js, 105 e2e — зелёные;
- пиксельно (Chromium, device_scale_factor=1):
  - синтетика (tmp/check_outline.py): outline виден снаружи — без
    детей, borderless с детьми, solid с детьми; ребёнок, выходящий за
    контейнер, клипан;
  - реальный редактор (tmp/check_real_app.py): borderless box 20×8 +
    text-ребёнок — колонка `x=left−1` ≠ фону, `.block-clip`
    `overflow:hidden`, `.block-preview` `overflow:visible`.

# Замечания

- Внешний outline сохранён (требование пользователя) — альтернатива
  «внутренний `border`» отклонена: рамка была бы на первой клетке
  блока, а не снаружи.
- Обратная совместимость: ASCII-формат не изменён; HTML-оверлей
  меняется структурно (доп. div), но геометрия детей и клип —
  идентичны, видимость bordered-блоков не меняется (их рамка — ASCII).
- Unit-тесты проверяют структуру (наличие `.block-clip`, отсутствие
  `overflow` в теге блока); пиксельную видимость outline ловит только
  e2e/ручная проверка — при правке CSS оверлея это учитывать.
