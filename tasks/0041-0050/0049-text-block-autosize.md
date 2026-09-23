# Суть проблемы

Блок `text` вёл себя как обычный контейнер: создавался с фиксированным
размером (по умолчанию 8×2), нес «лишнюю» рамку `solid` и не подстраивался
под содержимое. Чтобы разместить строку текста, нужно было вручную
подбирать ширину/высоту — а перенос слов в псевдографике не применяется,
поэтому текст длиннее блока просто обрезался. Для типа, который существует
ради текста, это лишняя ручная работа.

# Задача

Изменить поведение элемента `text`:

- по умолчанию высота 1 (она же минимально возможная — и минимальная
  ширина тоже 1);
- рамки нет по умолчанию (`border_style=none`);
- autosize по ширине и высоте, чтобы вместить весь текст, учитывая рамку,
  если она включена.

Поведение должно быть одинаковым в web-режиме (API) и static-режиме
(JS-стор) — инвариант parity проекта.

# План работ

- [x] Составить план работ
- [x] Функция fit-размера `text_block_size()` в `services/renderer.py`
      (+ JS-порт `textBlockSize()` в `core/renderer.js`);
- [x] Дефолт рамки по типу: `text` → `none`, остальные → `solid`
      (Pydantic-схемы `str | None = None` + `default_border_style()` в
      сервисе; в JS-сторе — `||`-выражение);
- [x] Autosize в `LayoutService`: `create_block`, `update_block`,
      `batch_blocks` (create + update);
- [x] Autosize в JS-сторе: `createBlock`, `updateBlock`, `batchBlocks`
      (create + update);
- [x] Редактор: дефолт `text` в палитре (1×1, без рамки), min 1×1 при
      resize (одиночный + групповой), merge-back результата
      `updateBlock` в `_commitEdit`;
- [x] Тесты: `tests/test_renderer.py`, `tests/api/test_layouts.py`,
      `tests/js/test_renderer.js`, `tests/js/test_store.js`,
      parity `tests/test_js_renderer_parity.py`;
- [x] Проверка: `pytest tests/ --ignore=tests/e2e`,
      `node --test "tests/js/*.js"`.

# Исследование

1. **Прецедент нормализации.** `hline`/`vline` уже нормализуются до
   толщины 1 (`LayoutService.create_block` + `normalizeLine` в
   `core/store.js`) — autosize для `text` встраивается в тот же паттерн:
   размер пересчитывается сервисом/стором, а не клиентом.
2. **Fit-размер.** Перенос слов не применяется, поэтому размер текста —
   самая длинная явная строка × число явных строк. Пустой контент — одна
   пустая строка (1×1 без рамки). Рамка любого стиля ≠ `none` добавляет
   1 клетку с каждой стороны (+2/+2). Результат клампится к минимуму 1×1.
3. **Когда пересчитывать.** Три триггера: создание (всегда для `text`),
   обновление `content`, `border_style` или `block_type` (перевод другого
   типа в `text`). Обновление только x/y/width/height — это **ручной**
   resize и сохраняется до следующего изменения содержимого.
   `replace_blocks` (полная замена при undo/redo) размер **не**
   пересчитывает — иначе undo/redo ломал бы вручную выставленные размеры.
4. **Дефолт рамки.** У всех типов дефолт `solid`; у `text` — `none`.
   Реализовано через `None`-сентинел в create-схемах
   (`border_style: str | None = None`) — явный `none` в payload и
   «не передано» дают один и тот же результат для `text`, а для остальных
   типов `None` → `solid`.

# Выполнение задачи

## Python

- `services/renderer.py` — `text_block_size(content, border_style) ->
  tuple[int, int]` (модульная функция, рядом с `_fmt_px`).
- `services/layout_service.py`:
  - `default_border_style(block_type)` — `none` для `text`, иначе `solid`;
  - `create_block`: `border_style: str | None = None`, ветка
    `elif block_type == "text": width, height = text_block_size(...)`;
  - `update_block`: после нормализации линий — ветка
    `elif block.block_type == "text" and ("content" in kwargs or
    "border_style" in kwargs or "block_type" in kwargs)`;
  - `replace_blocks`: дефолт рамки через `default_border_style`,
    пересчёт размера **нет** (комментарий: undo/redo восстанавливает
    сохранённый размер как есть);
  - `batch_blocks`: create — дефолт рамки + fit-размер; update — то же
    условие, что в `update_block`.
