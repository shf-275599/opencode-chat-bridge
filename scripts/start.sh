#!/bin/bash
# opencode-im-bridge-slim 一体化启动脚本
# 同时启动 opencode server + bridge bot

set -e
# 脚本在 scripts/ 下，项目根目录是上一级
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

# Load env from config directory
set -a && source config/.env.bot 2>/dev/null || source .env 2>/dev/null || true && set +a

PORT=${OPENCODE_SERVER_PORT:-4097}

echo "[start] Starting dedicated opencode server on port $PORT..."
opencode serve --port $PORT &
OPENCODE_PID=$!
echo "[start] opencode server PID: $OPENCODE_PID"

for i in $(seq 1 20); do
  if curl -s "http://127.0.0.1:$PORT/session/status" > /dev/null 2>&1; then
    echo "[start] opencode server ready"
    break
  fi
  echo "[start] Waiting for server... ($i/20)"
  sleep 1
done

echo "[start] Starting opencode-im-bridge-slim bot..."
bun run src/index.ts &
BOT_PID=$!
echo "[start] bot PID: $BOT_PID"

cleanup() {
  echo "[start] Shutting down..."
  kill $BOT_PID 2>/dev/null
  kill $OPENCODE_PID 2>/dev/null
  wait
  echo "[start] Done"
}
trap cleanup SIGTERM SIGINT

wait $BOT_PID
cleanup
