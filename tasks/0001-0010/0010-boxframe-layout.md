# Суть проблемы

Окно редактора макета было разложено в 3 колонки: палитра компонентов | canvas-превью |
raw-текст, с общей верхней панелью (back-link + h1 + размер сетки + кнопка Refresh).
Это не соответствует целевому дизайну:

- raw-колонка занимает 1/3 экрана, сжимая рабочую область canvas;
- действия Export/Copy «спрятаны» внутри raw-колонки, а не в шапке;
- нет навигационных хлебных крошек (`projects ← project ← layout`);
- шапка редактора — общая для всех страниц, без контекста и действий.

Целевой дизайн — app-подобный интерфейс на весь вьюпорт: шапка с логотипом и действиями
+ 2 колонки (узкий сайдбар + широкая рабочая область).

# Задача

Переработать дизайн окна редактирования макета в соответствии с целевым макетом:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│[boxframe logo]                                           [Export... ] [Copy] │
│[projects] <- [project name] <- [layout name]                                 │
└──────────────────────────────────────────────────────────────────────────────┘
┌───────────────┐┌─────────────────────────────────────────────────────────────┐
│[components]   ││[content]                                                    │
│               ││                                                             │
│               ││                                                             │
│               ││                                                             │
│               ││                                                             │
└───────────────┘│                                                             │
 [element list ] │                                                             │
                 │                                                             │
                 │                                                             │
                 │                                                             │
                 └─────────────────────────────────────────────────────────────┘
