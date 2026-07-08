# Validation Plan: Channel Memory Store and Scoped Sessions

## Scope

This plan covers final validation for the `06-22-channel-memory-store-and-scoped-sessions` task after the main implementation is complete. The current implementation is still in progress, so the baseline checks below are tool/readiness observations only; current red tests must not be treated as a task failure.

The validation target spans:

- Backend server-owned channel/task memory storage, permissions, provenance, search, events, and CAS conflict behavior.
- Daemon and Slock CLI memory commands plus scoped runtime session routing.
- Frontend channel/task memory visibility and proposal/update surfaces.
- Real browser and runtime evidence using the project WebDriver wrapper and trace tooling.
- Optional runtime trace evidence for delivery/session isolation diagnostics.

## Baseline Observations

Commands run during this planning pass:

```bash
python3 ./.trellis/scripts/task.py current --source
python3 ./.trellis/scripts/get_context.py --mode packages
find .trellis/spec -maxdepth 3 -type f | sort
find . -path './frontend/node_modules' -prune -o -path './agent/daemon/*/node_modules' -prune -o -name package.json -print | sort
node -e "const p=require('./frontend/package.json'); console.log(JSON.stringify(p.scripts,null,2))"
node -e "const p=require('./agent/daemon/aaa-daemon/package.json'); console.log(JSON.stringify(p.scripts,null,2))"
python3 -m pytest --collect-only -q
./twd --help
./twd --compact tabs
./smallkhoj-trace --help
./smallkhoj-trace summary --json
git status --short
```

Observed baseline:

- `task.py current --source` reported no active task in this worktree, so this plan uses the explicitly requested task path.
- `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/check.jsonl` is absent; context was loaded from `prd.md`, `task-plan.md`, Trellis package mode, and relevant specs/SOPs.
- Trellis package mode reports a single-repo project with `backend` and `frontend` spec layers.
- `backend/tests/test_memory_store.py` exists as an untracked file and already covers path normalization, CAS conflict messaging, private-channel visibility, selective search ranking, and context-manifest truncation.
- `frontend/node_modules` and `agent/daemon/aaa-daemon/node_modules` are missing in this worktree.
- `python3 -m pytest --collect-only -q` failed because this Python environment does not have `pytest` installed.
- `./twd --compact tabs` succeeded and showed connected browser tabs, including a local SmallKhoj tab at `http://127.0.0.1:3000/members`.
- `./smallkhoj-trace summary --json` showed backend and frontend reachable, but daemon JSON-RPC at `http://127.0.0.1:3456/internal/daemon/jsonrpc` was not reachable.
- `git status --short` showed the task directory and `backend/tests/test_memory_store.py` as untracked. Do not revert or delete them during validation.

## Validation Matrix

