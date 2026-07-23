# Plan 001: Make `uv run pytest` collect and pass by default

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 47848e8..HEAD -- backend/pyproject.toml backend/conftest.py`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx / tests
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

Right now `cd backend && uv run pytest` (the obvious, documented command) fails
to collect **every** test: 27 collection errors, 0 tests collected. The reason
is that test modules do `from routers import ...` and `from models import ...`
(backend code lives at `backend/` top level, not under a package), but pytest
is launched from `backend/` with no `pythonpath` configured. The only way to
make it work today is `PYTHONPATH=. uv run pytest`, and that workaround is
documented **only** inside an archived Trellis task
(`.trellis/tasks/archive/2026-06/.../implement.md:17`), nowhere in root docs.

This blocks every other plan in this set (002–005 all use "tests pass" as a
verification gate). It also means any contributor or executor model sees the
entire suite red on first run and reasonably assumes the codebase is broken.

Secondary: `[tool.uv] dev-dependencies` is deprecated; uv prints a warning on
every invocation and a future uv release will stop honoring it, silently
dropping pytest from dev installs.

## Current state

`backend/pyproject.toml` (full content, 21 lines):

```toml
[project]
name = "smallkhoj-backend"
version = "0.1.0"
requires-python = ">=3.10"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.32.0",
    "sqlalchemy[asyncio]>=2.0.0",
    "asyncpg>=0.30.0",
    "pydantic-settings>=2.0.0",
    "httpx>=0.28.0",
    "python-dotenv>=1.0.0",
    "python-multipart>=0.0.9",
    "lark-channel-sdk>=1.1.0",
    "openai>=1.0.0",
]