```

- **Шапка**: логотип слева; справа кнопки `Export...` (dropdown: JSON/Markdown/ASCII)
  и `Copy`; ниже — хлебные крошки `projects ← project ← layout`.
- **Две колонки**: слева узкий сайдбар (`components` сверху + `element list` снизу),
  справа широкая область `content` (canvas-превью) на всю высоту.
- **Убрать** третью колонку с raw-текстом — доступ к псевдографике через `Copy` и `Export...`.

# План работ

- [x] Добавить в `base.html` блоки `{% block header %}` и `{% block main_class %}`
- [x] Добавить `.container--full` в `style.css` (полная ширина, без паддинга)
- [x] Перестроить `editor.html`: кастомная шапка + 2-колоночное тело
- [x] Вынести `Export...` (dropdown) и `Copy` в шапку
- [x] Добавить хлебные крошки `projects ← project ← layout`
- [x] Разделить сайдбар: `components` (сверху) + `element list` (снизу, со скроллом)
- [x] Убрать колонку raw-текста
- [x] Обновить селектор `copyRaw()` в `editor.js`
- [x] Проверить на живом сервере (отрендеренные страницы)

# Исследование

При анализе текущего кода обнаружено:

1. **`base.html`** — шапка захардкожена (не в блоке), `<main class="container">` фиксированный.
   Чтобы редактор подставил свою шапку и полную ширину, нужны переопределяемые блоки.
2. **`.container`** — `max-width: 1200px` + `padding: 24px`. Для app-страницы (редактор)
   нужна полная ширина вьюпорта → отдельный модификатор.
3. **Alpine-область** — `x-data="editorApp()"` висела на div внутри `{% block content %}`.
   Кнопки шапки (`Export`, `Copy`) должны вызывать методы `editorApp` (`exportAs`, `copyRaw`),
   значит вся шапка должна быть внутри той же Alpine-области → единый корень `x-data`
   на `<div class="editor-root">`, содержащий и шапку, и тело.
4. **Canvas-координаты** — `_measureCharSize()` и `_pixelToGrid()` в `editor.js` ищут
   `.canvas-container pre` и `.canvas-container`. Сервер рендерит
   `render-wrapper > pre + block-preview` внутрь `.canvas-container`. Структуру
   `.canvas-container` нужно сохранить, иначе drag/resize/overlay сломаются.
5. **`syncFromRaw()`** («Apply Changes») — stub: просто перечитывает данные с сервера.
   Колонку raw можно убирать без потери реальной функциональности.

# Выполнение задачи

Изменены 4 файла:

**`templates/pages/base.html`**:
- Обёрнул существующую шапку в `{% block header %}…{% endblock %}` (по умолчанию — как было).
- `<main class="{% block main_class %}container{% endblock %}">` — класс переопределяемый.
- Остальные страницы (projects, project) блоки не переопределяют → получают значения по умолчанию.

**`static/css/style.css`**:
- `.container--full { max-width: none; padding: 0; }` — полная ширина для app-страниц.

**`templates/pages/editor.html`** (полная переработка):
- `{% block header %}{% endblock %}` — пустая (редактор рисует свою шапку).
- `{% block main_class %}container container--full{% endblock %}`.
- Корень `<div x-data="editorApp()" class="editor-root">` — `height: 100vh`, flex-column.
- **Шапка** `.editor-header`:
  - верхний ряд: логотип + `.editor-header__actions` (dropdown `Export...` + кнопка `Copy`);
  - dropdown — вложенный `x-data="{ open: false }"` + `@click.outside`, пункты вызывают `exportAs(...)`.
  - нижний ряд: `.editor-header__breadcrumb` — `projects ← project ← layout` (текущий — bold).
- **Тело** `.editor-body` — grid `220px 1fr`:
  - `.editor-sidebar`: `.editor-components` (палитра, `flex-shrink: 0`) + `.editor-elements`
    (список, `flex: 1; overflow-y: auto`).
  - `.editor-content`: canvas-превью (`.canvas-container` сохранён).
- Удалены: верхняя панель (back-link/h1/Refresh), колонка raw (`.editor-raw`, `.raw-container`,
  `.raw-actions`), export-меню внутри raw.
- Сохранены все canvas-стили (`.render-wrapper`, `.drag-preview`, `.block-preview`,
  `.resize-handle`) — от них зависят JS и серверный HTML.

**`static/js/editor.js`**:
- `copyRaw()` — селектор кнопки изменён с `.raw-actions .btn:last-child` на `.copy-btn`
  (кнопка теперь в шапке).

## Проверка

`pytest` в среде блокируется недоступным классификатором безопасности, поэтому проверка
выполнена через живый сервер (порт 8000):

- `/layout/…` — отрендерился без ошибок (441 стр.). Новая структура на месте:
  `.editor-header` + крошки `projects ← my ← dd`, `.editor-components`/`.editor-elements`,
  canvas. Старые классы (`.editor-raw`, `.raw-container`, `.editor-layout`, `.back-link`,
  `Refresh`) отсутствуют.
- `/` и `/project/…` — дефолтная шапка сохранена (по 1 шт.), у редактора её нет (0 шт.) —
  дубля нет.

# Замечания

1. **Колонка raw убрана** — inline-редактирование псевдографики («Apply Changes») удалено.
   Это был stub (только перечитывал с сервера). Сам raw-вывод доступен через `Copy` (буфер)
   и `Export...` (JSON/MD/ASCII). Если нужен просмотр raw в рабочей области — добавить
   переключатель Preview/Raw в `.editor-content`.

2. **`syncFromRaw()` в `editor.js`** — теперь мёртвый код (кнопки «Apply Changes» нет).
   Можно удалить в следующей чистке.

3. **`base.html`** — блоки `header`/`main_class` обратно совместимы: страницы, которые их не
   переопределяют, получают дефолтную шапку и `.container`.

4. **Dropdown Export** — вложенный Alpine-скоуп + `@click.outside` (стандарт Alpine 3).
   Кнопка-триггер находится внутри `.dropdown`, чтобы клик по ней не закрывал меню
   через `@click.outside`.

5. **Верификация тестами** — e2e-тесты (`tests/e2e/`) проверяют только 404-страницы и index,
   дизайн редактора они не покрывают. Для UI-изменений стоит дополнить e2e-тест загрузкой
   реального layout и проверкой presence `.editor-header`/`.editor-sidebar`/`.editor-content`.
