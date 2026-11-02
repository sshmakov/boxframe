# AGENTS.md — boxframe

## О проекте

**boxframe** — редактор UI-макетов в псевдографике (ASCII/Unicode box-drawing). Макеты машиночитаемы, самодокументируемы и оптимизированы для потребления ИИ-агентами.

**Стек:** Python 3.11+, FastAPI, SQLAlchemy (aiosqlite), Jinja2, HTMX 2, Alpine.js 3.

## Структура

```
boxframe/
├── boxframe/
│   ├── api/                    # FastAPI роутеры
│   │   ├── projects.py         # CRUD проектов
│   │   └── layouts.py          # CRUD layout/blocks + render + export
│   ├── models/                 # SQLAlchemy ORM
│   │   ├── project.py          # Project
│   │   ├── layout.py           # Layout (width×height)
│   │   └── block.py            # Block (x,y,w,h, type, content, border)
│   ├── services/               # Бизнес-логика
│   │   ├── layout_service.py   # CRUD + render + export
│   │   └── renderer.py         # Псевдографика (Unicode box-drawing)
│   ├── static/                 # Статика
│   │   ├── css/style.css       # Dark theme
│   │   ├── css/editor.css      # Стили редактора (общие для web и static)
│   │   ├── editor/index.html   # Статический редактор (без бэкенда)
│   │   └── js/
│   │       ├── alpine.min.js   # Alpine.js (вендор, без CDN)
│   │       ├── core/renderer.js# JS-порт рендерера (static-режим)
│   │       ├── core/store.js   # FetchStore / LocalStorageStore / MemoryStore
│   │       ├── core/history.js # withHistory — undo/redo (snapshot-стеки)
│   │       ├── core/import.js  # parseLayoutJson / prepareImport (импорт JSON)
│   │       └── editor.js       # Alpine.js editor app (общий)
│   ├── templates/pages/        # Jinja2 шаблоны
│   │   ├── base.html
│   │   ├── projects.html
│   │   ├── project.html
│   │   └── editor.html
│   ├── config.py               # Pydantic Settings
│   ├── database.py             # Async engine + session
│   └── main.py                 # FastAPI app + page routes
├── tests/
│   ├── api/                    # API unit-тесты (httpx + TestClient)
│   │   ├── test_projects.py    # CRUD проектов
│   │   └── test_layouts.py     # CRUD layout/blocks + render + export
│   ├── e2e/                    # End-to-end тесты (Playwright)
│   │   ├── conftest.py         # fixture reset_page_state
│   │   ├── test_editor.py      # Загрузка страниц editor/project/index + static
│   │   └── test_projects.py    # New Project / New Layout кнопки + форма
│   ├── js/test_renderer.js     # Тесты JS-рендерера (node:test)
│   ├── js/test_store.js        # Тесты JS-хранилищ (node:test)
│   ├── js/test_history.js      # Тесты undo/redo-истории (node:test)
│   ├── js/test_import.js       # Тесты импорта JSON (node:test)
│   ├── conftest.py             # API-файстуры (async engine + TestClient)
│   ├── test_js_renderer_parity.py # Parity Python↔JS рендереры
│   └── test_renderer.py        # Тесты рендерера (ASCII + HTML-оверлей)
├── scripts/
│   └── bump.sh                 # Релиз: bump минора, тег vX.Y.Z, push
├── pyproject.toml
├── requirements.txt
└── README.md
```

## Ключевые концепции

### Блоки

Типы: `box`, `header`, `footer`, `sidebar`, `content`, `button`, `input`, `textarea`, `image`, `divider`, `hline`, `vline`, `text`, `grid`

Стили границ: `solid` (─│), `dashed` (┄┆), `dotted` (┈┊), `double` (═║), `none` — применяются и к рамкам блоков, и к линиям (`hline`/`vline` рисуются символом выбранного стиля)

`button` — особая форма в зависимости от высоты (спецификация в `tasks/0021-0030/0022-button.md`, ревизия — `tasks/0051-0060/0060-button-multiline-autosize.md`):
- `h=1`: `[label        ]`
- `h=2`: `│label        │` + `└──────┘` (без верхней рамки; только ручной resize —
  autosize форму h=2 не генерирует)
