> **Удалено (2026-10-16): per-side границы.** Фаза 1 (`meta.border_h` /
> `meta.border_v` — разные стили горизонтальных и вертикальных сторон)
> **отменена без обратной совместимости**: ключи `border_h`/`border_v`
> больше не читаются рендерером, панелью и CSS-оверлеем; секция «Borders»
> убрана. Рамка блока определяется единственным `border_style` (как до
> фазы 1). Существующие макеты, содержащие `meta.border_h`/`border_v`,
> рендерятся по `border_style` — старые ключи игнорируются. Ниже в тексте
> описания фазы 1 помечены как отменённые.

# Суть проблемы

Панель свойств — плоская 2-колоночная сетка (действия, Line Style, X/Y/W/H,
Order, Content), одинаковая для всех 14 типов блоков. В ней невозможно
выразить свойства, которые естественно живут в псевдографике:

- заполнение внутренней области (fill) символом;
- выравнивание текста по горизонтали и вертикали;
- стрелки на концах линий (`hline`/`vline`).

При этом у модели `Block` уже есть свободная JSON-колонка `meta`, которая
проходит через Pydantic-схемы API, экспорт и импорт, но рендерер её не
использует. То есть точка расширения готова — не хватает (1) семантики
свойств, (2) поддержки в рендерере (Python + JS-порт + parity) и (3)
масштабируемой панели, в которую новые свойства можно добавлять, не правя
шаблон под каждое из них.

# Задача

Расширить формат псевдографики новыми свойствами блоков и реорганизовать
панель свойств в секционную, генерируемую из декларативной схемы.

Жёсткое ограничение: **всё новое должно быть представимо в
псевдографике** (ядро продукта — AI-readable формат). Свойство, которое
теряется при экспорте в ASCII, в формат не входит.

Поведение должно быть одинаковым в web-режиме (API) и static-режиме
(JS-стор) — инвариант parity проекта. Значения по умолчанию сохраняют
текущий рендер побайтово (регрессий нет).

## Модель данных

Все новые свойства — в `meta` JSON (без миграции). Рамка блока задаётся
единой колонкой `border_style` (все стороны одинаково); `meta` несёт
новые свойства (fill, выравнивание, стрелки).

| Поле | Тип | Значения | Дефолт | Хранение |
|---|---|---|---|---|
| `fill` | str | `░ ▒ ▓ █ · ×` | отсутствует (none) | `meta.fill` |
| `text_align` | str | `left / center / right` | `left` | `meta.text_align` |
| `vertical_align` | str | `top / middle / bottom` | `top` | `meta.vertical_align` |
| `arrow_start` | str | `none / arrow / arrow-open / diamond / diamond-open / circle / circle-open` | `none` | `meta.arrow_start` |
| `arrow_end` | str | `none / arrow / arrow-open / diamond / diamond-open / circle / circle-open` | `none` | `meta.arrow_end` |

Свободный ввод символов **не** поддерживается: `fill` — фиксированный
набор, стрелки — enum. Валидация тривиальна, панель — char-picker /
segmented-кнопки.

## Свойства и семантика

### Fill (`fill`)

Один символ, ровно 1 клетка (широкие символы запрещены — жёсткое
ограничение моноширинной сетки).

- Заполняет внутреннюю (content) область блока.
- Контент рисуется **поверх** fill (контент выигрывает).
- При наличии fill подсказка `[type]` подавляется.
- Для блока без рамки fill-область = вся область блока.

### Выравнивание текста (`text_align` / `vertical_align`)

- `text_align`: `left / center / right` — горизонтальное выравнивание
  каждой перенесённой строки внутри content-области.
- `vertical_align`: `top / middle / bottom` — вертикальное выравнивание
  блока перенесённых строк внутри content-области.
- «Жирный»/«курсив» в формат **не** входят — не представимы в ASCII.
- Для `button` — `text_align` управляет горизонтальным выравниванием label
  (вертикаль у label уже center).

### Стрелки (`arrow_start` / `arrow_end`)

Enum из 6 форм наконечника на каждый конец (дефолт `none`), только
`hline`/`vline`.

