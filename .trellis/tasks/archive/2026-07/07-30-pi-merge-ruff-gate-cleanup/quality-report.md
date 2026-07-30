# Quality Gate Report

## Scope and Vision

- Task: `07-30-pi-merge-ruff-gate-cleanup`
- Original requirement source: this task PRD, derived from the operator request
  to update from the Pi-enabled `main`, investigate every failed gate, repair
  the regressions, and merge the Integration Gate restoration.
- Delivery completeness: complete Pi merge-gate cleanup required by the
  Integration Gate branch; no known P1/P2 follow-up tail remains.

## Acceptance

| Requirement | Result | Evidence |
|---|---|---|
| Preserve both Pi relay routes | Pass | Focused route inspection found both Anthropic and OpenAI paths; 10 focused backend tests passed |
| Restore backend Ruff gate | Pass | `uv run ruff check .` returned `All checks passed!` |
| Reconcile persistent shell and task projection | Pass | frontend 217/217; type-checks; production build; task/chat browser evidence |
| Preserve bundled Pi daemon behavior | Pass | daemon build and tests: 273/273 |
| Preserve Integration Gate behavior | Pass | Integration Gate tests: 39/39 |
| Restore canonical project gate | Pass | isolated PostgreSQL 17 + `make ci`, exit 0 |

## Canonical Verification

- `make ci` against disposable PostgreSQL 17: pass.
- Script tests: 170 passed, 1 skipped.
- Backend: Ruff pass; pytest 523 passed.
- Frontend: 217 passed; ESLint pass; `tsc --noEmit` pass;
  `tsc --noEmit -p tsconfig.e2e.json` pass; Next production build pass.
- Compose config and `git diff --check`: pass.
- Integration Gate: 39 passed.
- Daemon: 273 passed, including real bundled Pi provider relay coverage.

## Browser / Dogfood-Your-Slice

- Scope verdict: required because the merge cleanup repaired browser-visible
  shell, tasks, and chat composition.
- Current-worktree endpoints: frontend `127.0.0.1:3313`, backend
  `127.0.0.1:8313`, isolated PostgreSQL `127.0.0.1:55439`.
- `./twd` exact-path checks passed for `/tasks`, `/chat`, and
  `/control/gates`.
- Visible proof: stable `workbench-desk` owner on all three routes; task
  projection controls/empty state rendered; chat channel/DM workspace
  rendered; seven-mode gate overview rendered.
- Database cross-check after the read-only run: `accounts=1`, `servers=1`,
  `tasks=0`.
- Evidence: `evidence/REAL_pi_merge_gate_cleanup_202607301326-notes.md` and two
  screenshots in the same directory.

## Design and Artifact Hygiene

- `.pen` match: none for this merge cleanup; no new UI design was introduced.
- Root media/design artifact guard: no matches in working tree or committed
  branch delta.
- Task-local screenshots are stored under the Trellis evidence directory.

## Architecture Ownership

- Architecture cell: frontend persistent shell / realtime transport / task
  projection composition.
- Map delta: none.
- Why: the patch restores already-established owners rather than creating a
  new store, provider, router, adapter, or binding. `app/(app)/layout.tsx`
  remains the single persistent shell and realtime-provider mount;
  `TaskProjectionProvider` remains the task data owner.

## Spec Compliance

- Backend changes are deterministic lint/name repairs and preserve relay URLs,
  request validation, provider selection, and lease semantics.
- Frontend route code composes the current shared shell and extracted task
  projection components; no duplicated visual primitive or parallel state
  owner was introduced.
- Browser evidence follows `docs/real-test-sop-template.md` and uses `./twd`.
- The long-lived-branch reconciliation lesson was added to
  `.trellis/spec/frontend/quality-guidelines.md`.

## Result

Pass. The only remaining unchecked PRD item is the post-commit clean-worktree
assertion, which is verified after the work commit and before task archival.
