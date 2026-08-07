# Implementation plan

This is one end-to-end implementation session. The phases below are ordered checkpoints inside the same Trellis task; they are not separate child tasks or separate acceptance tracks.

## Phase 0 — Baseline and contracts

1. Record the current dirty state and verify the existing daemon command-generation tests, daemon package build, and Computers route behavior.
2. Add focused tests first for the new structured platform command response and just-in-time ticket creation, preserving the legacy Unix `command` assertion.
3. Confirm the real Windows x64 acceptance machine and capture its native architecture, PowerShell version, PATH, and existing Aura/legacy process state before testing.

## Phase 1 — Release and artifact pipeline

1. Extend the daemon distribution builder to stage a Windows x64 standalone layout containing `aura.exe`, private Node runtime, `dist`, production dependencies, N-API/WASM resources, manifest, and checksums.
2. Generate an `install.ps1` that detects native architecture, downloads an immutable manifest/artifact, verifies SHA-256 and version, stages into `%LOCALAPPDATA%\\Aura\\versions`, updates the user PATH, and switches the active launcher atomically.
3. Extend the macOS release to `darwin-arm64` and `darwin-x64` managed standalone layouts containing a private Node runtime, `dist`, production dependencies, pinned local Codex ACP entry, manifest, and sidecars. Keep internal `smallkhoj-daemon` artifact naming and npx only as compatibility/development output.
4. Replace the fixed Unix installer with a manifest-driven Ensure installer: UI-pinned or latest-compatible version selection, Rosetta-safe architecture detection, same-artifact zero-download reuse, integrity repair, upgrade/no-downgrade, offline reuse, atomic version/active/launcher promotion, and fail-closed current-shell command discovery.
5. Add executable installer integration tests with a temporary HOME/PATH and counted fake HTTP carrier. Cover first install, repeated same-version archive request count zero, corruption repair, upgrade, no-downgrade, offline reuse, failed staging rollback, and PATH/profile idempotence.
6. Add Windows/macOS build/release jobs (or equivalent reproducible commands) and publish artifacts through the existing `/downloads/smallkhoj-daemon` cloud/static boundary.

Risk checkpoint: if Node runtime packaging, native modules, or WASM cannot be made reliable, stop and revise the design before touching onboarding UI.

## Phase 2 — Aura local CLI and daemon identity

1. Add platform-aware path resolution and an Aura-facing launcher while keeping the TypeScript/Node development entrypoint.
2. Implement idempotent `aura setup`: create/read config, generate/reuse machine ID, detect existing process/config/legacy state, write user ACL-protected credential paths, and support explicit reset/regenerate.
3. Implement version inspection, immutable artifact selection, no-downgrade default, and staged upgrade/rollback behavior.
4. Implement reconnect process/lease handling: graceful stop only for a stale local daemon with expired remote lease; no force kill; clear conflict on active lease.
5. Implement `aura restart`, expanded `status`, and read-only `doctor`. Stop waits for exit, stale PID is handled explicitly, restart waits for local health, and a missing credential never falls back to prototype identity or creates remote state.
6. Launch Codex ACP from the verified local release path instead of production-time nested npx. Keep other runtime providers external and report unavailable providers without failing core daemon installation.

## Phase 3 — Backend command and ticket contract

1. Add immutable release metadata (version, platform, URL, SHA-256, minimum version) to the download/release response.
2. Split preview/setup metadata from Connect ticket generation. Opening the dialog, changing tabs, or rendering any phase card must be ticket-free; create `sk_connect_` only from the explicit Connect/“generate command” or Reconnect action, preserving the five-minute TTL and existing server conflict checks. Return `expiresAt` only from that ticket-generating response.
3. Return platform-structured Install/Setup/Connect commands with explicit shell labels. Keep the old Unix `command` field during compatibility rollout.
4. Pin the backend-advertised published version in the macOS Install command, remove PATH export/source instructions, and generate Setup/Connect commands against the stable launcher.
5. Add tests for Windows vs Unix commands, ticket timing, expiry/regeneration, version metadata, no-export launcher commands, and reconnect name/machine-ID behavior.

## Phase 4 — Computers UI and i18n

Layout, component layering, state matrix, i18n keys, `data-testid` hooks, and `./twd` assertions follow `ui-design.md`.

0. Add the shared `components/ui/tabs.tsx` atom (none exists today) per the ink-border and accent rules in `ui-design.md` §3, and register it in `component-guidelines.md`.
1. Extend `CredentialResponse` and server-action data flow for structured platform commands and phase status.
2. Add explicit mutually exclusive Windows / macOS/Linux tabs with browser-platform default and manual override.
3. Render all three phase cards for the selected platform using shared atoms/tokens; show only the selected platform's commands and copy affordances.
4. Add Chinese-first guidance and equivalent English translations for PowerShell/Terminal instructions, expected output, permissions, retries, expiry, conflicts, and Online/failure states.
5. Add bounded pending state, fresh-ticket regeneration, and actionable failure recovery without local “completion” checkboxes. Regeneration must call the same explicit Connect/Reconnect action rather than reusing a ticket created during preview.
6. Update the old one-command frontend spec and its tests to the new platform-mutual-exclusion contract.

