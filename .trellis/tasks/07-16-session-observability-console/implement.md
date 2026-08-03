# Session-Level Local Observability Console — Implementation Plan

## Working Agreement

This plan is for the Kimi Code implementation run. Before editing:

1. Run the Trellis session/current-task commands and confirm the active task is
   `.trellis/tasks/07-16-session-observability-console`.
2. Read `prd.md`, `research.md`, and `design.md` completely.
3. Run `trellis-before-dev` and load every relevant backend/frontend/spec index
   it identifies.
4. Follow CodeGraph-first discovery before broad repository searches.
5. Preserve unrelated working-tree changes, especially pre-existing root and
   Trellis files. Do not push, merge, delete unrelated files, or rewrite history.
6. Keep the task in `planning` until the artifacts are reviewed. When ready to
   implement, run the normal Trellis Phase 1.4 activation gate; do not edit
   product code while the task still says `planning`.

Use TDD for all behavior. Each implementation slice below begins with a failing
test or executable contract check, then the minimum implementation, then
refactoring while tests remain green.

## Phase A — Resolve Physical Stack Without Weakening The Contract

- [ ] Confirm Node, package manager, and supported SQLite options locally.
- [ ] Record the selected SQLite/server/UI/build choices in an `Implementation
  Decision` section appended to `design.md` before writing product code.
- [ ] Create the `session-observer/` package boundary and stable script names
  required by the design.
- [ ] Add a minimal README startup section and an initially failing health/start
  smoke test.
- [ ] Prove the package can start without importing `backend/`, connecting to
  ports used by SmallKhoj backend/PostgreSQL, or reading backend environment
  variables.

Checkpoint:

```bash
npm --prefix session-observer run typecheck
npm --prefix session-observer test -- --test-name-pattern health
```

If the chosen test runner does not forward `--test-name-pattern`, document the
exact focused equivalent while preserving `npm --prefix ... test` as the full
suite command.

## Phase B — SQLite Store and Migration Contract

### Red

- [ ] Add failing tests for new data directory creation, schema version 1,
  foreign keys, duplicate session registration, conflicting registration,
  transactional event insert/projection, cascade delete, and restart reopen.
- [ ] Add failing tests for a bad/incompatible migration and unwritable/locked
  data directory with non-destructive startup failure.

### Green

- [ ] Implement one explicit database factory and migration runner.
- [ ] Implement session and event repositories with parameterized statements,
  bounded queries, WAL/equivalent mode, foreign keys, and finite busy timeout.
- [ ] Implement transaction boundaries so accepted event storage and session
  projection cannot diverge.

### Refactor

- [ ] Remove SQL/JSON/date conversion from transport handlers.
- [ ] Centralize clock, ID, limit, and serialization rules.
- [ ] Verify no handler or UI imports the concrete database connection.

Checkpoint:

```bash
npm --prefix session-observer run test:persistence
```

## Phase C — Versioned Ingest and Projection

### Red

- [ ] Add contract tests for valid registration and every known event kind.
- [ ] Add table-driven failing tests for identical duplicate, conflicting
  duplicate, unknown kind, malformed JSON, wrong schema version, invalid date,
  missing fields, invalid identifiers, oversized body, and unknown session.
- [ ] Add failing lifecycle tests for created→running→terminal, all terminal
  outcomes, out-of-order event time, late event after terminal, conflicting
  terminal event, and stale→active derived recovery with an injected clock.

### Green

- [ ] Implement validation at the transport boundary with stable error bodies.
- [ ] Implement idempotent registration and event append responses.
- [ ] Implement the deterministic projector and explicit projection-effect
  metadata.
- [ ] Implement bounded list/detail/event query view models.

### Refactor

- [ ] Keep public DTOs separate from database row types.
- [ ] Ensure unknown/late/conflicting events remain inspectable without changing
  terminal truth.
- [ ] Add fixture-friendly JSON output and stable links.

Checkpoint:

```bash
npm --prefix session-observer run test:contract
```

## Phase D — Live Change Stream

### Red

