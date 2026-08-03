#!/usr/bin/env bash
# dev.sh — SmallKhoj 开发服务管理脚本 (Windows Git Bash + macOS/Linux)
# 用法:
#   ./dev.sh start       启动 backend + frontend
#   ./dev.sh stop        优雅停止所有服务
#   ./dev.sh restart     停止后重新启动
#   ./dev.sh status      查看服务运行状态
#   ./dev.sh logs [backend|frontend]  查看日志

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_DIR="$ROOT_DIR/.dev-pids"
LOG_DIR="$ROOT_DIR/.dev-logs"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

BACKEND_PORT=8000
FRONTEND_PORT=3000
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
DEFAULT_DB_USER="${SMALLKHOJ_DB_USER:-smallkhoj}"
DEFAULT_DB_PASSWORD="${SMALLKHOJ_DB_PASSWORD:-smallkhoj}"
DEFAULT_DB_NAME="${SMALLKHOJ_DB_NAME:-smallkhoj}"
LOCAL_AUTH_BRIDGE_SECRET="${AUTH_BRIDGE_SECRET:-sk_auth_bridge_local_dev_secret_min_32_chars}"
LOCAL_BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-sk_better_auth_local_dev_secret_min_32_chars}"
LOCAL_BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:$FRONTEND_PORT}"

# ── helpers ──────────────────────────────────────────────

ensure_dirs() {
  mkdir -p "$PID_DIR" "$LOG_DIR"
}

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
warn() { echo "[$(date '+%H:%M:%S')] WARN: $*" >&2; }

platform() {
  case "${DEV_PLATFORM:-$(uname -s 2>/dev/null || echo unknown)}" in
    MINGW*|MSYS*|CYGWIN*|Windows_NT) echo "windows" ;;
    *) echo "unix" ;;
  esac
}

is_windows() {
  [[ "$(platform)" == "windows" ]]
}

# 获取 PID 文件中记录的 PID（如果进程还活着）
read_pid() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    local stored_pid
    stored_pid=$(cat "$pidfile")
    if [[ -n "$stored_pid" ]] && kill -0 "$stored_pid" 2>/dev/null; then
      echo "$stored_pid"
      return 0
    fi
  fi
  return 1
}

# 找到监听指定端口的所有 PID
pids_on_port() {
  local port="$1"
  if is_windows; then
    netstat -ano 2>/dev/null | grep ":${port} " | grep LISTENING | awk '{print $5}' | sort -u | grep -v '^0$'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN -n -P 2>/dev/null | sort -u
  elif command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | sort -u
  else
    netstat -ltnp 2>/dev/null | awk -v port=":$port" '$4 ~ port"$" {print $7}' | cut -d/ -f1 | grep -E '^[0-9]+$' | sort -u
  fi
}

# 杀掉进程树：Windows 用 taskkill，macOS/Linux 递归清理子进程。
kill_tree() {
  local pid="$1"
  if is_windows; then
    # 先尝试优雅的 taskkill（不加 /F）
    cmd //c "taskkill /T /PID $pid" 2>/dev/null
    sleep 2
    # 如果还活着，强制杀
    if kill -0 "$pid" 2>/dev/null; then
      cmd //c "taskkill /F /T /PID $pid" 2>/dev/null || true
      sleep 1
    fi
  else
    local children
    children=$(pgrep -P "$pid" 2>/dev/null || true)
    for child in $children; do
      kill_tree "$child"
    done
    kill -TERM "$pid" 2>/dev/null || true
    sleep 2
    if kill -0 "$pid" 2>/dev/null; then
      kill -KILL "$pid" 2>/dev/null || true
      sleep 1
    fi
  fi
}

# 兜底：按端口杀所有监听进程
force_kill_port() {
  local port="$1"
  local pids
  pids=$(pids_on_port "$port")
  if [[ -n "$pids" ]]; then
    warn "Port $port still occupied by PIDs: $(echo $pids | tr '\n' ' ')"
    for pid in $pids; do
      if is_windows; then
        cmd //c "taskkill /F /T /PID $pid" 2>/dev/null || true
      else
        kill "$pid" 2>/dev/null || true
      fi
    done
    sleep 1
  fi
}

port_is_listening() {
  local port="$1"
  [[ -n "$(pids_on_port "$port")" ]]
}

http_ready() {
  local url="$1"
  curl -sf --max-time 3 "$url" -o /dev/null 2>/dev/null
}

default_db_port() {
  if [[ -n "${SMALLKHOJ_DB_PORT:-}" ]]; then
    echo "$SMALLKHOJ_DB_PORT"
    return
  fi
  # 不再按监听状态猜端口：历史上 55432 常被 SSH/worker 占用，盲目切换会把后端
  # 指到别人的数据库。默认始终使用宿主 5432；需要其他端口时显式设置
  # SMALLKHOJ_DB_PORT。
  echo 5432
}

