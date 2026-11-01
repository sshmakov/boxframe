# Суть проблемы

`grid` (todo-0005, 0061) рисует перегородки по **равномерному** split:
`col_x[i] = (i·inner_w) // eff_cols`. Ширину отдельных колонок и высоту
отдельных рядов изменить нельзя — только число колонок/рядов
(`meta.cols`/`rows`) и общий размер блока. Для реальной раскладки
(например, sidebar 20% + контент 80%) это недостаточно: сетка не может
выразить неравные ячейки.

# Задача

Дать возможность менять ширину столбцов и высоту строк: когда grid
выделен, на внутренних перегородках отображаются ручки — перетаскивание
ручки мышью двигает перегородку и сохраняет кастомные ширины/высоты.

Решения пользователя (2026-11-01):

1. **Данные (A):** `meta.col_widths` / `meta.row_heights` — массивы
   целых ширин/высот в клетках. Нет массива (или невалидный) →
   равномерный split (текущее поведение, обратная совместимость).
2. **Внешний resize (a):** кастомные ширины фиксированы, **последняя
   колонка/ряд впитывает дельту** (нормализация в рендерере, clamp ≥ 1
   клетки на колонку/ряд).
3. **Ручки:** видны при **одиночном** выделении grid; по одной на
   внутреннюю перегородку (eff_cols−1 вертикальных, eff_rows−1
   горизонтальных); drag меняет ширину **левой** колонки (высоту
   **верхнего** ряда), соседняя впитывает дельту (сумма пары
   постоянна); мин 1 клетка.
4. **Live-превью (A):** только HTML-оверлей — сама ручка (узкая полоса
   на всю линию перегородки) движется за курсором и служит «призраком»;
   ASCII перерисовывается на коммите (mouseup → `updateBlock` →
   `refreshRender`). Как текущий resize блока.
5. **Смена cols/rows (a):** кастомные ширины трансформируются —
   cols+1: последняя колонка делится пополам (если последняя 1 клетка —
   одна клетка берётся у ближайшей слева более широкой; если всех
   по 1 — равномерный re-split); cols−1: две последние сливаются.
   Без кастомных ширин — ничего (равномерный split).

# План работ

- [x] Составить план работ
- [x] `services/renderer.py` — `grid_split(meta, inner_w, inner_h)`
      (+ `grid_meta_widths`, `_split_axis`): eff_cols/eff_rows +
      `col_x`/`row_y` (равномерный или prefix-sum с нормализацией);
      `_draw_grid()` — использовать
- [x] `static/js/core/renderer.js` — `gridSplit` (+ `gridMetaWidths`,
      `splitAxis`, `gridReshapeWidths`) — зеркало (parity побайтово),
      экспорт; `drawGrid()` — использовать
- [x] `static/js/editor.js` — computed `gridHandles` (позиции ручек в px
      от рамки выделения), `onGridHandleMouseDown`/`_onGridHandleMouseMove`/
      `_onGridHandleMouseUp` (drag + live-сдвиг ручки + коммит `meta`),
      `isDragging` (+ gridDrag), исключения в mousedown/dblclick
      (`.grid-handle`), reshape ширин в `applyPropValue` при смене
      cols/rows
- [x] `templates/pages/editor.html` + `static/editor/index.html` —
      шаблон ручек внутри `.block-selection`
- [x] `static/css/editor.css` — стили `.grid-handle` (hit-зона на всю
      линию, pill в центре, курсоры col/row-resize, hover)
- [x] Тесты: renderer py/js (неравный split, нормализация sum < / >
      inner_w, фолбэк невалидных, min 1, row_heights, span на неравном
      split), `gridReshapeWidths` (js), parity (кейсы с col_widths/
      row_heights), e2e (ручки при выделении, drag вертикальной/
      горизонтальной → ASCII, clamp)
- [x] AGENTS.md — секция `grid` (пункт: кастомные ширины/высоты, 0067)
- [x] `tasks/backlog/todo-0005-grid-design.md` — follow-up 0067
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/` (сервер на
      :8000)

# Исследование

1. **Split.** Текущий: `col_x = [(i·inner_w) // eff_cols]` (renderer.py
   `_draw_grid`, renderer.js `drawGrid`). Новый: `grid_split()` —
   `eff_cols = min(cols, inner_w)` (как сейчас), `col_x = _split_axis(
   widths, eff_cols, inner_w)`: нет массива / len ≠ eff_cols / не все
   int ≥ 1 → равномерный; иначе prefix-sum с клампом
   `x[i] = min(x[i-1] + w[i-1], inner_w - (eff_cols - i))` — каждая
   колонка ≥ 1, последняя впитывает дельту (sum < inner_w — последняя
   шире, sum > inner_w — последняя сжимается до ≥ 1). `x[0]=0`,
   `x[eff_cols]=inner_w`.
2. **Span (0062–0066) — без изменений.** Логика span читает
   `col_x`/`row_y`/`v_parts`/`h_parts` — с неравным split работает
   автоматически (задеваемые ячейки, пересечения, junctions — всё по
   тем же массивам).
