#!/bin/bash
# Long-lived dev server starter — fully detached from any session.
# macOS-friendly: no setsid; uses nohup + redirect + disown.
set -e
cd /private/tmp/skh-feat/frontend
mkdir -p .runtime

# Kill any existing next-server on port 3000
lsof -ti :3000 2>/dev/null | xargs -r kill -9 2>/dev/null || true
sleep 1

LOG=".runtime/dev-server.log"
PIDFILE=".runtime/dev-server.pid"

# nohup ignores HUP; </dev/null closes stdin; >LOG captures output;
# & backgrounds; disown removes from our shell's job table so this
# process survives after the parent shell exits.
nohup npm run dev </dev/null >"$LOG" 2>&1 &
PID=$!
disown $PID 2>/dev/null || true
echo $PID > "$PIDFILE"

echo "Started pid=$PID, waiting for ready..."

# Wait for server to be ready (max 60s)
for i in $(seq 1 60); do
  if curl -fsS -o /dev/null http://localhost:3000/ 2>/dev/null; then
    echo "Ready after ${i}s"
    echo "  PID:   $PID"
    echo "  Log:   $(pwd)/$LOG"
    echo "  URL:   http://localhost:3000"
    exit 0
  fi
  sleep 1
done
echo "FAILED to start within 60s. Last 30 lines of log:"
tail -30 "$LOG"
exit 1
