# Supervisor Log

## 2026-06-20T18:27:02Z

- Task moved from `planning` to `in_progress` with `python ./.trellis/scripts/task.py start .trellis/tasks/06-21-realtime-event-stream-platform`.
- Task PRD/design/implementation plan updated before coding: Redis is deferred; Postgres LISTEN/NOTIFY is the first production fanout path.
- Service snapshot:
  - backend `http://127.0.0.1:8000/docs`: OK.
  - frontend `http://127.0.0.1:3000`: OK from `smallkhoj-trace summary --json`.
  - worker helper default daemon port `3457`: not listening.
  - active daemon discovered by trace: `http://127.0.0.1:65468`, JSON-RPC logs readable.
- Runtime/provider snapshot:
  - computer `local-mac` is online.
  - Codex runtime provider `laodog-ai` is detected as `runtimeProvider=ga-laodog-ai-1779356569971`.
  - agent `@laogou` is online with `runtime=codex`, session `019ee43d-5a96-7703-a5da-788e73788e37`, pid `67474`.
  - agent `@kimi` is online with `runtime=claude_code`, provider `Kimi`, session `4b703c7d-9d69-4d15-8ddc-6820759088b2`, pid `82307`.
- Monitoring issue: `scripts/watcher.py --once` returns `401 Unauthorized` without agent/machine auth; use daemon JSON-RPC logs and public API state until watcher auth is configured for this session.

## 2026-06-20T18:28Z

- Dispatched bounded worker tasks through public task API:
  - Task #1 `Realtime event platform backend core` assigned to `@laogou` (Codex/laodog-ai). Scope: backend envelope/hub/SSE/publish/Postgres LISTEN/NOTIFY seam. Redis explicitly forbidden.
  - Task #2 `Realtime frontend stream consumer and projector review` assigned to `@kimi` (Claude Code/Kimi). Scope: frontend fetch-stream client/projector/high-water behavior and review support.
- Worker guardrails:
  - workers must read task docs/specs first;
  - workers must report via Slock;
  - workers must list files changed, tests run, risks, and runtime/token anomalies;
  - backend/frontend ownership split is intended to reduce same-file conflicts.

## 2026-06-20T18:29Z

- Delivery check:
  - Task #2 moved to `in_progress` by `@kimi` at event seq 703.
  - Task #1 moved to `in_progress` by `@laogou` at event seq 705 after an explicit `@laogou` channel mention.
- Runtime health notes:
  - `@kimi` is actively reading task/frontend files. First visible assistant event reported about 28k input tokens; monitor for growth.
  - `@laogou` Codex process is alive (`npx @zed-industries/codex-acp@0.16.0`, pid 67474) and task state confirms it can act.
- False alarm resolved: a filtered daemon log view made it look like `@kimi` touched task #1, but DB event actor for task #1 update is `@laogou`.

## 2026-06-20T18:41Z

- Worker status review:
  - `@laogou` reported task #1 backend core ready for review and moved it to `in_review`.
  - `@kimi` had not reported completion for task #2 after its 10:30Z progress update.
- Runtime anomaly:
  - Daemon logs showed `@kimi` continuing browser verification attempts with stale fixed `twd --tab 1617511054`, matching the known webdriver misuse pattern.
  - Kimi runtime usage grew from about `151330` to `164431` input tokens while repeating the same class of verification/tool attempts.
- Supervisor action:
  - Sent a channel intervention telling `@kimi` to stop the verification loop, avoid fixed `--tab`, use `./twd --url-match 127.0.0.1:3000`, and report status.
  - The runtime did not stop after the intervention and continued emitting thinking/tool events.
  - Called public lifecycle stop on workspace `25a58d26-028b-4a26-82d3-4daab0a6d773`; backend returned `delivered=1` and marked `@kimi`/workspace stopped.
  - The underlying Claude child process became an orphan (`pid=82338`, `ppid=1`) and kept running, so it was terminated with `SIGTERM`.
- Follow-up:
  - Existing frontend files from task #2 need review; do not restart `@kimi` for this task without a fresh bounded prompt and context reset.
  - `@laogou` remains running as the Codex/laodog-ai worker.

## 2026-06-20T19:04Z

