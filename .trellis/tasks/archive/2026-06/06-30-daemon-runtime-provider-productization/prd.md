# Productize daemon runtime provider detection

## Goal

Make daemon runtime provider detection and launch production-grade for other users' machines, not a local test workaround. The daemon must discover Claude Code, Codex, and CC Switch provider profiles in a platform-aware way on macOS, Windows, and Linux without hardcoded personal paths, without automatically invoking `cc-switch.ps1`, and without depending on provider-switching shell scripts as the normal launch path.

The immediate bug evidence is a Windows daemon trying to launch:

```text
C:\Users\...\ .claude\cc-switch.ps1 minimax MiniMax --allow-dangerously-skip-permissions ...
```

That fails because `cc-switch.ps1` is not the daemon runtime protocol and does not accept Claude Code stream-json arguments. Another workspace then falls back to `spawn claude ENOENT`, showing that the daemon did not resolve the local Claude Code executable path during computer connect/register.

## Confirmed Facts

- `agent/daemon/aaa-daemon/src/runtime/providers/cc-switch-provider.ts` currently hardcodes `/Users/lee/.local/bin/ccs-claude`.
- The same file automatically falls back to `$HOME/.claude/cc-switch.ps1` on Windows.
- Claude provider detection currently calls a `ccs-claude list` style command and parses its text output.
- Codex CC Switch provider detection is partly internalized through `loadCcSwitchCodexProviders(...)`, but it only queries `app_type='codex'`.
- Claude Code itself is not detected into the daemon provider inventory. `ClaudeRuntimeDriver` defaults to raw `claude`, which can fail when the daemon process PATH differs from the interactive user shell.
- Codex CLI detection exists, but uses hand-built home paths and does not cover common Windows `.cmd`/npm global paths.
- `.trellis/spec/backend/runtime-slock-integration.md` still documents the old script-based `ccs-claude` contract and must be corrected before implementation.

## Requirements

- **R1: No implicit provider scripts.** The daemon must not automatically discover or invoke `$HOME/.claude/cc-switch.ps1`, `ccs-claude`, or a hardcoded personal path as the normal provider launch mechanism.
- **R2: No personal hardcoded paths.** Daemon runtime detection must not contain `/Users/lee/...` or any other developer-specific path.
- **R3: Platform-aware command detection.** The daemon must detect local Claude Code and Codex commands using env overrides, PATH lookup, and common platform locations. Windows must include `.cmd`/npm global discovery.
- **R4: Product-safe CC Switch DB detection.** The daemon must read CC Switch provider metadata from the local DB when available, using env overrides or platform home discovery, without shelling out to switching scripts.
- **R5: Claude and Codex provider coverage.** CC Switch DB loading must support both `app_type='claude'` and `app_type='codex'`, returning sanitized providers for both runtime types.
- **R6: Local launch data stays local.** Paths, DB locations, provider settings JSON, API keys, env overrides, and command args must not be sent to the backend in heartbeat/register payloads.
- **R7: Provider launch resolves locally.** Selecting a Claude provider should launch the detected Claude Code command with daemon-generated runtime arguments and the provider model/config data, not a wrapper script. Selecting a Codex provider should use detected Codex/Codex ACP command data where applicable and not mutate global user state through scripts.
- **R8: Useful failure states.** Missing local commands should be represented as unavailable local capability or a clear launch error, not as a misleading `runtime started pid=unknown` followed by an opaque `ENOENT`.
- **R9: Backward compatibility by explicit opt-in only.** Manual provider JSON may still define local custom commands for advanced users/tests, but automatic script discovery must be removed. If a user wants a wrapper, they must configure it explicitly as a manual provider.
- **R10: Multi-platform testability.** Automated tests must cover the platform logic with fake env/PATH/DB data. This session can run macOS-side tests; Windows/Linux real tests will follow later on those machines.

## Acceptance Criteria

- [ ] Runtime provider spec no longer recommends `ccs-claude`/`cc-switch.ps1` as default product behavior.
- [ ] Runtime provider spec explicitly forbids hardcoded personal paths and implicit shell/PowerShell script discovery.
- [ ] Source code no longer contains `/Users/lee/.local/bin/ccs-claude`.
- [ ] Source code no longer automatically references `$HOME/.claude/cc-switch.ps1`.
- [ ] Unit tests prove Claude command detection supports env overrides, PATH lookup, and Windows `.cmd` style candidates.
- [ ] Unit tests prove Codex command detection supports env overrides, PATH lookup, and Windows `.cmd` style candidates.
- [ ] Unit tests prove CC Switch DB rows for `app_type='claude'` and `app_type='codex'` are parsed into sanitized provider capabilities without leaking secrets.
- [ ] Unit tests prove selecting a Claude CC Switch provider resolves to the detected Claude command, not `ccs-claude` or `cc-switch.ps1`.
- [ ] Unit tests prove selected provider command/path/args are not present in `detectedRuntimes`.
- [ ] Existing daemon runtime tests still pass on macOS.

## Out of Scope

- Real Windows machine validation in this session.
- Real Linux machine validation in this session.
- Building a complete CC Switch config writer if the current DB does not contain enough provider runtime configuration for true provider isolation. If the DB schema is insufficient, document the limitation and keep launch behavior local and non-scripted.
- Changing backend public APIs beyond any fields already required for sanitized runtime capability reporting.

## Open Questions

- None blocking. The product direction is explicit: production behavior for other users' machines, not local script-based test compatibility.