- [ ] Add failing tests for live notification after accepted ingest, no
  notification for an identical duplicate, heartbeat, reconnect after cursor,
  subscriber cleanup, and cursor-too-old behavior if retention is bounded.

### Green

- [ ] Implement `/api/v1/stream` as lightweight session-change notifications.
- [ ] Include the latest ingest sequence and session identity, not full unbounded
  event payloads.
- [ ] Make reconnect recover missed accepted changes or force a documented safe
  refetch.

### Refactor

- [ ] Separate stream transport from projection/store mutation.
- [ ] Verify slow or disconnected subscribers cannot block ingest.

Checkpoint:

```bash
npm --prefix session-observer test -- --test-name-pattern stream
```

## Phase E — Independent External-Daemon Producer

### Red

- [ ] Add a contract test that scans fixture imports/behavior and fails if it
  imports private observer/SmallKhoj modules or opens the database.
- [ ] Add an end-to-end test that starts the built observer on a temporary port
  and data directory, runs the fixture, and queries expected sessions/events.

### Green

- [ ] Implement the producer using only documented `fetch`/HTTP calls.
- [ ] Emit two concurrent marked sessions and the required success,
  failure/interruption, tool, model/progress, duplicate, unknown, out-of-order,
  and late-event cases.
- [ ] Print a machine-readable summary containing the marker and stable IDs.

### Refactor

- [ ] Keep the fixture deterministic and fast; use explicit bounded delays only
  where live UI evidence requires them.
- [ ] Separate intentional rejection probes from the main successful producer.

Checkpoint:

```bash
npm --prefix session-observer run fixture -- --base-url http://127.0.0.1:7419 --marker REAL_session_observer_manual
```

## Phase F — Browser Index and Session Detail

Before UI edits, reread the frontend component, product style, type-safety,
state, and quality specs. If the standalone package cannot directly reuse a
frontend primitive, adapt the semantic contract without copying the full
authenticated shell.

### Red

- [ ] Add failing view-model/component tests for loading, empty, active,
  successful, failed, interrupted, stalled, unknown event, late event,
  conflicting terminal, malformed optional payload, disconnected/reconnecting,
  and delete confirmation states.
- [ ] Add failing tests for long unbroken text, safe HTML-like payload rendering,
  bounded event pagination, keyboard-accessible controls, and stable
  `data-region` hooks.
- [ ] Add a live test proving an already-open index/detail view updates within
  two seconds of an accepted fixture event.

### Green

- [ ] Implement the session list and detail routes.
- [ ] Implement list/detail data clients and live invalidation with reconnect.
- [ ] Implement status, duration, provenance, result/error, timeline,
  event-time-versus-ingest-order, raw details, ID copy, and explicit delete UI.
- [ ] Implement responsive list/detail navigation and local observer connection
  states.

### Refactor

- [ ] Centralize status/tone/label mappings and date/duration formatting.
- [ ] Remove route-local visual primitive duplication.
- [ ] Verify no daemon-controlled content uses raw HTML insertion.

Checkpoint:

```bash
npm --prefix session-observer run lint
npm --prefix session-observer run typecheck
npm --prefix session-observer test
npm --prefix session-observer run build
```

## Phase G — Restart, Isolation, Deletion, and Resource Tests

- [ ] Run the fixture against temporary data directory A.
- [ ] Stop the observer cleanly and restart it against directory A.
- [ ] Prove the same session/event identities and terminal outcomes remain.
- [ ] Start against fresh directory B and prove it has a usable empty state and
  no data from A.
- [ ] Delete exactly one marked session through the browser and prove its events
  cascade while the other marked session remains.
- [ ] Prove non-loopback bind is rejected.
- [ ] Prove 256 KiB boundary behavior and bounded query limits.
- [ ] Exercise at least one session large enough to expose obvious timeline
  rendering/query regressions without turning this into a load-test project.

Automate these checks under `test:persistence` or a documented E2E script; do
not leave restart proof as an unrepeatable manual claim.

## Phase H — Real Browser Evidence With `./twd`

Use the `project-webdriver-cli` skill. Do not use Playwright and do not call
`twd.py` directly.

Create one unique marker:

```text
REAL_session_observer_<yyyyMMddHHmmss>
```