- Investigated why `@kimi` continued spending tokens after lifecycle stop.
- Root cause:
  - Backend lifecycle state changed to `stopped`, and daemon received `stop_runtime`.
  - Daemon killed only the direct Claude Code wrapper process with `SIGTERM`.
  - The real provider child under the wrapper continued briefly as an orphan and kept writing stream-json output, so input token usage kept increasing after backend already showed stopped.
  - Backend also left stale `pid` values on stopped workspaces when the daemon no longer reported that workspace.
- Fixes applied:
  - `ClaudeRuntimeDriver` and `CodexRuntimeDriver` now launch wrapper-based runtimes in a POSIX process group and signal the runtime process group on stop.
  - Added regression coverage proving a fake Claude wrapper's grandchild process is terminated by `ClaudeRuntimeDriver.stop()`.
  - Backend daemon workspace sync now clears stale `pid` for `stopped` / `offline` / `exited` workspaces, including missing terminal workspaces.
- Verification:
  - `cd agent/daemon/aaa-daemon && npm run build && node --test test/runtime-mcp.test.mjs` passed.
  - `cd backend && .venv/bin/python -m pytest tests/test_daemon_control.py -q` passed.
  - `cd backend && .venv/bin/python -m pytest tests/test_public_events.py -q` passed.
  - Local backend and daemon were restarted in foreground tool sessions with updated code.
  - `local-mac` is online; `@kimi` is stopped with `pid: null`; no `df6c5e8c` / `82307` / `82338` Claude runtime process remains.

## 2026-06-20T19:13Z

- Rechecked the `@kimi` runaway after the user reported input tokens rose from ~151k to ~159k and the runtime repeated fixed `twd --tab` verification.
- Diagnosis:
  - The repeated fixed `--tab` was a worker behavior/context failure: the Kimi session kept following stale WebDriver usage instead of the required `./twd --url-match 127.0.0.1:3000` pattern.
  - The token burn became a platform bug because lifecycle stop only sent a graceful stop to the direct wrapper/process group and had no bounded force-kill fallback if the provider process ignored or outlived `SIGTERM`.
  - Existing stall detection did not catch this class because the runtime was still producing stream/tool progress; it was not idle-stalled.
- Fixes applied:
  - `process-tree.ts` now has a shared `scheduleRuntimeProcessTreeKill()` helper.
  - Claude Code and Codex CLI runtimes now send process-group `SIGTERM` and schedule `SIGKILL` fallback, clearing the timer on normal exit.
  - Codex ACP bridge now uses the same process-tree helper instead of a local duplicate kill implementation.
  - Added regression coverage where a fake Claude wrapper and grandchild both ignore `SIGTERM`; `ClaudeRuntimeDriver.stop()` still kills the process group.
- Verification:
  - `cd agent/daemon/aaa-daemon && npm run build` passed.
  - `cd agent/daemon/aaa-daemon && node --test test/runtime-mcp.test.mjs` passed: 20 tests.
  - `cd backend && .venv/bin/python -m pytest tests/test_daemon_control.py -q` passed: 31 tests.
  - `./smallkhoj-trace summary --json` reports backend/frontend reachable and daemon logs readable through `http://127.0.0.1:58432`.
  - Public computers API reports `@kimi` as `stopped`, `offline`, `pid:null`.
  - Process table has no `df6c5e8c`, `25a58d26`, `82307`, or `82338` process. Remaining `claude` processes are unrelated cwd/agent prompt paths, not the Kimi workspace.
  - Restarted the daemon with the rebuilt dist and a fresh reconnect token. New detached daemon is PID `95545`, proxy `http://127.0.0.1:65346`.
  - Follow-up `smallkhoj-trace summary --json` detects daemon URL `http://127.0.0.1:65346`; backend/frontend are reachable, and daemon register/heartbeat logs are present.

## 2026-06-20T19:26Z

- Integrated supervisor fixes after worker handoff:
  - Removed duplicate browser public-event publishing from public/agent router helpers; `_push_committed_events()` now delegates to the single `push_latest_events_for_server()` path.
  - Changed Postgres NOTIFY fanout to use an independent `asyncpg` connection so `_notify_postgres()` no longer commits or rolls back the caller's `AsyncSession`.
  - Fixed frontend lint blockers in `TaskBoard` and `AgentActivityList` by deferring initial refresh calls out of the effect body and removing an unused import.
