# Carry-Over Scope Map

Date: 2026-07-06

This task is the implementation lane for the earlier Inkframe Trellis work. Do
not treat the older tasks as separate future ideas while implementing or
reviewing this branch.

## Task Graph Decision

`07-06-inkframe-material-runtime-chat-events-optimization` stays as a child of
`07-05-inkframe-product-ui-refactor`.

The earlier tasks `07-02-chat-event-unread-indicators` and
`07-04-ink-material-card-restore-resource` are already children of the same
`07-05` parent. They are intentionally not re-parented under `07-06`, because
Trellis records one parent per task and the current graph already says all
three are siblings inside the `07-05` product refactor.

The execution rule is stricter than the graph: the `07-06` implementation must
carry the relevant acceptance criteria from `07-02`, `07-04`, and `07-05`.

## Included Previous Tasks

| Task | Role In This Delivery | Must Be Proven By |
|---|---|---|
| `07-05-inkframe-product-ui-refactor` | Umbrella product acceptance contract | Product shell background, chat, task, mobile, object-language consistency |
| `07-04-ink-material-card-restore-resource` | Material lifecycle contract | Keep/restore/edit/discard/resource-revoke/repeated-keep tests |
| `07-02-chat-event-unread-indicators` | Chat attention contract | Backend-backed channel/DM/thread cursor state and frontend badges/markers |

## Product-Scope Translation

### From `07-05`

- Inkframe is the default product direction, not a long-lived alternate theme.
- Every user-facing product route should inherit the clean material-capable desk
  background through the product shell.
- Chat and task are the primary refined surfaces.
- Members, computers, and settings inherit the shared shell background, while
  full object-level redesign for those pages stays deferred.
- Mobile usability is part of the acceptance surface.

### From `07-04`

- A kept material surface restores after the same owner is rendered again.
- Restored material remains editable.
- Discard returns to the owner default.
- Private visual/restore/source resources are released on replace, discard, and
  page unload.
- Repeated keep for the same owner remains bounded.
- No backend, localStorage, or IndexedDB persistence for large ink/image blobs
  in this iteration.

### From `07-02`

- The old total/root-message count is not the primary product signal.
- Channel and DM sidebar rows show unseen activity.
- Thread/root message affordances show unseen replies.
- Viewing the corresponding channel, DM, or thread clears the attention state.
- The stored source of truth is backend read cursor metadata, with frontend
  realtime state only as optimistic/fallback overlay.

## Current Child Work Already Completed Under This Parent

- `07-06-inkframe-proof-runner-product-shell-route-sweep`
  - route sweep now covers `/chat`, `/tasks`, `/members`, `/computers`, and
    `/settings`.
- `07-06-07-06-inkframe-app-background-material-action-contract`
  - app desk actions are normalized to activate/draw/water/keep/discard/static
    mode and pointer-capture contracts.
- `07-06-07-06-inkframe-proof-runner-app-background-material-surface-contract`
  - proof runner verifies both outer app background and inner `MaterialSurface`
    metadata for product-shell routes.

## Remaining Combined Finish Line

The code-level merge may proceed because the user explicitly accepted
browser/mobile proof deferral for this pass. Screenshots are not treated as
acceptance evidence. Real browser or true-device validation remains a follow-up
preview/verification activity.

The most important remaining product proof is:

- connected-browser proof for clean material-capable background across product
  routes;
- chat message/material behavior with readable long messages;
- task board/list/detail material behavior;
- mobile 390px reachability and no horizontal overflow;
- unread/channel/DM/thread attention state clearing and surviving refresh.
