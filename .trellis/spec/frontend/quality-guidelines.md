# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

SmallKhoj frontend quality is judged by three things:

1. The UI follows the component/style layers in `component-guidelines.md`.
2. Runtime/server behavior remains correct after browser hydration, refresh, and
   realtime updates.
3. Browser-facing changes have real visible evidence, not only API or type-check
   evidence.

Reference-project lessons:

- `agent-platform` keeps frontend styling consistent by making design-system
  rules a skill with token/component references.
- `multica` keeps web/desktop maintainable by enforcing package boundaries and
  semantic tokens.
- `clowder-ai` reduces visual drift with token audits, design gates, and
  explicit shell ownership.

SmallKhoj should borrow the same discipline locally: small reusable primitives,
semantic tokens, explicit shell ownership, and evidence gates.

---

## Forbidden Patterns

- Page or route code redefining visual primitives that already exist in
  `components/ui/` or `components/`.
- Duplicating app shell pieces such as icon rail, list column, resize handle,
  or status badge mapping inside a route.
- Hardcoded palette colors, inline `oklch(...)`, `#hex`, or Tailwind palette
  literals in components/pages.
- Raw `<button>`, `<select>`, `<input>`, `<textarea>` with one-off visual
  classes when a shared atom exists.
- Hand-rolled cards/panels such as `rounded-md border bg-background p-3`.
- Persisting server data in browser storage.
- Making browser E2E claims without a visible `./twd` assertion or screenshot.
- Fixing overflow by broad page-level clipping without confirming the inner
  scroll region still works.

---

## Required Patterns

### Convention: Page Code Composes, Components Style

**What**: `app/**` route code should fetch/prepare data, define server actions,
choose the page composition, and pass props. Styling belongs in Layer 0/1/2:
tokens/utilities, atoms, and product primitives.

**Why**: The three-column branch showed that style drift happens when pages
rebuild shell, status, card, form, and rail pieces locally.

**Example**:
```tsx
// Correct: page composes ProductShell + product/ui atoms.
<ProductShell
  title={copy.title}
  description={copy.description}
  list={<TaskListPanel tasks={tasks} />}
  sidebar={<TaskRecoveryCockpit entries={entries} />}
>
  <TaskDndBoard tasks={tasks} />
</ProductShell>
```

**Wrong vs Correct**:
```tsx
// Wrong: route-local shell and raw visual controls.
<div className="rounded-md border bg-background p-3">
  <button className="bg-emerald-500 text-white">Start</button>
</div>

// Correct: shared shell + atom/product primitive.
<Panel>
  <Button variant="default">Start</Button>
</Panel>
```

### Convention: ProductShell Owns Workspace Chrome

**What**: The water icon rail, list column, main content column, right sidebar,
and resize handle belong to `ProductShell` / `ProductShellBody`. Chat, tasks,
members, and computers should compose that shell instead of rebuilding it.

**Why**: Duplicated rails and list/sidebar structures create divergent colors,
spacing, scroll behavior, and resize behavior.

**Good/Base/Bad Cases**:
- Good: list-detail routes pass `list`, `listConfig`, `children`, and optional
  `sidebar` to `ProductShell`.
- Base: a route has its own inner scroll surface but still uses `ProductShell`
  with `mainScrollable={false}`.
- Bad: a route copies icon rail markup, width constants, or resize logic.

### Convention: Flex Overflow Requires `min-w-0` and Explicit Scroll Owners

**What**: Any flex/grid column that contains long text, markdown, code, message
rows, or nested scroll regions must set the correct `min-h-0`, `min-w-0`,
`overflow-hidden`, and inner `overflow-y-auto` / `overflow-x-hidden` classes.

**Why**: Chat and markdown can otherwise push the whole shell wider than the
viewport. This creates expensive late-stage layout fixes.

**Example**:
```tsx
<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
    <MessageList />
  </div>
</div>
```

**Tests Required**:
- Browser check with a long unbroken word or code block.
- Confirm the shell width stays stable and the inner region scrolls.

### Convention: Reference Projects Before New Platform Surfaces

**What**: Before implementing MCP visibility, skill visibility, channel/runtime
UI, self-hosting surfaces, or agent workspace chrome, inspect the reference
projects listed in `../guides/reference-projects.md`.