- Validation:
  - `cd backend && .venv/bin/python -m pytest tests/test_public_events.py tests/test_daemon_control.py -q` passed: 40 tests.
  - `cd backend && .venv/bin/python -m pytest tests -q` passed: 40 tests.
  - `cd frontend && npm run lint` passed.
  - `cd frontend && npx tsc --noEmit` passed.
  - `cd frontend && npx tsx --test test/realtime-events.test.ts` passed: 4 tests.
- Runtime state:
  - Restarted backend with current code as PID `17782` on port 8000.
  - Daemon recovered after backend restart; `smallkhoj-trace summary --json` shows daemon URL `http://127.0.0.1:65346` and heartbeat sync.
  - `@kimi` remains stopped/offline with `pid:null`; no Kimi worker was restarted.
- Real browser proof:
  - Used project WebDriver with precise `--url-match "http://127.0.0.1:3000/chat/all"`, not fixed `--tab`.
  - Before POST, the chat tab did not contain marker and had `window.__smallkhojRealtimeProof` set.
  - Posted marker `REAL_realtime_event_stream_20260620192456_strict2` through `POST /api/v1/channels/all/messages`.
  - Without browser refresh, DOM proof showed `hasMarker:true` and `proofExists:true`, proving the same page instance received the update.
  - Evidence files:
    - `evidence/REAL_realtime_event_stream_20260620192456_strict2.api-response.json`
    - `evidence/REAL_realtime_event_stream_20260620192456_strict2.dom-proof-clean.json`
    - `evidence/REAL_realtime_event_stream_20260620192456_strict2.png`
    - `evidence/REAL_realtime_event_stream_20260620192456_strict2.db-message.txt`
    - `evidence/REAL_realtime_event_stream_20260620192456_strict2.db-events.txt`

## 2026-06-21T03:43+08:00

- Completion audit found one remaining gap: computers/workspaces pages listened for `runtime.updated` / `computer.status.updated`, but daemon-side register/heartbeat/shutdown changes did not consistently wake the browser public event stream.
- Fixes applied:
  - daemon register and heartbeat now call the shared public publish path after commit;
  - heartbeat records `workspace_updated` only when runtime state actually changes, preserving the no-heartbeat-noise contract;
  - daemon shutdown records workspace stop updates and computer status updates;
  - computer status changes emit `computer.status.updated`, scoped to the computer.
- Validation:
  - `cd backend && .venv/bin/python -m pytest tests -q` passed: 42 tests.
  - `cd frontend && npm run lint && npx tsc --noEmit && npx tsx --test test/realtime-events.test.ts` passed: lint, typecheck, and 4 tests.
  - `cd agent/daemon/aaa-daemon && npm run build && node --test test/runtime-mcp.test.mjs` passed: build and 20 tests.
  - `graphify update .` completed; graph HTML skipped due graph size, graph JSON/report updated.
- Current-code browser proof:
  - backend was restarted from current source on port 8000 for the real test.
  - Used project WebDriver with precise `--url-match "http://127.0.0.1:3000/chat/all"`, not fixed `--tab`.
  - Before POST, `window.__smallkhojRealtimeProof.beforeHasMarker` was `false`.
  - Posted marker `REAL_realtime_event_stream_20260621033911_current` through `POST /api/v1/channels/all/messages`.
  - Without browser refresh, the same `/chat/all` page returned `hasMarker:true`.
  - Evidence files:
    - `evidence/REAL_realtime_event_stream_20260621033911_current.before.json`
    - `evidence/REAL_realtime_event_stream_20260621033911_current.api-response.json`
    - `evidence/REAL_realtime_event_stream_20260621033911_current.dom-proof.json`
    - `evidence/REAL_realtime_event_stream_20260621033911_current.png`
    - `evidence/REAL_realtime_event_stream_20260621033911_current.db-message.txt`
    - `evidence/REAL_realtime_event_stream_20260621033911_current.db-events.txt`
- Runtime/supervision state:
  - Bad Kimi workspace `25a58d26-028b-4a26-82d3-4daab0a6d773` was deleted through the public workspace delete API after verifying it was stopped with `pid:null`.
  - `@kimi` is offline with `workspaceId:null`, `runtimeAutostart:false`, and `runtimeDesiredStatus:"stopped"`.
  - Process table has no `df6c5e8c`, `25a58d26`, `82307`, or `82338` runtime process.
  - backend is restored under detached `screen` session `smallkhoj-backend`; `smallkhoj-trace summary --json` reports backend/frontend OK and daemon URL `http://127.0.0.1:65346` with `daemonOk:true`.
