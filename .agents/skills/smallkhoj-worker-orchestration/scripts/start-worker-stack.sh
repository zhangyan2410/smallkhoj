#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${SMALLKHOJ_ROOT:-/Users/code/project/smallkhoj}"
BACKEND_PORT="${SMALLKHOJ_BACKEND_PORT:-8000}"
DAEMON_PORT="${SMALLKHOJ_DAEMON_PORT:-3457}"
DB_PORT="${SMALLKHOJ_DB_PORT:-55432}"
DB_CONTAINER="${SMALLKHOJ_DB_CONTAINER:-smallkhoj-test-db}"
WORKER_PROVIDER="${SMALLKHOJ_WORKER_PROVIDER:-Zhipu GLM}"
WORKER_MODEL="${SMALLKHOJ_WORKER_MODEL:-glm-5.1}"
AGENT_ID="${SMALLKHOJ_AGENT_ID:-}"
AGENT_TOKEN="${SMALLKHOJ_AGENT_TOKEN:-sk_machine_local}"
PID_DIR="$ROOT_DIR/.dev-pids"
LOG_DIR="$ROOT_DIR/.dev-logs"
BACKEND_PID_FILE="$PID_DIR/backend-worker-stack.pid"
DAEMON_PID_FILE="$PID_DIR/daemon-worker-stack.pid"
BACKEND_LOG="$LOG_DIR/backend-worker-stack.log"
DAEMON_LOG="$LOG_DIR/daemon-worker-stack.log"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }

ensure_dirs() {
  mkdir -p "$PID_DIR" "$LOG_DIR"
}

pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_live_pid() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  local pid
  pid="$(tr -d '[:space:]' < "$file")"
  pid_alive "$pid" || return 1
  printf '%s\n' "$pid"
}

port_ready() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

http_ready() {
  local url="$1"
  curl -sf --max-time 3 "$url" >/dev/null
}

wait_for() {
  local label="$1"
  local attempts="$2"
  shift 2
  for _ in $(seq 1 "$attempts"); do
    if "$@"; then
      log "$label ready"
      return 0
    fi
    sleep 1
  done
  log "$label did not become ready"
  return 1
}

ensure_docker() {
  if docker ps >/dev/null 2>&1; then
    return
  fi
  if command -v colima >/dev/null 2>&1; then
    log "Starting Colima"
    colima start
  fi
  docker ps >/dev/null
}

ensure_db() {
  ensure_docker
  if docker ps --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    :
  elif docker ps -a --format '{{.Names}}' | grep -qx "$DB_CONTAINER"; then
    log "Starting $DB_CONTAINER"
    docker start "$DB_CONTAINER" >/dev/null
  else
    log "Creating $DB_CONTAINER on port $DB_PORT"
    docker run -d --name "$DB_CONTAINER" \
      -e POSTGRES_USER=smallkhoj \
      -e POSTGRES_PASSWORD=smallkhoj \
      -e POSTGRES_DB=smallkhoj \
      -p "$DB_PORT:5432" \
      pgvector/pgvector:pg16 >/dev/null
  fi
  wait_for "PostgreSQL" 30 docker exec "$DB_CONTAINER" pg_isready -U smallkhoj -d smallkhoj >/dev/null
}

start_backend() {
  if http_ready "http://127.0.0.1:$BACKEND_PORT/docs"; then
    log "Backend already running on $BACKEND_PORT"
    return
  fi
  if port_ready "$BACKEND_PORT"; then
    log "Port $BACKEND_PORT is occupied, but /docs is not healthy"
    return 1
  fi
  log "Starting backend on $BACKEND_PORT"
  (
    cd "$ROOT_DIR/backend"
    DATABASE_URL="postgresql+asyncpg://smallkhoj:smallkhoj@127.0.0.1:$DB_PORT/smallkhoj" \
      .venv/bin/uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT"
  ) >>"$BACKEND_LOG" 2>&1 &
  echo "$!" > "$BACKEND_PID_FILE"
  wait_for "Backend" 30 http_ready "http://127.0.0.1:$BACKEND_PORT/docs"
}

start_daemon() {
  if curl -sf --max-time 3 "http://127.0.0.1:$DAEMON_PORT/internal/daemon/jsonrpc" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"daemon/logs","params":{}}' >/dev/null 2>&1; then
    log "Daemon already running on $DAEMON_PORT"
    return
  fi
  if port_ready "$DAEMON_PORT"; then
    log "Port $DAEMON_PORT is occupied, but daemon RPC is not healthy"
    return 1
  fi
  log "Starting worker daemon on $DAEMON_PORT with $WORKER_PROVIDER / $WORKER_MODEL"
  (
    cd "$ROOT_DIR/agent/daemon/aaa-daemon"
    SLOCK_AGENT_TOKEN="$AGENT_TOKEN" SLOCK_ALLOW_WRITES=1 \
      node dist/cmd/main.js start --foreground \
        --runtime claude \
        --runtime-command /Users/lee/.local/bin/ccs-claude \
        --runtime-command-arg "$WORKER_PROVIDER" \
        --runtime-command-arg "$WORKER_MODEL" \
        --server "http://127.0.0.1:$BACKEND_PORT" \
        --ws auto \
        --agent-id "$AGENT_ID" \
        --proxy-port "$DAEMON_PORT" \
        --register-daemon \
        --workspace "$ROOT_DIR" \
        --runtime-stall-timeout-ms 180000
  ) >>"$DAEMON_LOG" 2>&1 &
  echo "$!" > "$DAEMON_PID_FILE"
  wait_for "Daemon" 30 curl -sf --max-time 3 "http://127.0.0.1:$DAEMON_PORT/internal/daemon/jsonrpc" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"daemon/logs","params":{}}' >/dev/null
}

status() {
  ensure_dirs
  if http_ready "http://127.0.0.1:$BACKEND_PORT/docs"; then
    log "backend OK http://127.0.0.1:$BACKEND_PORT/docs"
  else
    log "backend not healthy on $BACKEND_PORT"
  fi
  if curl -sf --max-time 3 "http://127.0.0.1:$DAEMON_PORT/internal/daemon/jsonrpc" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"daemon/logs","params":{}}' >/dev/null 2>&1; then
    log "daemon OK http://127.0.0.1:$DAEMON_PORT/internal/daemon/jsonrpc"
  else
    log "daemon not healthy on $DAEMON_PORT"
  fi
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CONTAINER"; then
    log "database container running: $DB_CONTAINER"
  else
    log "database container not running: $DB_CONTAINER"
  fi
}

stop_one() {
  local name="$1"
  local file="$2"
  local pid
  if pid="$(read_live_pid "$file")"; then
    log "Stopping $name pid $pid"
    kill "$pid" 2>/dev/null || true
    sleep 2
    if pid_alive "$pid"; then
      kill -TERM "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$file"
}

start() {
  ensure_dirs
  ensure_db
  start_backend
  start_daemon
  status
}

case "${1:-start}" in
  start) start ;;
  status) status ;;
  stop)
    ensure_dirs
    stop_one daemon "$DAEMON_PID_FILE"
    stop_one backend "$BACKEND_PID_FILE"
    ;;
  *)
    echo "Usage: $0 [start|status|stop]" >&2
    exit 2
    ;;
esac
