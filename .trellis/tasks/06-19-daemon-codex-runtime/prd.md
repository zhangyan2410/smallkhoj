# Daemon Codex Runtime Integration

## Goal

Add Codex CLI as a daemon-managed runtime for SmallKhoj/Slock while preserving the existing product architecture:

- backend remains the FastAPI control plane
- daemon remains the local execution boundary
- runtime-to-backend writes continue through `slock` CLI -> local daemon proxy -> Agent API
- EventRecord remains the daemon delivery stream
- ActivityLog remains the human-facing activity projection

The goal is not to copy Clowder's backend-spawn model or ACP path. The goal is to let a SmallKhoj agent run on Codex through the same daemon/proxy/Slock boundaries that Claude currently uses.

## Background

SmallKhoj currently has a working daemon architecture:

- `Computer` connects through a short-lived connect ticket and receives a machine token.
- `AgentWorkspace` describes the agent runtime slot on a computer.
- backend sends `start_runtime` / `stop_runtime` / `restart_runtime` control commands through `DaemonControlHub`.
- daemon starts Claude Code today.
- Claude is instructed to use the generated `slock` wrapper.
- `slock` calls are routed through the local daemon proxy into `/internal/agent-api/*`.
- daemon reports runtime activity (`runtime_working`, `runtime_thinking`, `runtime_output`, `runtime_idle`) to the backend.

Codex support should extend this path. It should not introduce a parallel product architecture.

## Reference Workspace

Use this existing Slock-managed Codex agent workspace as an implementation reference:

```text
/Users/lee/.slock/agents/be8b7e8d-a7c6-48ac-9e71-da8faa799eda/
```

Observed files:

- `MEMORY.md`: identifies the agent as `codex-m-krill` and notes startup instructions include `/Users/lee/.codex/RTK.md`.
- `.slock/runtime-sessions/codex-019ed992-09a0-7131-ac5d-5fa5630dbfbd.jsonl`: daemon-created handoff recording the Codex runtime session id.
- `.slock/slock`, `.slock/raft`, `.slock/opencli`: generated local wrappers. Treat these as credential-bearing wrappers; inspect behavior carefully and do not print embedded tokens.

Important finding: the workspace does not contain a full native Codex transcript on this machine. Implementation must verify Codex startup/session behavior directly rather than assuming the handoff file is enough.

Prompt reference status:

- No Codex-specific Slock system prompt file was found in the checked local paths.
- Use `agent/daemon/slock-prompt-backup/claude-system-prompt.md` as the best current Slock CLI operating-contract reference.
- Use `agent/daemon/slock-prompt-backup/.slock-kimi-system.md` only as an older MCP-oriented contrast, not as the target design.
- If the older Codex system prompt is provided later, compare it against the Claude Slock prompt and update this task's prompt plan.
- Detailed notes are in `research/prompt-reference.md`.

## Product Requirements

1. A user can create or configure an agent with `runtime=codex_cli` from the existing Members / Control Plane surfaces.
2. A connected daemon can detect Codex CLI availability and report it in `detectedRuntimes`.
3. The backend can issue a `start_runtime` command for a Codex-backed `AgentWorkspace`.
4. The daemon can launch Codex as a managed runtime in the selected workspace path.
5. The Codex runtime receives the same Slock operating contract:
   - use `slock` CLI for server info, reading messages, sending replies, task operations, attachments, and profile operations
   - do not call backend APIs directly
   - do not rely on MCP message/task tools as the main communication path
   - preserve a cache-friendly stable prompt prefix where possible; runtime-specific volatile context should be appended after stable Slock/Codex operating rules
6. Codex runtime writes go through the generated `slock` wrapper and local daemon proxy.
7. backend-visible message, task, event, and activity behavior remains consistent with Claude runtime behavior.
8. The frontend can show Codex runtime status using the existing AgentWorkspace / Activity surfaces.

## Non-Goals

- Do not replace the FastAPI backend.
- Do not switch SmallKhoj to Clowder's backend-managed AgentService model.
- Do not introduce ACP as the Codex integration requirement.
- Do not redesign WorkSession / RuntimeSession / Invocation models in this task.
- Do not add a broad retry/reset UX for stuck runtimes.
- Do not bypass the `slock` CLI / local daemon proxy / Agent API boundary.
- Do not implement every future runtime provider at once.

