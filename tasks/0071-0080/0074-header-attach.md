# Суть проблемы

`header` — «только имя» (аудит todo-0001): отрисовка идентична `box`
(общий путь `_draw_border()` + `_draw_content()`), характерной
отрисовки нет. Когда `header` вставлен дочерним в `box` и прижат к
верхней стороне, он должен «прилипать» к верху: отключаются верхняя,
левая и правая стороны рамки, остаётся только нижняя линия на всю
внутреннюю ширину `box`, и она соединяется (junction) с рамкой `box`.
Визуально `header` «сидит» сверху содержимого `box`, отделённый от него
линией. Спецификация — `tasks/backlog/todo-0007-header-attach.md`.

# Задача

Дать `header` характерную отрисовку в режиме «приклеен к верху `box`»:
без верхней/левой/правой рамки, только нижняя линия на всю внутреннюю
ширину `box` и junctions с рамкой `box`. Закрыть пункт todo-0001 по
`header` (приоритет 2).

# План работ

- [x] Составить план работ
- [x] `services/renderer.py`: `RenderBlock.attached`; эффективная
      геометрия в `_render_children_in_container`; ветка
      `_draw_attached_header`; junctions `_draw_attached_header_junctions`
      (box-путь, после `_draw_border`); HTML-оверлей
      `_attached_header_line_html` + `effective`/`attached` в
      `_block_preview_html`
- [x] `static/js/core/renderer.js` — порт (parity побайтово):
      `drawAttachedHeader`, `drawAttachedHeaderJunctions`,
      `attachedHeaderLineHtml`, `effective`/`attached` в
      `_blockPreviewHtml`
- [x] `static/js/editor.js`: `_absoluteRect` (эффективная геометрия),
      `onCanvasDrop` (снап `x=0, y=0, width=container.width−2`),
      move-drag-превью и `_startResizeDrag` — по эффективной геометрии
- [x] Тесты: `tests/test_renderer.py` (14 новых),
      `tests/js/test_renderer.js` (11 новых),
      `tests/test_js_renderer_parity.py` (3 новых: ASCII + grid + HTML)
