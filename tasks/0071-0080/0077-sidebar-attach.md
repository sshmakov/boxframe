# Суть проблемы

`sidebar` — последний «только имя» из группы todo-0001: отрисовка
идентична `box`. Доработка по образцу `header`-attach (0074) /
`footer`-attach (0075): прилипание к левому/правому краю `box` —
без 3 внешних сторон рамки, только внутренняя вертикальная линия на всю
внутреннюю высоту + junctions `┬`/`┴`. Спека —
`tasks/backlog/todo-0009-sidebar-attach.md` (согласована 2026-11-10).

# Задача

Дать `sidebar` характерную отрисовку «приклеен к левому/правому краю
`box`»; реализовать пересечение с приклеенными `header`/`footer`
(доминанта угла → укорочение подчинённого → внутренний T-узел); сменить
дефолт `sidebar` на `12×16`. Закрыть пункт todo-0001 по `sidebar`.

# План работ

- [x] `services/renderer.py`:
      - `RenderBlock.attached_side` (top/bottom/left/right);
      - `_render_children_in_container` — план attached (детекция,
        эффективная геометрия, доминанта угла, укорочение);
      - `_draw_attached` — ветка left/right (вертикальная линия,
        контентная область по другую сторону), учёт укорочения;
      - junctions: внешние `├`/`┤` (header/footer) + `┬`/`┴` (sidebar)
        на рамке `box`, внутренний T-узел (`┬`/`┴`/`├`/`┤`) в точке
        встречи; смешанные `╞╡╟╢` (гориз.) + `╤╥╧╨` (верт.);
      - HTML-оверлей: `attached_side` для sidebar (вертикальная линия),
        геометрия прилипания sidebar в `_block_preview_html`.
- [x] `static/js/core/renderer.js` — порт (parity побайтово).
- [x] `static/js/editor.js`:
      - `_absoluteRect` — эффективная геометрия attached-`sidebar`
        (по прямому родителю);
      - `onCanvasDrop` — снап `sidebar` в `box` к ближнему краю;
      - `_blockDefaults('sidebar')` → `12×16`.
- [x] Тесты: `tests/test_renderer.py`, `tests/js/test_renderer.js`,
      `tests/test_js_renderer_parity.py`, `tests/js/test_properties.js`.
