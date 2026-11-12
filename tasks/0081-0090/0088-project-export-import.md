# Суть проблемы

Экспорт/импорт существовали только на уровне отдельного макета (внутри
редактора): `GET /api/layouts/{id}/export` и клиентский импорт через
`parseLayoutJson` → `replaceState`. Перенос целого проекта (со всеми
макетами и их блоками) между инсталляциями был невозможен — приходилось
воспроизводить структуру вручную, макет за макетом.

# Задача

Реализовать экспорт и импорт **проекта целиком** в самодокументируемый
JSON-файл (AI-readable, без бинарных форматов вроде zip):
1. Экспорт проекта → скачивание JSON со всеми layout'ами и деревом блоков.
2. Импорт из такого файла → создание нового проекта.

Принятые развилки (согласованы с пользователем):
- Объём: **один проект** за раз (не workspace-бэкап, не слияние в
  существующий проект).
- Id при импорте: **всегда новые** (uuid), id из файла игнорируются —
  импорт не может столкнуться с существующими данными.

# План работ

- [x] Контракт формата: `kind` + `format_version` + `name` + `layouts[]`
- [x] Сервис: `export_project`, `import_project` (+ рекурсивный `_import_blocks`)
- [x] Рефакторинг: общий `_layout_to_json` для `export_json` и `export_project`
- [x] API: `GET /api/projects/{id}/export`, `POST /api/projects/import`
- [x] UI: кнопка Import + file-input на списке проектов, ссылки Export на
  карточке проекта и в шапке страницы проекта
- [x] Тесты API (экспорт, импорт, round-trip, валидация `kind`)
- [x] Обновить API-таблицу в AGENTS.md

# Исследование

Существующий экспорт макета (`LayoutService.export_json`) отдаёт вложенное
дерево блоков (`type`/`metadata`/`children`). Импорт макета живёт только на
клиенте (редактор) — серверного «импорта макета» нет; он идёт через
block CRUD / `replaceState`. Для проекта единого редактор-канваса нет,
поэтому серверный эндпоинт надёжнее клиентского «N запросов».

Ключевой переиспользуемый механизм — `duplicate_project` (0087): deep copy
проект → layout'ы → блоки с `id_map` и `_order_blocks_parents_first`
(родители раньше детей). Экспорт/импорт проекта — это по сути
`duplicate_project` из JSON-строки вместо БД.

Вывод: импорт проекта проще `duplicate_project`, т.к. JSON — уже вложенное
дерево, и рекурсивный обход естественным образом создаёт родителя раньше
детей — двухпроходный `id_map`-машинерий не нужен.

# Выполнение задачи

**Формат файла** — JSON с маркерами:
```json
{
  "kind": "boxframe.project",
  "format_version": 1,
  "name": "Проект",
  "layouts": [ /* layout в точности как standalone export_json */ ]
}
```
`kind` позволяет импортеру отклонить чужой JSON (например, файл одного
макета); `format_version` — эволюционировать формат, не ломая старые файлы.
Вложенные `blocks` — байт-в-байт как у одиночного экспорта макета, чтобы
round-trip был совместим.

**Сервис** (`boxframe/services/layout_service.py`):
- Константы `PROJECT_KIND`, `PROJECT_FORMAT_VERSION`; хелперы `_int`/`_opt_int`
  (терпимое разведение чисел/отсутствующих bounds).
- `_layout_to_json(layout)` — статик-сериализатор дерева блоков; `export_json`
  теперь переиспользует его (единый источник формы → round-trip совместимость).
- `export_project(id)` — SELECT проекта с `selectinload(layouts).selectinload(blocks)`,
  `{kind, format_version, name, layouts:[_layout_to_json …]}`; None если нет.
- `import_project(data)` — проверяет `kind` (иначе `ValueError`); новый
  `Project` + flush; по каждому layout — `Layout` + flush; `_import_blocks`.
- `_import_blocks(layout_id, blocks, parent_id)` — рекурсия по дереву: создаёт
  блок со свежим uuid, детей с `parent_id=block.id`. Faithful copy: геометрия,
  контент, рамка, `meta` (`metadata`/`meta`), `order` — как есть, без autosize.

**API** (`boxframe/api/projects.py`):
- `GET /api/projects/{project_id}/export` → `JSONResponse` с заголовком
  `Content-Disposition: attachment; filename="<safe>.json"` (имя через
  `_safe_filename`), 404 если проект не найден.
- `POST /api/projects/import` (тело = dict) → `ProjectOut`; `ValueError` → 400.

**UI**:
- `projects.html`: Alpine `projectsPage()` — скрытый `<input type=file>` +
  кнопка **Import** (`onImportFile`: read → `POST /import` → редирект на
  новый проект); ссылка **⬇** (export) в `.project-actions` карточки.
- `project.html`: ссылка **⬇ Export** в шапке.

**Доки**: API-таблица AGENTS.md — две новые строки (export/import).

**Тесты** (`tests/api/test_projects.py`): 6 новых — export (kind/name/layouts/
вложенность/`Content-Disposition`), export 404, import (свежие id, иерархия,
сохранение геометрии/`meta`/`order`/рамки), export→import→export идентичен
(кроме id), 400 на неверный и отсутствующий `kind`.

# Замечания

1. **Faithful copy ≠ нормализация.** Импорт не вызывает autosize/`normalize`
   и не валидирует `block_type`/`border_style` по спискам (как `create_block`),
   а хранит данные как есть — ровно как `duplicate_project`. Импортированный
   макет рендерится идентично источнику (правило обратной совместимости).
2. **Свежие id решают коллизии.** Id из файла (внутренние uuid БД) при импорте
   отбрасываются; сущности получают новые uuid. Отдельный «merge в существующий
   проект» вынесен из scope (вариант B) — при нём коллизии пришлось бы
   разбирать явно.
3. **`Content-Disposition` вместо клиентского blob.** Экспорт макета в редакторе
   собирает Blob на клиенте (`store.export()`). Для проекта проще отдать
   готовый файл с заголовком — ссылка `<a download>` работает без JS.
4. **Гонка маршрутов.** `POST /api/projects/import` — один статический сегмент,
   не конфликтует с `POST /{project_id}/…`; `GET /{project_id}/export` — с
   `GET /{project_id}`. Проверено тестами.
5. **Будущие расширения:** workspace-бэкап (все проекты одним файлом,
   ветвление по `kind`) и импорт layout'ов в существующий проект — надстройки
   над текущим контрактом, менять формат не потребуется.
