# Суть проблемы

При перетаскивании **предварительно выделенного** дочернего блока за
пределы родительского box «пропадала» рамка перетаскивания: блок
визуально исчезал, как только пересекал границу контейнера.

Причина: выделенный блок таскается групповым путём (`dragGroup = true`,
даже для одиночного выделения — см. 0040), который двигает реальный
`.block-preview` элемента через `transform`. Этот элемент вложен в div
родителя, а родитель с детьми имеет `overflow:hidden` (клип, зеркалящий
ASCII-клип рендерера). Выходя за границу box, блок обрезался этим клипом
и становился невидимым.

Для невыделенного блока бага не видно: одиночный drag рисует пунктирный
`.drag-preview` в `canvas-drag-overlay` (не клипится), а реальный блок
остаётся на месте.

Вторичный дефект того же сценария: рамка выделения (`.block-selection`)
во время drag стояла на исходной позиции — она позиционируется из
сохранённых координат блока, которые меняются только на commit.

# Задача

1. Дочерний блок, тащаемый за пределы родителя, должен оставаться
   видимым во время drag (клип контейнера на время переноса снимается;
   re-parenting по-прежнему происходит на commit).
2. Рамка выделения следует за перемещаемой группой во время drag.

# План работ

- [x] Составить план работ
- [x] Воспроизвести баг (Playwright-скрипт в `tmp/`, DOM-снимок mid-drag)
- [x] `editor.js`: `_unclipAncestors()` / `_restoreClipping()` — снять и
      вернуть `overflow` у `.block-preview`-предков тащаемых блоков
- [x] `editor.js`: `_applyGroupTransform` — сдвигать `.block-selection`
      той же дельтой, что и блоки
- [x] `editor.js`: вызов `_unclipAncestors()` в move-ветке,
      `_restoreClipping()` + сброс transform рамки в `_clearDragState`
- [x] E2E-тест: pre-selected child → drag за пределы box → mid-drag
      блок вне box, box не клипит, рамка на блоке; commit un-parent
- [x] Проверка: `node --check`, `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/ -v`

# Исследование

1. **Два пути перемещения.** Одиночный drag невыделенного блока —
   пунктирный `.drag-preview` в `canvas-drag-overlay` (прямой потомок
   `.canvas-container`, клипу не подвержен). Drag выделенного блока (один
   или группа) — `dragGroup = true` (0040: `dragSelection` ставится при
   любом нажатии внутри bbox выделения, включая одиночное выделение),
   блоки сдвигаются `transform` на их реальных `.block-preview`.
2. **Клип.** `renderHtmlPreview` в `core/renderer.js`: div родителя с
   детьми получает `overflow:hidden` (зеркало ASCII-клипа
   `renderChildrenInContainer`). Дети вложены в div родителя →
   `transform` не выводит их за пределы клипа.
3. **Рамка выделения.** `selectionStyle` считается из сохранённых
   (неизменных во время drag) координат → рамка не следовала за
   перемещением.
4. **Commit не затронут.** Re-parenting (`_commitGroupMove`) работает по
   сохранённым координатам + дельте — визуальный клип на него не влияет.
   После commit DOM пересобирается (`refreshRender`), клипы восстанавливаются
   сами.

# Выполнение задачи

Изменён 1 файл + e2e-тесты.

**`boxframe/static/js/editor.js`**:
- `_unclipAncestors()` — для каждого выбранного блока по цепочке
  `.block-preview`-предков (до `.canvas-container`) ставит
  `overflow:visible`, сохраняя прежние значения в Map
  `_unclippedAncestors` (идемпотентно — вызывается на каждом mousemove);
- `_restoreClipping()` — возвращает сохранённые значения (вызывается в
  `_clearDragState`; при успешном commit DOM пересобирается, поэтому
  восстановление — страховка для no-move/rollback-пути);
- move-ветка `onCanvasMouseMove` — `this._unclipAncestors()` перед
  `_applyGroupTransform`;
- `_applyGroupTransform` — дополнительно сдвигает `.block-selection`
  тем же `translate(...)`;
- `_clearDragState` — `_restoreClipping()` + сброс `transform` рамки
  (рамка — статический элемент шаблона, не пересобирается).

**`tests/e2e/test_editor.py`**:
- `test_drag_preselected_child_out_of_box_stays_visible`: box 30×10 +
  child 10×2; клик по child (pre-select), drag за пределы box → mid-drag:
  child вне box, `overflow` box ≠ hidden, рамка выделения совпадает с
  child; mouseup → `parent_id: null`, координаты commit без изменений.

## Проверка

- `node --check boxframe/static/js/editor.js` — синтаксис OK;
- `pytest tests/ --ignore=tests/e2e` — 138 passed;
- `node --test "tests/js/*.js"` — 191 passed;
- `pytest tests/e2e/ -v` (сервер на :8000) — 69 passed (включая новый).

# Замечания

1. **Клип снимается только на время drag.** После commit (или no-move
   drop) `overflow` возвращается; при успешном commit DOM пересобирается
   и клипы восстанавливаются рендером.
2. **Static-режим покрыт тем же кодом** — `editor.js` общий; e2e-тест
   добавлен для web-режима (общий код).
3. **Кандидат на будущую задачу (вне scope):** если в группу входят box
   и его собственный child (marquee покрывает оба), `transform`
   применяется к вложенному элементу дважды (родитель + child) — child
   уезжает на 2× дельту во время drag и «впрыгивает» на месте после
   commit (commit-путь таких блоков корректно пропускает).
4. **Скрипт воспроизведения** `tmp/repro_drag_child.py` (одноразовый, в
   `tmp/` по соглашению) — сценарии A (pre-selected) и B (обычный drag)
   с DOM-снимком mid-drag.
