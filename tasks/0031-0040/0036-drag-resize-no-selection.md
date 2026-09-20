# Суть проблемы

При перетаскивании элемента (move-drag) и изменении размера за угол
(hover-handle на превью блока) элемент стал выделяться: появляется рамка
выделения и всплывает панель свойств. В предыдущей реализации этого не
было — перетаскивание и hover-ресайз не меняли выделение, выделение
менялось только явными действиями: клик по блоку, Shift/Ctrl+клик,
marquee, клик по элементу в списке.

Регрессия в UX: пользователь просто двигает/ресайзит блок, а за ним
«прилипает» панель свойств, отвлекая от операции.

# Задача

Вернуться к ранее принятой логике выделения:

1. **Drag** — перетаскивание одиночного блока не выделяет его.
2. **Hover-resize** — ресайз за угол превью блока не выделяет его.
3. **Сохранить** — выделение по клику, Shift/Ctrl+клик, marquee, клику в
   списке; групповые операции (drag и resize мульти-выделения).

# План работ

- [x] Проследить историю логики выделения в `editor.js` (git log/diff),
      найти, где появились новые точки выделения
- [x] Убрать `selectBlock()` из перехода pending→move в
      `onCanvasMouseMove`
- [x] Убрать `selectBlock()` из `onResizeHandleMouseDown`; передать блок
      явно в `_startResizeDrag(block, e)`
- [x] Тесты: drag не выделяет, hover-resize не выделяет, групповые
      операции (drag/resize мульти-выделения) работают
- [x] Полный прогон: `node --test "tests/js/*.js"` + e2e + unit/API

# Исследование

Точки выделения добавлены коммитом `1508c4b` (0033, мульти-выделение):

1. `onCanvasMouseMove`, переход pending→move:
   `this.selectBlock(this.dragBlock.id)` — «Selecting a single block on
   drag start»;
2. `onResizeHandleMouseDown`: `this.selectBlock(block.id)` — «Hover-resize
   selects the block first — the selection frame takes over the handle».

До `1508c4b` (например, `752a593`):

- выделение менялось только в `_onGlobalMouseUp` в состоянии `pending`
  (клик без движения): `selectedBlockId = pendingBlock ? id : null`;
- hover-resize вызывал `_startResizeDrag(block, e)` напрямую, блок
  передавался параметром, выделения не было.

Коммит `a88375c` (0035, box-контейнер) логику выделения не менял —
регрессия именно от 0033, а не от 0035.

Проверки, что удаление точек выделения безопасно:

- групповой drag не зависит от выделения при старте:
  `dragGroup = selectedIds.length > 1 && selectedIds.includes(dragBlock.id)`
  — работает с уже существующим marquee-выделением;
- `_commitBlockMove`/`_commitBlockResize` не читают состояние выделения
  (работают с `dragBlock`/`resizeGroup`/`resizeOriginal`);
- e2e `test_selection_resize_handle_resizes_block` сначала кликает блок
  (выделение по клику) и тянет handle рамки выделения — не затрагивается;
- hover-handle скрыт у выделенных блоков (`_bindResizeHandles`:
  mouseenter проверяет `selectedIds`) — у выделенного блока работает
  handle рамки выделения, у невыделенного — hover-handle.

# Выполнение задачи

Выполнено (2026-09-20). Изменения в `boxframe/static/js/editor.js`:

1. `onCanvasMouseMove` (pending→move): убран `selectBlock()` — обычный
   drag не выделяет блок и не показывает панель; drag-превью по-прежнему
   показывается.
2. `onResizeHandleMouseDown`: убран `selectBlock()`; блок передаётся явно:
   `_startResizeDrag(block, e)`.
3. `_startResizeDrag(e)` → `_startResizeDrag(block, e)`: если блок входит
   в мульти-выделение (`selectedIds.length > 1 && includes(block.id)`) —
   ресайзится вся группа (bbox, как раньше через `selectedBlocks`),
   иначе — только сам блок. `onSelectionResizeMouseDown` передаёт
   `this.selectedBlock`.

Тесты `tests/js/test_editor.js` (+5):

- drag start не выделяет блок (pending→move, `selectedIds` остаётся
  пустым);
- drag члена существующего мульти-выделения двигает группу
  (`dragGroup === true`, выделение сохранено);
- hover-resize не выделяет блок (событие mousedown на handle, блок
  передаётся в `_startResizeDrag` без `selectBlock`);
- `_startResizeDrag`: одиночный блок (включая одиночное выделение) —
  `resizeGroup === false`, размеры блока;
- `_startResizeDrag`: блок из мульти-выделения — `resizeGroup === true`,
  bbox группы.

Результат полного прогона: 142 JS (`node --test`) + 54 e2e (Playwright) +
134 unit/API (pytest) — все зелёные.

# Замечания

1. Семантика выделения: выделение меняется только явными действиями
   пользователя (клик, Shift/Ctrl+клик, marquee, клик в списке); drag и
   resize — «нейтральные» операции относительно выделения. Если в будущем
   захотим выделять блок после drag (как в ряде редакторов) — это
   осознанное решение, фиксируется в задаче.
2. Новые mouse-операции (поворот, коннекты и т.п.) не должны добавлять
   неявного выделения — то же правило.
3. Групповой resize доступен только через handle рамки выделения
   (`onSelectionResizeMouseDown`); hover-resize члена группы на практике
   недоступен (hover-handle у выделенных блоков скрыт), но
   `_startResizeDrag` этот случай покрывает (ресайзит группу).
4. При проверке подобных регрессий сначала смотреть историю конкретной
   функции (`git log -S`), а не последний коммит: поведение могло измениться
   несколькими коммитами назад (здесь — 0033, а не 0035).