**Why**: `agent-platform`, `clowder-ai`, and `multica-ai/multica` already encode
solutions for adjacent product/platform problems. Reusing their lessons avoids
inventing a weaker local convention.

**Required Output**: The task notes or PR description must say which reference
was checked and whether SmallKhoj reused, adapted, or rejected the pattern.

### Convention: Critical Backend Mutations Use Native Form Submission

**What**: For browser controls that create or mutate backend state, prefer a server action bound to a native `<form action={...}>` unless the workflow genuinely needs client-only state.

**Why**: A client-only `onSubmit` can silently degrade into a native `GET ?field=value` form submission when hydration does not attach. That makes the UI look interactive while no backend `POST` is sent.

**Example**:
```tsx
async function createThingAction(formData: FormData) {
  "use server"
  await fetch(`${API_BASE}/api/v1/things`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Public-Key": PUBLIC_KEY },
    body: JSON.stringify({ name: formData.get("name") }),
  })
  revalidatePath("/things")
}

export function CreateThingForm() {
  return (
    <form action={createThingAction}>
      <input name="name" required />
      <button type="submit">Create</button>
    </form>
  )
}
```

**Wrong vs Correct**:
```tsx
// Wrong for critical backend writes: fails open to GET if hydration is not attached.
<form onSubmit={handleClientSubmit}>
  <input name="name" />
  <button type="submit">Create</button>
</form>

// Correct: native submission still reaches the server action.
<form action={createThingAction}>
  <input name="name" />
  <button type="submit">Create</button>
</form>
```

**Tests Required**:
- Browser smoke tests for mutation forms must assert a real `POST` happened, not only that the page changed.
- If a credential or token is returned, assert it is not leaked through the URL.

### Convention: Bounded Requests Include Response Body Consumption

**What**: A request timeout or caller `AbortSignal` must remain active until the
complete response body has been consumed, not only until `fetch()` returns headers.

**Why**: `return response.json()` from inside a `try/finally` runs `finally` before the
body promise settles. Clearing the timer there leaves a successful response with a
stalled/truncated body unbounded and can strand destructive UI in a submitting state.

**Correct shape**:

```ts
const response = await Promise.race([fetch(url, init), abortPromise])
return await Promise.race([response.json(), abortPromise])
```

**Tests Required**:
- A successful response that sends headers and then stalls its JSON body times out.
- A caller abort after headers but before the body completes propagates the caller
  reason.
- Non-success error-body parsing is covered by the same bound.

### Convention: Daemon Onboarding Shows One Copyable Command

**What**: Computers onboarding and reconnect surfaces must show exactly one
copyable command to the user:

```text
npx -y <public-base-url>/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-<version>.tgz --server-url <public-base-url> --api-key <token> # <server-name>
```

Do not show separate install/download/connect command blocks in the product UI.
The command card must also show the Server name or short Server id in metadata.

**Why**: The split install/connect UI made it unclear which command was real
and hid whether the command was production-installable. The product contract
should match Raft-style onboarding: copy one command, run it, daemon connects.

**Wrong vs Correct**:
```tsx
// Wrong: three visible command blocks.
<code data-testid="daemon-one-step-command">{oneStep}</code>
<code data-testid="daemon-install-command">{install}</code>
<code data-testid="connection-command">{connect}</code>

// Correct: one visible command from the backend response.
<code data-testid="daemon-connect-command">{credential.command}</code>
```

**Tests Required**:
- Frontend unit tests must not depend on install-command derivation helpers for
  product onboarding.
- `./twd` evidence must assert there is one visible command block and that the
  page text does not include `安装命令`, `Install Command`,
  `smallkhoj-daemon connect --token`, or `smallkhoj-daemon start --machine-token`.
- `./twd` evidence must assert the copied command includes the `# <server-name>`
  comment and the card visibly renders the Server identifier.

---

## Testing Requirements

### Scenario: Next Dev Browser E2E Origins

#### 1. Scope / Trigger
- Trigger: Browser tests or manual scripts open the Next dev server through a host that differs from the dev server's allowed origin, for example `127.0.0.1:3000` while Next reports `localhost:3000`.

#### 2. Signatures
- `frontend/next.config.mjs`: `allowedDevOrigins: ['127.0.0.1']`
- E2E env keys: `FRONTEND_BASE`, `API_BASE`, `E2E_DATABASE_URL`

