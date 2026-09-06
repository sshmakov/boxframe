# Суть проблемы

Редактор работал только как часть FastAPI-приложения: страница рендерилась
Jinja-шаблоном, а `editor.js` делал 8 классов API-вызовов (info, load,
render, block CRUD, export). Ядро продукта — псевдографический рендерер —
существовал только на Python (`services/renderer.py`), поэтому открыть
редактор как статическую страницу (без сервера, для офлайн-работы или
быстрого прототипирования) было невозможно.

# Задача

Сделать редактор запускаемым как статическую страницу без бэкенда:
открыть файл в браузере (даже через `file://`) и работать — палитра,
drag&drop, выделение, инлайн-редактирование, панель свойств, экспорт.
Сохранение данных между сессиями не требуется (данные живут в памяти).
Бэкенд-версия при этом должна продолжать работать без изменений
поведения.

# План работ

- [x] Исследовать зависимости редактора от бэкенда (API-вызовы, рендерер, шаблоны, CDN)
- [x] `core/renderer.js` — порт `PseudoGraphicRenderer` на JS (сетка, BORDERS, wrap, вложенность, HTML-оверлей)
- [x] `core/store.js` — общий интерфейс хранилища: `FetchStore` (API) и `MemoryStore` (in-memory)
- [x] `editor.js` — заменить все `fetch()` на вызовы store; режим определяется по `data-layout-id`
- [x] Вынести CSS редактора из `editor.html` в `static/css/editor.css`
- [x] Вендорнуть Alpine.js 3.14.3 в `static/js/alpine.min.js`, подключить локально в base.html
- [x] `static/editor/index.html` — автономная страница (без Jinja, без API)
- [x] `tests/js/test_renderer.js` — зеркало тестов Python-рендерера (node:test)
- [x] `tests/test_js_renderer_parity.py` — дифференциальные тесты Python↔JS рендереры
- [x] e2e-тесты статической страницы + проверка `file://` без сервера
- [x] Прогнать все тесты (unit/API + parity + e2e)

# Исследование

1. **Зависимости редактора от бэкенда** — (а) Jinja-шаблон `editor.html`
   требует `layout.id`/`project_id`/`project_name`; (б) 8 API-вызовов в
   `editor.js`: `GET /api/projects/{id}/info` (списки типов/стилей —
   константы), `GET /api/layouts/{id}` (размеры + блоки),
   `GET /api/layouts/{id}/render` (серверный ASCII + HTML-оверлей),
   `POST/PUT/DELETE /api/layouts/{id}/blocks...`,
   `GET /api/layouts/{id}/export`; (в) рендерер на Python; (г) Alpine.js
   с CDN. HTMX в самом редакторе не используется.
2. **Рендерер портируется 1:1** — алгоритм простой: 2D-сетка символов,
   карта `BORDERS`, рисование рамок/линий/контента, обёртка текста по
   словам, вложенность с паддингом 1. Ключевые нюансы, сохранённые в
   порте: стабильная сортировка по `order` (при равных — порядок
   вставки), дети сортируются по `(y, x)`, клампинг к границам сетки,
   линии всегда 1-клеточные, hint `[type]` для пустых блоков с рамкой.
3. **HTML-оверлей** — сервер возвращает строку с позиционированными
   div'ами (`.block-preview` + `.resize-handle`), которую `editor.js`
   вставляет через `x-html` и после каждого рендера заново привязывает
   слушатели (хак с `cloneNode` в `_bindResizeHandles`). В статическом
   режиме та же разметка генерируется локально (`PGRenderer.renderHtml`)
   — байт-в-байт как у API, поэтому CSS и логика оверлеев общие.
4. **Единое ядро без дублирования** — `editor.js` больше не знает о
   fetch: все операции идут через store с асинхронным интерфейсом
   (`info/load/render/createBlock/updateBlock/deleteBlock/export`).
   Web-режим (`data-layout-id` в DOM) → `FetchStore`, статический →
   `MemoryStore`. Разметка и CSS — один и те же файлы.
5. **Риск дрейфа двух рендереров** — Python остаётся серверным
   (API-контракт `/render` не меняется), JS — клиентским. Синхронизация
   держится на трёх уровнях: зеркальные unit-тесты (Python: 30+, JS: 32)
   и parity-тесты, прогоняющие один и тот же ввод через оба рендерера и
   сравнивающие вывод побайтово (7 сценариев, включая вложенность).
   Parity-тесты требуют node в PATH, иначе skip.

# Выполнение задачи