| Area | Required behavior | Automated validation | Real/runtime evidence | Pass criteria |
| --- | --- | --- | --- | --- |
| Backend schema and models | Memory entries are server-owned DB records, scoped by channel/task, path-like, versioned, content-hashed, and provenance-aware. Large/binary content is represented by blob/object references, not raw unmanaged files. | Backend model/migration tests; API serialization tests for text entries and blob-reference metadata. | API/DB read-only marker queries for created entries and provenance fields. | Rows contain `scope_type`, `scope_id`, normalized `path`, `content_sha256`, `version`, provenance fields, timestamps, and blob reference fields where applicable. |
| Backend permissions | Public/private channel memory visibility follows channel membership; leaving a private channel revokes access; task memory follows task/thread authorization. | Unit tests around permission helpers; API tests for member/non-member/human/agent access. | API calls as authorized and unauthorized users/agents. | Private memory returns 403/404 for non-members and remains visible to authorized members only. |
| Backend CAS/conflicts | Writes use base SHA/version preconditions; agents do not manually reason about DB versions; conflicts return actionable re-read/merge/proposal language. | Unit tests for `require_matching_base_sha` or equivalent; API tests for stale write conflict. | Two-client API scenario writes stale `baseSha`, captures conflict response. | Stale writes do not overwrite current content; response includes latest hash/version and clear recovery instruction. |
| Backend search/retrieval | Search is selective; runtime context never blindly injects all channel memory. | Unit tests for ranking, limit, snippet length, and context manifest policy. | Trace/prompt manifest evidence when runtime receives a channel/task event. | Manifest includes short summary/top-k snippets and task memory where scoped; no full channel memory dump. |
| Backend events | Memory writes publish product-safe `channel_memory.updated` or equivalent events after commit for UI/cache invalidation. Runtime-actionable gates are explicit. | Public event envelope tests; event visibility tests; daemon event classification tests if new event type reaches daemon. | SSE/WebDriver evidence that memory UI refreshes after update; trace confirms non-actionable memory updates do not become runtime prompts unless intentionally classified. | Browser sees the update through product API/SSE; daemon does not feed UI-only updates to model runtimes. |
| Agent API and Slock CLI | `slock memory read/search/write/propose` or agreed equivalents route through daemon/local proxy and hide version details from agent UX. Writes remain behind write gates. | Daemon CLI parser tests, proxy rewrite tests, ClientHandler JSON-RPC forwarding tests, backend endpoint tests. | Real runtime uses generated `slock` wrapper to read/search/write/propose memory in an authorized channel. | CLI command maps to correct endpoint/method/body; write commands honor `SLOCK_ALLOW_WRITES=1` or project write gate; unauthorized targets fail closed. |
| Scoped runtime sessions | DM, channel, thread, and task conversations use separate logical session scopes. Top-level DM does not reuse channel/task context; task work prefers task scope. | Daemon unit tests for scope-id derivation and provider session-id storage per scope; routing tests for DM/channel/thread/task events. | Runtime trace showing distinct session scope keys and provider session IDs for marker messages in separate scopes. | Same agent can receive DM/channel/task markers without reusing unrelated provider session context by default. |
| Task memory and promotion | Task-scoped notes/evidence/final summary are separate from channel memory; only durable conclusions are promoted to channel memory/proposal. | Backend task memory API tests; daemon/session completion handoff tests; promotion/proposal permission tests. | Browser/API scenario creates task memory, completes task, then verifies promoted channel memory/proposal. | Task memory is visible on task surface; channel memory changes only through explicit promotion/write/proposal path. |
| Frontend channel memory UI | Channel surface exposes shared memory summary/path entries, recent updates, provenance/source links, and proposals if included in MVP. | Frontend unit tests for memory state/rendering; API client tests; lint/build. | WebDriver marker scenario on channel page with screenshot and DOM assertion. | UI displays expected memory entries without exposing private-channel data to unauthorized contexts. |
| Frontend task memory UI | Task detail shows task memory plan/evidence/final summary and promoted conclusions. | Frontend unit tests for task memory panel/components and state refresh after events. | WebDriver marker scenario on task detail page with screenshot and API/DB cross-check. | Task memory appears under the task, not as canonical channel memory until promoted. |
| Browser real-test evidence | Browser-visible workflows must use project WebDriver, not Playwright, and save task-local evidence. | Not a substitute for automated tests; use as final product proof. | `./twd` scan/snapshot/screenshot plus API/DB cross-check under task evidence directory. | Evidence includes route, marker, visible DOM proof, screenshot path, API/DB proof, and result notes. |
| Runtime trace evidence | Runtime/daemon behavior must be diagnosable through `smallkhoj-trace` and daemon logs. | Daemon tests cover classification/routing; trace is final integration proof. | `./smallkhoj-trace summary --json` or `logs/daemon` output tied to markers. | Trace shows marker delivery to intended runtime/session only and absence from unrelated scopes. |

## Automated Test Commands

Run these only after dependencies are installed and the implementation is ready.

### Backend

Primary backend checks:

```bash
cd backend
uv run pytest
```

Targeted checks for this task:

```bash
cd backend
uv run pytest tests/test_memory_store.py
uv run pytest tests/test_public_events.py tests/test_daemon_control.py
```

Expected backend coverage:

- Memory path normalization and unsafe path rejection.
- Channel/task scope visibility and private-channel membership checks.
- Read/list/path/search APIs for authorized and unauthorized principals.
- Write/propose APIs with source message/path provenance.
- CAS/baseSha conflict behavior and actionable conflict responses.
- Event creation after committed memory writes.
- Selective retrieval/context manifest behavior.

