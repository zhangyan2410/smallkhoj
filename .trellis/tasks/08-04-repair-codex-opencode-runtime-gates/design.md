# Design — Codex/OpenCode runtime gate repair

## 1. Boundaries

The repair crosses three existing boundaries without introducing a new runtime
adapter:

```text
Create Agent form
  -> POST /api/v1/members/agents
  -> public runtime normalization
  -> AgentWorkspace/runtime_start_command
  -> existing daemon Codex/OpenCode drivers

daemon ACP/process events
  -> ActivityLog runtime_warning/runtime_error
  -> existing activity API
  -> runtime activity group in the frontend

Integration Gate --runtime profile
  -> detected runtime + workspace selection
  -> optional daemon/runtime_control
  -> truthful Foundation steps/report
```

The first boundary needs one canonicalization fix. The second already has the
intended implementation but its test conflates two ordered observations. The
third needs a small profile model shared by report construction and CLI agent
selection.

## 2. Public runtime normalization

`backend.routers.public_api._normalize_runtime` remains the only validation
entry for public Agent creation. Add `opencode` and `open_code` aliases there;
do not broaden to daemon-internal `codex_cli`, `custom` or arbitrary strings.
The database model remains an unconstrained string because compatibility is
owned at the API/daemon boundaries.

## 3. Codex ACP diagnostic ordering

The process layer emits `exit` when the child terminates. The ACP bridge then
emits `error: ACP connection closed`. The daemon therefore owns two distinct,
chronologically valid diagnostic records:

1. process-exit `runtime_error`: `status=exited`, phase, exit code, signal and
   captured stderr;
2. driver-source `runtime_error`: the later ACP protocol closure error.

The test will wait for both rows and assert them separately. This preserves
causality instead of delaying or mutating the already-recorded exit activity.
No activity type is added to `ACTIVITY_EVENT_TYPES`, so warning/error telemetry
cannot loop back into a runtime as actionable work.

## 4. Integration Gate runtime profiles

Introduce a small canonical profile resolver in `foundation-gate.mjs`.
Runtime identity is derived from the canonical runtime type, never from model
or provider metadata:

| Runtime | Workspace runtime match | Detected runtime match | Context contract |
| --- | --- | --- | --- |
| `claude_code` | `claude` / `claude_code` | public `claude_code` | required (`/context`) |
| `codex` | `codex` / `codex_acp` | public `codex` | required (`/status`) |
| `opencode` | `opencode` | public `opencode` | not supported; explicit skip |
| `pi` | `pi` | bundled `pi` | not supported; explicit skip |

MiniMax may be the selected model/provider for a real test across these
runtimes, but that selection is recorded separately and never changes runtime
matching. For Pi, bundle detection proves only that the runtime executable is
present. Product copy makes no key/configuration promise in this task.

`buildFoundationGateReport` receives the canonical runtime target and uses it
for:

- target-runtime detection/readiness;
- reuse candidates;
- running/warmup candidates;
- session candidates;
- report target evidence, with provider/model metadata kept separate;
- applicability of context/compact steps.

The CLI uses the same exported profile/matcher for automatic `runtimeAgentId`
selection. An explicit `--runtime-agent-id` remains the final operator
override, but report construction still verifies that the selected snapshot
contains the requested runtime family.

## 5. Step and summary truth

Rename the provider-specific `minimax-runtime-ready` step to
`target-runtime-ready`; no other repository consumer references the old id.
The step returns a runtime-specific missing code and evidence containing the
canonical runtime and provider constraint.

Extend `step()` with `applicable:false`. Such a step has `status:"skip"`, no
failure, and bounded explanatory evidence. `report.ok` continues to mean zero
failed steps. Summary adds `skipped` while retaining `total`, `passed` and
`failed`. Default Claude/Codex runs still have 12 applicable steps; OpenCode
and Pi can pass with two honest skips and must format that fact explicitly.

## 6. Pi product boundary

Pi receives no special key product in this task. The frontend removes the
parenthetical `无需配 key` while retaining `Built-in Pi`. The existing backend
relay remains implementation detail, unchanged. Gate matching uses runtime
type `pi`, requires a running workspace/session, and marks unsupported context
controls as skipped. Pi is evaluated after the other three runtimes; a known
Pi 0.73.1 SSE reply blocker is reported honestly rather than repaired through
unplanned credential or provider architecture.

## 7. CLI compatibility and failure behavior

`run.mjs` parses `--runtime all|claude_code|codex|opencode|pi`, defaults to
`all`, normalizes before any network request, and fails with exit code 2 for
unsupported values. A matrix report aggregates one truthful Foundation report
per runtime; individual selection preserves focused diagnosis. The report
stores runtime identity separately from selected test model/provider and never
includes secrets or local command paths.

`--runtime` applies to Foundation readiness. Chat and collaboration modes keep
their existing explicit agent-id contracts; operators can run Foundation for a
runtime and then use the selected Agent id in a reply gate without changing
historical scenario semantics.

## 8. Isolated CC Switch test-provider safety

