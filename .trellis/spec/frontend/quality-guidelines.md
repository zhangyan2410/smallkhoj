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

### Mutation Smoke Tests

For forms that write to backend APIs, include at least one Playwright/e2e or equivalent browser smoke test that:

- Fills and submits the visible form.
- Verifies the expected result appears in the UI.
- Verifies temporary test data is cleaned up or isolated.
- Watches network events when a previous bug involved the wrong HTTP method.

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