3. **HTML-оверлей.** Перегородки — только в ASCII-слое; оверлей у grid —
   внешняя рамка (общий путь). Ручки — новый UI-слой в
   `.block-selection` (как `.sel-resize`), позиции в px:
   `(offX + col_x[i])·charW`, где offX = 1 с рамкой / 0 без.
   `.block-selection` при одиночном выделении = прямоугольник самого
   блока (`selectionStyle`) — ручкам достаточно координат относительно
   рамки.
4. **Drag.** `_contentToGrid(clientX, clientY)` — дробные grid-координаты
   (без floor). Новая позиция перегородки i (1-based, между колонками
   i−1 и i): `p = round(cursor − abs − off) − before`, где
   `before = Σw[0..i-2]`; clamp `[1, w[i-1] + w[i] − 1]`;
   `w[i-1] = p`, `w[i] = span − p`. Коммит — один `updateBlock` с новым
   `meta` (один шаг undo/redo; withHistory).
5. **Live-превью.** Во время drag `meta` не меняется (коммит на
   mouseup) — позиция ручки обновляется прямым `el.style.left/top`
   (паттерн `_applyGroupTransform`). После коммита Alpine
   пересчитывает `gridHandles` (meta изменилась) и `:style`
   переприменяется.
6. **Reshape cols/rows.** `gridReshapeWidths(widths, oldCount, newCount)`
   (pure, в core/renderer.js — тестируется в JS): невалидный вход →
   null (равномерный re-split); growth — делить последнюю (w ≥ 2 →
   floor/ceil; w == 1 → занять 1 у ближайшей слева ≥ 2; всех по 1 →
   null); shrink — слить две последние. Вызывается из
   `applyPropValue` (per block, `b.block_type === 'grid'`).
7. **Бэкенд — без изменений.** `meta` — свободный dict, `LayoutService`
   типоспецифичной логики для grid не имеет (autosize нет).
8. **E2e-паттерны.** `_create_project_with_blocks` (API + reload),
   `_canvas_metrics` ({container, cw, ch}), `_grid_point`,
   `_poll_until` — как в grid-тестах 0062–0066.

# Выполнение задачи

Реализовано 2026-11-01 по плану. Ключевые моменты:

- **Рендереры (parity побайтово).** `grid_split()`/`gridSplit()` —
  единая точка расчёта `eff_cols`/`eff_rows` + `col_x`/`row_y`:
  равномерный split (нет/невалидный массив) или prefix-sum с клампом
  `min(x[-1]+w, total-(n-i))` (каждая колонка/строка ≥ 1, последняя
  впитывает дельту). `_draw_grid()`/`drawGrid()` используют их вместо
  инлайнового равномерного расчёта. Span-подавление (0062–0066) читает
  те же `col_x`/`row_y`/`v_parts`/`h_parts` — на неравном split работает
  без изменений.
- **Ручки (редактор).** `gridHandles` (computed) — позиции ручек в px от
  рамки выделения (offX/offY = 1 с рамкой / 0 без). Drag:
  `onGridHandleMouseDown` (хват, snapshot ширин) →
  `_onGridHandleMouseMove` (live-сдвиг ручки `el.style.left/top`, кламп
  `[1, span-1]`) → `_onGridHandleMouseUp` (коммит `meta.col_widths`/
  `row_heights` через `updateBlock`, `refreshRender`). `isDragging`
  учитывает `gridDrag`; dblclick игнорирует `.grid-handle`.
  **Поправка при реализации:** `_onGridHandleMouseMove` сначала передавал
  `e.clientX/Y` (viewport) в `_contentToGrid`, который ожидает
  content-координаты — добавлен `_clientToContent` (как в marquee).
- **Reshape cols/rows.** `gridReshapeWidths` (pure, core/renderer.js,
  только редактор) вызывается из `applyPropValue` при смене `cols`/
  `rows`: рост делит последнюю колонку (floor/ceil, заём у левого
  соседа, все-1 → null), сжатие сливает две последние; без кастомных
  ширин — `delete meta[col_widths/row_heights]`.
- **UI.** Шаблон ручек в `.block-selection` (оба редактора), стили
  `.grid-handle` (hit-зона на всю линию, pill, курсоры, hover).
- **Особенность UX:** в точке пересечения вертикальной и горизонтальной
  перегородок верхняя — горизонтальная ручка (рендерится после
  вертикальных в DOM); вертикальную в пересечении не захватить —
  хватают выше/ниже.

Проверка: `pytest tests/ --ignore=tests/e2e` — 303 passed;
`node --test "tests/js/*.js"` — 369 passed; `pytest tests/e2e/` — 98
passed (сервер на :8000, перезапущен — без `--reload` он держал старый
Python-рендерер). Новые тесты: renderer py (7) / js (8, вкл.
`gridReshapeWidths`), parity (`test_parity_grid_custom_widths`, 13 кейсов),
e2e (4: ручки при выделении, drag вертикальной/горизонтальной → ASCII +
meta, кламп до 1 клетки).
