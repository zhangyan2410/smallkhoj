# Inkframe TWD Evidence And HTTP Cursor Harness

## Goal

Run the next optimization loop for the Inkframe product UI refactor:

1. recover truthful real-browser `./twd` evidence for chat, tasks, and mobile;
2. add a full authenticated HTTP route-flow test harness for backend chat read
   cursors, beyond handler-level fake-session tests;
3. keep the current Inkframe product direction stable while hardening evidence.

This task is a child of `07-05-inkframe-product-ui-refactor`. It exists because
the previous loop reached code-level pass and review, but still had two hard
truth gaps:

- no connected `./twd` tab, so browser/mobile acceptance cannot be claimed;
- read-cursor tests prove route-handler flow, but not full ASGI authenticated
  HTTP behavior.

## Current Evidence

From `07-06-inkframe-browser-mobile-backend-hardening`:

- `./twd --compact tabs` returns `{"ok": true, "tabs": [], "count": 0}`.
- The WebDriver bridge is listening on `127.0.0.1:18765` / `18766`.
- The frontend is listening on `127.0.0.1:3000`.
- The backend is listening on `:8000`.
- Chrome is installed.
- The Codex Chrome Extension is installed and enabled.
- The native host manifest is correct.
- Chrome itself was not running during diagnosis.

Backend state from the previous loop:

- route-handler-level read cursor tests exist for channel, DM, thread, and GET
  list projection;
- they call `public_api.update_chat_read_cursor(...)` and
  `public_api.get_chat_read_cursors(...)`;
- they are explicitly not full HTTP/TestClient route-flow tests.

## Requirements

### R1. Recover Or Precisely Block `./twd` Browser Evidence

Use the project WebDriver wrapper only:

```bash
rtk ./twd --compact tabs
```

If no tab is connected, collect a precise blocker record:

- bridge process and ports;
- frontend/backend listening state;
- Chrome running state;
- Chrome extension installed/enabled state;
- native host manifest state;
- whether user permission is required to launch Chrome;
- exact command outputs.

Do not claim browser or mobile acceptance without a connected `./twd` tab.

If Chrome is not running, follow Chrome-control safety rules: ask the user before
launching Chrome. If permission is not available in the current turn, continue
backend hardening and leave browser proof pending.

### R2. Real Browser Proof When A Tab Is Available

Once a connected tab exists, prove the real app with `./twd`, not Playwright:

- authenticate through `tools/twd-guard`;
- open `/chat` or `/chat/[channel]`;
- open `/tasks`;
- save DOM JSON and screenshots under this task's `evidence/`;
- verify the tab URL in each command result before accepting evidence.

Required browser assertions:

- `data-region="app-desk-background"` exists on product routes;
- old pink/dark/dirty route backgrounds do not reappear;
- chat exposes message material toggles;
- activating one message creates exactly one active message material canvas in
  `chat-main`;
- activating another message deactivates the previous one;
- tasks expose task material toggles in board/list/detail contexts;
- `/tasks?task=<id>` starts static until an explicit paintbrush toggle;
- explicit task toggle creates exactly one active task material canvas in
  `task-main`.

### R3. Mobile 390px Proof

At a representative phone width:

- chat has no document-level horizontal overflow;
- task has no document-level horizontal overflow;
- chat composer remains visible and usable;
- task controls remain visible and not clipped;
- material canvas pointer capture is off until explicit draw/water mode;
- evidence includes DOM measurements and, where useful, screenshots.

### R4. Full Authenticated HTTP Read Cursor Harness

Add backend tests that cross the actual ASGI route boundary rather than calling
route handler functions directly.

The harness must prove:

- authenticated account/member context is established;
- active server context is honored;
- channel cursor POST persists and GET returns it;
- DM cursor POST persists and GET returns it;
- thread cursor POST persists and GET returns it;
- older/retrograde cursor writes do not overwrite newer cursor state;
- server/member scoping prevents cross-server or cross-member leaks;
- channel/DM kind mismatches reject with an HTTP error;
- unread count/projection uses actual newer message rows rather than raw global
  sequence gaps.

If the current public API auth fixture is insufficient, add the smallest
reusable test harness piece needed. Do not fall back to source-text assertions
for the main acceptance path.

### R5. Preserve Product Direction

This is an evidence and backend hardening loop, not a redesign loop.

Allowed UI changes:

- selector/data-slot additions needed for truthful `./twd` assertions;
- small overflow/focus/accessibility fixes revealed by browser/mobile proof;
- small material activation bugs revealed by browser/mobile proof.

Not allowed:

- new theme direction;
- decorative redesign of members/computers/settings;
- backend/localStorage/IndexedDB persistence for large ink/material blobs;
- replacing `./twd` with Playwright for repo UI evidence.

## Acceptance Criteria

- [ ] `./twd --compact tabs` has a connected tab, or a precise blocker is
      documented with Chrome/extension/native-host/port state and no fake
      browser acceptance claims.
- [ ] If Chrome launch is needed, user permission is requested before launch.
- [ ] Browser evidence for chat is saved when a tab is available.
- [ ] Browser evidence for tasks is saved when a tab is available.
- [ ] Mobile 390px DOM measurement evidence is saved when a tab is available.
- [ ] Browser assertions prove one-active-message-material behavior.
- [ ] Browser assertions prove one-active-task-material behavior for
      board/list/detail contexts.
- [ ] Backend HTTP tests cover authenticated channel, DM, and thread cursor
      POST + GET.
- [ ] Backend HTTP tests cover cursor monotonicity.
- [ ] Backend HTTP tests cover server/member scoping.
- [ ] Backend HTTP tests cover channel/DM mismatch rejection.
- [ ] Backend HTTP tests cover unread projection with global sequence gaps.
- [ ] Frontend typecheck, lint, and tests pass.
- [ ] Backend cursor/account/HTTP route tests and compile pass.
- [ ] `git diff --check` passes.
- [ ] A Trellis channel review or explicit self-review records remaining gaps.

## Out Of Scope

- Cross-restart persistence for ink/material images.
- Backend storage of large material blobs.
- IndexedDB/localStorage storage for large material blobs.
- Full notification center.
- New object-language redesign beyond evidence-driven fixes.
