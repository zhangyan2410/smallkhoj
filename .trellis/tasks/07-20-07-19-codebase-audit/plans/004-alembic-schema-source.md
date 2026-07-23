# Plan 004: Introduce Alembic and consolidate the two schema sources

> **Executor instructions**: This is a LARGE plan with MED risk and real
> blast radius (touches schema bootstrap for every environment). Follow it
> step by step. Run every verification command and confirm the expected
> result before moving to the next step. If anything in the "STOP conditions"
> section occurs, stop and report — do not improvise. When done, update the
> status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 47848e8..HEAD -- backend/models/seed.py backend/models/slock.py backend/models/base.py backend/main.py backend/pyproject.toml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding.
> NOTE: `backend/pyproject.toml` will differ if plan 001 was merged or
> cherry-picked — that is expected, NOT a STOP.

## Status

- **Priority**: P2
- **Effort**: L (multi-day)
- **Risk**: MED (touches schema bootstrap for every environment)
- **Depends on**: `plans/001-pytest-baseline.md` (need tests to verify the
  migration does not break existing paths)
- **Category**: migration / tech-debt
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

The schema is currently defined by **two uncoordinated sources**:

1. `backend/models/slock.py` — 31 declarative SQLAlchemy tables.
2. `backend/models/seed.py` — 755 lines of hand-written DDL: 15
   `CREATE TABLE IF NOT EXISTS` blocks (all 15 also declared in `slock.py`)
   plus 12 tables worth of `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` patches
   layered on top.

At startup `create_tables()` runs `Base.metadata.create_all` (which no-ops on
any table that already exists) and then runs the raw DDL. Consequences:

- **Drift is silent and runtime-only**: a column added to `slock.py` for a
  table also re-defined in `seed.py` may not appear in the DB if the raw
  `CREATE TABLE` ran first; no tool detects this.
- **No rollback**: a bad schema change cannot be reverted; the only recovery
  is manual SQL.
- **No review surface**: schema evolution is buried in 755 lines of
  idempotent-if-exists statements that read as "stuff that has accumulated"
  rather than as intentional migrations.
- **Conflicts with plan 003**: the `messages.seq` fix assumes the column is
  a real DB identity. If `seed.py`'s raw `CREATE TABLE messages` did not
  declare it as `IDENTITY`/`SERIAL`, the autoincrement never worked and plan
  003 cannot land until this plan adds a proper migration.

This plan introduces Alembic, makes `slock.py` the single declarative source,
captures the current schema as the baseline, and converts the raw DDL in
`seed.py` into versioned migrations.

## Current state

**`backend/models/seed.py`** (755 lines) — runs at startup from
`backend/main.py:lifespan` via `create_tables()`:

```python
async def create_tables():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.execute(text("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64)"))
        # ... 15 more ALTER TABLE ... in the first 25 lines
        # ... then 15 CREATE TABLE IF NOT EXISTS blocks for:
        #     accounts, server_memberships, server_invites,
        #     chat_thread_read_cursors, task_run_templates, task_runs,
        #     task_assignments, external_connectors, external_routes,
        #     external_events, external_sessions, external_mappings,
        #     memory_entries, memory_proposals, saved_items
        # ... plus indexes and CHECK constraints
```

**`backend/models/slock.py`** — 31 declarative tables including all 15
above (confirmed by listing `__tablename__`).

**`backend/models/base.py`** — engine + session factory:

```python
engine = create_async_engine(settings.database_url, echo=settings.debug)
async_session = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass
```

**`backend/main.py:lifespan`** calls `await create_tables()` at startup.

**No Alembic**: `find backend -name 'alembic*'` returns nothing; no
`alembic.ini`, no `versions/` directory.

**Test bootstrap pattern**: tests that need schema use a fake connection
that captures executed statements
(`backend/tests/test_integration_gateway.py:72`, `test_task_runs.py:86`,
`test_server_account_membership.py:83`, `test_chat_read_cursors.py:70`) —
each defines `async def run_sync(self, callback): self.run_sync_callback = callback`.
One test (`test_chat_read_cursors_postgres_http.py`) uses a real Postgres
and calls `await conn.run_sync(Base.metadata.create_all)` directly.

## Commands you will need

| Purpose              | Command                                                      | Expected on success |
|----------------------|--------------------------------------------------------------|---------------------|
| Install alembic      | `cd backend && uv add alembic`                               | exit 0              |
| Tests                | `cd backend && uv run pytest -q`                             | exit 0              |
| Init Alembic         | `cd backend && uv run alembic init alembic`                  | creates `alembic/` + `alembic.ini` |
| Autogenerate         | `cd backend && uv run alembic revision --autogenerate -m "baseline"` | creates a new version file |
| Migration smoke      | `cd backend && uv run alembic upgrade head`                  | exit 0 against a scratch DB |
| Rollback drill       | `cd backend && uv run alembic downgrade -1`                  | exit 0, reverses the last migration cleanly |

