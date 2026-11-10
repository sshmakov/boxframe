# Суть проблемы

В дереве элементов (задача 0081) строки показывают блоки, но при наведении
курсора на строку в макете ничего не происходит: чтобы понять, какой блок
на канвасе соответствует строке, приходится кликать (что меняет выделение)
или визуально сопоставлять координаты из tooltip. Это неудобно при навигации
по вложенным макетам — нужен способ опознать блок на канвасе без изменения
состояния редактора.

# Задача

При наведении мышью на строку дерева элементов (только hover, без клика)
подсвечивать соответствующий блок в макете. Подсветка информационная: не
меняет выделение, не трогает данные, исчезает при уходе курсора со строки.

# План работ

- [x] Состояние `hoveredBlockId` в `editor.js`
- [x] Методы `setHover` / `clearHover` / `_hoverPreviewEl` / `_markHoverPreview`
      (diff-синхронизация класса, аналог `_markSelectedPreviews`)
- [x] Перенанесение подсветки после ре-рендера (`$nextTick` в `refreshRender`)
- [x] Обработчики `@mouseenter` / `@mouseleave` на `.block-item`
      в обоих шаблонах (web + static)
- [x] CSS-класс `.block-preview--hover` (отличим от выделения и drop-target)
- [x] e2e-тесты: базовый hover + вложенный ребёнок
- [x] Прогнать тесты

# Исследование

В редакторе уже есть два механизма подсветки блоков на канвасе через CSS-класс
на DOM-узле HTML-оверлея `.block-preview[data-block-id="…"]`:
- `_markSelectedPreviews()` — класс `block-preview--selected` (красный outline);
- `_updateDropTargetHighlight()` — класс `block-preview--drop-target` (зелёный),
  diff-синхронизация: с старых и новых id снимает/ставит класс точечно, без
  перерисовки всего оверлея.

HTML-оверлей (`_blockPreviewHtml` в renderer.js / renderer.py) генерирует для
каждого блока `<div class="block-preview" data-block-id> → <div class="block-inner
block-<type>">`, дети вложены в обёртку `.block-clip`. Значит подсветку можно
ставить точечно по `data-block-id` независимо от вложенности — `querySelector`
находит нужный узел.

Изменение состояния `hoveredBlockId` не должно перерисовывать `htmlPreview`
(x-html) — иначе теряются классы. Поэтому подсветка правится императивно на
DOM-узле (как drop-target), а реактивный `hoveredBlockId` нужен лишь для
diff-логики и перенанесения после ре-рендера.

# Выполнение задачи

Реализовано полностью.

**editor.js:**
- `hoveredBlockId: null` — id строки под курсором (в секции selection state).
- `_hoverPreviewEl(id)` — `querySelector('.block-preview[data-block-id=…]')`
  в `.canvas-container`.
- `setHover(id)` — ранний выход если id не изменился; со старого узла снимает
  `block-preview--hover`, на новом ставит.
- `clearHover(id)` — снимает подсветку только если `hoveredBlockId === id`
  (защита от порядка событий enter/leave при переходе курсором между
  соседними строками: если leave приходит после enter новой строки — no-op).
- `_markHoverPreview()` — после ре-рендера оверлея (x-html заменяет DOM)
  заново навешивает класс на всё ещё hover-имый блок; вызывается в
  `$nextTick` внутри `refreshRender` рядом с `_markSelectedPreviews()`.

**Шаблоны (editor.html + static/index.html):**
- на `.block-item` добавлены `@mouseenter="setHover(block.id)"` и
  `@mouseleave="clearHover(block.id)"`.

**CSS (editor.css):**
- `.block-preview--hover` — `outline: 1px dashed rgba(78,161,255,.9)`
  + лёгкая подложка `.block-inner`. Пунктирный синий — намеренно отличим от
  сплошного красного выделения (`--selected`) и зелёного drop-target.

**e2e-тесты:**
- `test_tree_row_hover_highlights_block` — hover строки первого бокса → ровно
  один `.block-preview--hover`; переход на вторую строку подсвечивает другой
  блок (старый сброшен, count=1); уход на палитру → count=0; параллельно
  проверяется, что hover НЕ создаёт выделение
  (`.block-preview--selected` / `.block-item--selected` count=0).
- `test_tree_row_hover_nested_child` — hover строки вложенного ребёнка
  подсвечивает сам ребёнок, а не контейнер (мишень — точный `data-block-id`).

Тесты: 2 новых e2e прошли; регресс `test_drag_block_highlights_drop_target`
прошёл; `node --check editor.js` OK.

# Замечания

- Подсветка намеренно императивная (класс на DOM), а не реактивный оверлей:
  держится в одном месте с `--selected`/`--drop-target` и не тянет перерисовку
  x-html. Если появится много hover-эффектов — стоит унифицировать все три
  подсветки в один хелпер `_setBlockClass(id, cls, on)`.
- Outline рисуется СНАРУЖИ border-box и клипается `overflow:hidden` предка
  (известное ограничение HTML-оверлея, см. задачу 0071). Для вложенного
  ребёнка outline может обрезаться рамкой контейнера — но это тот же trade-off,
  что у `--selected`/`--drop-target`; подложка `.block-inner` гарантирует
  видимость подсветки даже borderless-блока.
- Hover не подсвечивает поддерево контейнера (только сам блок). Если позже
  понадобится «наведение на контейнер подсвечивает всю его иерархию» —
  расширить `setHover` обходом `_subtreeIds`.
- На touch-устройствах `mouseenter`/`mouseleave` ведут себя иначе; не в scope
  десктопного редактора.
