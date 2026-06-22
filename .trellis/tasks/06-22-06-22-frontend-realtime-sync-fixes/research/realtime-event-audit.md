# Realtime Event Subscription Audit

> Date: 2026-06-22 · Task: `06-22-06-22-frontend-realtime-sync-fixes`

Scope: every `RealtimeRefresh` usage in `frontend/app/**` and the SSE transport
in `frontend/lib/realtime-events.ts`.

## Transport (`lib/realtime-events.ts`)

`connectRealtimeEvents` already implements a reconnect loop:

- `while (!stopped && !signal.aborted)` — reconnects until the outer signal aborts.
- `attempt = 0` reset after the HTTP response is `ok`, so the backoff only grows
  across consecutive failures.
- Backoff: `min(1000 * 2 ** min(attempt, 5), CAP)` ms. **CAP raised from 10000
  to 30000** in this task (PRD requirement: "max 30s delay").
- Status callbacks: `connecting` → `connected` → `disconnected` (clean) or
  `error` → `reconnecting` (with the computed delay) → loop again.

High-water-mark dedup (`applyHighWater`) is per-`scopeKey`; duplicate frames
inside the same epoch are dropped.

## Page subscriptions

| Page | File:Line | Subscribed events | Gap? | Fix |
|---|---|---|---|---|
| Members | `app/members/page.tsx:799` | `member.created`, `member.updated`, `member.status.updated` | **yes — `member.created` was missing** | Added `member.created` |
| Tasks | `app/tasks/page.tsx:588` | `task.created`, `task.updated` | none | — |
| Computers | `app/computers/page.tsx:668` | `workspace.updated`, `runtime.updated`, `computer.status.updated`, `member.status.updated` | none (status passthrough covers members) | — |

## Extra gap found from dev log

The Next dev log repeatedly showed:

```
[realtime] malformed event dropped {}
TypeError: Cannot read properties of undefined (reading 'kind')
  at shouldHandleRealtimeEvent (lib/realtime-events.ts:106:19)
```

Root cause: some backend SSE frames arrive as `{}` or without a `scope` field.
`JSON.parse("{}")` succeeds and produced an envelope with `scope === undefined`,
which then crashed `shouldHandleRealtimeEvent` when channel-client.tsx called it.

Fixes applied in this task (defense in depth):

1. `connectRealtimeEvents` now drops any frame whose parsed payload lacks
   `type` or `scope` before dispatching to `onEvent`. Heartbeats and empty
   keepalives no longer reach the consumer.
2. `shouldHandleRealtimeEvent` now returns `false` when `event.scope` is
   missing instead of throwing, so a future shape regression degrades to a
   sidebar refresh rather than a runtime crash.

## Channel / DM chat pages

Channel chat (`app/chat/[channel]/channel-client.tsx`) and DM surfaces do not
go through `RealtimeRefresh`. They drive their own SSE consumption via
`connectRealtimeEvents` directly (refresh on new messages is handled in-place,
not via `router.refresh()`). DM unread indicator wiring is the responsibility
of task `06-22-06-22-frontend-dm-channel-notifications`.

## Event types referenced in the codebase

Found by scanning backend event emitters and frontend handlers. The members
page now subscribes to all `member.*` types that the backend emits; no other
page subscribes to `member.created`, which is correct (only Members page
renders the list).

## Acceptance mapping

- [x] Members page subscribes to `member.created` → new agent appears without refresh
- [x] `member.status.updated` already subscribed → status change refreshes
- [x] This audit doc lists per-page subscriptions
- [x] SSE reconnects with exponential backoff, capped at 30s
- [x] Backend emits `member.created` on agent create (gap found during audit; fixed cross-layer)
- [x] `npm run lint` and `npx tsc --noEmit` pass
- [x] `pytest tests/test_public_events.py tests/test_daemon_control.py` pass (46)
- [x] Browser check via `./twd`: create agent → appears within 3s, no reload (see `evidence/REAL-EVIDENCE.md`)
