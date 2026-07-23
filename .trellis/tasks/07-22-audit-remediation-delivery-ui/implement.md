# Delivery and visible UI implementation plan

## 0. Preconditions and capsules

- [ ] Confirm schema/auth/runtime child contracts are integrated and green.
- [ ] Drift-check CI workflows, `frontend/package.json`, lockfiles, README, AGENTS,
      automated flow files, delete components/actions, loading/error boundaries and
      realtime consumers.
- [ ] Create capsules for deterministic Ruff failure, missing build env, authenticated
      flow drift, delete UX, hidden fetch errors and duplicate/full refresh evidence.
- [ ] Reproduce current failures with exact clean commands before editing.

## 1. RED/GREEN — CI baseline

- [ ] Add/update script-level tests or validation for canonical command/env wiring.
- [ ] Reproduce `ruff check .` statistics and classify every violation.
- [ ] Fix owned violations or introduce narrowly documented config; assert touched code
      cannot bypass the gate.
- [ ] Add ephemeral non-secret build env from the auth contract and secret/default-key
      source/log scanning.
- [ ] Run each workflow command locally in clean worktree order; then validate workflow
      syntax and required job dependencies.

Expected ownership: `.github/workflows/`, backend/frontend tool configuration and
minimal source fixes necessary for a truthful green baseline.

## 2. RED/GREEN — Bun and docs

- [ ] Verify `useChatWebSocket` still has zero importers and `frontend/server.ts` still
      imports `ws` before reusing plan-020 changes.
- [ ] Keep only Bun's canonical lockfile and version; remove only dead dependencies.
- [ ] Test frozen install and reject stale lockfile/package metadata.
- [ ] Rewrite frontend README/contributor commands to Bun-only supported paths.

## 3. RED/GREEN — authenticated automated flow

- [ ] Add a sentinel assertion that current flow lands on `/login`; capture intended RED.
- [ ] Build isolated account/server/membership/data bootstrap and cleanup namespace.
- [ ] Establish real supported session and active-server context; derive public/control
      key from env headers, never source/query URLs.
- [ ] Add negative absent/expired/foreign-server context cases.
- [ ] Repair the representative management flow and assert identity/server marker on
      every authenticated page transition.
- [ ] Keep this CI flow separate from `./twd` acceptance commands/documentation.

## 4. RED/GREEN — Task/File deletion UI

- [ ] Characterize current list/detail state and authorization capabilities.
- [ ] Add component/action tests for confirmation, cancel, double-submit prevention,
      401/403/404/409/500, success removal and failure restore.
- [ ] Add localized Chinese/English copy and accessibility/focus assertions.
- [ ] Wire schema child's successful APIs and dedicated deletion events; invalidate only
      owning data through the shared realtime provider.
- [ ] Assert no success/optimistic removal survives a rolled-back response.

## 5. RED/GREEN — loading, error, dynamic and refresh behavior

- [ ] Reuse plan-021 dynamic imports/error/loading changes only after component tests
      prove server/client boundaries and current bundle behavior.
- [ ] Add slow/non-ok/network error/retry tests; distinguish boundary exceptions from
      API helpers returning fallbacks.
- [ ] Make actionable failures visible at the owning surface without turning expected
      empty state into error.
- [ ] Test one SSE owner and network-call counters: task event fetches task data only;
      member/message contracts remain explicit.
- [ ] Run theme and accessibility tests for all changed states.

## 6. Clean CI-equivalent gates

- [ ] Run migration checks and `cd backend && rtk uv run pytest -q`.
- [ ] Run the final configured `cd backend && rtk uv run ruff check .`.
- [ ] Run `cd frontend && rtk bun install --frozen-lockfile`, tests, lint, typecheck and
      production build with documented ephemeral values.
- [ ] Run repaired automated flow only against isolated worktree services.
- [ ] Run `rtk proxy git diff --check` and task/spec validation.

## 7. Worktree runtime and `./twd` acceptance

- [ ] Start isolated PostgreSQL/backend/frontend/daemon with worktree-specific ports;
      record branch/commit/CWD/URL/process metadata.
- [ ] Confirm tab ownership using `rtk ./twd --compact tabs`; never reuse unrelated tabs.
- [ ] Run authenticated marker, Task/File deletion, >50-row pagination, loading/error,
      targeted task refresh and one-SSE scenarios.
- [ ] Record DOM/network markers and correlate with `rtk ./smallkhoj-trace`; capture
      screenshots for reviewer-visible states.
- [ ] Replay the documented scenario from a fresh namespace to prove reproducibility.

## 8. Truth updates

- [ ] Reconcile AGENTS, real-test SOP, frontend README, env/deployment docs and CI names.
- [ ] Correct audit claims for plans 019–023 and DOCS-01/02 to exact evidence.
- [ ] Link evidence artifacts without committing secrets, runtime data or bulky noise.
- [ ] Fill all diagnostic capsules and hand complete gate results to integration release.

## STOP conditions

- Stop if any command targets main/shared runtime, database or unrelated browser tab.
- Stop if build/e2e requires a reusable or production credential.
- Stop if workflow green depends on skipped required checks or blanket lint ignores.
- Stop delete UI work until real PostgreSQL route semantics are green.
- Stop if automated flow only proves login-page behavior or `./twd` cannot establish
  the worktree URL/identity marker.
