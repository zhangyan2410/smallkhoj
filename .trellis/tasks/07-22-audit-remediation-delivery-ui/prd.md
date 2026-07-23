# Repair delivery gates and visible UI

## Status and scope

This child repairs plans 019, 021, 022 and 023, incorporates the approved plan-020
package-manager cleanup, and closes DOCS-01/DOCS-02 plus visible Task/File deletion
work from plan 009. It consumes the final schema, auth and runtime contracts; it does
not invent replacements for them.

In scope:

- a CI definition that is green from the committed baseline and runs canonical gates;
- one Bun lockfile/package-manager contract and accurate developer documentation;
- non-secret production-build configuration for CI;
- authenticated, tenant-scoped automated flow setup without hard-coded credentials;
- loading/error, deletion and targeted-refresh UI behavior;
- worktree-specific real runtime verification through `./twd` and trace evidence;
- truthful testing rules in AGENTS/docs.

Out of scope:

- weakening lint/build/auth checks to manufacture green CI;
- using browser automation as proof for database migration or transaction behavior;
- treating the existing authenticated-drifted suite as canonical without repair;
- using Playwright in place of the repository `./twd` UI acceptance workflow.

## Requirements

### D1 — CI is green by construction

1. CI installs backend/frontend dependencies from committed lock/config sources and
   runs the same canonical commands documented for developers.
2. Ruff policy has an explicit baseline: fix violations in touched/owned code and
   either fix the repository baseline or adopt narrowly justified configuration. CI
   must not be committed in a deterministically red state.
3. Frontend production build receives syntactically valid non-secret test values for
   Better Auth, bridge and public-key contracts. No real secret enters source/logs.
4. Backend tests, migration checks, Ruff, frontend frozen install/tests/lint/typecheck /
   build and diff/schema checks have explicit required status.
5. Cache keys include the relevant lock/config files and never hide missing generated
   artifacts.

### D2 — Bun/package/docs contract

1. Bun and `bun.lock` are canonical for the frontend; dead websocket dependencies are
   removed while the real `frontend/server.ts` `ws` dependency remains.
2. `packageManager`, CI version, README commands and contributor rules agree.
3. `npm`, Yarn or pnpm instructions are removed unless a separately supported path is
   actually tested.

### D3 — Authenticated automated flow setup

1. Automated flows provision an account, active server, membership and required data
   through a supported isolated test setup, then establish the same auth/session and
   server context the application expects.
2. Public/control-plane credentials come from the canonical auth child env contract;
   none is hard-coded in test source or query URLs.
3. Setup is idempotent, scoped to the worktree test database, and cleans or uniquely
   namespaces its records.
4. Tests fail with a clear setup/auth error instead of silently testing `/login`.
5. The suite covers one representative authenticated management flow but is not the
   sole UI acceptance proof.

### D4 — Visible deletion contracts

1. Task and File delete actions are available only when authorized and require clear,
   localized confirmation that names the target and consequence.
2. Success removes the item from the correct projection without full page reload and
   surfaces the dedicated delete event semantics established by schema/runtime work.
3. Failure leaves the item visible, restores actionable controls and displays a
   localized error; optimistic state cannot claim deletion after rollback.
4. Accessibility includes keyboard operation, focus return, dialog labels and status /
   error announcements.

### D5 — Loading, error and targeted refresh

1. Root loading/error boundaries and dynamically loaded heavy components render valid
   accessible UI in water/dark/shuimo themes.
2. Error boundaries do not turn API fallback swallowing into a false success. Non-ok /
   network errors that users must act on are made visible at the owning surface.
3. Task events refetch task data only. Member/message behavior remains explicitly
   characterized, and one shared realtime transport from the runtime child is used.
4. First render, reconnect and slow-response states do not flash misleading empty or
   success UI.

### D6 — Real UI evidence

1. Start backend/frontend/daemon from the remediation worktree on isolated ports and
   database. URL, CWD, branch and commit are recorded before evidence capture.
2. Use `./twd` only through the project wrapper for browser-visible verification.
3. Capture DOM assertions, network markers, screenshots where they add value, and
   backend/frontend/runtime trace correlation for deletion, loading/error, pagination
   and targeted realtime refresh.
4. Evidence is deterministic enough for another reviewer to replay.

### D7 — Truthful documentation

1. AGENTS/testing docs say exactly which tool owns repository UI acceptance and how
   the CI automated flow relates to it.
2. README/env/migration/deployment commands match actual scripts and auth values.
3. Reports do not claim that an error boundary fixes swallowed fetch errors, that task
   invalidation removes every page refresh, or that unexecuted UI evidence passed.

## Acceptance criteria

- [ ] A clean checkout runs all required CI jobs green with no hidden local env.
- [ ] Ruff and production build no longer have the deterministic failures reproduced
      by the independent audit.
- [ ] Frozen Bun install, tests, lint, typecheck and production build all pass under the
      documented non-secret test configuration.
- [ ] Automated management flow authenticates, selects the correct server and rejects
      absent/foreign context; no reusable credential appears in source or URLs.
- [ ] Task and File deletion pass component/API integration tests for success, rollback,
      authorization, localization and accessibility.
- [ ] `./twd` evidence proves visible loading/error/deletion, multi-page data and one
      targeted realtime request on the integrated worktree runtime.
- [ ] Frontend README, AGENTS rules, CI and package metadata name one consistent tool /
      command contract.
- [ ] Full gates and `git diff --check` pass; evidence paths are linked from the task.

## Dependencies and stop conditions

- Depends on schema deletion semantics, auth env/session/server contract and runtime
  pagination/realtime owner.
- Stop if CI needs a real secret or shared external database.
- Stop if a UI test is actually on `/login`, wrong server, main runtime or another
  worktree URL.
- Stop if a delete UI would ship before the corresponding real PostgreSQL route test.
- Stop rather than relaxing a security/build/lint rule solely to obtain green status.
