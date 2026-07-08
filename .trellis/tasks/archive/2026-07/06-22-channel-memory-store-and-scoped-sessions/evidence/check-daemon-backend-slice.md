# Check: Daemon/Backend Memory Slice

Date: 2026-06-23
Worktree: `/Users/code/project/smallkhoj-channel-memory-store-and-scoped-sessions`
Scope: backend memory store/API/events plus daemon Slock CLI/proxy/session-scope slice.

## Commands Run

```bash
cd /Users/code/project/smallkhoj-channel-memory-store-and-scoped-sessions/backend
rtk env PYTHONPATH=. uv run pytest tests/test_memory_store.py tests/test_public_events.py -q
```

Result: pass, `17 passed in 0.22s`.

```bash
cd /Users/code/project/smallkhoj-channel-memory-store-and-scoped-sessions/backend
rtk env PYTHONPATH=. uv run python -m py_compile services/memory_api.py routers/public_api.py routers/agent_api.py models/slock.py models/__init__.py
```

Result: pass.

```bash
cd /Users/code/project/smallkhoj-channel-memory-store-and-scoped-sessions/agent/daemon/aaa-daemon
rtk npm run build
```

Result: pass, `tsc`.

```bash
cd /Users/code/project/smallkhoj-channel-memory-store-and-scoped-sessions/agent/daemon/aaa-daemon
rtk node --test test/session-scope.test.mjs test/proxy-wrapper.test.mjs test/slock-cli.test.mjs
```

Result: pass, `24` tests passed.

Broader related checks:

```bash
cd /Users/code/project/smallkhoj-channel-memory-store-and-scoped-sessions/backend
rtk env PYTHONPATH=. uv run pytest -q
```

Result: pass, `53 passed in 0.32s`.

```bash
cd /Users/code/project/smallkhoj-channel-memory-store-and-scoped-sessions/agent/daemon/aaa-daemon
rtk npm test
```

Result: pass, `131` tests passed. This includes `npm run build && node --test test/*.test.mjs`; it does not run real provider e2e scripts.

## Contract Review

### Path Safety

Backend path normalization is centralized in `backend/services/memory_store.py`.

- Converts backslashes to `/`, strips leading slashes, collapses duplicate slashes, and rejects empty, `.`, `..`, normalized traversal, and NUL-containing segments.
- Covered by `backend/tests/test_memory_store.py::test_normalize_memory_path_keeps_agent_usable_paths_safe`.
- Daemon CLI encodes each path segment separately before sending `/path/{path}`, preserving slash-separated memory paths while escaping segment contents.

Verdict: pass for current slice.

### CAS / Conflict Behavior

`write_memory_entry()` computes `contentSha256` and checks `baseSha256`/`baseSha` with `require_matching_base_sha()`.

- Existing entries compare against the current entry hash.
- New entries compare against the empty-content hash when a base hash is supplied.
- Conflict returns HTTP `409` with `code: MEMORY_CONFLICT`, `currentSha256`, and actionable re-read/merge/proposal language.
- Daemon CLI accepts `--base-sha` but keeps DB version details out of the normal command UX.

Verdict: pass for current slice. Version numbers are still serialized in API responses, but the agent command surface does not require manual version handling.

### Scoped Memory Endpoints

Backend public/UI endpoints exist:

- `GET /api/v1/memory/scopes/{scopeType}/{scopeId}`
- `GET /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
- `PUT /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
- `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/search`
- `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals`
- `GET /api/v1/channels/{channel}/memory`
- `GET /api/v1/tasks/{taskId}/memory`

Backend agent endpoints exist:

- `GET /internal/agent-api/memory/scopes/{scopeType}/{scopeId}`
- `GET /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/path/{path}`
- `GET /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/search`
- `POST /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/search`
- `PUT /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/path/{path}`
- `POST /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/proposals`

Verdict: pass for current slice.

### Write Gate

Daemon Slock CLI write/propose commands are gated by `SLOCK_ALLOW_WRITES=1` or `AAA_DAEMON_ALLOW_WRITES=1`, with optional target allowlist enforcement.

- `slock memory write` and `slock memory propose` carry write safety resources of the form `memory:<scope>:<id>:<path>`.
- Tests assert write commands do not reach the proxy without opt-in.

Verdict: pass for daemon CLI/proxy slice.

### Private Channel Membership In Agent API

Agent API resolves scope with `viewer=member`, then checks channel/task/thread visibility before listing, reading, searching, writing, or proposing memory.

