# Суть проблемы

Проект нельзя было установить через `pip install boxframe`:
`pyproject.toml` не имел `[build-system]` и консольного entry point,
запуск — только вручную `uvicorn boxframe.main:app`. Кроме того, код
зависел от корня репозитория как рабочей директории:
`StaticFiles(directory="boxframe/static")`,
`Jinja2Templates(directory="boxframe/templates")`,
`LOG_DIR = <корень репо>/log` — в установленном пакете
(site-packages) всё это ломается: статика и шаблоны не находятся,
`mkdir` в site-packages падает с PermissionError. Релизного процесса
не было: ни схемы версионирования, ни конвейера публикации.

При верификации обнаружен латентный баг: все вызовы
`TemplateResponse` использовали старую сигнатуру Starlette
`TemplateResponse(name, context)`, удалённую в новых версиях. В
venv проекта starlette 0.38.6 (старая сигнатура работала), но
свежая установка тянет starlette 1.6.0, где все страницы
отдавали 500 (`TypeError: unhashable type: 'dict'`).

# Задача

Сделать boxframe публикуемым в PyPI через GitHub Actions:

- упаковка: build-бэкенд, wheel со static/templates, консольный
  entry point `boxframe`;
- работоспособность приложения из установленного пакета
  (абсолютные пути, лог-директория вне site-packages);
- схема версионирования и процесс релиза (semver + git-теги);
- CI/CD: тестовый гейт + публикация в PyPI/TestPyPI через
  Trusted Publishing (без API-токена);
- починка бага сигнатуры Starlette, найденного при верификации.

# План работ

- [x] Изучить текущее состояние: pyproject, main.py, Dockerfile,
      ветки/теги
- [x] `pyproject.toml`: `[build-system]` (hatchling), `readme`,
      `[project.scripts]`
- [x] `__init__.py`: `__version__` из метаданных пакета
      (единый источник — pyproject)
- [x] `main.py`: абсолютные пути static/templates, `log_dir` в
      Settings, `FastAPI(version=__version__)`, entry point `run()`
- [x] Миграция `TemplateResponse` на новую сигнатуру (6 вызовов)
- [x] `.github/workflows/publish.yml`: тестовый job + publish job
      (Trusted Publishing, тег → PyPI, ручной запуск → TestPyPI)
- [x] Верификация: `python -m build`, содержимое wheel,
      smoke-тест в чистом venv, pytest + node-тесты

# Исследование

1. **Hatchling подбирает пакет автоматически.** Имя проекта
   `boxframe` = каталог пакета `boxframe/` в корне — явная
   настройка `packages` не нужна. `static/` и `templates/` лежат
   внутри пакета, поэтому попадают в wheel; `__pycache__`
   исключается через .gitignore (hatchling использует VCS-ignore).
2. **Версия — единый источник.** Версия дублировалась в
   `pyproject.toml` и `FastAPI(version="0.1.0")`. Решение:
   `__version__` в `__init__.py` через `importlib.metadata`
   (читает метаданные установленного пакета; при запуске из
   исходников без установки — "0.0.0").
3. **Схема версий: semver + тег.** `MAJOR.MINOR.PATCH`: patch —
   фиксы, minor — фичи, major — breaking changes (формат
   псевдографики, API). До 1.0 breaking допустим в minor.
   Триггер релиза — тег `vX.Y.Z`; версия бампится в
   `pyproject.toml` релизным коммитом. Альтернатива — `hatch-vcs`
   (версия из тега) — отклонена как лишний build-инструмент для
   соло-проекта.
4. **Trusted Publishing вместо API-токена.** OIDC: workflow
   запрашивает `id-token: write`, издатель настраивается в
   настройках проекта PyPI (owner + repository). Секретов в
   GitHub нет — токен не может утечь.
5. **Расхождение версий: venv vs свежая установка.** В venv
   проекта starlette 0.38.6 / fastapi 0.115.0; свежая установка —
   starlette 1.6.0 / fastapi 0.141.1. Старая сигнатура
   `TemplateResponse(name, context)` в новом starlette удалена —
   все страницы 500. Новая сигнатура
   `TemplateResponse(request, name, context)` работает и со
   старым, и с новым (введена в 0.29), код стал
   версионезависимым. Вывод: упаковку нужно верифицировать в
   чистом venv, а не в проектном.
6. **LOG_DIR.** Старый путь `parent.parent / "log"` в
   site-packages — это `site-packages/log` (PermissionError на
   mkdir). Новое: `Settings.log_dir` (по умолчанию `log/` в CWD,
   override `BOXFRAME_LOG_DIR`) — согласовано с CWD-относительным
   `database_url`.
