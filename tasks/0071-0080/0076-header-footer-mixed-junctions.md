# Суть проблемы

Junctions `├`/`┤` в местах соединения линии приклеенного `header`/`footer`
с рамкой `box` выбирались **только по стилю рамки `box`**
(`_draw_attached_junctions` / `drawAttachedJunctions` брали `style["t_l"]`,
`style["t_r"]` из style map родителя). Горизонтальная рука junction
принадлежит линии ребёнка (её `border_style`), вертикальная — рамке
родителя. При разных стилях это давало визуальный дефект:

- `box double` + `header solid` — `├────┤` (одинарная рука на двойной
  вертикали; `├` сидит на `║`-рамке);
- `box solid` + `header double` — `├════┤` (двойная горизонталь входит в
  одинарный `├`).

Формально junction не «соответствует» соединяемым линиям — формат
псевдографики самодокументируем, такой диссонанс размывает читаемость.

# Задача

Выбирать junction-символ по **обоим** стилям: рамки `box` и линии
`header`/`footer`. Для комбинаций `solid`×`double` использовать
соответствующие Unicode mixed box-drawing символы (`╞╡` / `╟╢`), для
остальных — существующий fallback (junction родителя; в Unicode нет
junction-символов для `dashed`/`dotted`). Сохранить побайтовый parity
Python↔JS и обратную совместимость: прежний рендер unchanged для
макетов, где стили совпадают или где хотя бы одна сторона
`dashed`/`dotted`.

# План работ

- [x] Составить план работ
- [x] `services/renderer.py`: модульный helper
      `_mixed_attached_junction(box_style, child_style, side)` + карты
      `_MIXED_LEFT`/`_MIXED_RIGHT`; в `_draw_attached_junctions`
      заменить `style["t_l"]`/`style["t_r"]` на вызовы helper'а
- [x] `static/js/core/renderer.js` — зеркальный `mixedAttachedJunction`
      + `MIXED_LEFT`/`MIXED_RIGHT`, экспорт в `PGRenderer`, обновление
      `drawAttachedJunctions`
