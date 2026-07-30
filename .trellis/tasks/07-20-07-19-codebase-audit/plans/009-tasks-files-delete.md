# Plan 009 (Direction): Add `DELETE` to Tasks and Files (CRUD-minus-one)

## Current remediation disposition (2026-07-24)

- **Disposition**: `SUPERSEDED_BY_SCHEMA_AND_DELIVERY`
- **Release scope**: important-bug remediation, with final release closure still
  pending.
- **Backend status**: the current local candidate replaces the unsafe advisory
  implementation with PostgreSQL-backed Task/File delete contracts, primitive
  tombstones, post-commit event publication, and bounded storage cleanup.
- **Visible integration status**: critical local `./twd` evidence passed under
  marker `REAL_audit_delivery_ui_20260723235900`: Task UI confirmation and DB
  tombstone, File SSE removal, and the quarantined-cleanup `role=alert` warning.
- **Evidence index**:
  [`REAL_audit_delivery_ui_20260723235900-notes.md`](../evidence/REAL_audit_delivery_ui_20260723235900-notes.md).
- **Closure boundary**: this is local candidate evidence only. A clean candidate,
  final full gate, precise commits, PR/squash merge, and post-merge deployment are
  still required before calling the work released.

The plan below is retained as the historical advisory proposal. Its route
snippets are not the accepted implementation contract and must not be replayed.

> **Executor instructions**: This is a small, well-scoped feature plan.
> Read it fully, then implement. Honor the STOP conditions. Update the
> status row in `plans/README.md` when done.

## Status

- **Priority**: P3
- **Effort**: S–M (hours to a day per entity; both together ≈ a day)
- **Risk**: LOW
- **Depends on**: `plans/001-pytest-baseline.md`
- **Category**: direction / feature
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

Tasks and Files are CRUD-minus-one: both have GET/POST/PATCH but no
`DELETE`. They can only be removed as side effects of cascade deletes on
their parent channel/message (`public_api.py:1069-1071, 3653, 4364-4375`).
For a "control room" product this is daily friction: an operator who
creates a wrong task or uploads a wrong file cannot correct it without
nuking the parent. The activity log then mis-attributes the deletion to
the cascade, not to the operator's intent.

`frontend/components/task-board.tsx:46` shows task statuses include
`"done"` and `"closed"` — the UI workaround is "drag to a terminal
column." `frontend/app/chat/[channel]/channel-client.tsx:1497-1560` shows
file rows with preview/download/open-message buttons but no delete.

## Current state

**Task routes** (`backend/routers/public_api.py`):

```
2389: GET    /tasks                          list
2519: POST   /tasks/{task_id}/assignments    create assignment
2596: GET    /tasks/{task_id}                get one
2824: GET    /tasks/{task_id}/memory         list task memory
2860: POST   /tasks/{task_id}/memory/request request memory
2889: POST   /tasks                          create
3028: PATCH  /tasks/{task_id}                update
```

No `DELETE /api/v1/tasks/{task_id}`.

**File/attachment routes** (`public_api.py:3342-3474`):

```
GET    /files        list
POST   /files        upload
GET    /files/{id}   metadata
GET    /files/{id}/download  download
```

No `DELETE /api/v1/files/{id}`.

**Cascade delete helpers** at `public_api.py:1069-1071, 3653, 4364-4375`
already do `delete(Task).where(Task.id.in_(task_ids))` and
`delete(FileEntry)...` as side effects — reuse the same `_delete_saved_item_references`
helper pattern they use.

**UI**: `task-board.tsx:46` has terminal statuses but no delete affordance;
`channel-client.tsx:1497-1560` file rows have no delete button.

## Repo conventions to match

- Mutating routes use the signature
  `async def name(..., _auth: None = Depends(verify_public_api_key), db: AsyncSession = Depends(get_db))`.
- After mutation, the pattern is: `_record_activity(...)`, `await db.commit()`,
  `await _push_committed_events(db, server_id=server.id)`, return JSON.
- Server scope is established via `_resolve_active_server_context(db, request)`.
- Ownership/admin checks use `require_admin_role(context.membership)` (see
  plan 002; also already used by `delete_member`).

## Scope

**In scope**:

- `backend/routers/public_api.py` — add `DELETE /tasks/{task_id}` and
  `DELETE /files/{file_id}`.
- New tests: `backend/tests/test_task_delete.py`,
  `backend/tests/test_file_delete.py`.
- `frontend/components/task-board.tsx` (or `task-detail-dialog` if it
  exists) — add a delete control.
- `frontend/app/chat/[channel]/channel-client.tsx` — add a delete button
  to file rows (lines ~1497-1560).
- `frontend/lib/control-plane.ts` — add the typed client methods.

**Out of scope**:

- Bulk delete (array of IDs) — single-ID delete first; bulk is a follow-up
  if needed.
- Soft-delete / trash / undo — hard delete with a confirm dialog in the UI
  is the v1; soft-delete is a separate product decision.
- Permission gating beyond admin/server-scope — the same
  `require_admin_role` check from plan 002 is reused.

## Steps