backend_database_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "$DATABASE_URL"
    return
  fi
  local port
  port=$(default_db_port)
  echo "postgresql+asyncpg://${DEFAULT_DB_USER}:${DEFAULT_DB_PASSWORD}@localhost:${port}/${DEFAULT_DB_NAME}"
}

frontend_database_url() {
  if [[ -n "${BETTER_AUTH_DATABASE_URL:-}" ]]; then
    echo "$BETTER_AUTH_DATABASE_URL"
    return
  fi
  local port
  port=$(default_db_port)
  echo "postgresql://${DEFAULT_DB_USER}:${DEFAULT_DB_PASSWORD}@localhost:${port}/${DEFAULT_DB_NAME}"
}

backend_command() {
  if is_windows && [[ -x "$BACKEND_DIR/.venv/Scripts/python.exe" ]]; then
    echo ".venv/Scripts/python.exe main.py"
  elif command -v uv >/dev/null 2>&1; then
    echo "uv run python main.py"
  elif [[ -x "$BACKEND_DIR/.venv/bin/python" ]]; then
    echo ".venv/bin/python main.py"
  else
    echo "python3 main.py"
  fi
}

start_background() {
  local pidfile="$1"
  local logfile="$2"
  shift 2

  if is_windows; then
    "$@" >> "$logfile" 2>&1 &
  else
    nohup "$@" >> "$logfile" 2>&1 < /dev/null &
  fi
  local child_pid=$!
  if ! is_windows; then
    disown "$child_pid" 2>/dev/null || true
  fi
  echo "$child_pid" > "$pidfile"
  STARTED_PID="$child_pid"
}

# ── commands ─────────────────────────────────────────────

cmd_stop() {
  log "Stopping services..."
  local stopped=false

  # 停止 backend
  local be_pid
  if be_pid=$(read_pid "$BACKEND_PID_FILE"); then
    log "Stopping backend (PID $be_pid)..."
    kill_tree "$be_pid"
    rm -f "$BACKEND_PID_FILE"
    stopped=true
  fi
  # 兜底：按端口杀
  force_kill_port "$BACKEND_PORT"

  # 停止 frontend
  local fe_pid
  if fe_pid=$(read_pid "$FRONTEND_PID_FILE"); then
    log "Stopping frontend (PID $fe_pid)..."
    kill_tree "$fe_pid"
    rm -f "$FRONTEND_PID_FILE"
    stopped=true
  fi
  force_kill_port "$FRONTEND_PORT"

  if $stopped; then
    log "Services stopped."
  else
    log "No running services found."
  fi
}

