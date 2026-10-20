# Суть проблемы

Кнопки выравнивания в панели свойств (секция Align: H Align / V Align)
отображали сырой текст опций — `left` / `center` / `right` и `top` /
`middle` / `bottom`. В отличие от остальных segmented-кнопок панели
(Style — глифы линий `─┄┈═∅`, Fill — глифы заливки, Arrows — глифы
наконечников), у выравнивания не было визуально говорящей метки: шесть
английских слов в узкой панели читаются медленнее, чем иконки, и не
передают смысл (направление выравнивания) мгновенно.

# Задача

Заменить текст в кнопках выравнивания текста на подходящие иконки;
иконки создать в формате SVG.

# План работ

- [x] Разобрать генерацию панели (схема → `buildPropsPanelHTML` →
      `propIcon`/`propActive` в `editor.js`)
- [x] Определить, как иконки должны работать в обоих режимах редактора
      (web + static `file://`)
- [x] Создать 6 SVG-иконок в `boxframe/static/icons/`
- [x] Схема: поле `iconPrefix` + его применение в разметке кнопок
- [x] `editor.js`: метод `styleBtnClasses` (активное состояние +
      иконочные классы)
- [x] `editor.css`: маска SVG на `currentColor` для иконочных кнопок
- [x] Обновить JS-тесты (схема, markup, `styleBtnClasses`)
- [x] Обновить e2e-тест выравнивания (проверка иконочных классов)
- [x] Прогнать полные сьюты (JS, Python unit, e2e)
- [x] Визуальная проверка рендера иконок в обоих режимах (Playwright)

# Исследование

- Панель свойств генерируется из декларативной схемы `PROPERTY_SCHEMA`
  (`core/properties.js`) — единый источник правды для web- и
  static-редакторов; подписи кнопок берутся из `propIcon(prop, opt)`
  (статическая карта глифов `icons` или функция от типа блока), состояние
  — из `propActive(key, opt)`.
- E2E-тесты адресуют кнопки Align по атрибуту `title`
  (`.style-btn[title='center']`), поэтому замена текста на иконки
  безопасна: `title` остаётся.
- Ключевое ограничение — static-режим: редактор открывается через
  `file://`, сборщиков нет, JS/CSS — обычные файлы. Внешние `<img>`/`<svg>`
  из DOM-разметки и `fetch` не подходят (разметка генерируется строкой,
  `fetch` из `file://` блокируется). Рабочий механизм — **CSS-маска**:
  `mask: url("../icons/align-<opt>.svg")` + `background-color:
  currentColor`. `url()` в CSS разрешается относительно самого
  `editor.css`, который лежит в одном относительном месте в обоих
  режимах (`/static/css/` в web, `file://.../static/css/` в static) —
  один файл CSS работает в обоих. Маска наследует `currentColor`, так что
  иконка красится как глиф-кнопки: приглушённая → акцентная в активном
  состоянии, без отдельных цветовых правил.
- Проверено Playwright-скриптом (`tmp/check_align_icons.py`): в обоих
  режимах URL маски разрешается, SVG загружается (`<img>`-проба, т.к.
  `fetch` из `file://` не работает), `::before` имеет `background-color`
  из `currentColor` (активная — `rgb(233, 69, 96)`, неактивная —
  `rgb(136, 136, 136)`), текст кнопки пустой.

# Выполнение задачи

- `boxframe/static/icons/` — 6 новых SVG-иконок (24×24, `fill="#000"`,
  цвет не важен — маска берёт форму): `align-left.svg`,
  `align-center.svg`, `align-right.svg` (4 горизонтальные линии разной
  длины, выровненные влево/по центру/вправо) и `align-top.svg`,
  `align-middle.svg`, `align-bottom.svg` (3 линии, прижатые к
  верху/центру/низу).
- `boxframe/static/js/core/properties.js`:
  - новое поле схемы `iconPrefix` (описано в header-комментарии): кнопка
    показывает SVG-иконку вместо глифа — опция получает CSS-класс
    `style-btn--<iconPrefix>-<option>` (маска файла
    `static/icons/<iconPrefix>-<option>.svg`), текст кнопки пустой
    (`title` называет опцию);
  - `text_align`/`vertical_align` — `iconPrefix: "align"`.
  - `buildPropsPanelHTML()`: кнопки segmented/group-строк —
    `:class="styleBtnClasses(prop, opt)"` и
    `x-text="prop.iconPrefix ? '' : propIcon(prop, opt)"` (глиф-кнопки
    без `iconPrefix` не затронуты).
- `boxframe/static/js/editor.js`: метод `styleBtnClasses(prop, opt)` —
  `{ 'style-btn--active': propActive(...) }` + для `iconPrefix`-свойств
  `style-btn--icon` и `style-btn--<iconPrefix>-<opt>`.
- `boxframe/static/css/editor.css`: `.style-btn--icon::before`
  (16×16, `background-color: currentColor`) + 6 правил
  `.style-btn--align-<opt>::before` с `-webkit-mask`/`mask`
  (`url("../icons/align-<opt>.svg") center / contain no-repeat`).
- `tests/js/test_properties.js`: схема — `iconPrefix: "align"` у обоих
  свойств; markup — проверки `styleBtnClasses(...)` и
  `prop.iconPrefix ? '' : propIcon(...)` (адресация select-опций —
  `propIcon(row.prop, opt)`); новый тест `styleBtnClasses` (иконочные
  классы + глиф-свойство без `iconPrefix` сохраняет обычный биндинг).
- `tests/e2e/test_editor.py`: в `test_properties_panel_updates_alignment`
  добавлены проверки — 6 кнопок с `style-btn--icon`, по одной
  `style-btn--align-center` / `style-btn--align-middle`; адресация по
  `title` не менялась.

Всё выполнено, не получилось — ничего.

Приёмка: `node --test "tests/js/*.js"` — 271 pass;
`pytest tests/ --ignore=tests/e2e` — 195 passed; `pytest tests/e2e/` —
73 passed.

# Замечания

1. Именование иконок жёстко связано со схемой: класс кнопки
   `style-btn--<iconPrefix>-<opt>` обязан совпадать с именем файла
   `static/icons/<iconPrefix>-<opt>.svg` и с CSS-правилом маски. При
   добавлении нового `iconPrefix`-свойства нужны три вещи: файл SVG,
   CSS-правило маски, запись в схему — иначе кнопка будет пустой (текст
   скрыт, маски нет).
2. `propIcon` для `iconPrefix`-свойств не вызывается (текст пустой) —
   поле `icons` у таких свойств не нужно и не используется.
3. E2E-адресация кнопок Align — по `title` (значение опции); иконочные
   классы (`style-btn--align-*`) проверяются отдельно. При смене
   `iconPrefix` сломаются CSS-маски и e2e-проверки классов, но не
   клики.
4. Одноразовый скрипт проверки — `tmp/check_align_icons.py` (вне git,
   `tmp/` в `.gitignore`); создаёт временный проект через API и удаляет
   его, для static-режима использует `file://`-URL страницы редактора.
5. Маска — не `<img>`: иконка не имеет собственного цвета и масштабируется
   `contain` в 16×16; при желании изменить размер — править
   `.style-btn--icon::before` (одна точка).
