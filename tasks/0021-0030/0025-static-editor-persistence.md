# Суть проблемы

Статический редактор (без бэкенда, `static/editor/index.html`) хранил
макет только в памяти: при перезагрузке страницы (F5, закрытие вкладки)
все блоки терялись. `MemoryStore` был создан осознанно «in-memory, state
is lost on reload (by design for now)» — но для реального использования
без бэкенда потеря работы при любом reload делает редактор неудобным:
пользователь не может собрать макет постепенно, перезагружая страницу.

Отдельная проблема: в статическом редакторе не было способа очистить
весь макет разом — только удаление блоков по одному (каждое со своим
`confirm`). Для «начать заново» приходилось кликать × по каждому
элементу.

# Задача

- Сохранять макет статического редактора в `localStorage`: блоки должны
  переживать перезагрузку страницы.
- Добавить кнопку очистки всего макета с дополнительным подтверждением
  (чтобы случайный клик не стёр работу).

# План работ

- [x] `store.js`: вынести ядро `createMemoryStore` в `createLayoutStore`
      с хуком `onMutate`; добавить `clear()`
- [x] `store.js`: новый `createLocalStorageStore` (restore при создании,
      save после каждой мутации, injectable storage)
- [x] `editor.js`: static-режим → `createLocalStorageStore`; метод
      `clearLayout()` с `confirm`
- [x] `static/editor/index.html`: кнопка Clear + обновлённый breadcrumb
- [x] Тесты: `tests/js/test_store.js` (node:test) + e2e (persistence,
      clear с подтверждением)
- [x] Прогнать полный набор тестов (unit + API + JS + e2e)
- [x] Обновить `AGENTS.md` (раздел «Статический режим», структура)

# Исследование

1. **Слой персистентности уже изолирован** — `editor.js` не знает о
   fetch и работает через единый async-интерфейс store
   (`info/load/render/createBlock/updateBlock/deleteBlock/export`).
   Персистентность — это свойство конкретного store, а не редактора:
   достаточно заменить `createMemoryStore()` на новый store в `init()`,
   редактор менять почти не пришлось.
2. **Логика layout переиспользуется** — `createMemoryStore` держал
   `layout`, `maxOrder()`, `normalizeLine()`, `buildExportJson()`.
   Вместо дублирования для localStorage-варианта ядро вынесено в
   `createLayoutStore(options, onMutate)`: `onMutate(snapshot)` вызывается
   после каждой мутации. `MemoryStore` — обёртка с `onMutate = null`,
   `LocalStorageStore` — обёртка с `onMutate = save в storage`.
3. **`localStorage` недоступен в Node** (без `--experimental-webstorage`)
   и может бросать исключения в браузере (QuotaExceeded, private mode,
   `file://`). Поэтому: (а) `options.storage` — injectable
   `{ getItem, setItem }` для тестов; (б) `typeof localStorage !==
   "undefined"` — graceful fallback в in-memory; (в) `try/catch` вокруг
   `setItem` — сбой сохранения не ломает редактирование (warn в консоль).
4. **Корrupted JSON в storage** — `readSavedState()` оборачивает
   `JSON.parse` в `try/catch` и проверяет `Array.isArray(state.blocks)`;
   любое несоответствие → `null` → пустой макет (редактор не падает на
   мусоре в storage).
5. **`clear()` — только у memory/local сторов** — у `FetchStore` очистки
   нет (web-редактор с бэкендом не трогается). `editor.js` проверяет
   `typeof this.store.clear === "function"` перед вызовом, поэтому одна
   и та же кнопка/метод безопасны в обоих режимах.

# Выполнение задачи

Изменено 4 исходных файла + 2 тестовых + `AGENTS.md`:

**`boxframe/static/js/core/store.js`**
- `createMemoryStore` → ядро `createLayoutStore(options, onMutate)`:
  `snapshot()` (глубокая копия `{ width, height, blocks }`), `mutate()`
  (вызывает `onMutate`), вызовы `mutate()` в `createBlock`/`updateBlock`/
  `deleteBlock`; новый метод `clear()` (сброс `width/height/blocks`).
- `createMemoryStore(options)` — тонкая обёртка (`onMutate = null`,
  `mode = "memory"`).
- `createLocalStorageStore(options)`: `options.key` (дефолт
  `boxframe.static.layout`), `options.storage` (дефолт — глобальный
  `localStorage`, если есть). При создании читает сохранённое состояние
  (`readSavedState`), после каждой мутации пишет `JSON.stringify` в
  storage. `mode = "local"`, `storageKey = key`.
