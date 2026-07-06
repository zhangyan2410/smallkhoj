# Implementation Plan: Inkframe Browser Connection Recovery And Mobile Proof

## Phase 0: Preflight

1. Confirm worktree and branch:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui
rtk git status --short --branch
```

2. Read required guidance:

```bash
rtk sed -n '1,220p' .agents/skills/project-webdriver-cli/SKILL.md
rtk sed -n '1,220p' .trellis/spec/frontend/quality-guidelines.md
rtk sed -n '1,260p' .trellis/spec/frontend/product-ui-style.md
```

3. Create evidence directory:

```bash
rtk mkdir -p .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/screenshots
```

## Phase 1: Recover Connected Tab

1. Record current state:

```bash
rtk ./twd --compact tabs
rtk ./twd --compact ext tabs
rtk ./twd --compact groups list
```

2. If still no connected tab, record:

```bash
rtk lsof -nP -iTCP:18765 -sTCP:LISTEN
rtk lsof -nP -iTCP:18766 -sTCP:LISTEN
rtk lsof -nP -iTCP:3000 -sTCP:LISTEN
rtk lsof -nP -iTCP:8000 -sTCP:LISTEN
```

3. Do not launch Chrome unless the user explicitly approves. If approved or the
   user opens Chrome manually, rerun:

```bash
rtk ./twd --compact tabs
```

4. Write `evidence/browser-recovery.md` with:

- commands run;
- exact JSON output;
- whether the connected-tab state recovered;
- if not recovered, the precise blocker.

## Phase 2: Authenticated Navigation

Only proceed if `./twd --compact tabs` shows a connected tab.

```bash
rtk ./tools/twd-guard/twd-auth zy-ean
rtk ./tools/twd-guard/twd-open /chat
rtk ./tools/twd-guard/twd-open /tasks
```

For every `twd-open`, record returned tab id and URL/path.

## Phase 2.5: Canonical Selector Proof Runner

After a connected tab exists and guarded navigation works, run the reusable
Inkframe proof runner. This is the canonical selector-based acceptance gate for
product shell, chat desktop/mobile, chat unread/event markers, task
desktop/mobile, and material state.

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

Expected behavior:

- exit `0` only when selector proof passes;
- exit `2` and write `blocked_no_tab` evidence when no connected tab exists;
- exit `1` for route/selector/tool failures;
- write `evidence/twd-inkframe-proof.json` and
  `evidence/twd-inkframe-proof.md` under this task directory.

If this runner fails, do not claim browser/mobile acceptance. Use the later
manual screenshot/snapshot phases only to diagnose or add visual evidence after
the selector proof result is understood.

## Phase 3: Desktop Chat Evidence

1. Open chat:

```bash
rtk ./tools/twd-guard/twd-open /chat
```

2. Save a snapshot:

```bash
rtk ./twd snapshot --url-match 127.0.0.1:3000/chat --out .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/chat-desktop.snapshot.txt
```

3. Save DOM assertion JSON with a compact `eval`:

```bash
rtk ./twd --compact eval --url-match 127.0.0.1:3000/chat "return { url: location.href, path: location.pathname, width: innerWidth, height: innerHeight, messages: document.querySelectorAll('[data-object=\"chat-message\"], [data-message-id]').length, sideEntities: document.querySelectorAll('[data-object=\"sidebar-entity\"], [data-channel-id], [data-dm-id]').length, actionButtons: document.querySelectorAll('[data-object=\"message-actions\"], [data-slot=\"message-actions\"]').length, unreadMarks: document.querySelectorAll('[data-object=\"event-badge\"], [data-unread=\"true\"], [data-slot=\"unread-mark\"]').length, backgroundLayers: document.querySelectorAll('[data-object=\"app-desk-background\"], [data-slot=\"desk-background\"], .inkframe-app-desk').length, horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, activeCanvases: document.querySelectorAll('[data-slot=\"material-canvas\"][data-mode=\"active\"], canvas[data-material-active=\"true\"]').length }"
```

4. Save screenshot:

```bash
rtk ./twd screenshot --url-match 127.0.0.1:3000/chat .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/screenshots/chat-desktop.png
```

## Phase 4: Desktop Task Evidence

Repeat the pattern for `/tasks`:

```bash
rtk ./tools/twd-guard/twd-open /tasks
rtk ./twd snapshot --url-match 127.0.0.1:3000/tasks --out .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/tasks-desktop.snapshot.txt
rtk ./twd --compact eval --url-match 127.0.0.1:3000/tasks "return { url: location.href, path: location.pathname, width: innerWidth, height: innerHeight, tickets: document.querySelectorAll('[data-object=\"task\"], [data-object=\"task-ticket\"], [data-task-id]').length, evidence: document.querySelectorAll('[data-object=\"evidence\"], [data-slot=\"evidence-surface\"]').length, review: document.querySelectorAll('[data-object=\"review\"], [data-slot=\"review-markup\"]').length, backgroundLayers: document.querySelectorAll('[data-object=\"app-desk-background\"], [data-slot=\"desk-background\"], .inkframe-app-desk').length, materialLayers: document.querySelectorAll('[data-slot=\"task-material-layer\"], [data-object=\"material-surface\"]').length, horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, activeCanvases: document.querySelectorAll('[data-slot=\"material-canvas\"][data-mode=\"active\"], canvas[data-material-active=\"true\"]').length }"
rtk ./twd screenshot --url-match 127.0.0.1:3000/tasks .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/screenshots/tasks-desktop.png
```

## Phase 5: Mobile Evidence

Use available `./twd` viewport or Chrome/CDP path documented by the project
wrapper. Record the exact command. Target phone viewport:

```text
390 x 844
```

Then collect chat and tasks DOM JSON and screenshots. Assertions must include:

- actual viewport width/height;
- horizontal overflow;
- visible composer or task action controls;
- message/task counts;
- material pointer mode if exposed.

If resizing is unavailable, record that no mobile proof was collected.

## Phase 6: Material Runtime Proof

On desktop and mobile where possible:

1. Query active/static material surfaces.
2. If a visible material toggle is available, click it with `./twd act` or
   `./twd click`.
3. Re-query active canvas count.
4. Verify active count remains bounded.
5. If keep/re-render controls are product-exposed, run them and record tint and
   position observations.

Do not force private implementation APIs unless the UI exposes a test hook.

## Phase 7: Fix Narrow Defects

If the browser proof reveals a product bug:

1. Write a failing or descriptive evidence note first.
2. Fix the smallest relevant component/CSS.
3. Re-run the same DOM/screenshot evidence.
4. Run relevant frontend checks:

```bash
cd /Users/code/project/smallkhoj-inkframe-object-ui/frontend
rtk npm run lint
```

Adjust if `package.json` defines a different canonical check.

## Phase 8: Review

Spawn a check agent:

```bash
rtk trellis channel create cr-07-06-inkframe-browser-connection-mobile-proof \
  --task .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --by codex-main \
  --cwd /Users/code/project/smallkhoj-inkframe-object-ui

rtk trellis channel spawn cr-07-06-inkframe-browser-connection-mobile-proof \
  --agent check \
  --provider codex \
  --as check-browser-proof \
  --file .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/prd.md \
  --file .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/design.md \
  --file .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/implement.md \
  --file .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof/evidence/browser-recovery.md \
  --file .agents/skills/project-webdriver-cli/SKILL.md \
  --file .trellis/spec/frontend/quality-guidelines.md \
  --file .trellis/spec/frontend/product-ui-style.md \
  --cwd /Users/code/project/smallkhoj-inkframe-object-ui \
  --timeout 20m
```

Ask the reviewer to verify evidence truthfulness and whether remaining frontend
claims are unsupported.

## Definition Of Done

- Connected `./twd` tab recovered or exact blocker recorded.
- Selector-driven proof runner executed under this task and its result recorded
  as pass/fail/blocked.
- Real authenticated chat/task evidence collected if connected.
- Mobile proof collected only if viewport is actually phone-sized.
- Material runtime DOM state recorded.
- Any newly discovered visual regressions are fixed or split into a concrete
  Trellis follow-up.
- Check-agent review completed, or provider failure is recorded and main-agent
  self-review performed.
