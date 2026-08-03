# Session-Level Local Observability Console — Technical Design

## 1. Design Intent

Build a provider-neutral local observer, not a second SmallKhoj backend and not
a cosmetic activity page. The observer owns only local session telemetry:
ingest, validation, durable storage, deterministic projection, query, live UI
notification, and scoped deletion.

The implementation is deliberately demanding but bounded. The implementing
agent may choose the concrete UI/server libraries after confirming compatibility,
but may not change the logical contracts or evidence gates without updating the
task artifacts and obtaining review.

## 2. Proposed Package Boundary

Create a standalone repository package at:

```text
session-observer/
```

The package owns its manifest, lockfile or documented use of an existing lock,
source, schema/migrations, tests, independent producer fixture, and README. It
must expose stable scripts with these names regardless of internal framework:

```text
dev          start the local observer for development
build        create/verify production-shaped output
start        run the built observer
lint         static lint
typecheck    TypeScript/static type check
test         all automated unit/integration tests
test:contract  public ingest/query contract tests
test:persistence  restart and migration/persistence tests
fixture      run the independent external-daemon producer
```

An alternative location or stack is permitted only if the implementer first
updates this design with evidence that it remains one-command, backend-free,
locally persistent, and independently testable. Adding routes to the existing
authenticated frontend is not sufficient because it would hide coupling to the
SmallKhoj backend and account session.

## 3. Logical Architecture

```text
Independent daemon / fixture
        |
        | versioned loopback HTTP JSON
        v
Ingest boundary -> schema validation -> SQLite transaction
        |                                  |
        |                                  v
        |                           sessions + events
        |                                  |
        v                                  v
structured response                deterministic projector
                                           |
                                           +--> list/detail query API
                                           |
                                           +--> live change stream
                                                     |
                                                     v
                                              browser list/detail UI
```

Responsibilities stay separated:

- **Transport** validates method, content type, size, version, and JSON shape.
- **Store** owns transactions, migrations, deduplication, and cascade deletion.
- **Projector** owns lifecycle precedence, terminal-state rules, stale-state
  derivation, timeline order, and summary fields.
- **Query API** returns product-safe typed view models, not raw database rows.
- **Live stream** carries invalidation/change notifications, not unlimited raw
  model output.
- **UI** renders list/detail states and performs explicit scoped deletion.
- **Fixture** is an external consumer of the public contract only.

## 4. Runtime and Configuration Contract

The observer must support:

```text
--host <loopback-address>       default: 127.0.0.1
--port <port>                   default: 7419; allow 0 for automated tests
--data-dir <path>               explicit test/review isolation
--stale-after-ms <duration>     default: 60000
```

Equivalent environment variables are acceptable if CLI flags take precedence
and the README documents both. Startup must:

1. create the data directory safely;
2. acquire/open the database and apply migrations;
3. fail clearly on an incompatible schema or locked/unwritable data directory;
4. print the exact browser URL, database path, schema version, and process ID;
5. bind only to loopback.

The MVP must reject a non-loopback bind instead of exposing an unauthenticated
telemetry service. Remote hosting and authentication are out of scope.

## 5. Public Ingest Contract

### 5.1 Versioning

- HTTP routes use `/api/v1`.
- Every write body includes `schemaVersion: 1`.
- Unknown schema versions return a structured `400` response and do not mutate
  storage.
- JSON keys use camelCase at the public boundary.

### 5.2 Create or idempotently register a session

```http
POST /api/v1/sessions
Content-Type: application/json
```

```json
{
  "schemaVersion": 1,
  "sessionId": "REAL_session_observer_20260716_alpha",
  "source": {
    "id": "external-fixture-daemon",
    "kind": "external-daemon",
    "version": "1.0.0"
  },
  "title": "Independent daemon success path",
  "startedAt": "2026-07-16T12:00:00.000Z",
  "metadata": {
    "runtime": "fixture",
    "model": "deterministic"
  }
}
```

Rules:

