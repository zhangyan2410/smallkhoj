# Merged Scope Lock

Date: 2026-07-06

The operator clarified that the earlier Trellis task(s) must be done together
with the Inkframe product refactor, not treated as optional follow-ups.

## Included Tasks

- `07-05-inkframe-product-ui-refactor`
  - Parent product acceptance frame.
  - Defines the target: Inkframe as the default product UI direction, clean
    material-capable desk background across product pages, and full chat/task
    surface refactor.
- `07-04-ink-material-card-restore-resource`
  - Required material-runtime contract.
  - Kept ink must restore after re-render.
  - Restored ink remains editable.
  - Discard returns to owner default.
  - Replace/discard/unload revoke private object URLs.
  - Repeated keep does not grow private resource state.
- `07-02-chat-event-unread-indicators`
  - Required chat attention contract.
  - Channel and DM sidebar entities show unseen activity.
  - Thread markers show unseen replies on the related root message.
  - Opening/viewing clears the attention state.
  - The implementation should use backend cursor state when available, with the
    local frontend adapter only as a fallback/optimistic layer.
- `07-06-inkframe-material-runtime-chat-events-optimization`
  - Current integrated implementation vehicle for the merged scope above.

## Non-Negotiable Interpretation

The product refactor is not complete if:

- the material restore/resource lifecycle from `07-04` only works in the old
  demo and regresses in productized `MaterialSurface`;
- the unread/event behavior from `07-02` remains a separate visual badge patch
  instead of becoming part of the shared Inkframe sidebar/message primitives;
- the global background remains a static CSS afterthought rather than the
  shell-owned material-capable desk foundation;
- chat/task are visually polished but mobile/browser/runtime evidence is not
  collected with `./twd` once a browser tab is connected.

## Allowed Cuts

Only these cuts are allowed if time forces a narrower pass:

- no backend storage of large ink/image blobs;
- no localStorage or IndexedDB persistence for ink images;
- no full object-level redesign for members/computers/settings beyond the
  shared product-shell background;
- no cross-refresh persistence for arbitrary material drawings.

Backend read cursor metadata is small and product-relevant, so it remains part
of the integrated chat unread/event contract.
