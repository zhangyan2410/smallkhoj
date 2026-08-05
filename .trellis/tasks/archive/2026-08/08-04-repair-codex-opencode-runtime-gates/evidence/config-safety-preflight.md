# CC Switch additive-provider safety preflight

Status: `BLOCKED_SAFE_PROVIDER_CREATION`

No CC Switch or Codex provider/configuration write was attempted.

## Read-only repository evidence

- `agent/daemon/aaa-daemon/src/runtime/providers/cc-switch-provider.ts:49-61`
  invokes the read-only `ccs-claude ... list` inventory path.
- `agent/daemon/aaa-daemon/src/runtime/providers/cc-switch-provider.ts:67-89`
  opens the configured SQLite database only to execute a `SELECT` over
  provider rows. The repository exposes no corresponding provider
  `INSERT`/`UPDATE`/`DELETE` API.
- `.trellis/spec/backend/runtime-slock-integration.md` documents provider
  detection/inventory and explicitly forbids using switching scripts or
  mutating global CC Switch state as product launch behavior.

Repository search found no documented operation that can prove, before a
write, all required invariants:

1. append exactly one uniquely named test-owned row;
2. never change current/default selection, even transiently;
3. never rewrite, reorder, disable, or delete a pre-existing row;
4. re-query and safely delete only the exact test-owned row.

Per the task design's fail-closed rule, the Codex/MiniMax real provider case is
blocked. Existing CC Switch/provider state remains untouched; there is no test
entry to clean up.
