#!/usr/bin/env bash
# Dev-сервер boxframe: запуск / проверка / остановка.
# Использование:
#   bash scripts/server.sh start    # запустить в фоне (no-op, если уже работает)
#   bash scripts/server.sh check    # exit 0, если сервер отвечает на :8000
#   bash scripts/server.sh stop     # остановить
#   bash scripts/server.sh restart  # stop + start
#   bash scripts/server.sh logs     # tail -f log/server.log
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PORT="${PORT:-8000}"
URL="http://127.0.0.1:${PORT}"
PIDFILE="tmp/server.pid"
LOG="log/server.log"
PY=".venv/bin/python"

is_up() {
    curl -s -o /dev/null --max-time 2 "${URL}/"
}

# PID живого сервера из pidfile (пусто/не-0, если нет)
live_pid() {
    [[ -f "${PIDFILE}" ]] || return 1
    local pid
    pid=$(cat "${PIDFILE}" 2>/dev/null || true)
    [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null && echo "${pid}"
}

wait_ready() {
    for _ in $(seq 1 60); do
        is_up && return 0
        sleep 0.5
    done
    return 1
}

cmd_start() {
    local pid
    if pid=$(live_pid); then
        echo "уже запущен (pid ${pid})"
        return 0
    fi
    rm -f "${PIDFILE}"
    mkdir -p tmp log
    nohup "${PY}" -m uvicorn boxframe.main:app --port "${PORT}" >>"${LOG}" 2>&1 &
    echo $! >"${PIDFILE}"
    if wait_ready; then
        echo "запущен (pid $(cat "${PIDFILE}"), лог ${LOG})"
    else
        echo "ERROR: сервер не ответил — смотрите ${LOG}" >&2
        rm -f "${PIDFILE}"
        exit 1
    fi
}

cmd_check() {
    local pid
    if is_up; then
        pid=$(live_pid || true)
        echo "up: ${URL} (pid ${pid:-unknown})"
        return 0
    fi
    echo "down: ${URL}" >&2
    return 1
}

cmd_stop() {
    local pid
    if pid=$(live_pid); then
        kill "${pid}" 2>/dev/null || true
        for _ in $(seq 1 20); do
            kill -0 "${pid}" 2>/dev/null || break
            sleep 0.25
        done
        if kill -0 "${pid}" 2>/dev/null; then
            kill -9 "${pid}" 2>/dev/null || true
        fi
        rm -f "${PIDFILE}"
        echo "остановлен (pid ${pid})"
    else
        rm -f "${PIDFILE}"
        echo "не запущен"
    fi
}

case "${1:-}" in
    start)   cmd_start ;;
    check)   cmd_check ;;
    stop)    cmd_stop ;;
    restart) cmd_stop; cmd_start ;;
    logs)    tail -f "${LOG}" ;;
    *) echo "usage: $0 {start|check|stop|restart|logs}" >&2; exit 2 ;;
esac
