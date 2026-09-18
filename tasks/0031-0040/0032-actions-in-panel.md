# Суть проблемы

Панель со свойствами элемента, отображаемая при выделении элемента мышью, не содержит действий над элементом. 
Действия (удаление, дублирование) активируются по клику в горячих точках на углах элементов, а не в панели.   

# Задача

Переформатировать содержимое панели, добавить на нее область с действиями над элементом

AS IS:
```text

 ┌────────────────────────────────┐
 │Box                             │
 │────────────────────────────────│
 │Style                           │
 │┌──────────────────────────────┐│
 ││[combobox styles]             ││
 │└──────────────────────────────┘│
 │X                 Y             │
 │┌──────────────┐┌──────────────┐│
 ││[input]       ││[input]       ││
 │└──────────────┘└──────────────┘│
 │W               H               │
 │┌──────────────┐┌──────────────┐│
 ││[input]       ││[input]       ││
 │└──────────────┘└──────────────┘│
 │ORDER                           │
 │┌──────────────┐                │
 ││[input]       │                │
 │└──────────────┘                │
 │CONTENT                         │
 │┌──────────────────────────────┐│
 ││[input]                       ││
 │└──────────────────────────────┘│
 └────────────────────────────────┘
```

TO BE:
```text
┌─────────────────────────────────────┐
│Box                                  │
│─────────────────────────────────────│
│┌───────────────────────────────────┐│
││[actions (dublicate, delete, ...)] ││
│└───────────────────────────────────┘│
│Line Style                           │
│┌───────────────────────────────────┐│
││ [line style buttons, icons only]  ││
│└───────────────────────────────────┘│
│ ┌─────┐  ┌─────┐   ┌─────┐   ┌─────┐│
│X│input│ Y│input│  W│input│  H│input││
│ └─────┘  └─────┘   └─────┘   └─────┘│
│ORDER                                │
│┌──────────────┐                     │
││[input]       │                     │
│└──────────────┘                     │
│CONTENT                              │
│┌───────────────────────────────────┐│
││[input]                            ││
│└───────────────────────────────────┘│
└─────────────────────────────────────┘
```

# План работ

- [x] Составить план работ
- [x] Панель (web, `templates/pages/editor.html`):
      - добавить область действий (Duplicate / Delete) под заголовком;
      - заменить combobox «Style» на «Line Style» — кнопки-иконки
        (box-drawing-глиф стиля: ─ ┄ ┈ ═ ∅), активный стиль подсвечен;
      - X/Y/W/H — одна строка из 4 полей, метка слева от input;
      - Order / Content — без изменений.
- [x] Панель (static, `static/editor/index.html`) — идентичные изменения
      (маркап дублируется, держать в синхроне с web-версией).
- [x] Рамка выделения: убрать угловые хотспоты ⧉/✕ (`.sel-icon--dup`,
      `.sel-icon--del`) — панель становится единственным местом действий;
      resize-ручка (`.sel-resize`) остаётся.
- [x] `editor.js`: метод `styleIcon(style)` (стиль → глиф), ширина панели
      в `propsPanelStyle` под компактную сетку X/Y/W/H.
- [x] `editor.css`: стили `.block-props__actions`, `.action-btn`,
      `.style-btns`, `.style-btn`, `.prop-row`, `.prop--inline`;
      удалить мёртвые стили `.sel-icon*`.
- [x] E2E-тесты: переписать проверки хотспотов на действия панели
      (`test_single_click_selects_block`, `test_duplicate_icon_creates_block_copy`,
      `test_delete_icon_removes_block`), заменить `select` на кнопки
      Line Style (`test_properties_panel_shows_next_to_selected_block`,
      `test_properties_panel_updates_border_style`).
- [x] Проверка: `pytest tests/ -v` (unit+api), `node --test "tests/js/*.js"`,
      `pytest tests/e2e/ -v` (на запущенном сервере).

# Исследование

1. **Маркап панели дублируется.** Панель существует в двух идентичных
   копиях: `templates/pages/editor.html` (web-режим) и
   `static/editor/index.html` (static-режим). `editor.js` общий, поэтому
   изменения в логике — в одном месте, а в маркапе — в обоих файлах.
2. **Логика действий уже есть.** `duplicateBlock()` (копия со сдвигом на
   1 клетку, `order = max+1`, копия становится выделенной) и
   `deleteBlock(id)` (с `confirm`) уже реализованы в `editor.js` — кнопки
   панели вызывают те же методы, новой логики не требуется.
3. **Порядок input'ов в панели — load-bearing.** `_panelInputs()` читает
   поля панели по DOM-индексу: [0]=X [1]=Y [2]=W [3]=H [4]=Order
   [5]=Content. Новый маркап сохраняет этот порядок, поэтому
   `updateSelectedXY` / `updateSelectedWH` работают без изменений.
