# Windows runtime launch and conversation validation

## Goal

Real Windows validation for daemon runtime provider productization: detect local Claude/Codex commands, start runtime successfully, and complete a real conversation without script-based cc-switch launch.

This task is the Windows-side follow-up for the runtime provider productization work already merged to `main`.

Relevant commits:

- `9bf1812 feat(daemon): productize runtime provider detection`
- `9344d41 chore(trellis): archive daemon runtime provider task`

## Requirements

- Run this validation on a real Windows machine, not through macOS-only unit tests.
- Use the latest `main` commit that contains the productized daemon runtime provider detection.
- Validate the daemon detects local runtime commands without hardcoded user paths, path concatenation, or implicit wrapper scripts.
- Validate the managed runtime can actually start from the daemon path used by the product, not from a manual one-off terminal launch.
- Validate a real conversation path: send a message to the agent runtime and receive a meaningful runtime reply through SmallKhoj/Slock.
- Record the result in this task directory as text evidence. Do not add large screenshots or binary evidence unless needed to explain a failure.
- If the machine has Claude Code installed, Claude Code runtime startup and conversation is required.
- If the machine has Codex CLI installed or configured, Codex runtime startup and conversation is required; otherwise record it as intentionally unavailable with the detection result.

## Acceptance Criteria

- [ ] Windows test machine is identified in `test-results.md` with OS version, shell, Node version, daemon package version/commit, and installed runtime commands.
- [ ] Daemon connect/register succeeds on Windows using the normal product command path.
- [ ] Runtime inventory/detection clearly reports the local Claude Code command when Claude Code is installed.
- [ ] Runtime inventory/detection clearly reports the local Codex command when Codex CLI is installed; if it is not installed, the unavailable state is explicit and non-crashing.
- [ ] Starting a `claude_code` managed runtime from backend/daemon control succeeds on Windows.
- [ ] The started runtime can receive a real SmallKhoj/Slock message and reply successfully.
- [ ] Logs do not show implicit `cc-switch.ps1`, implicit `ccs-claude`, hardcoded `/Users/lee/...`, or late `spawn claude ENOENT` / `spawn codex ENOENT` after claiming the runtime started.
- [ ] Runtime startup failure, if any, is captured as a clear unavailable/detection/startup error with the exact log excerpt and follow-up fix note.
- [ ] `test-results.md` contains pass/fail for each acceptance item and the exact commands used.

## Suggested Windows Validation Flow

1. Pull latest `main` and confirm the commit includes `9bf1812` or newer.
2. Start backend/frontend as needed for the local or cloud test target.
3. Build the daemon package on Windows.
4. Connect/register the Windows computer with the normal daemon command.
5. Create or select one Windows-backed agent workspace.
6. Start `claude_code` runtime from the product/backend path.
7. Send a unique marker message, for example `REAL_windows_runtime_<YYYYMMDDHHMMSS>`.
8. Verify the runtime replies in the channel/DM and that the reply is visible in product state.
9. Inspect daemon logs for forbidden script launches, hardcoded paths, and misleading `pid=unknown` startup.
10. Write the final result to `test-results.md`.

## Result File Contract

The Windows-side agent should update:

- `.trellis/tasks/06-30-windows-runtime-launch-conversation-validation/test-results.md`

The result must include:

- commit tested
- machine and shell details
- exact commands run
- runtime detection output summary
- conversation marker and reply summary
- relevant log excerpts
- pass/fail matrix
- remaining fixes, if any

## Related Context

- Spec: `.trellis/spec/backend/runtime-slock-integration.md`
- Archived implementation task: `.trellis/tasks/archive/2026-06/06-30-daemon-runtime-provider-productization/`
- Parent product task: `.trellis/tasks/06-09-runtime-provider-expansion/`
