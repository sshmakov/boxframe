# Суть проблемы

Импорт JSON-макета работает только через кнопку Import (скрытый
`<input type="file">` → `onImportFile` → `_applyImport`). Перетаскивание
файла из ОС на страницу не поддерживается:

- на canvas — `@dragover.prevent` отменяет дефолтное поведение, а
  `onCanvasDrop` сразу выходит (`dragMode !== 'palette'`), файл
  игнорируется;
- в любое другое место страницы (сайдбар, шапка) — срабатывает дефолтное
  поведение браузера: страница переходит по пути к файлу, JSON
  открывается как документ во вкладке, редактор перезагружается (в
  web-режиме состояние макета теряется; в static-режиме layout жив в
  localStorage, но вкладка всё равно заменяется).

# Задача

Добавить drag-and-drop импорт: файл, перетащенный **в любое место
страницы**, импортируется тем же путём, что и кнопка Import
(`_applyImport`: confirm add/replace при непустом редакторе, одна запись
undo/redo). Навигация браузера на файл отключается. Оба редактора (web +
static) — общая логика.

# План работ

- [x] Составить план работ
- [x] editor.js: document-level обработчики dragover/drop/dragleave
- [x] editor.css: оверлей-подсказка во время drag файла
- [x] e2e-тесты (drop на пустой static, на canvas, на сайдбар, оверлей)
- [x] Прогнать сьюты (JS, e2e)

# Исследование

- Импорт — один путь: `onImportFile` (из file input) читает файл и
  передаёт текст в `_applyImport(text)` (parse → confirm add/replace →
  `store.replaceState`). Drop-обработчику достаточно прочитать файл и
  вызвать тот же `_applyImport` — вся логика (confirm, undo/redo,
  add/replace) переиспользуется без изменений.
- Drag-события в редакторе уже используются для перетаскивания из
  палитры: палитра несёт `e.dataTransfer.setData('text/plain', type)`,
  canvas обрабатывает `dragover`/`drop` только при `dragMode ===
  'palette'`. Файл из ОС несёт `'Files'` в `dataTransfer.types` —
  надёжный признак отличить внешний файл от внутреннего drag'а.
- Canvas-обработчик `onCanvasDrop` при дропе файла выходит сразу
  (`dragMode !== 'palette'`), но `@dragover.prevent` уже отменил
  дефолт → файл молча игнорируется. Document-level слушатель (bubble)
  срабатывает после canvas-обработчика и перехватывает дроп файла.
- Playwright 1.62 (`locator.drop({files: [...]})`) — синтетический
  DataTransfer с файлами, dragenter/dragover/drop в центре элемента;
  если dragover не вызвал preventDefault — drop считается отклонённым и
  метод бросает исключение. Тесты дропа файлов пишутся без эмуляции
  мыши.
- `dragleave` на document: `relatedTarget` — null только при уходе из
  окна, при движении между дочерними элементами задан → класс
  подсветки снимается корректно, без мерцания.

# Выполнение задачи

- `boxframe/static/js/editor.js` (общий для обоих редакторов):
  - `_isFileDrag(e)` — `'Files'` в `e.dataTransfer.types`;
  - `_bindFileDrop()` — слушатели на document:
    - `dragover` (файл) → `preventDefault` (отключает навигацию браузера
      на файл) + класс `file-drop-active` на body;
    - `drop` (файл) → `preventDefault`, снять класс, первый файл из
      `dataTransfer.files` читать `FileReader`'ом → `_applyImport(text)`
      (тот же путь, что кнопка Import);
    - `dragleave` (без `relatedTarget`) → снять класс.
  - вызов `_bindFileDrop()` в `init()` рядом с `_bindGlobalMouseUp`.
- `boxframe/static/css/editor.css`: `body.file-drop-active::after` —
  полноэкранная пунктирная рамка с подписью «Drop the file to import the
  layout» (`position: fixed; inset: 0; z-index: 500` — выше модалки;
  `pointer-events: none` — дроп достаётся странице под оверлеем).
- `tests/e2e/test_editor.py`:
  - хелпер `_drop_file(page, selector)` — `locator.drop()` с буфером
    JSON (тот же `IMPORT_JSON`, что у `_import_file`);
  - `test_static_editor_file_drop_imports_into_empty` — дроп на пустой
    static-редактор: 2 блока на канве и в списке;
  - `test_web_editor_file_drop_on_canvas_imports` — дроп **на canvas**
    (у которого свой drop-обработчик палитры): replace (Cancel),
    2 блока в БД + страница осталась на `/layout/...` (браузер не
    открыл файл);
  - `test_web_editor_file_drop_on_sidebar_adds_blocks` — дроп вне canvas
    (на сайдбар): add (OK), исходный блок сохранился;
  - `test_file_drop_overlay_shows_while_dragging` — синтетический
    `DragEvent('dragover')` с DataTransfer-файлом → класс
    `file-drop-active` на body; `dragleave` с `relatedTarget: null` →
    класс снят.

Всё выполнено, не получилось — ничего.

Приёмка: `node --check boxframe/static/js/editor.js` — ок;
`node --test "tests/js/*.js"` — 275 pass; `pytest tests/e2e/` — 84
passed (включая все существующие drag/import-тесты: палитра и
canvas-драги не пострадали).

# Замечания

1. Обработчики на document (bubble), а не на body/контейнере: дроп
   файла ловится в любом месте страницы, включая canvas, у которого
   свой drop-обработчик для палитры. Порядок: canvas-обработчик
   (`dragMode !== 'palette'` → выход) → document-обработчик (файл →
   импорт). Конфликта нет: палитра несёт `text/plain`, файл — `Files`.
2. `preventDefault` на `dragover` — обязательное условие, чтобы браузер
   вообще разрешил drop (и чтобы не навигировал на файл). Для
   внутренних drag'ов (палитра) он не вызывается — их поведение не
   меняется.
3. Оверлей `pointer-events: none` — как и overlay модалки (0054): дроп
   должен достаться странице, а не подсказке. z-index 500 — выше
  модалки (300), чтобы подсказка была видна при открытом диалоге.
4. Читаются только **первый** файл (как в `onImportFile`); несколько
   файлов — не поддерживается (согласовано с поведением кнопки).
5. Ошибки чтения/разбора — те же alert'ы, что у кнопки Import
   (`_applyImport` общий) — поведение едино.
6. `dragleave` с `relatedTarget` (движение между элементами) класс не
   снимает — подсветка не мерцает при перемещении по странице.
