# Reduce confirmed architecture debt

## Status and scope

This child addresses confirmed TDA-01, TDA-03, TDA-05, TDA-06, FRONTEND-01,
FRONTEND-05 and documents a boundary decision for DEP-01. It runs after functional /
security/runtime behavior is fixed and characterized. Its default contract is
behavior-preserving extraction, not feature work.

Current evidence includes multi-thousand-line public/agent routers, a roughly
two-thousand-line `channel-client.tsx`, duplicated nested/outcome/serializer helpers
and two frontend chat state owners. File size is a signal; acceptance is based on
cohesive ownership and contract stability, not arbitrary line-count targets.

## Requirements

### A1 — Characterization before movement

1. Freeze route inventory, method/path/status/error/response schemas, auth dependency,
   transaction boundary and emitted event for every moved public/agent handler.
2. Freeze message/task/member serialization snapshots and public-vs-agent intentional
   differences before consolidating helpers.
3. Freeze chat hydration, scroll, selection, draft, optimistic send, reconnect,
   pagination and responsive-panel behavior before splitting the client.
4. Architecture extraction may not be used to mask an unresolved functional RED from
   another child.

### A2 — Router decomposition

1. `public_api.py` and `agent_api.py` become thin composition roots that register
   cohesive domain routers/services (auth/members, channels/messages, tasks, files,
   events, control/runtime as appropriate to actual boundaries).
2. Each domain module owns request parsing/authorization orchestration; reusable
   business logic lives in services with explicit transaction ownership.
3. Importing a router must not cause schema creation, network connection, task startup
   or other hidden side effect.
4. Dependency direction is acyclic and documented; domain modules do not import the
   giant composition root.
5. OpenAPI operation IDs, paths, tags and external JSON remain stable unless a separate
   reviewed API change says otherwise.

### A3 — Shared helper criteria

1. Feishu `_nested` and outcome/result helpers are consolidated only after at least two
   consumers are proven semantically identical by tests.
2. Public/agent serializers share pure primitives where shapes match; endpoint-specific
   adapters keep different authorization/visibility/wire fields explicit.
3. A shared abstraction must reduce divergent logic and have an owning module, public
   contract and negative tests. “Same-looking code” alone is insufficient.
4. Transitional duplicate helpers have a removal checklist and no circular imports.

### A4 — Channel client decomposition

1. Split orchestration, data/state, message timeline, composer, sidebar/inspector,
   scrolling/resizing and dialogs into cohesive modules/components/hooks.
2. `ChannelClient` becomes a composition boundary rather than the owner of every state
   mutation and rendered subview.
3. Components receive narrow typed props/selectors/actions; they do not reach into an
   all-purpose mutable context.
4. Server/client component boundaries remain explicit and bundle behavior does not
   regress.

### A5 — Single chat state owner

1. Channel data and `chat-data-context` converge on one authoritative store/reducer /
   query-cache ownership model per active account/server/channel.
2. Sidebar and channel views consume projections from the same normalized entities;
   no independent polling/realtime merge can overwrite newer state.
3. Scope switch, pagination merge, optimistic send/rollback and realtime event each
   have one reducer/transition owner and generation protection.
4. Derived UI state remains local when it is genuinely view-only (dialog open, panel
   width); “single owner” does not mean one global blob.

### A6 — Dependency boundary ADR

1. Investigate DEP-01 as an architectural risk, not claim a vulnerability without
   evidence.
2. Record which process/package owns backend, Next/Bun server, websocket transport,
   auth and database dependencies; explain runtime versus build-only dependencies.
3. CI or dependency-boundary tests catch imports crossing forbidden layer/package
   direction where the repository tooling supports it.

### A7 — Incremental reviewability

1. Extractions are small, ordered and independently green; no single “move everything”
   commit.
2. Mechanical moves are separated from behavior changes.
3. CodeGraph is refreshed/checked after major moves so later discovery is reliable.
4. Every extraction has a rollback point and ownership note.

## Acceptance criteria

- [ ] Route contract inventory and OpenAPI/JSON/error/event snapshots are green before
      and after each backend extraction.
- [ ] Public/agent composition roots contain registration and truly cross-domain glue,
      not thousands of lines of mixed domain behavior.
- [ ] No extracted module imports a composition root or starts runtime/schema side
      effects on import; dependency graph checks remain acyclic.
- [ ] Shared helper modules have two proven consumers, explicit semantic tests and no
      endpoint shape regression.
- [ ] `ChannelClient` is decomposed into named cohesive ownership cells with unchanged
      hydration/scroll/send/reconnect/pagination/dialog behavior.
- [ ] Account/server/channel state has one authoritative entity/event merge owner;
      stale scope events and duplicate realtime messages cannot overwrite it.
- [ ] Bundle/build, backend/frontend full suites and required `./twd` chat scenarios pass
      after the integrated extraction.
- [ ] DEP-01 has a reviewed ADR and enforceable boundary checks where feasible.

## Dependencies and stop conditions

- Depends on schema/auth/runtime/delivery characterization and terminal API/UI contracts.
- Stop if an extraction requires a product-visible behavior decision; split that into
  its owning feature task.
- Stop if characterization is missing for a behavior touched by the move.
- Stop a proposed shared helper when consumers differ in authorization, null/default,
  ordering or wire-shape semantics.
- Do not use target file length as permission to create a generic `utils.py` or global
  frontend store.
