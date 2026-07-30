# PostgreSQL NOTIFY ownership and recovery failures

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | Every committed browser event opens a new PostgreSQL connection for `pg_notify`, while the listener is a separate long-lived task whose failure/reconnect ownership is not expressed as a recoverable state machine. Expected: one bounded publisher owner and one listener owner per process, idempotent lifecycle, recovery after invalidation, no duplicate consumers, and bounded shutdown. |
| **2. Evidence** | `services.public_events._notify_postgres` uses one-shot `asyncpg.connect()`/close per event. Listener startup creates a dedicated connection and task. Application lifespan starts/stops only the listener. Advisor plan 016 replaces one-shot publishing with a pool but allows an unbounded raw-connect fallback whenever the pool is absent and does not prove pool invalidation recovery, LISTEN re-subscription, stale-generation rejection, or multi-worker connection demand. |
| **3. Confirmed root cause** | Cross-process fanout has no explicit process-owned lifecycle/state model. Publisher and listener health are hidden in module globals/tasks; failure paths can become permanently degraded, multiply owners, leak resources, or silently fall back outside the budget. |
| **4. Diagnostic strategy** | Model STOPPED/STARTING/HEALTHY/DEGRADED/RECONNECTING/STOPPING transitions. Against isolated PostgreSQL, invalidate publisher and listener connections, assert bounded recovery and LISTEN restoration, repeat start/stop, race reconnect with shutdown, and count active tasks/connections/generations. Calculate `(SQLAlchemy pool + publisher max + listener) * workers + migration/admin headroom`. |
| **5. Timeout strategy** | Bound acquire, reconnect, and shutdown waits. If recovery cannot complete, expose a degraded signal and drop/record best-effort notification according to the reviewed contract; never hang mutation requests indefinitely or silently disable cross-process delivery forever. |
| **6. Warning strategy** | Reject per-event TCP handshakes, permanent raw-connect fallback, duplicate listener tasks, stale callbacks after reconnect, shutdown without timeout, “pool exists” fake-only tests, or connection budgets stated per process without multiplying configured backend workers. |
| **7. User-visible correction** | Browser realtime wakeups recover after transient PostgreSQL/network loss without requiring a backend restart, and backend shutdown does not hang on reconnecting fanout tasks. |
| **8. Acceptance** | Isolated PostgreSQL tests prove publisher recovery, listener reconnect with restored LISTEN, one active generation, idempotent start/stop, bounded shutdown, and no leaked resources. Deployment docs/config record the per-worker and total connection budget. |

## Report

- **Reporter:** Independent re-audit of finding 016 on 2026-07-23.
- **Reproduction:** Publish concurrent events, terminate publisher/listener PostgreSQL connections, then observe publish/listen recovery and process shutdown.
- **Root cause:** Connection use was implemented as local calls and globals rather than a lifespan-owned recoverable subsystem.
- **Repair direction:** Introduce explicit publisher/listener ownership, generation-guarded reconnect, capped backoff/timeouts, health/degraded observability, and a configured deployment budget.
- **Verification:** Unit transition tests plus real PostgreSQL disconnect/reconnect/start-stop/shutdown evidence.

## Advisor disposition

- Plan 016 correctly identifies the per-event connection handshake and the need for a shared publisher pool.
- Its raw-connect fallback is rejected as a production recovery strategy; tests bypassing lifespan must use explicit setup or a bounded observable fallback contract.
- Listener recovery, generation ownership, failure visibility, bounded shutdown, and worker-multiplied connection budgeting are required additions.

## TDD evidence

### RED

- Process-owner startup expected one publisher pool but observed
  `create_pool_calls=0`.
- Two notifications plus one listener expected one raw listener connection but
  observed three `asyncpg.connect()` calls; the publisher pool executed zero
  statements.
- Publisher execute failure left the replacement pool unused; listener
  termination registered no termination callback; a callback captured before
  stop/start still published one event; stalled cleanup exceeded the 150 ms
  test bound despite a configured 20 ms resource timeout.
- The disposable PostgreSQL probe reached runtime state `healthy` but found zero
  `smallkhoj-notify-publisher` rows in `pg_stat_activity`, proving the owners
  were not operationally distinguishable.
- The deployment budget test found no worker-multiplied calculation and did not
  reject a configuration requiring 59 connections against capacity 58.

### GREEN

- `PostgresNotifyRuntime` owns one publisher pool and one generation-guarded
  listener task per process. Repeated start/stop is idempotent. Publisher
  acquire/execute failure closes and replaces the pool and retries within the
  configured attempt/operation bounds; successful recovery returns state to
  `healthy`.
- Listener connections register an asyncpg termination listener, reconnect with
  capped exponential backoff, restore `LISTEN`, and reject callbacks from stale
  generations. Listener, callback-task, connection, and pool shutdown waits are
  bounded.
- Real disposable PostgreSQL evidence terminated the live listener PID, observed
  a different listener PID, received the next event exactly once, terminated
  the publisher PID, received the following event exactly once, and observed
  zero named owner connections after double stop:

  ```text
  1 passed in 5.60s
  ```

- Focused unit plus real PostgreSQL regression:

  ```text
  26 passed in 5.79s
  ```

- Default capacity is explicit and executable:
  `(5 SQLAlchemy pool + 10 overflow + 2 publisher + 1 listener) * 1 worker + 5
  headroom = 23`, checked against PostgreSQL `max_connections=100`. A three
  worker configuration requires 59 and a capacity of 58 fails settings
  validation.
- Focused Ruff passed and `docker compose config --no-interpolate --quiet`
  accepted the production topology.

## Final integrated gate

The final combined real-PostgreSQL runtime suite, including NOTIFY recovery,
SSE lifetime, serializer budgets, upload compensation, and stable pagination,
passed together before the backend full suite:

```text
53 passed in 12.74s
421 passed in 37.52s
Ruff: All checks passed!
docker compose -f docker-compose.prod.yml config --no-interpolate --quiet: passed
```

These results use the dedicated disposable PostgreSQL instance; no fake session
or `Base.metadata.create_all` path is counted as lifecycle evidence.

## Superseded deployment-budget correction (2026-07-23)

The `23` / `59` figures above are retained only as historical RED→GREEN evidence
for backend-owned NOTIFY resources. They are not the current deployment-wide
capacity contract because that calculation omitted the frontend Better Auth pool
and the independent Feishu worker SQLAlchemy pool.

The corrected default requirement is `48`; three backend workers require `84`,
and capacity `83` is rejected. Better Auth now has one process-global pool with
explicit maximum `10`, while the optional worker reserve is retained even when
its Compose profile is disabled. The current diagnosis and acceptance evidence
live in
[`postgres-deployment-connection-budget`](../postgres-deployment-connection-budget/bug-report.md).