- `h>=3`: полная рамка, label в внутренней области (y+1, h-2 строки)
- label — многострочный: word-wrap по внутренней ширине (как `box`/`content`),
  явные `\n` сохраняются; строки, не помещающиеся по высоте, не рисуются
  (рамка рисуется первой и не перезаписывается)
- выравнивание label по умолчанию — `center`/`middle` (в отличие от `box`:
  left/top); настраивается `meta.text_align`/`meta.vertical_align`
- autosize: `button_block_size()` в `renderer.py` / `buttonBlockSize()` в
  `core/renderer.js` — 1 строка (вкл. пустую) с рамкой → `max(3, w+2)×1`,
  N≥2 строк с рамкой → `w+2×(N+2)`, `none` → `w×N` (пустой — 1×1);
  пересчитывается при создании и при обновлении `content`/`border_style`/
  `block_type`; ручной resize сохраняется; `replace_blocks` не пересчитывает
- новый блок: 8×1, label `Button` (размер из fit-функции)

`text` — autosize по размеру содержимого (спецификация в `tasks/0041-0050/0049-text-block-autosize.md`):
- по умолчанию без рамки (`border_style=none`), минимальный размер 1×1
- размер = размер текста (самая длинная строка × число строк, перенос слов не
  применяется; пустой текст — 1 строка) + рамка (1 клетка с каждой стороны,
  если стиль ≠ `none`): `text_block_size()` в `renderer.py` / `textBlockSize()`
  в `core/renderer.js`
- пересчитывается при создании и при обновлении `content`/`border_style`/
  `block_type`; ручной resize (только x/y/width/height) сохраняется до
  следующего изменения содержимого; `replace_blocks` (undo/redo) размер не
  пересчитывает — восстанавливает сохранённый как есть

`divider` — мультилинейный разделитель (вариант E, спецификация в
`tasks/backlog/todo-0003-divider-design.md`):
- линия на каждой строке сохранённого размера (символ по `border_style`,
  `none` — невидима), подпись (content) строками как есть поверх линии
  (без word-wrap и схлопывания пробелов), каждая строка выравнивается
  независимо (`meta.text_align`, дефолт `center`), блок подписи
  сдвигается вертикально в пределах сохранённой высоты
  (`meta.vertical_align`, дефолт `middle` — в отличие от `box`, где
  дефолт `top`)
- новый блок: 30×1, подпись `[divider]`
- autosize только роста: при создании/обновлении `width = max(width, самая
  длинная строка)`, `height = max(height, число строк)`; сжатие при
  уменьшении контента не выполняется (в отличие от `text`); ручной resize
  свободный (min 1×1); `replace_blocks` размер не пересчитывает
- дети не поддерживаются (атомарный элемент); arrows/fill не применяются
- HTML-оверлей — сегменты линии (до 2 div на строку вокруг подписи), т.к.
  оверлей лежит поверх ASCII-слоя

`grid` — сетка-контейнер (вариант 1, спецификация в
`tasks/backlog/todo-0005-grid-design.md`):
- внешняя рамка + внутренние перегородки: число колонок/рядов —
  `meta.cols`/`meta.rows` (дефолт 3/2, некорректное значение → дефолт);
  эффективное число клампится к внутренней области (каждая колонка/строка
  ≥ 1 клетки), остаток распределяется `i*inner_w // eff_cols`
- обратная совместимость (0069): перегородки рисуются только у grid **с
  структурой** — валидный `meta.cols` **или** `meta.rows` (positive int;
  `grid_has_structure()`/`gridHasStructure()`). Grid без структуры
  (старые макеты, созданные до 0061, когда `grid` был plain box)
  рендерится как обычный box: рамка + hint `[grid]` + дети, без
  перегородок и ручек. Структура инжектится при **создании**
  (`grid_create_meta()`/`gridCreateMeta()`, дефолт 3/2): API create,
  API batch create, static store `createBlock`/`batchBlocks`; в
  update/`replaceState` **не** инжектится — legacy grid остаётся legacy,
  undo/redo восстанавливает meta как есть. Панель свойств legacy grid
  показывает **1/1** (эффективная структура — ноль перегородок), а не
  дефолт 3/2 (`readPropValue` в `core/properties.js`); первое
  изменение cols/rows материализует структуру — нетронутое измерение
  сидится в 1 (`applyPropValue` в `editor.js`), т.е. панель всегда
  показывает отрисованный размер (Cols 1→3 рендерит 3×1, не 3×2)
