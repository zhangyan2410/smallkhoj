# Design: single local computer identity for daemon connect

## Current Architecture

The daemon owns a stable local `machineId` stored under `~/.slock/aaa-daemon/machine-id`. On connect it sends:

- `daemonId`
- `machineId`
- host name
- OS / daemon version
- detected runtimes

The backend connect path currently uses a one-time `ConnectTicket`. The ticket stores `requested_name`, but does not store whether it is meant to create a new computer or reconnect a specific existing computer.

This creates an ambiguous state:

1. A reconnect command is generated from an existing offline computer row.
2. The ticket carries only the row's name.
3. The daemon sends the local machine id.
4. Backend finds one row by machine id and another row by requested name.
5. Backend raises `409 Computer name ... already exists`.

That behavior is internally consistent with today's uniqueness constraints, but it is not a complete product contract.

## Desired Contract

There are two distinct flows:

### First-time / new-machine connect

Use when the server does not yet know this physical machine, or the operator is intentionally connecting a different physical machine.

Contract:

- request creates a ticket with mode `create`;
- daemon must provide a `machineId`;
- if that `machineId` already belongs to a `Computer`, backend must not create a duplicate;
- if requested name belongs to another `Computer`, backend must return a clear name conflict;
- if no conflicts exist, backend creates one `Computer` row.

### Existing-machine reconnect

Use when the operator selects an existing computer row and asks for a reconnect command.

Contract:

- request creates a ticket with mode `reconnect`;
- ticket identifies `target_computer_id` or an equivalent immutable target reference;
- daemon must provide a `machineId`;
- backend verifies the target computer belongs to the ticket's server;
- backend checks active daemon lease before takeover;
- if target has no machine id, backend may attach the incoming machine id;
- if target has the same machine id, backend refreshes the existing row;
- if target has a different machine id, backend must either reject with an identity mismatch or perform an explicit reconcile flow;
- if incoming machine id belongs to a different computer row, backend must reject or require explicit duplicate cleanup.

## Data Model Options

Recommended option:

- Add nullable fields to `connect_tickets`:
  - `mode` with values `create` / `reconnect`;
  - `target_computer_id` nullable FK to `computers.id`.
- Keep `requested_name` for display and first-time naming.
- Existing tickets without mode default to `create` for compatibility, or are treated through a conservative legacy path until expired.

Alternative:

- Encode reconnect target in the token payload or a separate signed token table.
- Trade-off: avoids schema change but keeps reconnect intent opaque and harder to inspect/debug.

## Frontend Shape

`frontend/app/computers/page.tsx` should make the page state explicit:

- `computers.length === 0`: show first-time connect form.
- `computers.length > 0`: show computer list/detail as the primary experience.
- selected offline computer: show reconnect command generation.
- optional secondary "add another machine" affordance can exist, but copy must make clear it is for a different physical machine.

If a future endpoint exposes the current local daemon identity, the UI should highlight the matching computer. Until then, hiding the generic new-computer form once computers exist is the safer product default.

## Backend Guardrails

- Frontend behavior is advisory only; backend must enforce identity rules.
- `POST /api/v1/computers/connect-command` should reject or require explicit mode when existing computers already exist and the request appears to be local-machine onboarding.
- `POST /api/v1/computers/{computer_id}/reconnect-command` should produce a reconnect-mode ticket bound to `computer_id`.
- `/internal/agent-api/daemon/connect` should branch by ticket mode and produce distinct errors for:
  - invalid token;
  - used/expired token;
  - active daemon lease conflict;
  - machine identity already belongs to another computer;
  - requested name already belongs to another computer;
  - reconnect target identity mismatch.

## Migration And Compatibility

- Add columns with nullable/default-compatible migration or seed-time DDL, matching the current project migration style.
- Existing short-lived connect tickets can remain valid through conservative legacy handling; because tickets expire quickly, no long migration window is needed.
- Existing duplicate computer rows should not be automatically deleted in the same change unless an explicit cleanup rule is reviewed.

## Risks

- Auto-merging duplicate records can move workspaces/members unexpectedly.
- Relying only on hostname continues to break when branch/test flows create different display names.
- Hiding all new-computer entry points may block legitimate second-machine onboarding if there is no secondary action.

## Rollback

- Schema fields should be additive.
- If UI gating is too strict, revert the frontend gate while keeping backend identity checks.
- If reconnect-mode handling causes regressions, disable reconnect-mode ticket creation and fall back to old command generation while preserving tests as skipped/xfail only with explicit review.
