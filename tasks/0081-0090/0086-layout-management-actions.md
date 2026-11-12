# Суть проблемы

На странице проекта отсутствовало управление макетами: невозможно было
переименовать макет, создать его копию или переместить в другой проект.
Единственные доступные операции — создание и удаление.

# Задача

Добавить в UI и API три операции над макетами:
1. Переименование (rename)
2. Дублирование с новым именем (duplicate, полная копия блоков с иерархией)
3. Перемещение одного или нескольких выбранных макетов в другой проект

# План работ

- [x] Сервисные методы: `rename_layout`, `duplicate_layout`, `move_layouts`
- [x] API-эндпоинты: `PUT /api/layouts/{id}`, `POST /api/layouts/{id}/duplicate`, `POST /api/layouts/move`
- [x] UI на странице проекта: кнопки, inline-rename, чекбоксы для мультиселекта, панель перемещения
- [x] Тесты API

# Исследование

Изучена текущая структура: Layout имеет `project_id` FK, блоки хранятся
плоско с `parent_id`. Для дублирования требуется восстановить иерархию
при копировании (маппинг old_id → new_id). Выявлена проблема с
`MissingGreenlet` при возврате ORM-объекта после `expire_all()` —
исправлено переписыванием финального запроса через `selectinload`.

# Выполнение задачи

**Сервис** (`boxframe/services/layout_service.py`):
- `rename_layout(layout_id, name)` — simple setattr + commit
- `duplicate_layout(layout_id, new_name)` — SELECT Layout (без normalize),
  SELECT blocks явно, flush нового Layout, цикл по блокам (parents first)
  с id_map, commit, финальный `select(Layout).options(selectinload(blocks))`
- `move_layouts(layout_ids, target_project_id)` — SELECT layouts по списку id,
  setattr project_id, commit; валидирует существование target

**API** (`boxframe/api/layouts.py`):
- `PUT /api/layouts/{layout_id}` — схема `LayoutUpdate`, 400 если name пустой
- `POST /api/layouts/{layout_id}/duplicate` — схема `LayoutDuplicate`
- `POST /api/layouts/move` — схема `LayoutsMove` (layout_ids + target_project_id)

**UI** (`boxframe/templates/pages/project.html`):
- Alpine-компонент `layoutsManager(projectId)`
- `<template x-if>` взаимоисключающие: ссылка и inline-form rename
- Чекбоксы + toolbar с "Move to project…" + select целевого проекта
- Кнопки ✎ (rename), ⧉ (duplicate), ✕ (delete) в `.layout-actions`
- `data-layout-name` на карточке для безопасной передачи имени в JS

**CSS** (`boxframe/static/css/style.css`):
- `.layout-card`, `.layout-checkbox`, `.layout-info`, `.layout-actions`
- `.toolbar`, `.btn-ghost`

**Тесты** (`tests/api/test_layouts.py`): 8 новых тестов — rename (ok, 404,
400), duplicate (ok с проверкой иерархии, 404), move (ok, target 404,
блоки сохраняются). Все 426 тестов проходят.

# Замечания

1. **Async SQLAlchemy + Pydantic serialization:** при возврате ORM-объекта
   из async-роута после `commit()` + `expire_all()` — Pydantic-сериализация
   триггерит lazy-load вне greenlet → `MissingGreenlet`. Решение: не
   использовать `expire_all()` + `get_layout()` с `_normalize_block_orders`
   (модифицирует объекты), а делать чистый `select(...)` с `selectinload`.
   Паттерн `replace_blocks` работает потому что блоки там имеют уникальные
   order и normalize не срабатывает.

2. **Alpine x-if и HTML-structure:** элементы управления (rename input)
   нельзя класть внутрь `<a>` — клик по input вызывает навигацию.
   Взаимоисключающие `<template x-if>` — безопасный паттерн.

3. **Безопасность имени в data-атрибуте:** Jinja2 autoescape корректно
   экранирует `"` и `'` внутри `data-layout-name="..."` — `.dataset.layoutName`
   возвращает декодированную строку.