- кастомные ширины/высоты (0067): `meta.col_widths`/`meta.row_heights` —
  массивы целых ширин колонок/высот строк (по одному на колонку/строку).
  Отсутствует/некорректный массив (не список, длина ≠ eff, элемент < 1) →
  равномерный split (назад-совместимо). Позиции перегородок — префиксные
  суммы с клампом `min(x[-1]+w, total-(n-i))`: каждая колонка/строка
  держит ≥ 1 клетки, **последняя впитывает дельту** (sum < total —
  расширяется, sum > total — сжимается до 1). Вычисляется в
  `grid_split()`/`gridSplit()` (общий код span-подавления и ручек);
  span (0062–0068) работает на неравном split без изменений
- структурный элемент: `content` и hint `[grid]` не рендерятся; fill
  рисуется под перегородками; дети рендерятся поверх перегородок
  (внутренность ребёнка прозрачна — перегородка видна сквозь неё)
- span (0062, уточнено в 0064, пересмотрено в 0065, уточнено в 0066,
  уточнено в 0068):
  span-область ребёнка — объединение **целых ячеек**, которые его
  прямоугольник задевает (0064; не сам прямоугольник: ребёнок,
  задевающий ячейки 1–2, занимает их целиком, включая участки вне его
  рамки). Касание границы асимметрично (0068): левая/верхняя граница,
  упирающаяся в границу ячейки, засчитывается (рамка ребёнка рисуется
  поверх неё, 0066), правая/нижняя — нет (его рамка на клетку короче
  границы, которая остаётся нарисованной). Внутри области перегородка
  гасится **только там, где её реально пересекает ребёнок** (0065),
  причём пересечение **с левой/верхней граничной клеткой включительно**
  (0066): перегородка под самой левой/верхней границей ребёнка
  считается пересечённой (рамка ребёнка рисуется поверх неё).
  Вертикальная — по span-строкам, только если ребёнок её перешагивает;
  горизонтальная — по span-колонкам, только если перешагивает; клетка
  на пересечении — только если перешагивает обе. Т.е. span-ячейка
  сохраняет границы ячеек, которые ребёнок не пересекает. Вычисляется
  в `_draw_grid()`/`drawGrid()`: для каждого ребёнка (абс. half-open,
  кламп к внутренней области, тот же оригин `parent.x+1+c.x`) —
  задеваемые колонки/ряды по `col_x`/`row_y`
  (`col_x[i] < ix1 and col_x[i+1] >= ix0` — half-open прямоугольник
  против замкнутого диапазона ячейки), span-прямоугольник = bounding
  box этих ячеек, `crossed_v`/`crossed_h` = множества перегородок,
  которые прямоугольник пересекает (`rx0 <= p < rx1` / `ry0 <= q < ry1`);
  `covered(px,py)` — клетка в span-области и (верт. перегородка в
  `crossed_v` и не-горизонтальная или в `crossed_h`) или
  (горизонтальная в `crossed_h` и не-верт. или в `crossed_v`);
  подавление в момент отрисовки (fill/пробел под пропущенной клеткой
  не трогаются)
- frame-узлы и junctions (0063): рисуются по реально отрисованным
  сегментам вокруг них — подавленный span-ом сегмент деградирует узел
  (┬ → ─, ├ → │, ┼ → ├/┬/│/─, таблица `_grid_junction()`/`gridJunction()`
  по 4 «рукам», включая углы при частичном span-е), «торчащих» концов
  линий у span-ячейки нет; junction под ребёнком (клетка покрыта) не
  рисуется
- `border_style=none` → без внешней рамки, перегородки — solid
- контейнер (как `box`): `_findDropContainer()` в `editor.js` принимает
  `box` и `grid`; autosize отсутствует (все `normalize*` для grid
  early-return)
- новый блок: 24×8, без контента; панель свойств — секция Grid
  (`cols`/`rows`, number, primary)
