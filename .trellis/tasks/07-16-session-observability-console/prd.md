# Session-Level Local Observability Console

## Goal

Provide a local-first, session-level observability surface that lets a developer
open a browser and understand one daemon/runtime session end to end. The
surface must work for a daemon that is not part of SmallKhoj, must not require
the SmallKhoj backend or an external database, and must preserve enough local
history to inspect sessions after the observer process restarts.

This task is intentionally a goal-level capability evaluation. The implementing
agent owns repository discovery and the concrete solution, subject to the
requirements, constraints, evidence gates, and termination conditions below.

## Background

SmallKhoj's current activity-oriented observation does not provide a coherent
session view. Operators need to correlate lifecycle, model/runtime activity,
tool use, progress, failure, interruption, and completion without reconstructing
the session manually from a global activity stream or relying on SmallKhoj's
full backend stack.

## Requirements

### R1. Standalone local operation

- The observer MUST run locally without the SmallKhoj backend, PostgreSQL,
  Redis, Docker, or a cloud service.
- It MUST use an embedded/local persistence mechanism such as SQLite for
  session metadata and events.
- A documented one-command development startup MUST launch the observer's
  ingest surface and browser UI, or launch a single process that serves both.

### R2. External daemon integration

- A daemon outside the SmallKhoj runtime MUST be able to create a session,
  append session events, update terminal state, and provide stable source and
  correlation identifiers through a documented, versioned contract.
- Integration MUST use a normal local boundary (for example HTTP or another
  repository-supported local protocol), not imports of SmallKhoj daemon internals
  or direct writes into observer persistence.
- The repository MUST include an independent fixture/example daemon or producer
  that proves the contract without starting the SmallKhoj daemon or backend.

### R3. Session model

- A session MUST have a stable identity, source/daemon identity, lifecycle
  state, start/update/end timestamps, and enough metadata to distinguish
  concurrent runs.
- The event model MUST represent at least lifecycle transitions, model/runtime
  activity, tool/action start and finish, progress/output, errors, interruption,
  and final result.
- The observer MUST define deterministic handling for duplicate events,
  out-of-order events, missing optional fields, and events received after a
  terminal lifecycle event.
- Supported terminal outcomes MUST include success, failure, and cancellation or
  interruption. A quiet or stalled session MUST remain distinguishable from a
  completed session.

### R4. Browser observability

- The UI MUST provide a session index with state, source, start/update time,
  duration or age, and a concise result/error indicator.
- A session detail view MUST show a chronologically understandable event
  timeline and summary without requiring the user to inspect raw database rows
  or terminal logs.
- The detail view MUST make current/terminal state, elapsed duration, errors,
  tool/action activity, and final result discoverable.
- The UI MUST cover loading, empty, active, successful, failed, interrupted,
  stalled, and malformed/partially populated data states without crashing.
- A developer MUST be able to copy or otherwise inspect stable session and event
  identifiers for correlation with daemon logs.
- An already-open index or detail page MUST reflect accepted session changes
  within two seconds without manual refresh and MUST recover safely after a
  transient observer connection loss.

### R5. Persistence and management

- Sessions and events MUST remain queryable after stopping and restarting the
  observer using the same local data directory.
- The implementation MUST document the data-directory location and offer a safe,
  explicit way to start with an isolated temporary data directory for tests.
- Basic local session management MUST include listing, inspecting, and deleting
  or clearing sessions. Destructive operations MUST be explicit and scoped.

### R6. Documentation and evidence

- Documentation MUST describe architecture, startup, configuration, the ingest
  contract, the external-daemon example, persistence, cleanup, and known limits.
- The implementation MUST include automated contract/persistence tests and a
  real end-to-end run using the independent producer.
- Repository UI verification MUST use `./twd`, following the project real-test
  SOP. Playwright and direct invocation of `twd.py` are not acceptable evidence.

## Constraints

- Do not require SmallKhoj backend APIs or backend database migrations for the
  standalone observer's essential path.
- Do not require PostgreSQL, Redis, Docker, a message broker, telemetry SaaS, or
  network access outside the local machine.
- Do not make an external daemon import private SmallKhoj runtime/daemon modules.
- Do not treat a restyled global activity feed as session observability; the
  persistence and query model must be session-centered.
