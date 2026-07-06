# TWD Proof Checklist

Date: 2026-07-06

This checklist is ready for use once a browser tab is connected to the project
WebDriver bridge.

Do not use Playwright for this task.

## Gate

Run first:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk ./twd --compact tabs
```

If the result is:

```json
{"ok": true, "tabs": [], "count": 0}
```

stop and record:

```text
No connected tab. Browser/mobile proof not claimed.
```

## Routes To Open

Use the project guard wrappers when available:

```bash
rtk ./tools/twd-guard/twd-auth zy-ean
rtk ./tools/twd-guard/twd-open /chat
rtk ./tools/twd-guard/twd-open /tasks
```

If guard wrappers are unavailable, use `./twd --help` and equivalent project
commands, but keep all evidence under this task.

## Product Shell Selectors

Assert on chat, tasks, members, computers, settings when reachable:

```text
[data-inkframe-surface="app-background"]
[data-inkframe-owner-kind="app-background"]
[data-inkframe-owner-id="global-desk"]
[data-inkframe-region="app-background"]
[data-inkframe-tint="desk"]
[data-inkframe-pointer-capture="false"]
```

Acceptance:

- exactly one shell-owned background per product shell;
- it is behind product content;
- default pointer capture is false.

## Chat Desktop Selectors

```text
[data-inkframe-mobile-role="chat-workspace"]
[data-inkframe-mobile-role="sidebar-drawer"][data-inkframe-state="collapsed"]
[data-inkframe-mobile-role="chat-message-list"]
[data-inkframe-mobile-role="chat-composer"]
[data-inkframe-object="message"]
[data-inkframe-object="message-actions"][data-inkframe-state="toolbar-hidden"]
[data-inkframe-object="sidebar-entity"][data-inkframe-unread]
[data-inkframe-object="event-badge"][data-inkframe-unread="true"]
[data-inkframe-surface="material"][data-inkframe-owner-kind="message"]
```

Acceptance:

- message list is visible;
- composer is visible and usable;
- ordinary message list does not create one active canvas per message;
- active material state, when toggled, creates a bounded active surface.

## Chat Thread / Members Selectors

When open:

```text
[data-inkframe-mobile-role="chat-thread-panel"]
[data-inkframe-mobile-role="chat-members-panel"]
```

Acceptance:

- panel exists only when the corresponding UI state is open;
- panel does not overlap composer or hide message actions.

## Chat Mobile Selectors

At representative mobile width, for example 390px:

```text
[data-inkframe-mobile-role="chat-workspace"]
[data-inkframe-mobile-role="chat-message-list"]
[data-inkframe-mobile-role="chat-composer"]
```

Acceptance:

- no horizontal overflow;
- composer remains visible/reachable;
- static material surfaces do not capture page scroll.

## Task Desktop Selectors

```text
[data-inkframe-mobile-role="task-workspace"]
[data-inkframe-mobile-role="task-controls"]
[data-inkframe-mobile-role="task-board"]
[data-inkframe-object="task-ticket"]
[data-inkframe-object="evidence"]
[data-inkframe-object="review"]
```

Acceptance:

- task/evidence/review are distinct object roles;
- task board/list rendering does not mount unbounded active canvases;
- selected task/detail remains readable.

## Task Mobile Selectors

At representative mobile width, for example 390px:

```text
[data-inkframe-mobile-role="task-workspace"]
[data-inkframe-mobile-role="task-controls"]
[data-inkframe-mobile-role="task-board"]
[data-inkframe-mobile-role="task-detail"]
[data-inkframe-mobile-role="task-evidence"]
[data-inkframe-mobile-role="task-review"]
```

Acceptance:

- no horizontal overflow;
- task controls remain reachable;
- evidence/review access remains visible or reachable through mobile UI.

## Material Pointer/Capture Selectors

```text
[data-inkframe-surface="material"]
[data-inkframe-mode="static"]
[data-inkframe-pointer-capture="false"]
```

Acceptance:

- static surfaces do not capture pointer;
- draw/water mode captures pointer only after explicit activation;
- active foreground surfaces remain bounded by workspace region.

## Evidence Rule

Screenshots may supplement visual review, but resource/canvas-count and pointer
capture claims must be backed by DOM assertions against the selectors above.
