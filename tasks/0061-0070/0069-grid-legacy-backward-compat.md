# Суть проблемы

Grid-перегородки (0061–0068) существуют только в ветке
`feature/variants`; в `develop` (v0.11.0) grid рисуется как обычный box
(рамка + hint `[grid]` + дети). При этом `grid` есть в `BLOCK_TYPES` с
первого коммита — старые макеты, созданные в `develop`, содержат grid-блоки
без `meta.cols`/`meta.rows` и рендерятся как plain box.

Правило обратной совместимости (2026-11-02): макеты, созданные в
предыдущих версиях, должны отображаться в новой версии так же, как
раньше. Отход от правила оговаривается отдельно и согласуется с
пользователем.

Решение пользователя (2026-11-02, «вариант 2, защити старые макеты»):
grid **без** явного `meta.cols`/`meta.rows` рендерится как plain box
(без перегородок), а структура (`cols`/`rows`) инжектится при
**создании** нового grid-блока.

# Задача

Два механизма:

1. **Детекция legacy.** `grid_has_structure(meta)` — grid имеет
   структуру, только если в meta есть валидный `cols` **или** `rows`
   (positive int; bool/float/строка/отсутствие — невалидно). В обоих
   рендерерах `_render_block()`/`renderBlock()` вызывают
   `_draw_grid()`/`drawGrid()` только при `grid_has_structure(block.meta)`;
   иначе — обычный box-путь (рамка + hint `[grid]` + дети).
2. **Инжект структуры при создании.** `grid_create_meta(meta)` — копия
   meta с дефолтом `cols`/`rows` = 3/2, если их нет или они
   невалидны. Применяется в:
   - API create (`create_block` в `layout_service.py`);
   - API batch create (`batch_blocks`, секция create);
   - static store `createBlock` (`normalizeGrid` в `core/store.js`).
   В update/replaceState **не** применяется — legacy grid остаётся
   legacy, undo/redo восстанавливает meta как есть.

# План работ

- [x] Составить план работ
- [x] `services/renderer.py` — `grid_has_structure()`,
      `grid_create_meta()`, гейт в `_render_block()`
- [x] `static/js/core/renderer.js` — `gridHasStructure()`,
      `gridCreateMeta()`, гейт в `renderBlock()` (parity побайтово),
      экспорт в `PGRenderer`
- [x] `services/layout_service.py` — инжект в `create_block` и
      `batch_blocks` (create)
- [x] `static/js/core/store.js` — `normalizeGrid()` в `createBlock` и
      `batchBlocks` (create)
- [x] `static/js/editor.js` — `gridHandles`: legacy grid не получает
      ручки перегородок
- [x] Тесты: renderer py/js (9 кейсов в каждом), parity (legacy-кейсы),
      API (инжект при create, legacy при update), store js (4 кейса),
      e2e (legacy grid → plain box)
