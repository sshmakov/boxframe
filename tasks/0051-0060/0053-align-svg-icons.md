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
- [x] Fallback: текст опции остаётся в кнопке и виден, пока SVG-маска не
      подтверждена как загруженная (класс `align-icons-ok`)
- [x] Проверить fallback с заблокированными SVG (Playwright, page.route)

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
  `rgb(136, 136, 136)`).
- RISK: `file://` — opaque origin; в браузерах/конфигах с ограниченным
  доступом к локальным subresource'ам (enterprise-политики, исторически
  капризный Safari) загрузка SVG-маски может не произойти. CSS не может
  узнать об этом (сломанная маска = пустая/квадратная кнопка), поэтому
  нужен JS-fallback: текст опции остаётся в кнопке и скрывается только
  после успешной `<img>`-пробы маски (класс `align-icons-ok`).

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
    `static/icons/<iconPrefix>-<option>.svg`); текст опции остаётся в
    кнопке как fallback (`title` называет опцию);
  - `text_align`/`vertical_align` — `iconPrefix: "align"`.
  - `buildPropsPanelHTML()`: кнопки segmented/group-строк —
    `:class="styleBtnClasses(prop, opt)"` и `x-text="propIcon(...)"`
    (текст всегда рендерится; скрывает его CSS только после
    подтверждения загрузки маски).
- `boxframe/static/js/editor.js`:
  - метод `styleBtnClasses(prop, opt)` — `{ 'style-btn--active':
    propActive(...) }` + для `iconPrefix`-свойств `style-btn--icon` и
    `style-btn--<iconPrefix>-<opt>`;
  - `_verifyAlignIcons()` (вызов в `init()`): URL маски читается из
    computed `::before` одноразовой кнопки (CSS остаётся единственным
    источником пути — он разрешается по-разному в web и static
    режимах), затем `<img>`-проба; при успехе на корень редактора
    ставится класс `align-icons-ok`, при неудаче — кнопки сохраняют
    текст;
  - `maskUrlFromComputed(mask)` — чистый хелпер (извлечение URL из
    computed-значения маски), покрыт юнит-тестом.
- `boxframe/static/css/editor.css`:
  - `.align-icons-ok .style-btn--icon { font-size: 0 }` — fallback-текст
    скрыт только после подтверждения;
  - `.align-icons-ok .style-btn--icon::before` (16×16,
    `background-color: currentColor`) — `content` есть только с классом,
    поэтому до подтверждения (и при сбитой маске) ничего не
    рендерится — не появляется сплошной квадрат;
  - 6 правил `.style-btn--align-<opt>::before` с `-webkit-mask`/`mask`
    (`url("../icons/align-<opt>.svg") center / contain no-repeat`) — НЕ
    завязаны на класс: computed-URL читает `_verifyAlignIcons`.
- `tests/js/test_properties.js`: схема — `iconPrefix: "align"` у обоих
  свойств; markup — проверки `styleBtnClasses(...)` и
  `x-text="propIcon(...)"`; тесты `styleBtnClasses` (иконочные классы +
  глиф-свойство без `iconPrefix` сохраняет обычный биндинг) и
  `maskUrlFromComputed` (quoted/bare URL, `none`/пусто → null).
- `tests/e2e/test_editor.py`: в `test_properties_panel_updates_alignment`
  и `test_static_editor_panel_matches_web_layout` — проверки иконочных
  классов (6 × `style-btn--icon`, по одному `style-btn--align-center` /
  `--align-middle`) и класса `align-icons-ok` на корне (иконки
  загрузились); адресация кнопок по `title` не менялась.

Всё выполнено, не получилось — ничего.

Приёмка: `node --test "tests/js/*.js"` — 272 pass;
`pytest tests/ --ignore=tests/e2e` — 195 passed; `pytest tests/e2e/` —
73 passed. Фолбэк-сценарий (SVG заблокированы `page.route`) проверен
`tmp/check_align_icons.py`: класс не ставится, `::before` без
`content`, текст опции виден (13px).

# Замечания

1. Именование иконок жёстко связано со схемой: класс кнопки
   `style-btn--<iconPrefix>-<opt>` обязан совпадать с именем файла
   `static/icons/<iconPrefix>-<opt>.svg` и с CSS-правилом маски. При
   добавлении нового `iconPrefix`-свойства нужны три вещи: файл SVG,
   CSS-правило маски, запись в схему — иначе иконка не появится, но
   кнопка покажет fallback-текст (не сломается).
2. `propIcon` для `iconPrefix`-свойств даёт fallback-текст (опция сама —
   `left`/`center`/…); поле `icons` у таких свойств не нужно. Fallback
   виден только до/без подтверждения маски — в норме его не видно
   (`font-size: 0`), но он остаётся в DOM (доступен скринридерам и
   e2e-адресации).
3. E2E-адресация кнопок Align — по `title` (значение опции); иконочные
   классы (`style-btn--align-*`) и класс `align-icons-ok` на корне
   проверяются отдельно. При смене `iconPrefix` сломаются CSS-маски и
   e2e-проверки классов, но не клики.
4. Одноразовый скрипт проверки — `tmp/check_align_icons.py` (вне git,
   `tmp/` в `.gitignore`); создаёт временный проект через API и удаляет
   его, для static-режима использует `file://`-URL страницы редактора,
   для fallback-сценария блокирует SVG через `page.route`.
5. Маска — не `<img>`: иконка не имеет собственного цвета и масштабируется
   `contain` в 16×16; при желании изменить размер — править
   `.align-icons-ok .style-btn--icon::before` (одна точка).
6. `_verifyAlignIcons` гоняет одну `<img>`-пробу (align-left) при
   инициализации: если файл есть, то вся папка иконок доступна (один
   каталог, один механизм загрузки). Проба не повторяется — состояние
   `align-icons-ok` на время жизни страницы.