- `api/layouts.py`: `BlockCreate`/`BlockIn`/`BatchBlockCreate` —
  `border_style: str | None = None` (None → дефолт по типу).

## JS (parity)

- `core/renderer.js` — `textBlockSize(content, borderStyle)` (порт
  `text_block_size`), экспортируется в `PGRenderer`.
- `core/store.js`:
  - `normalizeText(block)` + `textAutosizeTriggered(props)`;
  - `createBlock`: `border_style: data.border_style || (data.block_type
    === "text" ? "none" : "solid")` + `normalizeText` после
    `normalizeLine`;
  - `updateBlock`: `if (textAutosizeTriggered(props)) normalizeText(block)`;
  - `batchBlocks`: create + update — то же.
- `editor.js`:
  - `_blockDefaults("text")` — `textBlockSize('[text]', 'none')` → 6×1,
    `content: '[text]'`, `border_style: 'none'`;
  - `onCanvasDrop`/`addBlock` — передают `border_style` из дефолтов;
  - `_commitEdit` — `Object.assign(block, updated)` (merge-back: autosize
    мог изменить размер блока);
  - min-размер при resize: `text` → 1×1 (одиночный mousemove-путь и
    групповой commit-путь).

## Тесты

- `tests/test_renderer.py` — 2 unit-теста `text_block_size` (без рамки:
  (1,1)/(2,1)/(5,2)/(4,2)/(1,2); с рамкой: (2,3)/(4,3)/(4,3)/(7,4)).
- `tests/api/test_layouts.py` — 10 тестов: дефолт рамки (`none` для
  text, `solid` для box), autosize при создании (50×5 → 2×1; "hi"+solid →
  4×3; пустой → 1×1), re-fit при обновлении content/border, ручной resize
  сохраняется (10×3; x-only; следующий content → 3×1), перевод box →
  text, batch-нормализация.
- `tests/js/test_renderer.js` — зеркала unit-тестов `textBlockSize`.
- `tests/js/test_store.js` — 6 тестов (дефолты, autosize с рамкой,
  re-fit по content/border, ручной resize, batch).
- `tests/test_js_renderer_parity.py` — `test_parity_text_block_size`:
  10 кейсов (пустой/hi/многострочный/trailing-newline/пробелы ×
  none/solid/double/dashed/dotted), Python ↔ JS побайтово.
- `tests/js/test_editor.js` — обновлён тест
  `_commitBlockResize: a child keeps relative coordinates to its parent`:
  text-минимум теперь 1, коммит `{x: 2, y: 4, width: 10, height: 1}`
  (ранее 2×2 при минимуме 2).

## Проверка

- `pytest tests/ --ignore=tests/e2e` — 151 passed (+13: renderer, API,
  parity);
- `node --test "tests/js/*.js"` — 199 passed (+12: renderer, store).

# Замечания

1. **Fit-размер — общая функция рендерера.** `text_block_size`/
   `textBlockSize` живут в рендерерах (а не в сервисах/сторах), потому
   что это свойство самого формата псевдографики. Парность закреплена
   parity-тестом — править только вместе.
2. **`replace_blocks` не пересчитывает.** Осознанное решение: undo/redo
   восстанавливает сохранённый размер как есть, включая «ручные» размеры
   text-блоков. Если когда-нибудь захотим, чтобы undo/redo тоже
   подгонял — менять нужно и Python, и JS, и тесты.
3. **Минимум 1×1 для text в редакторе** — в двух местах
   (`onCanvasMouseMove` одиночный resize и `_commitBlockResize`
   групповой). При добавлении новых типов с особым минимумом помнить про
   обе ветки.
4. **`_commitEdit` теперь merge-back.** Результат `updateBlock`
   подмешивается в локальный блок — для text это источник актуального
   размера после autosize. Не возвращаться к `block.content = newContent`
   без merge.
