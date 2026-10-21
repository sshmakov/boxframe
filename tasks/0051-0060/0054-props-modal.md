# Суть проблемы

Плавающая панель свойств выросла до 5 секций у box (Style, Fill, Align,
Geometry, Text) и 4 у hline (Style, Arrows, Geometry, Text). Часто
употребляемые свойства (стиль линий, заполнение, выравнивание текста,
стрелки) смешаны с редко нужными (геометрия x/y/w/h/order, многострочный
текст): панель высокая (тело 379px у box), а до основных контролов
придётся прокручивать редко нужные секции. Пользователь хочет оставить в
плавающей панели только основные управляющие элементы, а остальные —
перенести в отдельное место.

# Задача

Разделить панель свойств на два:

1. **Плавающая панель** (рядом с выделением) — действия
   (Duplicate/Copy/Delete) + **основные** свойства: Style, Fill, Align,
   Arrows (у линий) + кнопка «⚙ Properties».
2. **Модалка со всеми свойствами** — открывается кнопкой «Properties»
   в плавающей панели; показывает **все** секции схемы (основные +
   вторичные: Geometry, Text); без действий. Поле Content —
   многострочное (textarea).

Поведение модалки:

- полупрозрачный overlay **прозрачен для кликов** (`pointer-events: none`)
  — канва остаётся интерактивной под затемнением: Fill/Align настраиваются
  live, а смена выделения обновляет содержимое модалки **на месте**;
- закрытие — Esc (первый Esc закрывает модалку, второй снимает выделение)
  или кнопка ×; клик по затемнению НЕ закрывает (оно не перехватывает
  клики);
- при снятии выделения (×, Del, клик по пустому месту, undo, очистка
  макета) модалка закрывается;
- фокус: при открытии — на кнопку ×, при закрытии — возврат на канву;
- оба редактора (web + static) — общий маркап и логика.

# План работ

- [x] Флаг `panel` в схеме: `primary` у border_style, fill, text_align,
      vertical_align, arrow_start, arrow_end; опущен = secondary
- [x] `sectionsForType(type, panel)` — фильтр по панели ("primary" / "all")
- [x] `buildPropsPanelHTML(getter)` — два константных фрагмента
      (panelSections / modalSections)
- [x] Content: `kind: "textarea"` (многострочное поле в модалке)
- [x] editor.js: `showPropsModal`, `openPropsModal`/`closePropsModal`,
      фокус, приоритет Esc, `modalSections`
- [x] Маркап: модалка в `editor.html` + `static/editor/index.html`,
      кнопка «Properties» в actions, tabindex на канве
- [x] editor.css: стили модалки (overlay, диалог, textarea)
- [x] JS-тесты: схема (panel-флаг, textarea), `sectionsForType(panel)`,
      `panelSections`/`modalSections`, два фрагмента
- [x] e2e: обновить тесты панели (секции, геометрия, static), добавить
      тесты модалки
- [x] Прогнать сьюты (JS, Python unit, e2e)

# Исследование

- Тело панели — константный фрагмент, генерируемый из схемы
  (`core/properties.js`); все биндинги (`panelSections`, `propValue`,
  `onPropSelect`…) разрешаются против редактор-аппа, а не против
  конкретного контейнера → фрагмент переносится в модалку без изменений,
  только источник секций — другой getter.
- Выделение сбрасывается в пяти местах (`clearSelection`,
  `deleteSelection`, `deleteBlock`, `clearLayout`,
  `_syncStateFromStore` после undo) → сброс флага `showPropsModal`
  централизован в `x-effect` на корне модалки:
  `if (!selectedBlock) showPropsModal = false` (Alpine отслеживает
  getter `selectedBlock` через reactive-прокси).
- Esc сейчас не работает в текстовых полях (early return на `inField`)
  и сразу снимает выделение → новый приоритет: модалка открыта → Esc
  закрывает модалку (даже из её полей); иначе — как раньше.
- Overlay с `pointer-events: none` — канва кликабельна под затемнением
  (требование «обновляется на месте при смене выделения» невозможно с
  блокирующим overlay). Drag под модалкой тоже возможен — модалка
  центрирована и не следует за выделением, мерцания нет.
- Alpine: `x-for` как прямое содержимое `x-if` не инициализируется →
  ветка textarea — sibling-`x-if` внутри корня строки (существующий
  паттерн веток по `row.kind`).

# Выполнение задачи

- `boxframe/static/js/core/properties.js`:
  - Схема: `panel: "primary"` у border_style, fill, text_align,
    vertical_align, arrow_start, arrow_end; остальные (x/y/width/height/
    order, content) — без флага (secondary, модалка только). `content` —
    `kind: "textarea"` (многострочное поле).
  - `sectionsForType(blockType, panel)` — второй аргумент: `"primary"`
    фильтрует свойства по флагу, `"all"` (дефолт) — без фильтра.
  - `buildPropsPanelHTML(getterName)` — параметризованный генератор:
    дефолтный фрагмент итерирует `panelSections` (плавающая панель),
    `buildPropsPanelHTML("modalSections")` — модалка; единственное
    различие — имя getter'а. Новая ветка `row.kind === 'textarea'`
    (sibling-`x-if`, как остальные ветки по kind).
- `boxframe/static/js/editor.js`:
  - Состояние: `propsModalHTML` (генерируется в `init()`),
    `showPropsModal` (интент пользователя).
  - `panelSections` → `sectionsForType(type, "primary")`; новый
    `modalSections` → все секции.
  - `openPropsModal()` (фокус на × через `$nextTick`) /
    `closePropsModal()` (возврат фокуса на канву).
  - `_bindKeys`: Escape вынесен до early return на `inField` — модалка
    открыта → Esc закрывает её (даже из её полей); иначе — как раньше
    (снимает выделение, не из полей).
