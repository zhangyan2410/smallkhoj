# Enforce single local computer identity for daemon connect

## Goal

SmallKhoj must treat one physical local machine as one `Computer` identity. If the current local machine already has a persisted daemon identity and a corresponding `Computer` row, the product should not encourage the user to create another local computer record from the same machine.

The Computers page and backend connect flow should make reconnect/recover the normal path, and reserve "connect a new computer" for the true empty-state or remote/new-machine onboarding case.

## Background

The operator reported a reconnect failure on 2026-06-26:

```text
/Users/code/project/smallkhoj/smallkhoj-daemon connect --token sk_connect_F2pQ9ECB... --server http://localhost:8000

[Daemon] Failed to start: Daemon connect failed: 409 {"detail":"Computer name Mac-mini.local already exists"}
```

The visible product state showed three registered computers, all offline:

- `integration-gate-worktre...`
- `runtask-current-branch-...`
- `Mac-mini.local`

Product intent from the operator:

- A local computer has a unique credential/identity.
- One local physical computer should not produce multiple `Computer` records in the same server.
- Test branches or dev flows may have created extra records (`gate`, `runtask`, and the original Mac record), but the product should not expose a normal "connect new computer" path once this local machine already has a known identity.
- If the backend would reject the new-computer path anyway, the UI should not show an input box that appears to invite the user down that path.

## Confirmed Evidence

- Daemon persists local machine identity in `~/.slock/aaa-daemon/machine-id`; source: `agent/daemon/aaa-daemon/src/daemon/daemon.ts:633`.
- The investigated local machine identity was `07b94a44-eb74-49da-832d-4520e3be5944`.
- Backend `connect_daemon()` matches by `machineId`, then also checks requested computer name; source: `backend/routers/agent_api.py:1374`.
- Backend currently rejects when `machineId` belongs to one `Computer` row but the connect ticket's `requested_name` belongs to another row; source: `backend/routers/agent_api.py:1386`.
- `Computer` uniqueness currently exists on both `(server_id, name)` and `(server_id, machine_id)`; source: `backend/models/slock.py:99`.
- `ConnectTicket` stores `requested_name`, but not the intended existing `computer_id`; source: `backend/models/slock.py:722`.
- Public API creates a generic new-computer connect ticket at `POST /api/v1/computers/connect-command`; source: `backend/routers/public_api.py:3067`.
- Public API creates a reconnect ticket at `POST /api/v1/computers/{computer_id}/reconnect-command`, but currently persists only the target computer's name into the ticket; source: `backend/routers/public_api.py:3095`.
- Computers page currently always renders `ConnectComputerForm` above the list/detail area; source: `frontend/app/computers/page.tsx:745`.

## Product Requirements

- **R1: Single local-machine invariant.** For a given server, the same local daemon machine identity must not silently create multiple local `Computer` records.
- **R2: UI must not offer impossible onboarding.** When the current browser/session is operating from a machine that already has a local daemon identity represented in the server, the Computers page must not show the normal "connect new computer" name input as the primary action.
- **R3: Empty-state onboarding remains available.** If no computer exists for the server, the first-time connect flow may still show the new-computer form.
- **R4: Reconnect is the normal path for existing computers.** Existing offline computers should expose a reconnect/recover action that is tied to the target computer, not just to a reused name string.
- **R5: Branch/dev duplicates must be recoverable.** If previous test branches created `integration-gate-*`, `runtask-*`, or similar duplicate local records, the product should provide a safe cleanup or reconciliation path instead of letting users pile on another record.
- **R6: Backend must enforce the same rule.** Frontend hiding is not enough. The backend must reject or reconcile invalid duplicate-local-computer creation with an explicit, actionable error.
- **R7: Errors must explain identity conflict.** A conflict caused by local machine identity mismatch should not surface only as `Computer name X already exists`; it must identify that an existing computer/machine identity should be reconnected or cleaned up.

## UX Requirements

- On `/computers`, if registered computers already exist, prefer the list/detail and reconnect controls over the new-computer form.
- The new-computer form should be absent, collapsed behind an explicit secondary action, or limited to an "add another machine" mode whose copy makes clear it is for a different physical machine.
- If the local machine's daemon identity can be detected client-side or via a backend endpoint, highlight the matching `Computer` row and direct the user to reconnect that row.
- If identity cannot be detected from the browser, the backend still must reject duplicate creation and the UI should show an actionable message.
- Existing offline computer rows should remain selectable and should offer reconnect command generation.

## Backend Requirements

- Reconnect tickets must carry enough intent to identify the target computer. Persisting only `requested_name` is insufficient.
- `connect_daemon()` must distinguish:
  - first-time computer creation;
  - reconnecting the same machine identity to the same `Computer`;
  - reconnecting a named existing `Computer`;
  - attempted duplicate creation from a machine identity already bound to another `Computer`;
  - active daemon lease conflicts.
- Duplicate local computer rows created by older dev/test flows must be handled deliberately: either prevent new duplicates, provide a cleanup/reconcile endpoint, or require an explicit admin action.
- The system must not rely only on mutable display names to choose the reconnect target.

## Out Of Scope

- Fully solving multi-server account identity.
- Packaging the daemon installer.
- Changing runtime provider selection.
- Deleting historical duplicate computer rows automatically without an explicit reconciliation rule.
- Pushing or deploying this task's eventual implementation.

## Acceptance Criteria

- [ ] When a server already has at least one registered computer for the local daemon identity, `/computers` no longer shows the normal new-computer name input as the primary action.
- [ ] First-time empty-state onboarding still allows generating a connect command for the first computer.
- [ ] Existing offline computer detail can generate a reconnect command tied to that computer's identity, not only its name.
- [ ] Reconnect ticket data model or equivalent backend contract can identify the intended target computer.
- [ ] `/internal/agent-api/daemon/connect` cannot create another `Computer` for the same local machine identity through the generic connect flow.
- [ ] A duplicate identity/name conflict returns an actionable error that tells the user to reconnect or clean up the existing computer record.
- [ ] Tests cover at least:
  - generic connect allowed when no computer exists;
  - generic connect rejected or redirected when machine identity already maps to a computer;
  - reconnect succeeds for an offline target computer;
  - reconnect rejects an active daemon lease;
  - same-name/different-machine and same-machine/different-name conflicts produce distinct outcomes.
- [ ] Real verification includes a Computers page flow and a daemon CLI connect/reconnect flow using `smallkhoj-daemon`.

## Open Questions

- Should duplicate historical rows be merged automatically when their leases are expired, or should the product require an explicit admin cleanup action?
- Should "add another computer" be hidden entirely after first local registration, or exposed as a secondary remote-machine flow with stronger copy?