#### 3. Contracts
- Browser e2e may use `FRONTEND_BASE=http://localhost:3000` without extra config.
- If e2e uses `FRONTEND_BASE=http://127.0.0.1:3000`, `next.config.mjs` must allow `127.0.0.1` and the dev server must be restarted after the config change.
- A rendered page is not enough to prove hydration: client handlers can be dead while server HTML still appears correct.

#### 4. Validation & Error Matrix
- Browser console shows WebSocket handshake failures for `/_next/webpack-hmr` from `127.0.0.1` -> check `allowedDevOrigins` or use `localhost`.
- Next dev log says "Blocked cross-origin request to Next.js dev resource" -> update config and restart dev server.
- UI renders but button `onClick` sends no network request -> treat as possible hydration/dev-origin failure before debugging the API.

#### 5. Good/Base/Bad Cases
- Good: e2e uses `localhost:3000` or a configured allowed dev origin, and asserts the expected `POST`.
- Base: API smoke tests pass but browser e2e fails; inspect browser console and Next dev logs before changing backend code.
- Bad: concluding the API is broken when the browser never sent the request because the client bundle did not hydrate.

#### 6. Tests Required
- Mutation e2e should assert the resulting UI state and, when practical, observe the `POST` response for the mutation.
- After e2e runs, assert temporary rows are cleaned or isolated from the local review database.

#### 7. Wrong vs Correct
##### Wrong
Run e2e against `http://127.0.0.1:3000` with no `allowedDevOrigins`, then debug missing client events as backend failures.

##### Correct
Use `http://localhost:3000` for local browser e2e, or configure `allowedDevOrigins: ['127.0.0.1']` and restart the dev server.

### Scenario: Production Standalone Frontend Image

#### 1. Scope / Trigger
- Trigger: changing `frontend/Dockerfile`, `frontend/next.config.mjs`, production compose, deployment runbooks, or frontend build output.

#### 2. Signatures
- `frontend/next.config.mjs`: `output: "standalone"`
- `frontend/Dockerfile`: copies `/app/.next/standalone` into the runner image and starts `server.js`.

#### 3. Contracts
- `bun run build` must create `.next/standalone/server.js` before the Docker runner stage copies build artifacts.
- Same-origin `/api` rewrites and next-intl plugin wrapping must remain active when standalone output is enabled.
- The nominal 4 vCPU / 4 GB release host (3.32 GiB guest-visible RAM) must pull a prebuilt frontend image; it is not a supported place to install Next.js dependencies or run the production build.

#### 4. Validation & Error Matrix
- `.next/standalone/server.js` missing after build -> `next.config.mjs` lost `output: "standalone"` or Next build config changed.
- Docker build fails at `COPY --from=builder /app/.next/standalone ./` -> standalone output contract is broken.
- Container starts but `/login` does not return HTTP 200 -> runner command or copied artifact layout is broken.

#### 5. Good/Base/Bad Cases
- Good: config test asserts `nextConfig.output === "standalone"`, `bun run build` creates `.next/standalone/server.js`, Docker build succeeds, and a smoke container serves `/login`.
- Base: local build passes but Docker build is skipped only because Docker daemon is unavailable; record the skipped gate explicitly.
- Bad: accepting `next build` alone as production image proof when the Dockerfile depends on `.next/standalone`.

#### 6. Tests Required
- `bunx tsx --test test/next-production-config.test.ts test/runtime-url.test.ts`
- `bun run build`
- `test -f .next/standalone/server.js`
- `docker build -t smallkhoj-frontend:standalone-smoke ./frontend` when Docker is available.
- Optional container smoke: run the built image and check `GET /login`.

#### 7. Wrong vs Correct
##### Wrong
Remove or omit `output: "standalone"` because `next build` still succeeds locally.

##### Correct
Keep standalone output enabled because the production Docker runner stage copies `.next/standalone` and starts its `server.js`.

### Mutation Smoke Tests

For forms that write to backend APIs, include at least one project WebDriver browser smoke test using the `project-webdriver-cli` skill and `./twd` that:

- Fills and submits the visible form.
- Verifies the expected result appears in the UI.
- Verifies temporary test data is cleaned up or isolated.
- Watches network events when a previous bug involved the wrong HTTP method.