7. **Entry point.** `run()` в `main.py`: argparse (`--host`,
   `--port`, дефолты `0.0.0.0:8000` — как в Dockerfile) +
   `uvicorn.run("boxframe.main:app")`.

# Выполнение задачи

Изменено 4 файла (+49/−17), добавлено 2 (workflow, файл задачи).

**`pyproject.toml`**
- `[build-system]`: hatchling;
- `readme = "README.md"` (отображается на странице PyPI);
- `[project.scripts] boxframe = "boxframe.main:run"`.

**`boxframe/__init__.py`**
- `__version__` через `importlib.metadata`
  (PackageNotFoundError → "0.0.0").

**`boxframe/config.py`**
- `log_dir: str = "log"` (env `BOXFRAME_LOG_DIR`).

**`boxframe/main.py`**
- `BASE_DIR = Path(__file__).parent` — static/templates по
  абсолютным путям;
- `LOG_DIR` из settings (`mkdir(parents=True, exist_ok=True)`);
- `FastAPI(version=__version__)`;
- 6 вызовов `TemplateResponse` → новая сигнатура
  `TemplateResponse(request, name, context)` (`request` Starlette
  сам кладёт в контекст шаблона);
- `run()` — консольный entry point.

**`.github/workflows/publish.yml`**
- `test` job: `pytest tests/ --ignore=tests/e2e` +
  `node --test "tests/js/*.js"`;
- `publish` job (needs: test): `python -m build` →
  `pypa/gh-action-pypi-publish` (Trusted Publishing, без токена);
- триггеры: push тега `v*` → PyPI; `workflow_dispatch` → по
  умолчанию TestPyPI (безопасная проверка).

## Проверка

- `python -m build` — wheel + sdist; в wheel: все модули,
  `static/`, `templates/`, entry point; `__pycache__` не попал.
- Чистый venv: `pip install` wheel → `boxframe --help` → сервер
  из каталога, отличного от корня репо: `/` 200, страница проекта
  200, 404-страницы 404, статика 200, `openapi.json` version
  0.1.0.
- `pytest tests/ --ignore=tests/e2e` — **110 passed**.
- `node --test tests/js/*.js` — **87 passed**.

# Замечания

1. **Перед первым релизом проверить доступность имени.**
   `boxframe` может быть занят на PyPI — тогда потребуется
   переименование пакета (pyproject, импорты, entry point).
2. **Trusted Publishing настраивается вручную** на обоих
   сайтах (PyPI и TestPyPI): *Publishing → Add publisher* →
   owner = GitHub-аккаунт, repository = `boxframe`. До этого
   publish job упадёт с 403.
3. **Релизы режутся с `develop`** (де-факто основная ветка, с неё
   же деплоится Pages). Если позже введут дисциплину
   `develop` → `master`, ветку релизов нужно перенести на
   стабильную.
4. **e2e не в CI-гейте.** E2E-тестам нужен запущенный сервер на
   :8000 (и по AGENTS.md они должны гоняться отдельным процессом
   от API-тестов). При необходимости — отдельный job: uvicorn в
   фоне, ожидание готовности, `pytest tests/e2e`.
5. **Венв проекта старше свежей установки** (starlette 0.38.6 vs
   1.6.0) — из-за этого баг TemplateResponse жил незаметно.
   Правило: упаковку и «пользовательские сценарии» проверять в
   чистом venv; периодически обновлять зависимости в venv.
6. **Версия в `pyproject.toml` осталась 0.1.0.** 0.1.0 никуда не
   публиковался, поэтому первый релиз можно делать как 0.1.0;
   изменения упаковки для пользователей не breaking (пользователей
   ещё не было).
7. **Кавычки вокруг glob в CI ломают `node --test`.**
   `node --test "tests/js/*.js"` в bash: кавычки запрещают
   раскрытие glob, node получает литерал `tests/js/*.js`. На
   node ≥ 21 тест-раннер сам раскрывает glob (локально node 24 —
   работало), на node 20 (CI) — нет: `Could not find .../*.js`,
   exit 1. Фикс: glob без кавычек (раскрывает bash на любой
   версии node) + node 24 в CI (node 20 — EOL с 04.2026).
   Общий урок: CI-окружение (версии node/python) расхожилось с
   локальным — те же корневые причины, что и баг Starlette из
   «Исследование» №5.
