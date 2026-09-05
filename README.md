# boxframe

[English](#english)

**Редактор UI-макетов в псевдографике для ИИ-агентов.**

Рисуйте макеты интерфейсов с помощью ASCII/Unicode box-drawing символов — машиночитаемый, самодокументируемый формат, идеально подходящий для работы с ИИ.

## Возможности

- **Блочное редактирование** — перетаскивайте компоненты из палитры (блоки, кнопки, поля ввода, заголовки и т.д.)
- **Живое превью псевдографики** — рендеринг ASCII-арта в реальном времени с Unicode box-drawing символами
- (пока нет) **Редактирование raw-текста** — прямое редактирование псевдографического вывода
- **Экспорт в нескольких форматах** — JSON, Markdown, обычный ASCII
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

## Структура проекта

```
boxframe/
├── boxframe/
│   ├── api/                  # FastAPI routes
│   │   ├── projects.py       # Project CRUD + metadata
│   │   └── layouts.py        # Layout/Block CRUD + render + export
│   ├── models/               # SQLAlchemy ORM models
│   │   ├── project.py
│   │   ├── layout.py
│   │   └── block.py
│   ├── services/             # Business logic
│   │   ├── layout_service.py # CRUD + rendering + export
│   │   └── renderer.py       # Pseudo-graphic renderer
│   ├── static/               # CSS + JS
│   │   ├── css/style.css
│   │   └── js/editor.js
│   ├── templates/            # Jinja2 HTML templates
│   │   ├── pages/
│   │   │   ├── base.html
│   │   │   ├── projects.html
│   │   │   ├── project.html
│   │   │   └── editor.html
│   ├── config.py
│   ├── database.py
│   └── main.py
├── tests/
│   └── test_renderer.py
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
│  (editable text)                 │
└──────────────────────────────────┘
```

- **Блоки** хранятся в SQLite (позиция, размер, тип, содержимое, стиль)
- **Рендерер** преобразует блоки → ASCII-арт с использованием Unicode box-drawing символов
- **Двусторонняя синхронизация**: добавление блоков из палитры → обновление превью; редактирование raw-текста → синхронизация обратно в блоки

### Типы блоков

`box`, `header`, `footer`, `sidebar`, `content`, `button`, `input`, `textarea`, `image`, `divider`, `text`, `grid`

### Стили границ

`solid` (─│), `dashed` (┄┆), `dotted` (┈┊), `double` (═║), `none`

## Эндпоинты API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/` | Список всех проектов |
| POST | `/api/projects/` | Создать проект |
| GET | `/api/projects/{id}/info` | Метаданные проекта + доступные типы |
| DELETE | `/api/projects/{id}` | Удалить проект |
| POST | `/api/projects/{id}/layouts` | Создать макет |
| GET | `/api/layouts/{id}` | Получить макет + блоки |
| POST | `/api/layouts/{id}/blocks` | Добавить блок |
| PUT | `/api/layouts/{id}/blocks/{bid}` | Обновить блок |
| DELETE | `/api/layouts/{id}/blocks/{bid}` | Удалить блок |
| GET | `/api/layouts/{id}/render` | Рендер в ASCII + HTML |
| GET | `/api/layouts/{id}/export` | Экспорт в JSON/Markdown/ASCII |

## Тестирование

```bash
pip install pytest
pytest tests/
```

## Лицензия

MIT

---

## English

**Pseudo-graphic UI mockup editor for AI agents.**

Draw UI layouts using ASCII/Unicode box-drawing characters — machine-readable, self-documenting, and perfect for AI consumption.

## Features

- **Block-based editing** — drag components from a palette (boxes, buttons, inputs, headers, etc.)
- **Live pseudo-graphic preview** — real-time ASCII art rendering with Unicode box-drawing characters
- (no yet) **Raw text editing** — directly edit the pseudo-graphic output
- **Multi-format export** — JSON, Markdown, plain ASCII
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

## Project Structure

```
boxframe/
├── boxframe/
│   ├── api/                  # FastAPI routes
│   │   ├── projects.py       # Project CRUD + metadata
│   │   └── layouts.py        # Layout/Block CRUD + render + export
│   ├── models/               # SQLAlchemy ORM models
│   │   ├── project.py
│   │   ├── layout.py
│   │   └── block.py
│   ├── services/             # Business logic
│   │   ├── layout_service.py # CRUD + rendering + export
│   │   └── renderer.py       # Pseudo-graphic renderer
│   ├── static/               # CSS + JS
│   │   ├── css/style.css
│   │   └── js/editor.js
│   ├── templates/            # Jinja2 HTML templates
│   │   ├── pages/
│   │   │   ├── base.html
│   │   │   ├── projects.html
│   │   │   ├── project.html
│   │   │   └── editor.html
│   ├── config.py
│   ├── database.py
│   └── main.py
├── tests/
│   └── test_renderer.py
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
│  (editable text)                 │
└──────────────────────────────────┘
```

- **Blocks** are stored as JSON in SQLite (position, size, type, content, style)
- **Renderer** converts blocks → ASCII art using Unicode box-drawing characters
- **Two-way sync**: add blocks from palette → updates preview; edit raw text → sync back to blocks

### Block Types

`box`, `header`, `footer`, `sidebar`, `content`, `button`, `input`, `textarea`, `image`, `divider`, `text`, `grid`

### Border Styles

`solid` (─│), `dashed` (┄┆), `dotted` (┈┊), `double` (═║), `none`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/projects/` | List all projects |
| POST | `/api/projects/` | Create project |
| GET | `/api/projects/{id}/info` | Project metadata + available types |
| DELETE | `/api/projects/{id}` | Delete project |
| POST | `/api/projects/{id}/layouts` | Create layout |
| GET | `/api/layouts/{id}` | Get layout + blocks |
| POST | `/api/layouts/{id}/blocks` | Add block |
| PUT | `/api/layouts/{id}/blocks/{bid}` | Update block |
| DELETE | `/api/layouts/{id}/blocks/{bid}` | Delete block |
| GET | `/api/layouts/{id}/render` | Render to ASCII + HTML |
| GET | `/api/layouts/{id}/export` | Export as JSON/Markdown/ASCII |

## Testing

```bash
pip install pytest
pytest tests/
```

## License

MIT
