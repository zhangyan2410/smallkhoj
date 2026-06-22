# Real Test Evidence — DM/Channel Unread + Active Agents Panel

> Task: `06-22-06-22-frontend-dm-channel-notifications`
> Date: 2026-06-22 (system clock)

## Environment

- Frontend: Next.js 16.2.4 dev, `http://127.0.0.1:3000` (session cookie `smallkhoj_session` present)
- Backend: uvicorn `main:app`, `http://127.0.0.1:8000`
- Browser: `./twd` tab `1617511467`
- Auth: session cookie (cookie-credentialed fetch for message post), `X-Public-Key` for GET

## Changes

All in `frontend/app/chat/[channel]/channel-client.tsx`:

1. Imported `getAgentColor`, `getStatusBucket`, `getStatusLabel` from the
   existing `lib/agent-color` + `lib/agent-status` modules (no new logic written).
2. Added `unreadCounts` in-memory state keyed by channel/DM id.
3. Realtime handler increments `unreadCounts[event.scope.id]` on
   `message.created` for the non-viewed conversation; existing
   `member.status.updated` branch now also calls a new `refreshAllMembers`
   callback so the active panel stays live over SSE.
4. Navigation clears the unread counter for the destination (inline in
   `loadChannel`, avoiding the `react-hooks/set-state-in-effect` lint rule).
5. Channel list item: subtle `size-1.5 bg-primary` dot on unread (no count);
   the `ch` suffix hides when unread.
6. DM list item: red count badge (`bg-red-500`, `99+` clamp) + `font-semibold`
   name + agent identity-color left stripe (2px) via `getAgentColor`.
7. Active agents panel: renders below the DM list when any agent's bucket is
   ACTIVE/THINKING/STARTING. Shows title `运行中` + count chip + one row per
   agent (`MemberAvatar` xs + name + `getStatusLabel`). Auto-hides when none.

## Browser verification (`./twd`)

### 1. DM unread badge + clear-on-navigate

Posted a marker message to the minimmm DM (`REAL_UNREAD_1782146007`) while
viewing `#general`:

```
DM link "minimmm" after post:
  hasUnreadBadge = true
  badgeText      = "1"
  fontWeight     = "...font-semibold...border-l-primary/40..."   ← bold + agent stripe
```

Navigated to that DM:

```
DM link "minimmm" after navigate:
  hasBadge = false
  isActive = true
```

Badge cleared on navigation. ✅

### 2. Channel unread dot (low density)

Posted `REAL_CHDOT_1782146066` to `#ccc` while viewing `#general`:

```
#ccc link after post:
  hasUnreadDot = true
  dotClass     = "ml-auto size-1.5 rounded-full bg-primary"   ← dot, no count
```

No count badge, no bold — matches the "low density" spec. ✅

### 3. Active agents panel

`serialize_member` forces `offline` for agents whose computer's daemon lease
is expired (`member_serialization.py:79-80`), so the panel only appears for
agents with a live lease. To exercise the panel path, temporarily extended
`local-mac` lease + set minimmm status `running` (ACTIVE bucket), then
reloaded `#general`:

```
sidebarHeadings: [..., "DMs", "运行中", "Members Online", ...]
runningPanelPresent = true
countChipText        = "1"
panelText            = "运行中 1 minimmm 运行中"
hasMinimmm           = true
```

Panel appeared with count chip `1`, the agent row, and the `getStatusLabel`
status `运行中`. Test state (agent status + lease) restored to original after
the check. With all agents offline, the panel correctly hides (verified before
the state change). ✅

### Screenshots

- `evidence/01-active-panel.png` — sidebar showing the 运行中 panel

## Quality gates

- `npm run lint` — clean (resolved `react-hooks/set-state-in-effect` by inlining
  the clear into the navigation flow instead of an effect)
- `npx tsc --noEmit` — clean

## Notes

- `unreadCounts` is intentionally in-memory (resets on reload) — persistence is
  out of scope per the PRD.
- The active-panel realtime path relies on `refreshAllMembers`, which I added
  to the `member.status.updated`/`member.updated` SSE branch (previously only
  `refreshChannelsAndDms` + `refreshMembers` ran; `allMembers` was only fetched
  on initial load, so the panel would have gone stale).
