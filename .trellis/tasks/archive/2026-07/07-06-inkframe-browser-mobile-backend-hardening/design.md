# Design: Inkframe Browser Mobile And Backend Route Flow Hardening

## Design Summary

This loop is a proof-and-hardening pass. The product UI already has a code-level
Inkframe implementation; the missing confidence is runtime proof:

- `./twd` browser tab connection;
- browser DOM/screenshot evidence;
- mobile layout measurements;
- authenticated backend route-flow tests for read cursors.

Do not treat this task as another visual exploration. UI changes should be
small and evidence-driven.

## Browser Proof Architecture

### Connectivity

`./twd` has two separable states:

1. CLI/master runs.
2. A browser tab/extension client connects and appears in `tabs`.

The previous loop proved state 1 but not state 2. This task should diagnose the
gap explicitly:

- is `./twd serve` running;
- which ws/http ports are active;
- whether the browser extension is connected;
- whether a frontend tab exists;
- whether port auto-discovery is finding the expected bridge.

All long-running bridge processes must be stopped unless they are intentionally
needed for the next command.

### DOM Evidence

Prefer small `./twd --compact eval` payloads:

```js
return {
  url: location.href,
  deskBackground: !!document.querySelector('[data-region="app-desk-background"]'),
  activeCanvases: document.querySelectorAll('[data-slot="material-canvas"][data-mode="active"]').length,
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}
```

Screenshots are useful for product review but do not replace DOM assertions.

## Chat Browser Contract

Selectors:

- `data-region="chat-main"`
- `data-region="message-list"`
- `data-region="composer"`
- `data-slot="message-material-toggle"`
- `data-slot="material-canvas"`

Assertions:

- toolbar/toggle exists near a message;
- one message activation creates one active canvas;
- another activation switches ownership;
- inactive messages remain static and do not own active canvases.

## Task Browser Contract

Selectors:

- `data-region="main-panel"` / task product route shell;
- `data-slot="task-material-toggle"`;
- `data-slot="task-material-layer"`;
- `data-slot="material-canvas"`;
- `data-material-owner` / `data-owner-kind="task"` when available.

Assertions:

- board view exposes task toggles;
- list view exposes task toggles;
- selected detail exposes a task toggle;
- selected detail starts static after route open;
- explicit toggle activates one task surface.

## Mobile Contract

At 390px width:

- no document-level horizontal overflow;
- primary scroll owner still scrolls;
- composer and task controls remain visible inside their parent;
- active material pointer capture appears only after explicit toggle.

Use DOM measurements:

```js
return {
  width: innerWidth,
  docClientWidth: document.documentElement.clientWidth,
  docScrollWidth: document.documentElement.scrollWidth,
  overflowing: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}
```

## Backend Route-Flow Contract

Backend read cursors are user/member/server-scoped state. The route-flow tests
should prove the real public API boundary:

```text
authenticated account -> active server context -> route handler -> service ->
database -> list/thread projection -> frontend payload fields
```

Test in priority order:

1. channel cursor write and list projection;
2. DM cursor write and list projection;
3. thread cursor write and root message projection;
4. monotonic update behavior;
5. server/member scoping;
6. channel/DM mismatch rejection;
7. unread count correctness with global sequence gaps.

## Risk And Rollback

| Risk | Mitigation |
|---|---|
| Browser extension cannot connect | Record exact blocker; do not fake proof; continue backend route-flow hardening |
| Mobile proof reveals visual layout issues | Make minimal CSS/component fix, then rerun focused tests |
| Route-flow fixture setup grows too large | Add a small reusable authenticated public API test fixture rather than source-text assertions |
| Material canvas steals mobile scroll | Keep pointer capture behind explicit active mode; verify `data-material-pointer-mode` |

