# Frontend DM & Channel Unread Notifications + Active Agents Panel

## Goal

1. Show unread message indicators in the chat sidebar for DMs and channels
2. Show a bottom "active agents" panel in the DM sidebar when ≥1 agent is running
3. Fix real-time: subscribe to `member.created` on Members page

## Confirmed Decisions (design session 2026-06-22)

- **DM unread**: count badge (red pill) + bold name + colored left stripe
- **Channel unread**: low-density — subtle dot only, no count badge (avoid notification anxiety in multi-person channels)
- **Active agents panel**: below DM list, shows each running agent (avatar + name + current status label + animation), auto-hides when none active
- Future: activity push for @mentions / own tasks is a separate feature

## Requirements

### Unread state tracking

- Add client-side unread counter per channel/DM: increment when a realtime `message.created` event arrives for a channel that is NOT currently viewed
- Store in `useRef` map (not persisted to localStorage — resets on page load is acceptable for now)
- Reset counter when user navigates to that channel

### DM list item (in `channel-client.tsx` sidebar)

- Show red count badge (`bg-red-500 text-white text-[10px] rounded-full px-1.5`) when unread count > 0
- Bold the DM name when unread > 0
- Colored left bar (2px, using agent's identity color) when the DM peer is an agent with unread messages

### Channel list item

- Show a small filled circle (`size-1.5 bg-primary rounded-full`) to the right of channel name when unread > 0
- No count badge, no name bolding

### Active Agents Panel

- Render at the bottom of the left sidebar (below DM list), inside `channel-client.tsx`
- Title: "运行中" with count chip
- List each agent where `member.status` is in ACTIVE or THINKING or STARTING bucket (from `agent-status.ts`)
- Each row: `MemberAvatar` (xs, showStatus=true) + agent name + status label from `getStatusLabel()`
- Entire panel is hidden (`hidden`) when no agents match
- Panel receives realtime `member.status.updated` events via the existing SSE path to stay current

### Members page realtime fix

- In `members/page.tsx`, `RealtimeRefresh` currently subscribes to `["member.updated", "member.status.updated"]`
- Add `"member.created"` to the event types so a newly created agent appears without a manual refresh

## Acceptance Criteria

- [ ] DM with unread messages shows count badge + bold name
- [ ] Channel with unread shows dot only (no count)
- [ ] Navigating to a DM/channel clears its unread indicator
- [ ] Active agents panel appears below DM list when ≥1 agent is ACTIVE/THINKING/STARTING
- [ ] Panel hides automatically when no agents are active
- [ ] Panel updates in realtime via SSE (no manual refresh needed)
- [ ] New agent created on Members page appears in the list without refresh
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] Browser check via `./twd`

## Out of Scope

- Persistent unread counts (localStorage / server-side)
- @mention push notifications (separate feature)
- Channel-scoped agent sessions (separate backend task)

## Dependencies

- `06-22-frontend-agent-status-system` (for bucket mapping + `getStatusLabel`)
- `06-22-frontend-visual-redesign-theme` (for `--agent-color-*` stripe)
