# Суть проблемы

На углу `box`, где встречаются линии двух приклеенных chrome-блоков
(`header`/`footer` × `sidebar`), T-узел встречи выбирался **только по
стилю доминанты** (`_two_line_junction(through, stem, orient)` возвращал
`BORDERS[through][key]`, аргумент `stem` фактически не использовался).
Из-за этого подчинённая линия теряла свою толщину у точки встречи:

- `footer double` + `sidebar solid` (доминанта footer): линия `═`,
  под ней одинарная `│` `sidebar` — узел рисовался `╩` (double v),
  хотя должен `╧` (double h + single v);
- `footer solid` + `sidebar double`: двойная `║` `sidebar` обрывалась
  на одинарном `┴` (должен `╨`);
- `sidebar double` доминанта + `footer solid`: `╠` (double h) вместо
  `╟` (double v + single h);
- `sidebar solid` доминанта + `footer double`: `├` вместо `╞`.

Это тот же дефект, что 0076 исправил для соединения линии
`header`/`footer` с рамкой `box`, но на стыке **двух chrome-линий** между
собой (corner meeting) он оставался. При совпадающих стилях и при
`dashed`/`dotted`-миксах вывод был корректным (откат) — дефект только для
`solid`×`double`.

# Задача

Заставить `_two_line_junction` / `twoLineJunction` учитывать стиль
**стебля**, а не только through-линии: для `solid`×`double` —
соответствующий Unicode mixed T, для остальных — существующий откат к
глифу through-линии. Побайтовый parity Python↔JS.

# План работ

- [x] `renderer.py`: общий `_MIXED_BY_ORIENT` (orient → уже готовые карты
      `_MIXED_TOP`/`BOTTOM`/`LEFT`/`RIGHT`, ключ `(through, stem)`);
      `_two_line_junction` — same→style-map, mixed→карта по orient,
      иначе fallback through.
- [x] `renderer.js` `twoLineJunction` + `MIXED_BY_ORIENT` — зеркало.
- [x] Тесты: `test_renderer.py` (unit + 4 интеграционных),
      `test_renderer.js` (unit + 4), parity `test_parity_attached_corner_mixed_styles`.

# Детали реализации

Ключ orient выбирает ориентацию through-линии и, соответственно, набор
mixed-глифов:

| orient | through | карты | глифы (through=solid/double × stem) |
|---|---|---|---|
| `down` | горизонталь (┬) | `_MIXED_TOP` | `(д,s)→╤`, `(s,д)→╥` |
| `up` | горизонталь (┴) | `_MIXED_BOTTOM` | `(д,s)→╧`, `(s,д)→╨` |
| `right` | вертикаль (├) | `_MIXED_LEFT` | `(s,д)→╞`, `(д,s)→╟` |
| `left` | вертикаль (┤) | `_MIXED_RIGHT` | `(s,д)→╡`, `(д,s)→╢` |

Карты общие с пограничными junctions (0076, `_attached_v_junction`,
`_mixed_attached_junction`) — ключ `(through_style, stem_style)` совпадает
по смыслу (through = непрерывная рука, stem = ветка). Ветка сохраняет свою
толщину; непрерывные руки — толщину доминанты.

```python
if through_style == stem_style:
    return BORDERS.get(through_style, BORDERS["solid"])[key]
junction = _MIXED_BY_ORIENT[orient].get((through_style, stem_style))
if junction:
    return junction
return BORDERS.get(through_style, BORDERS["solid"])[key]   # dashed/dotted
```

# Замечания

- **Обратная совместимость:** меняет вывод только там, где раньше был явный
  дефект (`solid`-chrome × `double`-chrome на углу). Для совпадающих стилей
  и `dashed`/`dotted`-миксов вывод идентичен. Существующие corner-тесты
  (все `solid`) прошли без изменений. Согласовано с пользователем
  (2026-11-10).
- **`dashed`/`dotted`** — фундаментально без mixed-юникода; откат к глифу
  through-линии, как в 0076.
- Кросс-ссылки: 0076 (mixed junctions для рамки box), 0077
  (sidebar-attach + доминанта угла), 0078 (композиция усечений).

## Визуальные примеры

```
╞════╧═════…   footer double + sidebar solid (доминанта footer)
├────╨─────…   footer solid  + sidebar double (доминанта footer)
│    ╟─────…   sidebar double dominant + footer solid
│    ╞═════…   sidebar solid dominant  + footer double
```
