# Суть проблемы

В редакторе макетов отсутствовала возможность перетаскивания элементов мышью — нельзя было ни создавать блоки перетаскиванием из палитры на холст, ни перемещать существующие блоки по сетке.

Кроме того, страница проекта (`/project/{id}`) падала с ошибкой 500 из-за некорректного форматирования даты `created_at` в Jinja2-шаблоне.

# Задача

1. Реализовать drag-and-drop из палитры компонентов на canvas для создания новых блоков
2. Реализовать перетаскивание существующих блоков по canvas для их перемещения
3. Исправить ошибку 500 на странице проекта
4. Написать E2E-тесты на все новые функциональности

# План работ

- [x] Добавить drag-состояние и хелперы в editor.js (измерение размера символа, конвертация пикселей в сетку)
- [x] Обновить editor.html: добавить overlay-слой, drag-атрибуты на кнопки палитры, event-хендлеры на canvas
- [x] Реализовать drag из палитры (создание блока) и drag по canvas (перемещение блока)
- [x] Добавить CSS для drag-превью, overlay и подсветки canvas при наведении
- [x] Исправить project.html: заменить `created_at[:10]` на `strftime('%Y-%m-%d')`
- [x] Написать 7 E2E-тестов через Playwright
- [x] Закоммитить все изменения

# Исследование

**Проблема с проектной страницей:**
- Ошибка: `TypeError: 'datetime.datetime' object is not subscriptable`
- Причина: SQLAlchemy возвращает `datetime.datetime` объект, а не строку
- Шаблон `project.html` строка 47 использовал `layout.created_at[:10]` — срезы работают только со строками
- Решение: `layout.created_at.strftime('%Y-%m-%d')`

**Drag-and-drop архитектура:**
- Canvas — это `<pre>` с моноширинным шрифтом, блоки позиционируются по сетке
- Для точного позиционирования нужно измерить размер символа в пикселях
- Измерение: создать временный `<span>` с теми же стилями, что и `<pre>`, получить `getBoundingClientRect().width`
- Конвертация: `gridX = floor((mouseX - containerLeft - padding) / charWidth)`
- Координаты мыши → сетка → привязка к границам layout (clamp)
- Визуальное превью: абсолютно позиционированный `<div>` с пунктирной рамкой поверх canvas

# Выполнение задачи

**1. Исправление project.html (500 error):**
- Заменил `layout.created_at[:10]` на `layout.created_at.strftime('%Y-%m-%d')`
- Страница теперь отдаёт 200 OK

**2. Drag-and-drop в editor.js:**
- Добавлено drag-состояние: `dragMode`, `dragType`, `dragBlock`, `dragGridX/Y`, `previewEl`, `charWidth/Height`, `layoutWidth/Height`
- `_measureCharSize()` — измерение размера символа `<pre>` для точной конвертации пикселей в сетку
- `_pixelToGrid(px, py)` — конвертация координат мыши в координаты сетки
- `_showPreview()` / `_ensurePreviewEl()` — визуальное превью (красная пунктирная рамка)
- `onPaletteDragStart/End` — HTML5 Drag API для кнопок палитры
- `onCanvasDrop` — создание блока при сбросе из палитры
- `onCanvasMouseDown/move` — перемещение существующих блоков
- `_commitBlockMove()` — отправка PUT на сервер с новыми координатами
- `layoutWidth/Height` — размеры берутся из API, а не захардкожены

**3. Обновление editor.html:**
- `draggable="true"` + `@dragstart/@dragend` на кнопках палитры
- `@dragover/@dragleave/@drop` на canvas-контейнере
- `.canvas-drag-overlay` — абсолютный overlay для позиционирования превью
- CSS: `.drag-preview` (красная пунктирная рамка), `.drag-over` (подсветка canvas), курсоры `grab/grabbing`

**4. E2E-тесты (tests/e2e/test_drag_drop.py):**
- `test_project_page_no_500_error` — проверяет, что страница проекта загружается без 500
- `test_palette_buttons_are_draggable` — проверяет атрибут draggable
- `test_drag_from_palette_creates_block` — drag box из палитры на canvas
- `test_drag_existing_block_to_new_position` — mouse drag на canvas
- `test_multiple_blocks_via_palette_drag` — создание 2 блоков drag-ом
- `test_block_list_shows_coordinates` — проверка формата координат `@x,y`
- `test_delete_block_via_block_list` — удаление блока с confirm-диалогом

**Результат:** все 45 тестов прошли (38 существующих + 7 новых)

# Замечания

1. **Измерение размера символа** — работает, но зависит от рендеринга `<pre>`. Если стили изменятся, нужно будет обновить `_measureCharSize()`.

2. **Drag-and-drop в headless-режиме** — Playwright корректно обрабатывает drag events, но `drag_to()` с `force=True` может быть нестабилен при быстром рендеринге. Добавлены `wait_for_timeout()` для синхронизации.

3. **Подтверждение удаления** — `page.on("dialog", ...)` должен быть установлен ДО клика на delete, иначе диалог не перехватывается.

4. **Блокировка canvas** — при перетаскивании нужно игнорировать клик по кнопке удаления (`e.target.closest('.delete-block')`), иначе блок будет перетаскиваться при попытке удалить.

5. **Форматирование дат в Jinja2** — всегда использовать `strftime()` для datetime-объектов от SQLAlchemy, а не срезы `[:10]`.
