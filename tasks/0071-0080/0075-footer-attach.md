# Суть проблемы

`footer` — «только имя» (аудит todo-0001): отрисовка идентична `box`
(общий путь `_draw_border()` + `_draw_content()`), характерной
отрисовки нет. Зеркальная задача к `header`-attach (todo-0007, 0074):
когда `footer` вставлен дочерним в `box` и прижат к нижней стороне, он
«прилипает» к низу — отключаются нижняя, левая и правая стороны рамки,
остаётся только верхняя линия на всю внутреннюю ширину `box`, и она
соединяется (junction) с рамкой `box`. Визуально `footer` «сидит» внизу
содержимого `box`, отделённый от него линией. Спецификация —
`tasks/backlog/todo-0008-footer-attach.md`.

# Задача

Дать `footer` характерную отрисовку в режиме «приклеен к низу `box`»:
без нижней/левой/правой рамки, только верхняя линия на всю внутреннюю
ширину `box` и junctions с рамкой `box`. Закрыть пункт todo-0001 по
`footer` (приоритет 2). Одновременно **унифицировать** код
attached-рендера с `header` (решение 2026-11-05) — общий алгоритм,
сторона (top/bottom) выводится из `block_type`; подготовка к
прилипанию `sidebar` (отдельная спека, follow-up).

# План работ

- [x] Составить план работ
- [x] `services/renderer.py`: унификация + footer —
      `_draw_attached_header` → `_draw_attached` (сторона из типа),
      `_draw_attached_header_junctions` → `_draw_attached_junctions`,
      `_attached_header_line_html` → `_attached_line_html` (+сторона),
      условие для `footer` в `_render_children_in_container`
      (`y + h >= inner_h` → эффективная геометрия `x=px+1,
      y=py+1+inner_h−h, w=inner_w`), ветка в `_render_block`,
      HTML-оверлей (effective/attached для детей-`footer`)
- [x] `static/js/core/renderer.js` — порт (parity побайтово):
      `drawAttached`, `drawAttachedJunctions`, `attachedLineHtml`,
      условие в `renderChildrenInContainer`, ветка в `renderBlock`,
      `effective`/`attached` в `_blockPreviewHtml`
- [x] `static/js/editor.js`: `_absoluteRect` (эффективная геометрия
      attached-`footer`), `onCanvasDrop` (снап
      `x=0, y=container.height−2−h, width=container.width−2`)
- [x] Тесты: `tests/test_renderer.py` (16 новых),
      `tests/js/test_renderer.js` (13 новых),
      `tests/test_js_renderer_parity.py` (3 новых: ASCII + grid + HTML)