| type  | конец       | `arrow` | `arrow-open` | `diamond` | `diamond-open` | `circle` | `circle-open` |
|-------|-------------|---------|--------------|-----------|----------------|----------|---------------|
| hline | arrow_start | `◀`     | `◁`          | `◆`       | `◇`            | `●`      | `○`           |
| hline | arrow_end   | `▶`     | `▷`          | `◆`       | `◇`            | `●`      | `○`           |
| vline | arrow_start | `▲`     | `△`          | `◆`       | `◇`            | `●`      | `○`           |
| vline | arrow_end   | `▼`     | `▽`          | `◆`       | `◇`            | `●`      | `○`           |

- Стрелка = замена крайнего символа линии.
- Линия короче 2 клеток — стрелки игнорируются.

## Правила рендера

### Fill (`_draw_content`)

Порядок в content-области:

1. Если `fill` задан — заполнить content-область символом fill.
2. Если есть контент — перенести и нарисовать поверх (контент выигрывает).
3. Если контента нет **и** fill нет — подсказка `[type]` (как сейчас).
4. Если контента нет, но fill есть — подсказка не рисуется.

### Выравнивание (`_draw_content`)

- Сначала перенос (как сейчас, `_wrap_text`), затем:
  - горизонталь: каждая строка выравнивается в `content_w`
    (left — как есть, center/right — отступы пробелами);
  - вертикаль: блок строк выравнивается в `content_h`
    (top — как есть, middle/bottom — пустые строки сверху/снизу).
- Дефолты `left`/`top` дают текущий вывод.

### Стрелки (`_draw_line`)

- После рисования линии символом стиля заменить крайний символ:
  - hline: первый символ → `arrow_start`, последний → `arrow_end`;
  - vline: верхний → `arrow_start`, нижний → `arrow_end`.
- `none` — без замены; одна из 6 форм — символ из таблицы выше.
- Длина линии < 2 — стрелки не рисуются.

## Матрица применимости

| Свойство | Типы |
|---|---|
| `fill` | `box, header, footer, sidebar, content, grid, image` |
| `text_align` / `vertical_align` | все, кроме `hline`, `vline` |
| `arrow_start` / `arrow_end` | `hline`, `vline` |

## Панель свойств (фаза 0)

Оставляем всплывающую панель (рядом с выделением), но содержимое генерируем
из декларативной схемы, а не хардкодим в шаблоне.

### Схема свойств (`core/properties.js`)

Массив дескрипторов; панель и (опционально) валидация строятся из неё:

```js
{
  key: "fill",            // ключ данных
  meta: true,             // true → block.meta[key], false → block[key]
  label: "Fill",
  kind: "charpicker",     // number | segmented | select | charpicker | text
  options: FILL_CHARS,    // для segmented/select/charpicker
  group: "Fill",          // имя секции
  types: ["box", ...],    // применимые block_type; опущено = все
  default: null,          // значение при отсутствии (null = inherit/none)
  min: 0, max: 100        // для number
}
```

Секции = уникальные `group` в порядке объявления. Контрол по `kind`:
`number` → `<input type=number>`, `segmented`/`select` → кнопки/селект,
`charpicker` → набор символьных кнопок, `text` → `<input type=text>`.

Текущие свойства описываются в схеме первыми (проверка подхода):
`border_style` (segmented, Style), `x/y/width/height` (number, Geometry),
`order` (number, Geometry), `content` (text, Text).

### Генератор секций

- Панель группирует свойства по `group`; каждая группа — свёрнутая/открытая
  секция с заголовком.
- Секции показываются по типу блока: группа видна, если хотя бы одно её
  свойство применимо к типу выделенного блока (по `types`).
- Состояние открытости секций живёт в состоянии Alpine-компонента (ключ —
  имя секции) и **персистится в localStorage** (выбор пользователя
  переживает смену выделения и перезагрузку). Новые секции по умолчанию
  свёрнуты.

### Multi-selection

- Значение свойства для выделения: если у всех выделенных блоков значения
  совпадают — показываем его; иначе — «mixed» (`—`).
- Изменение применяется ко **всем** выделенным блокам (одна batch-операция,
  один шаг undo).
- Для `mixed` активное состояние контрола не подсвечивается.

### Позиционирование и скролл

- Ширина панели 264px (как сейчас), добавляется `max-height` + внутренний
  скролл по вертикали.
- `propsPanelStyle`: убрать захардкоженный `panelH = 300` (клампинг по
  высоте) — заменить на реальную высоту панели (или клампить по
  `max-height`).