- `sessionId` is a caller-supplied opaque identifier with documented length and
  character limits. It must be URL-encoded in path use.
- The same valid body is idempotent and returns the existing identity.
- Reusing the ID with conflicting immutable source or start identity returns
  `409` and does not overwrite history.
- The response returns whether it was created or already present and includes
  canonical detail/events links.

### 5.3 Append an idempotent event

```http
POST /api/v1/sessions/{encodedSessionId}/events
Content-Type: application/json
```

```json
{
  "schemaVersion": 1,
  "eventId": "evt-alpha-004",
  "kind": "tool.completed",
  "occurredAt": "2026-07-16T12:00:04.000Z",
  "sourceSeq": 4,
  "level": "info",
  "summary": "Read project guidelines",
  "payload": {
    "toolName": "read",
    "durationMs": 121
  }
}
```

Required known event kinds:

```text
session.started
model.started
model.output
tool.started
tool.completed
tool.failed
progress
error
session.succeeded
session.failed
session.interrupted
```

Rules:

- `(sessionId, eventId)` is unique. An identical retry returns success with
  `duplicate: true` and creates no second row or projection change.
- A conflicting retry of the same event ID returns `409`.
- Unknown non-empty event kinds are stored and rendered as generic events with
  `recognized: false`; they are not silently dropped and do not mutate lifecycle
  projection.
- Invalid JSON, invalid timestamps, missing required fields, invalid field
  lengths, and oversized payloads return structured `4xx` responses without a
  partial write.
- The default maximum request body is 256 KiB. A lower per-field/string cap may
  be added, but must be documented and tested.
- The ingest response returns the canonical event ID, monotonic `ingestSeq`,
  duplicate/recognized/late flags, and current session projection.

## 6. Persistence Model

The exact SQL may vary, but the durable model must include:

### `schema_migrations`

- integer version;
- applied timestamp;
- migration identity/checksum if the selected migration mechanism supports it.

### `sessions`

- `session_id` primary key;
- source ID, kind, version;
- title and metadata JSON;
- started, created, updated, last-observed, and terminal timestamps;
- persisted lifecycle state;
- terminal event ID;
- terminal summary/result/error projection;
- latest ingest sequence.

### `session_events`

- monotonic local `ingest_seq` primary key;
- session foreign key with cascade delete;
- caller event ID with a unique `(session_id, event_id)` constraint;
- kind, level, summary, payload JSON;
- occurred time, optional source sequence, ingest time;
- recognized, late-after-terminal, and projection-effect fields.

Required database behavior:

- foreign keys enabled;
- WAL or an evidence-backed equivalent safe local concurrency configuration;
- finite busy timeout;
- session registration/event insert/projection update performed transactionally;
- deterministic migrations on a new and existing database;
- no direct SQLite access by the fixture or browser.

## 7. Projection Semantics

Persisted lifecycle states are:

```text
created -> running -> succeeded | failed | interrupted
```

`stalled` is a derived display state, not a persisted terminal state. A
non-terminal session is stalled when `now - lastObservedAt >= staleAfterMs`; a
new accepted event makes it active again.

Projection rules:

1. Registration creates `created` unless the registration and first
   `session.started` event are committed together by an equivalent documented
   API behavior.
2. Any recognized non-terminal activity moves `created` to `running` and
   updates `lastObservedAt`.
3. The first accepted terminal event in ingest order establishes the terminal
   state and terminal evidence.
4. Later non-terminal events are stored with `lateAfterTerminal: true` and do
   not regress the terminal state.
5. A later conflicting terminal event is stored and visibly marked as an
   ignored terminal conflict; the first terminal outcome remains authoritative.
6. Unknown kinds update ingestion recency for audit but do not silently change
   lifecycle state.
7. Timeline order is deterministic: `occurredAt`, then present `sourceSeq`, then
   local `ingestSeq`. The UI must expose ingest order when it differs from event
   time so out-of-order delivery remains understandable.
