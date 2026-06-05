# Research: Agent Delegation Control Plane -- Gaps Audit

- **Query**: Identify concrete gaps and deficiencies across worker task status reporting, frontend completeness, backend code quality, and end-to-end integration
- **Scope**: internal
- **Date**: 2026-06-03

## Findings

### Files Found

| File Path | Description |
|---|---|
| `backend/routers/agent_api.py` | Worker-facing API (2609 lines), prefix `/internal/agent-api/` |
| `backend/routers/public_api.py` | Supervisor-facing API (786 lines), prefix `/api/v1/` |
| `backend/routers/auth.py` | Token hash auth for agent and machine tokens |
| `backend/models/slock.py` | All data models (Server, Member, Computer, AgentWorkspace, Channel, Message, Task, etc.) |
| `backend/models/seed.py` | DB seed with local agent/machine tokens |
| `backend/services/reminder_scheduler.py` | Background reminder firing loop |
| `backend/main.py` | FastAPI app entry, mounts both routers |
| `frontend/app/daemon/page.tsx` | Full `/daemon` dashboard (800 lines) |
| `agent/daemon/aaa-daemon/src/slock-cli.ts` | CLI that routes commands through local proxy |
| `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts` | Local HTTP proxy that rewrites paths and injects auth |
| `agent/daemon/aaa-daemon/src/runtime/slock-wrapper.ts` | Generates `.slock/slock` wrapper scripts |
| `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts` | Claude runtime driver with system prompt |
| `agent/daemon/aaa-daemon/test/slock-cli.test.mjs` | Comprehensive CLI/proxy tests (1071 lines) |

---

## 1. Worker Task Status Reporting Loop

### What exists

The full chain is implemented in code:

1. **CLI -> Proxy**: `slock task update --channel "#all" --number 2 --status done` (slock-cli.ts line 341-371) routes to either:
   - `POST /internal/agent/{id}/tasks/update-status` with `{channel, task_number, status}` (when --channel and --number provided)
   - `PATCH /internal/agent/{id}/tasks/{taskId}` with `{status, ...}` (when --id provided)

2. **Proxy -> Backend**: agent-proxy.ts line 49 rewrites any `/tasks` prefix path: `if (suffix.startsWith('/tasks')) return /internal/agent-api${suffix}${search}`. This covers both `/tasks/update-status` and `/tasks/{id}`.

3. **Backend routes**:
   - `POST /internal/agent-api/tasks/update-status` (agent_api.py line 1578-1628) looks up task by `task_number` + channel, updates status, records activity, commits.
   - `PATCH /internal/agent-api/tasks/{task_id}` (agent_api.py line 1682-1736) looks up by UUID, patches any fields.

4. **Tests**: The test at slock-cli.test.mjs line 797-807 exercises the full CLI -> Proxy -> Fake Upstream path for task create, claim, and update, confirming correct HTTP method, path, and body.

5. **PRD verification notes** (prd.md line 151): claims `.slock/slock task update --channel "#all" --number 2 --status done` was verified against real PostgreSQL.

### Identified gaps

**Gap A: The "update by number" path requires `--channel` but the CLI `slock task update --id <uuid>` path does NOT require channel.** The `POST /tasks/update-status` route (line 1578) accepts an optional `channel` filter. If the worker does not pass `--channel`, the CLI falls through to the `PATCH /tasks/{id}` path (line 354-372), which only works if the worker knows the task UUID. Workers receiving a `task_created` event get `taskId` in the payload but not necessarily `taskNumber` + channel in the same envelope.

**Gap B: No automated E2E test against real backend+DB.** All daemon tests use a fake upstream server. There is no test file under `backend/` that exercises the full chain through FastAPI against a real PostgreSQL instance. The PRD verification notes describe manual curl-like testing, not automated regression tests.

**Gap C: The `task_created` event payload (agent_api.py line 1489-1498) sends `taskNumber` and `title` in details but does NOT send `taskId`.** The `_record_activity` call at line 1489 passes `{"taskNumber": task.task_number, "title": task.title}` as details. The `taskId` is present at the top level of the event (from `_activity_event` line 443: `"taskId": str(activity.task_id)`), but the `_record_activity` function does not propagate `task_id` into `details.taskId`. A worker parsing the `details` field alone will miss the task UUID needed for `slock task update --id`.

Wait -- rechecking: `_activity_event` at line 435-448 does include `activity.task_id` as top-level `taskId`. And the `EventRecord` payload at line 728-738 merges details into the payload. So `taskId` IS in the event. The detail payload after merge at line 728 would contain `taskId` from the activity. This gap is minor -- the data is there but at the activity level, not in the `details` sub-object.

