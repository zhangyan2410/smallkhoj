---
name: smallkhoj-worker-orchestration
description: Start, verify, and use the local SmallKhoj worker orchestration stack. Use when Codex needs to delegate implementation work to SmallKhoj/Slock workers, launch Claude Code workers through ccs-claude providers such as Zhipu GLM, Kimi, or MiniMax, verify daemon/runtime message delivery, use watcher notifications, or act as supervisor/code reviewer for worker-produced changes.
---

# SmallKhoj Worker Orchestration

## Purpose

Use this skill to run the verified local loop:

```text
supervisor -> SmallKhoj backend -> aaa-daemon -> ccs-claude/Claude Code runtime -> slock CLI -> backend
```

The supervisor keeps ownership of task selection, review, integration, and final verification. Workers do bounded implementation or investigation through the project daemon and report back through Slock messages/tasks.

## Start The Stack

Prefer the helper script for repeatability:

```bash
.agents/skills/smallkhoj-worker-orchestration/scripts/start-worker-stack.sh start
```

Useful subcommands:

```bash
.agents/skills/smallkhoj-worker-orchestration/scripts/start-worker-stack.sh status
.agents/skills/smallkhoj-worker-orchestration/scripts/start-worker-stack.sh stop
```

Default runtime provider is Zhipu GLM with `glm-5.1`. Override only when needed:

```bash
SMALLKHOJ_WORKER_PROVIDER="Kimi" \
SMALLKHOJ_WORKER_MODEL="kimi-for-coding" \
.agents/skills/smallkhoj-worker-orchestration/scripts/start-worker-stack.sh start
```

Provider preference: use Zhipu GLM first, then Kimi or MiniMax if GLM is unavailable or out of quota. Check available providers with:

```bash
/Users/lee/.local/bin/ccs-claude list
```

## Manual Commands

Use these when the helper script is not appropriate or when debugging a single layer.

Start Docker/Colima if Docker is down:

```bash
colima start
```

Start the verified test database:

```bash
docker start smallkhoj-test-db
docker exec smallkhoj-test-db pg_isready -U smallkhoj -d smallkhoj
```

If the container is missing:

```bash
docker run -d --name smallkhoj-test-db \
  -e POSTGRES_USER=smallkhoj \
  -e POSTGRES_PASSWORD=smallkhoj \
  -e POSTGRES_DB=smallkhoj \
  -p 55432:5432 \
  pgvector/pgvector:pg16
```

Start backend from `backend/`:

```bash
DATABASE_URL=postgresql+asyncpg://smallkhoj:smallkhoj@127.0.0.1:55432/smallkhoj \
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
```

Start the worker daemon from `agent/daemon/aaa-daemon/`:

```bash
SLOCK_AGENT_TOKEN=sk_machine_local SLOCK_ALLOW_WRITES=1 \
node dist/cmd/main.js start --foreground \
  --runtime claude \
  --runtime-command /Users/lee/.local/bin/ccs-claude \
  --runtime-command-arg "Zhipu GLM" \
  --runtime-command-arg glm-5.1 \
  --server http://127.0.0.1:8000 \
  --ws auto \
  --agent-id aaaa0000-0000-0000-0000-000000000001 \
  --proxy-port 3457 \
  --register-daemon \
  --workspace /Users/code/project/smallkhoj \
  --runtime-stall-timeout-ms 180000
```

## Verify The Loop

Check backend and daemon:

```bash
curl -sf http://127.0.0.1:8000/docs >/dev/null
curl -sS http://127.0.0.1:3457/internal/daemon/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"daemon/logs","params":{}}'
```

Check Slock wrapper reads:

```bash
.slock/slock server info
.slock/slock task list --channel "#all"
```

Important: `smallkhoj-trace summary` checks daemon port `3456` by default. If the worker daemon was started on `3457`, backend can be healthy while trace still reports daemon FAIL.

## Dispatch Work

Use the public API to send supervisor/human messages. Do not use `.slock/slock message send` for supervisor dispatch because that sends as the worker agent (`@aaa`).

Supervisor message:

```bash
curl -sS -X POST 'http://127.0.0.1:8000/api/v1/channels/all/messages' \
  -H 'Content-Type: application/json' \
  -d '{"sender":"zy-ean","content":"@aaa <bounded task or instruction>"}'
```

Create a task for worker pickup:

```bash
curl -sS -X POST 'http://127.0.0.1:8000/api/v1/tasks' \
  -H 'X-Public-Key: sk_public_local' \
  -H 'Content-Type: application/json' \
  -d '{"channel":"#all","creator":"zy-ean","assignee":"aaa","title":"<title>","description":"<instructions>"}'
```

Tell workers to report through Slock CLI, for example:

```bash
SLOCK_ALLOW_WRITES=1 slock message send --target "#all:<threadShortId>" "<result>"
SLOCK_ALLOW_WRITES=1 slock task update --channel "#all" --number <n> --status in_review
```

Write-capable Slock commands require `SLOCK_ALLOW_WRITES=1`; without it the CLI returns `WRITES_NOT_ALLOWED`.

## Supervise And Review

Use watcher for task notifications:

```bash
python scripts/watcher.py --once
python scripts/watcher.py --read
```

Use daemon logs to inspect runtime delivery and tool execution:

```bash
curl -sS http://127.0.0.1:3457/internal/daemon/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"daemon/logs","params":{}}' \
  | jq -r '.result.entries[-40:][] | "\(.timestamp) [\(.level)] \(.message)"'
```

Review worker output like a normal code review:

- Inspect changed files and dirty state before accepting worker results.
- Do not revert unrelated user changes.
- Run focused lint/type-check/tests for touched areas.
- Ask the worker for evidence when the task claims completion but lacks tests, screenshots, or command output.

## Known Caveats

- `dev.sh` is Windows/Git Bash oriented; on macOS prefer the helper script or manual commands above.
- Backend default config points at PostgreSQL `5432`, but the verified smoke path uses test DB port `55432`.
- First runtime response may include Trellis SessionStart text from Claude hooks. This confirms runtime launch, not necessarily Slock posting.
- A worker answering in Claude stdout is not the same as posting to Slock. For a true round trip, require the worker to run `slock message send`.
- Worker self-sent messages may be echoed back through inbox polling. Treat echo handling as confirmation, not new work.
