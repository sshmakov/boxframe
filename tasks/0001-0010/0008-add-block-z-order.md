# Суть проблемы

В редакторе boxframe не было явного управления z-order (порядком наложения) блоков.
Блоки рендерились в порядке `(y, x)` — верхний левый приоритет — без возможности
пользователю переставить блок поверх или под другой.

Поле `order` существовало в модели `Block`, но нигде не использовалось:
ни в рендерере, ни в API, ни во фронтенде.

В HTML-превью все `.block-preview` имели одинаковый `z-index: 10`, и
перекрывание определялось порядком в DOM, а не явным значением.

# Задача

Реализовать управление z-order блоков через поле `order`:
- ASCII-рендерер должен сортировать блоки по `order` (выше order → поверх)
- HTML-превью должно генерировать `z-index` на основе `order`
- API должно принимать и возвращать `order` для блоков
- Редактор должен предоставлять UI для изменения `order` (кнопки ↑↓)

# План работ

- [x] Добавить `order` в `RenderBlock` dataclass
- [x] Изменить сортировку в `PseudoGraphicRenderer.render()` на `key=lambda b: b.order`
- [x] Обновить `to_html_preview()` — генерировать `z-index: 10 + order` и `data-order`
- [x] Обновить `render_simple()` и `render_html_preview()` — передавать `order` из data dicts
- [x] Добавить `order` в Pydantic-схемы `BlockCreate` и `BlockUpdate`
- [x] Обновить `_serialize_blocks_for_html()` — включать `order` в сериализацию
- [x] Обновить `LayoutService.create_block()` — принимать `order`
- [x] Обновить `LayoutService._build_render_blocks()` — передавать `order` в RenderBlock
- [x] Добавить UI: кнопки ↑↓ и отображение `#N` в списке блоков
- [x] Добавить методы `moveBlockOrder()` и `maxOrder` в editor.js
- [x] Новые блоки получать `order = max + 1` (всегда поверх)
- [x] Написать тесты для order-based сортировки и z-index

# Исследование

При анализе кода обнаружено:

1. **Модель** (`models/block.py`): поле `order: int` с default=0 существует, но не используется.
2. **Рендерер** (`services/renderer.py`): сортировка `sorted(blocks, key=lambda b: (b.y, b.x))` —
   по координатам, игнорируя `order`.
3. **HTML-превью**: все блоки имеют `z-index: 10` (из CSS), никакого динамического z-index нет.
4. **API**: `BlockOut` возвращает `order`, но `BlockCreate`/`BlockUpdate` его не принимают.
5. **Фронтенд**: список блоков показывает тип и координаты, но не order; нет UI для управления.

# Выполнение задачи

Изменены 6 файлов:

**`services/renderer.py`** (3 изменения):
- `RenderBlock` — добавлено поле `order: int = 0`
- `render()` — сортировка по `order` вместо `(y, x)`
- `to_html_preview()` — `z-index = 10 + order`, атрибут `data-order`
- `render_simple()` / `render_html_preview()` — передают `order` из dicts

**`api/layouts.py`** (3 изменения):
- `BlockCreate` — добавлено `order: int = 0`
- `BlockUpdate` — добавлено `order: int | None = None`
- `_serialize_blocks_for_html()` — включает `order` для root и child блоков

**`services/layout_service.py`** (2 изменения):
- `create_block()` — параметр `order`, передача в `Block()`
- `_build_render_blocks()` — передача `block.order` в `RenderBlock()`

**`templates/pages/editor.html`** (2 изменения):
- Список блоков: показ `#N`, кнопки ↑↓, span `.block-actions`
- CSS: стили для `.block-order`, `.block-actions`, `.order-btn`

**`static/js/editor.js`** (6 изменений):
- `_reorderBlocks()` — сортировка списка по `order` (descending: highest order first)
- `moveBlockOrder(blockId, delta)` — swap order с rollback при ошибке
- `maxOrder` getter — максимум из всех order
- `addBlock()` — новый блок получает `maxOrder + 1`
- `onCanvasDrop()` — новый блок из drag-drop получает `maxOrder + 1`
- `fetchBlocks()` / `deleteBlock()` — вызывают `_reorderBlocks()` после загрузки/удаления
- `_reorderBlocks()` вызывается после всех операций: `fetchBlocks`, `addBlock`, `deleteBlock`,
  `onCanvasDrop`, `moveBlockOrder` — список всегда отсортирован

**`tests/test_renderer.py`** (5 новых тестов):
- `test_render_sorts_by_order` — overlap: higher order перекрывает lower
- `test_render_default_order_zero` — дефолт order=0, insertion order решает
- `test_render_block_html_preview_z_index` — order=5 → z-index:15
- `test_render_block_html_preview_default_z_index` — order=0 → z-index:10
- `test_render_html_preview_with_order` — несколько блоков с разными order

Все 57 тестов прошли.

# Замечания

1. **Swap-логика** в `moveBlockOrder()` — при перемещении блока на позицию,
   занятую другим блоком, происходит swap order. Это корректно для небольших
   наборов блоков, но для больших списков можно добавить сдвиг (shift).

2. **Диапазон z-index** — CSS имеет `.resize-handle: z-index: 20` и
   `.drag-preview: z-index: 30`. Если блок получит `order >= 10`, его
   `z-index` превысит 20 и блок перекроет resize-handle. Это ожидаемое
   поведение (блок должен быть поверх своего handle), но стоит учитывать.

3. **Наследование order для children** — дочерние блоки имеют собственный
   `order`, но при `_render_children_in_container()` они рендерятся внутри
   родителя. Порядок children внутри контейнера тоже зависит от `order`.

4. **Экспорт JSON** — `export_json()` не включает `order` в вывод.
   Это можно добавить в будущем для полноты сериализации.

## Последующие изменения

**Commit `8c446dd`** — `_reorderBlocks()` вызывается после всех операций:
`fetchBlocks`, `addBlock`, `deleteBlock`, `onCanvasDrop`, `moveBlockOrder`.
Список всегда отсортирован, не нужно вызывать вручную в каждом месте.

**Commit `2086592`** — инвертирована сортировка списка: теперь `order` descending
(highest order first). Первый в списке = верхний слой, последний = нижний.
Кнопки ↑↓ двигают блок вверх/вниз в списке синхронно с z-index.
