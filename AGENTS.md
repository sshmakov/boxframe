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
│   │       ├── core/store.js   # FetchStore / MemoryStore
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
│   ├── conftest.py             # API-файстуры (async engine + TestClient)
│   ├── test_js_renderer_parity.py # Parity Python↔JS рендереры
│   └── test_renderer.py        # Тесты рендерера (ASCII + HTML-оверлей)
├── Dockerfile
├── pyproject.toml
├── requirements.txt
└── README.md
```

## Ключевые концепции

### Блоки

Типы: `box`, `header`, `footer`, `sidebar`, `content`, `button`, `input`, `textarea`, `image`, `divider`, `hline`, `vline`, `text`, `grid`

Стили границ: `solid` (─│), `dashed` (┄┆), `dotted` (┈┊), `double` (═║), `none` — применяются и к рамкам блоков, и к линиям (`hline`/`vline` рисуются символом выбранного стиля)

Дерево: `Block.parent_id → Block.children`, хранится в SQLite.

### Рендерер

`PseudoGraphicRenderer` — преобразует дерево блоков в ASCII-арт на сетке.
- Класс `RenderBlock` — плоское представление для рендера
- `render_simple()` — convenience-метод из raw dicts
- `render()` — рисует на 2D-сетке, обрабатывает вложенность

### Статический режим

Редактор работает без бэкенда: `static/editor/index.html` открывается
напрямую в браузере (даже через `file://`), данные живут в памяти.

- `core/store.js` — единый интерфейс хранилища: `FetchStore` (API, web-режим)
  и `MemoryStore` (in-memory, static-режим); `editor.js` не знает о fetch
- `core/renderer.js` — JS-порт `services/renderer.py`: ASCII + HTML-оверлей;
  вывод должен совпадать с Python побайтово (parity-тесты)
- Режим определяется по `data-layout-id` в DOM: есть → `FetchStore`,
  нет → `MemoryStore`
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
| GET | `/api/layouts/{id}/render` | ASCII + HTML preview |
| GET | `/api/layouts/{id}/export` | JSON / Markdown / ASCII |

### Фронтенд

- **HTMX** — серверные рендеры страниц, без SPA
- **Alpine.js** — реактивность редактора (`x-data="editorApp()"`), подключается локально (`static/js/alpine.min.js`)
- **Редактор** — сайдбар (палитра + список элементов) + canvas-превью; общий для web- и static-режимов
- Экспорт: скачивание файла (JSON/MD/ASCII)

## Соглашения

- **Python:** 100 символов строка, type hints, dataclasses для DTO
- **Именование:** snake_case для кода, kebab-case для URL
- **Тесты:** `tests/test_<module>.py`, pytest
- **БД:** асинхронная SQLAlchemy 2.0+, `async_session` через Depends
- **Безопасность:** CSRF не требуется (не авторизован), валидация через Pydantic

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

Docker:
```bash
docker build -t boxframe .
docker run -p 8000:8000 boxframe
```

## Чего НЕ делать

- Не менять формат псевдографики — это ядро продукта (AI-readable format)
- Не расхожить Python- и JS-рендереры — формат один; править оба + оба
  набора тестов + parity
- Не добавлять авторизацию в MVP
- Не использовать сборщики (Webpack/Vite) — HTMX рендерит на сервере,
  JS-файлы — обычные скрипты (должны работать из `file://`)
- Не менять SQLite на другую БЗ без веской причины (MVP-файловая БД — фича)