### Daemon and Slock CLI

Install dependencies first if missing, then run:

```bash
cd agent/daemon/aaa-daemon
npm install
npm test
```

Targeted daemon checks:

```bash
cd agent/daemon/aaa-daemon
npm run build
node --test test/slock-cli.test.mjs test/slock-cli-coverage.test.mjs test/proxy-wrapper.test.mjs test/daemon-runtime.test.mjs
```

Expected daemon coverage:

- `slock memory read/search/write/propose` parser behavior.
- Write gate behavior for memory write/propose commands.
- Local proxy route rewriting and JSON-RPC forwarding for memory commands.
- Scoped runtime session key derivation:
  - `dm:<user_id>`
  - `channel:<channel_id>`
  - `thread:<channel_id>:<root_message_id>`
  - `task:<task_id>`
- Provider session IDs tracked per logical scope.
- DM/channel/thread/task events route to the correct scope and do not poison message freshness.
- Memory update events do not become runtime prompts unless explicitly classified as actionable.

Do not use real provider e2e tests as the first failure detector. Use `npm test` and fake-runtime coverage first, then run real runtime evidence once local services and credentials are intentionally prepared.

### Frontend

Install dependencies first if missing, then run:

```bash
cd frontend
npm install
npm run lint
npm run build
```

Targeted frontend tests should be added or updated for memory UI behavior. If test runner wiring remains the current Node test style, run the relevant tests through the project-established command or direct Node/tsx command used by the existing frontend tests. The current package exposes:

```bash
cd frontend
npm run lint
npm run build
npm run e2e
```

Use `npm run e2e` only if the task explicitly needs the existing Playwright suite for non-repository browser automation. For repository UI verification, the real evidence path must use `./twd` per project SOP.

Expected frontend coverage:

- Channel memory panel/list renders entries, source/provenance, recent update state, and proposal/audit state when implemented.
- Task memory panel renders plan/evidence/final summary and promoted conclusion state.
- Private channel memory is not displayed after unauthorized API responses.
- SSE/product events refresh memory UI without manual page reload.
- Critical mutation forms use robust submit behavior and prove a real POST/PUT occurred.

## Real Browser Evidence Plan

Use one unique marker per verification run:

```text
REAL_channel_memory_scoped_sessions_<yyyyMMddHHmmss>
```

Save evidence under:

```text
.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/
```

Minimum evidence files:

```text
REAL_<marker>-notes.md
REAL_<marker>-channel-memory.png
REAL_<marker>-task-memory.png
REAL_<marker>-api.json
REAL_<marker>-db.txt
REAL_<marker>-trace.json
```

Browser workflow:

```bash
./twd --compact tabs
./tools/twd-guard/twd-open /chat/all
./tools/twd-guard/twd-eval /chat/all "return { path: location.pathname, text: document.body.innerText.slice(0, 1000) }"
./twd screenshot --url-match 127.0.0.1:3000 .trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/REAL_<marker>-channel-memory.png
```

Channel memory scenario:

- Open a channel where the verifying user is authorized.
- Create or update a channel memory entry such as `decisions/channel-memory.md` with the marker.
- Verify the entry appears in the channel memory UI.
- Verify provenance/source fields show source message, author, timestamps, and source path when relevant.
- Cross-check the backend API response contains the marker and expected metadata.
- If private channels are implemented, repeat with a non-member or revoked member and verify the UI/API fail closed.

Task memory scenario:

- Create or open a task tied to the channel.
- Add task-scoped memory with the marker, including plan/evidence/final-summary style entries.
- Verify task memory appears on the task surface.
- Promote a durable conclusion to channel memory or create a proposal, depending on the final product decision.
- Verify task memory and channel memory/proposal remain distinct in UI and API state.

SSE/realtime scenario:

- Keep the channel/task page open.
- Write memory from another authorized actor/API path.
- Verify the open browser updates without manual refresh.
- Capture `scan`, `snapshot`, or `eval` output showing the marker.

API/DB cross-checks should be read-only for evidence collection. Example shapes:

