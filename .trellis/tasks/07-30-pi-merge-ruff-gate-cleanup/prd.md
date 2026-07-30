# Repair Pi merge gate regressions

## Goal

Restore the canonical SmallKhoj merge gate after the bundled Pi runtime was
merged to `main`, so the Integration Gate restoration can be reviewed and
merged on top of a green Pi-enabled baseline.

## Background

- `origin/main` is `d8d194f`, including the bundled Pi runtime merge.
- The Integration Gate branch is rebased onto that commit and is otherwise
  clean.
- The Red evidence is `make ci` failing in `backend` Ruff with six findings:
  five import-order/import-source findings and one `F811` duplicate handler
  name in `routers/agent_api.py`.
- After the Ruff repair, the same canonical gate reached frontend tests and
  exposed the next merge layer: 11 failures plus one module-load error. The Pi
  branch was developed before the `(app)` persistent-shell route migration;
  merging it onto the newer shell line left stale test paths, a malformed
  tasks route containing both generations, and a dropped `next/dynamic`
  import.
- The earlier Pi runtime test failure was environmental: `npm ci` restored the
  lockfile dependency and the daemon suite then passed 273/273.

## Requirements

- Preserve both Anthropic and OpenAI Pi relay routes and their request
  behavior; only give their Python handler functions unique descriptive names.
- Apply Ruff's deterministic import organization and move `Iterable` to
  `collections.abc` without changing runtime behavior.
- Reconcile the Pi task-projection route with the persistent `(app)` shell:
  keep one `TaskProjectionProvider` tree and use the body-only `ProductShell`
  contract owned by `app/(app)/layout.tsx`.
- Update Pi-added source-contract tests to inspect the current `(app)` route
  paths and the extracted task projection component that now owns task UI.
- Restore the missing `next/dynamic` import used by lazy chat widgets.
- Keep changes limited to deterministic Pi merge regressions plus this Trellis
  task; do not redesign runtime or product behavior.
- Do not modify or clean the user-owned dirty root worktree.

## Acceptance Criteria

- [x] `cd backend && uv run ruff check .` passes.
- [x] Focused Pi relay/lease tests pass.
- [x] Focused frontend regression tests for `(app)` paths, task projection,
  shell ownership, and chat lazy widgets pass.
- [x] Frontend type-check/build accepts the reconciled tasks and chat routes.
- [x] `npm test` in `agent/daemon/aaa-daemon` passes with the locked Pi
  dependency installed.
- [x] Integration Gate tests pass 39/39.
- [x] Canonical `make ci` passes against a disposable PostgreSQL instance.
- [ ] `git diff --check` passes and the feature worktree is clean after commit.

## Out of Scope

- Changing Pi relay protocols, capacity semantics, provider selection, or
  frontend behavior.
- Reverting the persistent app shell or the Pi task-projection architecture.
- Addressing `npm audit` advisories from transitive Pi dependencies.
