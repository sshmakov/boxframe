# Суть проблемы

После варианта E (0057) у `divider` осталось два недочёта:

1. **Нет вертикального выравнивания.** Подпись всегда рисовалась со
   строки 0, даже когда сохранённая высота больше числа строк подписи
   (например, 30×3 с однострочной подписью — линия-подпись прижата к
   верху, две нижние строки — пустые линии). У `box` этот кейс закрыт
   `meta.vertical_align` (0051, фаза 3), у divider — нет (в 0057
   зафиксировано «vertical_align не применяется»).
2. **Скромные дефолты нового блока.** 20×1 с пустым контентом: на
   канве появляется «мёртвая» линия без подписи, и её не отличить от
   `hline`. Другие типы получают осмысленный placeholder
   (`[box]`, `[text]`, `Button`).

# Задача

Доработать `divider`:

- вертикальное выравнивание подписи **как в `box`**
  (`meta.vertical_align`: `top / middle / bottom`), но **дефолт —
  `middle`** (по центру), в отличие от `box`, где дефолт `top`;
- текст по умолчанию нового блока — `[divider]`;
- ширина по умолчанию нового блока — 30 (было 20).

# План работ

- [x] Составить план работ
- [x] `services/renderer.py` — `_draw_divider()`: сдвиг блока подписи
      `v_align_offset()` (дефолт `middle`); `_divider_segments_html()`:
      сегменты следуют за вертикальным сдвигом
- [x] `static/js/core/renderer.js` — порт (parity побайтово):
      `drawDivider`, `dividerSegmentsHtml`
- [x] `static/js/core/properties.js` — `vertical_align`: `divider`
      возвращён в `types` + `typeDefaults: { divider: "middle" }`
      (механизм `clearDefault` — выбор middle очищает ключ)
- [x] `static/js/editor.js` — `_blockDefaults`: `divider` → 30×1,
      content `[divider]`
- [x] Тесты: `tests/test_renderer.py`, `tests/js/test_renderer.js`,
      `tests/test_js_renderer_parity.py`, `tests/js/test_properties.js`
- [x] Документация: AGENTS.md (секция `divider`), кросс-ссылки
      (0057, todo-0003)
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`, `pytest tests/e2e/` (сервер на :8000)

# Исследование

1. **Механизм `vertical_align` переиспользуется как есть.**
   `v_align_offset(n_lines, height, valign)` (0051) — смещение блока
   строк внутри области: `top` → 0, `middle` → `(h-n)//2` (лишняя
   строка — вниз), `bottom` → `h-n`; переполнение не сдвигается
   (offset 0, хвост обрезается). Для divider «область» — весь
   сохранённый размер (рамки нет), строки подписи не переносятся
   (как есть, 0057). Единственное отличие от `box` — дефолт: у divider
   absent `vertical_align` → `middle`, у `box` → `top`.
2. **Дефолт `middle` — осознанное отличие от `box`.** Подпись divider —
   единственное содержимое блока (линии — оформление), и «прижать к
   верху» при ручной высоте 3+ выглядит как баг; центр — ожидаемая
   позиция. Для `box` дефолт `top` исторически верен (текст течёт с
   верха). Механизм `typeDefaults` (0051–0054, применён в 0057 к
   `text_align`) покрывает type-specific дефолт без изменения общей
   схемы: панель показывает middle активным для divider без ключа в
   meta, выбор middle очищает ключ (`clearDefault`).
3. **HTML-оверлей — сегменты следуют за сдвигом.** Строка подписи i
   теперь лежит на строке `v_off + i`; сегменты строки `r` вычисляются
   от подписи `lines[r - v_off]` (вне диапазона — пустая строка, один
   div на всю ширину). Оба preview-пути правятся (0057, замечание 2).
4. **Дефолты нового блока — только `_blockDefaults` (editor.js).**
   Единственный источник дефолтов в обоих режимах (web: `addBlock` /
   drag-drop → API; static: тот же код → LocalStorageStore). API-дефолт
   `width=20` в Pydantic-схемах — общий для всех типов и не трогается
   (прецедент 0057: дефолт 20×1 тоже вводился только в редакторе).
5. **Совместимость.** Старые макеты не мигрируются (0057, замечание 4):
   divider с высотой больше числа строк подписи теперь рендерится со
   сдвигом к центру (раньше — со строки 0). Осознанное изменение
   вывода, данных не затрагивает.

# Выполнение задачи

## Python

- `services/renderer.py`:
  - `_draw_divider()`: `valign = meta.vertical_align` (absent/invalid →
    `middle`), `v_off = v_align_offset(len(lines), h, valign)`; строка
    подписи i рисуется на `y + v_off + i`, строки за нижней границей не
    рисуются (`i + v_off >= h` → break);
  - `_divider_segments_html()`: тот же `v_off`; подпись строки `r` —
    `lines[r - v_off]` (вне `[0, n)` — пустая строка).

## JS (parity)

- `core/renderer.js`: `drawDivider` / `dividerSegmentsHtml` — зеркала
  Python-изменений (parity побайтово).
- `core/properties.js`: `vertical_align` — `divider` добавлен в
  `types`, `typeDefaults: { divider: "middle" }`; `clearDefault`
  сохранён (выбор middle у divider очищает ключ).
- `editor.js`: `_blockDefaults("divider")` →
  `{ width: 30, height: 1, content: "[divider]" }`.

## Тесты

- `tests/test_renderer.py` — 5 ASCII-тестов (дефолт middle, top,
  bottom, многострочный блок со сдвигом, переполнение без сдвига) +
  1 HTML-тест (сегменты на средней строке по умолчанию / на первой при
  `top`).
- `tests/js/test_renderer.js` — зеркала тех же 5 + 1 HTML-кейс.
- `tests/test_js_renderer_parity.py` — `test_parity_divider_ascii`:
  +6 кейсов (дефолт middle, top, bottom, многострочный, переполнение,
  комбинация с `text_align`), `test_parity_divider_html`: +4 кейса.
- `tests/js/test_properties.js` — schema: `vertical_align` включает
  `divider`, `typeDefaults` у обоих align-свойств; `readPropValue`:
  type-дефолт выигрывает у schema-дефолта (divider → middle/center,
  явное значение выигрывает у type-дефолта, box → top);
  `_blockDefaults`: divider → 30×1 `[divider]` (box/hline не изменились).

## Проверка

- `pytest tests/ --ignore=tests/e2e` — 229 passed;
- `node --test "tests/js/*.js"` — 303 passed;
- `pytest tests/e2e/` (сервер на :8000, `scripts/server.sh`) — 84 passed.

# Замечания

1. **Дефолты align у divider и box разные — осознанно.** `text_align`:
   divider → `center`, box → `left`; `vertical_align`: divider →
   `middle`, box → `top`. Оба дефолта — через `typeDefaults` (0051–
   0054), в рендерере дублируются как fallback при absent/invalid
   значении (рендерер не знает о схеме). При добавлении новых
   type-specific дефолтов править и схему, и оба рендерера.
2. **Сдвиг не меняет autosize.** `divider_fit_size` (0057) от
   выравнивания не зависит: строки подписи те же, только их позиции
   внутри сохранённого размера. Триггеры пересчёта не тронуты.
3. **Старые макеты: сдвиг к центру — осознанное изменение вывода.**
   Divider 30×3 с однострочной подписью теперь показывает подпись на
   средней строке (было — на первой). Миграция не планируется (как в
   0057, замечание 4).
4. **Кросс-ссылки:** 0057 (вариант E — база), todo-0003 (дизайн),
   0051–0054 (механизм `meta`/`typeDefaults`/`clearDefault`).
