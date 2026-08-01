#!/usr/bin/env bash

set -u

repo_root="${1:-}"
if [[ -z "$repo_root" ]]; then
  repo_root="$(rtk git rev-parse --show-toplevel 2>/dev/null)" || {
    printf '%s\n' 'ERROR: run inside the SmallKhoj repository or pass its root path.' >&2
    exit 2
  }
fi

if [[ ! -f "$repo_root/AGENTS.md" || ! -f "$repo_root/tools/integration-gate/run.mjs" ]]; then
  printf 'ERROR: not a SmallKhoj repository: %s\n' "$repo_root" >&2
  exit 2
fi

cd "$repo_root" || exit 2

print_probe() {
  local label="$1"
  local url="$2"
  local status
  status="$(rtk curl -k -sS -o /dev/null -w '%{http_code}' --max-time 3 "$url" 2>/dev/null)"
  if [[ -z "$status" || "$status" == "000" ]]; then
    status="unreachable"
  fi
  printf '%s=%s url=%s\n' "$label" "$status" "$url"
}

print_listener() {
  local port="$1"
  local output
  output="$(rtk lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null)"
  if [[ -z "$output" ]]; then
    printf 'port_%s=none\n' "$port"
    return
  fi
  printf 'port_%s:\n%s\n' "$port" "$output"
}

printf '%s\n' '<smallkhoj-real-test-context>'
printf 'repo=%s\n' "$repo_root"
printf 'branch=%s\n' "$(rtk git branch --show-current 2>/dev/null)"
printf 'head=%s\n' "$(rtk git rev-parse --short=12 HEAD 2>/dev/null)"
printf 'worktree_count=%s\n' "$(rtk git worktree list 2>/dev/null | rtk wc -l)"
printf '%s\n' 'dirty:'
rtk git status --short 2>&1 || true

printf '%s\n' 'active_task:'
rtk python3 ./.trellis/scripts/task.py current --source 2>&1 || true

printf '%s\n' 'listeners:'
for port in 3000 8000 38190 38191 5432 55432; do
  print_listener "$port"
done

printf '%s\n' 'http_health:'
print_probe frontend_native http://127.0.0.1:3000/
print_probe backend_native http://127.0.0.1:8000/docs
print_probe local_test_http http://127.0.0.1:38190/
print_probe local_test_https https://127.0.0.1:38191/

printf '%s\n' 'local_test_containers:'
rtk docker ps --filter name=smallkhoj-local-test \
  --format 'name={{.Names}} image={{.Image}} ports={{.Ports}} status={{.Status}}' 2>&1 || true

printf '%s\n' 'safety_contract:'
printf '%s\n' '- collector is read-only; health does not prove candidate code identity'
printf '%s\n' '- host :5432 is protected shared/legacy data: no migration, stamp, cleanup, or test writes'
printf '%s\n' '- :55432 is protected/untrusted: never auto-select by listener presence'
printf '%s\n' '- Docker local-test DB is internal and is not host :5432'
printf '%s\n' '- do not stop/kill existing services or run dev.sh start/stop without explicit authorization'
printf '%s\n' '- do not modify alembic_version or owner/admin data to make a test pass'
printf '%s\n' '- stale/unknown Docker images cannot prove current worktree changes'
printf '%s\n' '- every delegated real-test prompt must include this entire context block'
printf '%s\n' '</smallkhoj-real-test-context>'