### Унификация маркапа

Маркап панели продублирован в `templates/pages/editor.html` и
`static/editor/index.html`. Генератор секций из схемы должен дать **один**
источник правды для обоих редакторов (web и static).

## Фазы

Каждая фаза самодостаточна: запись в схеме + поддержка в рендерере
(`services/renderer.py` **и** `static/js/core/renderer.js`) + тесты в обоих
наборах + parity.

- **Фаза 0 — инфраструктура.** Схема `core/properties.js`, генератор
  секций, mixed-отображение, max-height/скролл, унификация web/static
  маркапа. Без новых свойств — только реорганизация текущих.
- ~~**Фаза 1 — per-side границы.** `border_h`/`border_v`, правило углов,
  оверлей CSS (outline → per-side border).~~ **Отменена (2026-10-16)
  без обратной совместимости** — см. заметку в начале документа.
- **Фаза 2 — fill.** `fill`, char-picker, рендер fill+контент.
- **Фаза 3 — стрелки + выравнивание.** `arrow_start`/`arrow_end`,
  `text_align`/`vertical_align`.

## Критерии приёмки

- Новые свойства сохраняются в `meta`, проходят через create/update/batch,
  экспорт JSON (включая `metadata`) и импорт (`parseLayoutJson`).
- Рендер Python и JS-порта совпадает побайтово (parity-тесты).
- Значения по умолчанию дают вывод, идентичный текущему (регрессий нет).
- Панель: секции по типу блока, mixed для multi-selection, состояние
  секций в localStorage, внутренний скролл.
- `hline`/`vline` — только стрелки; рамка всех блоков — единый
  `border_style` (per-side границы отменены).
- `pytest tests/ --ignore=tests/e2e` и `node --test "tests/js/*.js"` —
  зелёные.

# План работ

- [x] Составить план работ
- [x] Фаза 0: `core/properties.js` (схема, включая текущие свойства)
- [x] Фаза 0: генератор секций панели (группировка, видимость по типу,
      контролы по `kind`)
- [x] Фаза 0: mixed-отображение для multi-selection
- [x] Фаза 0: max-height + внутренний скролл, убрать `panelH = 300`
- [x] Фаза 0: унификация маркапа web/static-редакторов
- [x] Фаза 0: персист состояния секций в localStorage
- [x] Фаза 0: e2e-тесты обновлены под секционный маркап
- [ ] ~~Фаза 1: `meta` в `RenderBlock` + эффективные стили (Python)~~
- [ ] ~~Фаза 1: `_draw_border` per-side + правило углов (Python)~~
- [ ] ~~Фаза 1: порт per-side borders в `core/renderer.js`~~
- [ ] ~~Фаза 1: оверлей CSS (per-side border вместо outline)~~
- [ ] ~~Фаза 1: тесты (test_renderer.py, js/test_renderer.js, parity)~~
- [x] Фаза 1 отменена (2026-10-16): per-side границы удалены без
      обратной совместимости (рендерер Python/JS, панель, CSS, тесты)
