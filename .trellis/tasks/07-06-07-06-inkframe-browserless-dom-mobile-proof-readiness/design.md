# Design: Browserless DOM Contract And Mobile Proof Readiness

## Architecture

This task adds an observability/testability layer to the existing Inkframe
product primitives. It should not create a parallel visual system.

The right shape is:

1. Product components expose stable semantic attributes for their object role,
   material owner, state, and pointer behavior.
2. Browserless tests assert those attributes and source contracts.
3. `./twd` browser checks reuse the same selectors when a tab is available.

## Attribute Vocabulary

Use `data-inkframe-*` attributes for stable product contracts:

```text
data-inkframe-surface
data-inkframe-owner-kind
data-inkframe-owner-id
data-inkframe-region
data-inkframe-mode
data-inkframe-tint
data-inkframe-pointer-capture
data-inkframe-object
data-inkframe-density
data-inkframe-state
data-inkframe-mobile-role
data-inkframe-unread
```

These attributes are not decorative. They describe product objects and runtime
states that tests and `./twd` can assert.

## Component Mapping

| Product concept | Expected marker |
|---|---|
| App desk background | `data-inkframe-surface="app-background"` |
| Chat message | `data-inkframe-object="message"` |
| Long message | `data-inkframe-density="long"` or equivalent stable state |
| Active message material | `data-inkframe-mode="active"` and region `chat-main` |
| Task ticket | `data-inkframe-object="task-ticket"` |
| Evidence surface | `data-inkframe-object="evidence"` |
| Review markup | `data-inkframe-object="review"` |
| Sidebar channel/DM/member item | `data-inkframe-object="sidebar-entity"` |
| Event badge | `data-inkframe-unread="true"` or count-backed state |
| Mobile composer | `data-inkframe-mobile-role="chat-composer"` |
| Mobile task controls | `data-inkframe-mobile-role="task-controls"` |

## Testing Strategy

Browserless tests should cover only what can be proven without layout:

- component render contains stable attributes;
- static/default modes do not render active canvases;
- mobile affordance markers exist in route/component source;
- pointer capture defaults are explicit and disabled in static mode;
- unread/event marker state flows from cursor helpers.

Real layout and interaction still need `./twd`:

- no horizontal overflow;
- real computed visibility;
- drawer open/close behavior;
- actual pointer/canvas interaction;
- screenshot-level visual coherence.

## State Objects

### Material Surface DOM Contract

Owner: `frontend/components/inkframe/material-surface.tsx`

Invariants:

- DOM-1: static mode has no active material canvas.
- DOM-2: active/draw/water mode exposes one active canvas for that surface.
- DOM-3: pointer capture is false unless draw/water/edit mode is explicit.
- DOM-4: owner kind/id/region/tint/mode are visible in DOM.

### Product Shell Background Contract

Owner: `frontend/components/inkframe/app-desk-background.tsx`

Invariants:

- BG-1: exactly one shell-owned app background owner is rendered by
  `ProductShell`.
- BG-2: background owner tint remains `desk`.
- BG-3: product pages render above the background layer.

### Chat/Task Object Contract

Owners:

- `frontend/components/message-frame.tsx`
- `frontend/components/inkframe-object-ui.tsx`
- task components under `frontend/components/task-*`

Invariants:

- OBJ-1: message/task/evidence/review/sidebar are distinct object roles.
- OBJ-2: ordinary lists use static surfaces.
- OBJ-3: active foreground surfaces are bounded per region.
- OBJ-4: mobile affordances expose deterministic roles for later `./twd`.

## Browser Proof Checklist Shape

Create evidence/checklist notes under this task:

```text
evidence/twd-proof-checklist.md
```

It should contain exact selectors and commands. If no tab is connected, record
the `./twd --compact tabs` result and stop before claiming acceptance.

## Risk

The main risk is "test-only attributes" that drift from real UI behavior. Avoid
that by placing markers on actual product components and by testing both marker
presence and related runtime behavior, such as active canvas count and pointer
capture state.