Save evidence under:

```text
.trellis/tasks/07-16-session-observability-console/evidence/
```

Required evidence sequence:

1. Start the observer on `127.0.0.1` with isolated data directory A and record
   startup output, exact URL, PID, database path, and schema version.
2. Verify SmallKhoj backend/daemon/database are not part of the path; record
   process/port evidence without stopping unrelated user processes.
3. Open the observer URL with `./twd`; capture empty-state DOM and screenshot.
4. Keep the page open and run the independent fixture with the unique marker.
5. Within two seconds, assert both sessions appear without manual refresh.
6. Capture desktop index and successful/failed-or-interrupted detail views.
7. Assert stable `data-region` hooks, visible marker/IDs, terminal outcome,
   tool/model events, unknown/late/conflict indicators, and no executable HTML.
8. Capture a narrow viewport flow and prove navigation, wrapping, and inner
   scrolling remain usable.
9. Record browser console errors and failed network requests; expected intentional
   `4xx` probes must be separated from unexpected failures.
10. Stop/restart the observer on directory A, reload through `./twd`, and capture
    persistence proof.
11. Start against directory B and capture empty isolation proof.
12. Return to directory A, delete one marked session through the UI, assert the
    other remains, and capture the resulting state.

Suggested command shape, adjusted to the actual connected tab/port:

```bash
./twd --compact tabs
./twd goto --url-match 127.0.0.1:7419 http://127.0.0.1:7419/
./twd --compact scan --text --url-match 127.0.0.1:7419
./twd snapshot --url-match 127.0.0.1:7419 --out .trellis/tasks/07-16-session-observability-console/evidence/REAL_<marker>-index.snapshot.txt
./twd screenshot --url-match 127.0.0.1:7419 .trellis/tasks/07-16-session-observability-console/evidence/REAL_<marker>-desktop.png
```

Every `./twd` result used as evidence must record the returned `tabId` and
`tabUrl` or otherwise demonstrate that the correct observer page was targeted.

## Phase I — Documentation and Full Quality Gate

- [ ] Finish `session-observer/README.md`: architecture, prerequisites,
  one-command dev/start, CLI/env precedence, data directory, API examples,
  fixture, persistence, cleanup, limits, troubleshooting, and security warning.
- [ ] Include copy/paste `curl` examples for registration, event append, list,
  detail, and delete.
- [ ] Document exact Node/package-manager versions used for verification.
- [ ] Record selected reference-project patterns as adapted/rejected, consistent
  with `research.md`.
- [ ] Run `trellis-check` and fix all findings before claiming completion.
- [ ] Update a durable Trellis spec only if implementation establishes a new
  project-wide contract; do not add speculative rules.
- [ ] Create `evidence/acceptance-matrix.md` mapping AC1–AC13 to exact automated
  tests, commands, browser evidence files, and observed results.
- [ ] Create `evidence/model-run.md` recording that Kimi Code performed the run,
  its visible model/provider identifier if available, start/end timestamps,
  task path, commit/diff identity, and any context resets or human interventions.
  Never record credentials or private provider tokens.

Final automated gate:

```bash
npm --prefix session-observer run lint
npm --prefix session-observer run typecheck
npm --prefix session-observer run test:contract
npm --prefix session-observer run test:persistence
npm --prefix session-observer test
npm --prefix session-observer run build
```

## Stop/Failure Rules

Report **not complete** instead of weakening the goal when any of these occurs:

- the observer needs SmallKhoj backend/auth/PostgreSQL/Redis/Docker;
- the external fixture imports internals or writes SQLite directly;
- session history disappears after restart;
- duplicates/out-of-order/late/conflicting events have undefined behavior;
- an open page needs manual refresh to observe accepted events;
- browser evidence is missing, uses Playwright, or cannot be tied to the marker;
- tests omit malformed, terminal, persistence, or deletion behavior;
- the service binds beyond loopback without an approved security redesign;
- unrelated working-tree changes are overwritten or included.

When blocked by dependency installation, browser connection, or local runtime
availability, preserve the failing command/output under `evidence/`, state the
exact blocker, and do not mark the task done.
