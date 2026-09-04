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
│   │   └── js/editor.js        # Alpine.js editor app
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
│   │   ├── test_editor.py      # Загрузка страниц editor/project/index
│   │   └── test_projects.py    # New Project / New Layout кнопки + форма
│   ├── conftest.py             # API-файстуры (async engine + TestClient)
│   └── test_renderer.py        # 10 тестов рендерера
├── Dockerfile
├── pyproject.toml
├── requirements.txt
└── README.md
```

## Ключевые концепции

### Блоки

Типы: `box`, `header`, `footer`, `sidebar`, `content`, `button`, `input`, `textarea`, `image`, `divider`, `text`, `grid`

Стили границ: `solid` (─│), `dashed` (┄┆), `dotted` (┈┊), `double` (═║), `none`

Дерево: `Block.parent_id → Block.children`, хранится в SQLite.

### Рендерер

`PseudoGraphicRenderer` — преобразует дерево блоков в ASCII-арт на сетке.
- Класс `RenderBlock` — плоское представление для рендера
- `render_simple()` — convenience-метод из raw dicts
- `render()` — рисует на 2D-сетке, обрабатывает вложенность

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
- **Alpine.js** — реактивность редактора (`x-data="editorApp()"`)
- **Редактор** — 3 колонки: палитра компонентов → canvas-превью → raw-текст
- Экспорт: скачивание файла (JSON/MD/ASCII)

## Соглашения

- **Python:** 100 символов строка, type hints, dataclasses для DTO
- **Именование:** snake_case для кода, kebab-case для URL
- **Тесты:** `tests/test_<module>.py`, pytest
- **БД:** асинхронная SQLAlchemy 2.0+, `async_session` через Depends
- **Безопасность:** CSRF не требуется (не авторизован), валидация через Pydantic

## Типичные задачи

### Добавить новый тип блока

1. Добавить в `BLOCK_TYPES` в `models/block.py`
2. Добавить обработку в `renderer.py` (если нужна особая отрисовка)
3. Добавить кнопку в палитру `editor.html`
4. Добавить тест в `tests/test_renderer.py`

### Изменить API

1. Добавить роут в `api/layouts.py` или `api/projects.py`
2. Обновить `LayoutService` при необходимости
3. Добавить Pydantic-схему (create/update/out)
4. Протестировать через `httpx` в pytest

### Изменить рендерер

1. Править `services/renderer.py`
2. Убедиться, что `render_simple()` и `render()` согласованы
3. Добавить/обновить тесты в `tests/test_renderer.py`
4. Проверить, что `LayoutService.render_layout()` использует новый рендер

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
pytest tests/ -v
```

Docker:
```bash
docker build -t boxframe .
docker run -p 8000:8000 boxframe
```

## Чего НЕ делать

- Не менять формат псевдографики — это ядро продукта (AI-readable format)
- Не добавлять авторизацию в MVP
- Не использовать сборщики (Webpack/Vite) — HTMX рендерит на сервере
- Не менять SQLite на другую БЗ без веской причины (MVP-файловая БД — фича)
