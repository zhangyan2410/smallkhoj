# Architecture debt implementation plan

## 0. Preconditions and inventory

- [ ] Confirm every functional child is green and no architecture move is needed to
      hide an unresolved RED.
- [ ] Refresh CodeGraph and capture callers/importers for both routers,
      `channel-client.tsx`, `chat-data-context.tsx`, Feishu helpers and serializers.
- [ ] Create characterization capsules/notes for backend route movement and frontend
      state-owner cutover.
- [ ] Generate/review route inventory and current OpenAPI snapshot.
- [ ] Record current source/bundle size only as a trend baseline, not acceptance alone.

## 1. RED/GREEN — backend contract harness

- [ ] Add stable OpenAPI method/path/operation/schema diff test.
- [ ] Add representative success/error/auth/tenant response snapshots per domain.
- [ ] Add side-effect/transaction/event ordering tests for write routes.
- [ ] Add import-side-effect and forbidden reverse-import checks.
- [ ] Prove the harness catches one controlled route/schema/auth drift before movement.

## 2. Extract backend domains incrementally

- [ ] Extract one cohesive public domain with composition-root compatibility import;
      run its focused and full backend gates.
- [ ] Extract the corresponding agent domain only after comparing intentional contract
      differences; run both public/agent snapshots.
- [ ] Repeat for auth/members, channels/messages, tasks, files and events according to
      the reviewed inventory rather than raw file order.
- [ ] Move business logic to existing/named services only when transaction owner is
      explicit; no hidden session/commit.
- [ ] After each pair, refresh CodeGraph, remove dead imports and run diff check.
- [ ] Remove compatibility exports only after all importers migrate.

## 3. RED/GREEN — helper consolidation

- [ ] Populate semantic tables for Feishu `_nested`, outcome helpers and serializers.
- [ ] Write equivalence and negative-divergence tests before extraction.
- [ ] Extract only helpers with at least two stable equivalent consumers.
- [ ] Preserve endpoint adapters and runtime child's explicit prefetch/query contract.
- [ ] Document intentional duplicates and reject generic dumping-ground modules.

## 4. RED/GREEN — frontend characterization

- [ ] Cover boot/hydration, account/server/channel switch, three-page history prepend,
      scroll anchoring, optimistic send/ack/failure, reconnect duplicate event, member /
      channel update, drafts, upload, dialogs and responsive panel behavior.
- [ ] Add state-generation tests proving stale async results are currently possible or
      guarded as characterized.
- [ ] Capture server/client boundaries and production bundle baseline.
- [ ] Prove tests fail on a controlled duplicate message/scope-leak mutation.

## 5. Decompose views and local concerns

- [ ] Extract timeline, composer, inspector/dialog and responsive layout components /
      hooks with narrow typed interfaces.
- [ ] Keep local-only UI state local; avoid putting dialog/panel state in domain store.
- [ ] Run focused tests, lint/typecheck/build after every extraction.
- [ ] Keep `ChannelClient` as composition and orchestration adapter during transition.

## 6. Establish one chat data owner

- [ ] Define normalized state/actions/selectors and scope generation behind an adapter.
- [ ] RED tests for stale scope result, pagination/realtime overwrite, optimistic/event
      duplicate and sidebar/timeline disagreement.
- [ ] Route bootstrap, page merges, shared realtime events and optimistic lifecycle
      through one transition owner.
- [ ] Migrate sidebar and channel consumers to narrow selectors/actions.
- [ ] GREEN all invariants, then delete superseded independent state/polling ownership.
- [ ] Confirm runtime child still owns one physical EventSource.

## 7. DEP-01 ADR and enforcement

- [ ] Inventory runtime/build dependency ownership across Python backend, Next/Bun
      server, websocket transport, auth and database adapters.
- [ ] Write ADR with allowed dependency directions and exceptions.
- [ ] Add the smallest maintainable import/package boundary checks.
- [ ] Reclassify DEP-01 accurately as resolved risk, accepted risk or separately scoped
      defect based on evidence.

## 8. Integrated gates

- [ ] Run OpenAPI/JSON/event contract snapshots and full backend pytest/Ruff.
- [ ] Run frontend tests/lint/typecheck/build and inspect bundle trend for regressions.
- [ ] Start isolated runtime and run `rtk ./twd` chat hydration, history prepend,
      optimistic send, reconnect, scope-switch and responsive-layout scenarios.
- [ ] Correlate duplicate/connection behavior with `rtk ./smallkhoj-trace`.
- [ ] Run `rtk proxy git diff --check`, CodeGraph refresh/status and Trellis validation.
- [ ] Update architecture docs/specs and record extraction commits/rollback points.

## STOP conditions

- Stop any move without characterization or on external OpenAPI/JSON/event drift.
- Stop if a shared abstraction hides auth/tenant/null/order differences.
- Stop if a module extraction creates cycles, import-time runtime work or hidden commits.
- Stop frontend cutover if two domain state owners remain active for the same scope.
- Stop and split product-visible changes into their owning task.
