# Committed management flow does not establish product authentication

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | The committed browser flow navigates directly to protected management routes and assumes public-key access. Under the current account/membership contract it redirects to `/login`, so assertions do not exercise the intended product. |
| **2. Evidence** | The pre-fix `e2e/management-flow.spec.ts:7` embedded the repository-known development public credential, sent public headers without a human session or `X-Server-Id`, and never provisioned/logged in an account or asserted active Server identity. |
| **3. Confirmed root cause** | The suite predates Better Auth bridge, `smallkhoj_session`, `smallkhoj_active_server`, and membership-scoped human routes. It conflates the browser-visible public credential with human identity. |
| **4. Diagnostic strategy** | Add a contract RED forbidding literal credentials/query transport and requiring an isolated signup/login/bootstrap fixture, identity/server assertions, negative absent/foreign context, unique namespace and cleanup. Then run a representative flow against isolated services. |
| **5. Timeout strategy** | Fail early with a named setup/auth/server error before management assertions. Do not keep waiting on selectors from `/login`. |
| **6. Warning strategy** | Reject cookie injection without supported login/bridge setup, shared databases, source credentials, URL credentials, or calling this suite the repository UI acceptance owner. |
| **7. User-visible correction** | The automated flow verifies the same authenticated Server-scoped experience users receive instead of silently testing a login redirect. |
| **8. Acceptance** | Flow provisions a unique account/Server membership, establishes supported session and active Server context, asserts both on each protected transition, covers absent/foreign context, and cleans its namespace. |

## Implemented correction

- The flow requires explicit `API_BASE`, `FRONTEND_BASE`, ephemeral public key,
  run namespace and `disposable` database scope; it has no localhost or source
  credential fallback.
- It signs up through the real login form, proves both session cookies and the
  active owner membership, rejects public-key-only and foreign-Server requests,
  creates a Computer through the visible product UI, and verifies logout revokes
  the product session. The disposable PostgreSQL service owns lifecycle cleanup.
- Daemon no-replay coverage is fail-closed for missing, zero and invalid cursors.
  Each socket must open, stay healthy, receive its own unique
  `cursor-live-*` event on that same connection, and contain none of the earlier
  message markers. The observation window starts only after a successful
  handshake, eliminating the old slow-handshake/empty-array false positive.
- The committed Playwright flow remains a deterministic cross-layer CI gate.
  Visible UI acceptance is separately owned by the project `./twd` procedure.

## Follow-up diagnosis: the URL is not a server-action completion signal

| Field | Content |
| --- | --- |
| **1. Symptom** | After clicking signup, `toHaveURL(/\/computers/)` passed but `smallkhoj_session` was still absent when the flow immediately read browser cookies. |
| **2. Evidence** | Runtime preflight identified local backend port `18000`, PID `86327`, start time `2026-07-23 21:17:08 +0800`, worktree HEAD `ac80a6a`, current candidate diff, and PTY session `23764`. Backend traces showed successful `POST /api/v1/auth/better-auth/bridge`, `GET /api/v1/auth/me`, and `GET /api/v1/computers`. Browser tracing showed the Next client changing the URL roughly 50 ms after the click while the server-action POST was still in flight and the rendered page remained the login form. |
| **3. Confirmed root cause** | The test treated Next's optimistic client URL update as proof that the signup server action, cookie writes and authenticated render had completed. Product authentication was not failing. |
| **4. Diagnostic strategy** | Correlate click, URL, server-action request, backend auth requests, DOM and cookies; then require an authenticated DOM marker before reading cookies. |
| **5. Timeout strategy** | Use Playwright's bounded visibility expectation on the Server switcher. If it never renders, preserve the trace and fail as an authentication/rendering error rather than sleeping or polling cookies indefinitely. |
| **6. Warning strategy** | Do not add arbitrary timeouts, inject cookies, weaken cookie assertions, or accept URL-only navigation as authenticated state. |
| **7. User-visible correction** | None. The product flow already completed successfully; the deterministic gate now waits for the same authenticated Server UI a user sees. |
| **8. Acceptance** | A delivery contract requires `await expect(page.locator('[data-region="server-switcher"]')).toBeVisible()` before `context.cookies()`. The focused contract and the complete isolated authenticated flow pass. |

