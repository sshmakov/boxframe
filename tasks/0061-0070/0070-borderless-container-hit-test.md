# Суть проблемы

После коммита 937a50e (дети borderless-контейнера рендерятся в ASCII)
редактор показывает ребёнка borderless `box` в обоих слоях — ASCII-арт
(`_render_block()` рисует детей независимо от рамки, 1-cell padding
сохраняется) и HTML-оверлей (`_block_preview_html()` всегда вкладывает
детей в div родителя), — но **клик по ребёнку выделяет родителя**.

Hit-test `_blockAt()` в `editor.js` спускается в детей только если
`_childrenRendered()` вернул `true`, а там остался гейт
`border_style !== 'none' && width >= 2 && height >= 2` — устаревшее
правило «дети рендерятся только у блоков с рамкой» из до-937a50e.
Для `border_style === 'none'` функция возвращала `false` → `_blockAt()`
не спускался в borderless `box` и возвращал его как верхний видимый
блок. Через тот же `_blockAt()` идут одиночный клик (выделение),
двойной клик (inline-редактор открывался для `box`, а не для ребёнка)
и drag (тянулся `box`).

# Задача

Согласовать hit-test с рендерером: дети рендерятся (а значит,
кликаются) у **всех** блоков, кроме атомарных (`hline`, `vline`,
`button`, `divider`) — независимо от `border_style` родителя.

# План работ

- [x] Составить план работ
- [x] `static/js/editor.js` — `_childrenRendered()`: убрать гейт по
      `border_style`/размеру, оставить исключение атомарных типов
- [x] `tests/js/test_editor.js` — тест 0044 «children of a borderless
      container are not drawn» переписан на новое поведение (ребёнок
      borderless-контейнера сверху, внешняя клетка — контейнер)
- [x] `tests/e2e/test_editor.py` — 3 теста: клик по ребёнку borderless
      box выделяет ребёнка; клик по внешней клетке box выделяет box;
      двойной клик по ребёнку открывает редактирование ребёнка
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/` (сервер на
      :8000)

# Исследование

1. **Рендерер.** `_render_block()` (`renderer.py` / `renderBlock()` в
   `core/renderer.js`): `has_border` управляет только `_draw_border()`;
   контент и дети — всегда. Borderless-контейнер сохраняет 1-cell
   padding и inner-клип (`_render_children_in_container()`: inner =
   `[x+1, y+1, x+w-1, y+h-1]`, вырожден при w<3 или h<3 — дети не
   рисуются).
2. **Оверлей.** `_block_preview_html()` — дети всегда вложенные div с
   1-cell padding; `.block-preview` прозрачен для hit-test только
   координатно (клик решается `_pixelToGrid()` + `_blockAt()`).
3. **Hit-test.** `_blockAt()` (`editor.js`): спуск в детей gated
   `_childrenRendered()`; геометрия спуска (`inInner`) уже учитывает
   1-cell padding и вырожденный inner (w<3/h<3) — проверка размера в
   `_childrenRendered()` избыточна.
4. **Соседи.** `_findDropContainer()` принимает `box`/`grid`
   независимо от рамки — согласовано с новым правилом. Ручки grid
   (`framed ? w-2 : w`) — геометрия перегородок borderless grid,
   отдельное правило, не затронуто.
5. **Воспроизведение.** One-off e2e (tmp/test_borderless_child_select.py):
   borderless box 20×10 + content-ребёнок 10×4; клик по центру
   оверлея ребёнка → `selectedIds = [box_id]`.

# Выполнение задачи

`_childrenRendered()` теперь возвращает `true` для всех типов, кроме
`hline`/`vline`/`button`/`divider` (атомарные элементы — у них нет
детей в рендерере). Гейт по `border_style` и размеру убран: геометрия
спуска в `_blockAt()` (`inInner`) сама не спускается в вырожденный
inner-прямоугольник.

Тесты:
- `tests/js/test_editor.js` — тест 0044
  «_blockAt: children of a borderless container are not drawn»
  зафиксировал старое поведение (добавлен в 0036bbf, когда рендерер
  ещё не рисовал детей borderless-контейнеров) — переписан:
  «_blockAt: a child of a borderless container is on top (0070)»;
- e2e (`tests/e2e/test_editor.py`):
  - `test_click_borderless_box_child_selects_child` — клик по ребёнку
    borderless box → выделен `content` (до фикса — `box`);
  - `test_click_borderless_box_outer_cell_selects_box` — клик по
    внешней клетке box (вне inner-области) → выделен `box`;
  - `test_double_click_borderless_box_child_edits_child` — двойной
    клик по ребёнку открывает inline-редактор с контентом ребёнка.

# Замечания

- Hit-test живёт только во фронтенде (`editor.js`); Python-сторона
  (рендерер, API) не затронута — parity не требуется.
- Фикс общий для web- и static-редакторов (один `editor.js`).