8. Duplicate events do not update `lastObservedAt`, terminal state, counts, or
   live revision.

Use an injectable clock for stale-state and timestamp boundary tests.

## 8. Query, Health, Live, and Mutation APIs

Minimum surface:

```text
GET    /healthz
POST   /api/v1/sessions
GET    /api/v1/sessions
GET    /api/v1/sessions/{sessionId}
POST   /api/v1/sessions/{sessionId}/events
GET    /api/v1/sessions/{sessionId}/events
DELETE /api/v1/sessions/{sessionId}
GET    /api/v1/stream?after=<ingestSeq>
```

- List supports bounded pagination/limit and optional source/lifecycle filter.
- Detail returns the canonical session projection plus counts and links.
- Event listing is bounded and deterministic; the UI must not request an
  unbounded raw history for large sessions.
- Delete is idempotent or returns a documented not-found response and removes
  the session/events transactionally.
- The live endpoint should use SSE change notifications with `ingestSeq` replay
  and heartbeat. It carries session IDs/revisions and asks the UI to refetch
  product-safe list/detail data. An alternative may be used only if it proves
  open-page updates within two seconds, reconnect recovery, and no unbounded
  traffic.
- `/healthz` reports service status, schema version, and database readiness
  without leaking absolute paths or event content. The startup log may print the
  local absolute data path for the operator.

## 9. Browser Surface

Minimum routes:

```text
/                         session index
/sessions/{sessionId}     session detail
```

The page may be server-rendered or a client application, but it must share the
observer's local origin and work without SmallKhoj authentication.

### Session index

- source identity and optional title;
- created/start and last-observed time;
- active age or terminal duration;
- lifecycle label and icon, never color alone;
- concise result/error indicator;
- deterministic sorting with active/recent sessions discoverable;
- empty, loading, error, disconnected, and reconnecting states;
- open-page updates within two seconds of accepted ingest.

### Session detail

- lifecycle summary, source/provenance, stable session ID, duration, and final
  result/error;
- chronological event timeline with event kind, time, level, summary, tool/model
  context, and late/unknown/conflict indicators;
- collapsible safely escaped JSON details;
- explicit display of event-time versus ingest-order divergence;
- copy controls for stable session/event IDs;
- explicit delete action with confirmation and deterministic post-delete route;
- live update/reconnect state.

### Product and accessibility constraints

- Adapt SmallKhoj semantic tokens, square ink-border status language, shared
  status meanings, and list/detail information hierarchy.
- Do not copy the authenticated icon rail or pretend the observer is the full
  SmallKhoj product shell.
- Provide stable regions such as `session-list`, `session-summary`,
  `session-timeline`, and `observer-status` via `data-region`.
- Keyboard focus, labels, reduced-width behavior, long unbroken content, and
  text wrapping/inner scrolling must be verified.
- Never use `dangerouslySetInnerHTML` for daemon data. JSON and text are rendered
  as escaped text.

## 10. Independent Producer

The fixture under `session-observer/fixtures/` must behave like a third-party
daemon:

- imports no SmallKhoj daemon/runtime/private observer modules;
- does not read or write the SQLite database;
- uses only documented HTTP endpoints and JSON contracts;
- accepts `--base-url` and `--marker`;
- creates at least two concurrent sessions, one successful and one failed or
  interrupted;
- emits model/progress, tool start/completion/failure, duplicate, out-of-order,
  unknown-kind, and late-after-terminal events;
- prints created session/event IDs and a machine-readable summary;
- exits non-zero when an API response violates the documented contract.

A separate malformed-event test client may be used so the successful fixture
does not treat intentional `4xx` responses as unexpected failures.

## 11. Security and Resource Boundaries

- Loopback-only bind is mandatory for MVP.
- Reject non-JSON writes and oversized request bodies before storage.
- Validate identifiers and field lengths; use parameterized SQL only.
- Bound list/event queries and rendered detail payloads.
- Safely escape all daemon-controlled content.
- Do not automatically capture environment variables, process command lines,
  authorization headers, or filesystem contents.