- ручки внутренних границ (0067, только редактор): при одиночном
  выделении grid на каждой перегородке — ручка (`.grid-handle--v`/`--h`
  в `editor.html`/`static/editor/index.html`, getter `gridHandles` в
  `editor.js`). Drag сдвигает перегородку (live-превью — сама ручка,
  ASCII перерисовывается на commit: mouseup → `updateBlock` →
  `refreshRender`); commit пишет `meta.col_widths`/`row_heights`.
  Кламп: колонка/строка ≥ 1 клетки. В точке пересечения верхняя —
  горизонтальная ручка (рендерится после вертикальных). Смена
  `cols`/`rows` трансформирует кастомные ширины (`gridReshapeWidths`
  в `core/renderer.js`, только редактор): рост — последняя колонка
  делится пополам (floor/ceil; если последняя 1 — заём у ближайшего
  более широкого левого соседа; все 1 → равномерный), сжатие —
  последние две сливаются; без кастомных ширин — ничего

Дерево: `Block.parent_id → Block.children`, хранится в SQLite.

### Рендерер

`PseudoGraphicRenderer` — преобразует дерево блоков в ASCII-арт на сетке.
- Класс `RenderBlock` — плоское представление для рендера
- `render_simple()` — convenience-метод из raw dicts
- `render()` — рисует на 2D-сетке, обрабатывает вложенность

### Статический режим

Редактор работает без бэкенда: `static/editor/index.html` открывается
напрямую в браузере (даже через `file://`), макет хранится в localStorage.

- `core/store.js` — единый интерфейс хранилища: `FetchStore` (API, web-режим),
  `LocalStorageStore` (static-режим, persist в localStorage, key
  `boxframe.static.layout`, `options.storage` — для тестов) и `MemoryStore`
  (in-memory, fallback); `editor.js` не знает о fetch. `clear()` (очистка
  всего макета) есть только у memory/local-сторов
- `core/renderer.js` — JS-порт `services/renderer.py`: ASCII + HTML-оверлей;
  вывод должен совпадать с Python побайтово (parity-тесты)
- Режим определяется по `data-layout-id` в DOM: есть → `FetchStore`,
  нет → `LocalStorageStore`
- Блоки в JS — плоский список с `parent_id` (x/y детей — относительные,
  как в БД); константы `BLOCK_TYPES`/`BORDER_STYLES` дублируются в
  `core/renderer.js` (держать в синхроне с `models/block.py`)

### API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/` | Список проектов |
| POST | `/api/projects/` | Создать проект |
| GET | `/api/projects/{id}/info` | Метаданные + доступные типы |
| DELETE | `/api/projects/{id}` | Удалить проект |
| POST | `/api/projects/{id}/layouts` | Создать layout |
| GET | `/api/layouts/{id}` | Layout + блоки |
| POST | `/api/layouts/{id}/blocks` | Добавить блок |
| PUT | `/api/layouts/{id}/blocks/{bid}` | Обновить блок |
| DELETE | `/api/layouts/{id}/blocks/{bid}` | Удалить блок |
| DELETE | `/api/layouts/{id}/blocks` | Удалить все блоки (layout остаётся) |
| PUT | `/api/layouts/{id}/blocks` | Полная замена набора блоков (undo/redo; id из payload сохраняются) |
| GET | `/api/layouts/{id}/render` | ASCII + HTML preview |
| GET | `/api/layouts/{id}/export` | JSON / Markdown / ASCII |

### Фронтенд

- **HTMX** — серверные рендеры страниц, без SPA
- **Alpine.js** — реактивность редактора (`x-data="editorApp()"`), подключается локально (`static/js/alpine.min.js`)
- **Редактор** — сайдбар (палитра + список элементов) + canvas-превью; общий для web- и static-режимов
- **Undo/Redo** — `core/history.js`: `withHistory(store)` оборачивает store,
  хранит snapshot-стеки (без лимита) и восстанавливает состояние через
  `replaceState` (local) / batch `PUT /blocks` (web). Снапшот берётся из
  кэша состояния (seed от `load()`, синк от результатов мутаций) — без
  доп. запросов. Coalescing: consecutive-обновления одного блока в окне
  500 мс = одна запись. Хоткеи Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y (не
  перехватываются в текстовых полях)
