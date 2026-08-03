# Empty Computers dialog blocks authenticated E2E chrome interaction

## Bug diagnosis capsule

| Field | Evidence |
| --- | --- |
| **1. Symptom** | Authenticated management CI times out at `e2e/management-flow.spec.ts:205` while clicking the Server switcher after signup. Expected: the test completes the visible first-use flow and then verifies global chrome. Actual: the connect-dialog backdrop intercepts the click for 60 seconds. |
| **2. Evidence** | GitHub run `30822510160`, job `91716368081`, failed identically on the initial attempt and two retries. The call log names `[data-slot="dialog-backdrop"]`. Commit `8b24fe1` and `.trellis/tasks/08-03-computer-connect-ux/verification-record.md` prove the zero-computer dialog is intentionally auto-opened. PR #4 has no Computers/E2E behavior change. |
| **3. Root cause** | The product interaction contract changed, but the cross-layer E2E sequence did not. `assertAuthenticatedPage()` assumes the redirected `/computers` page has no modal and immediately clicks chrome behind the intentional first-use dialog. |
| **4. Diagnostic strategy** | Trace the intercepting DOM node to the dialog owner, compare the introducing commit and parent-task acceptance evidence, inspect the E2E call order, and verify the version-source PR does not touch this path. |
| **5. Timeout strategy** | If explicit close/reopen still fails in one focused disposable run, inspect the Playwright trace and dialog state instead of increasing the 60-second timeout. |
| **6. Warning strategy** | A forced click, global auto-dismiss helper, skipped switcher assertion, or repeated failure after two focused iterations means the proposed repair is masking product state and must be abandoned. |
| **7. User-visible correction** | No product behavior changes. The automated user now follows the same visible steps as a real first-time user: observe onboarding, close it to use global navigation, then reopen it through Add to connect a computer. |
| **8. Acceptance** | The original authenticated test passes end to end on an isolated candidate; all existing tenant, command, WebSocket, replay, and members assertions remain; CI is green without timeout/force/retry weakening. |

## Five-part bug report

### 1. Reporter

Detected by GitHub Actions while validating PR #4, then traced locally by Codex as an
independent regression introduced when the Computers first-use UX changed.

### 2. Reproduction

1. Sign up through `/login?returnTo=/computers` with a fresh account and Server.
2. Wait for the redirect to an empty `/computers` page.
3. Without closing the automatically opened connect dialog, click the global Server
   switcher.
4. The modal backdrop intercepts pointer events until the test timeout.

### 3. Root-cause analysis

`ConnectComputerDialog` initializes its local state to `steps` when
`initialStepsOpen` is true. The empty Server satisfies that condition. This is deliberate
and was verified in the parent task. The E2E helper predates that interaction and clicks
the Server switcher behind the modal. The failure is deterministic test/product-contract
drift, not slow data, a hanging API, or a hard-coded version failure.

### 4. Repair

Keep the product state machine. In the specific post-signup sequence, assert and close
the first-use dialog, run the existing authenticated chrome assertion, then click the Add
control and continue the existing connect-command flow inside the reopened dialog. This
is narrower than teaching a generic helper to dismiss any modal and stronger than force
clicking through the backdrop.

### 5. Verification

- RED: GitHub job `91716368081` fails three times at the same backdrop intercept.
- GREEN: focused authenticated management E2E against an isolated candidate.
- Regression: frontend lint/typecheck, Integration Gate contracts, native diff check,
  and the GitHub authenticated disposable management job.