### Real Browser Test SOP

For browser-facing product work, add task-local real-test evidence files. Use the `project-webdriver-cli` skill and the project WebDriver CLI wrapper, not Playwright, for repository browser/UI verification.

Start new task evidence from `docs/real-test-sop-template.md`, then specialize the steps for the feature being verified.

Required evidence:

- Unique marker in the shape `REAL_<task-slug>_<timestamp>`.
- `./twd` navigation/action commands against the running local app.
- Visible DOM assertion through `scan --text` or `eval`.
- Screenshot saved under `{TASK_DIR}/evidence/`.
- API or database cross-check when the UI creates or mutates backend state.
- `smallkhoj-trace` cross-check when daemon/runtime delivery is part of the workflow.

If the real browser behavior disagrees with automated tests, treat the task as failing and keep fixing.

#### Scenario: Exact-Tab Authenticated WebDriver Guard

##### 1. Scope / Trigger

- Trigger: a browser acceptance flow already owns an operator-approved tab ID,
  or enumerating unrelated tabs could expose URL/title metadata outside the
  task's local target.

##### 2. Signatures

- Exact authenticated navigation:
  `./tools/twd-guard/twd-open --tab <exact-tab-id> <path-or-url>`
- Subsequent raw assertions/actions:
  `./twd --compact <command> --tab <exact-tab-id> ...`

##### 3. Contracts

- The exact path validates a non-empty tab ID before starting the WebDriver
  bridge.
- Cookie injection, navigation, a login-redirect retry and the final page probe
  all pass the same `--tab <exact-tab-id>` pair.
- The exact path never calls tab discovery, `selectLocalTab()`, or
  `--url-match`; it does not fall back to those mechanisms after a failure.
- Every WebDriver payload must return the requested `tabId`. A missing or
  different ID fails before the result is accepted.
- The cookie-injection eval script contains the reusable session token. Any
  command failure at that boundary must be replaced with a fixed safe error;
  the original argv, output, payload and error must not be interpolated or
  retained as an exception `cause`.
- Legacy discovery remains available only when the caller deliberately omits
  `--tab`; it is not a substitute when the task boundary forbids reading other
  tabs.

##### 4. Validation & Error Matrix

- Empty/missing `--tab` value -> reject before bridge startup.
- Duplicate `--tab` options -> reject CLI input.
- Cookie/goto/probe payload returns another tab ID -> fail closed with expected
  and actual IDs; do not retry through discovery.
- Cookie-injection eval exits nonzero or returns `ok=false` -> fail with a
  fixed cookie-injection command error that contains no session token or raw
  WebDriver diagnostic.
- Exact target redirects to `/login` -> re-authenticate and navigate the same
  exact tab once; never enumerate tabs.
- Final pathname/search differs from the requested target -> reject browser
  evidence.

##### 5. Good/Base/Bad Cases

- Good: create one approved loopback tab, record its ID, use exact guarded
  authentication, then use exact raw `./twd --tab` commands for the scenario.
- Base: use discovery helpers only when reading connected-tab metadata is
  explicitly inside the task boundary and no approved ID is available.
- Bad: call discovery first and compare the returned tab ID afterward; the
  unrelated metadata read has already happened.

##### 6. Tests Required

- Mock-runner unit test covers successful exact navigation and a `/login`
  retry, asserting every command contains the requested `--tab` pair.
- The same test rejects any `tabs` command or `--url-match` argument.
- Unit tests cover empty/duplicate CLI options and a mismatched returned tab ID.
- A mock runner must echo the sensitive eval argv in its thrown error and prove
  the guard replaces it without retaining the session token in `message` or
  `cause`.
- `make scripts-test` must execute the exact-tab guard suite so local `make ci`
  and the source-contract CI job both protect the boundary.

##### 7. Wrong vs Correct

###### Wrong

```bash
./tools/twd-guard/twd-open /tasks
# Comparing its returned ID later does not undo discovery of every tab.
```

###### Correct

```bash
./tools/twd-guard/twd-open --tab "$APPROVED_LOCAL_TAB_ID" /tasks
./twd --compact eval --tab "$APPROVED_LOCAL_TAB_ID" \
  'return { origin: location.origin, path: location.pathname }'
```