- [x] AGENTS.md — пункт про `footer` в разделе «Блоки»
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/` (сервер на :8000)

# Исследование

1. **Ключевые решения (согласованы 2026-11-05, todo-0008):** условие —
   относительная `y + h >= inner_h`, родитель только `box` (`grid` вне
   scope); приклеенный `footer` всегда на всю внутреннюю ширину `box`
   (эффективная геометрия `x=0, y=inner_h−h, w=inner_w` — render-time
   вывод, не изменение данных); линия — свой `border_style` `footer`'а,
   junctions — style map `box`'а; родитель без рамки — линия без
   junctions; при resize `box` `footer` следует за шириной и нижней
   границей; `h > inner_h` — приклеен всегда, линия клипнута; точное
   касание `y + h == inner_h` — приклеен; авто-прилипание при сжатии
   `box` — принято временно.
2. **Унификация (решение 2026-11-05):** алгоритм attached-рендера
   идентичен для header/footer до флипа y — сторона (top/bottom)
   выводится из `block_type`; существующие header-функции
   переименовываются в нейтральные (`_draw_attached`,
   `_draw_attached_junctions`, `_attached_line_html`, `drawAttached`,
   `drawAttachedJunctions`, `attachedLineHtml`). Флаг
   `RenderBlock.attached` не меняется — сторона имплицитна из типа.
   Поверхность parity (Python↔JS) не удваивается; подготовка к
   `sidebar` (follow-up).
3. **Junctions рисует родитель.** Ребёнок клипнут во внутреннюю область
   (`_render_children_in_container` / `renderChildrenInContainer`), не
   может дописать клетки рамки `box` → junctions `├`/`┤` рисует сам
   контейнер (паттерн frame-узлов `grid`, 0063; тот же паттерн, что в
   0074). Строка junctions: header — `py+ch`; footer —
   `py+1+inner_h−ch`. Рисуется, только если линия рисуется
   (`ch <= inner_h`, `border_style != none`) и у `box` есть рамка.
4. **Обратная совместимость.** Старый макет, где `footer` прижат к низу
   `box` (каноничный лейаут), рендерится иначе (без трёх сторон рамки).
   Формальное отклонение от правила — согласовано как исключение
   (todo-0008, замечание 2, решение 2026-11-05).
5. **Редактор.** `_absoluteRect` — центральная точка абсолютной
   геометрии (hit-test/selection/drag/drop-target) → эффективная
   геометрия встраивается туда (проверка attach — только на уровне
   **прямого** родителя). `onCanvasDrop` снапит `footer` в `box` к
   `x=0, y=container.height−2−h, width=container.width−2`.
6. **Бэкенд (`LayoutService`):** типоспецифичной логики нет — менять не
   нужно (редактор шлёт готовые координаты).

# Выполнение задачи

- `services/renderer.py`:
  - `RenderBlock.attached` — комментарий обновлён (header/footer, сторона
    имплицитна из типа);
  - `_render_children_in_container` — условие для `footer`-ребёнка `box`
    с `y + h >= inner_h`: эффективная геометрия (`x=px+1,
    y=py+1+inner_h−h, w=inner_w`) + `attached=True` (иначе — обычный
    расчёт + `attached=False`);
  - `_render_block` — ветка `header`/`footer`+`attached`:
    `_draw_attached` (без трёх внешних сторон, линия — последняя строка
    для header / первая для footer, контентная область по другую сторону
    от линии) + дети;
  - `_draw_attached_header` → `_draw_attached` — сторона (top/bottom) из
    `block_type`; строка линии — `y+h−1` (top) / `y` (bottom);
    контентная область — строки над (top) / под (bottom) линией;
  - `_draw_attached_header_junctions` → `_draw_attached_junctions` —
    junctions для обоих типов: header — строка `y + ch` (условие
    `y <= 0`), footer — строка `y + 1 + inner_h − ch` (условие
    `y + ch >= inner_h`);
  - `_attached_header_line_html` → `_attached_line_html` (+параметр
    стороны: верхняя линия — `0.5×char_height_px`, нижняя —
    `(h−0.5)×char_height_px`);
  - `_block_preview_html` — `effective`/`attached` для детей-`footer`
    (рекурсивно, как для `header`), линия по стороне из `block_type`.
- `static/js/core/renderer.js` — зеркально (побайтовый parity):
  `drawAttached`, `drawAttachedJunctions` (фильтрует `allBlocks` по
  `parent_id`), `attachedLineHtml`, условие в `renderChildrenInContainer`
  (+эффективная геометрия `y = parent.y+1+innerH−h` для footer), ветка в
  `renderBlock`, `effective`/`attached` в `_blockPreviewHtml`.
- `static/js/editor.js`:
  - `_absoluteRect` — эффективная геометрия attached-`footer` (до обхода
    предков, по прямому родителю: `box` + `y + h >= parent.height − 2` →
    `x=0, y=parent.height−2−h, width=parent.width−2`);
  - `onCanvasDrop` — `dragType === 'footer'` и контейнер-`box` → снап
    `x=0, y=container.height−2−h, width=container.width−2`;
  - move-drag-превью и `_startResizeDrag` — по `_absoluteRect`
    (эффективная геометрия подхвачена автоматически).

Тесты:
- `tests/test_renderer.py` — 16 новых: attached-рендер (без 3 сторон,
  верхняя линия, junctions, контентная область), `ch == 1` (только
  линия), `ch > inner_h` (линия клипнута, junctions нет), родитель без
  рамки (линия без junctions), dashed-линия в solid box,
  `border_style=none` (нет линии), отклеенный (`y + h < inner_h`) —
  обычный box, точное касание (`y + h == inner_h`) — приклеен, resize
  `box` — следует за шириной и нижней границей, авто-прилипание при
  сжатии `box` (решение 11), hint `[footer]`, fill/hide_text, `footer` в
  `grid` (без изменений), HTML-оверлей (attached/dashed/detached,
  верхняя линия);
- `tests/js/test_renderer.js` — 13 зеркальных тестов;
- `tests/test_js_renderer_parity.py` — `test_parity_attached_footer`
  (13 ASCII-кейсов), `test_parity_attached_footer_in_grid`,
  `test_parity_attached_footer_html` (5 кейсов).

Проверка: 372 py (unit+API+parity), 428 js, 106 e2e — зелёные;
parity — побайтово.

# Ревизия (2026-11-05)

Условие прилипания ужесточено: `y + h >= inner_h` → **`y + h > inner_h`**.
Прилипает только `footer`, у которого **нижняя сторона рамки реально
отсекается** нижним краем `box` (рамка геометрически за границей
внутренней области). Точное касание (`y + h == inner_h`, рамка не
отсечена) — **не** приклеен: обычный box в сохранённой позиции. Отклейка
— `y + h <= inner_h`. Временное решение об авто-прилипании при сжатии
`box` (решение 11 todo-0008) снято: сжатие до точного касания
не приклеивает.

Изменения: `_render_children_in_container` / `renderChildrenInContainer`,
`_block_preview_html` / `_blockPreviewHtml`, `_draw_attached_junctions` /
`drawAttachedJunctions` (пропуск junctions для не-приклеенных),
`_absoluteRect` в `editor.js`, снап `onCanvasDrop`
(`y=inner_h−h` → `y=inner_h−h+1`). Тесты: фикстуры/кейсы переключены на
`y + h > inner_h`, точное касание — отдельный кейс «не приклеен» (полная
рамка, без junctions).

# Замечания

- **Несколько attached-`footer` / пересечение линий `header`+`footer`** —
  та же политика, что follow-up 0074: рендерятся независимо, наложение
  не обрабатывается. Комбинация `header`+`footer` в маленьком `box`
  (`header_h + footer_h > inner_h`) — линии пересекаются; зафиксировано
  как известное ограничение.
- Это ограниченное воскрешение per-side границ (удалены в 0051-фазе 1) —
  но как **type-specific поведение `header`/`footer`**, а не общий
  механизм сторон рамки. Не расползать на другие типы.
- `grid` как родитель — вне scope: `footer` внутри `grid` рендерится как
  обычный box (общий путь).
- Кросс-ссылки: todo-0001 (пункт `footer`), todo-0008 (спека),
  todo-0007/0074 (`header`-attach), 0063 (junctions `grid`),
  0051-фаза 1 (per-side границы удалены).
