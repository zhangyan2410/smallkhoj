# Repair runtime query and resource contracts

## Status and scope

This child repairs the confirmed runtime/query defects from plans 005, 015, 016,
017, 018 and the realtime dependency exposed by 022. It starts only after the
schema and auth/tenancy terminal contracts are available. Advisor patches are
evidence, not an implementation base.

In scope:

- public/agent list serialization query counts and response-shape parity;
- upload ingress, application-memory, temporary-disk and persisted-file budgets;
- PostgreSQL NOTIFY pool/listener recovery and bounded shutdown;
- public and agent SSE dependency lifetime and disconnect behavior;
- task/thread cursor semantics and end-to-end frontend page consumption;
- one browser realtime transport owner with explicit event projections.

Out of scope:

- changing product-visible API shapes without a versioned contract decision;
- using a larger DB pool as a substitute for fixing connection ownership;
- CDN/reverse-proxy production limits that cannot be exercised locally;
- broad router/client decomposition, which belongs to the architecture child.

## Requirements

### RQ1 — Serializer shape and query budgets

1. Capture canonical JSON snapshots for message, task and member list/search/history
   responses before optimizing them.
2. A list of `N` messages, tasks or members must not issue `O(N)` relationship,
   workspace or reply-count queries. Query ceilings must be constant per endpoint
   shape and asserted with representative empty, missing-related-row and 50/100-row
   fixtures.
3. A prefetched `None` is a real value, not a sentinel meaning “not prefetched”.
4. Public and agent serializers may share helpers only where their terminal wire
   shapes are proven compatible; intentional shape differences remain explicit.
5. The plan-005 `/threads` changes and plan-018 pagination/filter changes must be
   reconciled semantically. Textual conflict resolution is insufficient.

### RQ2 — Upload resource envelope

1. All three upload entry points—public file, agent attachment and avatar—use one
   documented size policy unless a product-specific lower limit is explicit.
2. The contract distinguishes reverse-proxy/request-body rejection, Starlette
   temporary-disk spooling, application reads into memory and final durable storage.
3. Oversized, interrupted, invalid-metadata and persistence-failure paths close the
   `UploadFile`, remove partial durable files and leave no committed database row.
4. The application-level cap remains defense in depth, but reports may not call it
   network-streaming early rejection.
5. Local/prod configuration and deployment documentation name the effective body,
   memory and temporary-disk budgets.

### RQ3 — NOTIFY lifecycle and recovery

1. Each backend process has an explicit NOTIFY publisher owner and listener owner;
   startup and shutdown are idempotent.
2. Publisher pool invalidation or acquire/execute failure triggers bounded recovery
   or a documented bounded fallback. It cannot silently disable cross-process
   delivery forever.
3. Listener reconnect restores LISTEN subscriptions without duplicate consumers or
   leaked connections/tasks.
4. Connection demand is budgeted per process and multiplied by configured workers.
5. Shutdown completes within a bounded timeout and closes listener/pool resources.

### RQ4 — SSE database-resource lifetime

1. Neither public nor agent SSE route owns a request-scoped `AsyncSession` for the
   duration of `StreamingResponse`.
2. Authentication and initial authorization finish before streaming and reduce to
   primitive immutable identifiers/claims; no ORM object/session is retained.
3. Disconnect, cancellation, authorization failure and shutdown run finalizers and
   release subscriptions promptly.
4. Heartbeats and queue backpressure are bounded.
5. Verification exercises FastAPI dependency finalization through ASGI/HTTP; source
   inspection of a generator is not acceptance evidence.

### RQ5 — Stable task and thread pagination

1. Every paginated endpoint defines one total order and a cursor containing every
   tie-break field in that order.
2. Server-wide tasks cannot use `task_number` alone because it is unique only inside
   `channel_id`; equal task numbers across channels remain deterministic.
3. Thread qualification such as “root has replies” is expressed in SQL before limit.
4. Tests cover ties, boundaries, concurrent insertion, deletion between pages,
   invalid/foreign cursors and duplicate-free full traversal.
5. Every frontend consumer follows `nextCursor` to its required completion policy or
   deliberately renders paginated/load-more UI; silent first-50 truncation is banned.
6. Existing clients receive compatibility or a versioned endpoint; decoding returns
   a stable non-disclosing 4xx for bad cursors.

### RQ6 — One browser realtime owner

1. One auth/active-server browser scope owns one physical SSE connection. Components
   subscribe to a shared event projection instead of opening independent streams.
2. Task events trigger targeted task-data invalidation; unrelated events do not force
   unnecessary full-page refreshes.
3. Reconnect, auth/server switch and unmount cancel the old transport and prevent
   duplicate event application.
4. This child changes transport ownership, not the whole chat domain state model.

### RQ7 — Evidence and truth

1. Every defect gets a diagnostic capsule and intended-reason RED test.
2. Dialect/lifecycle behavior uses isolated real PostgreSQL where necessary.
3. Backend/frontend/full-suite and runtime trace commands are captured exactly.
4. Reports distinguish application memory caps from proxy/parser/disk limits and
   targeted task refresh from elimination of all page refreshes.

## Acceptance criteria

- [ ] 50/100-row fixtures stay inside documented constant query budgets and canonical
      JSON snapshots remain unchanged.
- [ ] No serializer ambiguously uses `None` for supplied and absent prefetch state.
- [ ] Oversized/interrupted uploads leave zero rows and zero partial durable files;
      proxy/parser/app limits are documented separately.
- [ ] NOTIFY tests prove recovery, no duplicate listener, bounded shutdown and a valid
      per-worker connection budget.
- [ ] ASGI tests prove public and agent SSE release DB sessions before the open stream
      finishes and clean subscriptions after disconnect.
- [ ] Cross-channel tasks and reply-bearing threads traverse all eligible rows once.
- [ ] Frontend tests prove every required page consumes `nextCursor` or exposes an
      honest load-more contract.
- [ ] One page/server scope opens one SSE connection and applies each event once with
      targeted invalidation.
- [ ] Focused and full backend/frontend gates pass; `git diff --check` is clean.

## Dependencies and stop conditions

- Depends on schema-integrity for the final DB revision and auth-tenancy for primitive
  stream claims and authenticated frontend context.
- Stop before an unversioned cursor/wire-shape break.
- Stop if a proxy limit cannot be proven in the supported local-production topology;
  document the uncovered dependency instead.
- Stop if query optimization changes wire shape.
- Never use a shared/live DB or a larger pool as lifecycle proof.
