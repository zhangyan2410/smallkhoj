# Carried By 07-06 Implementation

Date: 2026-07-06

This task is intentionally carried by:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

The original `07-02` requirement was not treated as a standalone decorative
badge task. It became the chat attention/read-cursor contract for the `07-06`
implementation line:

- channel and DM unread state is projected from backend read cursor metadata;
- thread/root-message attention state is projected from thread read cursors;
- frontend local realtime state remains an optimistic/fallback overlay, not the
  source of truth;
- cursor writes are hardened for `lastReadSeq`, request body shape, scope shape,
  channel/DM scope-kind mismatch, monotonic writes, and thread last-seen
  validation.

Relevant completed child tasks:

- `.trellis/tasks/07-06-chat-unread-frontend-cursor-contract-hardening`
- `.trellis/tasks/07-06-chat-read-cursor-postgres-monotonic-scope-completion`
- `.trellis/tasks/07-06-07-06-chat-read-cursor-last-read-seq-input-hardening`
- `.trellis/tasks/07-06-chat-read-cursor-request-body-scope-hardening`

Current evidence status:

- backend cursor tests and frontend unread compatibility tests pass;
- Trellis check workers reported `0 open` P1/P2 blockers for the latest cursor
  hardening slices;
- real browser/sidebar/thread visual proof is still blocked by
  `./twd --compact tabs` returning no connected tabs.

Do not re-implement this as local-only badge decoration. Future work should
continue from the backend-owned cursor contract under the `07-06` / `07-05`
product acceptance frame.