- [x] Фаза 2: fill в `_draw_content` (Python) + порт в JS
- [x] Фаза 2: char-picker в схеме, подавление подсказки
- [x] Фаза 2: тесты (Python + JS + parity)
- [x] Фаза 3: стрелки в `_draw_line` (Python) + порт в JS
- [x] Фаза 3: выравнивание в `_draw_content` (Python) + порт в JS
- [x] Фаза 3: тесты (Python + JS + parity)
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`

# Исследование

1. **`meta` — готовая точка расширения.** Колонка `meta` (JSON) уже
   проходит через `LayoutService.create_block`/`batch_blocks`, Pydantic-
   схемы API (`meta: dict`), экспорт (`"metadata": b.meta`) и импорт
   (`parseLayoutJson` читает `b.metadata`/`b.meta`). Миграция не нужна.
2. **Рендер — два слоя.** Канвас = ASCII-арт (текстовый слой) +
   полупрозрачный CSS-оверлей (`.block-border--{style}` на `outline`).
   Всё, что попадает в ASCII (fill, стрелки, выравнивание), автоматически
   видно через оверлей; оверлей повторяет единый стиль рамки блока.
3. **Углы.** В текущем `BORDERS`-мапе solid/dashed/dotted делят углы
   `┌┐└┘` (отличается только `double` — `╔╗╚╝`); рамка блока всегда
   рисуется одним стилем, смешанных углов нет.
4. **`_draw_border`** использует одну карту символов на все 4 стороны
   (единый `border_style`). `_draw_content` пишет контент сверху — fill
   вставляется прогонкой **до** контента. `_draw_line` рисует линию одним
   символом — стрелки = замена крайних символов.
5. **`button`** имеет особую логику (`_draw_button`, формы по высоте).
   **`divider`** сейчас рендерится как обычный box (без особой обработки) —
   его переклассификация открыта и не блокирует остальные свойства.
6. **`text_block_size`** (autosize text-блока) размер не меняет от
   выравнивания и fill (padding внутренний) — конфликтов нет.

# Выполнение задачи

## Фаза 0 (2026-10-01, ветка `feature/extprops`)

- `boxframe/static/js/core/properties.js` — декларативная схема
  `PROPERTY_SCHEMA` (текущие свойства: `border_style` — segmented, секция
  Style; `x/y/width/height/order` — number, секция Geometry; `content` —
  text, секция Text), `sectionsForType()` (секции = уникальные `group` в
  порядке объявления, отфильтрованные по `types`), `buildPropsPanelHTML()`
  (маркап тела панели из схемы), `readPropValue()` (meta-свойства —
  `block.meta[key]`, остальные — `block[key]`).
- Панель: секции Style/Geometry/Text, свёрнуты по умолчанию; состояние
  открытости персистится в localStorage (ключ `boxframe.props.sections`) —
  переживает смену выделения и перезагрузку.
- Multi-selection: расходящиеся значения — «mixed» (placeholder `—`,
  подсветка активного состояния не ставится); изменение применяется ко всем
  выделенным блокам одной batch-операцией (один шаг undo).
- `propsPanelStyle`: захардкоженный `panelH = 300` убран — клампинг по
  реальной высоте панели; `.block-props__body` — `max-height` + внутренний
  вертикальный скролл.
- Унификация маркапа: оба редактора (web — `templates/pages/editor.html`,
  static — `static/editor/index.html`) рендерят тело панели через
  `x-html="propsPanelHTML"` из одного генератора.
- Реализационная деталь: Alpine `x-for`/`x-if` клонирует только ПЕРВОГО
  element-детёныша контента `<template>` — ветки по `kind` обёрнуты в
  единый корень `.prop-cell` (`display: contents`, чтобы внутренний
  контрол остался grid-элементом). Детали — в Замечаниях.
- e2e-тесты (`tests/e2e/test_editor.py`): 7 тестов обновлены под секционный
  маркап (хелпер `_open_section`, порядок секций Style/Geometry/Text,
  сетка Geometry 2×2+1, mixed-заголовок «N selected»).

Приёмка: `pytest tests/ --ignore=tests/e2e` — 151 passed,
`node --test "tests/js/*.js"` — 233 pass, `pytest tests/e2e/` — 70 passed
(регрессий нет: рендерер не тронут, вывод побайтово как до фазы 0).

## Фаза 2 (2026-10-02, ветка `feature/extprops`)

- `services/renderer.py`: `FILL_TYPES` (box, header, footer, sidebar,
  content, grid, image) + `fill_char(block_type, meta)` — meta.fill ровно
  1 клетка (широкие символы запрещены — ломают моноширинную сетку);
  `_draw_content` закрашивает content-область fill **до** контента
  (контент выигрывает), подавляет подсказку `[type]`; блок без рамки
  заливает всю область; fill-область учитывает inset рамки (1 клетка при
  `border_style` ≠ none).
- `core/renderer.js`: порт `fillChar()` + fill в `drawContent`
  (побайтовый parity, экспорт `fillChar`).
- `core/properties.js`: свойство `fill` — charpicker `░ ▒ ▓ █ · × ␣` + ∅
  (none), секция «Fill» (после «Style»), `types` по матрице,
  `default: "none"` (∅ подсвечен, когда fill отсутствует),
  `noneValue: null` — опция «none» — display-сентинел: применение
  удаляет ключ meta.fill.
- **Fill пробелом (␣).** `meta.fill=" "` — реальный fill-символ (не
  сентинел): сетка инициализируется пробелами, поэтому blank-fill
  **затирает блок снизу** (show-through) — нижний контент перестаёт
  просвечивать через пустой верхний блок. Рендерер менять не пришлось:
  `fill_char`/`fillChar` принимает любой одиночный символ, включая
  пробел; в схеме кнопка показывает глиф `␣` (чистый пробел был бы
  невидим), `title=" "`.
- `editor.js`: `onPropSelect` — `opt === "none" && prop.noneValue !==
  undefined` → применить `noneValue` (null = очистить ключ).
- Тесты: 11 в test_renderer.py + 11 в js/test_renderer.js (fill_char,
  пустой блок, подавление подсказки, контент поверх fill, перенос,
  без рамки, inset рамки, матрица неприменимых типов, невалидные
  значения, image, контейнер с детьми, **fill пробелом затирает блок
  снизу (show-through)**), 3 parity (23 кейса + контейнер + show-through),
  1 API (meta.fill через create/update/batch/export), e2e: порядок
  секций Style/Fill/Geometry/Text + fill-пикер (символ →
  meta.fill, ∅ → очистка, ␣ → meta.fill=" ").
- Нюанс: wrap сохраняет хвостовой пробел перенесённой строки (пробелы —
  форматирование) — он рисуется поверх fill как любая клетка контента
  (зафиксировано в тестах; rstrip-поведение не введено).

Приёмка: `pytest tests/ --ignore=tests/e2e` — 188 passed,
`node --test "tests/js/*.js"` — 261 pass, `pytest tests/e2e/` — 71 passed
(регрессий нет: дефолтные значения рендерятся побайтово как до фазы 2).

## Фаза 3 (2026-10-02, ветка `feature/extprops`)

- `services/renderer.py`:
  - **Стрелки.** `ARROW_GLYPHS` — 6 форм наконечника на направление
    (hline: `◀▶ ◁▷ ◆◇ ●○`, vline: `▲▼ △▽ ◆◇ ●○`; значения `arrow,
    arrow-open, diamond, diamond-open, circle, circle-open`) +
    `arrow_glyph(block_type, value, end)`. `_draw_line` после рисования
    линии символом стиля заменяет крайние клетки: первый/верхний →
    `meta.arrow_start`, последний/нижний → `meta.arrow_end`; длина < 2 —
    стрелки не рисуются; невалидные значения и не-линии — без изменений.
  - **Выравнивание.** `h_align_offset(line_len, width, align)`
    (left/None → 0, center → `gap//2`, right → `gap`; `gap <= 0` → 0) и
    `v_align_offset(n_lines, height, valign)` (top/None → 0, middle →
    `(h-n)//2`, bottom → `h-n`; overflow → 0). `_draw_content`: после
    `_wrap_text` блок строк сдвигается на `v_off` сверху, каждая строка —
    на `off` слева; пишутся только собственные клетки строки (fill /
    show-through не трогаются). `_draw_button`: label сдвигается
    `text_align` в `inner_w` (вертикаль у label уже center —
    `vertical_align` для button no-op).
