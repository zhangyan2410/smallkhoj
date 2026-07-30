# Address Integration Gate final review P2s

## Goal

Red-to-green repair for the two independently reproduced P2 findings on Integration Gate collaboration audience resolution and daemon control-result collection.

## Requirements

- When collaboration execution starts with a channel name but no durable
  `--channel-id`, use the ID returned by the message send response to load the
  channel membership before evaluating V1/V2/V3 audience evidence.
- Preserve the existing fast path when `--channel-id` is supplied and avoid a
  duplicate membership request for the same resolved channel.
- A daemon control observation must never claim output from an unrelated
  active turn. If the control message cannot be delivered immediately, fail
  closed with explicit delivery state instead of collecting the shared stream.
- Detach result listeners immediately when sending throws, and bound captured
  assistant output so a long stream cannot grow control-plane memory without
  limit.
- Keep public method names and Integration Gate result schema compatible.
- Do not modify or clean the user-owned dirty root worktree.

## Acceptance Criteria

- [x] A CLI regression test without `--channel-id` fails before the fix and
  passes after the send-returned channel ID is used to load members.
- [x] Existing explicit-`--channel-id` collaboration behavior and all seven
  Integration Gate mode tests remain green.
- [x] Daemon tests prove that busy/rejected delivery cannot consume unrelated
  assistant/result events as control output.
- [x] Daemon tests prove listener cleanup on send failure and bounded output
  capture for oversized streams.
- [x] Daemon TypeScript build and full daemon test suite pass.
- [x] Canonical `make ci`, Integration Gate tests, and `git diff --check` pass
  on the final review-fix commit.
- [x] The independent reviewer explicitly approves the new final SHA with no
  unresolved P0/P1/P2 findings.

## Notes

- Source review: exact SHA `872e3d16fae4840aabe1e1f068d074175f325870`,
  verdict `REQUEST CHANGES` with two P2 findings.
- These are independent boundary defects, not a shared failure-mode family:
  one is late identity resolution; the other is uncorrelated asynchronous
  event collection.
