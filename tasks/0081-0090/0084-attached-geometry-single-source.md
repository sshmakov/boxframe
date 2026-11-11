# Суть проблемы

Геометрия приклеенного chrome (`header`/`footer`/`sidebar` у краёв `box`,
todo-0007/0008/0009 + доминанта углов, 0078/0079) считалась **независимо в
трёх местах**, и эти места расходились:

1. **ASCII-рендерер** — `_plan_attached` (py) / `planAttached` (js). Каноничный:
  Enumerates все стороны приклеевания и **полностью** считает обрезку по
  доминанте угла (подчинённый усекается так, чтобы его тело начиналось на
  клетку за линией доминанта).
2. **Редактор, выделение/попадание/drag** — `_absoluteRect`/`_attachedSide` в
   `editor.js`. (Исправлено ранее: уже делегирует в `PGRenderer.planAttached`.)
3. **HTML-оверлей** — `_block_preview_html` (py) / `_blockPreviewHtml` (js).
   Делал **per-block растягивание на всю внутреннюю область** без доминанты
  угла: приклеенный блок всегда тянулся на всю внутреннюю ширину/высоту `box`.

Пункт 3 — корень всех трёх жалоб пользователя:

- ширина приклеенного `header` в дереве/оверлее = вся внутренняя ширина `box`,
  хотя ASCII урезал его слева приклеенным `sidebar`;
- hover-подсветка `header` в дереве (задача 0082) подсвечивала всю ширину `box`
  (hover — CSS-класс на `.block-preview`, геометрия берётся из оверлея);
- нижняя левая ручка resize приклеенного `sidebar` появлялась у нижней рамки
  `box`, хотя снизу `sidebar` ограничен приклеенным `footer`.

Все три симвома — один и тот же баг: `.block-preview` (DOM-элемент, на который
«едут» hover-outline, selected-outline, линия chrome и CSS-ручка resize)
перерастает в углы, где ASCII вообще не рисует chrome.

# Задача

Свести вычисление эффективной геометрии приклеевания к **одному источнику на
язык** — общий ядро, которое используют и ASCII-рендер, и HTML-оверлей (редактор
уже сведён к нему ранее). Тогда hover / выделение / линия chrome / ручка resize
становятся корректными **для любой** стороны приклеевания и любого случая
отсечения — один раз, а не латанием каждого симптома отдельно.

Жёсткое ограничение: **Python↔JS побайтовый паритет** (AGENTS.md). Ядро должно
быть спортировано идентично; поведение ASCII не меняется (рефакторинг,
сохраняющий поведение).

# План работ

- [x] Собрать полное текущее состояние `_plan_attached`/`_block_preview_html`
      (py) и `planAttached`/`_blockPreviewHtml` (js), существующие тесты
- [x] Python: вынести ядро `_attached_geometry(children, inner_w, inner_h)` +
      `_dominant_corner_rec`; перевести `_plan_attached` и `_block_preview_html`
      на него; `_dominant_corner` (метод) → делегат
- [x] JS: портировать ядро `attachedGeometry` + `dominantCornerCore`;
      `dominantCorner` → делегат; `planAttached` и `_blockPreviewHtml` на ядро;
      экспорт в `PGRenderer`
- [x] Тесты: прямой тест обрезанного оверлея (py) + parity corner-HTML +
      e2e hover (симптом «ручка/side bar × footer»)
- [x] Прогнать: JS-сьют, py renderer+parity, полный e2e

# Исследование

Три вычисления эффективной геометрии (см. «Суть») давали **разный** ответ для
одного макета в угле, где chrome пересекается. Проверено, что тесты не дергают
интерфейсы-внутренности напрямую → рефакторинг контракт-безопасен; существующие
одиночные chrome-ассерты HTML остаются побайтово теми же (stage-1 `eff` для
случаев без угла не меняется).

Ключевые решения по ядру:

- **Внутренние координаты** (inner coords): `(0,0)` = первая внутренняя клетка
  `box`; padding в 1 клетку рамки добавляет **каждый потребитель** сам
  (ASCII: `+px+1,+py+1`; позиционирование HTML: `(1+x)`). Ядро не знает о
  смещении — поэтому его можно звать из обеих веток.
- Возврат: `results[i]` (параллельно `children`) — `{attached, side,
  eff:[x,y,w,h], clipped, trim_left/right/top/bottom}`; `meetings` —
  внутренние T-узлы встречи обрезанного блока с линией доминанта
  `{col,row,orient,a_style,b_style}` (порядок `a/b` — тот, что ждёт хелпер
  глифа узла).
