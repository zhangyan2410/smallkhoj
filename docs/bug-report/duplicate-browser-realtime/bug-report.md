# Duplicate browser realtime ownership and broad invalidation

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | `RealtimeRefresh` is mounted by multiple pages/components and each mount starts its own physical authenticated SSE fetch loop. Matching events debounce into `router.refresh()`, often refetching an entire route tree. Expected: one transport per auth/active-Server browser scope, generation-safe reconnect/scope switching, and event-specific projections/invalidation. |
| **2. Evidence** | `frontend/lib/realtime-events.ts:connectRealtimeEvents` creates a new streaming fetch loop for every caller. `frontend/components/realtime-refresh.tsx` owns that connection per mount and calls `router.refresh()`. Mounts exist on dashboard, tasks, members, computers, and integration pages. Advisor plan 022 changes callback ownership but retains per-component transports and a `router.refresh()` fallback, so it does not meet one-connection or targeted-invalidation terminal contracts. |
| **3. Confirmed root cause** | Transport lifecycle is owned by leaf refresh components instead of the authenticated active-Server shell. Event filtering, high-water state, reconnect generation, and data invalidation are coupled inside each mount, so duplication and broad refresh are the default. |
| **4. Diagnostic strategy** | Count physical stream factory calls across several subscribers, route changes, auth/server switches, reconnects, and unmounts. Inject one event and count application/invalidation calls. Inventory event-to-data dependencies and preserve chat domain state ownership while moving only transport/high-water ownership to a provider. |
| **5. Timeout strategy** | If no common authenticated active-Server shell exists, introduce the narrowest provider boundary that spans the audited pages. Stop before rewriting chat state or converting unrelated server components solely to satisfy the transport change. |
| **6. Warning strategy** | Reject one stream per subscriber, stale generation callbacks after scope change, duplicate apply on reconnect, unspecified `router.refresh()` fallback, task events that refresh unrelated member/computer data, or a provider that rewrites chat domain semantics. |
| **7. User-visible correction** | Realtime updates remain live while reducing duplicate network streams and page-wide refetch flicker; task changes update task data without forcing unrelated panels to reload. |
| **8. Acceptance** | Frontend tests prove multiple subscribers share one physical stream, each event applies once, auth/server switch closes the old generation, unmount tears down the owner, task events invalidate only task data, and unrelated events do not trigger a full route refresh. Runtime/UI evidence uses project `./twd`. |

## Report

- **Reporter:** Independent re-audit of finding 022 and runtime dependency on 2026-07-23.
- **Reproduction:** Mount several `RealtimeRefresh` consumers, observe stream factory/network counts, emit a task event, and record route/data refetches across scope switches.
- **Root cause:** Leaf components own a process-wide transport concern and use route refresh as the universal projection.
- **Repair direction:** Move the SSE transport/high-water generation into an authenticated active-Server provider and let consumers subscribe to typed projections/targeted invalidation.
- **Verification:** Frontend lifecycle/projection tests and `./twd` network/marker evidence in the delivery/UI phase.

## Advisor disposition

- Plan 022 correctly identifies the cost of unconditional `router.refresh()` and recommends targeted client refetch.
- Its proposed `RealtimeRefresh` callback still leaves one physical stream per mount and is therefore incomplete.
- The backward-compatible `onEvent === undefined -> router.refresh()` fallback is rejected as the terminal contract for audited pages.
- The remediation consolidates transport ownership only; broad chat-state redesign remains out of scope.

## TDD evidence

### RED

The source/lifecycle RED found physical transport creation in every mounted
`RealtimeRefresh`, plus independent calls from `TaskBoard`, `TaskMemoryInline`,
and `ChannelClient`. Multiple subscribers therefore created multiple streaming
fetch loops, and a matching task event selected the generic `router.refresh()`
path instead of task-data invalidation. The new owner-sharing and sole-factory
assertions failed against that inventory for the intended ownership reason.

### GREEN

`RealtimeProvider` is mounted by `ProductShell` and is now the sole physical
`connectRealtimeEvents` callsite under application/components. Its
`RealtimeTransportOwner` shares one transport per account/Server scope, owns
high-water deduplication, aborts old generations on scope change, rejects stale
callbacks, closes after the final subscriber, and disposes on unmount.

`RealtimeRefresh` projects `task.*` to targeted invalidation instead of
`router.refresh()`. `TaskBoard` follows every task cursor page and reapplies
channel/creator/assignee/status filters; Task memory and chat subscribe through
the provider while preserving their domain state behavior.

```text
realtime/cursor focused frontend tests: 13 passed
frontend full suite: 164 passed
```

Production-like runtime evidence used worktree
`/Users/code/project/smallkhoj-audit-remediation`, backend PID `65179` at
`127.0.0.1:8100`, frontend `127.0.0.1:3000`, tab `1617512415`, and a non-default
public key. After short HTTP keep-alives expired, `lsof` showed exactly one
ESTABLISHED backend socket in addition to the listener. Creating
`REAL_REALTIME_OWNER_20260723` through the real API caused the already-open task
board to render that marker exactly once without opening another SSE socket.

The server-rendered `205 / 205` summary remained unchanged while the client
board gained the marker. That is recorded intentionally: this child proves
targeted task-data invalidation, not broad conversion of every server-rendered
task-derived region to client-live state.