cmd_start() {
  local local_public_api_key="${PUBLIC_API_KEY:-sk_public_local}"

  ensure_dirs

  # 清空旧日志
  : > "$LOG_DIR/backend.log"
  : > "$LOG_DIR/frontend.log"

  # 如果 PID 文件记录的服务在跑，先停（外部占用端口的情况交给下面的 FORCE_RESTART 处理）
  if read_pid "$BACKEND_PID_FILE" &>/dev/null || read_pid "$FRONTEND_PID_FILE" &>/dev/null; then
    warn "Services already running, stopping first..."
    cmd_stop
  fi

  # 外部进程占用端口时，默认复用并提示可能是旧 build；需要拿到本 worktree
  # 最新代码时设置 SMALLKHOJ_DEV_FORCE_RESTART=1，由这里统一重启。
  local force_restart="${SMALLKHOJ_DEV_FORCE_RESTART:-}"
  if [[ -n "$force_restart" ]]; then
    if http_ready "http://localhost:$BACKEND_PORT/docs" || http_ready "http://localhost:$FRONTEND_PORT"; then
      log "SMALLKHOJ_DEV_FORCE_RESTART set — restarting services to pick up the latest code from $(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo current-worktree)@$(git -C "$ROOT_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)..."
      cmd_stop
    fi
  fi

  # ── 启动 backend ──
  local db_url backend_cmd be_pid
  if http_ready "http://localhost:$BACKEND_PORT/docs"; then
    be_pid=$(pids_on_port "$BACKEND_PORT" | head -n 1)
    log "Backend already ready on :$BACKEND_PORT (PID ${be_pid:-external})"
    log "Reusing existing backend; it may be an older build. Run './dev.sh restart' (or SMALLKHOJ_DEV_FORCE_RESTART=1 ./dev.sh start) to pick up the latest code."
  else
    log "Starting backend on :$BACKEND_PORT..."
    cd "$BACKEND_DIR"
    db_url=$(backend_database_url)
    backend_cmd=$(backend_command)
    log "Backend database: ${db_url}"
    log "Backend command: ${backend_cmd}"
    # shellcheck disable=SC2086
    start_background "$BACKEND_PID_FILE" "$LOG_DIR/backend.log" env DATABASE_URL="$db_url" PUBLIC_API_KEY="$local_public_api_key" AUTH_BRIDGE_SECRET="$LOCAL_AUTH_BRIDGE_SECRET" $backend_cmd
    be_pid="$STARTED_PID"
    cd "$ROOT_DIR"
  fi

  # 等待 backend 就绪
  local waited=0
  while (( waited < 15 )); do
    if http_ready "http://localhost:$BACKEND_PORT/docs"; then
      break
    fi
    sleep 1
    ((waited++))
  done
  if (( waited >= 15 )); then
    warn "Backend did not respond within 15s — check $LOG_DIR/backend.log"
  else
    log "Backend ready (took ${waited}s, PID $be_pid)"
  fi

  # ── 启动 frontend ──
  local fe_pid frontend_db_url
  if http_ready "http://localhost:$FRONTEND_PORT"; then
    fe_pid=$(pids_on_port "$FRONTEND_PORT" | head -n 1)
    log "Frontend already ready on :$FRONTEND_PORT (PID ${fe_pid:-external})"
    log "Reusing existing frontend; it may be an older build. Run './dev.sh restart' (or SMALLKHOJ_DEV_FORCE_RESTART=1 ./dev.sh start) to pick up the latest code."
  else
    log "Starting frontend on :$FRONTEND_PORT..."
    cd "$FRONTEND_DIR"
    frontend_db_url=$(frontend_database_url)
    start_background "$FRONTEND_PID_FILE" "$LOG_DIR/frontend.log" env INTERNAL_API_BASE_URL="${INTERNAL_API_BASE_URL:-http://127.0.0.1:$BACKEND_PORT}" NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:$BACKEND_PORT}" NEXT_PUBLIC_DEPLOYMENT_ENV=local-dev NEXT_PUBLIC_API_KEY="$local_public_api_key" BETTER_AUTH_SECRET="$LOCAL_BETTER_AUTH_SECRET" BETTER_AUTH_URL="$LOCAL_BETTER_AUTH_URL" BETTER_AUTH_DATABASE_URL="$frontend_db_url" BETTER_AUTH_DATABASE_POOL_SIZE="${BETTER_AUTH_DATABASE_POOL_SIZE:-10}" AUTH_BRIDGE_SECRET="$LOCAL_AUTH_BRIDGE_SECRET" npm run dev
    fe_pid="$STARTED_PID"
    cd "$ROOT_DIR"
  fi

  waited=0
  while (( waited < 30 )); do
    if http_ready "http://localhost:$FRONTEND_PORT"; then
      break
    fi
    sleep 1
    ((waited++))
  done
  if (( waited >= 30 )); then
    warn "Frontend did not respond within 30s — check $LOG_DIR/frontend.log"
  else
    log "Frontend ready (took ${waited}s, PID $fe_pid)"
  fi

  log "All services running. Use './dev.sh stop' to stop, './dev.sh logs' to view logs."
}

cmd_status() {
  local be_pid fe_pid
  local be_ok=false fe_ok=false

  if be_pid=$(read_pid "$BACKEND_PID_FILE"); then
    if http_ready "http://localhost:$BACKEND_PORT/docs"; then
      be_ok=true
    fi
  elif http_ready "http://localhost:$BACKEND_PORT/docs"; then
    be_pid="$(pids_on_port "$BACKEND_PORT" | head -n 1) external"
    be_ok=true
  fi

  if fe_pid=$(read_pid "$FRONTEND_PID_FILE"); then
    if http_ready "http://localhost:$FRONTEND_PORT"; then
      fe_ok=true
    fi
  elif http_ready "http://localhost:$FRONTEND_PORT"; then
    fe_pid="$(pids_on_port "$FRONTEND_PORT" | head -n 1) external"
    fe_ok=true
  fi

  echo "Backend  :$BACKEND_PORT  $($be_ok && echo "RUNNING (PID $be_pid)" || echo "STOPPED")"
  echo "Frontend :$FRONTEND_PORT $($fe_ok && echo "RUNNING (PID $fe_pid)" || echo "STOPPED")"
}

cmd_logs() {
  local target="${1:-all}"
  ensure_dirs
  case "$target" in
    backend)  tail -f "$LOG_DIR/backend.log"  ;;
    frontend) tail -f "$LOG_DIR/frontend.log" ;;
    all)      tail -f "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log" ;;
    *)        echo "Usage: ./dev.sh logs [backend|frontend|all]" ;;
  esac
}

# ── main ─────────────────────────────────────────────────

case "${1:-help}" in
  start)   cmd_start   ;;
  stop)    cmd_stop    ;;
  restart) cmd_stop; sleep 2; cmd_start ;;
  status)  cmd_status  ;;
  logs)    cmd_logs "${2:-all}" ;;
  help|*)
    echo "SmallKhoj Dev Manager"
    echo ""
    echo "Usage: ./dev.sh <command>"
    echo ""
    echo "Commands:"
    echo "  start       Start backend + frontend"
    echo "  stop        Stop all services (graceful, then force)"
    echo "  restart     Restart all services"
    echo "  status      Show service status"
    echo "  logs [svc]  Tail logs (backend|frontend|all)"
    ;;
esac
