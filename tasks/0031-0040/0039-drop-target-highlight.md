# Суть проблемы

При перетаскивании блоков над box (одиночный drag, групповой drag,
drop из палитры) не было никакой визуальной подсказки, станет ли box
родительским при отпускании мыши. Re-parenting происходил «вслепую»:
правило (центр блока внутри box) было неочевидно, а результат
наблюдали только после mouseup — и, если он не совпадал с ожиданием,
приходилось откатывать через undo.

# Задача

Во время drag подсвечивать box-кандидат, который станет родительским
после отпускания мыши:

1. Одиночный drag блока — подсвечивать box, в который блок войдёт
   (по тому же правилу, что в `_commitBlockMove`).
2. Групповой drag — подсвечивать все box, в которые войдут блоки группы
   (правило `_commitGroupMove`, per-block).
3. Drag из палитры — подсвечивать box по правилу `onCanvasDrop`.
4. Подсветка должна **точно совпадать** с фактическим re-parenting на
   коммите — ни одного box «виртуально подсвечен, но не станет
   родителем» и наоборот.
5. Подсветка снимается при окончании drag (mouseup / dragleave / dragend).

# План работ

- [x] Составить план работ
- [x] `editor.js`: хелпер `_moveDropTargets()` — вычисление множества
      box-кандидатов по правилам коммита (move + group);
- [x] `editor.js`: `_updateDropTargetHighlight(ids)` /
      `_clearDropTargetHighlight()` — diff-обновление CSS-класса на
      `.block-preview`;
- [x] `editor.js`: хук в `onCanvasMouseMove` (ветка move) и
      `_clearDragState` (сброс);
- [x] `editor.js`: live-подсветка в `onCanvasDragOver` (палитра) +
      guard от flicker в `onCanvasDragLeave`;
- [x] `editor.css`: класс `.block-preview--drop-target`;
- [x] E2E-тесты: одиночный drag в box / мимо box, групповой drag,
      drag из палитры (static-режим);
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/ -v`.

# Исследование

1. **Правило drop-таргета зависит от типа drag** — подсветка должна
   дублировать три разных расчёта:
   - одиночный move: центр = `dragGridX + w/2, dragGridY + h/2`,
     исключается поддерево самого блока;
   - групповой move: per-block абсолютный rect + `dragGroupDx/Dy`,
     блоки с родителем внутри группы пропускаются (их «несёт»
     родитель), исключаются поддерева всех выбранных;
   - палитра: центр = сеточная позиция + `w/2, h/2` по
     `_blockDefaults(type)`.
   Общий примитив — `_findDropContainer(cx, cy, excludeIds)`
   (внутренний box, чья абсолютная область содержит точку).
2. **Баг, найденный при отладке: no-arg вызов гасил подсветку.**
   `onCanvasMouseMove` вызывает `_updateDropTargetHighlight()` без
   аргумента, а исходная реализация `new Set(ids || [])` превращала
   `undefined` в пустое множество — подсветка вычислялась никогда,
   только сбрасывалась. Диагностика — monkey-patch функций с логированием
   каждого вызова в e2e-странице (скрипт `tmp/debug_drop_target.py`):
   23 вызова с `argType: 'undef'`, результат всегда `[]`.
   Исправление: `ids === undefined` → вычислить live-таргеты.
3. **E2E-race двойного рендера.** Редактор рендерит канвас дважды:
   сначала с дефолтным 12px, затем после `_measureCharSize()`
   (~7.2px). Метрики DOM, снятые между рендерами, неверны: mousedown
   попадал мимо блока, и drag начинался как marquee. Исправление
   в `_canvas_metrics`: ждать, пока ширина `.block-preview` совпадёт с
   `app.charWidth * w` с точностью ±0.5px. Это стабилизировало **все**
   drag-тесты, а не только новые.
4. **Flicker при drag из палитры.** `dragleave` срабатывал, когда
   курсор пересекал дочерние `.block-preview` внутри canvas →
   подсветка мигала. Guard: `relatedTarget` внутри `currentTarget` →
   игнорировать событие.
5. **Цвет.** Зелёный `#2ecc71` (тот же, что у resize-превью) —
   «станет родителем»; красный `#e94560` остаётся за самим
   перетаскиваемым блоком.

