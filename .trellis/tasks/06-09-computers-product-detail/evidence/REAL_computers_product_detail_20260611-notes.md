# REAL_computers_product_detail_20260611 — Evidence Notes

Marker: `REAL_computers_product_detail_20260611`
Date: 2026-06-11

## Changed Files

- `frontend/app/computers/page.tsx` — Complete rewrite with selected-computer detail, runtime status chips, lifecycle controls, delete safety

## Implementation Summary

1. **Computer list view**: When no `?computer=` param, shows clickable rows via `<ComputerListRow>` with status dot, name, OS, daemon version, running/workspace counts, heartbeat time. Rows link to `?computer=<id>`.

2. **Computer detail view**: When `?computer=<id>` is present, shows `ComputerDetail` card with:
   - "← All computers" back link
   - Computer name with Monitor icon + StatusBadge
   - OS, daemon version, heartbeat, workspace count in description
   - 6-field info grid: computerId, machineId, serverId, apiKey, daemon, lease
   - Detected runtimes with `RuntimeStatusChip` showing installed/available/unknown states and color-coded icons
   - Agent workspaces table with Agent, Runtime, Status, PID, Session, CWD columns (added Session column)
   - Lifecycle controls panel: Reconnect (active), Scan workspaces / Stop all / Restart all / Reconcile (all disabled with "requires backend endpoint" titles)
   - Delete safety panel: rose-colored warning box explaining why deletion is unavailable, with workspace count constraint note

3. **RuntimeStatusChip**: New component that renders runtime entries with status-dependent coloring:
   - installed/available/active = emerald with Zap icon
   - not_installed/unavailable/missing = rose with XCircle icon
   - unknown/detecting = amber with Search icon
   - Plain string runtimes = neutral chip

4. **WorkspaceRow**: Extracted from inline to a reusable component, added Session column (shortId of sessionId).

5. **ComputerListRow**: New component rendering a clickable Card linking to `?computer=<id>`, with hover border effect and selected ring highlight.

6. **Preserved flows**: ConnectComputerForm, reconnect command, credential cookie handling all unchanged.

## Build/Type Check

```
cd frontend && npx next build
# ✓ Compiled successfully in 1434ms
# ✓ TypeScript passed
# ✓ All 11 routes generated
```

## Browser Evidence

| File | Description |
|------|-------------|
| `REAL_computers_product_detail_20260611-01-computers-list.png` | Computers page list view with "1 computer (select for detail)" |
| `REAL_computers_product_detail_20260611-02-computers-list-quick.png` | List view captured immediately after navigation |
| `REAL_computers_product_detail_20260611-03-computer-detail.png` | Selected computer detail with all sections |

## WebDriver DOM Text Assertions

- Computers list renders: "1 computer(select for detail)", "unregistered-computer", "在线", "darwin 24.5.0 arm64", "daemon 0.2.0", "6/6 running"
- Selected computer detail renders: "← All computers", "unregistered-computer", "在线", "6 workspaces (6 running)"
- Info grid fields: "c2b630e2" (computerId), "07b94a44" (machineId), "3893c518" (serverId), "sk_machine_GxE..." (apiKey), "cdf4d6c9" (daemon), lease timestamp
- Detected runtimes: "claude_code / available", "42 / available / deepseek-v4-pro", "Kimi / available / kimi-for-coding", "MiniMax / available / MiniMax-M3", "Zhipu GLM / available / glm-5.1", "cc / available / claude-sonnet-4-6"
- Agent workspaces: 6 rows with @cctv, @kimi, @glm1, @minimax, @REAL_provider_runtime, @REAL_members agents
- Lifecycle controls: Reconnect button active, Scan/Stop/Restart/Reconcile disabled

## API Cross-Check

- `GET /api/v1/computers` returns 1 computer (unregistered-computer, online)
- OS: darwin 24.5.0 arm64, daemon 0.2.0
- 8 detected runtimes (all claude_code with status=available, various models)
- 6 agent workspaces (all running, PIDs 36287-76552)
- Lease expires 2026-06-10T20:03:06, heartbeat 2026-06-10T20:01:36

## PRD Acceptance Criteria

- [x] Computers page can select a computer and render detail — `?computer=<id>` renders ComputerDetail with full info grid, runtimes, workspaces
- [x] Connect/reconnect commands still work and hide machine tokens from browser — ConnectComputerForm and reconnect form preserved unchanged; tokens stored in httpOnly cookies
- [x] Agent workspace rows show status, runtime, pid/session/cwd where available — 6-column table with Status, Runtime, PID, Session, CWD columns
- [x] Lifecycle controls are visible only when supported or clearly disabled with reason — Reconnect active; Scan/Stop/Restart/Reconcile disabled with title="... requires backend endpoint"
- [x] Real WebDriver + API/trace evidence verifies at least one connect/reconnect or runtime status path — Screenshots + DOM text + API cross-check captured

## Known Gaps

- **Lifecycle controls**: Stop, restart, reconcile, workspace scan are disabled placeholders. Backend does not expose these endpoints. Future backend work needed.
- **Delete**: Delete safety panel shows warning; actual delete endpoint does not exist.
- **SPA router redirect**: The chat page's client-side router aggressively redirects the shared browser tab away from /computers. Screenshots captured within 0.3-0.5s of navigation.
- **Runtime status colors**: All current runtimes report status=available. The not_installed/unknown color paths are implemented but not visually verifiable with current data.
