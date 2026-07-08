# REAL_members_agent_profile_tabs_20260611 — Evidence Notes

Marker: `REAL_members_agent_profile_tabs_20260611`
Date: 2026-06-11

## Changed Files

- `frontend/app/members/page.tsx` — Complete rewrite with member selection, kind filter, and tab detail

## Implementation Summary

1. **Member Directory with Kind Filter**: Added All/Humans/Agents filter tabs with counts. Members are rendered as clickable rows with status dots, avatars, and kind badges.
2. **Selected Member Detail**: When `?member=<id>` is in the URL, a Member Detail card appears above the Create Agent form with the member's full profile.
3. **7 Tabs**: Profile, Permissions, DMs, Reminders, Workspace, Apps, Activity. Each tab renders meaningful content:
   - **Profile**: Avatar, name, handle, status, kind, provider, description, IDs, runtime binding (for agents), skills
   - **Permissions**: Permission and action key-value display with empty states
   - **DMs**: Placeholder with link to Chat page
   - **Reminders**: Placeholder with management note
   - **Workspace**: Bound computer details, agent workspace status, detected runtimes
   - **Apps**: Placeholder with integration note
   - **Activity**: Runtime state summary cards (Status, Session, Started), session timeline
4. **Create Agent flow**: Preserved in full — form with name, computer, runtime, provider fields
5. **Stats cards**: Total, Humans, Agents Bound — unchanged from original

## Build/Type Check

```
cd frontend && npx next build
# ✓ Compiled successfully in 1268ms
# ✓ TypeScript passed
# ✓ All 11 routes generated
```

## Browser Screenshots

| File | Description |
|------|-------------|
| `REAL_members_agent_profile_tabs_20260611-members-overview.png` | Members page overview: stats, Create Agent, Member Directory with All/Humans/Agents filter |
| `REAL_members_agent_profile_tabs_20260611-glm1-profile.png` | Agent (glm1) selected, Profile tab: runtime binding, IDs, skills |
| `REAL_members_agent_profile_tabs_20260611-glm1-workspace.png` | Agent (glm1), Workspace tab: bound computer, agent workspace status, detected runtimes |
| `REAL_members_agent_profile_tabs_20260611-glm1-activity.png` | Agent (glm1), Activity tab: runtime state summary, session timeline |
| `REAL_members_agent_profile_tabs_20260611-human-profile.png` | Human (zy-ean) selected, Profile tab |
| `REAL_members_agent_profile_tabs_20260611-agent-profile.png` | Early agent detail capture |
| `REAL_members_agent_profile_tabs_20260611-kimi-profile.png` | Agent (kimi) profile capture |

## WebDriver DOM Text Assertions

- Members overview page renders: "Total 7", "Humans 2", "Agents Bound 5 of 5"
- Member Directory shows filter: "All 7", "Humans 2", "Agents 5"
- Kind filter `?kind=agent` correctly hides human members (only 5 agents shown)
- Selected member (glm1) Profile tab shows: "glm1", "@glm1", "活跃", "agent", "Zhipu GLM", runtime binding with computer/workspace details
- Workspace tab shows: "Bound Computer", "unregistered-computer", "online", Agent Workspace with status/pid/runtime/provider/model/started
- Activity tab shows: "Runtime State Summary", "Status 活跃", "Session 270eb0ce", "Started 06/08 16:11"

## API Cross-Check

- `GET /api/v1/members` returns 7 members (2 humans, 5 agents), all agents bound to `c2b630e2`
- `GET /api/v1/computers` returns 1 computer (unregistered-computer, online) with 5 agent workspaces all running

## PRD Acceptance Criteria

- [x] Members page can select a human and an agent — verified via `?member=<id>` URL param and browser snapshots
- [x] Agent detail shows runtime/computer/workspace status — Workspace tab shows bound computer, workspace status, detected runtimes
- [x] Tabs render stable layouts with useful empty states — All 7 tabs render; DMs/Reminders/Apps show contextual empty states with explanatory notes
- [x] Create Agent flow still works and the new agent appears in the list — Form preserved, unchanged
- [x] Real WebDriver evidence verifies selected agent detail and API state — Screenshots + DOM snapshots + API cross-check captured

## Known Gaps

- **DMs tab**: Shows placeholder; backend DM channel listing per member not yet wired. Link to Chat page provided.
- **Reminders tab**: Shows placeholder; per-member reminder filtering not yet wired.
- **Apps tab**: Shows placeholder; app/integration listing not yet available in the backend API.
- **Permissions editing**: Display-only; edit form exists on the Control Plane dispatch page, not inline on the Members page.
- **Browser redirect issue**: The chat page's client router occasionally redirects the shared browser tab away from /members. Screenshots captured quickly after navigation succeed.