## Follow-up diagnosis: canonical Channel labels are prefixed twice

| Field | Content |
| --- | --- |
| **1. Symptom** | The authenticated flow reaches the real daemon WebSocket and receives the expected `message.created` event, but the assertion expects `##<channel>` while the event correctly contains `#<channel>`. |
| **2. Evidence** | `list_channels` serializes every public Channel name as `f"#{ch.name}"`; the flow stores that API response in `channel.channel.name`, then constructs the expected target as `` `#${channel.channel.name}` ``. Three retries produced the same single-prefix event with correct type, content and target agent. |
| **3. Confirmed root cause** | The E2E assertion treats an already canonical API label as a raw database name and adds a duplicate prefix. Product event serialization is consistent with the existing `#name` public-channel contract. |
| **4. Diagnostic strategy** | Trace the value from the Channel API response to the WebSocket assertion, compare it with backend serializer/query-budget contracts, then add a delivery contract that rejects the duplicate-prefix expression. |
| **5. Timeout strategy** | If the focused contract and one full flow do not validate the hypothesis, stop changing the expectation and inspect the create-channel response/event serializer boundary independently. |
| **6. Warning strategy** | A change to production event serialization, stripping `#` from the API response, or normalizing only this generated channel would indicate the diagnosis is wrong and must be rejected. |
| **7. User-visible correction** | None. This is a false-negative in the committed integration gate; product runtime behavior is already correct. |
| **8. Acceptance** | The focused delivery contract first failed on ``target: `#${channel.channel.name}```, then passed after using `target: channel.channel.name`. The complete isolated authenticated management flow passed (`1 passed`), including all three missing/zero/invalid cursor cases. |

## Follow-up diagnosis: guarded UI authentication enumerates unrelated tabs

**Reporter:** independent release-plan review on 2026-07-24.

| Field | Content |
| --- | --- |
| **1. Symptom** | A release UI flow that creates one approved loopback tab and then calls `twd-open /tasks` still reads URL/title metadata for every connected tab. Expected behavior is that an explicitly supplied tab ID is the only browser target read or mutated during authentication, navigation, retry and final verification. |
| **2. Evidence** | `openTarget()` calls `getTabs()` before selection and again after a login redirect; `getTabs()` executes `./twd --compact tabs`. `selectLocalTab()` and `probeFinalPage()` prefer `--url-match`, so comparing the returned ID after the helper exits cannot undo the earlier enumeration. The raw project WebDriver commands already support exact `--tab <id>` targeting. No browser or cloud request was needed to establish this static call path. |
| **3. Confirmed root cause** | The guard was designed around discovery of a convenient local tab and exposes no exact-tab contract. Authentication, navigation and final probing therefore share discovery/URL-match helpers even when the caller already owns a safe tab ID. |
| **4. Diagnostic strategy** | Trace every `runTwd` call from `openTarget()` through selection, cookie injection, navigation, login retry and final probe. Add a mock-runner regression that exercises the retry path and rejects `tabs`, `--url-match`, or any command missing the requested `--tab` pair. |
| **5. Timeout strategy** | If the focused unit test cannot isolate the command sequence without a real browser, stop and introduce a narrow command-runner seam; do not launch or enumerate tabs to debug the test. |
| **6. Warning strategy** | Any exact-tab path that falls back to discovery after failure, accepts a different returned tab ID, or uses URL matching is still unsafe. Three failed repair attempts would stop implementation for a guard API redesign. |
| **7. User-visible correction** | Local authenticated UI acceptance can be constrained to a newly created loopback tab without observing or operating unrelated tabs, including an already-open old-cloud page. Existing discovery behavior remains available only when the caller does not request exact targeting. |
| **8. Acceptance** | A focused RED/GREEN test proves cookie injection, both login-retry navigations and both final probes use only `--tab <requested-id>`; no `tabs` or `--url-match` command occurs; a mismatched returned tab ID fails closed. The complete guard test suite and syntax/lint gates pass. |

