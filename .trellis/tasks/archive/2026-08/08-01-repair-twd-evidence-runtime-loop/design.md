# TWD Evidence Truth and Runtime Loop Design

## Finish Line

`./twd` can be trusted as a fail-closed evidence boundary, and that trust is
demonstrated by a marker-bearing real SmallKhoj agent/channel/task conversation
running from the feature worktree.

## Boundaries and Ownership

```text
./twd shell launchers (argument/interpreter forwarding only)
  -> twd.py (candidate bridge selection, CLI JSON/exit contract, commands)
  -> tmwebdriver_core.py (delivery/ACK/final-result lifecycle)
  -> HTTP master + WebSocket bridge
  -> Chrome extension (tab execution)

tools/twd-guard/twd-auth-guard.mjs
  -> exact-tab authentication
  -> navigation
  -> bounded exact-tab URL probe
  -> full target assertion
```

The core owns request lifecycle truth. The CLI owns stable command-level JSON
and exit semantics. The guard owns authenticated navigation and final target
proof; it must not reinterpret lower-layer uncertainty as success.

## Contracts

### Execution lifecycle

Each execution id is logically in one of these states:

| State | Event | Next state | Public outcome |
| --- | --- | --- | --- |
| created | payload sent | awaiting_ack | none |
| awaiting_ack | ACK received | awaiting_result | none |
| awaiting_ack | deadline | terminal_failed | delivery timeout |
| awaiting_result | result received | terminal_success | returned data |
| awaiting_result | error received | terminal_failed | script/bridge error |
| awaiting_result | deadline | terminal_failed | result timeout |
| any pending | tab disconnect/reload without final result | terminal_failed | interrupted/uncertain |

Terminal failure removes owned ACK/result bookkeeping. A late result for an id
that no longer has a waiter may be discarded or bounded; it cannot turn the
already failed CLI invocation into success.

### Bridge selection

Candidate session metadata is collected before selecting a bridge:

1. Explicit CLI/env port wins without discovery.
2. Exact tab chooses the unique candidate containing that session id.
3. URL match chooses the unique candidate containing a matching URL.
4. Multiple owning candidates fail with port/id/url diagnostics.
5. Selector supplied but no candidate owns it fails closed rather than choosing
   an unrelated populated bridge.
6. Selector-free legacy commands retain deterministic preferred-candidate
   behavior; `tabs` is the diagnostic exception and aggregates live candidates.

The guard starts a missing preferred master with an explicit `--port` identical
to the control port it waits for.

### Navigation proof

`goto` initiates navigation; acceptance is a separate bounded probe. The probe
returns at least `href`, `origin`, `pathname`, `search`, `hash`, `title`, and
`readyState`. The guard accepts only when the normalized actual URL equals the
target components and the document is ready. Polling remains on the same tab id.

A `/login` result on the intended frontend origin permits one re-authentication
cycle on the same tab. Other stale URLs remain pending until timeout and never
trigger discovery fallback.

## Compatibility

- Existing `--port` and `TWD_PORT` behavior remains unchanged.
- Existing exact-tab no-fallback and ambiguous URL-match safeguards remain.
- Legacy callers may omit `--tab`, but guarded code switches to exact tab after
  initial selection.
- Successful JSON fields remain compatible; failures become stricter by design.

## CLI Error Shape

Handled command failures emit a single JSON object. At minimum:

```json
{"ok":false,"code":"EXECUTION_TIMEOUT","message":"...","tabId":"..."}
```

The exit code is nonzero. Exact codes may distinguish delivery timeout, result
timeout, interrupted navigation, no matching bridge, and ambiguity, but no
consumer needs to parse human timeout strings to detect failure.

## Real Runtime Verification

Use a sibling worktree and isolated local service ports. Create a disposable
operator-approved browser tab, authenticate it through the existing trusted
local guard, and record its exact tab id. All subsequent UI interactions and
assertions use that id.

The scenario uses a unique `TWD_REAL_<timestamp>` marker across:

- created agent/channel/task names or descriptions;
- sent user chat message;
- agent reply;
- visible DOM evidence;
- `smallkhoj-trace` and API/database cross-checks.

The loop is complete only when the same marker and identities agree across the
browser and runtime/control-plane evidence.

## Rollback and Safety

- Source rollback is limited to the feature branch/worktree.
- Runtime fixtures are uniquely named and disposable; cleanup must not touch
  unrelated operator resources.
- Exact-tab mode forbids unrelated tab enumeration after selection.
- If local services cannot be isolated, stop the runtime step and repair the
  environment rather than testing the cloud tab or another worktree.

## Trade-offs

- Polling adds bounded latency but removes false acceptance from navigation
  races.
- Aggregating candidate sessions adds small local HTTP probe cost but is safer
  than first-nonempty selection.
- Fail-closed timeout behavior may surface previously hidden failures; this is
  the intended compatibility break for evidence correctness.