The real Codex/MiniMax case is a separate operational phase after the pure Gate
and focused runtime tests are green. Existing Codex and CC Switch state is
immutable; the only permitted write is one additive, uniquely named,
non-default test provider. The identifier contains a task/run discriminator so
the row cannot be confused with an existing provider or another test run.

Before any write, a read-only preflight must establish all of the following
without printing credentials or full configuration values:

1. the exact supported creation mechanism and storage boundary are known;
2. creation is append-only and does not switch, rewrite, reorder, disable or
   delete an existing provider;
3. current/default selectors can be observed and compared without exposing
   secrets;
4. the exact test-owned identity can be queried again for verification and,
   only when safe, cleanup.

The preflight records a secret-free structural baseline for every pre-existing
row and the current/default selectors. After creation it verifies that the
only structural delta is the new test-owned row and that current/default did
not change at any instant. The Gate receives the test provider through an
explicit test invocation; it does not call a provider-switching wrapper as
product behavior and never reports credentials, raw config, command paths or
arguments.

If the repository, installed CC Switch version or documented interface cannot
prove these invariants before writing, the real Codex/MiniMax case is reported
as blocked. The implementation and pure Gate contract can still complete; no
trial mutation is allowed. Cleanup may delete only the exact test-owned row
when both identity and delete semantics are certain. If cleanup cannot be
proven safe, leave the clearly named non-default test entry in place and report
that bounded residue instead of risking existing state.

## 9. Rollback and safety

- Reverting the two public aliases restores the old API behavior without data
  migration.
- Reverting the Gate profile changes restores the legacy MiniMax-only model;
  no persisted schema migration is involved, but that legacy coupling is not a
  compatibility requirement for this task.
- Codex/OpenCode runtime driver launch behavior is unchanged.
- Tests use fake transports/processes and temporary directories. No shared DB,
  daemon or provider session is required.
- A test-provider rollback is identity-scoped: it may remove only the exact
  test-owned row and must re-prove that all pre-existing rows and current/
  default selectors are unchanged.

## 10. Runtime-specific Activity translation

Add one pure daemon translation seam between driver `stream_event` payloads and
the existing shared Activity kinds. The seam branches explicitly by public
runtime family:

```text
Claude stream-json -> Claude compatibility translator
Codex ACP          -> acpUpdate translator
OpenCode SSE       -> opencodeEvent translator
Pi stream          -> current Pi compatibility translator
                         ↓
Working / Thinking / Output / Idle / Warning / Error
```

The translator returns protocol/source metadata plus semantic signals; daemon
state owns per-turn deduplication, ordered Activity POSTs, TaskRun counters and
the common result-to-Idle boundary. The observable contract is the existing
Claude Code behavior, independent of provider wire names:

```text
accepted inbound work                    -> Working on message
assistant analysis / narration preview   -> Thinking + details.thought
real tool execution                      -> Ran <tool> + details.commandPreview
provider completion boundary             -> Idle (persisted after prior rows)
```

OpenCode records `messageID -> role` and filters user text parts before the
translator; reasoning/thinking parts and assistant text are normalized into
assistant narration. Codex thought and message chunks use the same readable
Thinking product state. Generic connection/session events produce no Activity.
Terminal tool updates still contribute runtime/TaskRun completion telemetry,
but do not invent a second visible `Tool completed` row absent from the Claude
baseline. The daemon serializes Activity POSTs per runtime so a slow Output POST
cannot be persisted after Idle. No provider text path emits `Generated output`.

## 11. Aura command resolution

Wrapper generation remains per workspace and continues writing compatible
`slock`, `raft` and `aura` launcher files that all target `dist/slock-cli.js`.
The product command for managed runtimes is now only `aura`:

```text
runtime child PATH
  = <workspace>/.slock : <host PATH>

agent tool input
  = aura message send ...
  -> <workspace>/.slock/aura
  -> dist/slock-cli.js
  -> daemon-local proxy
```

This ordering matters because the package-level/global `aura` bin currently
names the daemon control entrypoint. Runtime-local PATH precedence makes the
collaboration meaning unambiguous without renaming internal `.slock`,
`SLOCK_*`, package or compatibility seams.

Claude, Codex/Codex ACP and Pi already use the shared PATH builder. OpenCode
must adopt the same environment builder, including proxy-secret removal.
Runtime prompts and daemon warmup use bare `aura`; they never interpolate an
absolute wrapper path or tell a model to inspect/fallback to that path.

Activity command preview sanitization remains responsible for removing proxy
environment lines and token-file paths. It no longer rewrites wrapper paths;
this makes an absolute path visible as an upstream regression instead of
making it look as though the provider executed a short command.

Clean-machine correctness is an installation-independent runtime invariant,
not a property of the developer shell. A first-start test creates a new
temporary HOME, workspace and wrapper, places a deliberately wrong host
`aura` later on PATH, and builds each runtime child environment from that
minimal base. Claude, Codex/Codex ACP, OpenCode and Pi must all put the new
workspace `.slock` directory first and execute the generated wrapper. The
wrapper invokes the daemon package's resolved `dist/slock-cli.js` with an
absolute Node executable, so no global collaboration CLI or user-home config
is needed.
