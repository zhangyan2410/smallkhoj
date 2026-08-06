# Implementation plan

This is one end-to-end implementation session. The phases below are ordered checkpoints inside the same Trellis task; they are not separate child tasks or separate acceptance tracks.

## Phase 0 — Baseline and contracts

1. Record the current dirty state and verify the existing daemon command-generation tests, daemon package build, and Computers route behavior.
2. Add focused tests first for the new structured platform command response and just-in-time ticket creation, preserving the legacy Unix `command` assertion.
3. Confirm the real Windows x64 acceptance machine and capture its native architecture, PowerShell version, PATH, and existing Aura/legacy process state before testing.

## Phase 1 — Release and artifact pipeline

1. Extend the daemon distribution builder to stage a Windows x64 standalone layout containing `aura.exe`, private Node runtime, `dist`, production dependencies, N-API/WASM resources, manifest, and checksums.
2. Generate an `install.ps1` that detects native architecture, downloads an immutable manifest/artifact, verifies SHA-256 and version, stages into `%LOCALAPPDATA%\\Aura\\versions`, updates the user PATH, and switches the active launcher atomically.
3. Preserve the existing Unix archive/install path and internal `smallkhoj-daemon` artifact naming.
4. Add a Windows build/release job (or equivalent local reproducible command) and publish artifacts through the existing `/downloads/smallkhoj-daemon` cloud/static boundary.

Risk checkpoint: if Node runtime packaging, native modules, or WASM cannot be made reliable, stop and revise the design before touching onboarding UI.

## Phase 2 — Aura local CLI and daemon identity

1. Add platform-aware path resolution and an Aura-facing launcher while keeping the TypeScript/Node development entrypoint.
2. Implement idempotent `aura setup`: create/read config, generate/reuse machine ID, detect existing process/config/legacy state, write user ACL-protected credential paths, and support explicit reset/regenerate.
3. Implement version inspection, immutable artifact selection, no-downgrade default, and staged upgrade/rollback behavior.
4. Implement reconnect process/lease handling: graceful stop only for a stale local daemon with expired remote lease; no force kill; clear conflict on active lease.
5. Keep runtime providers external and report unavailable providers without failing daemon installation.

## Phase 3 — Backend command and ticket contract

1. Add immutable release metadata (version, platform, URL, SHA-256, minimum version) to the download/release response.
2. Split preview/setup metadata from Connect ticket generation. Opening the dialog, changing tabs, or rendering any phase card must be ticket-free; create `sk_connect_` only from the explicit Connect/“generate command” or Reconnect action, preserving the five-minute TTL and existing server conflict checks. Return `expiresAt` only from that ticket-generating response.
3. Return platform-structured Install/Setup/Connect commands with explicit shell labels. Keep the old Unix `command` field during compatibility rollout.
4. Add tests for Windows vs Unix commands, ticket timing, expiry/regeneration, version metadata, and reconnect name/machine-ID behavior.

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

- Run the focused backend command-generation/ticket tests.
- Run daemon TypeScript build and targeted unit tests.
- Run frontend type/lint checks and focused component tests.
- Use `./twd` to assert the selected platform tab, hidden opposite commands, Chinese default copy, and Online/failure evidence.
- Verify existing Unix npx connect/reconnect commands remain unchanged.

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

Do not run `task.py start` until `prd.md`, this design, and this execution plan are reviewed. Do not report completion until the Windows x64 real-host gate and focused macOS/Linux regression checks both pass.

## Execution status — 2026-08-06

The Mac-side implementation and automated gates are complete for the current checkout. The following phases have landed: structured ticket-free preview and explicit Connect/Reconnect ticket actions (Phase 3), platform-aware Aura paths/setup and status (Phase 2), Windows ZIP/PowerShell installer generation with fail-closed artifact requirements (Phase 1), and the mutually exclusive three-phase Computers UI plus i18n/spec updates (Phase 4).

Mac-side focused automated verification is recorded in `macos-evidence.md`. The daemon runtime integration suite is additionally blocked by the unavailable local backend (`HTTP_502`/timeout); the real browser/runtime gate is `BLOCKED_CANDIDATE_IDENTITY` because the collector found no healthy frontend/backend candidate for this worktree. No stale WebDriver tab was promoted to evidence.

Phase 5 remains open. A Windows x64 host must provide a real PE `node.exe`/`aura.exe`, publish the matching release manifest, execute the install/setup/connect/reconnect/upgrade/rollback/conflict matrix, and commit redacted evidence under `evidence/`. Mac real UI/runtime evidence must also be rerun on a proven candidate before the task can move to `completed`.

See `handoff.md` for the boundary and `windows-acceptance.md` for the exact continuation checklist.