- Private and DM channel memory requires `ChannelMember` membership.
- Public channel memory remains visible to authenticated agents.
- Task memory visibility allows creator/assignee or visible channel membership.
- This satisfies the specific agent API private membership requirement.

Verdict: pass for agent API.

### Memory Events Scope

Memory writes/proposals add committed `EventRecord` rows:

- `memory.created`
- `memory.updated`
- `memory.proposal.created`

Public event scope handling maps:

- channel memory to `scope.kind = "channel"` with channel id/name when available
- task memory/proposals to `scope.kind = "task"` and task id
- thread memory to `scope.kind = "thread"`
- agent memory to `scope.kind = "member"`

Payload includes `memoryId` or `proposalId`, `scopeType`, `scopeId`, `path`, hash/version for entry updates, `channelId`/`channel`, and `taskId` where available. Tests cover channel and task memory event scopes.

Daemon runtime-actionable gate still allows only task creation and thread-summary request events. `memory.*` is not included, so memory UI/cache events should not become runtime prompts by default.

Verdict: pass for current slice.

### Runtime Session Scope Key

`src/daemon/session-scope.ts` defines stable logical keys:

- `dm:<peerMemberId>`
- `channel:<channelId>`
- `thread:<channelId>:<rootMessageId>`
- `task:<taskId>`

Task scope wins over thread/channel when a task id is present; thread wins over broad channel for thread replies; DM/channel scopes do not share the same key. Tests cover these selector contracts.

Verdict: pass for pure selector/current slice. Provider session id tracking per logical scope is not wired into runtime delivery yet; this is already marked as remaining work in `task-plan.md`.

## Focused Risk Checks

### Route Ordering

No blocking route ordering issue found.

- Memory path routes include the literal `/path/` segment before `{path:path}`, so they do not swallow `/search` or `/proposals`.
- Agent search supports both GET and POST, matching CLI/proxy GET usage and backend design POST usage.
- Convenience aliases `/channels/{channel}/memory` and `/tasks/{taskId}/memory` are distinct from existing routes by suffix.

### API Path Consistency

No mismatch found in the daemon/backend path chain.

- CLI emits `/internal/agent/{agentId}/memory/scopes/...`.
- Proxy rewrites `/memory...` suffixes to `/internal/agent-api/memory...`.
- ClientHandler forwards JSON-RPC memory methods through the same `/memory/scopes/...` paths.
- Backend agent routes expose those paths.

### Event Payload Sufficiency

No blocking payload gap found for cache invalidation/UI wake-up. Entry update events include id, scope, path, hash/version, and channel/task identifiers. Proposal events include proposal id, scope, path, status, and channel/task identifiers.

Non-blocking note: proposal events do not include proposed content or reason, which is appropriate for a browser-safe wake-up event but means UI must refetch proposal details.

### ORM / Migration

No obvious ORM/startup migration blocker found.

- ORM models and startup table creation include memory entries/proposals, scope/type check constraints, active unique scope/path index, updated/source indexes, provenance fields, file/blob reference fields, timestamps, and soft-delete column.
- `models/__init__.py` exports the new models, and `py_compile` passed.

Non-blocking note: startup migration adds only newly introduced compatibility columns for existing tables. If a future branch changes memory table columns after this first slice, those additions will need `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` coverage for existing local DBs.

## Findings

No blocking issue found in the reviewed backend/daemon slice.

No implementation files were modified during this check.

## Non-Blocking Risks / Follow-Ups

- Public/UI memory routes currently resolve scopes without a member/account viewer. They are protected by public API key auth, but they do not enforce private-channel membership per account. This is not a blocker for the requested agent API slice, but it should be addressed before relying on public/UI memory endpoints for private channel UI access.
- Runtime session scope is currently a pure key selector with tests. Provider session id storage/routing per logical scope is still future work and is already listed as incomplete in the task plan.
- Backend has no explicit lint script in `backend/pyproject.toml`; validation used pytest plus `py_compile`. Daemon lint/type-check is covered by `npm run build`/`tsc`.
- Frontend files are modified in this worktree (`frontend/app/tasks/page.tsx`, `frontend/lib/control-plane.ts`) but were outside this daemon/backend slice review and were not changed.

## Verification Summary

- Backend targeted tests: pass, `17 passed`.
- Backend compile/type sanity: pass.
- Backend broader tests: pass, `53 passed`.
- Daemon build/type-check: pass.
- Daemon targeted tests: pass, `24 passed`.
- Daemon broader tests: pass, `131 passed`.
- Lint: no backend lint script found; daemon `tsc` build passed.
- Blocking items: none.