[tool.uv]
dev-dependencies = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
]
```

- No `[tool.pytest.ini_options]` block anywhere.
- No `backend/conftest.py` (confirmed: `find backend -name conftest.py` returns
  nothing outside `.venv`).
- Test files import backend modules as top-level packages, e.g.
  `backend/tests/test_task_runs.py` does `from routers import ...` and
  `from models import ...`.
- `backend/main.py:1` is the FastAPI entry — its directory is `backend/`, so
  `pythonpath=["."]` from `backend/` makes `routers`, `models`, `services`,
  `config` all importable.
- Reproduced directly: `cd backend && uv run pytest --collect-only -q` →
  `Interrupted: 27 errors during collection … no tests collected`.
  With `PYTHONPATH=.`: collects 321 tests cleanly.
- Async tests currently use explicit `@pytest.mark.asyncio` markers (verified
  by grepping `backend/tests/`); setting `asyncio_mode = "auto"` is additive
  and will not change their behavior.

## Commands you will need

| Purpose              | Command                                  | Expected on success                          |
|----------------------|------------------------------------------|----------------------------------------------|
| Sync dev deps        | `cd backend && uv sync`                  | exit 0; `pytest` resolvable                  |
| Collect tests        | `cd backend && uv run pytest --collect-only -q` | `321 tests collected`, 0 errors          |
| Run full suite       | `cd backend && uv run pytest`            | exit 0; all collected tests pass             |
| Confirm no deprecation| `cd backend && uv run pytest -q 2>&1 \| grep -i deprecat` | no output (empty)              |

## Scope

**In scope** (the only files you should modify):
- `backend/pyproject.toml`

**Out of scope** (do NOT touch):
- Any file under `backend/tests/` — tests already work once collection succeeds.
- `backend/main.py`, `backend/config.py`, `backend/models/*`, `backend/routers/*`.
- The archived Trellis task that documents the `PYTHONPATH=.` workaround — leave
  it; it will be historically wrong but harmless.

## Git workflow

- Branch: `advisor/001-pytest-baseline` (matches the multi-agent git flow in
  `docs/multi-agent-development-workflow.md` — non-trivial work uses a
  `feat/*`-style sibling branch off `main`).
- Single commit, message style (conventional commits, per `git log`):
  `chore(backend): make uv run pytest collect by default`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `[tool.pytest.ini_options]` to `backend/pyproject.toml`

Append the following block to `backend/pyproject.toml` (after the existing
`[tool.uv]` table is fine, or at end of file):

```toml
[tool.pytest.ini_options]
pythonpath = ["."]
asyncio_mode = "auto"
testpaths = ["tests"]
```

Rationale per key:
- `pythonpath = ["."]` — makes `routers`, `models`, `services`, `config`
  importable when pytest runs from `backend/`. This is the single fix that
  unblocks collection.
- `asyncio_mode = "auto"` — matches the repo's existing `@pytest.mark.asyncio`
  usage and removes the need to mark every async test; purely additive.
- `testpaths = ["tests"]` — pins discovery to `backend/tests/` so accidental
  `.venv` probing is avoided.

**Verify**: `cd backend && uv run pytest --collect-only -q 2>&1 | tail -3`

Expected: a line like `321 tests collected in <sec>` and **no** `Interrupted:
… errors during collection`.

### Step 2: Migrate `dev-dependencies` to the non-deprecated table

In `backend/pyproject.toml`, replace:

```toml
[tool.uv]
dev-dependencies = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
]
```

with:

```toml
[dependency-groups]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
]
```

This is the PEP 735 dependency-groups table that uv now recommends; the legacy
`[tool.uv] dev-dependencies` form prints a deprecation warning and will be
removed in a future uv.

**Verify**: `cd backend && uv sync 2>&1 | tail -5`

Expected: exit 0, no `WARNING ... is deprecated` line mentioning
`dev-dependencies`.

### Step 3: Re-run collection and the full suite

**Verify**: `cd backend && uv run pytest -q 2>&1 | tail -10`

Expected:
- exit 0
- final line similar to `321 passed in <sec>` (the exact count may shift by a
  few if upstream tests have been edited since the audit — what matters is
  **0 failed, 0 errors**).

## Test plan

No new tests to write. This plan's "test" is that the existing 321-test suite
runs and passes from the default command. If the suite has pre-existing
failures unrelated to collection (e.g. a test that needs a live Postgres),
record each one in the plan's completion message — do NOT attempt to fix them
here; they are out of scope.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `cd backend && uv run pytest --collect-only -q` exits 0 and reports ~321
  tests collected, 0 errors.
- [ ] `cd backend && uv run pytest -q` exits 0 (or, if pre-existing failures
  exist, lists them and they are the SAME set as on `47848e8` with
  `PYTHONPATH=.` — i.e. this plan introduced zero regressions).
- [ ] `cd backend && uv sync 2>&1 | grep -i "dev-dependencies.*deprecated"`
  returns no matches.
- [ ] `git status` shows only `backend/pyproject.toml` modified; no other
  files in the diff.
- [ ] `plans/README.md` status row for plan 001 updated to DONE (or BLOCKED
  with a one-line reason).

## STOP conditions

Stop and report back (do not improvise) if:

- `backend/pyproject.toml` at the "Current state" excerpt no longer matches
  (the file has drifted since `47848e8`).
- After step 1, collection still reports `ModuleNotFoundError` for `routers`
  or `models` — this means the import scheme is different from what the plan
  assumes; STOP and report the actual import lines from a failing test.
- `uv sync` in step 2 fails to resolve `pytest` / `pytest-asyncio` (network
  issue or lockfile conflict) — do not edit `uv.lock` by hand; report.
- The full-suite run in step 3 shows failures that did NOT also fail under
  `PYTHONPATH=. uv run pytest` on the same commit — that means this plan
  introduced a regression and must be debugged, not papered over.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **Future test additions**: just drop a `test_*.py` under `backend/tests/`;
  it will be collected automatically. No per-test `@pytest.mark.asyncio`
  needed (but harmless if present).
- **If a test needs a live database**, prefer an explicit `@pytest.mark.skipif`
  or a `pytest-asyncio` fixture gated on `DATABASE_URL` reachability — do NOT
  silently start requiring Postgres for the default suite.
- **Reviewer scrutiny**: the only behavioral change is "collection works from
  `backend/` without env vars." Confirm by running the suite from a clean
  shell with no `PYTHONPATH` exported.
- **Follow-up deferred**: a CI workflow that runs this command on every PR is
  plan 002's territory (DX bundle) — not added here to keep this plan a
  single-file, zero-risk change.