- `core/renderer.js`: побайтовый порт — `ARROW_GLYPHS`, `arrowGlyph()`,
  `hAlignOffset()`, `vAlignOffset()` (Math.floor/Math.max), стрелки в
  `drawLine`, выравнивание в `drawContent`, label-сдвиг в `drawButton`;
  экспорт в `PGRenderer`.
- `core/properties.js`:
  - `text_align` (segmented left/center/right, секция «Align»,
    `default: "left"`, `clearDefault: true`) — все типы, кроме линий;
    `vertical_align` (top/middle/bottom, `default: "top"`,
    `clearDefault: true`) — те же типы.
  - `arrow_start`/`arrow_end` (segmented none + 6 форм, секция
    «Arrows», `types: ["hline", "vline"]`, `default: "none"`,
    `noneValue: null`); `icons` — **функция** `(blockType, opt)`: глифы
    зависят от направления линии (hline ∅/◀/▶/◆/◇/●/○,
    vline ∅/▲/▼/◆/◇/●/○).
- `editor.js`: `propIcon(prop, opt)` — статичная карта `icons` или
  функция `(selectedBlock.block_type, opt)`; `onPropSelect`:
  `prop.clearDefault && opt === prop.default` → применить `null`
  (очистить meta-ключ — дефолт неявный).
