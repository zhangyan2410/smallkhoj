# Inkframe Runtime Browser Proof And Product Polish Optimization

## Goal

Run the next optimization loop after
`07-06-inkframe-material-runtime-chat-events-optimization`: productize the
Inkframe material runtime in real SmallKhoj routes, prove it in a real browser,
polish the chat/task product experience where the code-level implementation is
now available, and harden the backend read-cursor path beyond the focused unit
tests.

This task is not a new visual direction. It continues the same product decision:
Inkframe is the default SmallKhoj UI language, with chat and tasks as the first
fully refined product surfaces. It also explicitly carries the previously
created Trellis tasks `07-05-inkframe-product-ui-refactor`,
`07-04-ink-material-card-restore-resource`, and
`07-02-chat-event-unread-indicators` so the implementation agent does not treat
them as separate later work.

## Background

The previous task now has code-level green evidence:

- production `MaterialSurface` runtime exists outside the demo;
- global shell background owns an Inkframe material surface;
- chat messages and task cards default to static material surfaces;
- chat and task now expose explicit paintbrush toggles for one foreground active
  material surface;
- backend read cursors exist for channel/DM/thread unread state;
- sub-agent review fixed cursor scope validation and stale unread projections;
- frontend lint, typecheck, unit tests, backend cursor tests, backend compile,
  and diff check pass.

The remaining gap is product proof and polish:

- `./twd --compact tabs` currently returns `{"ok": true, "tabs": [], "count": 0}`,
  so there is no real browser/mobile evidence yet;
- active material controls exist but have not been visually tested in chat/task;
- mobile behavior is only code/test inferred;
- backend cursor behavior is covered by focused service/API tests, but not by a
  broader authenticated route-flow test.

For the consolidated 12-hour execution plan, see
`12-hour-product-refactor-plan.md` in this task directory.

## Requirements

### R1. Restore Real Browser Evidence

Use the project WebDriver wrapper `./twd`, not Playwright and not raw `twd.py`.

Required evidence:

- connected tab discovery works or the blocker is documented with exact command
  output;
- authenticated `/chat` or `/chat/[channel]` loads;
- authenticated `/tasks` loads;
- screenshots and DOM assertions are saved under this task's `evidence/`;
- all assertions include the target `tabUrl` or exact failure output.

If WebDriver is still unavailable, this task must still make progress through
source-level/product tests and document the browser blocker. Do not fake browser
evidence.

### R1b. Consolidate The Earlier Product Refactor Scope

This task must include the relevant acceptance surfaces from:

- `07-05-inkframe-product-ui-refactor`: global clean Inkframe desk background,
  chat/task as the first fully polished product surfaces, mobile proof, and
  background image/material readiness.
- `07-04-ink-material-card-restore-resource`: session-only keep/restore,
  editable restored ink, discard/revoke resource lifecycle, and no backend,
  `localStorage`, or IndexedDB persistence for large blobs.
- `07-02-chat-event-unread-indicators`: replace low-value root-message counts
  with channel/DM/thread unread/event indicators backed by real cursor state.

The implementation may reuse already-completed code from
`07-06-inkframe-material-runtime-chat-events-optimization`, but the final
evidence must map back to these older acceptance criteria.

### R2. Prove Chat Material Interaction In Product

In the real chat UI:

- message toolbar remains hidden by default and appears near the message;
- paintbrush toggle appears in that toolbar;
- toggling one message activates exactly one message material canvas in the
  `chat-main` region;
- toggling a different message deactivates the previous one;
- active draw mode captures pointer only while explicit material mode is active;
- long messages remain readable and are not aggressively tilted;
- thread root and thread replies use the same material activation model.

### R3. Prove Task Material Interaction In Product

In the real task UI:

- task tickets/cards default to static material surfaces;
- paintbrush toggle appears where it does not conflict with drag/select;
- toggling one task activates exactly one task material canvas in `task-main`;
- task toggle pointer/key events do not accidentally select, drag, or navigate
  the task;
- selected task detail uses the same active task material state;
- task board, list view, and mobile task layout remain readable.

### R4. Polish The Product Surface

Use the existing Inkframe object language. Do not invent a new theme.

Polish targets:

- no old pink/dark/dirty route background on user-facing product pages;
- every user-facing product page inherits the clean Inkframe desk background by
  default, even if only chat/task receive full object-level polish;
- shell/background material keeps desk tint and viewport alignment after
  render/keep/re-render;
- imported image/material rendering preserves source color and clarity better
  than black-only ink degradation;
- chat/task active material affordances are visible enough but not noisy;
- controls use familiar icon buttons and tooltips/titles;
- no nested interactive elements;
- no text overlap or clipped action buttons at desktop or 390px mobile;
- hover motion still means actionable/movable only;
- foreground active canvas does not cover text enough to hurt readability.

### R5. Harden Backend Read Cursor Integration

Go beyond focused cursor tests:

- add or strengthen an authenticated route-flow test for channel/DM/thread
  cursor writes and refresh projection if the existing test harness supports it;
- prove cursor writes are monotonic and server/member scoped;
- prove DM cursor writes reject non-DM channels and channel cursor writes reject
  DM channels;
- prove list payloads use actual unread message counts rather than global
  sequence gaps.

### R6. Resource And Performance Sanity

Prove active material surfaces do not grow without bound:

- static message/task lists do not create canvas elements;
- activating multiple messages/tasks leaves only the current foreground active
  surface per region;
- repeated active/keep/discard paths do not leak private material resources in
  code-level tests;
- background/material image resources are session-only and are explicitly
  released when replaced, discarded, or unloaded;
- if browser memory metrics are unavailable, record the limitation and use DOM
  canvas/resource-count assertions.

## Acceptance Criteria

- [ ] `./twd --compact tabs` evidence is captured. If no tab is connected, the
      exact blocker is recorded and all non-browser validation still runs.
- [ ] Chat browser or DOM evidence proves message material toggle visibility and
      one active message surface behavior.
- [ ] Task browser or DOM evidence proves task material toggle visibility and
      one active task surface behavior.
- [ ] 390px mobile checks for chat and tasks have no horizontal overflow and no
      clipped primary controls.
- [ ] Product surface audit is updated with pass/fail rows for chat, tasks,
      members, computers, settings, and product landing/dashboard routes.
- [ ] Backend cursor route-flow or stronger integration tests pass, including
      scope-kind rejection and unread count correctness.
- [ ] Frontend full tests pass.
- [ ] Backend cursor tests and selected route tests pass.
- [ ] TypeScript, ESLint, backend compile, and `git diff --check` pass.
- [ ] A Trellis channel review or self-review is recorded against this task.

## Out Of Scope

- Backend storage for large ink/image blobs.
- IndexedDB/localStorage persistence for ink drawings.
- Full object redesign of members, computers, and settings beyond shared
  background/polish checks.
- A new theme switcher or alternate product style.
- Turning SmallKhoj into a drawing application.

## Notes

- Current parent/reference task:
  `.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization`
- Current branch/worktree:
  `/Users/code/project/smallkhoj-inkframe-object-ui`,
  `codex/inkframe-object-ui`.
- Do not pull, push, merge, reset, or commit without main-session direction;
  this worktree carries large active changes.
