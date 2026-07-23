# Architecture debt reduction design

## Design principle

The unit of decomposition is an ownership cell:

```text
contract + state/transaction owner + cohesive operations + tests + dependency edge
```

Lines move only after the cell is named and characterized. Thin files with confused
ownership are not success; moderately sized modules with one contract are.

## Backend target shape

```text
routers/public_api.py (composition, shared route dependencies)
  -> routers/public/{auth_members, channels_messages, tasks, files, events}.py
  -> services/{members, messages, tasks, uploads, event_delivery}.py
  -> models / repositories where existing project conventions support them

routers/agent_api.py (composition, agent dependencies)
  -> routers/agent/{identity, channels_messages, tasks, files, events}.py
  -> same stable domain services through agent-specific adapters
```

Exact module names follow `.trellis/spec/backend` and live domain boundaries. Public
and agent adapters own request/response/auth differences. Services accept primitive
IDs/domain values and an explicit session/uow; they do not open hidden sessions or
commit unexpectedly.

### Route inventory record

For each route:

| Field | Captured contract |
|---|---|
| method/path/name/tag | OpenAPI identity |
| request/body/query/header | parsing/defaults/validation |
| auth/scope | dependency and denial status |
| transaction | read/write/flush/commit/event ordering |
| response | schema/status/headers/JSON snapshot |
| side effects | activity/event/file/realtime effects |

Inventory can be generated from OpenAPI plus hand-checked side-effect metadata.

## Shared serialization target

```text
batch-loaded projection data
  -> pure domain primitives (timestamps, member refs, attachments)
  -> public response adapter
  -> agent response adapter
```

The runtime/query child owns query loading. This child may move/extract pure mapping,
but may not reintroduce lazy database access. Type signatures distinguish `_UNSET`,
known `None` and a concrete prefetched value.

## Feishu/outcome consolidation decision

Build a semantic comparison table before extraction:

| Candidate | Input normalization | missing/null | errors | output | consumers |
|---|---|---|---|---|---|
| adapter `_nested` | to capture | to capture | to capture | to capture | adapter |
| transport `_nested` | to capture | to capture | to capture | to capture | transport |
| outcome helpers | to capture | to capture | to capture | to capture | orchestration modules |

Only rows that match in every contract dimension move to a named shared module. Other
duplicates remain and receive a comment/ADR explaining intentional divergence.

## Frontend state topology

```text
ChatDataProvider / normalized state owner
  identity scope: account + server + channel + generation
  entities: channels, DMs, members, messages, threads
  transitions: bootstrap, page merge, realtime, optimistic, rollback, scope reset

ChannelClient (composition)
  -> Timeline (projection + scroll controller)
  -> Composer (draft/send/upload actions)
  -> ChatSidebar (shared projections)
  -> Inspector/Dialogs (narrow view state)
  -> Responsive panels (local layout state)
```

One reducer/query-cache adapter establishes event precedence. Every async result carries
the scope generation; results from an old generation are ignored. Entity merge uses
stable IDs and version/timestamp/sequence semantics captured from the backend contract.

### Chat transition invariants

1. One committed message ID appears once after optimistic acknowledgement/realtime.
2. Rollback affects only its optimistic operation and never deletes a later server row.
3. Older pagination cannot overwrite a newer realtime/entity version.
4. Account/server/channel switch clears or namespaces all prior scoped entities.
5. Sidebar and timeline observe the same member/channel facts.
6. Scroll position rules remain unchanged for history prepend versus new message.

## Extraction sequence

1. Contract inventory and characterization only.
2. Pure constants/types/codec helpers with no behavior change.
3. One backend domain router at a time; composition roots keep compatibility exports
   temporarily if required.
4. Pure shared serializer/helper extraction with snapshot proof.
5. Frontend view components and local UI hooks.
6. Introduce authoritative state transition owner behind the existing interface.
7. Migrate sidebar/timeline consumers, then delete the superseded owner.
8. Remove compatibility exports and enforce dependency edges.

## Verification

Backend uses OpenAPI diff, response snapshots, focused route suites, full pytest/Ruff
and event/transaction characterizations. Frontend uses reducer/property cases,
component tests, build/bundle checks and `./twd` chat flows covering hydration, history
prepend, optimistic send, reconnect, scope switch and responsive layout.

## Rollback

Each extraction commit preserves the prior public import/interface until all consumers
migrate. State-owner cutover uses an internal adapter boundary; rollback returns the
adapter to the prior implementation without changing backend contracts. Compatibility
layers have explicit deletion checkpoints so they do not become permanent duplication.
