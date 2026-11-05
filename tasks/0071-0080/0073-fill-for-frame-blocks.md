# Суть проблемы

Заполнение пустого пространства (`meta.fill`) было доступно только части
типов блоков: `box`, `header`, `footer`, `sidebar`, `content`, `grid`,
`image` (`FILL_TYPES`). Остальные элементы, отображаемые в виде
прямоугольной рамки — `button`, `input`, `textarea`, `text` — fill не
принимали: `meta.fill` у них молча игнорировался, а в панели свойств
секции `Fill` для них не было. Чтобы залить внутреннюю область, например,
кнопки или поля ввода, приходилось обходиться рамкой и текстом.

# Задача

Расширить `FILL_TYPES` на все типы, отображаемые в виде прямоугольной
рамки: добавить `button`, `input`, `textarea`, `text`. Fill заливает
внутреннюю область блока (как у `box`): контент/label рисуется поверх,
hint `[type]` подавляется, блок без рамки заливает всю область. Линии
(`divider`, `hline`, `vline`) — не рамки — в матрицу не входят.

# План работ

- [x] Составить план работ
- [x] `services/renderer.py` — `FILL_TYPES` += 4 типа; `_draw_button` —
      заливка внутренней области перед label
- [x] `static/js/core/renderer.js` — зеркально: `FILL_TYPES`, `drawButton`
      (побайтовый parity)
- [x] `core/properties.js` — `fill.types` += button/input/textarea/text
- [x] Тесты: `tests/test_renderer.py` (5 новых + 2 обновлённых),
      `tests/js/test_renderer.js` (5 новых + 2 обновлённых),
      `tests/js/test_properties.js` (схема + секции),
      `tests/test_js_renderer_parity.py` (кейсы новых типов),
      `tests/e2e/test_editor.py` (button → hline в модалке)
- [x] Проверка: `pytest tests/ --ignore=tests/e2e` (336),
      `node --test "tests/js/*.js"` (404), `pytest tests/e2e/` (106,
      сервер на :8000, перезапущен через `scripts/server.sh restart`)

# Исследование

1. **Механизм fill уже общий.** `fill_char()`/`fillChar()` гатят тип по
   `FILL_TYPES` и читают `meta.fill` (ровно одна клетка). `_draw_content`
   (общий путь box/header/footer/sidebar/content/image/text/input/
   textarea) уже рисует fill и подавляет hint при его наличии → для
   `input`/`textarea`/`text` достаточно добавить тип в `FILL_TYPES`.
2. **Button — собственный путь.** `_draw_button`/`drawButton` не ходит
   через `_draw_content`: форма зависит от высоты (h=1 `[label]`, h=2 без
   верхней рамки, h>=3 полная рамка, none — весь блок). Внутренняя
   область вычисляется отдельно (h=1/h=2 — одна строка, h>=3 — строки
   между рамками, none — весь блок) → вынес её в одну точку и заливаю
   перед label (label поверх).
3. **HTML-оверлей fill не рисует** — только рамки/линии/подписи div'ами;
   fill живёт в ASCII-слое → правок `_block_preview_html`/
   `_blockPreviewHtml` не требуется.
4. **Панель — schema-driven.** Секция `Fill` генерируется из
   `PROPERTY_SCHEMA` (`core/properties.js`); добавление типов — правка
   `fill.types`, шаблоны не трогаются (web и static — один генератор).
5. **Обратная совместимость.** `meta.fill` у новых типов в старых макетах
   отсутствует → рендер идентичен предыдущим версиям.

# Выполнение задачи

- `services/renderer.py`:
  - `FILL_TYPES` += `button`, `input`, `textarea`, `text`;
  - `_draw_button` — вынесено вычисление внутренней области (до label),
    заливка `fill_char(...)` по внутренней области перед label (label
    поверх); docstring дополнен.
- `static/js/core/renderer.js` — зеркально: `FILL_TYPES`, `drawButton`
  (побайтовый parity с Python).
- `core/properties.js` — `fill.types` += button/input/textarea/text
  (комментарий: все рамочные типы, линии вне матрицы).

Тесты:
- `tests/test_renderer.py` — `test_fill_char` (4 типа в матрице, линии
  вне), `test_fill_ignored_for_lines` (бывш. `…_other_types`, только
  линии), новые: `test_fill_input_block`, `test_fill_textarea_block`,
  `test_fill_text_block` (с рамкой — контент поверх, без рамки — вся
  область), `test_fill_button_block` (h=1/h=2/h>=3/none, label по
  центру), `test_fill_button_hide_text_keeps_fill`;
- `tests/js/test_renderer.js` — 5 зеркальных тестов + обновлённые
  `fillChar`/`fill ignored for lines`;
- `tests/js/test_properties.js` — схема (`fill.types` включает 4 типа,
  линии вне), `sectionsForType: Fill applies to every framed type, not to
  lines`, панель primary (пример без fill — `divider` вместо `text`);
- `tests/test_js_renderer_parity.py` — `test_parity_fill`: кейсы
  button/text/input/textarea (рамка + none + контент);
- `tests/e2e/test_editor.py` — `test_props_modal_updates_on_selection_change`:
  второй блок button → hline (у button теперь есть секция Fill).

Проверка: 336 py (unit+API+parity), 404 js, 106 e2e — зелёные.

# Замечания

- Обратная совместимость сохранена: `meta.fill` — опция, отсутствующая в
  старых макетах; рендер старых макетов не меняется.
- `button` — единственный тип с собственной формой рамки: fill заливает
  внутреннюю область, которая зависит от высоты (h=1/h=2 — одна строка).
  При изменении формы кнопки не забыть про fill.
- Линии (`divider`/`hline`/`vline`) осознанно вне `FILL_TYPES` — у них нет
  внутренней области (линия + подпись).
