# Integrated Execution Plan

Date: 2026-07-06

This note is the handoff-friendly version of the integrated Inkframe plan. It
exists so another agent can continue without treating the work as separate
visual experiments.

## One Delivery, Not Separate Tasks

The current implementation target is:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

It must carry these earlier Trellis tasks at the same time:

- `07-05-inkframe-product-ui-refactor`
  - umbrella product acceptance contract;
  - Inkframe becomes the default product direction;
  - chat, task, and product shell background are the first acceptance surfaces.
- `07-04-ink-material-card-restore-resource`
  - material lifecycle contract;
  - kept ink restores after re-render;
  - restored ink remains editable;
  - discard/replacement/unload revokes private image resources;
  - repeated keep remains bounded.
- `07-02-chat-event-unread-indicators`
  - chat attention contract;
  - low-value message counts are replaced by channel/DM/thread unread state;
  - backend read cursors become the real source of truth where possible.

Do not split these into three disconnected implementation passes. The user wants
the product result to land together: material runtime, product shell background,
chat/task object UI, mobile usability, and chat unread semantics.

## Product Judgment

The WebGL material system is not a tiny decorative enhancement. The latest demo
is considered good enough to productize, so the implementation should not be
overly conservative.

However, this does not mean every element gets a live canvas. The product model
is:

- every user-facing product page uses the clean Inkframe desk background;
- the background is material-capable by default;
- chat and task are the first full object/material pages;
- inactive objects use static paper/snapshot resources;
- only one foreground material surface is active per workspace region unless a
  concrete reason says otherwise;
- mobile scroll and text readability win over decorative interaction.

## Non-Negotiable Decisions

- No backend storage for large ink/image blobs in this iteration.
- No `localStorage` or IndexedDB for ink/background image persistence in this
  iteration.
- Session-only material resources are acceptable.
- Backend storage is appropriate for small chat read-cursor metadata.
- The background owner is `app-background`, owner id `global-desk`, tint `desk`.
- A kept or restored background must not drift into chat/message tint.
- Hover motion means actionable or movable; do not animate unrelated decoration.
- Avatars do not get red stamps or status-dot-obstructing marks.
- Not every object tilts; long messages stay stable.
- The old pink/dark/dirty background direction should be removed from
  user-facing product pages.

## Final Product Surface

### Product Shell Background

Every user-facing route mounted in `ProductShell` should share the same clean
dry-paper desk foundation:

- `/chat`
- `/chat/[channel]`
- `/tasks`
- `/members`
- `/computers`
- `/settings`
- product landing/dashboard routes that use the product shell

The visible default may be calm/static dry paper, but the background component
itself must own a material lifecycle:

- activate;
- draw;
- inject water;
- keep;
- discard;
- restore after re-render in the same session;
- fallback when WebGL is unavailable.

Future background images are expected, so the resource model must already
separate:

- visual snapshot for static display;
- restore resource for editable ink/material state;
- source resource for image/color fidelity.

### Chat

Chat is a primary polish target.

Expected behavior:

- messages are readable physical papers, not generic cards;
- short messages may have slight handmade angle;
- long messages are stable and easy to scan;
- message toolbar is hidden by default and appears near the message;
- paragraph spacing, mentions, paths, code, timestamps, and author metadata are
  legible;
- material activation is available without creating one WebGL context per
  message;
- task references remain normal messages with later navigation;
- channel/DM sidebar entities share one attention primitive;
- thread unread markers live on the root message/thread affordance.

### Tasks

Tasks are the second primary polish target.

Expected behavior:

- task tickets, evidence papers, review marks, and memory notes are visually
  distinct species;
- task board/list rendering is not a pile of identical black-bordered papers;
- running/review/done/blocked states may use material language, but only where
  it improves comprehension;
- evidence surfaces can keep the approved tilted/physical feel;
- review stamps/marks stay semantic and must not spread to avatars or generic
  controls.

