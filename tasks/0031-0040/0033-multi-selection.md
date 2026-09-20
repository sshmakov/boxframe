# Суть проблемы

Редактор поддерживает только выделение одного элемента: клик по блоку
выделяет его, все операции (перемещение, изменение свойств, дублирование,
удаление) применяются к одиночному элементу. Нет способа выделить несколько
элементов мышью и выполнить над ними групповые действия. При редактировании
сложных макетов это приводит к повторяющимся ручным операциям: каждый блок
приходится двигать/настраивать/удалять по отдельности.

# Задача

Добавить выделение нескольких элементов мышью и одновременные манипуляции
над выделенной группой:

- выделение рамкой (marquee / rubber-band) по пустому канвасу;
- Shift/Ctrl+клик — добавить/убрать блок из выделения;
- перетаскивание группы (любой блок из выделения двигает всю группу);
- изменение размера группы (ручка на bounding box);
- дублирование и удаление всей группы;
- ввод одинаковых значений свойств в панели (X/Y/W/H, Content, Order);
- изменение стиля линии (Line Style) для всех выделенных;
- горячие клавиши: Del — удалить группу, Esc — снять выделение,
  Ctrl+D — дублировать, стрелки — сдвиг группы.

Все групповые операции — один запрос к API, одна транзакция, один шаг
undo/redo.

# План работ

- [x] Составить план работ
- [x] API: `POST /api/layouts/{id}/blocks/batch` — пакетная операция
      `{create, update, delete}` в одной транзакции, ответ
      `{created, updated, deleted}`; авто-порядок для новых блоков,
      нормализация толщины линий, 404 для несуществующего layout.
- [x] Store (`core/store.js`): `batchBlocks(payload)` для всех трёх
      хранилищ (fetch / memory / local) — для local один `save`.
- [x] History (`core/history.js`): `batchBlocks(payload, key)` — один
      снапшот на вызов (один шаг undo/redo), опциональный coalescing-key
      (например, «nudge» для серии сдвигов стрелками).
- [x] `editor.js`: `selectedIds[]`, marquee-выделение, Shift/Ctrl+клик,
      групповое перемещение (живой CSS-transform + batch-commit),
      групповый resize, дублирование/удаление группы, панель применяет
      значения ко всем, горячие клавиши, подсветка выделенных на канвасе.
- [x] Шаблоны (web `templates/pages/editor.html` + static
      `static/editor/index.html`, идентично): подсветка в списке,
      заголовок панели «N selected», Order скрыт для мульти-выделения,
      действия Duplicate/Delete для группы.
- [x] CSS: `.marquee` (рамка выделения), `.block-preview--selected`
      (подсветка блоков).
