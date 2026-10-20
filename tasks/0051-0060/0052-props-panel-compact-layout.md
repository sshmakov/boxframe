# Суть проблемы

Панель свойств слишком высокая по вертикали. При всех открытых секциях тело
панели у box — 590px, у hline — 493px: потолок `.block-props__body`
(`max-height: 400px`) не удерживает содержимое, внутри панели появляется
скролл, а видимая высота панели зафиксирована на 503px (head + actions +
400px) независимо от типа блока. Дополнительно каждая из 5 (box) / 4 (hline)
секций имела заголовок (название + шеврон, ~25px) и была свёрнута по
умолчанию — чтобы увидеть свойства, приходилось раскрывать секции кликами,
а состояние открытости персистилось в localStorage.

# Задача

Уменьшить вертикальный размер панели свойств:

1. Объединить два свойства Align (H Align / V Align) в одну строку с общим
   лейблом (по одной группе кнопок на свойство).
2. Разместить 5 полей Geometry в 3 колонки (X Y W / H Order) вместо двух.
3. Заменить segmented-кнопки Arrows (7 опций × 2 строки) двумя селектами
   (Start / End) в одной строке.
4. Убрать сворачивание секций вместе с заголовками секций, содержимое
   секций оставить — секции всегда открыты.

# План работ

- [x] Разобрать структуру панели (схема → `sectionsForType` →
      `buildPropsPanelHTML` → `x-html`)
- [x] Замерить «до»-высоты (Playwright, `tmp/check_panel_height.py`)
- [x] Align: группировка `row`/`rowLabel` в схеме + разметка group-строки
- [x] Geometry: `cols: 3` в схеме + класс 3-колоночной сетки
- [x] Arrows: `kind: "select"`, два селекта в одной строке, подписи опций —
      глифы наконечника
- [x] Обновить JS-тесты (схема, `rowsForProps`, markup)
- [x] Обновить e2e (3-колоночная сетка, селекты стрелок)
- [x] Убрать сворачивание: `sectionState`, `isSectionOpen`/`toggleSection`,
      persist в localStorage
- [x] Убрать заголовки из разметки и CSS; имя секции — `data-section`
- [x] Обновить JS- и e2e-тесты под секции без сворачивания
- [x] Прогнать полные сьюты (JS, Python unit, e2e)
- [x] Замерить «после»-высоты

# Исследование

- Панель генерируется из декларативной схемы `PROPERTY_SCHEMA`
  (`core/properties.js`) — единый источник правды для обоих редакторов
  (web и static); разметка тела строится `buildPropsPanelHTML()` и
  рендерится через `x-html`.
- Нюанс Alpine.js, обнаруженный при реализации: `x-for` как ПРЯМОЕ
  содержимое шаблона `x-if` не инициализируется (секции не
  отрисовывались) — ветки по `row.kind` сделаны sibling-`x-if` внутри
  общего корня `.prop-cell` (`display: contents`).
- Замеры высоты (Playwright, все секции открыты, `scrollHeight` тела):

  | Блок | До | После 1+2+3 | После удаления сворачивания |
  |------|----|-------------|-----------------------------|
  | box | 590px | 504px (−86) | 379px (−211) |
  | hline | 493px | 406px (−87) | 306px (−187) |

  Видимая панель: до и после 1+2+3 — 503px (потолок 400px, скролл
  оставался — hline на 6px выше потолка); после удаления заголовков —
  box 482px, hline 409px, тело укладывается в потолок, **скролла нет**.
- Разбивка по секциям после всех изменений (высота секции): box —
  Style 64 / Fill 64 / Align 64 / Geometry 74 / Text 61; hline — Style 64 /
  Arrows 63 / Geometry 74 / Text 61. Заголовок секции стоил ~25px
  (504−379=125 для 5 секций, 406−306=100 для 4).

# Выполнение задачи

- `boxframe/static/js/core/properties.js`:
  - Схема: `text_align`/`vertical_align` — `row: "align"` +
    `rowLabel: "Align"` (одна строка, общий лейбл); `x/y/width/height/
    order` — `cols: 3`; `arrow_start`/`arrow_end` — `kind: "select"`
    (было segmented), подписи опций — глифы наконечника, зависящие от
    направления линии (`icons` как функция).
  - Новый `rowsForProps()` — группирует соседние свойства с общим `row` в
    grid-строки (`kind: "group"` или kind единственного свойства, `prop` —
    это свойство); `sectionsForType()` добавляет секциям `rows` и `cols`
    (максимум `cols` свойств, дефолт 2).
  - `buildPropsPanelHTML()`: тело секции итерирует `section.rows`; ветки по
    `row.kind` — sibling-`x-if` (см. Исследование); group-строка — общий
    лейбл + `.align-row` с группой кнопок на свойство; 3-колоночная сетка —
    `:class="{ 'props-section__body--3col': section.cols === 3 }"`; select —
    `<select>` с опциями `x-text="propIcon(row.prop, opt)"`.
  - Сворачивание удалено: кнопка-заголовок (название + шеврон) и
    `x-show`/`x-cloak` на теле секции убраны; имя секции вынесено в
    `:data-section` (адресация в e2e).
- `boxframe/static/js/editor.js`: удалены `sectionState`,
  `_loadSectionState`/`_saveSectionState`/`isSectionOpen`/`toggleSection`
  и вызов в `init()`. Ключ localStorage `boxframe.props.sections` больше не
  используется.
- `boxframe/static/css/editor.css`: удалены `.props-section__head`/
  `__chev`; добавлены `.props-section__body--3col` (3 колонки) и
  `.align-row` (группы кнопок с тонким разделителем).
- `tests/js/test_properties.js`: схема (arrows — select, `row`/`rowLabel`,
  `cols: 3`), новые тесты `rowsForProps` (группировка Align-пары, одиночное
  свойство сохраняет свой лейбл), markup (нет head/`isSectionOpen`/
  `toggleSection`, есть `data-section`); 4 теста состояния открытости
  удалены.
- `tests/e2e/test_editor.py`: удалён хелпер `_open_section` и все его
  вызовы; адресация секций — `.props-section[data-section="X"]`;
  `test_properties_panel_section_order` переписан (порядок по
  `data-section`, секции всегда открыты); 3-колоночная сетка Geometry и
  селекты стрелок покрыты.
- `tasks/0051-0060/0051-extended-block-properties.md`: заметка 8
  (сворачивание секций убрано).

Всё выполнено, не получилось — ничего.

Приёмка: `node --test "tests/js/*.js"` — 270 pass;
`pytest tests/ --ignore=tests/e2e` — 195 passed; `pytest tests/e2e/` —
73 passed.

# Замечания

1. Потолок 400px (`.block-props__body` `max-height`) теперь не
   ограничивающий (тело 379/306px), но оставлен как предохранитель: при
   росте схемы (новые секции/свойства) вернётся скролл, а не перетекание
   панели за канвас.
2. Старое значение `boxframe.props.sections` в localStorage пользователя
   игнорируется (ключ больше не читается) — безвредно, миграция не нужна.
3. Адресация секций в e2e — через `data-section`; при переименовании
   `group` в схеме селекторы e2e сломаются явно (хорошо).
4. Одноразовый скрипт замера — `tmp/check_panel_height.py` (вне git,
   `tmp/` в `.gitignore`); создаёт и удаляет временный проект через API.
5. Если панель потребуется сжать дальше: скрыть поле Order (−~32px),
   компрессия padding/gap секций, повышение потолка — не делалось,
   запроса не было.