4. **E2E-тесты привязаны к старой структуре.** Хотспоты проверяют
   `test_single_click_selects_block`, `test_duplicate_icon_creates_block_copy`,
   `test_delete_icon_removes_block`; combobox стиля —
   `test_properties_panel_shows_next_to_selected_block` и
   `test_properties_panel_updates_border_style`. Все пять переписаны.
5. **Ширина панели захардкожена.** `propsPanelStyle` использует
   `panelW = 208` для позиционирования и клампинга — расширена до 264px
   под строку из четырёх полей X/Y/W/H.
6. **Решение по хотспотам (подтверждено пользователем).** Угловые
   хотспоты ⧉/✕ удалены — панель становится единственным местом
   действий над элементом. Рамка выделения сохраняет только
   resize-ручку (`.sel-resize`).

# Выполнение задачи

Изменено 6 файлов.

**`boxframe/templates/pages/editor.html`** и
**`boxframe/static/editor/index.html`** (идентичные изменения):
- панель: добавлена область `.block-props__actions` с кнопками
  Duplicate / Delete (вызов существующих `duplicateBlock()` /
  `deleteBlock()`);
- панель: combobox «Style» заменён на «Line Style» — кнопки-иконки
  с box-drawing-глифом стиля (─ ┄ ┈ ═ ∅), активный стиль подсвечен
  (`.style-btn--active`), `title` — имя стиля;
- панель: X/Y/W/H — одна строка (`.prop-row`), метка слева от input
  (`.prop--inline`); Order / Content — без изменений;
- рамка выделения: убраны угловые хотспоты ⧉/✕, resize-ручка осталась.

**`boxframe/static/js/editor.js`**:
- метод `styleIcon(style)` — стиль → глиф (фолбэк — имя стиля);
- `propsPanelStyle`: ширина панели 208 → 264px.

**`boxframe/static/css/editor.css`**:
- добавлены стили: `.block-props__actions`, `.action-btn` (+ `--danger`),
  `.style-btns`, `.style-btn` (+ `--active`), `.prop-row`, `.prop--inline`;
- удалены мёртвые стили `.sel-icon*`.

**`tests/e2e/test_editor.py`**:
- `test_single_click_selects_block` — рамка содержит resize-ручку и не
  содержит `.sel-icon`;
- `test_duplicate_icon_creates_block_copy` →
  `test_panel_duplicate_creates_block_copy` (клик по кнопке Duplicate
  в панели);
- `test_delete_icon_removes_block` → `test_panel_delete_removes_block`
  (клик по кнопке Delete в панели);
- `test_properties_panel_shows_next_to_selected_block` — вместо `select`
  проверяются 5 кнопок Line Style и активная «solid»; добавлена
  геометрическая проверка: панель справа от блока и внутри видимой
  области канваса;
- `test_properties_panel_updates_border_style` — клик по
  `.style-btn[title='dashed']`;
- `test_properties_panel_fields_in_one_row` (новый) — X/Y/W/H в одну
  строку (одинаковый `top`, строго возрастающий `left`), метка каждого
  поля слева от input и вертикально центрирована;
- `test_properties_panel_section_order` (новый) — порядок секций сверху
  вниз: действия → Line Style → X/Y/W/H → Order → Content;
- `test_static_editor_panel_matches_web_layout` (новый) — панель
  статического редактора совпадает с web-разметкой (строка действий,
  5 кнопок Line Style, X/Y/W/H в одну строку) — защита от рассинхрона
  дублируемого маркапа.

## Проверка

- `pytest tests/ --ignore=tests/e2e` — 110 passed;
- `node --test "tests/js/*.js"` — 98 passed;
- `pytest tests/e2e/ -v` (сервер на :8000) — 45 passed.

# Замечания

1. **Дублирование маркапа панели.** Любое будущее изменение панели
   (палитры, списка элементов) нужно вносить в `editor.html` и
   `static/editor/index.html` синхронно. Кандидат на рефакторинг:
   вынести общий маркап в Jinja2-партиал или JS-шаблон.
2. **Глифы `styleIcon()` — ещё одна копия констант стилей.** При
   добавлении нового border style не забыть добавить глиф в
   `styleIcon()` (без глифа безопасно показывается имя стиля).
3. **Размеры панели захардкожены** в `propsPanelStyle` (`panelW = 264`,
   `panelH = 300`) — используются для позиционирования и клампинга;
   при добавлении новых строк в панель значения нужно пересмотреть.
4. **DOM-порядок input'ов панели** (X, Y, W, H, Order, Content) —
   load-bearing для `_panelInputs()`; при перестановке полей обновить
   индексы.