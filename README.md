# boxframe

[English](#english)

**Редактор UI-макетов в псевдографике для ИИ-агентов.**

Рисуйте макеты интерфейсов с помощью ASCII/Unicode box-drawing символов — машиночитаемый, самодокументируемый формат, идеально подходящий для работы с ИИ.

## Возможности

- **Блочное редактирование** — перетаскивайте компоненты из палитры (блоки, кнопки, поля ввода, заголовки и т.д.) на холст или добавляйте кликом
- **Живое превью псевдографики** — рендеринг ASCII-арта в реальном времени с Unicode box-drawing символами
- **Выбор и свойства** — одиночный клик выделяет блок: плавающая панель свойств (позиция, размер, стиль, z-порядок, содержимое), ресайз за угловой маркер, дублирование
- **Размеры макета** — необязательные width/height: рисуются как визуальная линия границ на холсте, блоки можно размещать за её пределами
- **Статический режим** — редактор работает без бэкенда: откройте `boxframe/static/editor/index.html` в браузере (работает даже через `file://`); макет сохраняется в браузере (localStorage)
- **Очистка** — кнопка удаления всех блоков макета (с подтверждением)
- **Экспорт в нескольких форматах** — JSON, Markdown, обычный ASCII + кнопка Copy (raw-ASCII в буфер обмена)
- **Формат, читаемый ИИ** — макеты в виде обычного текста, легко парсятся и анализируются LLM

## Быстрый старт

```bash
# Create virtual environment
python -m venv venv && source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn boxframe.main:app --reload

# Open http://localhost:8000
```

Docker:

```bash
docker build -t boxframe .
docker run -p 8000:8000 boxframe
```

Без сервера — статический редактор: откройте `boxframe/static/editor/index.html` в браузере (работает даже через `file://`). Макет сохраняется в localStorage браузера и переживает перезагрузку страницы. Статический редактор также публикуется на GitHub Pages по пушу в ветку `develop`.

## Структура проекта

```
boxframe/
├── boxframe/
│   ├── api/                  # FastAPI routes
│   │   ├── projects.py       # Project CRUD + metadata
│   │   ├── layouts.py        # Layout/Block CRUD + render + export
│   │   └── test_cleanup.py   # E2E test data cleanup
│   ├── models/               # SQLAlchemy ORM models
│   │   ├── project.py
│   │   ├── layout.py
│   │   └── block.py
│   ├── services/             # Business logic
│   │   ├── layout_service.py # CRUD + rendering + export
│   │   └── renderer.py       # Pseudo-graphic renderer
│   ├── static/               # CSS + JS
│   │   ├── index.html        # GitHub Pages entry (redirect to editor)
│   │   ├── css/style.css     # Dark theme
│   │   ├── css/editor.css    # Стили редактора (web + static)
│   │   ├── editor/index.html # Статический редактор (без бэкенда)
│   │   └── js/
│   │       ├── alpine.min.js # Alpine.js (вендор, без CDN)
│   │       ├── core/renderer.js  # JS-порт рендерера (static-режим)
│   │       ├── core/store.js     # FetchStore / MemoryStore / LocalStorageStore
│   │       └── editor.js         # Alpine.js editor app (общий)
│   ├── templates/            # Jinja2 HTML templates
│   │   └── pages/
│   │       ├── base.html
│   │       ├── projects.html
│   │       ├── project.html
│   │       ├── editor.html
│   │       └── 404.html
│   ├── config.py
│   ├── database.py
│   └── main.py
├── tests/
│   ├── api/                  # API unit-тесты (httpx + TestClient)
│   │   ├── test_projects.py
│   │   └── test_layouts.py
│   ├── e2e/                  # End-to-end тесты (Playwright)
│   │   ├── conftest.py
│   │   ├── test_projects.py
│   │   ├── test_editor.py
│   │   └── test_drag_drop.py
│   ├── js/test_renderer.js       # Тесты JS-рендерера (node:test)
│   ├── conftest.py
│   ├── test_js_renderer_parity.py # Parity Python↔JS рендереры
│   └── test_renderer.py
├── tasks/                    # Спецификации задач (нумерованные + backlog)
├── .github/workflows/static.yml  # Деплой GitHub Pages
├── index.html                # GitHub Pages entry (редирект на static-редактор)
├── Dockerfile
├── pyproject.toml
├── requirements.txt
└── README.md
```

## Архитектура

### Гибридный подход: Дерево блоков ↔ Псевдографика

```
┌──────────────────────────────────┐
│           UI Editor              │
│  ┌────────────┐  ┌────────────┐  │
│  │ Palette    │  │   Canvas   │  │
│  │ (blocks)   │  │ (preview)  │  │
│  └────────────┘  └────────────┘  │
├──────────────────────────────────┤
│  Raw Pseudo-graphic Output       │
└──────────────────────────────────┘
```

- **Блоки** хранятся в SQLite (позиция, размер, тип, содержимое, стиль границы, z-порядок); дерево вложенности через `parent_id`
- **Рендерер** преобразует блоки → ASCII-арт с использованием Unicode box-drawing символов
- **Два рендерера, один формат** — серверный `services/renderer.py` (Python) и клиентский `static/js/core/renderer.js` (JS, статический режим) дают идентичный вывод; синхронизацию держат parity-тесты
- **Холст** — всё доступное пространство: блоки можно размещать где угодно, включая область за границами макета; канвас автоматически расширяется под блоки
- **Размеры макета** (необязательные width/height) рисуются как визуальная линия границ в редакторе — они не ограничивают размещение блоков и не являются частью ASCII-арта

### Типы блоков

`box`, `header`, `footer`, `sidebar`, `content`, `button`, `input`, `textarea`, `image`, `divider`, `hline`, `vline`, `text`, `grid`

### Стили границ

`solid` (─│), `dashed` (┄┆), `dotted` (┈┊), `double` (═║), `none` — применяются и к рамкам блоков, и к линиям (`hline`/`vline` рисуются символом выбранного стиля)

## Эндпоинты API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/` | Список всех проектов |
| POST | `/api/projects/` | Создать проект |
| GET | `/api/projects/{id}` | Получить проект |
| GET | `/api/projects/{id}/info` | Метаданные проекта + доступные типы |
| DELETE | `/api/projects/{id}` | Удалить проект |
| POST | `/api/projects/{id}/layouts` | Создать макет |
| GET | `/api/layouts/{id}` | Получить макет + блоки |
| DELETE | `/api/layouts/{id}` | Удалить макет |
| POST | `/api/layouts/{id}/blocks` | Добавить блок |
| PUT | `/api/layouts/{id}/blocks/{bid}` | Обновить блок |
| DELETE | `/api/layouts/{id}/blocks/{bid}` | Удалить блок |
| DELETE | `/api/layouts/{id}/blocks` | Удалить все блоки макета (clear) |
| GET | `/api/layouts/{id}/render` | Рендер в ASCII + HTML (параметры `char_width_px`, `char_height_px`) |
| GET | `/api/layouts/{id}/export` | Экспорт в JSON/Markdown/ASCII |
| DELETE | `/api/test/cleanup` | Удалить E2E-тестовые данные (test utility) |

## Тестирование

```bash
# Dev-зависимости (pytest, httpx, playwright):
pip install -e ".[dev]"

# Unit + API тесты:
pytest tests/ --ignore=tests/e2e -v

# JS-тесты рендерера (нужен Node.js):
node --test "tests/js/*.js"

# E2E-тесты: нужен запущенный сервер на :8000, запускать отдельной
# командой (playwright sync API конфликтует с pytest-asyncio в одном процессе):
playwright install chromium
uvicorn boxframe.main:app --port 8000   # в отдельном терминале
pytest tests/e2e/ -v
```

## Лицензия

MIT

---

## English

**Pseudo-graphic UI mockup editor for AI agents.**

Draw UI layouts using ASCII/Unicode box-drawing characters — machine-readable, self-documenting, and perfect for AI consumption.

## Features

- **Block-based editing** — drag components from a palette (boxes, buttons, inputs, headers, etc.) onto the canvas, or click to add
- **Live pseudo-graphic preview** — real-time ASCII art rendering with Unicode box-drawing characters
- **Selection & properties** — single-click selects a block: floating properties panel (position, size, style, z-order, content), resize via corner handle, duplicate
- **Layout dimensions** — optional width/height: drawn as a visual bounds line on the canvas; blocks may be placed outside it
- **Static mode** — the editor runs without a backend: open `boxframe/static/editor/index.html` in a browser (works over `file://` too); the layout is saved in the browser (localStorage)
- **Clear** — a button to remove all blocks from a layout (with confirmation)
- **Multi-format export** — JSON, Markdown, plain ASCII + a Copy button (raw ASCII to clipboard)
- **AI-readable format** — layouts are plain text, easy for LLMs to parse and reason about

## Quick Start

```bash
# Create virtual environment
python -m venv venv && source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn boxframe.main:app --reload

# Open http://localhost:8000
```

Docker:

```bash
docker build -t boxframe .
docker run -p 8000:8000 boxframe
```

Without a server — the static editor: open `boxframe/static/editor/index.html` in a browser (works over `file://` too). The layout is persisted in the browser's localStorage and survives page reloads. The static editor is also published to GitHub Pages on push to the `develop` branch.

## Project Structure

```
boxframe/
├── boxframe/
│   ├── api/                  # FastAPI routes
│   │   ├── projects.py       # Project CRUD + metadata
│   │   ├── layouts.py        # Layout/Block CRUD + render + export
│   │   └── test_cleanup.py   # E2E test data cleanup
│   ├── models/               # SQLAlchemy ORM models
│   │   ├── project.py
│   │   ├── layout.py
│   │   └── block.py
│   ├── services/             # Business logic
│   │   ├── layout_service.py # CRUD + rendering + export
│   │   └── renderer.py       # Pseudo-graphic renderer
│   ├── static/               # CSS + JS
│   │   ├── index.html        # GitHub Pages entry (redirect to editor)
│   │   ├── css/style.css     # Dark theme
│   │   ├── css/editor.css    # Editor styles (web + static)
│   │   ├── editor/index.html # Static editor (no backend)
│   │   └── js/
│   │       ├── alpine.min.js # Alpine.js (vendored, no CDN)
│   │       ├── core/renderer.js  # JS port of the renderer (static mode)
│   │       ├── core/store.js     # FetchStore / MemoryStore / LocalStorageStore
│   │       └── editor.js         # Alpine.js editor app (shared)
│   ├── templates/            # Jinja2 HTML templates
│   │   └── pages/
│   │       ├── base.html
│   │       ├── projects.html
│   │       ├── project.html
│   │       ├── editor.html
│   │       └── 404.html
│   ├── config.py
│   ├── database.py
│   └── main.py
├── tests/
│   ├── api/                  # API unit tests (httpx + TestClient)
│   │   ├── test_projects.py
│   │   └── test_layouts.py
│   ├── e2e/                  # End-to-end tests (Playwright)
│   │   ├── conftest.py
│   │   ├── test_projects.py
│   │   ├── test_editor.py
│   │   └── test_drag_drop.py
│   ├── js/test_renderer.js       # JS renderer tests (node:test)
│   ├── conftest.py
│   ├── test_js_renderer_parity.py # Python↔JS renderer parity
│   └── test_renderer.py
├── tasks/                    # Task specs (numbered + backlog)
├── .github/workflows/static.yml  # GitHub Pages deploy
├── index.html                # GitHub Pages entry (redirect to static editor)
├── Dockerfile
├── pyproject.toml
├── requirements.txt
└── README.md
```

## Architecture

### Hybrid: Block Tree ↔ Pseudo-Graphic

```
┌──────────────────────────────────┐
│           UI Editor              │
│  ┌────────────┐  ┌────────────┐  │
│  │ Palette    │  │   Canvas   │  │
│  │ (blocks)   │  │ (preview)  │  │
│  └────────────┘  └────────────┘  │
├──────────────────────────────────┤
│  Raw Pseudo-graphic Output       │
└──────────────────────────────────┘
```

- **Blocks** are stored in SQLite (position, size, type, content, border style, z-order); nesting tree via `parent_id`
- **Renderer** converts blocks → ASCII art using Unicode box-drawing characters
- **Two renderers, one format** — the server-side `services/renderer.py` (Python) and the client-side `static/js/core/renderer.js` (JS, static mode) produce identical output; parity tests keep them in sync
- **Canvas** — the full available space: blocks can be placed anywhere, including outside the layout bounds; the canvas grows to fit the blocks
- **Layout dimensions** (optional width/height) are drawn as a visual bounds line in the editor — they do not constrain block placement and are not part of the ASCII art

### Block Types

`box`, `header`, `footer`, `sidebar`, `content`, `button`, `input`, `textarea`, `image`, `divider`, `hline`, `vline`, `text`, `grid`

### Border Styles

`solid` (─│), `dashed` (┄┆), `dotted` (┈┊), `double` (═║), `none` — applied to block borders and to lines (`hline`/`vline` are drawn with the character of the chosen style)

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/` | List all projects |
| POST | `/api/projects/` | Create project |
| GET | `/api/projects/{id}` | Get project |
| GET | `/api/projects/{id}/info` | Project metadata + available types |
| DELETE | `/api/projects/{id}` | Delete project |
| POST | `/api/projects/{id}/layouts` | Create layout |
| GET | `/api/layouts/{id}` | Get layout + blocks |
| DELETE | `/api/layouts/{id}` | Delete layout |
| POST | `/api/layouts/{id}/blocks` | Add block |
| PUT | `/api/layouts/{id}/blocks/{bid}` | Update block |
| DELETE | `/api/layouts/{id}/blocks/{bid}` | Delete block |
| DELETE | `/api/layouts/{id}/blocks` | Remove all blocks from a layout (clear) |
| GET | `/api/layouts/{id}/render` | Render to ASCII + HTML (`char_width_px`, `char_height_px` params) |
| GET | `/api/layouts/{id}/export` | Export as JSON/Markdown/ASCII |
| DELETE | `/api/test/cleanup` | Delete E2E test data (test utility) |

## Testing

```bash
# Dev dependencies (pytest, httpx, playwright):
pip install -e ".[dev]"

# Unit + API tests:
pytest tests/ --ignore=tests/e2e -v

# JS renderer tests (requires Node.js):
node --test "tests/js/*.js"

# E2E tests: require a running server on :8000, run as a separate
# command (playwright sync API conflicts with pytest-asyncio in one process):
playwright install chromium
uvicorn boxframe.main:app --port 8000   # in a separate terminal
pytest tests/e2e/ -v
```

## License

MIT
