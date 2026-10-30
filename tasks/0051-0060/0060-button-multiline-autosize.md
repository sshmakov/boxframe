# Суть проблемы

`button` — однострочный компонент: label — первая строка `content`, `\n`
игнорируются, текст обрезается по внутренней ширине (0022, замечание 4:
«Если понадобится многострочный label — это новый тип блока, а не
расширение `button`»). Размер ручной (дефолт 16×1), label — на средней
строке с горизонтальным выравниванием left (дефолт `meta.text_align`).

Требования к многострочной кнопке:

- текст может быть многострочным (word-wrap по внутренней ширине, как
  у `box`/`content`);
- autosize как `text` (0049) — размер выводится из контента с учётом
  рамки;
- выравнивание по умолчанию — центрирование по вертикали и горизонтали.

Задача переворачивает документированное решение 0022 — спецификация
ревизуется, секция `button` в AGENTS.md обновляется.

# Задача

Изменить поведение `button`:

- **многострочный контент**: контент word-wrap по внутренней ширине
  (как `box`/`content`, 0051), явные переносы строк сохраняются;
  переполнение по высоте (ручной resize меньше контента) — обрезка
  блока строк по внутренней области, рамка не перезаписывается;
- **autosize как `text` (0049)**: размер выводится из контента с учётом
  рамки кнопки — новая fit-функция `button_block_size()` (рамка зависит
  от высоты, `text_block_size` неприменима); триггеры и правила
  сохранения ручного resize — паттерн 0049;
- **выравнивание по умолчанию — центр по обеим осям**: дефолт
  `meta.text_align` → `center`, `meta.vertical_align` → `middle`
  (механизм `typeDefaults` + `clearDefault`, прецедент 0058);
- поведение одинаково в web-режиме (API) и static-режиме (JS-стор) —
  инвариант parity проекта.

## Fit-размер (рекомендация)

`button_block_size(content, border_style)` в обоих рендерерах (parity):

| контент | рамка | fit |
|---|---|---|
| 1 строка | framed | h=1, w=len+2 — `[label]` (каноническая форма) |
| N≥2 строк | framed | h=N+2, w=maxlen+2 — полная коробка, label впритык к рамке (как `text`) |
| пустой (1 пустая строка, 0049) | framed | h=1, w=3 — `[ ]` |
| любой | `none` | h=N (пустой → 1), w=maxlen (пустой → 1) |

Последствия:

- **форма h=2 (без верхней рамки) перестаёт порождаться autosize** —
  2 строки в неё не влезают (нижняя строка — рамка), fit для 2 строк —
  h=4. Форма остаётся как ручная (отрисовка не меняется);
- ручной resize (только x/y/width/height) сохраняется до следующего
  изменения контента (0049); `replace_blocks` (undo/redo) размер не
  пересчитывает — восстанавливает сохранённый как есть.

# План работ

- [x] Составить план работ
- [x] `services/renderer.py` — `button_block_size(content, border_style)`
      (модульная функция рядом с `text_block_size`)
- [x] `services/renderer.py` — `_draw_button()`: многострочный label
      (word-wrap по внутренней ширине, обрезка блока строк по
      внутренней области, `v_align_offset`/`h_align_offset`,
      дефолты middle/center)
- [x] `static/js/core/renderer.js` — порт (parity побайтово):
      `buttonBlockSize` + `drawButton`
- [x] `services/layout_service.py` — ветки autosize в `create_block` /
      `update_block` / `batch_blocks` (create + update)
- [x] `static/js/core/store.js` — `normalizeButton` +
      `buttonAutosizeTriggered` в `createBlock` / `updateBlock` /
      `batchBlocks` (create + update)
- [x] `static/js/core/properties.js` — `typeDefaults`: `text_align`
      `{ button: "center" }`, `vertical_align` `{ button: "middle" }`;
      комментарий про button обновить
- [x] `static/js/editor.js` — `_blockDefaults("button")`: размер из
      `buttonBlockSize` (content 'Button' → 8×1)
- [x] Тесты: `tests/test_renderer.py`, `tests/js/test_renderer.js`,
      `tests/test_js_renderer_parity.py`, `tests/api/test_layouts.py`,
      `tests/js/test_store.js`, `tests/js/test_properties.js`
- [x] Документация: AGENTS.md (секция `button`), кросс-ссылки
      (0022, 0049, 0057/0058)
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/` (сервер на :8000)

# Исследование

1. **Текущее состояние.** `_draw_button()` (`services/renderer.py`,
   строка ~589) / `drawButton()` (`core/renderer.js`, строка ~312):
   форма зависит от высоты (h=1 — `[`/`]`; h=2 — без верхней рамки;
   h>=3 — полная коробка), label — одна строка (первая строка контента,
   обрезка по внутренней ширине), строка `(h-1)//2`, горизонтальное
   выравнивание `h_align_offset` (`meta.text_align`, дефолт left).
   `vertical_align` игнорируется, хотя панель уже включает `button` в
   `types` обоих align-свойств (properties.js).
