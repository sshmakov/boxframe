# Суть проблемы

Экспорт макета в JSON строил дерево фиксированной глубины — корневые блоки
плюс их прямые дети:

- `LayoutService.export_json` (`boxframe/services/layout_service.py`) —
  двухуровневый list-comprehension: у корневых блоков был ключ `children`,
  у вложенных — нет, глубже второго уровня строить было невозможно в
  принципе;
- `buildExportJson` (`boxframe/static/js/core/store.js`, static-режим) —
  зеркальная копия той же логики (комментарий: "root blocks + their
  direct children").

Из-за этого блоки на глубине ≥ 2 (внуки и глубже) **молча терялись** при
экспорте — без ошибки, без предупреждения. Round-trip для глубоких
деревьев сломан: импорт (`parseLayoutJson` в `core/import.js`) понимает
произвольную глубину (рекурсивный `addBlock`), а экспорт данные до него
не доводит.

# Задача

Сделать экспорт JSON рекурсивным — дерево произвольной глубины — в обоих
режимах:

1. Python: `LayoutService.export_json` (web-режим, `GET /api/layouts/{id}/export`).
2. JS: `buildExportJson` (static-режим, `store.export()`).
3. Формат экспорта в Python и JS должен совпадать (parity).
4. Тесты на глубину ≥ 3 в обоих наборах.

# План работ

- [x] Составить план работ
- [x] Изучить код экспорта (Python + JS) и загрузку блоков
      (`get_layout`, `selectinload`);
- [x] Воспроизвести баг скриптом (`tmp/check_export_depth.py`, цепочка
      A → B → C);
- [x] `layout_service.py`: `export_json` — рекурсивная сборка дерева из
      плоского `layout.blocks` (группировка по `parent_id`);
- [x] `store.js`: `buildExportJson` — зеркальная рекурсия;
- [x] Тесты: API-тест на глубину 3 (`test_export_nested_three_levels`)
      + JS-тест `export()` memory store;
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test tests/js/*.js`.

# Исследование

1. **Глубина ограничена кодом, а не данными.** `export_json` строил
   `children` только для корневых блоков; у вложенных блоков ключа
   `children` не было. `buildExportJson` — то же самое.
2. **ORM-загрузка тоже двухуровневая.** `get_layout` грузит
   `selectinload(Layout.blocks).selectinload(Block.children)` — ровно два
   уровня. Просто «дорекурсить» по ORM-отношению нельзя: ленивая
   загрузка `c.children` в async-контексте дала бы `MissingGreenlet`.
   Но `layout.blocks` содержит **все** блоки макета, поэтому дерево
   собирается в памяти по `parent_id` без доп. запросов.
3. **Асимметрия с импортом.** `parseLayoutJson` (`core/import.js`) —
   рекурсивный, принимает `children` на любой глубине
   (`Array.isArray(b.children) ? ... : []`). Импорт глубокие деревья
   понимает, экспорт их не генерирует.
4. **Тесты не покрывали вложенный экспорт.** `test_export_layout`
   проверял только плоский layout; поэтому баг не проявлялся.
5. **Воспроизведение.** `tmp/check_export_depth.py`: цепочка A → B → C
   (3 блока, 3 уровня) → `blocks in export: 2 (expected 3)` — внук
   исчезает.

# Выполнение задачи

Изменено 2 файла кода + 2 файла тестов.

**`boxframe/services/layout_service.py`** — `export_json`:
- блоки группируются по `parent_id` в словарь `children_by_parent`
  (ключ `None` — корневые);
- рекурсивный `to_dict(b)` — каждый блок несёт `children` (у листьев —
  пустой массив);
- дерево собирается из плоского `layout.blocks`, ORM-отношение
  `Block.children` не читается — ленивая загрузка исключена.

**`boxframe/static/js/core/store.js`** — `buildExportJson`:
- зеркальная рекурсия: `childrenByParent` (ключ `"root"` для корневых),
  `toDict(b)` с рекурсией в `children`;
- формат совпадает с Python-экспортом побайтово (те же ключи:
  `type`/`metadata`, `children` на каждом уровне).

**Тесты:**
- `tests/api/test_layouts.py::test_export_nested_three_levels` —
  цепочка parent → child → grandchild (через существующий хелпер
  `_create_nested`); проверяется, что все три блока на месте на нужных
  уровнях вложенности;
- `tests/js/test_store.js` — "memory store: export() nests children at
  arbitrary depth": a → b → c, структура `json.blocks[0].children[0].children[0]`.

## Проверка

- `pytest tests/ --ignore=tests/e2e` — 135 passed (e2e не запускались:
  нужен запущенный сервер на :8000, и по AGENTS.md e2e не миксуют с
  API-тестами в одном процессе);
- `node --test tests/js/*.js` — 151 passed;
- `tmp/check_export_depth.py` — было `blocks in export: 2 (expected 3)`,
  стало `3`.

# Замечания

1. **Формат экспорта слегка изменился.** Теперь у **каждого** блока есть
   ключ `children` (у листьев — `[]`); раньше у вложенных блоков его не
   было. Импорт совместим: `parseLayoutJson` проверяет
   `Array.isArray(b.children)`, поэтому старые и новые файлы
   разбираются одинаково.
2. **`selectinload(Block.children)` в `get_layout` теперь избыточен.**
   После фикса ни один потребитель не читает ORM-отношение
   `Block.children` (рендерер строит `RenderBlock` из плоского списка,
   экспорт — тоже). Загрузка второго уровня осталась — безвредна, но
   кандидат на удаление в отдельной задаче.
3. **Round-trip замкнут.** Экспорт произвольной глубины + рекурсивный
   импорт: `export → parseLayoutJson` теперь сохраняет все блоки и
   z-порядок (`order` на каждом уровне).
4. **Static-режим покрыт тем же форматом** — `buildExportJson`
   зеркалит Python; парность форматов держится на совпадении ключей
   (`type`/`metadata`), как и раньше.
