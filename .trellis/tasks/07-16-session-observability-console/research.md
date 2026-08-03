# Session-Level Local Observability Console — Repository Research

## Research Question

What is missing between SmallKhoj's current activity/runtime surfaces and the
requested standalone, session-centered observer, and which existing repository
or reference-project patterns should constrain the implementation?

## Confirmed SmallKhoj Facts

### 1. The current activity model is backend-bound and agent/activity-centered

- `backend/models/slock.py:528` defines `ActivityLog` as a PostgreSQL SQLAlchemy
  model associated with a server and agent. It is not a durable standalone
  runtime-session aggregate.
- `frontend/components/agent-activity-list.tsx:25` defines `ActivityItem` around
  agent, channel, task, type, description, details, and timestamp. There is no
  required session identifier, session lifecycle projection, or terminal
  outcome.
- `frontend/components/agent-activity-list.tsx:253` fetches
  `/api/v1/activity?agentId=...` and keeps only a module-level browser cache for
  fast remounts. That cache is not durable session storage.
- `.trellis/spec/backend/event-delivery-contracts.md` explicitly says activity
  is observability rather than work and warns against feeding high-volume
  activity back into runtimes. A standalone observer must preserve that
  separation.

Conclusion: adapting the current global activity feed alone cannot meet the
goal. The new capability needs its own session-centered ingest and persistence
boundary.

### 2. The daemon/runtime layer exposes useful session signals but does not
provide durable session observability

- `agent/daemon/aaa-daemon/src/runtime/runtime-driver.ts:1` exposes line,
  structured stream, session, message-sent, exit, and error events. Stream and
  exit events may carry provider session IDs.
- `agent/daemon/aaa-daemon/src/daemon/session-manager.ts:10` keeps session state
  in a process-local `Map`; generated IDs and state disappear with the process.
- `agent/daemon/aaa-daemon/src/proxy/event-buffer.ts:17` is an in-memory ring
  buffer with process-local sequence numbers. It is useful as a delivery
  pattern, not as durable history.
- `agent/daemon/aaa-daemon/src/websocket.ts:26` sends activity heartbeats and
  handles reconnect cursors against the SmallKhoj backend. That path is
  SmallKhoj-specific and cannot be the required external-daemon proof.
- `.trellis/tasks/07-13-agent-runtime-capability-matrix/research.md:1361`
  confirms Kimi ACP and OpenCode ACP expose structured session/update/completion
  signals, but also cautions that provider session resume is not unfinished
  continuation. The observer must report evidence, not infer stronger runtime
  semantics.

Conclusion: a SmallKhoj daemon adapter can be a later convenience, but the MVP
must first prove a provider-neutral public ingest contract with an independent
producer.

### 3. There is prior art for an independent local HTTP surface, but its store
is explicitly unsuitable

- `mvp-prototype/daemon-store/README.md:1` documents a replaceable in-memory
  daemon protocol store and a tentative sequenced event envelope.
- `mvp-prototype/README.md:1` marks that implementation as an archived fake
  backend whose data is lost on restart.
- `frontend/server.ts:1` demonstrates that the repository has previously served
  a local browser surface and WebSocket endpoint from one process, but the file
  is coupled to the archived frontend daemon store and authentication mock.

Conclusion: reuse the idea of one local origin and an explicit store interface,
not the archived store, routes, hard-coded auth, or data model.

### 4. The current frontend has reusable interaction and visual contracts

- `frontend/components/product-shell.tsx:24` owns application chrome and route
  navigation; a standalone observer must not quietly require the authenticated
  ProductShell or SmallKhoj backend session.
- `frontend/components/product-shell-body.tsx:24` provides the proven
  list/detail layout pattern and stable `data-region` hooks.
- `frontend/components/product-ui.tsx:6` centralizes status pills, rows, empty
  states, and toolbars.
- `.trellis/spec/frontend/component-guidelines.md` requires semantic tokens,
  reusable product components, accessible status labels, stable `data-region`
  hooks, and no page-local palette duplication.
- `.trellis/spec/frontend/quality-guidelines.md` requires real browser evidence
  and forbids Playwright as repository verification.

Conclusion: the standalone package may not be able to import the authenticated
Next.js shell directly, but it must adapt the same semantic status, list/detail,
accessibility, and evidence conventions. It must not copy the entire shell or
invent an unrelated generic dashboard aesthetic.

