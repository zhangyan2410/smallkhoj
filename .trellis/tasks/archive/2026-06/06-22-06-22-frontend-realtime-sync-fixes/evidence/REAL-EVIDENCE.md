# Real Test Evidence — Realtime Sync Fixes

> Task: `06-22-06-22-frontend-realtime-sync-fixes`
> Marker convention: `REAL_realtime_sync_<unix_ts>` / `REAL_TEST_AGENT_<unix_ts>`
> Date: 2026-06-22

## Environment

- Frontend: Next.js 16.2.4 dev server, `http://127.0.0.1:3000` (`allowedDevOrigins: ['127.0.0.1']`)
- Backend: uvicorn `main:app`, `http://127.0.0.1:8000`, DB `postgresql+asyncpg://...@127.0.0.1:55432/smallkhoj`
- Browser: project WebDriver `./twd` against Chrome tab `1617511467`
- Auth: `X-Public-Key: sk_public_local`

## Fixes applied (frontend + backend, cross-layer)

| # | Layer | File | Change |
|---|---|---|---|
| 1 | frontend | `app/members/page.tsx:799` | `RealtimeRefresh` now subscribes to `member.created` |
| 2 | frontend | `lib/realtime-events.ts` | SSE backoff cap raised 10s → 30s; reconnect loop already existed |
| 3 | frontend | `lib/realtime-events.ts` | Drop frames lacking `type`/`scope` before dispatch |
| 4 | frontend | `lib/realtime-events.ts` | `shouldHandleRealtimeEvent` returns `false` instead of throwing when `event.scope` is missing (fixes the `TypeError: Cannot read properties of undefined (reading 'kind')` spam from the dev log) |
| 5 | backend | `routers/public_api.py` | Added `supervisor_member_created` → `member.created` in `PUBLIC_ACTIVITY_EVENT_TYPES`; `member.created` → `member_created` legacy alias; `create_agent` now emits the event after commit |
| 6 | backend | `services/public_events.py` | `member.created` member-scope handler + identity alias |

### Cross-layer safety check (per `event-delivery-contracts.md`)

`member.created` is UI-only and must NOT reach an agent runtime. Verified by
reading the daemon proxy gate at `agent/daemon/aaa-daemon/src/daemon/daemon.ts`:

```
this.proxy.on('event_received', (data) => {
  if (eventType === 'message_received') return;
  if (!isRuntimeActionableEventType(eventType)) return;   // ← gates here
  this.deliverRuntimeMessage(data, 'proxy');
});
```

`isRuntimeActionableEventType` only allows `task_created` / `task.created` /
`thread_summary_requested`. `member.created` falls through and is dropped, so no
runtime receives it as a prompt. Token-safety contract preserved.

## Browser verification (`./twd`)

### Test: create agent → Members page auto-refreshes without manual reload

```
TAB=1617511467  URL=http://127.0.0.1:3000/members

Step 1 (before):  beforeHasMarker = false
Step 2 (create):  POST /api/v1/members/agents name=REAL_TEST_AGENT_1782145314
                  -> HTTP 200, createdId=2b7e9260-aca0-4995-826b-61e193b8665e
Step 3 (after 3s): afterHasMarker = true   ← auto-refresh observed, no reload
```

The new agent appeared in the Members page DOM within 3s of creation, driven by
the `member.created` SSE event → `RealtimeRefresh` → `router.refresh()` chain.
Backend log confirmed `GET /api/v1/events/stream HTTP/1.1 200 OK` (SSE live) and
no `member.created event emit failed` errors.

### Screenshots

- `evidence/01-members-initial.png` — Members page initial render (h1=Members)
- `evidence/02-members-after-auto-refresh.png` — Members page after agent auto-appeared

## Quality gates

- `npm run lint` — clean
- `npx tsc --noEmit` — clean
- `pytest tests/test_public_events.py tests/test_daemon_control.py` — 46 passed

## Test residue note

Two offline test agents (`REALTEST_SYNC_AGENT`, `REAL_TEST_AGENT_1782145314`)
remain in the DB. They were created via the public API key path, but
`DELETE /api/v1/members/{id}` requires a logged-in human actor
(`_resolve_human_actor(..., required=True)` at `public_api.py:2373`), which the
public-key-only test context cannot satisfy. They are offline (no runtime
started), harmless, and do not affect subsequent tasks. Cleanup via the Members
UI (logged-in session) is the proper path.