2. **Fit-размер — не `text_block_size`.** `text_block_size(content,
   border_style)` = размер текста + 2/2 за рамку. У кнопки рамка зависит
   от высоты (h=1 — `[`/`]`, вертикальной рамки нет; h=2 — +1 снизу;
   h>=3 — +2 со всех сторон), а высота — от fit: циклическая зависимость.
   Нужна новая функция `button_block_size()` с семантикой из таблицы в
   «Задача».
3. **Область контента и текущее поведение.** Внутренняя область:
   h=1 — 1 строка (между `[`/`]`), h=2 — 1 строка (нижняя — рамка),
   h>=3 — h-2 строки, `none` — все h строк. Текущая строка label
   `(h-1)//2` — это ровно `middle`-выравнивание одной строки в этой
   области (для чётной — верхняя средняя). Обобщение на N строк через
   `v_align_offset(n_lines, inner_h, valign)` с дефолтом `middle`
   сохраняет текущий рендер всех однострочных кнопок по вертикали.
4. **Многострочный рендер — word-wrap, как у `box`/`content`.** Контент
   переносится по словам по внутренней ширине (`_wrap_text`, 0051: явные
   `\n` сохраняются, пробелы — форматирование, слово длиннее ширины
   режется посимвольно), затем блок строк выравнивается
   (`v_align_offset`/`h_align_offset`) и обрезается по внутренней высоте
   (`line_idx + v_off >= inner_h` → break). При fit-размере перенос —
   no-op (каждая строка влезает в `inner_w`); при ручном resize уже —
   live re-wrap (паттерн `content`-плейсхолдера, 0059). Label рисуется
   после рамки — строки рамку не перезаписывают.
5. **Горизонтальный дефолт center — изменение рендера существующих
   макетов.** Дефолт `h_align_offset` — left (offset 0). Смена дефолта
   на `center` (через `typeDefaults` + fallback в рендерере) сдвинет
   label во всех сохранённых макетах без `meta.text_align`. Прецеденты:
   divider → center (0057), content-плейсхолдер (320b840) — осознанные
   изменения вывода, миграция данных не планировалась.
6. **Autosize — паттерн 0049.** Триггеры: создание (всегда для
   `button`), обновление `content`/`border_style`/`block_type`
   (перевод другого типа в `button`). Обновление только x/y/width/height
   — ручной resize, сохраняется до следующего изменения контента.
   `replace_blocks` (undo/redo) не пересчитывает — иначе undo/redo ломал
   бы вручную выставленные размеры. Python: ветки рядом с `text`/
   `divider` в `create_block`/`update_block`/`batch_blocks` (create +
   update). JS: `normalizeButton` + `buttonAutosizeTriggered` в
   `createBlock`/`updateBlock`/`batchBlocks` (create + update).
7. **`_commitEdit` — бесплатно.** Merge-back результата `updateBlock`
   (`Object.assign(block, updated)`) общий (0049) — autosize при
   inline-редактировании кнопки работает без изменений. Inline-редактор
   — textarea для всех типов (Enter — commit, Shift+Enter — перенос):
   многострочный ввод в кнопку уже работает, рендерер просто игнорировал
   `\n`.
8. **Панель — только `typeDefaults`.** `button` уже в `types` у
   `text_align` и `vertical_align`. Добавить `typeDefaults: { button:
   "center" }` / `{ button: "middle" }` (прецедент 0058: divider);
   `clearDefault` сохраняется (выбор дефолта очищает ключ). Рендерер
   дублирует fallback при absent/invalid значении (рендерер не знает о
   схеме — 0058, замечание 1).
9. **HTML-оверлей — без изменений.** Оверлей — только рамка-индикатор
   (`block-border--*`), контент живёт в ASCII-слое. Известное
   расхождение «полная коробка для h=1» уже зафиксировано (0022,
   замечание 3).
10. **API — валидации размеров нет** (`BlockCreate`/`BlockUpdate`
    принимают любые w/h) — серверных изменений кроме autosize-веток не
    требуется. Экспорт/импорт — формат JSON не меняется (контент
    хранится как есть).
11. **Дефолт нового блока.** Сейчас 16×1, content 'Button'
    (`_blockDefaults`, 0022). С autosize размер выводится из контента —
    `buttonBlockSize('Button', 'solid')` → 8×1 `[Button]` (стор
    пересчитывает при создании; дефолт — только в `_blockDefaults`,
    прецеденты 0049/0057/0058).
12. **Мин-размеры.** minH=1 у кнопки уже есть (0022, обе ветки clamp в
    `editor.js`); minW — дегенеративный framed w=1 рендерер уже
    обрабатывает (`framed = w >= 2`).

# Открытые вопросы (решить в начале реализации, не блокируют план)

1. **Padding для N≥2 строк (framed):** h=N+2 (рекомендация — label
   впритык к рамке, консистентно с `text` 0049) или h=N+4 («воздушная»
   кнопка с padding-строками)? — **решено: h=N+2** (рекомендация).
