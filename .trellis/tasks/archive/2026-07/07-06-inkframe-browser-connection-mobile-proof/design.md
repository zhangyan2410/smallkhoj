# Design: Browser Connection Recovery And Mobile Proof

## Strategy

This task is a proof/recovery layer, not a redesign layer. The implementation
should first restore the ability to observe the real product through `./twd`,
then run focused assertions against chat/task and mobile states. UI fixes should
be narrow and evidence-driven.

## State Machine

```text
NO_CONNECTED_TAB
  -> user opens Chrome / user permits launch / existing browser reconnects
CONNECTED_TAB
  -> auth via twd-guard
AUTHENTICATED
  -> open chat/tasks
ROUTE_VISIBLE
  -> DOM assertions + screenshots + material checks
EVIDENCE_COLLECTED
  -> fix narrow defects or create follow-up task
```

If the state cannot leave `NO_CONNECTED_TAB`, stop making browser claims and
write a recovery note. Continue backend-only work only under a separate backend
task.

## Browser Recovery Checks

Run:

```bash
rtk ./twd --compact tabs
rtk ./twd --compact ext tabs
rtk ./twd --compact groups list
```

If no tab is connected, re-read existing diagnostics before doing anything
destructive:

- bridge listening ports;
- frontend/backend listening ports;
- Chrome running state;
- extension installed/enabled;
- native host manifest.

The known likely fix is starting Chrome with the installed Codex extension.
That requires either direct user action or explicit user permission.

## Evidence Directory

Use:

```text
.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/
```

Suggested files:

- `browser-recovery.md`
- `chat-desktop-dom.json`
- `chat-desktop.snapshot.txt`
- `chat-desktop.png`
- `chat-mobile-390-dom.json`
- `chat-mobile-390.png`
- `tasks-desktop-dom.json`
- `tasks-desktop.snapshot.txt`
- `tasks-desktop.png`
- `tasks-mobile-390-dom.json`
- `tasks-mobile-390.png`
- `material-runtime-dom.json`

## DOM Probe Contract

Prefer small `eval` returns over huge snapshots.

Global fields:

```js
return {
  url: location.href,
  path: location.pathname,
  width: innerWidth,
  height: innerHeight,
  bodyOverflowX: getComputedStyle(document.body).overflowX,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  backgroundLayers: [...document.querySelectorAll('[data-object=\"app-desk-background\"], [data-slot=\"desk-background\"], .inkframe-app-desk')].length,
  activeCanvases: document.querySelectorAll('[data-slot=\"material-canvas\"][data-mode=\"active\"], canvas[data-material-active=\"true\"]').length,
  materialCanvases: document.querySelectorAll('canvas').length
}
```

Chat fields:

```js
return {
  url: location.href,
  messages: document.querySelectorAll('[data-object=\"chat-message\"], [data-message-id]').length,
  longMessages: [...document.querySelectorAll('[data-object=\"chat-message\"], [data-message-id]')]
    .filter((node) => node.textContent.length > 500).length,
  sideEntities: document.querySelectorAll('[data-object=\"sidebar-entity\"], [data-channel-id], [data-dm-id]').length,
  actionButtons: document.querySelectorAll('[data-object=\"message-actions\"], [data-slot=\"message-actions\"]').length,
  unreadMarks: document.querySelectorAll('[data-object=\"event-badge\"], [data-unread=\"true\"], [data-slot=\"unread-mark\"]').length,
  horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
}
```

Task fields:

```js
return {
  url: location.href,
  tickets: document.querySelectorAll('[data-object=\"task\"], [data-object=\"task-ticket\"], [data-task-id]').length,
  evidence: document.querySelectorAll('[data-object=\"evidence\"], [data-slot=\"evidence-surface\"]').length,
  review: document.querySelectorAll('[data-object=\"review\"], [data-slot=\"review-markup\"]').length,
  materialLayers: document.querySelectorAll('[data-slot=\"task-material-layer\"], [data-object=\"material-surface\"]').length,
  horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
}
```

Selectors may be adjusted to match the actual implemented data attributes, but
the evidence must be concrete and repeatable.

## Mobile Viewport

Use `./twd` viewport tooling if available. If not available as a direct command,
use a focused eval only if the connected browser/tool supports resizing. Record
the exact command. Target:

```text
390 x 844
```

If viewport resizing is unsupported, record that explicitly and still collect
current viewport dimensions. Do not claim phone proof from a desktop-width tab.

## Material Runtime Checks

The material runtime should be checked by DOM state first:

- active canvas count;
- static surface count;
- pointer mode;
- owner kind;
- z-index/background placement.

Only then activate controls if the UI exposes a safe material toggle. Do not
force pointer events through app internals unless the product UI exposes that
behavior or a test hook exists.

## Defect Handling

If a visual/layout bug is found:

1. Capture before evidence.
2. Make the smallest product fix.
3. Re-run the same DOM/screenshot check.
4. Record before/after in evidence.

If the bug is larger than this task, write a child/follow-up Trellis task with:

- route;
- selector/object class;
- screenshot path;
- expected behavior;
- actual behavior;
- likely files.

## Review Plan

After evidence or fixes, spawn a check agent with:

- this task's PRD/design/implement;
- evidence files;
- touched frontend files;
- `.trellis/spec/frontend/quality-guidelines.md`;
- `.trellis/spec/frontend/product-ui-style.md`;
- `.agents/skills/project-webdriver-cli/SKILL.md`.

Review focus:

- evidence truthfulness;
- no Playwright substitution;
- mobile proof really uses phone width;
- screenshots correspond to the asserted route;
- UI fixes do not drift from Inkframe object language.