- [x] AGENTS.md — секция `grid` (пункт обратная совместимость)
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/` (сервер на
      :8000)

# Исследование

1. **Где grid в develop.** `git log` — `grid` в `BLOCK_TYPES` с первого
   коммита (0536726); код перегородок (`_draw_grid` и т.д.) — только
   0061–0068 в `feature/variants`. В develop grid — plain box: рамка +
   hint `[grid]` + дети (box-путь рендерера).
2. **Критерий legacy.** Старые макеты не несут `meta.cols`/`rows`
   (поля появились вместе с 0061). Валидный `cols` **или** `rows`
   (positive int) — признак «нового» grid. Частичный meta
   (`cols` без `rows`) — тоже структура (недостающее значение
   берётся из дефолта в `gridMetaInt`).
3. **Почему инжект при создании, а не при рендере.** Инжект при
   рендере не менял бы данные — legacy grid оставался бы legacy в БД,
   но панель свойств показывала бы `cols`/`rows`, которых нет в
   данных. Инжект при создании делает данные и отображение
   согласованными: новый grid — всегда со структурой, старый — всегда
   без.
4. **Почему не в update.** Обновление legacy grid (resize, смена
   content) не должно «оживлять» перегородки — это изменило бы
   отображение старого макета. `replaceState` (undo/redo)
   восстанавливает снапшот как есть.
5. **Ручки (0067).** `gridHandles` в `editor.js` — только для
   структурированных grid: у legacy grid перегородок нет, и ручек
   быть не должно.
6. **Parity.** `grid_has_structure`/`grid_create_meta` — чистая
   целочисленная логика, тривиально портируется; parity-тесты
   покрывают legacy-кейсы (None meta, fill, невалидный meta,
   вырожденный размер).

# Выполнение задачи

Реализовано 2026-11-02.

- `services/renderer.py` — `grid_has_structure(meta)` (валидный
  `cols` или `rows`: positive int, не bool/float/строка),
  `grid_create_meta(meta)` (копия с дефолтом 3/2); `_render_block()`:
  `if block.block_type == "grid" and grid_has_structure(block.meta)`.
- `static/js/core/renderer.js` — `gridHasStructure(meta)`,
  `gridCreateMeta(meta)` (зеркало, parity побайтово); `renderBlock()`:
  тот же гейт; обе функции в экспорте `PGRenderer`.
- `services/layout_service.py` — `create_block`: `elif block_type ==
  "grid": meta = grid_create_meta(meta)`; `batch_blocks` (create):
  то же.
- `static/js/core/store.js` — `normalizeGrid(block)` (дефолт 3/2 через
  `PGRenderer.gridMetaInt`); вызов в `createBlock` и `batchBlocks`
  (create).
- `static/js/editor.js` — `gridHandles`:
  `if (!PGRenderer.gridHasStructure(b.meta || {})) return null`.
- Тесты:
  - renderer py/js — 9 кейсов в каждом: `grid_has_structure` /
    `gridHasStructure`, `grid_create_meta` / `gridCreateMeta`, legacy
    без meta → plain box (hint `[grid]`, без перегородок), legacy
    `border=none` → пусто, legacy double border, legacy fill (hint
    подавляется), legacy с детьми (дети без перегородок),
    `cols`-only → структура, невалидный meta → legacy.
  - parity — `test_parity_grid_ascii` (legacy-кейсы: None meta,
    fill-only, невалидный meta, вырожденный),
    `test_parity_grid_legacy_content_and_hint` (legacy рисует content +
    hint как plain box).
  - API — `test_create_grid_injects_structure_meta` (create одиночный +
    batch инжектят `cols`/`rows`), `test_legacy_grid_renders_as_box`
    (meta={} → plain box; update не инжектит).
  - store js — 4 кейса: `createBlock` инжектит (нет meta / свой meta /
    невалидный), `updateBlock` не инжектит, `batchBlocks` create
    инжектит, `replaceState` восстанавливает как есть.
  - e2e — `test_web_editor_legacy_grid_renders_as_box`: grid,
    обнулённый до meta={} (update не инжектит), рендерится как plain
    box (hint `[grid]`, без ┬/┼/┴).
- Документация: AGENTS.md (секция `grid` — пункт обратная
  совместимость).

## Замечания

1. **E2E.** Проверять с перезапущенным сервером (`scripts/server.sh
   restart`) — без `--reload` он держит старый Python-код (инжект в
   `layout_service.py`).
2. **Batch create в store.js.** `normalizeGrid` был пропущен в
   create-секции `batchBlocks` (в `createBlock` был) — добавлен;
   без этого undo/redo-снапшоты, сделанные через batch, не
   инжектят структуру.

# Проверка

- `pytest tests/ --ignore=tests/e2e` — 316 passed
- `node --test "tests/js/*.js"` — 383 passed
- `pytest tests/e2e/` — 99 passed (сервер на :8000, перезапущен
  через `scripts/server.sh`)