- Маркап (`templates/pages/editor.html` + `static/editor/index.html`,
  одинаково): кнопка «⚙ Properties» в actions плавающей панели; модалка
  внутри `.editor-root` — `x-show="showPropsModal && selectedBlock &&
  !editingBlock"` + `x-effect="if (!selectedBlock) showPropsModal =
  false"` (сброс флага при любом снятии выделения: ×, Del, клик по
  пустому месту, undo, clear layout); `tabindex="0"` на
  `.canvas-container` (возврат фокуса).
- `boxframe/static/css/editor.css`: `.props-modal` (fixed, z-index 300,
  `pointer-events: none` на контейнере и overlay — канва интерактивна
  под затемнением), `.props-modal__dialog` (`pointer-events: auto`,
  440px, max-height со скроллом тела), head/×/body; `.prop textarea`
  (моноширинный, `resize: vertical`, min-height 96px).
- `tests/js/test_properties.js`: схема (panel-флаги, content —
  textarea), `sectionsForType(panel)` (box/hline/text + дефолт "all"),
  `panelSections` (только primary) / новый `modalSections` (все),
  `buildPropsPanelHTML` (textarea-ветка; модал-фрагмент = панельный с
  заменой getter'а).
- `tests/e2e/test_editor.py`:
  - `test_properties_panel_fields_in_one_row` →
    `test_props_modal_geometry_fields_in_one_row` (геометрия в модалке);
  - `test_properties_panel_section_order` — панель: 3 секции
    (Style/Fill/Align), модалка: 5;
  - `test_static_editor_panel_matches_web_layout` — 4 action-кнопки,
    primary-секции, геометрия в модалке;
  - `test_static_editor_block_not_shifted_when_not_at_top` — Y-поле
    ищется в модалке;
  - новые: `test_props_modal_esc_closes_modal_then_selection` (Esc из
    поля модалки → закрытие модалки, второй Esc → снятие выделения),
    `test_props_modal_esc_from_close_button_closes_only_modal` (Esc из
    состояния по умолчанию, фокус на × → закрывается только модалка;
    регрессия на двойной init()),
    `test_props_modal_updates_on_selection_change` (клик по другому
    блоку сквозь overlay — модалка обновляется на месте, секции следуют
    за типом), `test_props_modal_closes_when_selection_cleared`
    (Delete по клавише с confirm), `test_props_modal_content_textarea_
    saves` (textarea, коммит по blur при закрытии, persist в БД).

Всё выполнено, не получилось — ничего.

Приёмка: `node --test "tests/js/*.js"` — 275 pass;
`pytest tests/ --ignore=tests/e2e` — 195 passed; `pytest tests/e2e/` —
79 passed.

# Замечания

1. Клик по затемнению НЕ закрывает модалку — overlay прозрачен для
   кликов (иначе канва была бы неинтерактивна, а требование «обновляется
   на месте при смене выделения» с блокирующим overlay невозможно).
   Закрытие: Esc (первый) или ×.
2. Флаг `showPropsModal` сбрасывается `x-effect`'ом на корне модалки
   (единая точка для всех путей сброса выделения). Краевый случай:
   undo, снимающий выделение, — модалка скрывается (x-show), флаг
   сбрасывается эффектом; следующее выделение НЕ открывает модалку
   заново.
3. Раса e2e с `_verifyAlignIcons`: до появления `align-icons-ok` кнопки
   Align несут видимый текст, после — иконки (текст скрывается) — высота
   диалога и позиции полей внутри него сдвигаются. Тесты, кликающие
   поля модалки, ждут класс `align-icons-ok` на корне (установившийся
   паттерн из тестов Align).
4. Inline-редактор (dblclick) при открытой модалке: модалка скрывается
   на время (`!editingBlock` в x-show), после сохранения — появляется
   снова (флаг не сбрасывается). Осознанно: модалка «следует» за
   открытым состоянием.
5. Focus-trap в модалке не делался (Esc + × достаточно для MVP); Tab
   может уйти в фоновые элементы под затемнением.
6. Баг (нашёл пользователь после релиза): один Esc закрывал модалку И
   снимал выделение. Причина: `init()` исполнялся **дважды** — Alpine
   автоматически вызывает `state.init()` (lifecycle хук x-data:
   `s.init && R(e, s.init)` в директиве `x-data`) И явный
   `x-init="init()"` в шаблоне. Два keydown-слушателя на document:
   первый закрыл модалку (`showPropsModal=false`), второй в том же
   событии увидел `false` и снял выделение. До 0054 дубль был
   безвреден (clearSelection идемпотентен); с состоятельным
   Escape-обработчиком (модалка → выделение) проявился. Фикс: убран
   `x-init="init()"` из обоих шаблонов (остался автовызов x-data),
   в шаблоне — комментарий, чтобы не «починили» обратно.
7. Регрессионный тест: `test_props_modal_esc_from_close_button_closes_
   only_modal` — Esc из состояния по умолчанию (фокус на ×, не-input).
   Существующий `test_props_modal_esc_closes_modal_then_selection` баг
   НЕ ловил: он нажимает Esc из поля модалки, где `inField=true`
   маскирует дублирующий слушатель. Проверено: с возвращённым
   `x-init="init()"` новый тест падает, старый — проходит.
