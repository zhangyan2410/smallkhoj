# Plan 019: CI workflow + Makefile + frontend test/typecheck scripts (DX-02, DX-03, DX-04)

## Status
- **Priority**: P2, Effort: M, Risk: LOW
- **Depends on**: plans 001 + 002 (DONE)
- **Category**: DX

## Why this matters
No CI exists (`.github/workflows/` doesn't exist). Frontend has 24 test files in `frontend/test/` but `package.json` has no `test` script — they never run. Frontend has no `typecheck` script; backend has no ruff/mypy. Every change ships with no automated gate — that's why this audit found so much.

## Current state
- `.github/workflows/` — missing entirely
- `frontend/package.json` scripts: `dev`, `build`, `e2e`, `start`, `lint`, `avatar:preview`, `server`, `server:dev` — NO `test`, NO `typecheck`
- `frontend/test/` — 24 `.test.ts(x)` files using Node's built-in runner (`import test from "node:test"`)
- `backend/pyproject.toml` — no `[tool.ruff]`, no `[tool.mypy]`

## Scope
**In scope**:
- `.github/workflows/ci.yml` (new) — backend pytest + frontend build/lint/test/typecheck on PR.
- `Makefile` (new, repo root) — `make test`, `make test-backend`, `make test-frontend`, `make lint`, `make typecheck`.
- `frontend/package.json` — add `test` + `typecheck` scripts.
- `backend/pyproject.toml` — add `[tool.ruff]` config.
- New dev dep: `ruff` in backend `[dependency-groups] dev`.

**Out of scope**: Fixing all existing lint/type errors (the first CI run may surface them — record in NOTES, don't fix in this plan).

## Steps

### Step 1: Frontend `test` + `typecheck` scripts
In `frontend/package.json` `scripts`:
```json
"test": "node --test test/**/*.{test,spec}.{ts,tsx}",
"typecheck": "tsc --noEmit"
```
The `.tsx` test files may need `tsx --test` instead of `node --test` if Node can't parse TSX natively. Verify by running; if `node --test` fails on `.tsx`, use `tsx --test` (tsx is already a dev dep).

**Verify**: `cd frontend && bun run test` — at least some tests run (may have failures; that's OK, we're adding the capability, not fixing everything).

### Step 2: Backend ruff config
In `backend/pyproject.toml`:
```toml
[dependency-groups]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.24.0",
    "ruff>=0.6.0",
]

[tool.ruff]
line-length = 120
target-version = "py310"
extend-exclude = [".venv", "node_modules"]

[tool.ruff.lint]
# Start conservative; expand later. E/warnings + F (pyflakes) + I (import sorting).
select = ["E", "F", "I", "W", "UP"]
ignore = [
    "E501",   # line length handled by formatter
    "E203",   # whitespace before :
    "B008",   # function call in default argument (FastAPI Depends)
]

[tool.ruff.lint.per-file-ignores]
"__init__.py" = ["F401"]   # re-exports
"tests/*" = ["E501"]       # tests can have long lines
```

Add `lint` script capability:
```toml
[project.scripts]
# (optional) not strictly needed; CI runs `uv run ruff check .`
```

**Verify**: `cd backend && uv sync` then `uv run ruff check .` — may report issues; that's OK for first run.

### Step 3: Makefile
At repo root:
```makefile
.PHONY: test test-backend test-frontend lint typecheck install

install:
	cd backend && uv sync
	cd frontend && bun install --frozen-lockfile

test: test-backend test-frontend

test-backend:
	cd backend && uv run pytest

test-frontend:
	cd frontend && bun run test

lint:
	cd backend && uv run ruff check .
	cd frontend && bun run lint

typecheck:
	cd frontend && bun run typecheck
```

**Verify**: `make test-backend` → pytest runs. `make test-frontend` → node --test runs.

### Step 4: GitHub Actions CI
`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - uses: astral-sh/setup-uv@v3
      - run: uv sync
      - run: uv run ruff check .
      - run: uv run pytest

  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
      - run: bun run test
      - run: bun run build
```

**Verify**: `act -W .github/workflows/ci.yml` if `act` is installed locally; otherwise just confirm the YAML parses (`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`).

## Done criteria
- [ ] `.github/workflows/ci.yml` exists and parses as valid YAML.
- [ ] `Makefile` exists with `test`/`lint`/`typecheck` targets.
- [ ] `frontend/package.json` has `test` + `typecheck` scripts.
- [ ] `backend/pyproject.toml` has `[tool.ruff]` config and `ruff` in dev deps.
- [ ] `cd backend && uv run pytest -q` still exits 0 (no regression from ruff config).
- [ ] `make test-backend` runs pytest.
- [ ] `make test-frontend` runs at least some tests.

## STOP conditions
- `node --test` can't parse `.tsx` test files even with `tsx` available — use `tsx --test` and report.
- Running `bun run test` reveals the existing 24 test files are broken (e.g. wrong imports, missing mocks) — report; do NOT fix all tests in this plan, just add the script. Note the breakage count in NOTES.
- `bun install --frozen-lockfile` fails in CI because of the lockfile drift (DX-01) — note; that's plan 020's territory, don't fix here.

## Maintenance notes
- The first CI run will likely surface lint/type/test failures. Don't fix them in this plan; open follow-up tasks to clean them up incrementally.
- `ruff check .` starts conservative (E/F/I/W/UP). Expand the rule set once the baseline is clean.
- Reviewer scrutiny: confirm CI runs on both PR and main push; confirm `uv sync` (not `uv pip install`) so dev deps are included.
