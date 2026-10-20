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
  `file://`, сборщиков нет, JS/CSS — обычные файлы. `fetch` из `file://`
  блокируется. Рабочий механизм окраски — **CSS-маска** +
  `background-color: currentColor` (иконка красится как глиф-кнопки:
  приглушённая → акцентная в активном состоянии, без отдельных цветовых
  правил). Чистый `<img>` не подходит: его нельзя перекрасить в
  `currentColor` (иконки `fill="#000"` были бы невидимы на тёмной панели).
- **file:// CORS (найден в работе пользователя):** `file://`-страница —
  opaque origin (`null`). В некоторых конфигурациях Chrome
  file://-изображения как CSS-subresource (маска) блокируются по CORS,
  при этом `<img src="file://…">` при этом **проходит**. Это разбило
  fallback: `<img>`-проба в `editor.js` прошла → текст скрыт
  (`font-size: 0`), а маска упала → по спецификации несуществующая маска
  = полностью прозрачная → `::before` невидим. Итог: **пустая кнопка**
  (ни текста, ни иконки). Мой `tmp`-скрипт этого не поймал: в тестовом
  Chromium оба механизма работали.
- Решение — **data:-URI**: SVG встроены в CSS-маску как
  `mask: url("data:image/svg+xml,…")`. `data:` есть в списке разрешённых
  схем (он прямо в сообщении об ошибке), cross-origin-запроса не
  возникает вообще → маска работает из `file://` в любой конфигурации,
  окраска `currentColor` сохраняется, дивергенция «проба/маска»
  исчезает (маска больше не зависит от загрузки файла). Канонические
  иконки — `static/icons/align-*.svg`; data-URI регенерируются
  `tmp/gen_icon_datauris.py`.
- Побочный баг, пойманный при переходе на data-URI: вычисленная маска
  `url("data:…xmlns='…'…")` содержит **одинарные кавычки** (атрибуты SVG
  перекодированы в `'`), и regex `maskUrlFromComputed` `[^"')]+`
  обрывался на первой `'` → URL обрезался → `<img>` не грузился → класс
  не ставился. Regex переписан: сначала двойные кавычки, потом
  одинарные, потом без кавычек.
- Проверено Playwright-скриптом (`tmp/check_align_icons.py`): в обоих
  режимах вычисленная маска — data:-URI, класс `align-icons-ok` стоит,
  `::before` имеет `content` + `currentColor`, текст скрыт (0px), и
  **0 file://-запросов к иконкам** (запросы страницы отслеживаются).

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
    источником маски), затем `<img>`-проба; при успехе на корень
    редактора ставится класс `align-icons-ok`, при неудаче — кнопки
    сохраняют текст. С data:-URI проба теперь только страхует браузеры
    без поддержки CSS-масок (computed-маска `none` → класс не ставится);
  - `maskUrlFromComputed(mask)` — чистый хелпер (извлечение URL из
    computed-значения маски), покрыт юнит-тестом. Переписан под
    data:-URI: сначала двойные кавычки, потом одинарные, потом без
    кавычек (URL может содержать кавычки другого типа).
- `boxframe/static/css/editor.css`:
  - `.align-icons-ok .style-btn--icon { font-size: 0 }` — fallback-текст
    скрыт только после подтверждения;
  - `.align-icons-ok .style-btn--icon::before` (16×16,
    `background-color: currentColor`) — `content` есть только с классом,
    поэтому до подтверждения ничего не рендерится;
  - 6 правил `.style-btn--align-<opt>::before` с `-webkit-mask`/`mask` —
    **data:-URI** (`url("data:image/svg+xml,…") center / contain
    no-repeat`), НЕ file-ссылки (см. Исследование: file:// CORS). НЕ
    завязаны на класс: computed-URL читает `_verifyAlignIcons`.
- `boxframe/static/icons/align-*.svg` — канонические иконки (источник
  для data-URI); `tmp/gen_icon_datauris.py` регенерирует CSS-правила.
- `tests/js/test_properties.js`: схема — `iconPrefix: "align"` у обоих
  свойств; markup — проверки `styleBtnClasses(...)` и
  `x-text="propIcon(...)"`; тесты `styleBtnClasses` (иконочные классы +
  глиф-свойство без `iconPrefix` сохраняет обычный биндинг) и
  `maskUrlFromComputed` (quoted/bare URL, data:-URI с кавычками внутри,
  `none`/пусто → null).
- `tests/e2e/test_editor.py`: в `test_properties_panel_updates_alignment`
  и `test_static_editor_panel_matches_web_layout` — проверки иконочных
  классов (6 × `style-btn--icon`, по одному `style-btn--align-center` /
  `--align-middle`) и класса `align-icons-ok` на корне (иконки
  загрузились); адресация кнопок по `title` не менялась.

Всё выполнено, не получилось — ничего.

Приёмка: `node --test "tests/js/*.js"` — 272 pass;
`pytest tests/ --ignore=tests/e2e` — 195 passed; `pytest tests/e2e/` —
73 passed. `tmp/check_align_icons.py` (web + static `file://`): маска —
data:-URI, класс `align-icons-ok` стоит, текст скрыт, 0 file://-запросов
к иконкам.

# Замечания

1. Именование иконок жёстко связано со схемой: класс кнопки
   `style-btn--<iconPrefix>-<opt>` обязан совпадать с именем файла
   `static/icons/<iconPrefix>-<opt>.svg` и с CSS-правилом маски. При
   добавлении нового `iconPrefix`-свойства нужны: файл SVG, data:-URI в
   CSS (сгенерировать `tmp/gen_icon_datauris.py`), запись в схему —
   иначе иконка не появится, но кнопка покажет fallback-текст (не
   сломается).
2. `propIcon` для `iconPrefix`-свойств даёт fallback-текст (опция сама —
   `left`/`center`/…); поле `icons` у таких свойств не нужно. Fallback
   виден только до/без подтверждения маски — в норме его не видно
   (`font-size: 0`), но он остаётся в DOM (доступен скринридерам и
   e2e-адресации).
3. E2E-адресация кнопок Align — по `title` (значение опции); иконочные
   классы (`style-btn--align-*`) и класс `align-icons-ok` на корне
   проверяются отдельно. При смене `iconPrefix` сломаются CSS-маски и
   e2e-проверки классов, но не клики.
4. Одноразочные скрипты (вне git, `tmp/` в `.gitignore`):
   `tmp/check_align_icons.py` — проверка web + static `file://` (маска
   data:-URI, класс, 0 file://-запросов к иконкам); `tmp/
   gen_icon_datauris.py` — регенерация CSS-правил из `static/icons/`.
5. Маска — не `<img>`: иконка не имеет собственного цвета и масштабируется
   `contain` в 16×16; при желании изменить размер — править
   `.align-icons-ok .style-btn--icon::before` (одна точка).
6. `_verifyAlignIcons` гоняет одну `<img>`-пробу (align-left) при
   инициализации. С data:-URI файл не грузится, поэтому проба лишь
   проверяет поддержку CSS-масок; состояние `align-icons-ok` на время
   жизни страницы.
7. **Почему data:-URI, а не file-ссылки:** file://-страница — opaque
   origin, и некоторые Chrome блокируют file://-изображения как
   CSS-subresource по CORS (при этом `<img>` проходит) — это давало
   пустые кнопки (текст скрыт, маска прозрачна). `data:` в списке
   разрешённых схем, cross-origin-запроса нет. Держать file-ссылки
   «ради чистоты» нельзя: статик-режим обязан работать из `file://`
   без флага `--allow-file-access-from-files`.
