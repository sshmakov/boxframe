# Суть проблемы

В редакторе макетов отсутствовала возможность изменения размера блоков мышью. Пользователь мог только перемещать блоки по сетке, но не мог изменить их ширину или высоту.

# Задача

Добавить возможность изменять размер элементов в макете мышью, перетаскивая их за правый нижний угол.

# План работ

- [x] Добавить HTML-превью блоков с resize-handle в рендерер
- [x] Добавить CSS для overlay, block-preview и resize-handle
- [x] Добавить состояния и хендлеры ресайза в editor.js
- [x] Обновить API render-эндпоинт для генерации HTML-превью
- [x] Написать юнит-тесты для новых методов рендерера
- [x] Закоммитить все изменения

# Исследование

**Архитектура рендеринга:**
- Canvas — это `<pre>` с моноширинным шрифтом, блоки рисуются Unicode-символами
- Пиксельные координаты конвертируются в сетку через измерение размера символа
- Drag-and-move уже реализован через mousedown/move/up на canvas

**Подход к ресайзу:**
- Resize-handle — иконка в правом нижнем углу блока
- Появляется при hover, не мешает просмотру
- Ресайз работает по тем же принципам, что и move: пиксели → сетка, clamp к границам
- Минимальный размер блока: 2x2 (иначе border не рисуется)
- Snap к сетке с порогом 0.5 символа

# Выполнение задачи

**1. renderer.py — HTML-превью блоков:**
- `RenderBlock.to_html_preview(block_id)` — генерирует `<div class="block-preview">` с абсолютным позиционированием, border-обёрткой и resize-handle
- `RenderBlock._border_html()` — генерирует border-div с CSS-классом по стилю (solid/dashed/dotted/double)
- `_fmt(value, factor)` — форматирование CSS-значений: целые числа как `"2em"`, а не `"2.0em"`; округление до 4 знаков для избежания `3.5999999999999996`
- `PseudoGraphicRenderer.render_html_preview(blocks_data)` — генерирует полный HTML для всех блоков (включая children), flatten-ит дерево

**2. API — render-эндпоинт:**
- `GET /api/layouts/{id}/render` теперь генерирует HTML с оверлеем блоков
- `_serialize_blocks_for_html(blocks)` — сериализует ORM-блоки в dict для HTML-превью
- HTML-структура: `<div class="render-wrapper">` → `<pre>` (ASCII-арт) + `<div class="render-overlay">` (block-preview divs)

**3. CSS — editor.html:**
- `.render-wrapper` — `position: relative` для контекста позиционирования
- `.render-overlay` — `position: absolute`, `pointer-events: none`, `z-index: 10`
- `.block-preview` — `position: absolute`, `pointer-events: auto` (перехватывает события мыши)
- `.block-border--*` — CSS-рамки для каждого стиля (solid/dashed/dotted/double)
- `.resize-handle` — 14x14px в правом нижнем углу, SVG-иконка стрелки, `opacity: 0` → `1` при hover, `cursor: nwse-resize`

**4. editor.js — логика ресайза:**
- Новые стейты: `resizeStartW/H` (начальные размеры в ячейках), `resizeStartClientX/Y` (координаты мыши при старте), `resizePreviewW/H` (текущие размеры превью)
- `_bindResizeHandles()` — привязка `mousedown` к каждому `.resize-handle` через клонирование ноды (чтобы не затереть другие listeners)
- `onResizeHandleMouseDown(e)` — начало ресайза: захват блока, инициализация превью, `_setPreviewMode('resize')`
- `onCanvasMouseMove(e)` — обработка resize: `dx/dy` от старта, конвертация в сетку, snap к 0.5, clamp к `layoutWidth/Height` и минимуму 2x2
- `_commitBlockResize()` — PUT на API с `{width, height}`, rollback при ошибке
- `_setPreviewMode(mode)` — зелёный preview для resize, красный для move
- `refreshRender()` — вызывает `_bindResizeHandles()` после обновления DOM

**5. Тесты — tests/test_renderer.py:**
- `test_render_block_to_html_preview` — проверка HTML-структуры, data-block-id, resize-handle, CSS-значений
- `test_render_block_to_html_preview_no_border` — блок без рамки
- `test_render_html_preview_single_block` — одиночный блок
- `test_render_html_preview_with_children` — parent + child, проверка что оба имеют resize-handle
- `test_render_html_preview_dashed_border` — dashed border-класс
- `test_render_html_preview_double_border` — double border-класс

**Результат:** все 51 тест прошли (45 существующих + 6 новых)

# Замечания

1. **SVG inline в CSS** — resize-handle использует data:URI SVG. Это работает, но если потребуется динамическая смена цвета/размера, лучше использовать CSS-градиенты или pseudo-elements.

2. **Snap к 0.5** — текущая реализация snap-ит к 0.5 символа. Это компромисс между плавностью и привязкой к сетке. Можно добавить snap к 1.0 (целые ячейки) как альтернативу.

3. **Блокировка событий** — `e.stopPropagation()` в `onResizeHandleMouseDown` предотвращает перехват события canvas-ом. Это важно, потому что resize-handle находится ВНУТРИ canvas-контейнера.

4. **Минимальный размер 2x2** — обусловлен логикой рендерера: при `width < 2 or height < 2` border не рисуется. Если в будущем изменится рендерер, нужно будет обновить и этот constraint.

5. **Переза绑定 listeners** — `_bindResizeHandles()` клонирует ноды для удаления старых listeners. Это работает, но при большом количестве блоков может быть неэффективным. Можно оптимизировать через делегирование событий на `.canvas-container`.

6. **HTML-превью vs ASCII-арт** — сейчас render-эндпоинт генерирует И ASCII, И HTML-превью. Если в будущем потребуется оптимизация, можно добавить query-param `?format=ascii|html` для выбора формата.

7. **Форматирование CSS-значений** — `_fmt()` использует `round(v * factor, 4)` для избежания floating-point артефактов. Это важно, потому что `1.2 * 3 = 3.5999999999999996` в JavaScript/Python.
