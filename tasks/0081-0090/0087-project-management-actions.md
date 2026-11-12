# Суть проблемы

На странице списка проектов были доступны только создание и удаление
проекта. Невозможно было переименовать проект или создать его копию
(например, как шаблон для новых макетов).

# Задача

Добавить в UI и API две операции над проектами:
1. Переименование (rename)
2. Дублирование с новым именем (duplicate) — полная копия проекта со
   всеми макетами и их блоками (с восстановлением иерархии)

# План работ

- [x] Сервисные методы: `rename_project`, `duplicate_project`
- [x] API-эндпоинты: `PUT /api/projects/{id}`, `POST /api/projects/{id}/duplicate`
- [x] UI на странице проектов: inline-rename, кнопка duplicate
- [x] Тесты API

# Исследование

Проект связан с макетами через `Layout.project_id` (FK, каскад
`all, delete-orphan`), макеты — с блоками через `Block.layout_id`, блоки
вложены через `Block.parent_id`. Для дублирования проекта нужен
трёхуровневый deep copy: проект → макеты → блоки, с двумя уровнями
перемаппинга id (layout id и block id) и восстановлением дерева блоков.

Выявлено: существующий `duplicate_layout` сортирует блоки «родители
раньше детей» двухуровневым ключом (`0`/`1`), что корректно только для
вложенности глубиной ≤ 2. Для `duplicate_project` написан depth-safe
хелпер `_order_blocks_parents_first` (итеративное разрешение родителей),
корректный для произвольной вложенности; `duplicate_layout` не тронут
(вне scope, обратная совместимость).

# Выполнение задачи

**Сервис** (`boxframe/services/layout_service.py`):
- `rename_project(project_id, name)` — `db.get` + setattr + commit + refresh
- `duplicate_project(project_id, new_name)` — `get_project` (eager layouts),
  новый `Project` + flush; по каждому исходному layout — новый `Layout` +
  flush; SELECT блоков layout'а, обход через `_order_blocks_parents_first`
  с `id_map` (родители раньше детей), commit, финальный `refresh(project)`
- `_order_blocks_parents_first(blocks)` — статик хелпер: итеративно кладёт
  блок, когда его родитель уже размещён (или отсутствует/корень); цикл в
  данных → дописывает остаток как есть

**API** (`boxframe/api/projects.py`):
- `PUT /api/projects/{project_id}` — схема `ProjectUpdate`, 400 если name пустой,
  404 если проект не найден
- `POST /api/projects/{project_id}/duplicate` — схема `ProjectDuplicate`
  (name 1..255), 404 если проект не найден

**UI** (`boxframe/templates/pages/projects.html`):
- Alpine-компонент `projectsPage()` (заменил inline `x-data`)
- Карточка проекта: `<template x-if>` взаимоисключающие ссылка/inline-rename
- Кнопки ✎ (rename), ⧉ (duplicate, через `prompt`), ✕ (delete) в `.project-actions`
- `data-project-name` на карточке для безопасной передачи имени в JS

**CSS** (`boxframe/static/css/style.css`):
- `.project-card`, `.project-info`, `.project-actions` (по образцу layout-card)

**Тесты** (`tests/api/test_projects.py`): 6 новых тестов — rename (ok, 404,
400), duplicate (ok с проверкой deep-copy layout'ов и иерархии блоков +
нетронутость источника, 404, 422 пустое имя).

# Замечания

1. **Deep copy и async SQLAlchemy:** после `commit()` + `refresh(new_project)`
   скалярные атрибуты (`created_at`/`updated_at` из `server_default`)
   загружены; `ProjectOut` не включает `layouts`, поэтому lazy-load
   связей при сериализации не триггерится — нет `MissingGreenlet`.
2. **Depth-safe обход блоков:** `duplicate_layout` (0086) использует
   двухуровневую сортировку; для deep copy проекта это неприемлемо
   (вложенность произвольна), поэтому введён отдельный хелпер.
3. **Дубликат ≠ перемещение:** `duplicate_project` не трогает исходный
   проект; копирование id исключено (все сущности получают новые uuid).