- Do not silently drop malformed, duplicate, out-of-order, late, or unknown
  events. The contract must define and test the behavior.
- Do not claim completion from unit tests or screenshots alone. Completion needs
  contract tests, restart persistence evidence, an independent-producer E2E run,
  and real browser evidence.
- Preserve unrelated working-tree changes. Do not push, merge, rewrite history,
  or remove unrelated files as part of this task.
- Follow the repository's Trellis workflow, coding specs, CodeGraph-first
  discovery rule, and real-runtime/browser testing procedures.
- The standalone observer MUST bind to loopback by default and MUST reject an
  unauthenticated non-loopback bind in the MVP.
- Ingest MUST enforce a documented request-size limit, use parameterized storage
  operations, and safely escape daemon-controlled text/JSON in the browser.

## Acceptance Criteria

- [ ] AC1 — With SmallKhoj backend, database containers, and SmallKhoj daemon
  stopped, the documented startup command launches the observer and its health
  check succeeds.
- [ ] AC2 — The independent fixture/example producer creates at least two
  concurrent sessions and emits lifecycle, progress/model, tool/action, error or
  result events exclusively through the public ingest contract.
- [ ] AC3 — The browser session index displays both fixture sessions with the
  correct source identity, lifecycle state, timestamps, and duration/age.
- [ ] AC4 — A session detail view presents an understandable ordered timeline,
  stable correlation identifiers, tool/action activity, terminal outcome, and
  final result or error.
- [ ] AC5 — Automated tests prove the specified behavior for duplicate IDs,
  out-of-order delivery, late events, unknown event kinds, missing optional
  fields, and all supported terminal outcomes.
- [ ] AC6 — After ingesting sessions, stopping the observer, and restarting it
  against the same data directory, the same sessions and events remain visible
  and retain their identities and outcomes.
- [ ] AC7 — Starting the observer with a fresh isolated data directory shows a
  usable empty state and does not expose data from the previous directory.
- [ ] AC8 — A scoped delete/clear operation removes only the requested local
  session data, requires an explicit user action, and leaves the observer usable.
- [ ] AC9 — Focused lint, type-check, unit, integration, and persistence suites
  for every touched package pass from documented commands.
- [ ] AC10 — `./twd` evidence verifies the empty, active, successful, failed or
  interrupted, stalled, session-detail, restart-persistence, and delete flows at
  representative desktop and narrow viewport sizes.
- [ ] AC11 — The final task report contains an acceptance matrix mapping AC1–AC13
  to exact commands, tests, screenshots/markers, and observed results; no row may
  be justified only by code inspection.
- [ ] AC12 — With the browser already open, accepted fixture events become
  visible within two seconds without manual refresh; a forced stream/reconnect
  interruption recovers without duplicate timeline rows or lost terminal state.
- [ ] AC13 — Automated tests prove loopback-only binding, request-size limits,
  parameterized/validated persistence boundaries, and inert rendering of
  HTML/script-like daemon payloads.

## Termination Conditions

The task is complete only when all of the following are true:

1. Every acceptance criterion is checked and backed by reproducible evidence.
2. The observer has been demonstrated with the SmallKhoj backend and daemon
   unavailable, using only the independent producer and local persistence.
3. A stop/restart cycle has demonstrated durable session history.
4. Real browser evidence produced through `./twd` demonstrates the required
   states and does not contain uncaught page errors or failed network requests.
5. All focused quality commands pass, documentation can be followed from a clean
   local data directory, and no essential path depends on an external service.
6. The implementation agent has run the Trellis quality gate, recorded any
   necessary spec updates, and left a reviewable diff without unrelated changes.

If any item is missing, flaky, simulated in place of the specified real path, or
dependent on SmallKhoj backend infrastructure, the correct result is
**not complete**, with the missing evidence or blocker stated explicitly.

## Out of Scope

- Remote/cloud-hosted observability, authentication, multi-user tenancy, RBAC,
  billing, or cross-machine synchronization.
- General-purpose distributed tracing, metrics aggregation, or log indexing.
- Production-scale retention, archival, compression, or high-availability
  guarantees.
- Replacing SmallKhoj's existing backend activity/event pipeline.
- Requiring existing SmallKhoj daemons to migrate as part of the MVP; an adapter
  may be added if it stays secondary to the standalone external-daemon proof.
