# Implementation Plan

## Phase 0: Confirm Runtime Surface

- [ ] Run `codegraph explore daemon runtime codex slock` to locate current runtime integration points.
- [ ] Inspect installed Codex CLI commands and supported modes.
- [ ] Inspect the reference workspace behavior without printing credentials:
  - `MEMORY.md`
  - runtime session handoff JSONL
  - wrapper invocation behavior
- [ ] Review prompt references:
  - `research/prompt-reference.md`
  - `agent/daemon/slock-prompt-backup/claude-system-prompt.md`
  - `agent/daemon/slock-prompt-backup/.slock-kimi-system.md`
  - current `buildSlockSystemPrompt(...)` in `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`
- [ ] If an older Codex system prompt is provided, add it to the research notes and compare it against the Claude Slock prompt before implementing Codex prompt construction.
- [ ] Record findings in `research/codex-cli-runtime-surface.md`.

## Phase 1: Runtime Inventory

- [ ] Add `codex_cli` detection to daemon runtime inventory.
- [ ] Ensure backend/frontend runtime labels accept and display Codex.
- [ ] Add tests for inventory and runtime type propagation.

## Phase 2: Codex Runtime Driver

- [ ] Implement a driver parallel to `ClaudeRuntimeDriver`.
- [ ] Launch Codex in `workspacePath` with `.slock` wrapper directory first in `PATH`.
- [ ] Add Codex-specific prompt construction.
- [ ] Capture session id / process id / exit state where available.
- [ ] Implement busy/idle and queued-message behavior appropriate to Codex mode.

## Phase 3: Slock Contract Smoke

- [ ] Prove Codex can execute `slock server info` through the local daemon proxy.
- [ ] Treat warmup failure as a visible runtime activity/log event.
- [ ] Mask tokens in all diagnostics.

## Phase 4: End-to-End Message Flow

- [ ] Start a Codex-backed `AgentWorkspace`.
- [ ] Send a DM or channel message to that agent.
- [ ] Verify Codex receives the event and replies using `slock message send`.
- [ ] Verify backend Message/EventRecord/ActivityLog and frontend-visible reply.

## Phase 5: Regression

- [ ] Run daemon unit tests.
- [ ] Run targeted backend tests for runtime/workspace command generation.
- [ ] Run real-test evidence with `./smallkhoj-trace` and `./twd` where UI is involved.
- [ ] Confirm Claude runtime behavior still works.

## Suggested Worktree

```bash
git worktree add ../smallkhoj-daemon-codex-runtime -b feat/daemon-codex-runtime
cd ../smallkhoj-daemon-codex-runtime
```
