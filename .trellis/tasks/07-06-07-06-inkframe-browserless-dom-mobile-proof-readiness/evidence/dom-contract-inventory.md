# DOM Contract Inventory

Date: 2026-07-06

## Purpose

Record which Inkframe product objects now expose stable browserless DOM
contracts. This evidence is not browser acceptance; it is selector/readiness
evidence for the next `./twd` pass once a tab is connected.

## Product Shell Background

Owner component:

```text
frontend/components/inkframe/app-desk-background.tsx
```

Runtime surface:

```text
frontend/components/inkframe/material-surface.tsx
```

Stable markers now exposed:

```text
data-inkframe-surface="app-background"
data-inkframe-owner-kind="app-background"
data-inkframe-owner-id="global-desk"
data-inkframe-region="app-background"
data-inkframe-mode="static|active|keeping|discarding|fallback"
data-inkframe-tint="desk"
data-inkframe-pointer-capture="true|false"
```

The underlying material surface also exposes:

```text
data-inkframe-surface="material"
data-inkframe-owner-kind
data-inkframe-owner-id
data-inkframe-region
data-inkframe-mode
data-inkframe-tint
data-inkframe-pointer-capture
```

## Chat Message / Material Contract

Owner components:

```text
frontend/components/message-frame.tsx
frontend/components/inkframe-object-ui.tsx
frontend/app/chat/[channel]/channel-client.tsx
```

Stable markers:

```text
data-inkframe-object="message"
data-inkframe-density="short|medium|long"
data-inkframe-surface="material"
data-inkframe-owner-kind="message"
data-inkframe-region="chat-main"
data-inkframe-mode="static|active|..."
data-inkframe-pointer-capture="true|false"
```

Chat route mobile/proof markers:

```text
data-inkframe-mobile-role="chat-workspace"
data-inkframe-mobile-role="sidebar-drawer"
data-inkframe-mobile-role="chat-message-list"
data-inkframe-mobile-role="chat-composer"
data-inkframe-mobile-role="chat-thread-panel"
data-inkframe-mobile-role="chat-members-panel"
data-inkframe-object="message-actions"
data-inkframe-state="toolbar-hidden"
```

Unread/event markers now expose cursor-backed state through:

```text
data-inkframe-object="sidebar-entity"
data-inkframe-object="event-badge"
data-inkframe-unread="true|false"
```

## Task / Evidence / Review Contract

Owner components:

```text
frontend/components/inkframe-object-ui.tsx
frontend/components/task-dnd-board.tsx
frontend/app/tasks/page.tsx
```

Stable object markers:

```text
data-inkframe-object="task-ticket"
data-inkframe-object="evidence"
data-inkframe-object="review"
data-inkframe-state="<task-status>"
```

Task route mobile/proof markers:

```text
data-inkframe-mobile-role="task-workspace"
data-inkframe-mobile-role="task-controls"
data-inkframe-mobile-role="task-board"
data-inkframe-mobile-role="task-detail"
data-inkframe-mobile-role="task-evidence"
data-inkframe-mobile-role="task-review"
```

## Browserless Tests Added / Hardened

Files:

```text
frontend/test/material-surface.test.tsx
frontend/test/inkframe-object-ui.test.tsx
```

Coverage:

- material surface exposes `data-inkframe-*` owner/mode/tint/pointer markers;
- app background exposes shell-owned global desk markers;
- message paper exposes message object and short/medium/long density markers;
- task/evidence/review objects expose distinct `data-inkframe-object` roles;
- chat route source exposes mobile/proof roles;
- task route and task board source expose mobile/proof roles;
- static material surfaces still do not render active canvases by default.

## Remaining Gap

Real browser/mobile proof remains pending because the current `./twd` tab list
is empty. These markers make the later proof deterministic, but they do not
prove visual layout, overflow, drawer behavior, or actual pointer interaction.