- Fixtures and saved evidence must contain synthetic values only.
- Document that local telemetry may still contain sensitive model/tool content
  and show the data-directory cleanup command.

## 12. Compatibility, Rollout, and Rollback

- This is additive. Existing backend, daemon, frontend, activity, and event
  contracts remain unchanged unless a later optional adapter is added.
- No backend database migration is permitted for the essential path.
- Database schema version 1 must be created by migrations, not ad hoc table
  creation scattered through handlers.
- A failed migration must stop startup without mutating or deleting existing
  data.
- Rollback is stopping the observer and removing its package changes. User data
  is not deleted automatically; the README documents explicit cleanup.
- Existing SmallKhoj daemon adapter work is a follow-up unless it can be added
  without weakening or delaying the independent external producer proof.

## 12.1 Implementation Decision (recorded at Phase A, 2026-07-16)

The implementing agent confirmed the local runtime and recorded the bounded
choices required by section 13 before writing product code:

- **SQLite**: Node 22 built-in `node:sqlite` (`DatabaseSync`). Selected because
  it is an embedded, declared part of the runtime on Node v22.14.0 (verified
  locally), needs no native compilation and no transitive-dependency gamble.
  It supports WAL, `PRAGMA busy_timeout`, foreign keys, and parameterized
  prepared statements. The experimental-status warning on 22.x is accepted and
  documented in the README; the store sits behind a single factory module so a
  later swap to `better-sqlite3` is a one-module change. Rejected:
  `better-sqlite3` (native build, research flagged it as transitive-only in
  this repo), undeclared system `sqlite3` binary (research forbids).
- **Server/router**: Node stdlib `node:http` with a tiny internal router.
  Selected because the surface is ~8 fixed routes; a framework adds dependency
  weight without changing the contract. Rejected: Express/Fastify/Hono.
- **UI**: server-rendered HTML from typed view-model functions + a static
  vanilla-JS client (`EventSource` SSE, fetch refetch) + hand-authored CSS
  adapting the SmallKhoj handcraft ink-border tokens (same token names/values,
  square borders, hard offset shadows, status pills, `data-region` hooks).
  Selected because the standalone package cannot import the authenticated
  Next.js shell, SSR HTML renders every required state (loading/empty/active/
  terminal/stalled/malformed) deterministically and testably, and zero runtime
  dependencies keep the package auditable. The three-layer discipline is kept
  as: tokens (CSS) → shared view primitives → route composition. Rejected:
  React/Next/Vite inside this package (build weight, hydration risk, cannot
  reuse the authenticated shell anyway).
- **SSE**: standard-library implementation over `node:http` (heartbeat
  comments, `Last-Event-ID`/cursor replay). Rejected: an SSE library (nothing
  to gain for one endpoint).
- **Build tooling**: TypeScript (`tsc`) as the only required dev tool for
  product code; `build` = `tsc` to `dist/`, `start` = `node dist/main.js`.
  Tests run through `node --test` with `--experimental-strip-types` directly
  against `test/**/*.test.ts` (fast TDD loop); process-level E2E tests spawn
  the built `dist/main.js` server so `npm test` also proves the build.
  `lint` = ESLint 9 flat config + typescript-eslint. CSS is one hand-authored
  file; no CSS pipeline. Rejected: tsx/vitest/jest (extra toolchain for no
  contract gain).

Runtime dependencies: **none**. Dev dependencies: `typescript`, `eslint`,
`typescript-eslint`, `@types/node`.

## 13. Design Decisions Intentionally Left To The Implementer

These are bounded engineering choices, not product questions:

- Node built-in SQLite versus an explicitly declared supported SQLite package;
- server/router and UI framework;
- SSE implementation library versus a standard-library implementation;
- build tooling and CSS organization inside the package.

For each choice, the implementation report must record the selection, why it
fits Node 22 and the standalone boundary, and what alternative was rejected.

