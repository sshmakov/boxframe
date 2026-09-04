# Суть проблемы

Кнопка **"+ New Layout"** на странице проекта не открывала форму создания layout.
При клике ничего не происходило — форма оставалась скрытой.

Причина: кнопка находилась **внутри** `<div x-show="showNew">`, который скрыт через CSS
(`display: none`). Alpine.js не мог показать элемент, который сам же скрывал.
Кроме того, API-маршрут `POST /api/projects/{id}/layouts` отсутствовал — возвращал 404.

# Задача

1. Исправить кнопку "+ New Layout" на странице проекта
2. Добавить отсутствующий API-маршрут создания layout
3. Написать E2E-тесты для кнопки и формы
4. Обновить AGENTS.md

# План работ

- [x] Исследовать шаблон `project.html` и найти причину неработоспособности кнопки
- [x] Исправить Alpine.js структуру (вынести кнопку за пределы x-show)
- [x] Добавить маршрут `POST /{project_id}/layouts` в `api/projects.py`
- [x] Написать E2E-тесты на toggle формы и создание layout
- [x] Обновить AGENTS.md
- [x] Прогнать полный тестовый набор

# Исследование

1. **Анализ шаблона** — кнопка `+ New Layout` находилась внутри `<div x-data="..." x-show="showNew">`.
   Alpine.js `x-show` устанавливает `display: none`, делая кнопку невидимой для DOM и для Playwright.
   Это классическая ошибка: нельзя показать скрытый элемент через клик по самому скрытому элементу.

2. **Анализ API** — маршрут создания layout был только в `layouts.py` с префиксом `/api/layouts/`,
   но шаблон обращался к `/api/projects/{id}/layouts`. FastAPI возвращал 404.

3. **Playwright-тесты** — `page.get_by_role("button", name="+ New Layout")` таймаутился,
   потому что кнопка была в `display: none`. Playwright не может кликнуть на невидимый элемент.

# Выполнение задачи

## Фикс шаблона `project.html`

Переструктурировал Alpine.js блок:
- Вынес кнопку `+ New Layout` за пределы `x-show`
- Добавил кнопке `x-show="!showNew"` — скрывается при открытой форме
- Обернул форму в отдельный `<div x-show="showNew">`

Теперь кнопка всегда видна, а форма появляется по клику.

## Добавлен маршрут в `api/projects.py`

```python
@router.post("/{project_id}/layouts", response_model=LayoutOut)
async def create_layout(project_id: str, data: LayoutCreate, db: AsyncSession = Depends(get_db)):
    """Create a new layout for a project."""
    service = LayoutService(db)
    layout = await service.create_layout(project_id, data.name, data.width, data.height)
    return layout
```

## Написаны E2E-тесты

- `test_new_layout_button_toggles_form` — проверяет, что кнопка открывает/закрывает форму
  с полями name, width, height
- `test_new_layout_submit_creates_layout` — полный сценарий: создание проекта → открытие формы
  → заполнение → создание layout → редирект на `/layout/{uuid}`

## Обновлён AGENTS.md

Структура `tests/` теперь отражает реальное состояние:
- `api/` — unit-тесты
- `e2e/` — Playwright тесты
- `conftest.py` — API-файстуры

## Результаты тестов

Все **38 тестов** прошли:
- 14 API-тестов (projects + layouts)
- 5 E2E-тестов (editor + projects)
- 10 тестов рендерера

# Замечания

1. **Alpine.js `x-show`** — элементы внутри `x-show` скрыты через CSS `display: none`.
   Кнопки управления формой должны быть **вне** `x-show` блока с `x-show="!showNew"`.
   Это паттерн, применённый в `projects.html` для "New Project" — его нужно копировать.

2. **Playwright `to_have_url()`** — принимает `re.Pattern`, а не regex-строку.
   Используйте `re.compile()` для проверки URL по регулярке.

3. **Дублирование Pydantic-моделей** — `LayoutCreate` определён и в `projects.py`, и в `layouts.py`.
   В будущем стоит вынести общие DTO в отдельный модуль (например, `api/schemas.py`).

4. **Баг в `editor.html`** — переменная `blocks` не определена, страница редактора возвращает 500.
   Не связано с этой задачей, но обнаружено при тестировании.
