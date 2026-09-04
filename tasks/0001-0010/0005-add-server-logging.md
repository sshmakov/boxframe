# Суть проблемы

У сервера boxframe не было логирования — невозможно было отлаживать проблемы постфактум,
а ИИ-агент не имел доступа к истории запросов и ошибок.

# Задача

Добавить логирование FastAPI-сервера в файл `log/boxframe.log` для использования ИИ-агентом.

# План работ

- [x] Настроить Python logging с RotatingFileHandler
- [x] Добавить middleware для логирования HTTP-запросов
- [x] Добавить логи жизненного цикла приложения (lifespan)
- [x] Проверить корректную работу

# Исследование

- `logging.handlers.RotatingFileHandler` — автоматическая ротация по размеру (5 MB, 3 бэкапа)
- Middleware `@app.middleware("http")` — единственный способ логировать все запросы без изменения роутов
- Порядок инициализации: `app` должен быть создан **до** декоратора middleware
- Путь к лог-файлу: `Path(__file__).resolve().parent.parent / "log"` (от main.py → boxframe/ → boxframe/)

# Выполнение задачи

1. Добавлены импорты `logging`, `logging.handlers`, `pathlib.Path`
2. Настроены два handler'а: `RotatingFileHandler` в `log/boxframe.log` + `StreamHandler` в консоль
3. Формат: `%(asctime)s [%(levelname)s] %(name)s: %(message)s` (разные datefmt для файла/консоли)
4. Добавлен middleware `log_requests` — логирует `METHOD /path` до и после запроса со статус-кодом
5. Добавлены логи в `lifespan`: старт и готовность приложения
6. Исправлены два бага по ходу:
   - middleware размещён после создания `app` (иначе NameError)
   - путь к логам: `parent.parent` вместо `parent.parent.parent` (иначе лог уходил в `projects/log/`)

# Замечания

- Уровень `INFO` — для отладки можно понизить до `DEBUG` через `BOXFRAME_DEBUG` в config.py
- Middleware логирует все запросы, включая статические файлы — если станет шумно, добавить фильтр по `request.url.path`
- Лог-файл не добавлен в git (уже есть в `.gitignore` через `log/`)
- В будущем стоит добавить логирование ошибок (5xx) и времени обработки запросов
- Можно вынести путь к логам в `Settings` (config.py) для конфигурации через окружение
