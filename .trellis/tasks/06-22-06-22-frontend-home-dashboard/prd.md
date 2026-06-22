# Frontend Home Page — Dashboard Workbench

## Goal

Replace the current home page (search + static channel list + empty states) with a real workbench dashboard: active agents, recent messages, pending tasks — all at a glance. First impression for promo video.

## Confirmed Decisions (design session 2026-06-22)

- Home = Dashboard / workbench, not a search page
- Key panels: active agents, recent activity, pending tasks
- Visual style: data cards + status animations, not admin tables

## Requirements

### Layout

- 3-column grid on desktop, single column on mobile:
  - Left (wide): Recent Messages feed + Quick Compose
  - Center: Active Agents panel
  - Right: Pending Tasks summary

### Active Agents Panel

- List all agents where status bucket is ACTIVE / THINKING / STARTING
- Each entry: `MemberAvatar` + name + status label + status animation
- "No active agents" empty state when none running
- Links to the DM for that agent

### Recent Messages Feed

- Last N messages across all channels/DMs the current user is a member of
- Each entry: channel/DM name, sender avatar, message preview (truncated), time
- "Open" link navigates to that channel

### Pending Tasks Summary

- Tasks with status `open` or `in_progress` assigned to current user or any agent
- Count chip per status
- Link to `/tasks`

### Page Header

- Product name + tagline using gradient text (`bg-clip-text` with `--gradient-brand`)
- Current user greeting (e.g. "你好，{name}")

### Data Fetching

- Server component, fetch in parallel: members, recent messages (new API endpoint or reuse existing), tasks
- Add `RealtimeRefresh` for `member.status.updated`, `message.created`, `task.updated`

## Acceptance Criteria

- [ ] Home page shows active agents panel with live status
- [ ] Recent messages panel shows last messages across channels
- [ ] Pending tasks summary links to tasks page
- [ ] Page header uses gradient text
- [ ] Responsive: works on mobile (single column)
- [ ] Realtime refresh on member status and new messages
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] Browser check via `./twd`

## Out of Scope

- Full search functionality redesign
- Notification inbox
- Settings from home

## Dependencies

- `06-22-frontend-visual-redesign-theme`
- `06-22-frontend-agent-status-system`
