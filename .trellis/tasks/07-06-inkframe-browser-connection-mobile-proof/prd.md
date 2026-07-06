# Inkframe Browser Connection Recovery And Mobile Proof

## Goal

Recover trustworthy `./twd` browser connectivity and collect real desktop and
mobile evidence for the Inkframe chat/task refactor before the frontend can be
called done.

This task exists because the current refactor has backend and static-test
coverage, but browser/mobile acceptance is still unproven. The active evidence
shows the WebDriver bridge and app ports are running, but `./twd --compact tabs`
returns no connected tab. Until that is fixed, no agent should claim real
browser proof for chat, task, WebGL material, or mobile behavior.

## Parent Context

Parent task:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

This task is the next optimization loop under the parent. It does not replace
the broader UI refactor. It supplies the missing proof layer that lets later
frontend fixes be grounded in visible product behavior instead of screenshots,
memory, or demo-only assumptions.

Relevant prior evidence:

- `.trellis/tasks/07-06-inkframe-browser-mobile-backend-hardening/evidence/browser-connectivity.md`
- `.trellis/tasks/07-06-07-06-inkframe-twd-evidence-http-cursor-harness/evidence/twd-connectivity.md`
- `.trellis/tasks/07-06-07-06-inkframe-twd-evidence-http-cursor-harness/evidence/backend-http-harness.md`
- `.trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner/evidence/validation.md`
- `.trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner/evidence/twd-inkframe-proof.md`

Required proof runner:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

This runner is the canonical selector-based acceptance gate for Inkframe chat,
tasks, mobile DOM roles, unread/event markers, product shell background, and
material state. Manual screenshots and snapshots may supplement it, but must
not replace it.

## Current Facts

- `./twd` itself runs.
- A WebDriver bridge process is listening on `127.0.0.1:18765` and
  `127.0.0.1:18766`.
- The frontend is listening on `127.0.0.1:3000`.
- The backend is listening on `:8000`.
- `./twd --compact tabs` returns:

```json
{"ok": true, "tabs": [], "count": 0}
```

- Chrome is installed.
- The Codex Chrome Extension is installed and enabled in the selected profile.
- The native host manifest appears correct.
- Chrome is not running.
- The agent must not launch Chrome without user permission. If the user opens
  Chrome manually, this task can continue without agent-launched Chrome.

## In Scope

- Diagnose and recover `./twd` connected-tab state.
- Use only the project WebDriver wrapper `./twd` and guarded helpers for product
  UI proof.
- Authenticate the local app through `./tools/twd-guard/twd-auth`.
- Collect desktop evidence for:
  - global Inkframe desk background;
  - `/chat` or a concrete `/chat/[channel]` route;
  - message frame readability and toolbar reveal;
  - channel/DM sidebar entity rows and unread/event markers if seeded state is
    available;
  - material surface markers and bounded active canvas count;
  - `/tasks` ticket/detail/evidence/review surfaces.
- Collect mobile evidence at a representative phone width, preferably 390px:
  - chat composer usable;
  - sidebar collapsed or reachable;
  - long messages readable;
  - message actions reachable without overlap;
  - task controls reachable;
  - no obvious horizontal overflow;
  - WebGL/drawing pointer capture does not steal scroll unless explicit edit
    mode is active.
- Save DOM JSON, text snapshots, and screenshots under this task's evidence
  directory.
- Record exactly what could not be verified and why.

## Out Of Scope

- Changing the Chrome extension or native host unless the diagnostic proves the
  project wrapper itself is broken.
- Launching Chrome without user permission.
- Replacing `./twd` evidence with Playwright or screenshots from another tool.
- Claiming mobile/browser success from static tests.
- Broad new UI redesign. If browser evidence reveals a real defect, fix it
  narrowly or create a follow-up implementation task.
- Backend read-cursor feature expansion; that has separate coverage.

## Requirements

### R1. Connected Tab Recovery

The task must get from:

```json
{"ok": true, "tabs": [], "count": 0}
```

to at least one connected browser tab in `./twd --compact tabs`, or record the
exact reason recovery cannot proceed.

Acceptable recovery paths:

- user manually opens Chrome with the Codex Chrome Extension enabled;
- user explicitly permits the agent to launch Chrome;
- an already-open supported browser reconnects to the bridge.

Unacceptable paths:

- claiming proof from the in-app browser only;
- bypassing `./twd` with Playwright;
- silently launching Chrome despite the safety rule.

### R2. Authenticated Product Navigation

After a tab connects, use guarded helpers before raw navigation:

```bash
./tools/twd-guard/twd-auth zy-ean
./tools/twd-guard/twd-open /chat
./tools/twd-guard/twd-open /tasks
```

Every evidence command must record the returned tab URL or final path so a
future reviewer can tell which page was actually inspected.

After authenticated navigation succeeds, run the selector-driven proof runner
above and save its JSON/Markdown output under this task's `evidence/`
directory. If the runner returns `blocked_no_tab`, do not proceed to browser
acceptance claims.

### R3. Desktop Chat Evidence

Capture evidence that real chat is usable and visually aligned with Inkframe:

- clean desk background exists under product content;
- message list renders;
- message frames use the intended readable paper/object style;
- long messages are stable and readable;
- message toolbar is hidden by default and revealable near the message;
- channel/DM sidebars use the shared entity item language;
- unread/event indicators are visible if a seeded unread state exists, or the
  absence of seed data is explicitly noted;
- no obvious toolbar overlap or detached action row.

### R4. Desktop Task Evidence

Capture evidence that real tasks are usable and visually distinct:

- task tickets/list render;
- selected task/detail is visible and readable;
- evidence surface and review markup slots exist where data exists;
- task state treatments are not merely copied chat-message paper;
- global desk background is shared with chat.

### R5. Mobile Evidence

At a phone-sized viewport, collect DOM/layout assertions and screenshots for
chat and tasks:

- no horizontal overflow beyond a small tolerance;
- composer controls remain reachable;
- sidebar/drawer entry remains reachable;
- message/tool buttons do not cover each other;
- long message paragraphs stay readable;
- task controls do not disappear off-screen;
- material canvas pointer mode is inactive unless an explicit edit/draw mode is
  active.

### R6. WebGL / Material Runtime Evidence

Collect bounded-runtime evidence without running the long memory stress test:

- number of active material canvases;
- owner/kind of active/static material surfaces;
- whether background material layer is fixed below product content;
- if a material toggle exists, activating it creates a bounded active surface;
- if a keep/re-render flow is available in product UI, verify tint/position does
  not drift.

### R7. Evidence Honesty

Evidence must distinguish:

- real browser proof;
- backend tests;
- static/demo tests;
- pending or blocked checks.

No acceptance claim may be made for browser/mobile behavior unless the proof is
from a connected `./twd` tab.

## Acceptance Criteria

- [ ] `./twd --compact tabs` returns at least one connected tab, or the task
      records why that could not be recovered.
- [ ] Authenticated `/chat` evidence is collected with `./twd` and includes the
      final tab URL/path.
- [ ] Authenticated `/tasks` evidence is collected with `./twd` and includes the
      final tab URL/path.
- [ ] Desktop chat evidence covers message readability, toolbar behavior,
      sidebar entity rows, and background.
- [ ] Desktop task evidence covers ticket/detail/evidence/review surfaces and
      background.
- [ ] Mobile chat evidence at phone width covers composer, long messages,
      actions, sidebar access, and overflow.
- [ ] Mobile task evidence at phone width covers controls, surface layout, and
      overflow.
- [ ] WebGL/material evidence records active canvas counts and pointer mode.
- [ ] Screenshots and snapshots are saved under
      `.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/`.
- [ ] Any remaining visual/product defects are either fixed or split into a
      concrete follow-up task with file paths and reproduction steps.
- [ ] No Playwright/browser-substitute evidence is used for SmallKhoj UI
      acceptance.

## Non-Goals / Guardrails

- Do not kill unknown bridge/backend/frontend processes.
- Do not reset or clean the dirty worktree.
- Do not pull/push/merge/commit from this task.
- Do not treat lack of a tab as frontend completion.
- Do not dilute the parent scope: chat/task and mobile proof remain required
  before the parent Inkframe UI refactor is complete.
