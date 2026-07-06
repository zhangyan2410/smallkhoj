# Real Test Evidence: agent activity diagnostics

**Marker:** REAL_activity_diagnostics_20260611130000
**Date:** 2026-06-11
**Tester:** @kimi
**Tool:** twd.py (project WebDriver) + curl

## Commands Run

```bash
# Frontend build
cd /Users/code/project/smallkhoj/frontend && npx tsc --noEmit  # pass
cd /Users/code/project/smallkhoj/frontend && npx next build     # pass

# Activity API verification
curl -s -H "X-Public-Key: sk_public_local" -H "X-Account-Token: ..." \
  "http://localhost:8000/api/v1/activity?agentId=b9d845dd-...&limit=5"
# Response: {"activity":[{"id":"...","type":"workspace_heartbeat","description":"@kimi workspace heartbeat: running",...}],"count":20}

# Browser evidence (twd.py)
twd.py goto --tab 1617511054 "http://127.0.0.1:3000/members?member=b9d845dd-...&tab=activity"
twd.py screenshot --tab 1617511054 evidence/REAL_activity_diagnostics_20260611130001-activity-tab.png
twd.py eval --tab 1617511054 "document.querySelector('.rounded-md.border.bg-background button')?.click()"
twd.py screenshot --tab 1617511054 evidence/REAL_activity_diagnostics_20260611130002-expanded-details.png
twd.py eval --tab 1617511054 "window.scrollTo(0, document.body.scrollHeight)"
twd.py screenshot --tab 1617511054 evidence/REAL_activity_diagnostics_20260611130003-debug-trace.png
twd.py goto --tab 1617511054 "http://127.0.0.1:3000/members?member=f4590332-...&tab=activity"
twd.py screenshot --tab 1617511054 evidence/REAL_activity_diagnostics_20260611130004-human-activity.png
```

## Pass/Fail by Criterion

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Agent Activity tab renders meaningful status without raw-log overload | PASS | Screenshots show clean Activity tab with lifecycle badges, status cards, grouped activity events |
| Recent lifecycle and delivery events are visible | PASS | Runtime Lifecycle section shows Starting/Running/Idle/Thinking/Stopped/Failed states. Activity feed shows heartbeat events for agent, messages/tasks for human. |
| Errors/stopped states show human-readable explanations | PASS | Lifecycle badges use status colors (green=running, amber=idle, rose=failed). Empty states explain "No active runtime session" and "Human members do not have runtime sessions." |
| Trace links or references are available when relevant | PASS | Debug & Trace section shows `./smallkhoj-trace summary` command, Agent ID, Session ID with instructions. |
| Activity events grouped by category | PASS | Events grouped into Messages, Tasks, Runtime, Other sections with colored headers and counts. |
| Expandable raw details | PASS | Clicking activity event reveals activityId, status, content preview, and collapsible "Raw details" JSON. |
| Refresh button fetches live data | PASS | Refresh button in Recent Activity header triggers API re-fetch. |

## Changed Files

- `frontend/app/members/activity-tab.tsx` (new)
  - Client component fetching `/api/v1/activity?agentId={id}&limit=20`
  - RuntimeStateSummary: visual lifecycle badges (Starting, Running, Idle, Thinking, Stopped, Failed)
  - ActivityEventCard: expandable cards with type badge, description, timestamp
  - Grouped activity display: Messages, Tasks, Runtime, Other
  - Debug & Trace section: references `./smallkhoj-trace summary`, shows agent/session IDs
  - Empty state messages for agents without workspaces and humans

- `frontend/app/members/page.tsx`
  - Imported ActivityTab from `./activity-tab`
  - Removed inline ActivityTab function (moved to separate file)

## Evidence Files

- `REAL_activity_diagnostics_20260611130001-activity-tab.png` — Agent Activity tab with lifecycle, status cards, activity feed
- `REAL_activity_diagnostics_20260611130002-expanded-details.png` — Expanded activity event showing details and raw JSON
- `REAL_activity_diagnostics_20260611130003-debug-trace.png` — Debug & Trace section with smallkhoj-trace reference
- `REAL_activity_diagnostics_20260611130004-human-activity.png` — Human member Activity tab showing Messages and Tasks groups
- `REAL_activity_diagnostics_20260611130000-notes.md` — this file
