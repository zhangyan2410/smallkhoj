# Runtime query and resource design

## Terminal invariants

1. **Q1:** list work grows with page count, not row count; each endpoint has a named
   constant query ceiling and preserves its canonical response shape.
2. **U1:** an upload has exactly one terminal state: rejected, aborted/cleaned, or
   committed; rejected/aborted states own no DB row or durable partial file.
3. **N1:** a process owns at most one active PostgreSQL listener and one publisher
   pool; loss leads to bounded recovery or observable degraded state.
4. **S1:** a long-lived stream owns no request-scoped DB session/transaction after
   headers are sent.
5. **P1:** order is total; the cursor losslessly encodes the last row's full order tuple
   and pages never duplicate an eligible row.
6. **R1:** one auth/server browser scope owns at most one physical realtime stream.

## Query and serialization

Use an explicit `_UNSET`-style sentinel for optional prefetched fields. Batch-load
related rows/reply counts once per page, construct immutable maps, and pass them to
pure serializers. Count SQL around the whole request so hidden lazy loads remain
visible.

```text
endpoint query -> batch loaders -> endpoint projection
               -> common pure primitives -> public/agent wire adapter
```

Common helpers are extracted only where snapshot evidence proves the same semantic
field. For `/threads`, SQL first selects roots satisfying the reply predicate, then
orders/seeks/limits. Counts are part of that bounded query or one grouped follow-up.

## Upload state machine

```text
RECEIVED
  -> REJECTED_BY_INGRESS
  -> PARSED/SPOOLED
       -> REJECTED_BY_APP_LIMIT
       -> VALIDATED -> PERSISTING -> COMMITTED
                                  -> ABORTED_CLEANED
```

| State/event | Required action | Forbidden residue |
|---|---|---|
| ingress too large | stable 413 | temp file, row, durable file |
| app cap exceeded | stop, close, clean | row, partial durable file |
| invalid metadata | close/cleanup | row, durable file |
| write/flush failure | rollback and unlink | row, partial file |
| cancellation | bounded cleanup then re-raise | open handle, partial file |
| commit succeeds | close and retain final pair | staging file |

Use a runtime-specific staging file and atomic rename where supported. DB/file atomicity
is not assumed; failure compensation is explicit.

## NOTIFY state machine and budget

```text
STOPPED -> STARTING -> HEALTHY -> DEGRADED -> RECONNECTING -> HEALTHY
          any state -> STOPPING -> STOPPED
```

Application lifespan owns the publisher pool and listener task. Failure invalidates
unhealthy resources and retries with capped exponential backoff/jitter. A generation
token prevents stale listeners from continuing after reconnect. Degradation remains
observable even if transient events are contractually best-effort.

```text
per_process = sqlalchemy_pool_max + notify_publisher_max + listener_connections
deployment  = per_process * backend_workers + migration/admin headroom
```

Supported config records actual values and verifies them against PostgreSQL capacity.

## SSE authorization and resource lifetime

Setup resolves credentials, server/member IDs in a short session and returns frozen
primitive claims. The stream captures only claims and subscription/cancellation state.

```text
session open -> authorize -> copy claims -> session close
  -> subscribe -> headers/events -> disconnect/cancel -> unsubscribe
```

An ASGI test pauses an open stream and independently consumes the small test pool;
success proves finalization happened before stream completion. Queues are bounded and
overflow uses one documented disconnect or coalescing policy.

## Pagination design

Implementation first freezes each current sort. A server-wide task tuple may be:

```text
(created_at DESC, channel_id ASC, task_number DESC, id DESC)
```

or another reviewed product order. SQL `ORDER BY`, seek predicate, codec and tests use
identical fields/directions; `id` is the last tie-break. Cursor version and endpoint /
server scope prevent cross-use. Frontend helpers explicitly choose fetch-all-bounded
or load-next-page and reject repeated-cursor loops.

## Browser realtime ownership

A provider near the authenticated active-server shell owns EventSource lifecycle.
Consumers register filters/invalidation projections. Scope changes close the prior
generation and clear subscriptions before connecting the new one.

```text
RealtimeProvider (one EventSource)
  -> task projection
  -> member projection
  -> message projection
```

## Test matrix

| Contract | Unit | PostgreSQL/ASGI | Frontend | Runtime/UI |
|---|---|---|---|---|
| query/shape | snapshots | request SQL count | — | trace |
| upload | capped reader | multipart/failure | error mapping | ingress probe |
| NOTIFY | state/backoff | disconnect/reconnect | — | health/trace |
| SSE | claim conversion | open finalizer | provider lifecycle | connection count |
| pagination | codec | traversal/ties | nextCursor | DOM/network |
| realtime | projection | subscription count | one EventSource | `./twd` marker |

## Rollout

- Cursor deployment needs compatibility/versioning first.
- Proxy limits deploy before or with app limits.
- Runtime flags are allowed only with tests for both paths and removal date.
- Realtime rollback cannot reintroduce the fixed SSE resource leak.