### Repair decision

Add an explicit `--tab <id>` option to `twd-open` and route it through an
exact-tab-only implementation. Keep the legacy discovery path for existing
callers, but do not allow the exact path to call `getTabs()`, `selectLocalTab()`
or a URL-match probe. This is narrower than changing global WebDriver tab
selection and directly fixes the boundary violation at its source.

### Implemented correction and verification

- `openTargetOnExactTab()` validates the requested ID before starting the
  bridge, reuses one `--tab` selection for cookie injection, navigation,
  login-retry authentication and final probing, and rejects every returned
  payload whose `tabId` differs.
- `twd-open --tab <id> <target>` dispatches to that exact path; callers without
  `--tab` retain the existing discovery behavior.
- The first focused run failed only because the exact-tab function did not yet
  exist (`15 passed, 1 failed`). After the minimal implementation and CLI
  parser, the focused suite passes all 18 tests, including retry, no-enumeration,
  no-URL-match, duplicate/empty option and wrong-returned-ID cases.
- `make scripts-test` now owns this regression through `twd-guard-test`; the
  canonical run passed the 18 Node tests plus 170 Python script tests with one
  documented conditional skip.

## Follow-up diagnosis: cookie-injection failures can echo the session token

**Reporter:** independent final review on 2026-07-24.

| Field | Content |
| --- | --- |
| **1. Symptom** | If the guarded WebDriver command fails while injecting `smallkhoj_session`, the CLI can print the complete 30-day session token. Expected behavior is that every cookie-injection failure remains actionable without reproducing the token in an exception, terminal, CI log or review artifact. |
| **2. Evidence** | `injectCookie()` serializes `sessionToken` into the JavaScript passed as the final `./twd eval` argument. `runTwd()` includes `formatCommand(args)` in both nonzero-exit and `ok=false` errors, and the CLI prints `error.message`. A mock runner that throws its received argument vector therefore reproduces the exact token in the propagated error without starting WebDriver or reading any environment value. |
| **3. Confirmed root cause** | The sensitive eval command crosses a generic diagnostic boundary whose error formatter assumes all command arguments are safe to echo. `injectCookie()` does not catch and replace that error before it reaches the CLI. Bridge-response errors were already redacted, but the later command-argument path was not covered. |
| **4. Diagnostic strategy** | Trace the session token from bridge response to eval script to `runTwd()` error formatting. Add a mock-runner RED through `openTargetOnExactTab()` that forces cookie-eval failure, deliberately includes the received command in the thrown error, and requires the public error to exclude the unique token. |
| **5. Timeout strategy** | If one focused RED/GREEN cycle does not contain the token at this boundary, stop and inspect every command/log sink receiving the eval script; do not launch a browser or use a real credential to reproduce it. |
| **6. Warning strategy** | Reject a fix that retains the sensitive error as `cause`, interpolates untrusted command output, merely masks one token fixture, or changes the cookie transport without a separate reviewed design. Three failed attempts would stop implementation for a broader sensitive-command API redesign. |
| **7. User-visible correction** | Authentication failures still stop the guarded UI flow, but their message contains only a fixed cookie-injection failure description and never the reusable session value. |
| **8. Acceptance** | The focused regression first fails because the token is present, then passes after the boundary fix; it also requires a stable safe error message. The complete exact-tab suite, canonical script gate and syntax checks remain green. |

### Repair decision and focused verification

Catch failures only around the sensitive cookie-eval invocation and replace
them with `Session cookie injection command failed`, without attaching the
original error as `cause`. A negative cookie-presence result receives a separate
fixed verification error. This keeps normal `runTwd()` diagnostics intact for
non-sensitive commands while closing the only path that embeds the session
token in argv.

The focused RED failed with the synthetic token visibly present in the raw
mock WebDriver error. After the minimal boundary fix, that test passed, and the
complete guard suite passed all 19 tests. No browser, Docker service, network
endpoint or environment-file content was used for this regression.
