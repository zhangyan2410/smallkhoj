#!/usr/bin/env bash
# dev.sh — SmallKhoj 开发服务管理脚本 (Windows Git Bash)
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

# ── helpers ──────────────────────────────────────────────

ensure_dirs() {
  mkdir -p "$PID_DIR" "$LOG_DIR"
}

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
warn() { echo "[$(date '+%H:%M:%S')] WARN: $*" >&2; }

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
  netstat -ano 2>/dev/null | grep ":${port} " | grep LISTENING | awk '{print $5}' | sort -u | grep -v '^0$'
}

# 用 taskkill /F /T 杀掉进程树（Windows 原生，可靠）
kill_tree() {
  local pid="$1"
  # 先尝试优雅的 taskkill（不加 /F）
  cmd //c "taskkill /T /PID $pid" 2>/dev/null
  sleep 2
  # 如果还活着，强制杀
  if kill -0 "$pid" 2>/dev/null; then
    cmd //c "taskkill /F /T /PID $pid" 2>/dev/null || true
    sleep 1
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
      cmd //c "taskkill /F /T /PID $pid" 2>/dev/null || true
    done
    sleep 1
  fi
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
  ensure_dirs

  # 清空旧日志
  : > "$LOG_DIR/backend.log"
  : > "$LOG_DIR/frontend.log"

  # 如果已经在跑，先停
  if read_pid "$BACKEND_PID_FILE" &>/dev/null || read_pid "$FRONTEND_PID_FILE" &>/dev/null; then
    warn "Services already running, stopping first..."
    cmd_stop
  fi

  # ── 启动 backend ──
  log "Starting backend on :$BACKEND_PORT..."
  cd "$BACKEND_DIR"
  .venv/Scripts/python.exe main.py >> "$LOG_DIR/backend.log" 2>&1 &
  local be_pid=$!
  echo "$be_pid" > "$BACKEND_PID_FILE"
  cd "$ROOT_DIR"

  # 等待 backend 就绪
  local waited=0
  while (( waited < 15 )); do
    if curl -sf "http://localhost:$BACKEND_PORT/docs" -o /dev/null 2>/dev/null; then
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
  log "Starting frontend on :$FRONTEND_PORT..."
  cd "$FRONTEND_DIR"
  npx next dev >> "$LOG_DIR/frontend.log" 2>&1 &
  local fe_pid=$!
  echo "$fe_pid" > "$FRONTEND_PID_FILE"
  cd "$ROOT_DIR"

  waited=0
  while (( waited < 30 )); do
    if curl -sf "http://localhost:$FRONTEND_PORT" -o /dev/null 2>/dev/null; then
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
    if curl -sf --max-time 3 "http://localhost:$BACKEND_PORT/docs" -o /dev/null 2>/dev/null; then
      be_ok=true
    fi
  fi

  if fe_pid=$(read_pid "$FRONTEND_PID_FILE"); then
    if curl -sf --max-time 3 "http://localhost:$FRONTEND_PORT" -o /dev/null 2>/dev/null; then
      fe_ok=true
    fi
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