```bash
curl -sS http://127.0.0.1:8000/api/v1/channels/<channel>/memory \
  -H 'X-Public-Key: <key>' > .trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/REAL_<marker>-api.json
```

```sql
SELECT id, scope_type, scope_id, path, content_sha256, version, source_message_id, source_path, author_member_id, created_at, updated_at
FROM memory_entries
WHERE content_text LIKE '%REAL_channel_memory_scoped_sessions_%'
ORDER BY updated_at DESC
LIMIT 10;
```

Adjust table/API names to the final implementation, but keep the evidence marker-first and read-only.

## Real Runtime and Session-Scope Evidence Plan

Use the real runtime SOP only after backend, frontend, daemon, and credentials are intentionally running. Do not use fake recorders for final runtime proof.

Preconditions:

- Backend is running at `http://127.0.0.1:8000`.
- Frontend is running at `http://127.0.0.1:3000`.
- Project WebDriver master is connected.
- A daemon is connected through the product connect-ticket flow.
- A real agent runtime is started for the target agent.

Evidence commands:

```bash
./smallkhoj-trace summary --json > .trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/REAL_<marker>-trace.json
./smallkhoj-trace logs --tail 200 --json > .trellis/tasks/06-22-channel-memory-store-and-scoped-sessions/evidence/REAL_<marker>-logs.json
```

Runtime workflow:

- Send a DM marker to the real agent and verify the runtime reply appears in the same DM.
- Send a channel marker and verify it uses a channel-scoped session, not the DM session.
- Send a task/thread marker and verify it uses task/thread scope where applicable.
- Ask the runtime to read/search memory through `slock memory read` or `slock memory search`.
- Ask the runtime to write/propose memory only with the write gate enabled and only in an authorized context.
- Verify the trace/logs show distinct session-scope keys and provider session IDs for DM/channel/task markers.

Pass criteria:

- Browser shows the human marker and runtime reply in the correct DM/channel/thread/task surface.
- DB/API state shows messages and memory entries tied to the intended scope.
- Trace/logs show delivery to the intended runtime only.
- No unrelated DM/channel/task context is injected into another scope.
- No self-authored memory/event update loops back into the same runtime as new work.

## Optional Runtime Trace Deep-Dive

Use this when the final validation fails or the runtime appears stuck:

- Start from the Activity timeline and identify the last `runtime_working`, `runtime_thinking`, `runtime_output`, and `runtime_idle` transitions for the marker.
- If the runtime reached idle but did not reply, inspect the session JSONL to confirm whether the model called `slock message send`.
- Compare daemon trace `sessionId`/scope fields with provider session files when available.
- Treat `runtime_output` and `runtime_idle` as observability, not inbound work; they must not generate runtime prompts.

## Risks to Verify Explicitly

- Private channel memory leakage through search, retrieval, UI caches, or daemon prompt context.
- Stale CAS writes overwriting newer channel memory.
- Agents seeing DB version details instead of actionable re-read/merge/proposal instructions.
- Full channel memory injection diluting attention or leaking unrelated context.
- One runtime session per agent continuing to pollute DM/channel/task conversations.
- UI-only memory update events accidentally delivered as runtime work.
- Slock write commands bypassing write gates.
- Task memory promoted to channel memory without an explicit product decision or proposal trail.
- Browser proof showing rendered HTML but no real mutation request due hydration/origin issues.
- FUSE/local projection being validated prematurely before server API semantics are stable.

## Final Acceptance Checklist

- Backend lint/type/test checks pass in a dependency-ready environment.
- Daemon build and unit/fake-runtime tests pass.
- Frontend lint/build and relevant component/state tests pass.
- Browser evidence exists under the task `evidence/` directory and includes screenshots, DOM proof, API/DB cross-checks, and marker notes.
- Runtime trace evidence proves scoped session isolation for DM, channel, thread, and task flows.
- Private-channel and revoked-access cases fail closed.
- CAS conflict behavior is tested and documented in evidence.
- Task memory and channel memory remain distinct except for explicit promotion/proposal.
- No final validation relies on Playwright for repository UI proof; use `./twd` for real browser verification.
