# Суть проблемы

Размеры макета (width×height) были обязательными на всех уровнях:
колонки NOT NULL в SQLite, дефолты в модели, ограничения в API
(width 20–200, height 10–100), предзаполнение полей в форме
создания. Пользователь не мог создать макет «без размеров», хотя
размер — это метаданные (задача 0023 сделала его чистыми
метаданными: рамка убрана, экспорт от высоты не зависит).

При этом в редакторе не было способа увидеть логический размер
макета: ни рамки, ни какой-либо визуальной отметки. Если размер
задан, пользователю полезно видеть соответствующую границу — но
она не должна влиять на размещение элементов и на размеры
канваса (политика задачи 0023: блоки можно размещать где угодно,
канвас растёт под контент).

# Задача

- Сделать размеры макета опциональными при создании: пользователь
  задаёт ширину и/или высоту, либо не задаёт ничего;
  предзаполнение размеров в форме отсутствует.
- Если какой-то из размеров задан — отображать в редакторе
  соответствующую границу (ширина → вертикальная линия, высота →
  горизонтальная), видимую пользователю, но не влияющую на
  размещение элементов и размеры канваса.
- В статическом редакторе (без бэкенда) размер считается
  не заданным.

# План работ

- [x] Модель: `width`/`height` nullable (без дефолтов)
- [x] Миграция SQLite: пересборка таблицы `layouts` (idempotent)
- [x] API: опциональные поля в схемах create/out, снятие ge/le-лимитов
- [x] Форма создания: поля опциональны, без предзаполнения
- [x] Рендереры (Python + JS): модель канваса `max(блоки, размеры, 80×24)`
- [x] Граница: `render_bounds_html()` / `renderBoundsHtml()` + CSS
- [x] Статический редактор: размеры не заданы (null)
- [x] Тесты: unit/JS/parity/API/e2e
- [x] Прогнать полный набор тестов (unit + API + JS + parity + e2e)

# Исследование

1. **Миграция** — SQLite не умеет снять NOT NULL на месте.
   Решение: одноразовая пересборка таблицы в `init_db()`
   (`CREATE TABLE layouts_migrated` → `INSERT SELECT` → `DROP` →
   `RENAME`), идемпотентная по `PRAGMA table_info` (нет таблицы
   или обе колонки nullable → выход). Проверено на копии
   реального `boxframe.db`: данные сохранены (win/dialog/
   boxframe/button/grid), после миграции вставляется макет с
   `width=None`.
2. **Модель канваса (Design A)** — канвас = `max(размах блоков,
   заданные размеры, пол 80×24)`. Обоснование: граница должна
   всегда быть видна (канвас ≥ заданным размерам, иначе линия
   окажется за краем); пустой макет сохраняет привычную рабочую
   область 80×24 (преемственность со старыми дефолтами);
   «не влияет на размеры канваса» трактуется как «граница никогда
   не ограничивает/не обрезает — канвас всегда растёт под
   контент». Заданный размер меньше 80×24 пол не опускает:
   макет 40×12 отображается на канвасе 80×24 с границей на
   40×12.
3. **Граница — только HTML-оверлей** — линии рисуются div'ами
   (`.layout-bounds--v/--h`) внутри `render-wrapper`, как
   block-previews: `pointer-events: none`, z-index 5 (ниже
   превью блоков). Формат псевдографики не затрагивается —
   ASCII/Markdown-экспорт идентичен, в JSON-экспорте
   `width`/`height` = `null`.
4. **Parity-обвязка** — `render_js()` собирал node one-liner
   f-строкой и интерполировал Python `None` как литерал `"None"`
   → `ReferenceError: None is not defined`. Исправлено
   `json.dumps()` (None → null).
5. **Баг, пойманный тестами** — оба рендерера после первого
   прохода использовали заданный размер как пол без минимума:
   `canvasSize(blocks, 40, null)` давал `[40, 24]` вместо
   `[80, 24]`. Исправлено `Math.max(width, DEFAULT_CANVAS_WIDTH)`
   (и `max(...)` в Python) — пол 80×24 действует всегда,
   заданный размер только поднимает его.
6. **e2e `test_project_page_no_500_error`** — падал не из-за 500:
   карточка макета без размеров теперь показывает «no bounds»
   вместо «N×M grid» (условный текст в шаблоне). Ассерт
   обновлён под новый текст.

# Выполнение задачи

Изменено 9 исходных файлов + 7 тестовых:

**`boxframe/models/layout.py`** — `width`/`height`:
`Mapped[int | None]`, nullable, без дефолтов.

**`boxframe/database.py`** — `init_db()` вызывает
`_migrate_layouts_size_nullable(conn)` до `create_all`:
пересборка `layouts` с nullable-колонками, данные сохраняются.