**Gap D: The system prompt (claude-runtime.ts line 78-80) instructs the worker to use `slock task list|create|claim|update` but does NOT instruct it to automatically report status after receiving task events.** The system prompt says "Use slock task update to record status changes when the write gate allows it" (line 133) but this is a passive instruction. There is no automatic loop where a worker, upon receiving a `task_created` event with itself as assignee, transitions to `in_progress` and later to `done` without explicit human prompting.

This confirms the PRD gap statement: "the worker needs supervisor manual status update." The mechanism is fully wired in code but the worker's behavior is not automated -- it depends on Claude following the system prompt instruction.

---

## 2. Frontend Completeness

### What is actually rendered

The `/daemon` page (frontend/app/daemon/page.tsx) is a full server-side rendered Next.js page that:

1. **Fetches real data** from 7 backend endpoints in parallel (line 204-214):
   - `/api/v1/channels`
   - `/api/v1/members`
   - `/api/v1/computers`
   - `/api/v1/tasks`
   - `/api/v1/activity?limit=25`
   - `/api/v1/files?limit=12`
   - `/api/v1/reminders?limit=12`

2. **Dispatch section** (line 408-448): Three real server actions:
   - `createTaskAction` -> `POST /api/v1/tasks` with channel, title, description, assignee, status
   - `updateTaskAction` -> `PATCH /api/v1/tasks/{taskId}` with status, assignee
   - `sendMessageAction` -> `POST /api/v1/channels/{name}/messages` with content, sender

3. **Agent Control section** (line 450-495): Two real server actions:
   - `updateMemberAction` -> `PATCH /api/v1/members/{memberId}` with status, permissions, actions
   - `createReminderAction` -> `POST /api/v1/reminders` with title, agent, channel, delaySeconds

4. **Data panels**: Computers/Workspaces, Activity Feed, Tasks list, Reminders list, Files list, Recent Messages -- all populated from real API data.

### Identified gaps

**Gap E: No error feedback on form submissions.** The server actions (e.g., `createTaskAction` at line 151-160) call `apiWrite` which does `await fetch(...)` with no error checking (line 141-149). If the backend returns 400/500, the user sees no feedback -- the page just revalidates.

**Gap F: `updateTaskAction` passes `taskId` that may be a pipe-delimited string.** Line 164: `formData.get("taskId")` comes from the `ControlSelect` with `splitValue` prop. The select options are formatted as `"uuid|#number title"` (line 428). The `splitValue` prop on ControlSelect extracts the first segment before `|` as the value (line 785-786: `const [value, label] = splitValue ? item.split("|", 2) : [item, item]`). So this works correctly -- the UUID portion is sent. No actual bug here.

**Gap G: Frontend defaults `sender` to hardcoded `"zy-ean"`.** Line 176: `sender: "zy-ean"`. The `create_channel_message` endpoint (public_api.py line 356-433) uses `body.get("sender") or "zy-ean"` as fallback. This is hardcoded and only works for the single supervisor user.

**Gap H: No loading indicators or optimistic updates.** All forms use `action={serverAction}` which triggers a full page revalidation. The UX is functional but basic.

---

## 3. Backend Code Quality Issues

### Bug: `verify_public_api_key` always rejects non-matching keys

**File**: `backend/routers/public_api.py` lines 35-46.

The function at line 43-46 has a dead code path:
```python
# Check against hashed api_keys table
token_hash = hashlib.sha256(key.encode()).hexdigest()
result = await db.execute(select(Member).limit(1))
raise HTTPException(401, "Invalid API key")
```

It queries `Member` instead of `ApiKey`, does not check the result, and unconditionally raises 401. Only the hardcoded `sk_public_local` key works. This means any attempt to use a proper API key through the public API will fail.

### Missing auth on several public endpoints

These `GET` endpoints skip `verify_public_api_key` entirely:
- `GET /api/v1/channels/{channel_name}/messages` (line 319) -- no auth dependency
- `POST /api/v1/channels/{channel_name}/messages` (line 356) -- no auth dependency
- `GET /api/v1/activity` (line 551) -- no auth dependency
- `GET /api/v1/files` (line 579) -- no auth dependency
- `GET /api/v1/reminders` (line 604) -- no auth dependency

These are accessible without any API key. The frontend sends `X-Public-Key` for all calls, but the backend ignores it on these routes.

### Missing validation

**Task status values are not validated.** In `POST /tasks/update-status` (agent_api.py line 1588-1593), `new_status` is accepted as any string. Similarly, `PATCH /tasks/{id}` at line 1711 sets `task.status = body["status"]` without validation. There is no enum or check against valid statuses (`todo`, `in_progress`, `in_review`, `done`, `closed`).