A scratch Postgres database is required for migration smoke tests. Use the
existing `docker-compose.yml` `db` service (Postgres 16 + pgvector).

## Repo conventions to match

- Async engine lives in `backend/models/base.py`; Alembic's `env.py` must
  use the same `DATABASE_URL` and the same `Base.metadata` from
  `backend/models/slock.py` (imported via `from models import Base` after
  `pythonpath=["."]` from plan 001 is in place).
- Settings come from `backend/config.py:settings` (`pydantic-settings`).
- Tests use `pytest-asyncio`; migration tests (if added) follow the same.

## Scope

**In scope**:

- `backend/pyproject.toml` — add `alembic` dependency.
- `backend/alembic.ini` (new) — Alembic config, async template.
- `backend/alembic/env.py` (new) — wired to `settings.database_url` and
  `Base.metadata`.
- `backend/alembic/script.py.mako` (new) — default from `alembic init`.
- `backend/alembic/versions/0001_baseline.py` (new) — captures current
  schema as the baseline.
- `backend/models/seed.py` — delete the raw DDL; reduce `create_tables()`
  to a no-op stub (or remove the function and update callers).
- `backend/models/slock.py` — Step 6a updates `Message.seq` to use
  `Identity(always=True)` (replaces the no-op `autoincrement=True`).
- `backend/main.py:lifespan` — stop calling `create_tables()`; the operator
  runs `alembic upgrade head` as a deploy step (documented).
- `backend/.env.example` — already has `DATABASE_URL`; no change needed.
- `docker-compose.yml` / `docker-compose.prod.yml` — add a migration step
  to the backend service startup (or a one-shot `migrate` service).
- `AGENTS.md` or `docs/` — document the migration command as part of
  deployment.

**Out of scope**:

- Any data backfill beyond what is required for the baseline to apply to an
  existing DB (see Step 5).
- Changing the `messages.seq` column to `IDENTITY` — that is plan 003's
  concern; if plan 003's STOP condition fired, add ONE additional migration
  here (Step 6) to do the identity conversion. Otherwise leave `seq` alone.
- Splitting `seed.py` test fixtures — the fake-connection pattern in tests
  is unaffected (tests mock at the SQLAlchemy layer, not the DDL layer).

## Git workflow

- Branch: `advisor/004-alembic-schema-source`.
- Commits per step, conventional-commit style:
  - `chore(backend): add alembic dependency`
  - `feat(db): wire alembic env to async engine + Base.metadata`
  - `feat(db): capture current schema as baseline migration`
  - `refactor(db): remove raw DDL from seed.py, single declarative source`
  - `chore(deploy): run alembic upgrade head on backend startup`
  - `docs: document migration workflow`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add Alembic dependency

`cd backend && uv add alembic`. Confirm it appears in `pyproject.toml`
under `[project] dependencies` (or `[dependency-groups] dev` if you prefer
to keep it dev-only — but Alembic must be available in production images,
so prefer a production dependency).

**Verify**: `cd backend && uv run alembic --version` → prints a version.

### Step 2: Initialize Alembic with async config

`cd backend && uv run alembic init -t async alembic`.

