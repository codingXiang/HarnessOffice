#!/bin/sh
# Chat on :4173 and the 3D visual on :4600. Hermes itself is not started here;
# point the chat page at your API base. Override HOST, CHAT_PORT, VISUAL_PORT.
set -eu
cd "$(dirname "$0")/.."
HOST="${HOST:-0.0.0.0}"
CHAT_PORT="${CHAT_PORT:-4173}"
VISUAL_PORT="${VISUAL_PORT:-4600}"
export HOST
export HARNESS_CHAT_URL="${HARNESS_CHAT_URL:-http://127.0.0.1:${CHAT_PORT}}"
export HARNESS_VISUAL_URL="${HARNESS_VISUAL_URL:-http://127.0.0.1:${VISUAL_PORT}}"

if [ ! -f vendor/agent-office/dist/public/index.html ]; then
  echo "3D client is not built. Run: npm run spike:office:client" >&2
fi

PORT="$VISUAL_PORT" node spike/agent-office/server.mjs &
visual_pid=$!
PORT="$CHAT_PORT" node demo/server.mjs &
chat_pid=$!
trap 'kill "$visual_pid" "$chat_pid" 2>/dev/null || true' INT TERM EXIT
wait "$chat_pid"
