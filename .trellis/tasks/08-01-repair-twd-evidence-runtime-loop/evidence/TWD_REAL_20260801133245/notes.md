# TWD_REAL_20260801133245 Evidence

## Scope

- Task: `08-01-repair-twd-evidence-runtime-loop`
- Environment: `local-dev` feature worktree only
- Worktree: `/Users/code/project/smallkhoj-repair-twd-evidence-runtime-loop`
- Backend: `http://127.0.0.1:18000`
- Frontend: `http://127.0.0.1:13000`
- Daemon proxy: `http://127.0.0.1:62255`
- Exact browser tab: `1617512975`
- Marker: `TWD_REAL_20260801133245`
- Cloud production validation: not run and not claimed

## Bug diagnosis capsule

| Field | Evidence |
| --- | --- |
| Symptom | TWD timeouts/reloads could be returned as `ok=true`; automatic discovery could choose the wrong bridge; guarded navigation compared too little URL state; compact output was inconsistent. |
| Evidence | Deterministic protocol tests, dual-bridge tests, exact-tab guard tests, real Chrome navigation, and the final local product run. The real run additionally reproduced stale active-Server cookie selection and multi-line `--compact screenshot` success output. |
| Root cause | The core encoded uncertain terminal states as ordinary result dictionaries; the CLI treated truthy mappings as success and selected the first populated bridge; the guard accepted pathname-oriented evidence; file-writing success branches bypassed the shared compact emitter; same-host cookies survived across localhost ports. |
| Diagnostic strategy | Trace execution state from Chrome result/ACK through the core, CLI, guard, browser DOM, API, database and daemon trace. Compare exact tab/URL/Server identities at every boundary. |
| Timeout strategy | Bounded ACK/result and navigation polling; fail closed with stable error codes. |
| Warning strategy | Three failed repair rounds would trigger an architecture review. Every real-flow discrepancy gets a deterministic regression before another implementation change. |
| User-visible correction | Wrong bridge/tab/origin/Server and uncertain execution now fail instead of producing browser evidence. Compact mode is one JSON line for success and handled failure. |
| Acceptance | Focused RED→GREEN tests, full repository gates, live timeout probe, exact-tab DOM/screenshots, API 200s, marker-first DB joins, and trace-id correlation. |

## Real product flow

- Computer: `twd-real-133245` (`09df7c33-e233-4fa8-b338-a33fcb3fed95`)
- Daemon: `b1770a8a-588e-4a11-967c-f16647d976b6`
- Agent: `realreply-133245` (`4cd70dde-e598-459e-9f8e-6f99e415c4e0`)
- Channel: `#twd-real-133245` (`40c13a64-6546-4c4f-86f6-cb52c502805b`)
- Channel members: `zy-ean` human plus `realreply-133245` agent
- Task: channel task #1 (`29a0062f-a48c-4f92-8929-6a4ad27af25a`), claimed by the real agent and moved to `in_review`
- Human message: seq 1, id `db92485a-b9d6-4586-8833-c2a9e22a4045`
- Agent ACK: seq 2, id `f9113678-c517-4564-9801-4ecb10e35582`
- Agent task report: seq 3, id `a0f190e6-bf63-49db-8780-3c51575e6cc2`
- Runtime: Claude Code through Zhipu GLM `glm-5.2`; session `f8b5a90b-6980-48f3-81d8-3d0287c005c7`
- Correlated trace: `chat-send:ms9y9glv:d67b19e7-dea`, `message_to_agent_reply`, `daemon.runtime.result`, status `ok`

The reply was not inserted through SQL and was not posted manually through a public or agent API. It was authored by the real runtime through the generated Slock wrapper and persisted with the runtime agent as sender.

## Browser evidence

- `desktop.png`: human marker and first agent ACK in the same exact-tab channel view.
- `desktop-final.png`: human marker, agent ACK, and agent task report in the same channel.
- `task.png`: task #1 in `in_review`, created by `@zy-ean`, assigned to `@realreply-133245`, with the `#twd-real-133245` source card.
- `compact-after-fix.png`: post-regression screenshot written by the fixed compact success path.
- Every command returned `tabId=1617512975` and the page remained at `http://127.0.0.1:13000/chat/twd-real-133245`.

## Live TWD probes

Timeout probe:

```json
{"ok":false,"code":"EXECUTION_TIMEOUT","message":"No response data in 0.05s (ACK received, script may still be running)","type":"TMWebDriverError"}
```

- Exit code: `1`.
- A subsequent exact-tab eval succeeded and returned the correct task view, proving the late result was discarded.

Compact screenshot probe after the final repair:

```json
{"ok":true,"tabId":"1617512975","path":".../compact-after-fix.png","bytes":940456}
```

- Exit code: `0`.
- Output: one JSON line.

## Automated gates

- `make test`: backend `475 passed, 49 skipped`; frontend `222 passed`; TWD Python `29 passed`; scripts `171 passed, 1 skipped`; guard `25 passed`.
- `make scripts-test`: passed.
- `node --test tools/integration-gate/*.test.mjs`: `38 passed`.
- `make lint`: passed.
- `make typecheck`: passed, including frontend E2E typecheck.
- `git diff --check`: passed.

## Follow-ups outside this TWD repair

1. The task UI and `tasks.data.source` correctly show a message/channel source, but the persisted `tasks.message_id` is `NULL`. This violates the stronger source-linkage contract and should get its own product regression task.
2. The real runtime went beyond the requested ACK/task work and edited its own Claude memory file under `/Users/lee/.claude/projects/-Users-code-project-smallkhoj/memory/`. This was runtime behavior, not a TWD mutation. A later agent-policy task should decide whether such out-of-workspace memory edits are allowed during narrowly scoped acceptance tasks.

## Result

Pass for the requested TWD repair and local real agent/channel/task/chat verification. No cloud deployment or cloud-production acceptance is claimed.