- Тесты: 15 в test_renderer.py (arrow_glyph — 6 форм × 2 направления,
  оба конца, все 6 форм hline/vline, один конец, короткая линия, ровно 2
  клетки, все стили, не-линии, невалидные (включая legacy `double`);
  h/v_align_offset, center/right, дефолт left без изменений, перенос,
  middle/bottom, overflow, fill+align, линии игнорируют, button label
  left/center/right) + зеркала в js/test_renderer.js;
  2 parity (25 кейсов: стрелки + выравнивание); 1 API (arrow/align через
  create/update/batch/export); `test_properties.js` — 12 ключей схемы,
  секции box (5: Style/Fill/Align/Geometry/Text) и hline
  (Style/Arrows/Geometry/Text), clearDefault, типозависимые иконки; e2e:
  порядок секций Style/Fill/Align/Geometry/Text +
  `test_properties_panel_updates_alignment` (center → meta.text_align,
  middle → meta.vertical_align, выбор дефолта left → очистка ключа) +
  `test_properties_panel_updates_arrows` (arrow → arrow_start, diamond →
  arrow_end, ∅ → очистка).
- **Смена глифов стрелок (2026-10-02).** Набор `none/arrow/double`
  (`←→ ↔`, `↑↓ ↕`) заменён на 6 форм наконечника: `arrow` (◀▶ ▲▼),
  `arrow-open` (◁▷ △▽), `diamond` (◆), `diamond-open` (◇), `circle` (●),
  `circle-open` (○) — таблица в разделе «Стрелки». Legacy-значение
  `double` стало невалидным (стрелка не рисуется).

Приёмка: `pytest tests/ --ignore=tests/e2e` — 214 passed,
`node --test "tests/js/*.js"` — 286 pass, `pytest tests/e2e/` — 73 passed
(регрессий нет: дефолты left/top/none рендерятся побайтово как до фазы 3).

# Замечания

1. **Per-side границы отменены (2026-10-16).** Фаза 1 (`meta.border_h` /
   `meta.border_v`) удалена без обратной совместимости: рендерер (Python и
   JS), панель свойств и CSS-оверлей снова используют единый
   `border_style` на все стороны. Ключи `border_h`/`border_v` в старых
   макетах игнорируются. Вопрос «визуального компромисса угла» и
   «кромок без углов» (бывшие пункты 1, 8, 9) снят.
2. **`divider` открыт.** Сейчас — box с рамкой. Варианты: оставить как есть
   (стрелки не применяются) или сделать линией (тогда применяются стрелки
   и стили линий, меняется существующий вывод). Не блокирует фазы 0–3.
3. **Продвижение в колонки.** Все новые свойства живут в `meta`. Если
   набор стабилизируется, «доказавшие себя» свойства можно вынести в
   отдельные колонки миграционным шагом — или оставить в `meta` (она
   видна в JSON-экспорте и машиночитаемы).
4. **Схема как единый источник правды.** `core/properties.js` — источник
   для панели обоих редакторов. При добавлении нового свойства: запись в
   схеме + поддержка в рендерере (Python + JS) + тесты + parity — шаблон
   править не нужно.
5. **Ограничение «1 клетка».** Fill и стрелки — ровно 1 клетка. Широкие
   символы (эмодзи и т.п.) запрещены — это жёсткое ограничение
   моноширинной сетки, валидация на входе.
6. **Alpine: `x-for`/`x-if` клонируют только первого детёныша.** Оба
   директива инстанцируют только ПЕРВОГО element-детёныша контента
   `<template>` (`importNode(content, true).firstElementChild` /
   `cloneNode(true).firstElementChild`). Несколько соседних
   `<template x-if>`-веток внутри `x-for`-шаблона **не отрисуются** —
   у каждой итерации должен быть единый корень (в панели — `.prop-cell`
   с `display: contents`). Учитывать при добавлении новых `kind` в схему.
7. **Баг API (найден при smoke-проверке фазы 0, не исправлен).**
   `LayoutService.create_block` не валидирует существование `layout_id` —
   SQLite не форсит FK (`PRAGMA foreign_keys` не включён), блок можно
   «повесить» на несуществующий layout (HTTP 200). Вне скоупа фазы 0;
   починить отдельной задачей (404 в `create_block`/`update_block`/
   `delete_block`).
