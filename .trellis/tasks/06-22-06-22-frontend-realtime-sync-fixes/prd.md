# Frontend Realtime Sync Fixes

## Goal

Fix the 3 known realtime sync gaps: new agent not appearing without refresh, DM/channel unread indicator not firing on new messages.

## Confirmed Decisions (design session 2026-06-22)

Known gaps:
1. Members page: new agent created → list doesn't update (missing `member.created` subscription)
2. DM/Channel sidebar: agent reply arrives → no unread indicator (covered partly in dm-channel-notifications task, but the SSE wiring is here)
3. Any other `RealtimeRefresh` event gaps found during audit

## Requirements

### Members page (`members/page.tsx`)

- Add `"member.created"` to `RealtimeRefresh` eventTypes array
- Verify `"member.updated"` and `"member.status.updated"` are already present (they are)

### Realtime event audit

- Read `lib/realtime-events.ts` and all `RealtimeRefresh` usages across pages
- For each page, list which events are subscribed vs which events that page logically cares about
- Fix any gaps found (missing subscriptions)

### SSE connection robustness

- Check `connectRealtimeEvents` in `lib/realtime-events.ts`: does it reconnect on disconnect?
- If not, add exponential backoff reconnect (max 30s delay, reset on successful message)

## Acceptance Criteria

- [ ] Creating a new agent on Members page → agent appears in list within 2s without manual refresh
- [ ] Agent status change → Members page updates within 2s without refresh
- [ ] Realtime audit doc or inline comment listing which events each page subscribes to
- [ ] SSE reconnects automatically after disconnect (backoff)
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] Browser check via `./twd`: create agent → appears; change status → updates

## Out of Scope

- Server-side push for DM unread counts (that's in dm-channel-notifications)
- WebSocket migration

## Dependencies

- None (can run in parallel with other tasks)
