# Plan 014: Scope `TaskRunTemplate` to server (cross-tenant IDOR)

> **Executor instructions**: This plan requires a schema migration and
> therefore depends on plan 004 (Alembic) landing first. Do NOT attempt to
> add the column via raw DDL. Follow the plan step by step; if 004 has not
> landed, STOP and report.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches the template model + every read/write path)
- **Depends on**: `plans/004-alembic-schema-source.md` (must land first — this plan adds a column via Alembic)
- **Category**: security
- **Planned at**: commit `47848e8`, 2026-07-19 (deferred from plan 002)

## Why this matters

`TaskRunTemplate` is the **only** top-level entity without a `server_id`
column (every other table — Server, Member, Channel, Task, etc. — has one).
`get_template_by_ref` (services/task_run_templates.py:152) selects by id or
slug with only `status == "active"`; no server filter.

Consequence: any authenticated user on server A can PATCH/disable any
active template used by server B by guessing or enumerating the slug
(`general-task-runner` is a known default). Templates carry
`system_instruction`, `tool_policy`, `memory_policy` that drive agent
behavior — this is a cross-tenant tampering primitive.

The model already has a `visibility` field with three values
(`builtin` / `server` / `user`), which gives a natural cleavage:
- `builtin` templates stay global (shared, read-only).
- `server` / `user` templates get `server_id` scoping.

## Current state

**`backend/models/slock.py:404-426`** — `TaskRunTemplate` model. No
`server_id` column. Has `visibility` with `builtin`/`server`/`user` check
constraint (line 410).

**`backend/services/task_run_templates.py:152-167`** — `get_template_by_ref`:
```python
stmt = select(TaskRunTemplate).where(TaskRunTemplate.status == "active")
if parsed:
    stmt = stmt.where(TaskRunTemplate.id == parsed)
else:
    stmt = stmt.where(TaskRunTemplate.slug == str(ref).strip().lower())
result = await db.execute(stmt.limit(1))
return result.scalar_one_or_none()
```

**Public routes** (public_api.py):
- 2405 `GET /task-run-templates` (list)
- 2419 `POST /task-run-templates` (create)
- 2443 `PATCH /task-run-templates/{template_ref}` (update)
- 2471 `POST /task-run-templates/{template_ref}/disable`

All call `_resolve_active_server_context` to assert login but never pass
`server` into the template lookup.

## Scope

**In scope**:
- `backend/models/slock.py` — add `server_id` column (nullable initially;
  `builtin` rows stay NULL).
- New Alembic migration (under `backend/alembic/versions/`).
- `backend/services/task_run_templates.py` — `get_template_by_ref`,
  `create_template`, `update_template`, `disable_template`, and list helper
  all gain a `server_id` parameter and filter on it.
- `backend/routers/public_api.py` — the four template routes pass `server.id`.
- New test: `backend/tests/test_template_server_scoping.py`.

**Out of scope**:
- The `builtin` templates — they stay global (server_id NULL, read-only).
- Changing the visibility check constraint values.
- Backfilling existing `server`/`user` templates — Step 3 decision; existing
  rows can be assigned to the default server or left NULL and migrated
  case-by-case.

## Steps

### Step 1: Add `server_id` column to the model

In `backend/models/slock.py`, `TaskRunTemplate`:
```python
server_id: Mapped[uuid.UUID | None] = mapped_column(
    UUID(as_uuid=True),
    ForeignKey("servers.id", ondelete="CASCADE"),
    nullable=True,   # NULL for builtin templates
)
```
And add an index:
```python
Index("idx_task_run_templates_server", "server_id", "status"),
```

### Step 2: Alembic migration

```
cd backend && uv run alembic revision -m "task_run_template_server_id"
```

In the generated file:
```python
def upgrade():
    op.add_column(
        "task_run_templates",
        sa.Column("server_id", sa.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_task_run_templates_server_id",
        "task_run_templates",
        "servers",
        ["server_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "idx_task_run_templates_server",
        "task_run_templates",
        ["server_id", "status"],
    )

def downgrade():
    op.drop_index("idx_task_run_templates_server", table_name="task_run_templates")
    op.drop_constraint("fk_task_run_templates_server_id", "task_run_templates", type_="foreignkey")
    op.drop_column("task_run_templates", "server_id")
```

**Verify**: `cd backend && uv run alembic upgrade head` → exit 0;
`\d task_run_templates` in psql shows the new column + FK + index.

### Step 3: Decide backfill for existing non-builtin templates

**STOP if uncertain** — operator decision. Options:
- (a) Leave existing `server`/`user` templates with `server_id = NULL` and
  treat NULL as "read-only legacy" until manually reassigned. Safest.
- (b) Backfill all non-builtin templates to `DEFAULT_SERVER_ID` (from
  public_api.py:112). Aggressive; assumes they all belong to the default
  server.

Default to (a) unless operator says otherwise. Document the choice.

### Step 4: Thread `server_id` through service layer

In `backend/services/task_run_templates.py`:
- `get_template_by_ref(db, ref, *, server_id: uuid.UUID | None)` — add:
  ```python
  stmt = select(TaskRunTemplate).where(
      TaskRunTemplate.status == "active",
      or_(
          TaskRunTemplate.server_id == server_id,
          TaskRunTemplate.visibility == "builtin",   # global, read-only
      ),
  )
  ```
- `create_template(...)` — require `server_id` for `visibility in ("server", "user")`.
- `update_template` / `disable_template` — refuse to modify `builtin`
  templates, and filter by `server_id` for non-builtin.

### Step 5: Update routes

In the four public routes, pass `server.id` from `_resolve_active_server_context`.

**Verify**: write `backend/tests/test_template_server_scoping.py`:
- Server A user cannot PATCH/disable a server-B template → 404 (not 403, to avoid enumeration).
- Server A user can use a `builtin` template → 200.
- Creating a `server`-visibility template sets `server_id`.

`cd backend && uv run pytest tests/test_template_server_scoping.py -q` → pass.

## Done criteria

- [ ] `grep -n "server_id" backend/models/slock.py` shows the column on `TaskRunTemplate`.
- [ ] Alembic migration exists and `alembic upgrade head` succeeds on a scratch DB.
- [ ] `cd backend && uv run pytest -q` exits 0.
- [ ] New `test_template_server_scoping.py` passes the 3 cases.
- [ ] `git status` shows only in-scope files + new migration + new test.

## STOP conditions

- Plan 004 (Alembic) has not landed — STOP, this plan cannot proceed without it.
- A `builtin` template is being mutated by a legitimate operator path that
  this plan breaks — report; builtin templates may need a separate admin
  override, but do NOT remove the read-only protection by default.
- Step 3 operator decision is "backfill" but existing templates have
  ambiguous ownership (multiple servers used them) — report; default to
  leaving them NULL (Option a).

## Maintenance notes

- **`builtin` stays global and read-only** — that's the contract. If you
  later want per-server builtin overrides, that's a separate feature
  (template inheritance), not this plan.
- **Future migrations that add server-scoped entities** should follow this
  pattern: `server_id` column, FK to servers with CASCADE, index on
  `(server_id, status)`, service-layer filter.
- **Reviewer scrutiny**: confirm `get_template_by_ref`'s `or_(server_id == X,
  visibility == "builtin")` cannot be bypassed by passing a crafted ref.
  Every read/write path must go through the service layer, not query the
  model directly.
