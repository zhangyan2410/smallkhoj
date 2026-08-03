# Computer connect UX: auto-refresh after connect + multi-computer connect dialog

## Goal

Improve the `/computers` page connect flow:

1. **Auto-refresh after daemon connect** — after a user runs the connect command on a
   machine, the page must update automatically (no manual browser refresh).
2. **Multi-computer support with explicit dialogs** — the computers sidebar gets a
   persistent **Add** button so a user can connect additional computers even when one is
   already connected. The connect steps live in a **dialog** (not the inline card), and a
   **separate dialog** informs the user when the current machine is already connected.

## Background / current behavior

- `frontend/lib/computer-navigation.ts` `shouldShowConnectComputerForm` hides the
  connect form entirely once any computer exists — users cannot create a second computer
  from the UI.
- The connect form is an inline card (`connect-computer-form.tsx`); after generating a
  command it polls `router.refresh()` every 3 s, but once the form is hidden there is no
  path back.
- Backend `POST /internal/agent-api/daemon/connect` (agent_api.py:1556) creates the
  Computer row and commits, but emits **no** `computer.status.updated` SSE event (only
  `daemon/register` and `daemon/heartbeat` do, and only when status *changes*). This is
  the root cause of "must manually refresh": a fresh connect that keeps status
  `online` → `online` publishes nothing.
- Backend already supports N computers per server (`machine_id` scoped unique per
  server; connect raises 409 "Computer already has an active daemon" when the *same*
  machine reconnects while leased, and 409 on duplicate name).

## Requirements

### R1 — Auto-refresh after connect

- Emit a public SSE event (`computer.status.updated`, action `"connect"`) from
  `POST /daemon/connect` after commit, regardless of whether the status string changed.
- The existing `<RealtimeRefresh eventTypes=[..., "computer.status.updated", ...]>` on
  `/computers` then triggers `router.refresh()` automatically.
- Keep the existing 3 s polling in the connect dialog as a fallback.

### R2 — Sidebar Add button + steps dialog

- Add a persistent **Add / Connect computer** button in the computers list sidebar
  header (next to the count). Visible regardless of how many computers exist.
- Clicking it opens a **dialog** containing the connect steps: name input, generate
  command, copyable command block, pending/expiry info — i.e. today's
  `ConnectComputerForm` content moved into a `ui/dialog` based modal.
- The inline connect card may remain for the empty-state (0 computers) or be replaced by
  the same dialog; pick the simpler implementation and note it in implement.md.

### R3 — "Already connected" dialog (separate)

- When the **steps dialog is opened** and the frontend can determine the current
  server already has an online computer *and* the pending credential matches that
  computer (same name, status online/active), show a separate dialog stating
  "this computer is already connected" with options: **Keep current connection**
  (close) and **Connect a different computer** (proceed to steps dialog).
- The "already connected" dialog must not block connecting from a *different* machine:
  generating a new connect command always remains possible (backend supports it).

## Acceptance Criteria

- [ ] After running the connect command on a machine, the `/computers` page shows the
      new computer (or status change) without a manual browser refresh — verified via
      `./twd` with exact-tab URL/DOM evidence.
- [ ] With ≥1 computer already online, the sidebar still exposes an Add button that
      opens the connect-steps dialog, and a new connect command can be generated.
- [ ] When the pending credential's computer is already online, the separate
      "already connected" dialog appears with the two options above.
- [ ] `shouldShowConnectComputerForm` unit tests updated; new dialog visibility logic
      covered by unit tests where practical.
- [ ] Integration Gate contract tests still pass
      (`node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs`).

## Out of scope

- Changing the 409 conflict semantics in `daemon/connect` (name/lease conflicts stay).
- Cloud deployment verification (local-dev evidence only).

## Notes

- Keep the PRD short; implementation notes go to `implement.md` if needed.
- Evidence goes under `.trellis/tasks/08-03-computer-connect-ux/evidence/`.
