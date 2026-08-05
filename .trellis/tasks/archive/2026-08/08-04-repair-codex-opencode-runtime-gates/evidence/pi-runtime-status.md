# Pi runtime reply evidence boundary

Current decision: Pi receives strict runtime-family/session Gate checks and
explicit context-control skips, but no new key-entry or credential product.
The current protected shared database was not used for a new Pi reply attempt.

Historical real evidence remains the latest safe reply-path evidence:

- `.trellis/tasks/archive/2026-07/07-28-runtime-select-guide/evidence/real-pi-relay-test.md:9-11`
  detected bundled Pi `0.73.1`.
- Lines 12-19 record successful Agent creation, running Pi workspace/process,
  and lease transitions `waiting -> active -> released` without a failure code.
- Lines 20-24 record backend relay HTTP `200 OK`, direct MiniMax HTTP `200`,
  model `MiniMax-M3`, and a valid provider reply/usage payload.
- Lines 26-30 record the terminal Pi SSE adapter error:
  `Cannot read properties of undefined (reading 'input')`.
- Line 31 records that the aborted turn produced no persistent DM reply.

Therefore relay/provider HTTP 200 is not a Pi runtime reply PASS. The exact
external/package blocker is Pi 0.73.1's Anthropic SSE usage mapping when an SSE
event omits the expected usage shape.
