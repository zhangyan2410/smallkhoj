# SSE request-session lifetime violation

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | Public and agent SSE handlers depend on request-scoped `AsyncSession` objects. With `StreamingResponse`, the dependency can remain alive for the entire open stream; the agent stream also captures and reuses that session while polling. Expected: authorization/setup completes in a short session, freezes primitive claims, finalizes the request DB dependency, then starts a stream that owns no request session or ORM entity. |
| **2. Evidence** | Agent `get_events`/`get_events_stream` accepts `db=Depends(get_db)` and its inner stream performs repeated visibility/event queries through the captured `db`. Public stream setup similarly accepts a request DB dependency even though the long-lived path is queue-based. Advisor plan 017 proposes a new session per polling iteration and a larger default pool, but its suggested test calls an inner generator/fake session rather than proving FastAPI dependency finalization through ASGI/HTTP. |
| **3. Confirmed root cause** | FastAPI dependency scope and stream lifetime are coupled in the route function. Authorization returns live ORM objects, and the generator closure captures request-local persistence state. Pool size affects how quickly the failure appears but does not fix ownership. |
| **4. Diagnostic strategy** | Instrument `get_db` finalization and use ASGI/HTTP to hold the SSE body open. Assert the dependency finalizer fires before stream completion, then independently acquire from a tiny pool. Inspect generator closures and cancellation paths for `AsyncSession`/ORM captures. Exercise auth failure, heartbeat, queue overflow, disconnect, cancellation, and shutdown for both push and poll shapes. |
| **5. Timeout strategy** | Keep test waits bounded with explicit ready/finalized/disconnected events. If ASGI transport buffers indefinitely, use a controlled ASGI receive/send harness rather than downgrading to source inspection or helper-only tests. |
| **6. Warning strategy** | Reject larger pool defaults as the fix, a long-lived request session replaced by another long-lived session, ORM claims captured after setup, per-poll sessions without dependency-finalization proof, swallowed `CancelledError`, unbounded queues, or tests that never exercise FastAPI dependency cleanup. |
| **7. User-visible correction** | Many connected browser/agent streams no longer starve ordinary database requests; disconnects release subscriptions and polling work promptly. |
| **8. Acceptance** | ASGI/HTTP tests hold each stream open while proving request DB finalization has already occurred and an independent tiny-pool query can proceed. Cancellation/disconnect/shutdown remove subscriptions/tasks. The stream closure contains only frozen primitive claims plus stream-owned state. |

## Report

- **Reporter:** Independent re-audit of finding 017 on 2026-07-23.
- **Reproduction:** Open more long-lived SSE responses than the SQLAlchemy pool capacity, then make an ordinary database request or inspect dependency finalization while the bodies remain open.
- **Root cause:** Route dependencies and ORM authorization state escape into a longer-lived response generator.
- **Repair direction:** Split setup/auth claims from transport, close the request session before returning the streaming body, and give agent polling narrowly scoped sessions per poll only where DB access is required.
- **Verification:** FastAPI/ASGI lifecycle tests with a tiny real PostgreSQL pool plus subscription/task cleanup assertions.

## Advisor disposition

- Plan 017 correctly identifies agent polling through the captured request session and the structural difference of the public push stream.
- Increasing `pool_size`/`max_overflow` is rejected as remediation for this defect.
- A fake inner-generator test is rejected as acceptance evidence; FastAPI dependency finalization must be observed through ASGI/HTTP.
- Per-poll sessions may be part of the agent implementation, but only after primitive claim freezing and request-session finalization.

## TDD evidence

### RED

- Low-level ASGI/HTTP calls held each SSE response open after receiving its
  `ready` body. Both public and agent routes had opened the tracked `get_db`
  dependency, both request tasks were still running, and both dependency
  finalizers remained unset. The finalizers fired only after the test sent
  `http.disconnect`.
- The agent generator source path confirmed the lifecycle cause: its closure
  referenced the request `db`, `member`, and `server`, and called
  `_visible_event_records` / `_event_record_event` through the same session on
  every polling iteration.

### GREEN

- Public SSE uses a function-scoped API-key/setup dependency. It freezes the
  Server UUID as a string before returning `StreamingResponse`; its push
  generator captures no database session or ORM object.
- Agent SSE freezes `AgentEventStreamClaims(member_id, server_id)`. Setup uses a
  function-scoped session, and each poll opens a short `async_session`, loads
  current scoped entities/visibility, fully serializes frames, closes the poll
  session, and only then yields frames. The generator freevars regression
  explicitly rejects `db`, `member`, and `server`.
- Controlled ASGI/HTTP tests prove both dependency finalizers are set after the
  `ready` body while each request task is still open. Public disconnect removes
  the hub subscription.
- A disposable PostgreSQL engine with `pool_size=1, max_overflow=0` forced the
  setup dependency to check out the only physical connection. While each
  public/agent SSE stream remained open, an independent session immediately
  executed `SELECT 1`, proving the setup connection had been returned rather
  than masked by spare capacity.
- Focused lifecycle evidence:

  ```text
  4 passed in 0.60s
  ```

- Full backend and lint evidence after the change:

  ```text
  415 passed in 30.77s
  All checks passed!
  ```

## Final integrated gate

The final combined real-PostgreSQL runtime suite kept both open-stream/tiny-pool
assertions green alongside NOTIFY, pagination, serializer, and upload tests:

```text
53 passed in 12.74s
421 passed in 37.52s
Ruff: All checks passed!
```

The final browser runtime additionally retained one established backend SSE
socket while a realtime task marker appeared exactly once. That browser proof
supplements rather than replaces the ASGI dependency-finalization assertions.
