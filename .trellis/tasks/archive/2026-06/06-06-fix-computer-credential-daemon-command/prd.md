# One Computer One Daemon Connect Model

## Goal

Implement the connection model where a daemon must connect successfully before a computer is created or reused.

Core invariants:

* One daemon-generated `machineId` maps to one computer per server.
* One computer can have only one active daemon lease at a time.
* Browser connection commands use one-time `sk_connect_...` tickets, not long-lived `sk_machine_...` tokens.
* Agent creation is a separate user action on Members; daemon connect must not auto-create an agent or workspace.
* Computer names and agent display names are unique within a server.

## Requirements

* Add `POST /api/v1/computers/connect-command`.
  * Request: `{ name: string, serverUrl?: string }`.
  * Response: `{ connectToken, command, expiresAt }`.
  * Must create only a short-lived connect ticket, not a computer and not a machine token.
* Add `POST /internal/agent-api/daemon/connect`.
  * Auth: `Authorization: Bearer sk_connect_...`.
  * Body includes `machineId`, optional `daemonId`, host metadata, and detected runtimes.
  * Creates or reuses the computer only after successful token validation.
  * Issues an in-memory daemon machine token after connect.
* Add database support.
  * `computers.machine_id`.
  * Unique `(server_id, machine_id)` when `machine_id` exists.
  * Unique `(server_id, name)` for computers.
  * Unique `(server_id, display_name)` for members.
  * `connect_tickets` table.
  * `active_daemon_id`, `daemon_lease_expires_at`, and `last_heartbeat_at`.
* Update daemon.
  * Persist local `machineId`.
  * Support `SLOCK_CONNECT_TOKEN`.
  * Default `--proxy-port 0`.
  * Do not include default `--agent-id`.
  * Heartbeat every 15 seconds; backend lease is 90 seconds.
* Update frontend.
  * Computers page shows pending connect command and polls while pending.
  * Connected computer hides the pending command.
  * Duplicate-name and active-daemon failures surface clearly where reachable from UI/API.
  * Members page surfaces duplicate agent name `409`.
* Preserve future launcher direction.
  * Later `npx` launcher must use the same protocol: connect token + daemon-generated `machineId` + `/daemon/connect`.

## Future TODO

* Replace the local-path command with a packaged `npx` launcher once packaging exists.
* Add a first-class UI path for reconnecting an existing offline computer by choosing the existing computer row.

## Acceptance Criteria

* [x] `connect-command` does not create a computer or return `sk_machine_...`.
* [x] Daemon connect creates/reuses the computer and returns a machine token.
* [x] Same online `machineId` is rejected with `409`.
* [x] Same offline `machineId` is allowed to reconnect and reuse the computer.
* [x] Computer and agent duplicate names return `409`.
* [x] Connect token reuse returns `409`; invalid/expired token returns `401`.
* [x] Generated command uses local `agent/daemon/aaa-daemon`, `SLOCK_CONNECT_TOKEN`, and `--proxy-port 0`.
* [x] Generated command does not contain `@slock-ai/daemon`, `SLOCK_AGENT_TOKEN`, `sk_machine_`, or default `--agent-id`.
* [x] Relevant backend, daemon, frontend lint/build/tests pass. Full management-flow E2E still has a separate channel-navigation failure after the connect flow.