# Выполнение задачи

Изменено 3 файла.

**`boxframe/static/js/editor.js`**:
- состояние: `dropTargetIds: []` — id подсвеченных box;
- `_moveDropTargets()` — множество box-кандидатов по правилам
  `_commitGroupMove` / `_commitBlockMove` (см. Исследование.1);
- `_updateDropTargetHighlight(ids)` — без аргумента считает
  live-таргеты; diff-обновляет класс `block-preview--drop-target`
  (снимает со снятых, ставит на новые);
- `_clearDropTargetHighlight()` — обёртка над `([])`;
- `onCanvasMouseMove` (ветка move): вызов `_updateDropTargetHighlight()`
  после пересчёта позиций;
- `_clearDragState()`: сброс подсветки;
- `onCanvasDragOver` (палитра): live-подсветка по правилу
  `onCanvasDrop`;
- `onCanvasDragLeave`: guard от flicker + сброс подсветки.

**`boxframe/static/css/editor.css`**:
- `.block-preview--drop-target` — outline 2px `#2ecc71` + полупрозрачный
  зелёный фон `.block-inner`.

**`tests/e2e/test_editor.py`** (4 новых теста, секция
«Drop-target highlight (the box that will become the parent)»):
- `test_drag_block_highlights_drop_target` — box 30×10 + button;
  mid-drag box подсвечен (count 1), после mouseup — снят,
  `parent_id == box_id`;
- `test_drag_block_no_highlight_outside_box` — drag мимо box:
  подсветки нет ни mid-, ни post-drag;
- `test_group_drag_highlights_drop_target` — marquee-группа, drag
  внутрь box C: mid-drag C подсвечен, после mouseup снят, блоки
  re-parented;
- `test_static_palette_drag_highlights_drop_target` — static-режим,
  синтетические `DragEvent` (dragstart/dragover/dragleave/dragend):
  подсветка появляется, снимается, состояние сбрасывается.

## Проверка

- `pytest tests/ --ignore=tests/e2e` — 134 passed;
- `node --test "tests/js/*.js"` — 150 passed;
- `pytest tests/e2e/ -v` (сервер на :8000) — 62 passed (включая 4 новых).

# Замечания

1. **Подсветка дублирует логику коммита — держать в синхроне.**
   Правила таргета расписаны в трёх местах: `_commitBlockMove`,
   `_commitGroupMove`, `onCanvasDrop` (+ `_moveDropTargets` как
   их зеркало). Любое изменение правила re-parenting (например
   whole-group-критерий из 0038) требует обновления и подсветки —
   иначе она будет врать. Кандидат на будущую задачу: вынести общее
   `_dropTargetsForMove(...)` и использовать и в коммите, и в
   подсветке.
2. **Стоимость.** `_findDropContainer` вызывается per-block на каждый
   mousemove — O(N·M) на кадр. Для размеров MVP незначимо; при росте
   кэшировать абсолютные rect box на время drag.
3. **`_canvas_metrics` ждёт стабильный рендер** (±0.5px против
   `charWidth * w`). Это защита от race двойного рендера во всех
   drag-тестах; при изменении порядка рендера в `editor.js`
   (например, отмена ре-рендера после measure) проверить, что ожидание
   не висит.
4. **Static-режим** покрыт тем же кодом `editor.js`; для палитры
   добавлен e2e-тест, для move-drag — нет (web-тесты проверяют общий
   код).
5. **Отладочный скрипт** `tmp/debug_drop_target.py` (gitignored) —
   паттерн «monkey-patch + лог вызовов в e2e-странице» полезен для
   диагностики Alpine-состояния mid-drag; оставить в `tmp/` как
   референс.