**Новые файлы:**
- `boxframe/static/js/core/renderer.js` — порт рендерера: `render()`
  (flat-список блоков с `parent_id` → ASCII), `wrapText()`,
  `toHtmlPreview()`/`renderHtmlPreview()` (оверлей), `renderHtml()`
  (полный canvas как у API), константы `BLOCK_TYPES`/`BORDER_STYLES`
  (зеркало `models/block.py`). Обычный скрипт с глобалами (работает из
  `file://`, ES-модули там не грузятся) + CommonJS-экспорт для node.
- `boxframe/static/js/core/store.js` — `createFetchStore(layoutId,
  projectId)` (те же API-вызовы, что были в editor.js, + проверка
  `r.ok`) и `createMemoryStore()` (in-memory layout 80×24, id через
  `crypto.randomUUID`, правила API воспроизведены: `order==0 → max+1`,
  `hline→h=1`, `vline→w=1`; экспорт JSON/MD/ASCII строится локально).
- `boxframe/static/editor/index.html` — автономная страница: разметка
  редактора без Jinja, без `data-layout-id`, без хлебных крошек;
  относительные пути к CSS/JS; локальный Alpine.
- `boxframe/static/css/editor.css` — CSS редактора, вынесен из
  inline-`<style>` шаблона (533 строки, без изменений).
- `boxframe/static/js/alpine.min.js` — Alpine.js 3.14.3 (тот же, что был
  с CDN).
- `tests/js/test_renderer.js` — 32 теста на `node:test`, зеркало
  `tests/test_renderer.py` (рамки, стили, линии, wrap, order,
  HTML-оверлей, escape).
- `tests/test_js_renderer_parity.py` — 7 дифференциальных тестов
  Python↔JS (простые блоки, все стили, линии, wrap, z-order, вложенность,
  клампинг).

**Изменённые файлы:**
- `boxframe/static/js/editor.js` — все `fetch()` заменены на
  `this.store.*`; `init()` создаёт store по наличию `data-layout-id`;
  `exportAs()` берёт имя файла из `layoutId` (в статике — `layout`).
  Побочный фикс: JSON-экспорт в web-режиме был сломан — `editor.js`
  читал `data.json`, а API отдаёт `layout_json` (скачивался файл с
  текстом "undefined"); `FetchStore.export()` теперь нормализует поле.
- `boxframe/templates/pages/editor.html` — inline-`<style>` →
  `<link href="/static/css/editor.css">`; в блок скриптов добавлены
  `core/renderer.js` и `core/store.js` перед `editor.js`.
- `boxframe/templates/pages/base.html` — Alpine подключается локально
  (`/static/js/alpine.min.js`) вместо CDN; HTMX пока с CDN (в редакторе
  не используется).
- `tests/e2e/test_editor.py` — +3 теста статической страницы (загрузка и
  рендер, добавление блока в память, удаление блока).

## Проверка

- `node --test "tests/js/*.js"` — **32 passed**.
- `pytest tests/api/ tests/test_renderer.py tests/test_js_renderer_parity.py` — **75 passed** (68 прежних + 7 parity).
- `pytest tests/e2e/` — **29 passed** (26 прежних + 3 новых).
- `tmp/verify_static_file.py` — headless Chromium открывает
  `static/editor/index.html` через `file://` **без запущенного сервера**:
  палитра (14 кнопок), добавление/выделение/инлайн-редактирование
  блока, экспорт ASCII-файла — всё работает, API-запросов ноль.

# Замечания

1. **Две реализации рендерера** — при любом изменении формата
   псевдографики править надо и `services/renderer.py`, и
   `core/renderer.js`, и оба набора тестов. Parity-тесты ловят
   рассинхрон, но только на тех сценариях, что покрыты.
2. **Блоки с `parent_id` в UI не создаются** — как и раньше, вложенность
   рендерится (и в Python, и в JS), но интерфейс её не использует.
   HTML-оверлей детей позиционируется по их x/y «как есть» — поведение
   JS-порта точно совпадает с серверным (в т.ч. в этой особенности).
3. **Данные статического режима не переживают перезагрузку** — по
   требованию. Если понадобится: localStorage в `MemoryStore`
   (save/load ~10 строк) или импорт/экспорт layout-JSON как мост между
   режимами (формат JSON-экспорта уже общий).
4. **HTMX остался на CDN** — статический редактор без него обходится,
   но web-страницы (projects/project) при офлайн-запуске не
   подгрузят htmx. При желании вендорнуть аналогично Alpine.
5. **`node --test tests/js/` (каталог) не работает** в node 24 —
   каталог трактуется как модуль; запускать через glob:
   `node --test "tests/js/*.js"`.
6. **Статическая страница доступна и через web-сервер** —
   `/static/editor/index.html` (StaticFiles отдаёт её из того же
   каталога), удобно для демо без file://.
