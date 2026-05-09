#!/usr/bin/env bash
# Запускает локальный HTTP-сервер и открывает приложение в браузере.
# Использование: ./serve.sh [порт]

PORT=${1:-8765}
URL="http://127.0.0.1:${PORT}"

echo "🚌 Montevideo Bus Map"
echo "➜  Сервер: ${URL}"
echo "   Ctrl+C для остановки"
echo ""

# Открыть браузер (через 1 секунду, чтобы сервер успел запуститься)
(sleep 1 && xdg-open "${URL}" 2>/dev/null || open "${URL}" 2>/dev/null) &

python3 -m http.server "${PORT}" --bind 127.0.0.1
