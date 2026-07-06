# Design: Inkframe Runtime Browser Proof And Product Polish Optimization

## Design Summary

This task is a productization loop over the already implemented material runtime
and read cursor work. It should not invent a second visual direction, but it may
perform substantial frontend refactoring where the current product routes still
do not match the Inkframe object language.

The work has three tracks:

1. **Browser proof track**: connect `./twd`, authenticate, capture DOM/screenshot
   evidence, and run mobile viewport checks.
2. **Frontend product polish track**: refine chat/task material activation,
   active-state affordances, global background, mobile layout, and product
   surface consistency.
3. **Material lifecycle track**: preserve the `07-04` restore/resource contract
   while productizing background, chat, task, and imported image surfaces.
4. **Backend hardening track**: expand read-cursor tests from focused service/API
   behavior to authenticated route-flow behavior where possible.

The detailed 12-hour plan and stateful-object census live in
`12-hour-product-refactor-plan.md`.

## Global Background Model

`ProductShell` should own the user-facing desk environment through
`AppDeskBackground`. Product routes should not each define their own route-level
pink/dark/dirty background.

The background material has a different owner and tint than message/task
surfaces:

- desk/background owner: dry paper desk, fixed viewport coordinates;
- message owner: readable paper slip/notebook tint;
- task/evidence/review owners: task-specific material treatments.

Keep/restore must preserve this owner metadata. A kept desk background must not
come back as chat-card paper tint, and a static background must not scroll or
scale like a document-height CSS background.

Background images are a future product capability, so the runtime should already
separate:

- visual snapshot for static display;
- editable restore map for ink/water fields;
- source image restore for color fidelity.

No large background/image blobs are persisted to backend, `localStorage`, or
IndexedDB in this pass.

## Frontend Interaction Model

### Chat

- State owner: `ChannelClient`.
- State key: `activeMaterialMessageId`.
- Activation control: `data-slot="message-material-toggle"` inside
  `MessageToolStrip`.
- Surface behavior:
  - inactive message: `mode="static"`, `pointerMode="none"`;
  - active message: `mode="active"`, `pointerMode="draw"`;
  - active surface belongs to region `chat-main`.

The control stays in the hidden-by-default message toolbar. This keeps material
editing discoverable without placing permanent controls on every message.

Long agent messages should use the stable readable paper/notebook treatment
where useful; short messages may tilt subtly. The implementation should not
make every chat object rotate or animate.

### Tasks

- State owner: `TaskBoard`.
- State key: `activeMaterialTaskId`.
- Activation control: `data-slot="task-material-toggle"` on task board cards,
  list rows, and selected task detail.
- Surface behavior:
  - inactive task: `mode="static"`, `pointerMode="none"`;
  - active task: `mode="active"`, `pointerMode="draw"`;
  - active surface belongs to region `task-main`.

The task toggle must stop pointer/key propagation because task cards are also
selectable and draggable.

## Browser Evidence Strategy

Use `./twd` only:

- `./twd --compact tabs`
- `./tools/twd-guard/twd-auth <known-user>` if needed
- `./tools/twd-guard/twd-open /chat`
- `./tools/twd-guard/twd-open /tasks`
- `./twd --compact eval --url-match ... "return {...}"`
- `./twd screenshot --url-match ... <evidence-path>`

Evidence should prefer small DOM assertions over large screenshots:

- count material surfaces and canvases;
- identify active toggle state;
- assert no horizontal overflow at mobile width;
- assert message toolbar hidden/default and visible on hover/focus if feasible;
- assert active material surface captures pointer only in active mode.

Screenshots are useful for product polish but do not replace DOM assertions.

## Backend Test Strategy

Add selected integration tests only where the existing backend test utilities can
create authenticated server/member context without large fixture surgery.

Priority:

1. Cursor scope-kind rejection.
2. Monotonic writes.
3. Server/member scoping.
4. Actual unread count with global sequence gaps.
5. Refresh/list projection after cursor write.

If authenticated route-flow utilities are not available, record the limitation
and strengthen service/router focused tests instead.

## Consolidated Acceptance Mapping

| Earlier task | Design owner in this task |
|---|---|
| `07-05` global background | `ProductShell` + `AppDeskBackground` + route audit |
| `07-05` chat/task object UI | `MessagePaper`, `MessageToolStrip`, `TaskMaterialSurface`, `EvidenceSurface`, `ReviewMarkup` |
| `07-05` mobile | `./twd` 390px checks or exact browser blocker plus CSS/source fallback |
| `07-04` restore/resources | `material-resource`, `material-surface-restore`, lifecycle tests |
| `07-02` unread/event | backend read cursors + `use-chat-unread-store` + sidebar/thread badges |

## Risks

| Risk | Mitigation |
|---|---|
| `./twd` has no connected tab | Record exact blocker, keep code-level checks green, do not fake browser evidence |
| Active material canvas blocks message text | Keep material layer behind content and verify readability/DOM layering |
| Task material toggle conflicts with drag/select | Stop propagation and test nested interaction structure |
| Mobile canvas steals scroll | Explicit active mode only; mobile DOM check for `data-captures-pointer` |
| Backend tests need too much fixture setup | Add route tests only if harness is ready; otherwise document and strengthen service tests |

## Rollback

If active foreground material controls prove visually disruptive, keep the
runtime and state model but hide the toggle behind a settings/lab affordance.
The static Inkframe product UI remains the fallback.