**`boxframe/api/projects.py` + `boxframe/api/layouts.py`** —
`LayoutCreate`: `width`/`height: int | None = Field(default=None,
ge=1)` (старые лимиты ge=20/le=200, ge=10/le=100 сняты);
`LayoutOut`: `int | None`. Render-роут вставляет
`bounds_html` в `render-wrapper` между ASCII-слоем и
block-previews.

**`boxframe/services/layout_service.py`** —
`create_layout(project_id, name, width=None, height=None)`.

**`boxframe/services/renderer.py`**:
- `DEFAULT_CANVAS_WIDTH/HEIGHT = 80/24`;
- `canvas_size()` — трёхсторонний max (блоки, заданные размеры,
  пол 80×24);
- `render_bounds_html(width, height, ...)` — классmethod:
  вертикальная линия на `pad + width×char_w`, горизонтальная на
  `pad + height×char_h`; незаданный размер → строки нет;
- `render_simple()` принимает `None`.

**`boxframe/static/js/core/renderer.js`** — зеркало: константы,
`canvasSize()` с `Math.max`, `renderBoundsHtml(opts)` (в
публичном API), `renderHtml()` вставляет границы между
asciiHtml и previews.

**`boxframe/static/js/core/store.js`** — `MemoryStore`:
`width`/`height` = null (статический редактор: размеры не
заданы → канвас 80×24, границ нет).

**`boxframe/static/css/editor.css`** — `.layout-bounds`
(absolute, pointer-events: none, z-index 5), `--v` (border-left)
и `--h` (border-top): пунктир `rgba(233, 69, 96, 0.45)`.

**`boxframe/templates/pages/project.html`** — форма:
`x-data` без предзаполнения, submit шлёт `null` для пустых
полей, `placeholder="Width (optional)"`; карточка макета:
`W×H grid` / `width W` / `height H` / `no bounds`.

**Тесты**:
- `tests/api/test_layouts.py` — добавлены
  `test_create_layout_without_dimensions`,
  `test_create_layout_with_single_dimension`,
  `test_render_without_dimensions_has_no_bounds`;
  `test_render_layout_with_block_outside_bounds` проверяет
  наличие обеих границ.
- `tests/test_renderer.py` — `test_canvas_size_without_dimensions`
  (пол 80×24, заданный размер выше пола поднимает его),
  `test_render_bounds_html`; обновлены
  `test_canvas_size_expands_for_blocks_outside_layout`,
  `test_render_keeps_layout_size_when_blocks_fit` (под пол).
- `tests/js/test_renderer.js` — зеркала + `renderBoundsHtml`/
  `renderHtml`-тесты границ; `renderHtml`-тесты wrapper-размеров
  под пол 80×24 (960×345.6px), расширение канваса — блоком за
  пол (85×25 → 1020×360px).
- `tests/test_js_renderer_parity.py` — `render_js()` через
  `json.dumps`; добавлен `test_parity_no_dimensions`.
- `tests/e2e/test_projects.py` — плейсхолдеры «(optional)»,
  проверка отсутствия предзаполнения (`to_have_value("")`).
- `tests/e2e/test_editor.py` — static-тест: канвас 80×24,
  `.layout-bounds` отсутствуют; drag-тест — оригинальные
  ассерты `> 80` / `> 24`.
- `tests/e2e/test_drag_drop.py` — карточка без размеров:
  «no bounds» вместо «grid».

## Проверка

- `pytest tests/test_renderer.py tests/api/` — **93 passed**.
- `node --test tests/js/*.js` — **53 passed**.
- `pytest tests/test_js_renderer_parity.py` — **10 passed**.
- `pytest tests/e2e/` (сервер на :8000) — **31 passed**.

# Замечания

1. **Размер макета — метаданные + визуальная отметка** — не
   ограничивает размещение блоков; канвас всегда
   `max(размеры, 80×24, блоки)`. Если захочется, чтобы канвас
   сжимался до размера маленького макета (например, 40×12 →
   канвас 40×12), это отдельное проектное решение — сейчас пол
   80×24 осознанно сохраняется.
2. **Миграция — одноразовая пересборка таблицы** — выполняется
   при каждом старте (идемпотентно). Если схема будет меняться
   снова, стоит перейти на alembic.
3. **Граница видна только в HTML-превью** (редактор, web +
   static-режимы без размеров). ASCII/Markdown/Copy-экспорт не
   содержит границ — формат псевдографики не менялся.
4. **`LayoutUpdate` существует, но не используется роутами** —
   размеры нельзя изменить после создания (вне scope задачи).
   Если понадобится — PUT-роут + повторный render.
5. **Статический редактор** — размеры всегда null по дизайну;
   `MemoryStore` при этом принимает `options.width/height`, так
   что статический режим с границами включается без правок
   рендерера.
