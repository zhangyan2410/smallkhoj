# Design: Inkframe Mobile Source Contract Hardening

## Strategy

Treat this as a browserless hardening loop. The target is not visual proof; the
target is to make the DOM and component state contracts precise enough that the
real browser runner has a stable surface to inspect once `./twd` has a tab.

The task should strengthen tests around existing components instead of adding
another visual abstraction layer.

## Boundaries

### Source Of Truth

- DOM contract source: `data-inkframe-*` attributes already introduced by the
  browserless readiness loop.
- Browser gate source: `tools/twd-guard/twd-inkframe-proof`.
- Product style source: `.trellis/spec/frontend/product-ui-style.md`.
- Browser evidence source: `.agents/skills/project-webdriver-cli/SKILL.md` and
  `.trellis/spec/frontend/quality-guidelines.md`.

### Do Not Duplicate

Do not create another selector checklist. Reuse the groups already encoded in
`twd-inkframe-proof` and the browserless readiness evidence.

Do not create route-local mobile conventions. If a layout attribute is shared
between chat and tasks, keep it in shared primitives or shared shell code.

## Candidate Test Targets

Use existing test patterns first:

- `frontend/test/inkframe-object-ui.test.tsx`
- `frontend/test/material-surface.test.tsx`
- `frontend/test/task-board-hydration.test.tsx`
- `frontend/test/markdown-message.test.tsx`
- `frontend/test/chat-unread-state.test.ts`

Add a narrow new test file only if existing tests would become incoherent.

## Contracts To Assert

### Product Shell

Assert that product-shell render paths expose:

```text
data-inkframe-surface="app-background"
data-inkframe-owner-kind="app-background"
data-inkframe-owner-id="global-desk"
data-inkframe-region="app-background"
data-inkframe-tint="desk"
data-inkframe-pointer-capture="false"
```

### Chat

Assert that rendered chat surfaces expose:

```text
data-inkframe-mobile-role="chat-workspace"
data-inkframe-mobile-role="chat-message-list"
data-inkframe-mobile-role="chat-composer"
data-inkframe-object="message"
data-inkframe-density="short|medium|long"
data-inkframe-object="message-actions"
data-inkframe-state="toolbar-hidden"
data-inkframe-surface="material"
data-inkframe-owner-kind="message"
data-inkframe-pointer-capture="false"
```

Long messages should not get the same high-tilt behavior as short messages. The
test can assert density/variant/source classes rather than visual screenshots.

### Tasks

Assert that rendered task surfaces expose:

```text
data-inkframe-mobile-role="task-workspace"
data-inkframe-mobile-role="task-controls"
data-inkframe-mobile-role="task-board"
data-inkframe-object="task-ticket"
data-inkframe-mobile-role="task-detail"
data-inkframe-mobile-role="task-evidence"
data-inkframe-mobile-role="task-review"
data-inkframe-surface="material"
data-inkframe-pointer-capture="false"
```

Optional/empty-state task detail/evidence/review markers can be asserted only
in fixtures that actually render those regions.

## Mobile Layout Source Heuristics

Because there is no connected browser tab, source tests cannot prove pixel
layout. They can still catch common regressions:

- scroll-root components include `min-h-0` / `min-w-0` where they own long text
  or nested scroll;
- mobile drawers use explicit state attributes instead of disappearing from the
  DOM without a reachable trigger;
- static material surfaces have pointer capture disabled;
- message actions start hidden and local to the message object.

## Evidence Shape

Write:

```text
evidence/source-contract-validation.md
```

Include:

- tests run;
- what source/component evidence proves;
- what remains unproven until real `./twd` browser proof;
- latest `twd-inkframe-proof` status.

## Review Focus

The reviewer should look for:

- false browser acceptance claims;
- tests that only assert implementation details unrelated to the runner
  selectors;
- missing mobile role markers;
- duplicate selector manifests;
- message/task visual vocabulary being flattened into one generic paper card;
- pointer-capture regressions.
