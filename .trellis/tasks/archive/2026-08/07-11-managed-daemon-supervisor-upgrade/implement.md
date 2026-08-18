# Phased Implementation Plan

This document plans future implementation only. The current task must not modify
production daemon/backend/frontend behavior.

## Delivery Strategy

Use a parent implementation program with independently reviewable child tasks.
Do not attempt supervisor, backend protocol, UI, installer, and real-machine
validation in one branch.

## Phase 0 — Contracts and fixtures

### Deliverables

- Finalize version bundle and upgrade operation schemas.
- Define state-transition table and machine-readable error codes.
- Add protocol fixtures for upgrade command/progress payloads.
- Confirm the already-selected `aura-computer` command compatibility matrix and
  decide the default drain timeout.
- Decide checksum-only pilot vs signed-manifest requirement.

### Likely files

- shared API/type modules used by backend/frontend;
- `agent/daemon/aaa-daemon/src/types.ts`;
- backend request/response models;
- task-local protocol fixtures and tests.

### Validation

- schema tests reject invalid transitions, arbitrary URLs, stale versions, and
  secret-bearing payloads;
- compatibility fixtures cover legacy heartbeat and managed heartbeat.

### Rollback point

Pure additive contracts; no runtime behavior enabled.

## Phase 1 — Backend durable operation model

### Deliverables

- Migration extending Computer observation fields.
- `computer_upgrade_operations` model and indexes.
- Owner/admin APIs to create/read/cancel/rollback operations.
- Authenticated Computer progress-report endpoint.
- Idempotency and one-active-operation constraint.
- Event/audit records and maintenance-state lifecycle blocking.
- Pending command inclusion in WebSocket and heartbeat fallback.

### Likely files

- `backend/models/slock.py`;
- new Alembic migration;
- `backend/routers/public_api.py`;
- `backend/routers/agent_api.py`;
- `backend/services/daemon_control.py`;
- `backend/services/public_events.py`;
- backend tests.

### Validation

- authorization and tenant-isolation tests;
- transition/idempotency/concurrency tests;
- offline heartbeat delivery and duplicate command tests;
- lifecycle start rejected during maintenance;
- upgrade events excluded from agent prompt delivery unless explicitly needed.

### Rollback point

Feature flag keeps operation creation disabled; additive database fields remain
safe if frontend/supervisor is not shipped.

## Phase 2 — Local supervisor core and IPC

### Deliverables

- New supervisor/CLI entry point and runner entry point.
- Local singleton/lock, state directories, atomic JSON persistence, log
  rotation, and local Unix socket/named-pipe abstraction.
- Supervisor commands: status, doctor, logs, start, stop, restart, channel.
- Runner IPC: start, drain, stop, status, version bundle.
- Existing daemon lifecycle moved behind runner boundary without changing
  runtime drivers.

### Likely files

- new `agent/daemon/aaa-daemon/src/computer/` modules;
- `agent/daemon/aaa-daemon/src/cmd/main.ts`;
- `agent/daemon/aaa-daemon/src/daemon/daemon.ts`;
- daemon tests.

### Validation

- supervisor survives CLI exit;
- stale PID/socket recovery;
- runner crash/restart behavior;
- drain returns a bounded summary;
- SIGTERM still uses normal daemon shutdown;
- local status never prints secrets.

### Rollback point

Legacy `aura` / `smallkhoj-daemon start --foreground` remains functional and selected by
feature/config flag.

## Phase 3 — Packaging and macOS launchd adapter

### Deliverables

- Extend versioned artifact with supervisor/runner and manifest checksums.
- Idempotent setup/install command.
- Per-user LaunchAgent adapter and generated plist.
- Stable command plus compatibility alias.
- Adopt existing machine identity/credential and workspace root.
- Uninstall/recovery commands and doctor checks.

### Likely files

- `scripts/build_daemon_distribution.py`;
- release artifact tests;
- new service-manager modules;
- deployment/onboarding docs;
- connect-command generation.

### Validation

- fresh install outside repo;
- terminal close keeps Computer online;
- logout/login and reboot behavior documented and tested;
- repeated install is idempotent;
- migration does not create a duplicate Computer;
- uninstall does not delete workspace/memory without explicit request.

### Rollback point