- [x] Тесты: `tests/test_renderer.py` (6 новых: unit на helper +
      header/footer × double-миксы), `tests/js/test_renderer.js`
      (зеркально, 6 новых)
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`,
      `pytest tests/test_js_renderer_parity.py`

# Исследование

1. **Символы Unicode Box Drawing (U+2500–U+257F).** Для T-соединений с
   непрерывной вертикальной рукой и горизонтальной веткой в одну сторону
   есть отдельные символы для всех комбинаций одинарной и двойной линии:

   | левый борт (v + h→) | правый борт (v + h←) | комбинация |
   |---|---|---|
   | `├` U+251C | `┤` U+2524 | light v + light h |
   | `╞` U+255E | `╡` U+2561 | light v + double h |
   | `╟` U+255F | `╢` U+2562 | double v + light h |
   | `╠` U+2560 | `╣` U+2563 | double v + double h |

   Для `dashed` (`┄┆`) и `dotted` (`┈┊`) Unicode **не предоставляет**
   junction-символов вообще — отдельной клетки «T с пунктирной рукой» в
   стандарте нет.

2. **Fallback.** Если хоть один из стилей — `dashed`/`dotted`
   (или неизвестный), используется junction родителя (`t_l`/`t_r` из
   style map `box`). Это совпадает с прежним поведением: для
   `box solid` + `header dashed` → `├`, для `box double` +
   `header dashed` → `╠`. Стиль самой линии (`┄┄┄`) рисуется как
   раньше (символ из `border_style` ребёнка).

3. **Модель «руки» junction.** Junction на границе `box` при
   attached-`header`/`footer` имеет: **вертикальные руки** (вверх и
   вниз вдоль рамки) — наследуют стиль `box`; **горизонтальная рука**
   (внутрь box, вдоль линии `header`/`footer`) — наследует
   `border_style` ребёнка. Отсюда выбор символа = (box_style,
   child_style).

4. **Обратная совместимость.** Для макетов, где стили совпадают
   (оба `solid`, оба `double`), или где хоть один — `dashed`/`dotted`,
   вывод идентичен прежнему. Отличие проявляется только там, где
   раньше был явный дефект: `solid`-рамка + `double`-линия, либо
   `double`-рамка + `solid`-линия. Это исправление, а не изменение
   формата — согласуется с правилом обратной совместимости (сохранён
   вывод для всех легитимных прежних комбинаций, «сломанный» визуал
   исправлен).

# Выполнение задачи

- `services/renderer.py`:
  - новые модульные константы `_MIXED_LEFT`, `_MIXED_RIGHT`
    (словари `(box_style, child_style) → char`);
  - модульный helper `_mixed_attached_junction(box_style, child_style,
    side) -> str`: при `box_style == child_style` — `t_l`/`t_r` из
    style map `box` (через `BORDERS.get(box_style, BORDERS["solid"])`,
    устойчиво к неизвестному стилю); при миксе `solid`×`double` —
    соответствующий mixed-символ; иначе — fallback на стиль `box`;
  - в `_draw_attached_junctions` два вызова `self._set(...,
    style["t_l"|"t_r"])` заменены на
    `_mixed_attached_junction(block.border_style, child.border_style,
    "left"|"right")`; докстринг метода дополнен описанием правила.
- `static/js/core/renderer.js` — зеркально: `MIXED_LEFT`/`MIXED_RIGHT`
  (ключ `"box|child"`), `mixedAttachedJunction(boxStyle, childStyle,
  side)`, вызовы в `drawAttachedJunctions` с `block.border_style` и
  `c.border_style`; helper экспортирован в `PGRenderer`
  (`mixedAttachedJunction`) для unit-теста.

Тесты:
- `tests/test_renderer.py`:
  - unit на helper — 12 утверждений: same-solid, same-double,
    `solid|double` (обе стороны), `double|solid` (обе стороны), четыре
    dashed/dotted fallback-кейса (`solid|dashed`, `dashed|solid`,
    `solid|dotted`, `dotted|solid`) плюс два
    «double-рамка + dashed-линия»/«dashed-рамка + double-линия»;
  - `test_attached_header_double_line_solid_box` — `╞════╡`;
  - `test_attached_header_solid_line_double_box` — `╟────╢` (рамка `╔╝`);
  - `test_attached_header_double_both` — `╠════╣`;
  - `test_attached_footer_double_line_solid_box` — `╞════╡` на
    строке `py+1+inner_h−ch`;
  - `test_attached_footer_solid_line_double_box` — `╟────╢` на той же
    строке.
- `tests/js/test_renderer.js` — 6 зеркальных тестов (unit + 5
  интеграционных).

Проверка: **379 py** (unit+API+parity, было 373 — +6 новых),
**435 js** (было 429 — +6 новых), **40 parity** — все зелёные.
Существующие тесты (`test_attached_header_dashed_line`,
`test_attached_footer_dashed_line` и др.) прошли без изменений —
fallback-поведение сохранено побайтово.

## Визуальные примеры

```
╔══════════════════╗   ┌──────────────────┐   ╔══════════════════╗
║Title             ║   │Title             │   ║                  ║
║                  ║   │                  │   ╟──────────────────╢
╟──────────────────╢   ╞══════════════════╡   ║Footer            ║
║                  ║   │                  │   ║                  ║
╚══════════════════╝   └──────────────────┘   ╚══════════════════╝
  double+solid → ╟╢      solid+double → ╞╡      double+footer → ╟╢
```

# Замечания

- **Модель «стилов руки» junction переносима** на будущие attach-типы
  (`sidebar`, follow-up todo-0008): `sidebar` прилипает к левому/правому
  краю `box`, линия вертикальная, junctions — `┬`/`┴` (и `╥`/`╨`/`╤`/`╧`
  для миксов). Помогает заранее иметь общий helper «junction по двум
  стилям + ориентации линии», а не плодить специфичные.
- **`dashed`/`dotted` без mixed-юникода** — фундаментальное ограничение
  стандарта. Если захотим визуальной дифференциации, придётся выбирать
  компромисс (например, «double v + light h» `╟` для
  `double`-рамки + `dashed`-линии вместо `╠`-fallback) — вопрос
  предпочтения, зафиксировать отдельно при появлении запроса.
- **Пересечения `header`+`footer`+`box`** — политика 0075 сохранена
  (линии рисуются независимо, junctions рисует родитель; конфликт
  не разрешается). Новый helper это не меняет.
- **Расширить паттерн на grid-перегородки?** Пока не нужно: у `grid`
  перегородки наследуют стиль внешней рамки (`border_style`), миксов
  «grid vs partition» не возникает (см. AGENTS.md, `border_style=none`
  → solid-перегородки). Если в будущем у `grid` появятся
  per-partition стили — тот же helper пригодится.
- Кросс-ссылки: 0074/0075 (attached-рендер header/footer), 0063
  (junctions grid — рисует родитель), todo-0007/0008.
