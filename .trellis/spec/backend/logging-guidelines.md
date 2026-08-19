# Logging Guidelines

> How logging is done in this project.

---

## Overview

The backend uses the **Python standard library `logging`** only — no structlog/loguru (zero hits in backend source; none in pyproject.toml dependencies). There is **no centralized logging config** in the app: `main.py` and `config.py` never import logging, no `basicConfig`/`dictConfig`, no log-level setting in `Settings` — format/level/output come from uvicorn defaults. The only `fileConfig` in the repo is alembic.ini:115-149, and it applies to the migration process only (root=WARNING, alembic=INFO, stderr console handler).

Per-module logger idiom (6 business modules + tests):

```python
logger = logging.getLogger(__name__)   # services/public_events.py:26, daemon_control.py:18,
                                       # routers/public_api.py:170, upload_storage.py:17, ...
```

---

## Message Style

The dominant style is **lazy %-style formatting with embedded `key=value` pairs** in the message — not structured field APIs:

```python
logger.info("public event stream subscriber connected count=%s", self.subscriber_count)      # public_events.py:70
logger.warning("public event subscriber queue full; dropping event id=%s", event_id)         # public_events.py:94
logger.exception("daemon control push failed for computer_id=%s", computer_id)               # daemon_control.py:325
```

- Pass parameters as %-args (lazy formatting), keeping the pattern above.
- The only `extra={...}` usage today is upload_storage.py:47 (`extra={"path": str(path)}`); it is acceptable but not the norm.
- Latency observability is NOT logger-based — see the next section.

---

## Latency Trace (stdout JSON lines, not logging)

Request-path timing goes through `services/latency_trace.py`, which prints single-line JSON events to stdout:

- Trace id: header `X-SmallKhoj-Trace-Id`, or `traceId/trace_id` in the body, else generated `prefix:uuid12` (latency_trace.py:15-32).
- Event fields: `at/traceId/flow/span/elapsedMs/durationMs/status/attrs` (latency_trace.py:84-109).
- Used in routers around send paths: agent_api.py:2136-2142, 2145-2222; public_api.py:2455.
- **Observability must never break the realtime message path**: trace emission swallows its own exceptions (latency_trace.py:105-109).
- Consumption: `./smallkhoj-trace` (repo root) groups these timeline events.

Other deliberate stdout (non-logging) outputs: seed completion marker (seed.py:198), CLI JSON results (integration_bootstrap_cli.py:78, live_run_preflight_cli.py:42-44, scripts/legacy_schema_preflight.py:704-713).

---

## Log Levels (observed conventions)

| Level | Used for | Real examples |
|-------|----------|---------------|
| `debug` | high-frequency noise reduction paths | event dedup drops (public_events.py:81), shutdown-phase task failures (public_events.py:676,701) |
| `info` | lifecycle events | subscriber connect/disconnect (public_events.py:70,75), listener reconnect (public_events.py:611) |
| `warning` | recoverable degradation | queue full dropping event (public_events.py:94), publish retry failure (public_events.py:523-529), invalid notify JSON (public_events.py:719) |
| `error` | data loss or resource shutdown timeout | dropped notifications on unhealthy publisher (public_events.py:489-493), shutdown timeout (public_events.py:678,694) |
| `critical` | consistency risk after rollback | blob restore failed after transaction rollback (public_api.py:4385-4391, 4502-4507) |
| `exception`/`exc_info` | default on exception paths | public_events.py:567,630; upload_storage.py:47,120,133; reminder_scheduler.py:177; thread_summary.py:343 |

Background loops follow the shared pattern: `logger.exception(...)` + exponential backoff (reminder_scheduler.py:176-178, thread_summary.py:342-344).

Event-delivery contract tie-in: best-effort drops (queue overflow) must stay observable via warning logs and never grow unbounded (event-delivery-contracts.md; public_events.py:94).

---

## Daemon Side Is a Different Stack (do not port blindly)

`agent/daemon/aaa-daemon` is TypeScript and does NOT use a logging library:

- `console.*` with bracket prefixes: `[WS] Connecting...` (websocket.ts:57), `[WS] Lease revoked by server: not reconnecting.` (websocket.ts:93), `[Aura] ...` CLI output (cmd/main.ts:296-443).
- `DaemonCore` keeps an in-memory ring buffer (capacity 2000, evicts oldest; daemon.ts:2571-2583) with `{timestamp, level, message}` entries, served via the JSON-RPC method `DaemonMethods.Logs` (client-handler.ts:228-231).
- Consequences: no %-lazy formatting concept (template strings are fine there), and daemon log levels are the ring buffer's own `debug|info|warn|error`.