- [x] AGENTS.md — пункт `sidebar` в разделе «Блоки».
- [x] Прогон: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`.

# Детали реализации

## Условие прилипания (оба рендера)
Дочерний `sidebar` в `box`: левый — `x < 0`, правый — `x + w > inner_w`
(`inner_w = bw−2`). Точное касание (`x == 0` / `x + w == inner_w`) — не
приклеен. Если отсечены оба бока (`w > inner_w`) → левый (порядок проверок:
`cx < 0` раньше `cx + cw > inner_w`).

## Эффективная геометрия (render-time, `_plan_attached` / `planAttached`)
`side="left"`: `eff = [px+1, py+1, max(1,cw), innerH]`;
`side="right"`: `eff = [px+1+innerW−max(1,cw), py+1, max(1,cw), innerH]`.
Сохранённые `y`/`height` игнорируются, пока приклеен; `x`/`width` —
применяются после отклейки. `_render_block`: ветка
`block.block_type in ("header","footer","sidebar") and block.attached`.

## `_draw_attached` (сторона из `attached_side`)
`left`/`right` — вертикальная линия в колонке `x+w−1` (left) / `x` (right),
на всю эффективную высоту; контентная область — `w−1` колонок с дальней от
линии стороны (`x+1` для left, `x` для right) × полная высота; символ
линии — `border_style` сайдбара; рисуется при `cw <= inner_w` и
`border_style != none`.

## Junctions
- Внешние (на рамке `box`, рисует родитель, до установки inner-клипа):
  `┬`/`┴` (`_attached_v_junction`, стиль-map `box`'а при равенстве стилей);
  при mismatch — `╤`(double-box/solid-line)/`╥`(solid-box/double-line) сверху
  и `╧`/`╨` снизу (`_MIXED_TOP`/`_MIXED_BOTTOM`). Header/footer — прежние
  `├`/`┤` + `╞╟╡╢` (`_mixed_attached_junction`). Junction на усекаемом конце
  НЕ emission-ится (`if r["clipped"] or c.border_style=="none" or
  box_style=="none": continue`, плюс `trimTop`/`trimBottom`/`trimLeft`/
  `trimRight`-гейты).
- Внутренний T-узел встречи (`_two_line_junction(through_style, stem_style,
  orient)`, `orient∈{down:┬, up:┴, right:├, left:┤}`) — emission после детей
  (перекрывает концы линий), глиф — стиль доминанта.

## Доминанта угла (`_dominant_corner(hr, vr)`, без meta-флага)
Критерий away — по **эффективным (растянутым)** прямоугольникам `eff`, не
по сохранённым `cx`/`cy`/`cw`/`ch`: `away_h = v_left ? eff.hr.x >=
eff.vr.x+eff.vr.w : eff.hr.x+eff.hr.w <= eff.vr.x`; `away_v = h_top ?
eff.vr.y >= eff.hr.y+eff.hr.h : eff.vr.y+eff.vr.h <= eff.hr.y`. Attached
`header`/`footer` тянется на всю внутреннюю ширину, а `sidebar` — на всю
высоту, поэтому их эффективные прямоугольники **всегда пересекаются** →
away-ветки не срабатывают, дом падает на `order` (больший → `V`; ничья →
`H`, классический app-chrome). Ревизия (было: away по сохранённым
координатам): «диагональная» по `x`/`y` раскладка давала `null` (нет
пересечения) и в углу рисовались **обе** полные линии — двойная рамка
(вариант B); со склейкой по эффективной геометрии угол схлопывается в
один T-узел. Усечение: тело подчинённого
начинается на клетку **за** линией доминанта (`lr+1` / `col+1`), чтобы не
затирать линию; T-узел остаётся **на** линии доминанта и соединяется.

## Порядок отрисовки в контейнере
`_render_children_in_container`: `_plan_attached` → рисуем `border_ops`
(до inner-клипа, клетки рамки вне внутренней области) → ставим
`self._clip = inner` → дети (attached — как есть, абсолютные; обычные —
через относительный transform) → `meeting_ops` (после детей, под inner-клипом).
Вызов `_draw_attached_junctions` из пути `box` УДАЛЁН (логика переехала в
`_plan_attached`).

## HTML-оверлей
`attached_line_html(width, height, cw_px, ch_px, style, side)` —
`left`/`right`: вертикальный div `block-line block-line--v block-line--seg`
(`left = round((width−0.5 if left else 0.5)*cw_px, 1)px`, `top:0; height:100%`).
`_block_preview_html(..., attached_side)`; дети sidebar определяются по
`x<0`→left / `x+cw>inner_w`→right. Corner-укорочение в оверлей НЕ goes.

## Дефолт и редактор
`_blockDefaults('sidebar')` → `12×16`, `[sidebar]` (generic 20×3 не трогает;
стор/API размера не задают — как header/footer). `onCanvasDrop`: снап в `box`
к ближнему боку (`relCenterX < innerW/2 ? x=-1 : innerW−w+1`, `y=0`,
`height=inner_h`). `_absoluteRect`: attached-sidebar → `x=0/inner_w−w`,
`y=0`, `height=inner_h` (введён `height`-возврат; corner-укорочение в
`_absoluteRect` НЕ моделируется — как header/footer).

## Тесты
`test_renderer.py` +`_box_with_sidebar`/`_box_with_corner` (~18 кейсов:
базовый, right, w1, шире inner (clipped), borderless, dashed, none-рамка,
detached, exact-touch ×2, hint, fill, double-линия/solid-box `╥╨`,
solid-линия/double-box `╤╧`, grid-unchanged `│Side│`, 4 corner-доминанты).
`test_js_renderer.js` — зеркало ground-truth. Parity:
`test_parity_attached_sidebar` (16), `_corner` (6), `_sidebar_html` (5).
`test_properties.js` — `_blockDefaults('sidebar') → 12×16`.

# Замечания

- HTML-оверлей: corner-укорочение в оверлей НЕ моделируется (только
  ASCII); оверлей attached-`sidebar` — вертикальная линия по эффективной
  геометрии (по образцу горизонтальной линии header/footer).
- Доминанта угла: сохранённая позиция → `order` → дефолт header/footer
  (без meta-флага).
