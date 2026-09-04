# Суть проблемы

При запуске сервера возникала цепочка ошибок, препятствовавших работе приложения:

1. `NameError: name 'async_generator' is not defined` — отсутствовал импорт в `database.py`
2. `InvalidRequestError: Attribute name 'metadata' is reserved` — поле `metadata` зарезервировано в SQLAlchemy Declarative API
3. `NameError: name 'LayoutOut' is not defined` — отсутствовала Pydantic-схема для вывода Layout
4. `ResponseValidationError: Input should be a valid string` — поля `created_at`/`updated_at` имели тип `str` в схемах, но `datetime` в БД (Pydantic v2)
5. `TypeError: 'datetime.datetime' object is not subscriptable` — шаблон резал дату как строку `[:19]`
6. `Method Not Allowed` при удалении проекта — HTML-формы не поддерживают `DELETE`, только GET/POST
7. `TemplateNotFound: 404.html` — отсутствовал шаблон 404

# Задача

1. Устранить все ошибки, препятствующие запуску и работе приложения
2. Реализовать инфраструктуру автоматического тестирования (API + E2E)

# План работ

- [x] Исправить `database.py` — добавить импорты, убрать `@asynccontextmanager`
- [x] Переименовать `metadata` → `meta` в модели и всех ссылках
- [x] Добавить `LayoutOut` схему в `api/layouts.py`
- [x] Переименовать `json` → `layout_json` в `ExportOut` (конфликт с `BaseModel.json()`)
- [x] Исправить типы дат в Pydantic-схемах (`str` → `datetime`)
- [x] Исправить шаблон `projects.html` — `strftime` вместо среза
- [x] Исправить удаление проекта — HTMX `hx-delete` вместо `<form method="POST">`
- [x] Создать шаблон `404.html` и исправить путь в `main.py`
- [x] Реализовать тестовую инфраструктуру: `conftest.py`, API-тесты, E2E-тесты
- [x] Обновить `pyproject.toml` с зависимостями для тестов

# Исследование

- **FastAPI Depends + async generator**: `@asynccontextmanager` превращает асинхронный генератор в контекстный менеджер, что ломает `Depends`. FastAPI ожидает чистый async generator.
- **SQLAlchemy Declarative**: имя `metadata` зарезервировано для `Base.metadata`. Нужно использовать другое имя.
- **Pydantic v2**: поля `datetime` автоматически сериализуются в ISO-формат. Не нужно хранить как `str`.
- **Pydantic v2**: поле `json` конфликтует с методом `BaseModel.json()`.
- **HTML-формы**: поддерживают только `GET` и `POST`. Для `DELETE` нужен HTMX или JavaScript.
- **Playwright**: лучший выбор для HTMX-приложений — реальный браузер, видит DOM после HTMX-запросов.

# Выполнение задачи

## Исправления запуска (5 коммитов)

1. **`database.py`** — добавлены `AsyncGenerator` из `collections.abc`, убран `@asynccontextmanager`
2. **`models/block.py`** — `metadata` → `meta`, обновлены все ссылки в `api/layouts.py`, `api/projects.py`, `services/layout_service.py`
3. **`api/layouts.py`** — добавлена `LayoutOut` схема, `metadata` → `meta`, `json` → `layout_json`
4. **`api/projects.py`** — `metadata` → `meta`, типы дат `str` → `datetime`
5. **`templates/pages/projects.html`** — `updated_at[:19]` → `updated_at.strftime('%Y-%m-%d %H:%M')`
6. **`templates/pages/projects.html`** — `<form method="POST">` → HTMX `hx-delete`
7. **`templates/pages/404.html`** — создан шаблон, исправлен путь в `main.py`

## Тестовая инфраструктура

- **`tests/conftest.py`** — фикстура `client` с чистой SQLite на каждый тест, async-фикстуры
- **`tests/api/test_projects.py`** — 8 тестов: создание, список, получение, удаление, валидация, info
- **`tests/api/test_layouts.py`** — 13 тестов: CRUD layouts/blocks, render, export, каскадное удаление
- **`tests/e2e/test_projects.py`** — 3 Playwright-теста: загрузка страницы, кнопка, удаление
- **`tests/e2e/test_editor.py`** — 3 Playwright-теста: editor, 404, структура страницы
- **`pyproject.toml`** — добавлены `pytest-asyncio`, `pytest-cov`, `playwright`

## Результаты тестирования

```
33 passed, 3 failed
```

3 провала — **предыдущие баги рендерера** (не связаны с изменениями):
- `test_border_styles` — assertion mismatch для double border
- `test_multiple_blocks` — assertion mismatch
- `test_grid_clamping` — IndexError при рендере блока за пределами сетки

# Замечания

1. **Рендерер**: 3 существующих теста рендерера падают — это баги рендерера, не связанные с текущими изменениями. Нужно исправить отдельно.
2. **E2E-тесты**: требуют запущенный сервер. Рекомендуется добавить CI-конфиг, который поднимает сервер перед E2E.
3. **Фикстура `client`**: использует `asyncio.get_event_loop().run_until_complete()` — deprecated в Python 3.12. Нужно мигрировать на `asyncio.run()`.
4. **Миграции**: `create_all` создаёт таблицы при каждом запуске. Для продакшена нужен Alembic.
5. **Тесты E2E**: используют реальный сервер — хрупкие, медленные. API-тесты (`TestClient`) предпочтительнее для CI.