### Members / Computers / Settings

These pages inherit the shared shell background and shared primitives when
touched, but their full object redesign is deferred. The main requirement in
this pass is that they no longer visually fall back to an old route-local
background.

## 12 Hour Execution Budget

Use the large budget for correctness and verification, not for random visual
flourish.

| Phase | Budget | Output |
|---|---:|---|
| 0. Preflight and scope lock | 45 min | confirm branch, dirty tree, task docs, old task inclusion |
| 1. Product route audit | 1 h | route matrix for background/chat/task/mobile/old-style leaks |
| 2. Material runtime lifecycle | 2 h | production `MaterialSurface`, resource model, active coordinator |
| 3. Shell background productization | 1.5 h | material-capable `AppDeskBackground` across product routes |
| 4. Chat/task integration | 1.75 h | one-active-surface chat/task material slots with readable object UI |
| 5. `07-04` lifecycle regression | 1 h | keep/restore/discard/revoke/repeated-keep tests |
| 6. Backend read cursors | 1.75 h | channel/DM/thread cursor service/API/tests |
| 7. Frontend unread reconciliation | 1 h | sidebar/thread badges backed by backend cursors |
| 8. Mobile/browser/resource proof | 1.25 h | `./twd` evidence and bounded-resource assertions |
| 9. Review and final fixes | 1 h | Trellis channel review, quality gate, spec updates |

If time slips, preserve this order:

1. Material lifecycle correctness.
2. Shell background correctness.
3. Backend cursor correctness.
4. Chat/task readability and mobile.
5. Extra visual polish.

## Implementation Order

### Phase 0: Preflight

Run:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git branch --show-current
rtk git status --short
rtk python3 ./.trellis/scripts/task.py current
```

Confirm the branch is `codex/inkframe-object-ui`. The tree is expected to be
dirty; do not reset unrelated work.

Read these before editing:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/prd.md
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/design.md
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/implement.md
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/operator-scope-addendum.md
.trellis/tasks/07-05-inkframe-product-ui-refactor/prd.md
.trellis/tasks/07-04-ink-material-card-restore-resource/prd.md
.trellis/tasks/07-02-chat-event-unread-indicators/prd.md
```

### Phase 1: Product Route Audit