- Доминанта угла (`_dominant_corner_rec`): «away»-критерий считается по
  **эффективным** (растянутым) прямоугольникам; приклеенный chrome тянется на
  всю внутреннюю область → эффективные прямоугольники всегда пересекаются →
  доминанта решается `order`-ом (старший побеждает; ничья → горизонтальный).
  При `inner_w<1 or inner_h<1` — все `attached=False` (ранний выход).
- Границы «не протекания» (0078): каждое усечение сохраняет **текущий**
  противоположный край eff-прямоугольника, а не внутреннюю границу `box` —
  иначе линия перерастает chrome соседнего блока.

# Выполнение задачи

**Python** (`boxframe/services/renderer.py`):
- модульные `_dominant_corner_rec` и `_attached_geometry` (перед классом);
- `_plan_attached`: пролог (box-guard, `inner<1` early-return, сброс
  `attached`) сохранён; тело → `records` из детей → `_attached_geometry` →
  цикл по `zip(children, results)`: offset `eff` на `(px+1,py+1)`, запись
  `c.x/y/width/height`, `c.attached/attached_side`, border-junctions (кроме
  clipped/borderless); затем `meetings` → `meeting_ops` через
  `_two_line_junction`;
- `_block_preview_html`: при `block_type=="box"` собирает `records` из детей и
  берёт `att_plan = _attached_geometry(...)[0]`, для ребёнка использует
  `attached/side/eff`; не-`box` родители → `att_plan=None` (обычная раскладка);
- метод класса `_dominant_corner` делегирует в `_dominant_corner_rec`.

**JS** (`boxframe/static/js/core/renderer.js`) — зеркало:
`attachedGeometry` + `dominantCornerCore` на IIFE-скоупе; `dominantCorner`
делегатирует (мапит legacy `.c.order` на плоский `{side,eff,order}`);
`planAttached` строит `children`, зовёт `attachedGeometry`, offset+junctions+
meetingOps; `_blockPreviewHtml` — тот же `attPlan`-паттерн; `attachedGeometry` и
`dominantCornerCore` добавлены в экспорт `PGRenderer`.

**Тесты:**
- `tests/test_renderer.py`: `test_render_html_preview_attached_header_trimmed_by_sidebar`
  и `..._attached_sidebar_trimmed_by_header` — прямые ассерты на геометрию
  обрезанного `.block-preview` (не только паритет).
- `tests/test_js_renderer_parity.py`: `test_parity_attached_corner_html`
  (6 кейсов: доминанта по стороне, ничья, старшинство `order`, правый sidebar,
  footer×sidebar, смешанные стили).
- `tests/e2e/test_editor.py`: `test_attached_sidebar_trimmed_by_footer_hover_matches_render`
  — hover по дереву на `sidebar`, обрезанном снизу `footer` → высота рамки ≈
  усечённой, а не полной внутренней высоты (регресс-гард < 6 клеток).

Тесты: **418 py** (non-e2e) + **476 js** + **117 e2e** (вкл. parity **45**) —
все зелёные; паритет не нарушен, регресса нет.

# Замечания

- **Главная ловушка:** canvas-оверлей редактор получает из **API**
  (`this.htmlPreview = data.html` → Python `_block_preview_html`), а НЕ из JS
  `renderHtmlPreview`. Поэтому e2e, меряющий DOM-оверлей, проверяет **Python**.
  Dev-сервер без `--reload` крутил старый Python → новый e2e падал не из-за бага,
  а из-за устаревшего процесса. Для проверки изменений рендерера (Python) нужен
  `scripts/server.sh restart`. JS при этом всегда свежий (статика с диска).
- **Правило паритета соблюдено:** ядро спортировано побайтово; правки вносятся
  синхронно в `renderer.py` и `core/renderer.js` + оба набора тестов + parity —
  иначе parity падает.
- Теперь у приклеевания ровно **один** источник геометрии на язык; новые стороны
  приклеевания/случаи отсечения добавляются в `_attached_geometry`/`attachedGeometry`
  — и автоматически получают корректные hover / выделение / chrome-линию / ручку.
- Редактор (`editor.js`) уже использует общий план (`_absoluteRect` →
  `PGRenderer.planAttached`, задача-предшественник). Его `_attachedSide`
  (детект стороны по сохранённым координатам) согласован с ядром.
- Дальнейшее развитие (не в scope): если появятся новые типы приклеевания или
  меты для углов — расширять ядро, а не потребителей; ассерты на оверлей
  (`test_renderer.py`) — дешёвый способ зафиксировать геометрию без e2e.