### Step 1: Add `DELETE /tasks/{task_id}`

In `backend/routers/public_api.py`, after the `PATCH /tasks/{task_id}`
handler (~line 3028), add:

```python
@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)   # match delete_member pattern
    server = context.server
    task = await _resolve_task(db, server, task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    # Reuse the existing saved-item cleanup pattern.
    await _delete_saved_item_references(db, "task", task.id)
    # Cascade task assignments if not handled by FK ON DELETE CASCADE.
    await db.execute(delete(TaskAssignment).where(TaskAssignment.task_id == task.id))
    await db.execute(delete(Task).where(Task.id == task.id))

    actor = await _resolve_human_actor(db, server, request, body_get_actor(request), role="task deleter")
    await _record_activity(db, server, actor, "task_deleted",
                           f"@{actor.display_name} deleted task {task.short_id}",
                           {"taskId": str(task.id), "shortId": task.short_id})
    await db.commit()
    await _push_committed_events(db, server_id=server.id)
    return {"deleted": True, "taskId": str(task.id)}
```

(Confirm `_resolve_task`, `_delete_saved_item_references`, and
`TaskAssignment` imports exist at the top of the file before writing; if
`_resolve_task` is named differently, use the actual name.)

**Verify**: write `backend/tests/test_task_delete.py`:
- Non-admin → 403.
- Admin deleting a nonexistent task → 404.
- Admin deleting an existing task → 200, task gone on subsequent GET, an
  activity row recorded.

`cd backend && uv run pytest tests/test_task_delete.py -q` → pass.

### Step 2: Add `DELETE /files/{file_id}`

Mirror Step 1 for files, after the file download handler (~line 3474):

```python
@router.delete("/files/{file_id}")
async def delete_file(
    file_id: str,
    request: Request,
    _auth: None = Depends(verify_public_api_key),
    db: AsyncSession = Depends(get_db),
):
    context = await _resolve_active_server_context(db, request)
    require_admin_role(context.membership)
    server = context.server
    file_entry = await _resolve_file(db, server, file_id)
    if not file_entry:
        raise HTTPException(404, "File not found")

    await _delete_saved_item_references(db, "file", file_entry.id)
    await db.execute(delete(FileEntry).where(FileEntry.id == file_entry.id))

    actor = await _resolve_human_actor(db, server, request, body_get_actor(request), role="file deleter")
    await _record_activity(db, server, actor, "file_deleted",
                           f"@{actor.display_name} deleted file {file_entry.file_name}",
                           {"fileId": str(file_entry.id), "fileName": file_entry.file_name})
    await db.commit()
    await _push_committed_events(db, server_id=server.id)
    return {"deleted": True, "fileId": str(file_entry.id)}
```

**Verify**: write `backend/tests/test_file_delete.py` (mirror Step 1's
three cases). `cd backend && uv run pytest tests/test_file_delete.py -q`
→ pass.

### Step 3: Add frontend delete affordances

- `frontend/lib/control-plane.ts`: add `deleteTask(taskId)` and
  `deleteFile(fileId)` typed client methods modeled on the existing
  `updateTask` / `uploadFile` methods.
- Task UI: add a delete button to the task detail dialog (or the task
  card's overflow menu) with a confirm dialog ("Delete this task? This
  cannot be undone.").
- File UI: add a delete button to each row in
  `channel-client.tsx:1497-1560` with a confirm dialog.

**Verify**: `./twd` screenshot (per AGENTS.md — use the project WebDriver,
not Playwright) showing:
- A task can be deleted from the UI and disappears from the board.
- A file can be deleted from the UI and disappears from the file list.
- In both cases a confirmation dialog appears first.

## Done criteria

- [ ] `grep -nE '@router\.delete\("/tasks' backend/routers/public_api.py`
      returns a match.
- [ ] `grep -nE '@router\.delete\("/files' backend/routers/public_api.py`
      returns a match.
- [ ] `cd backend && uv run pytest -q` exits 0 (including the two new
      test files).
- [ ] `./twd` confirms the two UI delete flows work end-to-end.
- [ ] `plans/README.md` status row for plan 009 updated to DONE.

## STOP conditions

- `_resolve_task` or `_resolve_file` is named differently in the live code
  — use the actual names; do not invent helpers.
- `TaskAssignment` does not have `ON DELETE CASCADE` from `task_id` AND
  the model declaration forbids the explicit
  `delete(TaskAssignment)...` step — confirm against `models/slock.py`
  before writing Step 1.
- The frontend uses a shared delete-confirm component that the plan's
  ad-hoc dialog would duplicate — use the shared component instead.

## Maintenance notes

- **Hard delete is intentional for v1.** If operators need undo later,
  introduce soft-delete (`deleted_at`) as a separate migration via plan
  004's workflow — do not retrofit it into this plan.
- **Audit trail**: the `_record_activity` call is the audit record; future
  compliance work should confirm it captures enough (who, what, when,
  which server).
- **Reviewer scrutiny**: confirm the admin-role gate is present on BOTH
  endpoints (mirrors plan 002's security posture).
