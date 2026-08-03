# Fix empty Computers dialog E2E baseline

## Goal

Restore the authenticated management CI flow after the intentional first-use
`/computers` dialog change, while preserving both the product onboarding behavior and
the test's account, Server-scope, mutation, WebSocket, and cross-page assertions.

## Background

- Commit `8b24fe1` intentionally changed the zero-computer state from an inline card to
  an automatically opened `ConnectComputerDialog`; the parent task's real-browser
  verification records `stepsAutoOpen=true` as accepted behavior.
- `e2e/management-flow.spec.ts:279` calls `assertAuthenticatedPage()` immediately after
  signup redirects to `/computers`. The helper clicks the Server switcher at line 205
  without first handling the expected modal.
- GitHub Actions run `30822510160`, job `91716368081`, reproduced the same failure on
  all three attempts: `[data-slot="dialog-backdrop"]` intercepted the switcher click
  until the 60-second test timeout.
- PR #4 changes CI/Daemon version wiring and tests, not the Computers UI or this E2E
  flow. Its version export succeeded with both candidate variables derived as `0.2.3`;
  the dialog failure is therefore an independent baseline regression.

## Requirements

### R1 — Preserve the intended first-use product behavior

- Keep the zero-computer connect-steps dialog automatically open after signup.
- Do not change frontend or backend product behavior solely to make the test pass.

### R2 — Make the E2E flow model the visible interaction sequence

- After signup on a new Server, explicitly assert that the connect-steps dialog is
  visible.
- Close the expected dialog through its real close control and assert it is no longer
  visible before exercising the global Server switcher.
- Reopen the dialog through the persistent Add-computer control before generating the
  connect command, and scope form interactions to that dialog.

### R3 — Keep the existing security and lifecycle coverage intact

- Retain all account/session, active-Server, tenant rejection, connect-command,
  daemon WebSocket live/no-replay, management mutation, and `/members` assertions.
- Do not use forced clicks, longer timeouts, skipped assertions, or retry changes to
  hide the interaction conflict.

### R4 — Keep version truth-source boundaries unchanged

- Do not add a current Daemon version literal to CI, E2E, or fixtures.
- The candidate version remains derived from
  `agent/daemon/aaa-daemon/package.json.version`; compatibility and production release
  selection remain independent policies owned by PR #4.

## Acceptance Criteria

- [ ] The existing failing authenticated management test first observes the
      zero-computer connect dialog, closes it, and can open/close the Server switcher.
- [ ] The test reopens the connect dialog through `add-computer-button`, generates the
      one-time command inside that dialog, and completes all later assertions.
- [ ] `make e2e-authenticated` passes against an identity-proven disposable candidate;
      no shared 3000/8000 process or host 5432 data is modified.
- [ ] Frontend lint/typecheck plus Integration Gate contract tests pass for the final
      branch, and GitHub's authenticated disposable management job is green.
- [ ] `git diff --check` passes and the diff contains no new Daemon version literal.

## Out of Scope

- Redesigning whether first-use onboarding is modal or inline.
- Changing production UI, backend APIs, database schema, Daemon behavior, or release
  version policy.
- Deploying to cloud, restarting the shared Daemon, or touching the existing 3000/8000
  development stack and host 5432 database.

## Technical Notes

- This is a lightweight test-contract repair. The existing failed E2E is the RED
  regression test; the minimal GREEN change belongs in `e2e/management-flow.spec.ts`.
- A generic helper must not silently dismiss arbitrary dialogs, because that would hide
  unexpected product regressions on other routes. Handling stays explicit at the known
  post-signup `/computers` transition.