- [x] Тесты: API (6), JS store (6), JS history (4), e2e (6).
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/ -v` (на запущенном
      сервере).

# Исследование

1. **Единый интерфейс хранилища.** `core/store.js` абстрагирует три
   бэкенда (fetch — web-режим, memory/local — static-режим), `editor.js`
   не знает о fetch. Добавление `batchBlocks` во все три хранилища
   сохраняет эту прозрачность: групповые операции работают одинаково в
   web- и static-режиме.
2. **History — snapshot-based.** `withHistory` снимает снапшот состояния
   перед мутацией. Пакетная операция = один снапшот = один шаг undo/redo
   для всей группы. Coalescing (500 мс по key) позволяет схлопывать серию
   сдвигов стрелками в один шаг.
3. **Координатная система канваса.** content-px = `clientX −
   containerRect.left + scrollLeft`; grid = `(content − 16px) /
   charWidth|charHeight` (16px — padding `.render-wrapper`, char-size
   измеряется от `.ascii-art`). Marquee и e2e-координаты считаются от
   этого же начала.
4. **Маркап панели дублируется.** Панель существует в двух идентичных
   копиях (web + static); `editor.js` общий. Логика — в одном месте,
   маркап — в обоих файлах.
5. **Порядок input'ов панели — load-bearing.** `_panelInputs()` читает
   поля по DOM-индексу: [0]=X [1]=Y [2]=W [3]=H [4]=Order [5]=Content.
   Для мульти-выделения Order скрывается (`x-show="!isMultiSelect"`),
   порядок остальных полей не меняется.
6. **Плывущая панель может перекрывать соседние блоки.** Панель шириной
   264px открывается справа от выделения; при плотной расстановке блоков
   она накрывает соседний блок и перехватывает клики (обнаружено в e2e —
   см. «Выполнение задачи»).

# Выполнение задачи

Изменено 12 файлов + добавлен этот файл задачи.

**API** (`boxframe/services/layout_service.py`, `boxframe/api/layouts.py`):
- `LayoutService.batch_blocks(layout_id, create, update, delete)` —
  удаление через ORM (дети каскадно), создание с авто-порядком
  (`MAX(order)+1` последовательно), нормализация толщины hline/vline,
  обновление пропускает `id`/`None`, один `commit()`, повторный fetch
  layout;
- схемы `BatchBlockCreate` / `BatchBlockUpdate` / `BlocksBatch` /
  `BlocksBatchOut`;
- эндпоинт `POST /{layout_id}/blocks/batch` → `{created, updated,
  deleted}`, 404 для несуществующего layout.

**Store** (`boxframe/static/js/core/store.js`):
- `batchBlocks(payload)` для fetch (POST на batch-эндпоинт) и
  memory/local (один `mutate()` → один `save` для local);
- возвращает `{created, updated, deleted}`.

**History** (`boxframe/static/js/core/history.js`):
- `batchBlocks(payload, key)` — один снапшот на вызов, опциональный
  coalescing-key; кэш состояния синхронизируется из результата
  (created/updated/deleted).

**`boxframe/static/js/editor.js`**:
- состояние: `selectedIds[]` (первый — «основной» для якоря панели),
  marquee/dragGroup/resizeGroup;
- marquee: рамка на пустом канвасе, Shift — добавить к текущему
  выделению, пересечение по площади блока;
- Shift/Ctrl+клик по блоку и по элементу списка — toggle;
- групповое перемещение: живой `transform: translate(...)` на превью
  во время drag, commit одним batch-update при mouseup, кламп по началу
  координат (0,0);
- групповой resize: ручка на bounding box, per-block минимальные размеры
  и толщина линий;
- `duplicateBlock()` — batch-create всех выделенных со сдвигом +1,+1,
  копии становятся новым выделением;
- `deleteSelection()` — batch-delete с `confirm`;
- `updateSelectedBlock(props)` — для мульти-выделения те же значения для
  всех блоков одним batch-update;
- панель: `panelTitle` (тип или «N selected»), `styleActive(style)` —
  активен, когда стиль у всех выделенных, Order скрыт для мульти;
- `_bindKeys()`: Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y, Ctrl+D, Delete/Backspace,
  Escape, стрелки (Shift = ×10) с coalescing-key «nudge»;
- `_markSelectedPreviews()` — подсветка выделенных на канвасе, вызывается
  при каждом изменении выделения.

**Шаблоны** (`boxframe/templates/pages/editor.html`,
`boxframe/static/editor/index.html` — идентично):
- элемент списка: класс `.block-item--selected`, `onListItemClick`
  (Shift/Ctrl — toggle);
- заголовок панели: `panelTitle`, кнопка закрытия — `clearSelection()`;
- действия Duplicate/Delete — `duplicateBlock()` / `deleteSelection()`;
- кнопки Line Style: `styleActive(s)`;
- Order: `x-show="!isMultiSelect"`.

**`boxframe/static/css/editor.css`**:
- `.marquee` — пунктирная рамка выделения;
- `.block-preview--selected` — контур выделенных блоков.

**Тесты**:
- `tests/api/test_layouts.py` (6): create/update/delete за один запрос,
  авто-порядок, нормализация линий, игнор неизвестных id, пустой payload,
  404;
- `tests/js/test_store.js` (6): batchBlocks в memory (create/update/
  delete, авто-порядок, нормализация линий, неизвестные id, пустой
  payload), local — один `save`;
- `tests/js/test_history.js` (4): batchBlocks — один шаг undo/redo,
  coalescing по key, новый шаг без key, fetch-like store;
- `tests/e2e/test_editor.py` (6): marquee выделяет 2 блока, Shift+клик
  toggle, групповое перемещение (оба блока на одинаковый дельту), Delete
  удаляет группу, Line Style применяется ко всем, Duplicate копирует все
  выделенные.

## Найденные в ходе e2e баги

1. **Подсветка выделенных не обновлялась.** `_markSelectedPreviews()`
   вызывался только внутри `refreshRender()`, а «чистые» изменения
   выделения (marquee/клик/toggle/clear) `refreshRender()` не вызывают —
   реактивная панель/список обновлялись, а классы на канвасе нет.
   Исправлено: вызов добавлен в `selectBlock`/`toggleSelect`/
   `clearSelection`, прямые присваивания `selectedIds` переведены через
   эти методы.
2. **Playwright Python API.** В тесте `click(modifier="Shift")` →
   `click(modifiers=["Shift"])` (параметр — список).

## Проверка

- `pytest tests/ --ignore=tests/e2e` — 116 passed;
- `node --test "tests/js/*.js"` — 108 passed;
- `pytest tests/e2e/ -v` (сервер на :8000) — 51 passed (45 старых + 6
  новых).

# Замечания

1. **Плывущая панель перекрывает соседние блоки.** Панель (264px)
   открывается справа от выделения; при плотной расстановке она накрывает
   соседний блок и перехватывает клики по нему. В e2e обходится выделением
   сначала правого блока (панель открывается вправо от него). Кандидат на
   UX-улучшение: умное позиционирование панели (смена стороны с учётом
   соседних блоков) или перетаскивание/прикрепление панели.
2. **Дублирование маркапа панели.** Любое изменение панели вносить в
   `editor.html` и `static/editor/index.html` синхронно (кандидат на
   рефакторинг — общий партиал/JS-шаблон).
3. **Batch-эндпоинт — единая точка групповых правок.** Все групповые
   операции идут через `POST /blocks/batch`: один запрос, одна транзакция,
   один шаг undo/redo. Новые групповые действия добавлять сюда, а не
   отдельными эндпоинтами.
4. **E2E: панель перехватывает клики.** При написании новых e2e-тестов с
   кликами по блокам рядом с выделением учитывать, что плывущая панель
   может их перекрывать (выбирать порядок кликов или координаты так, чтобы
   блок не был под панелью).
5. **E2E требует запущенный сервер на :8000** и запуск отдельно от
   API-тестов (playwright sync API конфликтует с pytest-asyncio в одном
   процессе).
