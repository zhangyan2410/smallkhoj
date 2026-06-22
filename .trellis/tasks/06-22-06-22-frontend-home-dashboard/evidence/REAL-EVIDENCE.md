# Real Test Evidence — Home Page Dashboard Workbench

> Task: `06-22-06-22-frontend-home-dashboard`
> Date: 2026-06-22 (system clock)

## Changes

All in `frontend/app/page.tsx`:

1. Replaced the search-centric layout (4 stat cards + Chat Spaces + Activity
   Inbox + Saved) with a **dashboard workbench**:
   - Brand header using `bg-gradient-brand bg-clip-text` + greeting
     (`你好，{name} 👋`) from the session account.
   - 3-column responsive grid (`lg:grid-cols-3`, stacks on mobile).
2. **Recent Messages** card (wide, `lg:col-span-2`): filters the activity feed
   for `message_sent` rows, shows sender + #channel + preview + time, links to
   the channel.
3. **Active Agents** card: agents in ACTIVE/THINKING/STARTING buckets via
   `getStatusBucket`, count chip, each row links to that agent's DM and shows
   `getStatusLabel`.
4. **Pending Tasks** card: open + in_progress counts as colored chips, list of
   pending tasks with number/title/status, link to `/tasks`.
5. **Workspace** card: condensed stats (channels, agents, computers online,
   saved) replacing the old 4-card stat row.
6. Kept the inline global search (search results render when `?q=` is present).
7. Added `RealtimeRefresh` subscribing to `member.status.updated`,
   `member.updated`, `message.created`, `task.created`, `task.updated` so the
   dashboard stays live.
8. Removed now-unused `activityIcon` / `activityColor` / `filteredActivity` /
   `activityFilter` + `Eye`/`AtSign`/`Bell` icon imports.

## Browser verification (`./twd`)

```
TAB=1617511467  URL=http://127.0.0.1:3000/

gradientBrand : true, brandText: "SmallKhoj"      ← gradient clip text renders
greeting      : "你好，zy-ean 👋"                  ← session greeting renders
cardTitles    : ["Recent Messages","Active Agents","Pending Tasks","Workspace"]

Panel content:
  recentMsgRows    : 9 (8 message rows + header link)
  activeAgentRows  : 0   (empty state, all agents offline)
  taskChips        : ["0 open","0 in progress"]
  wsStats          : "Channels 1 Agents 5 Computers online 0 Saved items 0"
```

### Active Agents panel populated (temp state)

After temporarily extending `local-mac` lease + setting minimmm `running`
(ACTIVE bucket) and reloading:

```
activeAgentRows : 1
content         : "Active Agents 1 minimmm 运行中"
```

Count chip `1`, agent name `minimmm`, status label `运行中`. Test state
restored (agent back to offline, lease trimmed) after the check.

### Screenshots

- `evidence/01-dashboard.png` — full dashboard with all 4 cards

## Quality gates

- `npm run lint` — clean
- `npx tsc --noEmit` — clean (resolved `displayName` undefined → fallback to
  `name` for the agent DM link)

## Notes

- Recent Messages reuses the existing `/api/v1/activity` feed filtered to
  `message_sent` rows. A dedicated recent-messages endpoint is out of scope
  (PRD allowed reuse).
- Pending Tasks counts use exact `open` / `in_progress` statuses per PRD.