Update:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization/evidence/product-surface-audit.md
```

The audit must classify each major route:

- uses `ProductShell` or bypasses it;
- has clean desk background or old background;
- has material-capable background owner metadata;
- has old pink/dark/dirty visual leak;
- has desktop overlap/clipping risk;
- has 390px mobile overflow/reachability risk.

Do this before broad visual edits so later changes have a comparison target.

### Phase 2: Material Runtime

Complete or harden:

```text
frontend/components/inkframe/ink-material-engine.tsx
frontend/components/inkframe/material-resource.ts
frontend/components/inkframe/material-surface-restore.ts
frontend/components/inkframe/material-surface-store.ts
frontend/components/inkframe/material-surface.tsx
```

Minimum contracts:

- static mode renders no live canvas;
- active mode creates the runtime surface only when activated;
- keep writes visual/restore/source resources as appropriate;
- discard returns to owner default;
- unmount/deactivate cleans runtime state;
- stale async restore cannot bake into a new owner;
- private object URLs are revoked on replacement, discard, and unload;
- repeated keep for one owner leaves at most one current private resource.

### Phase 3: Shell Background

Complete:

```text
frontend/components/inkframe/app-desk-background.tsx
frontend/components/product-shell.tsx
frontend/components/product-shell-body.tsx
frontend/app/globals.css
```

Required selectors/metadata:

```text
data-inkframe-surface="app-background"
data-inkframe-owner-kind="app-background"
data-inkframe-owner-id="global-desk"
data-inkframe-region="app-background"
data-inkframe-tint="desk"
data-inkframe-pointer-capture="false" in static mode
```

Known bug to prevent:

- drawing/keeping the background must not cause the static background to become
  chat/card tint after collapse or re-render.

### Phase 4: Chat And Task Surfaces

Chat files likely involved:

```text
frontend/components/message-frame.tsx
frontend/components/markdown-message.tsx
frontend/app/chat/[channel]/channel-client.tsx
frontend/app/chat/[channel]/chat-sidebar.tsx
frontend/app/chat/chat-data-context.tsx
```

Task files likely involved:

```text
frontend/components/task-board.tsx
frontend/components/task-dnd-board.tsx
frontend/components/task-list-panel.tsx
frontend/components/task-detail-dialog.tsx
frontend/components/task-material-state.tsx
frontend/components/inkframe-object-ui.tsx
```

Rules:

- do not create one live WebGL surface per message/task;
- use active regions such as `chat-main` and `task-main`;
- keep inactive surfaces static and cheap;
- keep long text readable;
- keep toolbars near their object;
- preserve visual distinction between message paper, task ticket, evidence, and
  review mark.

### Phase 5: Chat Unread / Event State

Backend-owned read cursor is the product target.

Backend responsibilities:

- channel cursor;
- DM cursor;
- thread/root-message cursor;
- member/server scoping;
- monotonic writes;
- refresh returns persisted state.

Frontend responsibilities:

- remove/de-emphasize low-value total root-message count;
- channel/DM sidebar rows show attention marks from cursor-derived state;
- thread marker on root messages shows unseen replies;
- opening/viewing clears the matching cursor;
- realtime `message.created` updates pending local attention until backend
  reconciliation catches up.

## Validation Plan

### Frontend

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
rtk env NODE_PATH=./node_modules npx tsc --noEmit --pretty false
```

### Backend

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/backend
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py tests/test_server_account_membership.py -q
rtk env PYTHONPATH=. uv run python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors_postgres_http.py
```

### Product Proof Runner

Use `./twd`, not raw Playwright:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./twd --compact tabs
rtk ./tools/twd-guard/twd-inkframe-proof --task-dir .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization --account zy-ean --json
```

If no tab is connected, record `blocked_no_tab` honestly. Do not claim
browser/mobile acceptance from source tests.

### Route Sweep

The proof runner should cover at least:

```text
/chat
/tasks
/members
/computers
/settings
```

Add product landing/dashboard routes only after verifying they are user-facing
product shell routes and not login/control redirects.

### Mobile

Real browser/mobile proof must include:

- 390px chat;
- 390px task;
- no horizontal overflow;
- composer usable;
- task controls reachable;
- background static mode does not steal scroll;
- draw/water pointer capture only after explicit activation.

## Review Request Shape

When implementation finishes, ask the check agent to review this exact combined
scope, not just one file:

```text
Active task: .trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization

Review the integrated Inkframe material runtime + product shell background +
chat/task object UI + backend read cursor work.

Prioritize bugs, missing tests, and product-contract drift. Pay special
attention to:
- MaterialSurface lifecycle and stale async restore races;
- object URL revocation and repeated keep/discard resource bounds;
- one active WebGL foreground surface per region;
- app background owner/tint drift after keep/restore;
- chat/task readability and mobile overflow;
- backend read cursor monotonicity and member/server scoping;
- frontend cursor reconciliation with realtime message.created;
- whether old tasks 07-05, 07-04, and 07-02 are actually covered.

Return findings with file/line references and severity.
```

## Done Means

This task is not done merely because tests pass.

Done means:

- `07-05` product refactor surface is visibly represented in real chat/task and
  product shell background;
- `07-04` material lifecycle guarantees are covered by executable tests;
- `07-02` unread/event indicators are backed by real cursor semantics or an
  explicitly documented backend-blocking cut;
- frontend/backend checks pass;
- `./twd` browser proof passes, or the task honestly records that browser proof
  is blocked by no connected tab;
- quality gate maps every merged old task to concrete evidence.