2. **`vertical_align` — настраиваемый meta (рекомендация, дефолт
   middle, контрол уже в панели) или захардкоженный middle** (меньше
   кода, но контрол в панели остаётся «мёртвым» для button)? —
   **решено: настраиваемый meta** (рекомендация).

# Выполнение задачи

Реализовано по плану, оба открытых вопроса — по рекомендациям.

- **Рендерер (оба, parity побайтово).** `button_block_size()` /
  `buttonBlockSize()` — fit-функция по таблице (1 строка framed →
  `max(3, w+2)×1`; N≥2 framed → `w+2×(N+2)`; `none` → `w×N`, пустой →
  1×1). `_draw_button()` / `drawButton()`: внутренняя область
  (framed h=1/h=2 — 1 строка на y; framed h≥3 — y+1, h-2; `none` —
  весь блок), label = `_wrap_text`/`wrapText` по `inner_w` →
  `v_align_offset` (дефолт `middle`) → `h_align_offset` (дефолт
  `center`), строки за `inner_h` не рисуются (рамка рисуется первой).
  `buttonBlockSize` добавлена в публичный API `PGRenderer`.
- **Autosize.** Python: ветки `button` в `create_block` /
  `update_block` / `batch_blocks` (create + update; триггеры
  `content`/`border_style`/`block_type`) рядом с `text`/`divider`.
  JS: `normalizeButton` + `buttonAutosizeTriggered` в `createBlock` /
  `updateBlock` / `batchBlocks` (create + update). `replace_blocks` /
  `replaceState` размер не пересчитывают; ручной resize сохраняется.
- **Панель и дефолт.** `typeDefaults`: `text_align` →
  `{ divider: "center", button: "center" }`, `vertical_align` →
  `{ divider: "middle", button: "middle" }` (`clearDefault` сохранён).
  `_blockDefaults("button")`: 16×1 → 8×1 (размер из
  `buttonBlockSize('Button', 'solid')`).
- **Тесты.** `test_renderer.py` (138): переписаны ожидания
  однострочных кнопок (центрирование), новые — word-wrap,
  мультилиней, clip h=1, ручная h=2, vertical_align, text_align
  мультилинейный, `none` мультилинейный, пустой h=1, unit
  `button_block_size` (10 кейсов). `tests/js/test_renderer.js` (132) —
  зеркало. Parity: +8 кейсов alignment, +4 кейса button_heights, новый
  `test_parity_button_block_size` (11 кейсов). API (10 новых):
  create/update/batch autosize, ручной resize, смена типа,
  replace-без-пересчёта. Store (6 новых): зеркало API. Properties:
  typeDefaults + readPropValue (button) + `_blockDefaults` 8×1.
- **E2E.** Тесты с кнопками явного размера (drag/clipboard) обновлены
  под autosize: «Go» → 4×1, геометрия drag-точек пересчитана
  (drag-старты по центру 4×1, дропы с целыми top-left).
- **Документация.** AGENTS.md — секция `button` переписана
  (многострочный label, word-wrap, autosize, дефолты center/middle,
  8×1, h=2 — только ручной resize); кросс-ссылки 0022/0049/0051/
  0057/0058.
- **Проверка.** `pytest tests/ --ignore=tests/e2e` — 256 passed;
  `node --test "tests/js/*.js"` — 326 passed; `pytest tests/e2e/` —
  90 passed (сервер на :8000, `scripts/server.sh`).

# Замечания

1. **Противоречие с 0022.** Замечание 4 из 0022 явно фиксировало:
   «Если понадобится многострочный label — это новый тип блока, а не
   расширение `button`». Задача переворачивает это решение; 0022 не
   переписывается (история задач не удаляется), секция `button` в
   AGENTS.md обновляется.
2. **Смысловое перекрытие с `box`.** Многострочный + autosize +
   центрирование — это по сути `box` с `text_align=center` +
   `vertical_align=middle`. Уникальное у кнопки остаётся: формы по
   высоте (h=1 `[label]`, h=2 без верхней рамки) и leaf-семантика
   (дети не рендерятся).
3. **Старые макеты.** Однострочные кнопки без `meta.text_align`
   перерендерятся с центрированным label (осознанное изменение вывода,
   миграция не планируется — прецеденты 0057/320b840). По вертикали
   рендер не меняется (middle уже был фактическим поведением).
4. **Кросс-ссылки:** 0022 (форма кнопки, переворачиваемое решение
   «одна строка»), 0049 (`text` — паттерн autosize, merge-back
   `_commitEdit`), 0051 (механизм word-wrap/align), 0057/0058
   (прецеденты `typeDefaults`/`clearDefault` и дефолтов в
   `_blockDefaults`).
5. **E2E и dev-сервер.** `scripts/server.sh` запускает uvicorn БЕЗ
   `--reload`: долгоживущий сервер держит старый Python-код, а JS-файлы
   раздаёт с диска — при изменениях рендерера/autosize e2e падают
   «смешанной» картиной (старый размер API + новый клиентский
   рендер). Перед e2e-прогоном — `bash scripts/server.sh restart`.