Reconnect command can still present legacy foreground path during pilot; launchd
install feature is gated.

## Phase 4 — Local upgrade transaction and rollback

### Deliverables

- Download staging, checksum/signature verification, compatibility checks.
- Persisted upgrade state machine and local lock.
- Drain coordination and timeout escalation.
- Immutable version extraction, preflight, atomic current/previous switch.
- Service-manager/updater-helper restart.
- Startup resume, health gate, last-known-good marking, automatic rollback.
- CLI `upgrade --dry-run`, `--target-version`, `--channel`, `--rollback`.

### Validation

- unit tests for every transition and invalid transition;
- fault injection: download/hash/disk/preflight/restart/connect/heartbeat failures;
- supervisor crash at each durable boundary and resume behavior;
- rollback success and rollback failure diagnostics;
- no two concurrent upgrades.

### Rollback point

Server-triggered upgrade remains disabled; local CLI pilot only.

## Phase 5 — Web UI and remote control

### Deliverables

- Computer detail version matrix, service status, channel, latest version.
- Upgrade confirmation with active runtime count and interruption warning.
- Server actions for create/cancel/rollback.
- Persisted progress timeline and event-driven refresh.
- Safe failure details and local diagnostics command.
- Feature flag enabled only for managed-compatible Computers.

### Likely files

- `frontend/app/computers/page.tsx` split into focused components/actions as
  needed;
- frontend messages and control-plane types;
- backend public API response models;
- WebDriver tests.

### Validation

- permissions and disabled-state UX;
- page refresh preserves progress;
- duplicate-click idempotency;
- offline/incompatible Computer states;
- real UI flow via `./twd`, not Playwright directly.

### Rollback point

Feature flag hides upgrade controls; local managed service remains usable.

## Phase 6 — Real Mac pilot and migration gate

### Required scenarios

1. Adopt an existing legacy Computer without changing its ID.
2. Close terminal; Computer remains online.
3. Reboot/login; service reconnects.
4. Upgrade while no agents run.
5. Upgrade while multiple runtimes run; confirm drain and desired-state restore.
6. Kill a runtime during drain.
7. Corrupt target artifact/checksum.
8. Make target runner fail health; verify automatic rollback.
9. Disconnect network during download and during post-restart health.
10. Issue duplicate Web requests and stale heartbeat commands.
11. Verify logs, events, UI status, and no secret leakage.

### Evidence

- process tree and service-manager status;
- backend operation rows/events;
- local operation state/logs with secrets redacted;
- `smallkhoj-trace` timeline;
- screenshots/recording of UI flow;
- exact source/artifact versions and SHA-256.

### Promotion gate

Managed macOS onboarding becomes default only after success/rollback/reboot
scenarios pass on a clean machine and an adopted existing machine.

## Phase 7 — Follow-ups

- Linux systemd user service.
- Windows Service adapter.
- Signed manifest/key rotation and revocation.
- Staged fleet rollout, maintenance windows, and optional automatic policy.
- Native installer/menu-bar UX if user research justifies it.

## Implementation Task Decomposition

Recommended child tasks:

1. `managed-computer-upgrade-contracts`
2. `managed-computer-upgrade-backend-state`
3. `managed-computer-supervisor-core`
4. `managed-computer-macos-service-packaging`
5. `managed-computer-local-upgrade-rollback`
6. `managed-computer-web-upgrade-ui`
7. `managed-computer-real-mac-validation`

Dependencies must be written in each child PRD; tree order alone is not a
dependency contract.

## Pre-Implementation Decisions

Before `task.py start` on the first implementation child:

- confirm the future brand-migration task boundary and compatibility lifetime;
- choose signing requirement for pilot;
- choose default drain timeout;
- choose immediate vs lazy runtime restoration;
- choose LaunchAgent login behavior and dedicated-headless-host guidance;
- confirm backend operation retention and log retention periods.

## Planning Validation Performed

- Existing daemon distribution/versioning path inspected.
- Current Computer and AgentWorkspace models inspected.
- Current register/heartbeat/WS runtime control path inspected.
- Existing SIGTERM and runtime stop behavior inspected.
- Current Computers UI lifecycle actions inspected.
- Raft Computer behavior was locally observed as comparative product evidence,
  including background supervisor/runner split and web-triggered upgrade logs.
