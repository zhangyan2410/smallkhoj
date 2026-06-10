# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

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

---

## Testing Requirements

<!-- What level of testing is expected -->

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

### Mutation Smoke Tests

For forms that write to backend APIs, include at least one project WebDriver browser smoke test using `agent/daemon/webdriver/twd.py` that:

- Fills and submits the visible form.
- Verifies the expected result appears in the UI.
- Verifies temporary test data is cleaned up or isolated.
- Watches network events when a previous bug involved the wrong HTTP method.

### Real Browser Test SOP

For browser-facing product work, add a task-local Real Test SOP and evidence files. Use the project WebDriver harness, not Playwright, for repository browser/UI verification.

Start new task evidence from `docs/real-test-sop-template.md`, then specialize the steps for the feature being verified.

Required evidence:

- Unique marker in the shape `REAL_<task-slug>_<timestamp>`.
- `twd.py` navigation/action commands against the running local app.
- Visible DOM assertion through `scan --text` or `eval`.
- Screenshot saved under `{TASK_DIR}/evidence/`.
- API or database cross-check when the UI creates or mutates backend state.
- `smallkhoj-trace` cross-check when daemon/runtime delivery is part of the workflow.

If the real browser behavior disagrees with automated tests, treat the task as failing and keep fixing.

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
