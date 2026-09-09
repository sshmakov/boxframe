# Суть проблемы

Размер макета (width×height) был жёстким ограничением в трёх местах:

1. **API** ограничивало размер макета 20–200 × 10–100 (`LayoutCreate`),
   форма New Layout дублировала лимиты (`min`/`max` на input'ах).
2. **Редактор** клампил все операции в границы макета (7 мест в
   `editor.js`: перевод пикселей в координаты сетки, drag&drop из
   палитры, перетаскивание, ресайз, дублирование, ввод X/Y и W/H).
3. **Рендерер** «обрезал» блоки, выходящие за сетку (клампинг в
   `_draw_border`/`_draw_content`/`_draw_line`) — в ASCII-экспорте блок
   за границей макета оказывался неполным, данные терялись.

В результате канвас нельзя было использовать как свободное пространство:
элементы нельзя было разместить за рамкой макета (например, спроектировать
компоненты, которые позже будут размещены в другом месте), а
машиночитаемый экспорт терял содержимое.

# Задача

- Снять ограничение на размер макета (API + форма New Layout).
- Разрешить размещение элементов за границами макета (редактор, оба
  режима рендеринга — web и static).
- Отображать линии границ макета на канвасе (визуальная рамка
  логического размера).
- Не менять формат псевдографики (AGENTS.md): рамка границ — только в
  HTML-превью, в ASCII не попадает.

# План работ

- [x] Составить план работ
- [x] Найти все точки ограничений (API, editor.js, рендерер)
- [x] API: снять верхние лимиты в `LayoutCreate` (осталось `ge=1`)
- [x] Рендерер Python: `canvas_size()` + расширение сетки в `render()`
- [x] Рендерер JS (`core/renderer.js`): `canvasSize()` + `render()` + `renderHtml()`
- [x] `editor.js`: убрать клампинг (7 мест), удалить неиспользуемые `layoutWidth`/`layoutHeight`
- [x] Ответ render (API + `renderHtml`): div `layout-bounds` — пунктирная рамка размера макета
- [x] CSS: стиль `.layout-bounds`
- [x] Форма New Layout: убрать `max`
- [x] Тесты: Python, JS, parity, API
- [x] Прогнать все тесты (unit/API + parity + e2e)

# Исследование

1. **Точки ограничений** — (а) `LayoutCreate`: `ge=20, le=200` /
   `ge=10, le=100`; (б) `editor.js`: 7 клампов — `_pixelToGrid`,
   `onCanvasDrop`, move/resize в `onCanvasMouseMove`, `duplicateBlock`,
   `updateSelectedXY`, `updateSelectedWH`; (в) рендерер: отрисовка
   обрезалась по размерам сетки.
2. **Расширение вместо обрезки** — размер канваса стал
   `max(размер макета, протяжённость блоков)`, дети учитываются с
   1-клеточным паддингом контейнера (как в
   `_render_children_in_container`). ASCII-экспорт стал полным: блок за
   границей макета рисуется целиком. Размер макета превратился в
   логическую рамку, а не в жёсткую границу.
3. **Рамка только на экране** — линии границ макета добавлены только в
   HTML-превью (div `.layout-bounds`: пунктирная рамка, z-index ниже
   блоков, `pointer-events: none`, tooltip с размером в ячейках). В ASCII
   не попадают — формат псевдографики не изменён (ядро продукта).
4. **Начало координат — единственная жёсткая граница** — отрицательные
   координаты не поддерживаются (канвас начинается от (0,0) макета);
   фронтенд сохраняет `Math.max(0, ...)`, новый бэкенд-валидации по x/y
   не добавлялось (в API её и не было).
5. **Два режима рендеринга** — web-режим (API `/render`) и
   static-режим (`PGRenderer.renderHtml`) генерируют одинаковую
   разметку, поэтому рамка границ работает в обоих.

# Выполнение задачи

**Новые файлы:** нет (только данный файл задачи).

**Изменённые файлы:**
- `boxframe/api/layouts.py` — `LayoutCreate`: `ge=1` без `le`;
  render-роут: размер канваса через `service.canvas_size(layout)`,
  `<pre>`/wrapper размеруются под канвас, добавлен div `layout-bounds`
  (пунктирная рамка W×H макета с tooltip).
- `boxframe/services/renderer.py` — classmethod
  `canvas_size(blocks, width, height)` (канвас = max(макет,
  протяжённость блоков, дети с 1-клеточным паддингом)); `render()`
  расширяет сетку перед отрисовкой.
- `boxframe/services/layout_service.py` — `canvas_size(layout)` для API.
- `boxframe/static/js/core/renderer.js` — `canvasSize()` (зеркало
  Python-версии), `render()` расширяет сетку, `renderHtml()` — размер
  канваса + div `layout-bounds`; `canvasSize` экспортирован в
  `PGRenderer`.
- `boxframe/static/js/editor.js` — убраны все клампы по границам макета
  (7 мест); сохранены минимальный размер (ресайз, ввод W/H) и начало
  координат (0,0); удалены неиспользуемые `layoutWidth`/`layoutHeight`.
- `boxframe/static/css/editor.css` — `.layout-bounds`: пунктирная рамка
  `rgba(233,69,96,.6)`, `pointer-events: none`, `z-index: 5` (ниже
  блоков).
- `boxframe/templates/pages/project.html` — форма New Layout: `min="1"`
  без `max`.
- `tests/test_renderer.py` — `test_grid_clamping` →
  `test_grid_expansion` (рамка рисуется целиком, не обрезается),
  `test_hline_clamped_to_grid` → `test_hline_beyond_layout` (линия на 20
  ячеек целиком), + `test_render_keeps_layout_size_when_blocks_fit`,
  `test_canvas_size_expands_for_blocks_outside_layout`,
  `test_canvas_size_counts_children`.
- `tests/js/test_renderer.js` — зеркала выше + `canvasSize` (3
  сценария) + `renderHtml` с `layout-bounds` (2 теста).
- `tests/test_js_renderer_parity.py` — `test_parity_grid_clamping` →
  `test_parity_grid_expansion`.
- `tests/api/test_layouts.py` — `test_layout_validation`: 0 отклоняется,
  500×200 разрешается; + `test_render_layout_with_block_outside_bounds`
  (блок за границей: полная коробка в ASCII, рамка в HTML).

## Проверка

- `pytest tests/ --ignore=tests/e2e` — **79 passed**.
- `node --test tests/js/test_renderer.js` — **34 passed**.
- Parity Python↔JS — **7 passed** (включая сценарий расширения канваса).
- `pytest tests/e2e/` — **29 passed**.

# Замечания

1. **E2E прогонялись против dev-сервера пользователя** — собственный
   uvicorn не смог занять порт 8000 (его держал сервер пользователя с
   `--reload`). Пути `/home/sshmakov/projects/boxframe` и
   `/media/sshmakov/home_disk/projects/boxframe` оказались одними и теми
   же файлами (bind mount, одинаковые inode) — сервер работал именно с
   этим кодом, включая изменения, поэтому e2e-результат валиден.
2. **Размер макета — теперь логическая рамка** — JSON-экспорт сохраняет
   исходные width/height, но ASCII-канвас может быть больше, если есть
   блоки за границей макета. Потребителям формата нельзя предполагать,
   что размер ASCII равен размеру макета.
3. **Рамки границ нет в ASCII** — намеренно (формат не изменён). Если
   понадобится помечать границы макета в экспорте — это отдельное
   изменение формата.
4. **Отрицательные координаты не поддерживаются** — начало координат
   канваса совпадает с (0,0) макета. Если понадобится «свободное
   пространство» во все стороны, нужен offset канваса — отдельная задача.
5. **`LayoutUpdate` валидации width/height не имеет** — как и раньше
   (в API там ограничений не было); `LayoutCreate` — `ge=1`.