- [x] AGENTS.md — пункт про `header` в разделе «Блоки»
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/` (сервер на :8000)

# Исследование

1. **Ключевые решения (согласованы, todo-0007):** условие — относительная
   `y <= 0`, родитель только `box` (`grid` вне scope); приклеенный
   `header` всегда на всю внутреннюю ширину `box` (эффективная геометрия
   `x=0, y=0, w=inner_w` — render-time вывод, как перегородки `grid`, не
   изменение данных); линия — свой `border_style` `header`'а, junctions —
   style map `box`'а; родитель без рамки — линия без junctions; при
   resize `box` `header` следует за шириной.
2. **Junctions рисует родитель.** Ребёнок клипнут во внутреннюю область
   (`_render_children_in_container` / `renderChildrenInContainer`), не
   может дописать клетки рамки `box` → junctions `├`/`┤` рисует сам
   контейнер по реально отрисованным линиям (паттерн frame-узлов `grid`,
   0063). Рисуется, только если линия рисуется (`ch <= inner_h`,
   `border_style != none`) и у `box` есть рамка.
3. **Клип при `ch > inner_h`.** Строка линии `py+ch` выходит за внутреннюю
   область → `_set`/`setCell` её отбрасывают (нижнюю границу задаёт рамка
   `box`), junctions не рисуются (проверка `child.height > inner_h`).
4. **HTML-оверлей.** Для attached-`header` — позиционирование по
   эффективной геометрии + нижняя линия вместо полного outline (переиспользую
   `.block-line--h.block-line--seg` с inline `top`/`left`/`width`, как у
   сегментов `divider`); новый CSS-класс не потребовался.
5. **Редактор.** `_absoluteRect` — центральная точка абсолютной геометрии
   (hit-test/selection/drag/drop-target) → эффективная геометрия
   встраивается туда (проверка attach — только на уровне **прямого**
   родителя, не на каждом предке). `onCanvasDrop` снапит `header` в `box`
   к `x=0, y=0, width=container.width−2`.
6. **Обратная совместимость.** Старый макет, где `header` случайно лежит
   при `y=0` в `box`, рендерится иначе (без трёх сторон рамки). Вероятность
   мала; формальное отклонение от правила — согласовано как исключение
   (todo-0007, замечание 2).

# Выполнение задачи

- `services/renderer.py`:
  - `RenderBlock.attached: bool = False`;
  - `_render_children_in_container` — для `header`-ребёнка `box` с
    `y <= 0`: эффективная геометрия (`x=px+1, y=py+1, w=inner_w`) +
    `attached=True` (иначе — обычный расчёт + `attached=False`);
  - `_render_block` — ветка `header`+`attached`: `_draw_attached_header`
    (без верх/лево/право, нижняя линия, контентная область) + дети;
  - `_draw_attached_header` — нижняя линия (свой `border_style`) в
    последней строке, контентная область (полная ширина × `h−1`/`h`),
    fill / hide_text / hint `[header]` / word-wrap + h/v align (как
    `_draw_content`);
  - box-путь `_render_block` — после `_draw_border`:
    `_draw_attached_header_junctions` (`├`/`┤` в строке `py+ch`);
  - `_attached_header_line_html` + `effective`/`attached` в
    `_block_preview_html` (эффективная геометрия + линия вместо outline;
    для детей `box` вычисляется рекурсивно).
- `static/js/core/renderer.js` — зеркально (побайтовый parity):
  `drawAttachedHeader`, `drawAttachedHeaderJunctions` (фильтрует
  `allBlocks` по `parent_id`), `attachedHeaderLineHtml`, `attached` в
  `renderChildrenInContainer`, ветка в `renderBlock`, `effective`/
  `attached` в `_blockPreviewHtml`.
- `static/js/editor.js`:
  - `_absoluteRect` — эффективная геометрия attached-`header` (до обхода
    предков, по прямому родителю);
  - `onCanvasDrop` — `dragType === 'header'` и контейнер-`box` → снап
    `x=0, y=0, width=container.width−2`;
  - move-drag-превью и `_startResizeDrag` (одиночный блок) — размеры из
    `_absoluteRect` (эффективная геометрия).

Тесты:
- `tests/test_renderer.py` — 14 новых: attached-рендер (без 3 сторон,
  линия, junctions, контентная область), `ch == 1` (только линия),
  `ch > inner_h` (линия клипнута, junctions нет), родитель без рамки
  (линия без junctions), dashed-линия в solid box, `border_style=none`
  (нет линии), отклеенный (`y>0`) — обычный box, resize `box` — следует за
  шириной, hint `[header]`, fill/hide_text, `header` в `grid` (без
  изменений), HTML-оверлей (attached/dashed/detached);
- `tests/js/test_renderer.js` — 11 зеркальных тестов;
- `tests/test_js_renderer_parity.py` — `test_parity_attached_header`
  (11 ASCII-кейсов), `test_parity_attached_header_in_grid`,
  `test_parity_attached_header_html` (5 кейсов).

Проверка: 353 py (unit+API+parity), 415 js, 106 e2e — зелёные;
parity — побайтово.

# Замечания

- **Несколько attached-`header` в одном `box`** — отдельная follow-up
  задача: приклеенные `header` выстраиваются по высоте друг за другом
  согласно z-order. В задаче 0074 несколько attached-`header` рендерятся
  независимо (линии могут пересекаться) — наложение не обрабатывается.
- Это ограниченное воскрешение per-side границ (удалены в 0051-фазе 1) —
  но как **type-specific поведение `header`**, а не общий механизм сторон
  рамки. Не расползать на другие типы.
- `grid` как родитель — вне scope: `header` внутри `grid` рендерится как
  обычный box (общий путь).
- Кросс-ссылки: todo-0001 (пункт `header`), 0063 (junctions `grid`),
  0051-фаза 1 (per-side границы удалены), todo-0005 (`grid`, render-time
  вывод геометрии).