**Permission check uses falsy check instead of explicit false.** In `_require_permission` (agent_api.py line 742-749):
```python
if not permissions.get(permission):
    raise HTTPException(403, ...)
if not permissions[permission]:
    raise HTTPException(403, ...)
```
This double-check is redundant (both check the same falsy condition). If `permissions` is `None`, the function returns early allowing all access. This is documented behavior (line 744: "if permissions is None, return").

### Race condition on task_number generation

`_next_task_number` (agent_api.py line 302-306) reads `MAX(task_number) + 1` without locking. Concurrent task creation requests could generate duplicate task numbers. The `UniqueConstraint("channel_id", "task_number")` in the model would cause one to fail with a DB error, but this would surface as a 500 rather than a retry.

### SSE stream reuses a single db session

In `get_events` (agent_api.py line 1087-1133), the SSE stream generator (`event_stream`) captures `db` from the outer scope and uses it in a long-running async loop. SQLAlchemy async sessions are not designed for concurrent use across interleaved awaits in a long-lived SSE connection. This may lead to session errors under load.

### Message seq is global, not per-channel

`_next_message_seq` (used in agent_api.py line 965-966) queries `MAX(seq)` across ALL messages, not just the channel. This is consistent but means seq values are global monotonically increasing numbers, which may be confusing for per-channel history.

---

## 4. End-to-End Integration Flow

### Complete dispatch->claim->update chain (what works)

1. **Supervisor creates task**: Frontend `createTaskAction` -> `POST /api/v1/tasks` -> creates Task row with status "todo" -> writes `supervisor_task_created` activity + `task_created` EventRecord.

2. **Worker sees task**: Worker polls `GET /internal/agent-api/events?since=latest` -> receives `task_created` event with `taskNumber`, `title`, `taskId`, `assigneeId`. Or worker runs `slock task list` to see all tasks.

3. **Worker claims task**: `slock task claim --channel "#all" --number N` or `slock task claim --id <taskId>` -> routes through proxy -> `POST /tasks/claim` or `POST /tasks/{id}/claim` -> sets `assignee_id`, status to `in_progress` -> writes `task_claimed` activity + event.

4. **Worker reports done**: `slock task update --channel "#all" --number N --status done` or `slock task update --id <taskId> --status done` -> routes through proxy -> `POST /tasks/update-status` or `PATCH /tasks/{id}` -> updates status -> writes `task_status_changed` activity + event.

5. **Supervisor sees update**: Frontend revalidates after action -> `GET /api/v1/tasks` shows updated status.

### Broken or manual links

**Gap I: No automatic task-to-worker routing.** When a supervisor creates a task with `assignee: "aaa"`, the task is stored with `assignee_id` set, but no `task_assigned` event is explicitly generated. The `task_created` event includes assignee info, but the worker's daemon inbox polling does not filter events by "tasks assigned to me." The worker receives ALL events for channels it belongs to. If multiple workers share a channel, each receives every task event.

**Gap J: Worker must know to poll events or check tasks.** There is no push mechanism from daemon to Claude runtime when a new task event arrives. The daemon's event polling (via `slock message check`) buffers events, and the daemon injects them into Claude's stdin as formatted text envelopes. But Claude must be actively running a turn to process them. If Claude has completed its turn and is idle, the daemon's inbox events wait until the next human prompt or daemon restart.

**Gap K: The `slock task update` CLI has two modes that may confuse workers.** If a worker uses `slock task update --id <uuid> --status done` (without `--channel` and `--number`), it takes the PATCH path. If it uses `slock task update --channel "#all" --number 2 --status done`, it takes the POST update-status path. Both work, but the system prompt only mentions `slock task update` generically. The Claude runtime system prompt (claude-runtime.ts line 78) says `slock task list|create|claim|update` without detailing the two modes.

**Gap L: No task->message linking convention.** Tasks have a `message_id` field but the frontend Dispatch form does not set it. The supervisor creates tasks without linking them to a specific message. Workers have no standard way to post progress back to a task-linked thread.

---

## Related Specs

- `.trellis/tasks/06-02-agent-delegation-control-plane/prd.md` -- Full PRD with 122 acceptance criteria

## Caveats / Not Found

- No automated backend test suite exists under `backend/`. All verification is manual per PRD notes.
- The daemon tests (35/35 passing) cover the CLI->Proxy->FakeUpstream chain but not Proxy->RealBackend.
- No `.trellis/spec/` files were found for this feature area.
- The `knowledge` path is referenced in the proxy rewrite (`/knowledge`) but no backend route handles it (would return 404).
- The `prepare-action` path is referenced in the proxy rewrite but no backend route handles it.