### 5. The local runtime can support an embedded database

- The current local Node runtime is `v22.14.0`.
- The repository does not currently declare a direct SQLite dependency for the
  production frontend or daemon. `better-sqlite3` appears only as an optional
  transitive frontend dependency, and the daemon invokes an external `sqlite3`
  command only for CC Switch provider lookup.
- The clowder-ai reference uses `better-sqlite3` for local stores, including
  WAL/read-only observer patterns, but that is reference evidence rather than a
  SmallKhoj dependency decision.

Conclusion: the implementation agent must choose and document either the Node
22 built-in SQLite API or an explicit supported SQLite package. It must not rely
on a transitive dependency or an undeclared system `sqlite3` binary.

## Reference-Project Findings

The reference check is mandatory because this is a new runtime/control-plane
surface. These projects are prior art, not code to copy wholesale.

### agent-platform — adapt list/detail boundaries; reject cloud coupling

- `/Users/code/project/agent-platform/control-plane/src/routes/workspaces/sessions.ts`
  separates list/detail session shapes and gives session deletion explicit
  semantics.
- `/Users/code/project/agent-platform/web/src/stores/agent-session-store.ts`
  separates API, streaming, effects, and UI state through injected interfaces,
  making lifecycle behavior testable.

Decision: adapt explicit session list/detail contracts and testable dependency
boundaries. Reject workspace authorization, PostgreSQL control plane, and agent
interrupt semantics for this standalone MVP.

### clowder-ai — adapt external-runtime provenance and lifecycle honesty; reject
Redis/domain complexity

- `/Users/code/project/clowder-ai/packages/api/src/routes/external-runtime-sessions.ts`
  exposes external runtime sessions as first-class list/detail records with
  runtime, surface, provenance, lifecycle, and drill-down links.
- `/Users/code/project/clowder-ai/packages/web/src/components/runtime-sessions/external-runtime-session-types.ts`
  keeps lifecycle and provenance explicit instead of flattening everything into
  generic activity.
- `/Users/code/project/clowder-ai/docs/features/F211-cross-runtime-session-transparency.md`
  records the principle that directly observed external-runtime identity and
  lifecycle must remain attributable and drillable.

Decision: adapt explicit source/provenance, lifecycle, identity, and drill-down
fields. Reject Cat Cafe thread binding, Redis stores, multi-user authorization,
and cross-runtime handoff machinery.

### multica — adapt list-level versus per-session event separation

- `/Users/code/project/multica/apps/mobile/data/realtime/use-chat-sessions-realtime.ts`
  handles listing-level invalidation separately from per-session events.
- `/Users/code/project/multica/apps/mobile/data/realtime/use-chat-session-realtime.ts`
  gates per-session events by session ID and keeps live execution traces scoped
  to their owning session.

Decision: adapt separate list projection and session-detail live updates, with
strict session-ID gating. Reject mobile-specific UI and server WebSocket
dependencies.

## Risks The Plan Must Force The Implementer To Address

1. **False standalone proof** — the UI accidentally calls SmallKhoj backend or
   needs PostgreSQL/auth to render.
2. **Activity-feed relabeling** — events are shown, but there is no coherent
   session lifecycle, terminal outcome, or restart persistence.
3. **Unbounded telemetry** — raw model/tool payloads consume disk or freeze the
   browser.
4. **State regression** — late or out-of-order events move a succeeded session
   back to running.
5. **Duplicate inflation** — retrying a daemon POST creates duplicate timeline
   rows or double-counted state.
6. **Observer exposure** — a no-auth developer service binds to every network
   interface.
7. **Unsafe rendering** — daemon-controlled text or JSON becomes executable
   HTML/script.
8. **Fake live behavior** — screenshots show seeded HTML but an open page does
   not update when the daemon emits events.
9. **Fixture contamination** — the supposed external producer imports
   SmallKhoj daemon internals or writes SQLite directly.
10. **Evidence ambiguity** — test output cannot be tied to a unique run, model,
    data directory, session, and screenshot.

## Research Conclusion

The smallest valid capability is a standalone, loopback-only observer with a
versioned HTTP ingest contract, an embedded durable store, deterministic session
projection, a live list/detail browser surface, and an independent producer. It
should live behind a new package boundary rather than extend the backend
`ActivityLog` table. Existing SmallKhoj daemon integration is optional until the
external producer proof passes.