## Phase 5 — Verification and real acceptance

### Local/macOS/Linux

- Run the focused backend command-generation/ticket tests, distribution installer integration tests, daemon TypeScript build, lifecycle/ACP tests, and Integration Gate contract suite.
- Execute the exact product `curl .../install.sh | SMALLKHOJ_DAEMON_VERSION=<version> sh` command against an identified carrier with an isolated install/state root; rerun it and prove the archive request count stays zero for the same complete artifact.
- In the same test environment, prove bare `aura --version`, `aura status`, and `aura doctor` resolve without manual PATH commands; run Setup twice and prove identity reuse.
- Generate a fresh Connect ticket from the same candidate, run the installed `aura` Connect command, and prove register + heartbeat Online.
- Add a `tools/integration-gate` product-semantic mode/evidence contract that sends a unique marker to a real Claude Code Agent and passes only when the persisted visible reply and Aura/slock send evidence are both correlated to the same Server/Computer/Agent/Channel candidate.
- Run that Gate against the installed artifact and require PASS. Browser evidence is not required for this additional gate; API/trace/Gate evidence is required. Fake upstream tests do not satisfy it.
- Keep the existing Unix npx connect/reconnect tests as compatibility coverage, not as macOS product acceptance.

### Windows x64 real host (required)

1. Verify architecture and PowerShell version with native Windows APIs.
2. Install on a clean user profile with no Node/npm/npx.
3. Verify `%LOCALAPPDATA%\\Aura` layout, PATH, private Node runtime, sidecar resources, manifest/checksum, and `aura --version`.
4. Run Setup, inspect machine ID/config/credential ACLs, restart the shell, and rerun Setup idempotently.
5. Run Connect with a fresh ticket and verify server Computer Online/heartbeat.
6. Stop the daemon, generate Reconnect, verify latest compatible version and reused machine ID/config.
7. Test stale old process + expired lease graceful stop, active lease conflict, failed stop without force kill, and explicit reset/regenerate.
8. Test upgrade, no-downgrade behavior, failed download recovery, and rollback retaining the last known-good version.

## Risky files and rollback points

- `scripts/build_daemon_distribution.py`: artifact layout and installer generation; rollback by retaining the existing Unix builder and release directory.
- `agent/daemon/aaa-daemon/src/cmd/main.ts`, path/config/daemon modules: identity and process semantics; rollback by disabling standalone launcher and continuing Node entrypoint.
- `backend/routers/public_api.py`, `backend/routers/agent_api.py`: ticket timing and platform command contract; rollback by serving legacy `command` field and old endpoint behavior.
- `frontend/app/(app)/computers/connect-computer-form.tsx`, `frontend/app/(app)/computers/page.tsx`, `frontend/messages/*.json`: UI contract; rollback by hiding the Windows tab while preserving Unix command flow.
- `.trellis/spec/frontend/quality-guidelines.md`: update only after implementation and visible UI verification pass.

## Completion gate

Do not run `task.py start` until `prd.md`, this design, and this execution plan are reviewed. Do not report macOS implementation complete until the exact real command chain and Claude Code product-semantic Integration Gate pass. Do not report the overall cross-platform task complete until the Windows x64 real-host gate also passes.

## Execution status — 2026-08-06

The earlier Mac-side implementation and automated gates proved the fixed archive/download path, Setup identity, fake-upstream Connect, and UI contract, but they are superseded as completion evidence by the managed standalone/Ensure requirements added after real user testing. Structured ticket-free preview, platform-aware paths/setup/status, Windows ZIP/PowerShell generation, and the three-phase UI remain useful landed foundations.

Mac-side focused automated verification is recorded in `macos-evidence.md`. The earlier
`HTTP_502`/timeout came from a stale host credential redirecting fake-upstream tests; it was
reproduced as a state-isolation issue and cleared by rerunning with isolated Aura/credential
paths (current daemon suite: 307/307). The historical browser/runtime evidence is explicitly
labelled by candidate in `evidence/live-runtime-report.md`; the current daemon artifact was
also installed from the worktree carrier and exercised through fake-upstream Connect/register/
heartbeat. Neither evidence set is a Windows PE or real SmallKhoj Online acceptance.

Phase 5 的 Mac acceptance 已在当前隔离候选完成：Ensure/private runtime/ACP、fresh reconnect、Online/heartbeat，以及安装后 Aura 驱动的 Claude reply Integration Gate 均已通过，证据见 `macos-evidence.md` 和 `evidence/live-product-chat-gate-20260807-reconnect.json`。Windows x64 host 仍必须提供真实 PE `node.exe`/`aura.exe`/`codex-acp.exe`、发布匹配 manifest，并执行 install/setup/connect/reconnect/upgrade/rollback/conflict 矩阵。Keep `task.json.status` as `in_progress` until the Windows real-host gate is complete; Mac evidence does not substitute for Windows acceptance.

See `handoff.md` for the boundary and `windows-acceptance.md` for the exact continuation checklist.