## Proposed Scope

### Phase 1: Runtime Inventory and Configuration

- Add Codex detection to runtime provider inventory.
- Ensure `runtime=codex_cli` is accepted by daemon runtime configuration and frontend/backend runtime labels.
- Ensure agent creation can persist Codex runtime configuration into `AgentWorkspace`.

### Phase 2: Codex Runtime Driver

- Add a Codex runtime driver parallel to the Claude runtime driver.
- Launch Codex CLI in the workspace directory with the generated `.slock` wrapper first in `PATH`.
- Inject a Codex-compatible system/developer prompt that explains the Slock contract.
- Parse Codex output enough to:
  - mark busy/idle
  - surface activity events
  - collect basic result/error state
  - avoid treating warmup/tool noise as user-facing output

### Phase 3: Warmup and Slock Contract

- Reuse the existing warmup idea: Codex should prove it can call `slock server info` before being treated as ready.
- Codex startup may degrade to ready after timeout only if this matches the existing daemon policy.
- Failed warmup should produce clear activity/log evidence.

### Phase 4: End-to-End Flow

- Start a Codex-backed agent from the control plane.
- Send a channel or DM message to that agent.
- Codex receives the event through daemon delivery.
- Codex replies through `slock message send`.
- Backend writes Message + EventRecord + ActivityLog.
- Frontend shows the reply and activity evidence.

## Acceptance Criteria

- [ ] `runtime=codex_cli` appears as a supported runtime option in the relevant backend/frontend/daemon surfaces.
- [ ] Daemon runtime inventory reports Codex when the CLI is available.
- [ ] Backend can create an agent workspace targeting `codex_cli`.
- [ ] Daemon can receive `start_runtime` for a Codex workspace and launch Codex.
- [ ] Codex startup writes `.slock` wrappers and has `PATH` ordered so `slock` resolves to the generated wrapper.
- [ ] Codex receives a Slock-specific operating prompt.
- [ ] Codex can run `slock server info` through the local daemon proxy during warmup or smoke validation.
- [ ] A real Codex-backed agent can receive a backend message event and respond through `slock message send`.
- [ ] ActivityLog records useful Codex runtime states (`working`, `thinking/output` where available, `idle`, and failures).
- [ ] Claude runtime behavior is not regressed.

## Validation Plan

- Unit tests for Codex runtime command construction and environment setup.
- Unit tests for Codex output parsing / busy-idle state where parser behavior is deterministic.
- Daemon smoke test that starts Codex in a controlled mode and verifies `slock server info`.
- Backend test or integration smoke proving `AgentWorkspace(runtime=codex_cli)` produces a valid `start_runtime` command.
- Real runtime evidence:
  - daemon log snippet showing Codex launch
  - warmup or smoke evidence for `slock server info`
  - message reply written through `/internal/agent-api/send`
  - frontend or API evidence showing the reply and activity rows

## Open Questions

1. Which Codex CLI invocation should be the default for daemon-managed runtime?
   - Recommended default: use the installed `codex` CLI in a non-interactive / JSON-capable mode if available, but verify the current CLI behavior before implementation.
   - Why it matters: Codex CLI flags and output format determine driver design and parser complexity.

2. Should Codex be allowed to run long-lived interactive mode, or should the first version use per-message invocation?
   - Recommended default: prefer the closest long-lived mode that can receive incremental messages if Codex supports it; otherwise start with a constrained per-message mode and document the limitation.
   - Why it matters: daemon currently manages long-lived runtime drivers; per-message invocation may behave differently from Claude.

3. What is the minimum acceptable activity fidelity for Codex?
   - Recommended default: `working` and `idle` are required; `thinking/output` are best-effort depending on Codex stream shape.
   - Why it matters: product consistency matters, but overfitting to unstable CLI event formats is risky.

4. Which write permissions should Codex receive by default?
   - Recommended default: same write gate as Claude; writes still require Slock wrapper/proxy policy and any existing allowlist.
   - Why it matters: Codex integration must not weaken Slock's commercial/product safety boundary.

## Product Position

This task strengthens SmallKhoj's own architecture. It keeps daemon as the execution bridge and Slock CLI as the agent operation interface. Codex becomes another managed runtime behind the same product contract, not a reason to reshape SmallKhoj into another project's architecture.