- `readSavedState(storage, key)` — безопасное чтение: `try/catch` на
  `getItem` и `JSON.parse`, валидация `blocks`-массива.
- Экспортирован `createLocalStorageStore` (global + CommonJS).

**`boxframe/static/js/editor.js`**
- `init()`: static-режим (нет `data-layout-id`) →
  `createLocalStorageStore()` (было `createMemoryStore()`).
- `clearLayout()`: `if (typeof this.store.clear !== "function") return;`
  → `confirm('Clear the entire layout? All blocks will be removed.')`
  → `store.clear()` → сброс `blocks`, `selectedBlockId`, `editingBlock`
  → `refreshRender()`.

**`boxframe/static/editor/index.html`**
- Кнопка Clear в шапке: `class="clear-layout-btn"`,
  `x-show="blocks.length > 0"` (видна только когда есть блоки),
  `@click="clearLayout()"`.
- Breadcrumb: «no backend, layout is saved in your browser
  (localStorage)» (было «data lives in memory and is lost on reload»).

**`AGENTS.md`** — раздел «Статический режим» и структура: упомянут
`LocalStorageStore` (key, `options.storage`, `clear()` только у
memory/local), static-режим → `LocalStorageStore`, добавлен
`tests/js/test_store.js`.

**Тесты**
- `tests/js/test_store.js` (node:test, 9 тестов): memory CRUD + `clear`;
  local persist create/update/delete, restore между «сессиями» (один
  storage, два store), `clear()` очищает и layout и storage, corrupted
  JSON → пусто, storage без `blocks` → пусто, сбой `setItem` не ломает
  мутацию, без storage ведёт себя как memory.
- `tests/e2e/test_editor.py`: `test_static_editor_persists_layout_in_
  localstorage` (блок переживает `page.reload()`),
  `test_static_editor_clear_layout_with_confirmation` (dismiss → макет
  цел, accept → пусто, и после reload пусто).

## Проверка

- `node --test tests/js/*.js` — **62 passed** (renderer + store).
- `pytest tests/ --ignore=tests/e2e` — **103 passed** (unit + API).
- `pytest tests/e2e/` (сервер на :8000) — **33 passed** (включая 2 новых).

# Замечания

1. **Главный вывод: персистентность — свойство store, а не редактора.**
   Благодаря изолированному async-интерфейсу добавление localStorage
   не потребовало менять логику редактора — только выбор store в `init()`
   и один метод `clearLayout()`. Это подтверждает правильность
   архитектуры задачи 0018 (store-абстракция): новые режимы хранения
   добавляются без каскадных правок.
2. **Ядро + хук `onMutate` вместо наследования/дублирования.** `MemoryStore`
   и `LocalStorageStore` — две тонкие обёртки над одним
   `createLayoutStore`. Любая будущая правка логики layout (новые поля,
   правила) вносится в одном месте и автоматически действует на оба
   режима.
3. **`clear()` намеренно отсутствует у `FetchStore`.** Очистка всего
   макета — операция статического режима. Если понадобится в web-режиме,
   это отдельная задача: нужен либо DELETE всех блоков по одному, либо
   новый API-роут (сейчас его нет).
4. **Один key на браузер.** `boxframe.static.layout` — единый ключ, т.е.
   статический редактор хранит один макет на origin. Если захочется
   несколько независимых макетов без бэкенда — key должен стать
   параметризованным (например, по имени/ID макета) + UI выбора макета.
5. **`clear()` сбрасывает и `width`/`height`.** В статическом режиме
   размеры всегда null (задача 0024), так что на практике это не влияет;
   но если статический редактор когда-нибудь начнёт принимать размеры,
   «очистить всё» корректно вернёт и их в null.
6. **Robustness storage — осознанный минимум.** Обработаны: отсутствие
   `localStorage`, corrupted JSON, сбой `setItem`. Не обрабатывается
   (и не нужно для MVP): конкурентная запись из двух вкладок (последняя
   выигрывает), quota-лимиты (warn). Если это станет проблемой —
   `storage.event` / `beforeunload`-флаги.
7. **Кнопка Clear видна только при наличии блоков**
   (`x-show="blocks.length > 0"`) — нет смысла предлагать очистить
   пустой макет; при этом `clearLayout()` сам по себе безопасен в любом
   состоянии.
