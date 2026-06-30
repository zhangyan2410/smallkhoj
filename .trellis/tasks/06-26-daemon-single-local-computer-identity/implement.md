# Implementation Plan

Do not start this task until the PRD/design have been reviewed.

## Phase 1: Backend Contract Tests

- Add tests around `/api/v1/computers/connect-command`, `/api/v1/computers/{computer_id}/reconnect-command`, and `/internal/agent-api/daemon/connect`.
- Cover first-time create, existing machine duplicate rejection, offline reconnect, active lease rejection, same-name/different-machine conflict, and same-machine/different-name conflict.
- Keep the first failing tests focused on the observed bug: reconnect command from `Mac-mini.local` must not collide with a different local-machine `Computer` row as a vague name conflict.

## Phase 2: Ticket Intent

- Extend `ConnectTicket` with explicit mode and target computer reference, or an equivalent immutable reconnect target contract.
- Update ticket creation:
  - generic connect -> create mode;
  - `{computer_id}/reconnect-command` -> reconnect mode with target id.
- Preserve compatibility for existing short-lived tickets.

## Phase 3: Connect Endpoint Semantics

- Refactor `connect_daemon()` so create and reconnect paths are separate.
- Enforce the single-local-machine invariant by `machineId`.
- Keep active lease protection.
- Return actionable errors for identity conflict and name conflict.
- Avoid automatic duplicate row deletion unless an explicit reconcile rule is added.

## Phase 4: Computers Page UX

- Update `frontend/app/computers/page.tsx` so the generic connect form is only primary in the empty state.
- For existing computers, make reconnect on the selected row the normal path.
- Optionally add a secondary "add another machine" flow only if the product copy clearly says it is for a different physical computer.
- Update `frontend/messages/en.json` and `frontend/messages/zh-CN.json`.

## Phase 5: Verification

- Backend tests for connect/reconnect identity rules.
- Frontend tests or real UI verification for:
  - no computers -> first-time connect form visible;
  - existing computers -> generic create form hidden/collapsed;
  - selected offline computer -> reconnect command visible.
- Real runtime check:
  - generate reconnect command for an offline computer;
  - run `smallkhoj-daemon connect --token ... --server http://localhost:8000`;
  - confirm the existing computer row is reused and no duplicate row is created.

## Likely Files

- `backend/models/slock.py`
- `backend/models/seed.py`
- `backend/routers/public_api.py`
- `backend/routers/agent_api.py`
- `backend/tests/test_daemon_control.py` or a new focused backend test file
- `frontend/app/computers/page.tsx`
- `frontend/messages/en.json`
- `frontend/messages/zh-CN.json`
- `agent/daemon/aaa-daemon/src/daemon/daemon.ts` only if daemon-side diagnostics or explicit local identity reporting are needed

## Review Notes

- Do not key product behavior on hostname alone.
- Do not delete duplicate historical `Computer` rows without a separately reviewed cleanup path.
- Do not treat frontend hiding as sufficient enforcement.
- Keep errors user-actionable; "Computer name already exists" is not enough for this bug class.