- Экспорт: скачивание файла (JSON/MD/ASCII)
- **Импорт** — кнопка Import открывает скрытый `input[type=file]`; выбранный
  JSON разбирается `core/import.js` (`parseLayoutJson` — вложенный экспорт
  `type`/`metadata`/`children` → плоский список `block_type`/`meta`/`parent_id`,
  `order` сохраняется или присваивается по порядку документа) и применяется
  через `store.replaceState` (одна запись undo/redo). Если редактор не пуст —
  `confirm`: OK = добавить блоки поверх существующих (`prepareImport` в режиме
  `add`: новые id, order сдвинут выше текущего максимума), Cancel = заменить
  всё содержимое (режим `replace`). Экспорт JSON несёт `order` (добавлен для
  корректного round-trip z-порядка).

## Соглашения

- **Python:** 100 символов строка, type hints, dataclasses для DTO
- **Именование:** snake_case для кода, kebab-case для URL
- **Тесты:** `tests/test_<module>.py`, pytest
- **БД:** асинхронная SQLAlchemy 2.0+, `async_session` через Depends
- **Безопасность:** CSRF не требуется (не авторизован), валидация через Pydantic
- **Обратная совместимость:** Макеты, созданные в предыдущих версиях, должны отображаться в новой версии так же, как раньше. 
  Отход от этого правила должен оговариваться отдельно и согласован с пользователем.   

## Типичные задачи

### Добавить новый тип блока

1. Добавить в `BLOCK_TYPES` в `models/block.py` **и** в `static/js/core/renderer.js`
2. Добавить обработку в `renderer.py` и `core/renderer.js` (если нужна особая отрисовка)
3. Добавить кнопку в палитру `editor.html`
4. Добавить тесты в `tests/test_renderer.py` **и** `tests/js/test_renderer.js`

### Изменить API

1. Добавить роут в `api/layouts.py` или `api/projects.py`
2. Обновить `LayoutService` при необходимости
3. Добавить Pydantic-схему (create/update/out)
4. Протестировать через `httpx` в pytest

### Изменить рендерер

1. Править `services/renderer.py` **и** `static/js/core/renderer.js`
   (порт должен давать идентичный вывод)
2. Убедиться, что `render_simple()` и `render()` согласованы
3. Добавить/обновить тесты в `tests/test_renderer.py` **и** `tests/js/test_renderer.js`
4. Прогнать parity-тесты: `pytest tests/test_js_renderer_parity.py`
5. Проверить, что `LayoutService.render_layout()` использует новый рендер

### Добавить страницу

1. Создать шаблон в `templates/pages/`
2. Добавить route в `main.py`
3. Добавить ссылки в существующие шаблоны

### Релиз (bump минорной версии)

- Команда агента `/bump` (`.qwen/commands/bump.md`) — обёртка над `scripts/bump.sh`
- `bash scripts/bump.sh` — bump минора в `pyproject.toml`, commit
  `chore(release): bump version to X.Y.0`, тег `vX.Y.0`, push ветки и тега
- `bash scripts/bump.sh --dry-run` — предпросмотр без изменений
- Версия живёт только в `pyproject.toml` (`boxframe/__init__.py` читает её
  через `importlib.metadata`)

## Запуск

```bash
pip install -r requirements.txt
uvicorn boxframe.main:app --reload
# http://localhost:8000
```

Тесты:
```bash
pytest tests/ -v                      # unit + API
node --test "tests/js/*.js"           # JS-рендерер (нужен Node.js)
pytest tests/e2e/ -v                  # e2e: нужен запущенный сервер на :8000
```

Внимание: e2e и API-тесты запускать **раздельными командами** (playwright
sync API конфликтует с pytest-asyncio в одном процессе).

## Чего НЕ делать

- Не менять формат псевдографики — это ядро продукта (AI-readable format)
- Не расхожить Python- и JS-рендереры — формат один; править оба + оба
  набора тестов + parity
- Не добавлять авторизацию в MVP
- Не использовать сборщики (Webpack/Vite) — HTMX рендерит на сервере,
  JS-файлы — обычные скрипты (должны работать из `file://`)
- Не менять SQLite на другую БЗ без веской причины (MVP-файловая БД — фича)
