# Суть проблемы

Список элементов в сайдбаре редактора отображает все блоки плоским
списком, отсортированным по глобальному z-order. Для вложенных макетов
(box с детьми, grid с детьми) невозможно визуально определить, какой блок
является ребёнком какого контейнера — все блоки выглядят одинаково.
Кнопки ↑↓ перемещают z-order глобально, что неинтуитивно для вложенных
структур.

# Задача

Заменить плоский список элементов на дерево, отражающее вложенность
родитель/потомок через `parent_id`, с визуальными отступами по глубине
и маркером контейнеров. Адаптировать перемещение ↑↓ для работы в рамках
siblings (одного родителя).

# План работ

- [x] Добавить getter `treeBlocks` в `editor.js` (post-order с `_depth`)
- [x] Добавить `_siblingsOf`, `canMoveUp`, `canMoveDown`
- [x] Переписать `moveBlockOrder` — свап order между adjacent sibling
- [x] Обновить шаблоны: `x-for="block in treeBlocks"`, отступ по `_depth`,
  маркер `▾`/`·`, `data-coords`, tooltip с координатами
- [x] CSS для маркера дерева (`.block-item__tree`)
- [x] Обновить e2e-тесты: селекторы `data-coords` вместо has_text с координатами
- [x] Прогнать тесты

# Исследование

Текущая структура данных уже поддерживает дерево: каждый блок имеет
`parent_id`, API возвращает плоский список. `_flattenBlocks()` делает
pre-order обход при импорте, `subtreeIds()` обходит детей по `parent_id`.
Алгебраически дерево строится из плоского массива за O(n) через
children-map — никаких изменений в модели/API/рендерере не требуется.

Alpine.js не поддерживает нативную рекурсию в `x-for`. Выбран подход
«плоский список + отступ»: `treeBlocks` getter возвращает плоский массив
в tree-order с `_depth`, а CSS `padding-left` даёт визуальную иерархию.
Глубина в boxframe практически всегда ≤ 2–3, collapse/expand не требуются.

# Выполнение задачи

Реализовано полностью:

**editor.js:**
- `_containerTypes: ['box', 'grid']` — типы, отображающие детей
- `get treeBlocks()` — строит children-map из `blocks[]` по `parent_id`,
  обходит pre-order (root → дети), сортирует siblings по убыванию `order`,
  каждому блоку присваивает `_depth` и `_isContainer`
- `_siblingsOf(blockId)` — все блоки с тем же родителем, сортировка
- `canMoveUp(blockId)` / `canMoveDown(blockId)` — есть ли сосед в списке
- `moveBlockOrder(blockId, delta)` — находит adjacent sibling в группе,
  свапает `order` обоих, обновляет оба через `store.updateBlock`

**Шаблоны (editor.html + static/index.html):**
- `x-for="block in treeBlocks"` вместо `x-for="(block, idx) in blocks"`
- `:style="'padding-left:' + (8 + block._depth * 16) + 'px'"` — отступ
- `<span class="block-item__tree">` — `▾` для контейнеров, `·` для вложенных
- `:data-coords="block.x + ',' + block.y"` — программный доступ к координатам
- `:title` — tooltip с координатами и z-order (ранее были inline-текстом)
- Кнопки: `@click.stop`, `:disabled="!canMoveDown(block.id)"` / `!canMoveUp`

**CSS:**
- `.block-item__tree` — фиксированная ширина 10px, приглушённый цвет

**e2e-тесты:**
- `has_text="@(x,y)"` → `[data-coords="x,y"]` (attribute selector)
- `test_block_list_shows_coordinates` — проверка `data-coords` вместо text_content
- `test_static_editor_import_add_when_not_empty` — `evaluate_all` для dataset.coords

Координаты и z-order убраны из видимого текста по требованию пользователя
(мешают видеть кнопки); доступны в tooltip и `data-coords`.

# Замечания

- Getter `treeBlocks` пересчитывается при каждом обращении (Alpine reactive).
  Для макетов с десятками блоков это не проблема. Если появится тысяча
  блоков — можно кэшировать с инвалидацией при мутациях.
- `moveBlockOrder` теперь делает **два** `store.updateBlock` (свап order
  обоих siblings). В web-режиме это два PATCH-запроса. Для undo/redo через
  `replaceState` это не критично (снапшот полный), но при быстром клике
  ↑↓ подряд возможны race conditions — пока не наблюдалось.
- `_siblingsOf` линейно ищет `this.blocks.some(...)` для валидации parent_id
  — можно оптимизировать через Set, но при типичном размере не нужно.
- Перетаскивание в дереве (reparenting) не реализовано — candidate на
  future iteration.
- `get maxOrder` сохранён — используется при создании блоков и импорте,
  но больше не привязан к disabled-кнопкам в списке.