###### Wrong

```js
// The eval argv contains sessionToken; propagating this error leaks it.
return runTwd(["--compact", "eval", "--tab", tabId, sensitiveScript])
```

###### Correct

```js
try {
  return runTwd(["--compact", "eval", "--tab", tabId, sensitiveScript])
} catch {
  // Do not retain the original error as cause.
  throw new Error("Session cookie injection command failed")
}
```

#### Scenario: `./twd` No-Tab Gate Classification

##### 1. Scope / Trigger
- Trigger: any browser-facing task that uses `./twd --compact tabs` as the
  first evidence gate, especially reusable proof runners or scripts.

##### 2. Signatures
- Command: `./twd --compact tabs`
- No-tab payload:

```json
{"ok": true, "tabs": [], "count": 0}
```

##### 3. Contracts
- A connected-tab proof may proceed only when the parsed payload contains at
  least one tab.
- A no-tab payload must be classified as `blocked_no_tab` or equivalent
  pending/blocker status.
- The no-tab state must not be classified as browser acceptance, and must not
  be collapsed into a generic WebDriver failure if the payload itself is valid.
- Automation may use a distinct nonzero exit code for blocked/no-tab, but the
  evidence file must preserve the parsed payload and state that no
  browser/mobile acceptance is claimed.

##### 4. Validation & Error Matrix
- `tabs.length === 0` or `count === 0` -> blocked/no-tab; write evidence and
  stop browser acceptance.
- `ok === false` with `code: "NO_TAB"` -> blocked/no-tab; write evidence and
  stop browser acceptance.
- command exits nonzero but stdout contains the valid no-tab JSON above ->
  parse stdout first and classify as blocked/no-tab.
- stdout/stderr contains no parseable JSON -> failed WebDriver/tool execution.

##### 5. Good/Base/Bad Cases
- Good: a proof runner writes JSON/Markdown evidence with status
  `blocked_no_tab` and exits with a documented nonzero code such as `2`.
- Base: an operator records the exact `./twd --compact tabs` output in task
  evidence and leaves browser/mobile proof pending.
- Bad: a script treats any nonzero exit as a generic tool failure before
  parsing the JSON payload, or claims UI acceptance from static tests after
  no-tab output.

##### 6. Tests Required
- Unit test no-tab payload -> blocked/no-tab classification.
- Unit test nonzero command result with valid no-tab stdout -> blocked/no-tab.
- Evidence test or assertion that no browser/mobile acceptance claim is written
  in blocked/no-tab mode.

##### 7. Wrong vs Correct
###### Wrong

```js
if (result.status !== 0) throw new Error("twd failed")
```

###### Correct

```js
const payload = parseLastJson(result.stdout)
if (payload.ok === true && (payload.count === 0 || payload.tabs?.length === 0)) {
  return { status: "blocked_no_tab", tabsResult: payload }
}
if (result.status !== 0) return { status: "failed_twd" }
```

### Event/Activity UI Token-Safety Gate

When frontend work touches Activity, Events, agent timelines, daemon status, runtime state, or trace/debug views:

- Treat Activity timeline rows as observability UI, not runtime work items.
- Verify UI labels distinguish telemetry states from actionable messages/tasks.
- Cross-check backend contracts in `.trellis/spec/backend/event-delivery-contracts.md`.
- Use a marker-based browser check when the UI claims an event reached a specific agent/runtime.
- Do not accept a UI that makes self-authored runtime activity look like a new inbound message.

---

## Code Review Checklist

- [ ] Pages compose existing atoms/product primitives instead of hand-rolling
      cards, controls, badges, rails, or shells.
- [ ] New or changed colors use tokens; no raw Tailwind palette colors, inline
      `oklch(...)`, or hex literals outside token files.
- [ ] List/detail routes use `ProductShell` ownership unless the task explicitly
      documents why not.
- [ ] Scroll regions have stable `min-h-0` / `min-w-0` ownership and long-text
      behavior was checked.
- [ ] Server mutations use server actions/native forms when hydration failure
      would otherwise drop the action.
- [ ] API/resource types come from the shared source when reused.
- [ ] Browser-facing changes include `./twd` visible evidence.
- [ ] MCP/skill/channel/platform surfaces checked the reference projects guide.