Edit `backend/alembic.ini`:
- Set `sqlalchemy.url` to empty (we'll use `env.py` to read from settings).

Edit `backend/alembic/env.py` to wire it to the existing engine and metadata.
Replace the autogenerated `target_metadata` and `run_migrations_*` blocks so
the file reads approximately:

```python
import asyncio
from logging.config import fileConfig

from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlalchemy import pool

from alembic import context

# `backend/` is on sys.path thanks to plan 001's pytest pythonpath; for
# `alembic` CLI invocations from `backend/`, the cwd also makes these importable.
from config import settings
from models import Base
# Import models so they register on Base.metadata:
import models.slock  # noqa: F401

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations():
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online():
    asyncio.run(run_async_migrations())


run_migrations_online()
```

**Verify**: `cd backend && uv run alembic check` (or
`uv run alembic current`) — connects to the dev Postgres and prints the
current revision (none yet) without error.

### Step 3: Capture the baseline migration

**Important nuance**: the existing dev DB already has all tables (created by
`seed.py` over time). `--autogenerate` against this DB will produce an
**empty** migration because the schema matches. What we want is a baseline
that, applied to a fresh DB, reproduces the current schema.

Two-path approach — pick based on whether a fresh DB is available:

**Path A (preferred)**: drop the dev DB schema (or spin up a fresh Postgres
via `docker-compose up -d db`), then:

```
cd backend && uv run alembic revision --autogenerate -m "baseline"
```

This produces `backend/alembic/versions/<hash>_baseline.py` containing all
31 tables. Inspect it: confirm it contains the `pgvector` extension, the
`pgcrypto` extension (for `gen_random_uuid()`), all CHECK constraints and
indexes from `seed.py`.

**Path B (if a fresh DB is not feasible)**: run `--autogenerate` against the
existing dev DB. The output will be empty or near-empty. In that case, write
the baseline migration by hand from the `slock.py` declarations, and mark it
as `stamps` the current state. Then `alembic stamp head` against existing
environments to mark them as already at baseline without running the DDL.

**Verify**:
- Path A: against a SECOND fresh DB, `uv run alembic upgrade head` produces
  all 31 tables; `psql -c "\dt"` lists them; the app boots and the suite
  passes.
- Path B: `uv run alembic stamp head` against the dev DB succeeds and
  `alembic current` shows the baseline revision.

### Step 4: Remove the raw DDL from `seed.py`

Once the baseline migration reproduces the current schema:

- Delete all `conn.execute(text("ALTER TABLE ..."))` and
  `conn.execute(text("CREATE TABLE ..."))` lines from
  `backend/models/seed.py`.
- Reduce `create_tables()` to:

  ```python
  async def create_tables():
      """Deprecated: schema is now managed by Alembic. Kept as a no-op for
      backward compatibility with older callers; will be removed after one
      release cycle."""
      # Migration is now `alembic upgrade head`, run as a deploy step.
      return
  ```

- (Optional, second commit) remove `create_tables` entirely and update
  `backend/main.py:lifespan` to drop the `await create_tables()` call.

**Verify**: `cd backend && uv run pytest -q` → all tests still pass (tests
either mock the connection or use `Base.metadata.create_all` directly, so
the loss of `seed.py`'s DDL does not affect them).

### Step 5: Add the migration step to deployment

In `docker-compose.yml` and `docker-compose.prod.yml`, change the `backend`
service command to run migrations before the app:

```yaml
  backend:
    build: ./backend
    command: sh -c "uv run alembic upgrade head && uv run uvicorn main:app --host 0.0.0.0 --port 8000"
    ...
```

(Confirm the base image has both `uv` and the installed deps; if the
production image is slim, the migration may need to run as a separate
one-shot `migrate` service that shares the image.)

**Verify**: `docker compose up -d db backend` against a fresh DB volume; the
backend logs show `alembic upgrade head` succeeds before uvicorn starts.

### Step 6: (REQUIRED — promoted from conditional after plan 003's probe)
Convert `messages.seq` to a real DB IDENTITY column

**Background**: Plan 003's executor empirically confirmed that
`messages.seq` is NOT a working identity column today. The model declares
`seq: Mapped[int] = mapped_column(BigInteger, autoincrement=True, unique=True)`
at `backend/models/slock.py:270`, but in SQLAlchemy `autoincrement=True`
only takes effect on the primary-key column (or one with an explicit
`Identity()`/`Sequence()`). The PK here is `id UUID`, so `seq` is a plain
`BIGINT NOT NULL` with no generator — INSERT without an explicit `seq`
raises `NotNullViolationError`. The app has been masking this with
`max(seq)+1` in Python (plan 003's race bug). This step makes `seq` a real
identity so plan 003-seq can later drop the manual assignment.

**6a. Update the model declaration** in `backend/models/slock.py:270`:

```python
from sqlalchemy import Identity   # add to imports if not present

seq: Mapped[int] = mapped_column(
    BigInteger,
    Identity(always=True, start=1, increment=1),
    unique=True,
)
```

(Drop the now-meaningless `autoincrement=True` — `Identity()` supersedes it.
The `Identity()` makes `Base.metadata.create_all` emit
`GENERATED ALWAYS AS IDENTITY` for fresh installs.)

**6b. Add a migration** for existing environments (where the table already
exists from the old `create_all` without identity):

```
cd backend && uv run alembic revision -m "messages_seq_identity"
```

In the generated file:

```python
def upgrade():
    # Backfill any NULL seq values defensively (there should be none — app
    # always assigned manually — but the identity column requires NOT NULL
    # and existing rows must have concrete values before we add IDENTITY).
    op.execute("""
        WITH next_seq AS (
            SELECT COALESCE(MAX(seq), 0) AS m FROM messages
        )
        UPDATE messages SET seq = (SELECT m FROM next_seq) + row_number() OVER (ORDER BY created_at)
        WHERE seq IS NULL;
    """)
    op.execute("""
        ALTER TABLE messages
        ALTER COLUMN seq ADD GENERATED ALWAYS AS IDENTITY ();
    """)

def downgrade():
    op.execute("""
        ALTER TABLE messages
        ALTER COLUMN seq DROP GENERATED ALWAYS AS IDENTITY ();
    """)
```

**Verify**:
- `cd backend && uv run alembic upgrade head` exits 0 against a dev DB.
- Manual probe: `INSERT INTO messages (id, short_id, channel_id, sender_id, content, channel_type, mentions) VALUES (...)` without `seq` succeeds and assigns an auto-incremented `seq`.
- `cd backend && uv run pytest -q` → no regressions (tests that construct
  `Message(seq=...)` explicitly still work because `GENERATED ALWAYS` allows
  explicit inserts only with `OVERRIDING SYSTEM VALUE` — if any test breaks
  here, those tests need updating to not pass `seq=`; report if so).

**6c. Unblocks**: Once 6a + 6b land, the BLOCKED plan 003-seq half can
proceed (remove the manual `seq=` assignment from the three call sites
and the `_next_message_seq` helper). Add a note to that plan's maintenance
section: "re-run the executor probe first to confirm IDENTITY is live."

## Test plan

- Existing suite (`uv run pytest -q`) is the regression gate — must still pass
  after Step 4.
- Add `backend/tests/test_migration_baseline.py` (optional, recommended):
  spin up a fresh Postgres (via `docker-compose` or a `pytest` fixture),
  run `alembic upgrade head`, assert the 31 expected tables exist.
- Rollback drill: after the baseline, `alembic downgrade base` should leave
  an empty DB (no orphan tables). Not required to be clean if Path B was
  used (baseline only stamps); document that.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `find backend -name 'alembic.ini'` and `find backend -name 'alembic' -type d`
      both return matches.
- [ ] `cd backend && uv run alembic current` exits 0 and reports the baseline
      revision against the dev DB.
- [ ] `grep -cE "ALTER TABLE|CREATE TABLE IF NOT EXISTS" backend/models/seed.py`
      returns 0 (all raw DDL removed).
- [ ] `cd backend && uv run pytest -q` exits 0 (no regressions).
- [ ] Against a fresh DB volume (`docker compose down -v && docker compose up`),
      the backend boots and `alembic upgrade head` runs in its startup logs.
- [ ] `docker-compose*.yml` shows the migration command in the backend service.
- [ ] A note exists in `AGENTS.md` or `docs/` documenting the migration
      command as a deploy step.
- [ ] `git status` shows only the in-scope files modified.
- [ ] `plans/README.md` status row for plan 004 updated to DONE.

## STOP conditions

Stop and report back (do not improvise) if:

- Any in-scope file no longer matches the "Current state" excerpts at the
  cited line numbers (drift since `47848e8`).
- `alembic init -t async` produces an `env.py` template substantially
  different from what the plan assumes (newer Alembic version) — adapt, do
  not force the plan's exact code.
- The autogenerate baseline (Path A) produces a migration that does NOT
  include columns created by the `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  statements in `seed.py` (e.g. `api_keys.token_hash`). This means
  `slock.py` is missing declarations that `seed.py` was backfilling —
  STOP and report the gap; those columns must be added to `slock.py`
  FIRST so the declarative source is complete, THEN regenerate the baseline.
- `alembic upgrade head` against a fresh DB fails partway — report the exact
  error and the migration step that failed; do not edit the baseline
  migration to paper over a real schema inconsistency.
- An environment variable conflict appears (`DATABASE_URL` format not
  understood by Alembic's sync config helpers) — report; may need a small
  URL rewrite in `env.py`.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **Single source of truth**: from now on, schema changes go in `slock.py`
  (declarative) AND a new `alembic revision --autogenerate -m "..."`. Never
  edit `seed.py` DDL — it no longer exists for that purpose.
- **Step 6 is the unblock for plan 003-seq.** After Step 6 lands and the
  IDENTITY is verified live, the BLOCKED half of plan 003 (removing the
  manual `seq=` assignment) becomes safe to execute. Sequence them in that
  order: 004 (full, including Step 6) → revive 003-seq.
- **Deploy order**: `alembic upgrade head` MUST run before the app serves
  traffic. The docker-compose change in Step 5 ensures this for
  containerized deploys; for any non-containerized deploy, document the
  migration step explicitly.
- **Rollback drills**: any future migration that the team is not confident
  about should have its `downgrade()` path tested against a staging DB
  before production. The baseline migration's `downgrade()` (Path A) drops
  everything — never run `alembic downgrade base` against production.
- **Reviewer scrutiny**: the riskiest part is Step 3 (baseline capture).
  Confirm the baseline migration reproduces the production schema exactly,
  especially: pgvector/pgcrypto extensions, CHECK constraints on
  `task_assignments.role`/`mode`/`execution_strategy`, the unique index on
  `members(server_id, display_name)` created by the `DO $$ ... $$` block in
  `seed.py:26-62`, and all the `idx_*` indexes.
- **Follow-ups deferred**: the `TaskRunTemplate` cross-tenant IDOR
  (SECURITY-07) requires adding a `server_id` column — that becomes a
  natural follow-up migration once this plan lands. Do not bolt it on here.
