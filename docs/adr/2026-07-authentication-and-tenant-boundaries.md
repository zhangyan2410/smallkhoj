# ADR: Authentication and tenant boundaries

- **Status:** Accepted
- **Date:** 2026-07-23
- **Scope:** public control plane, account/session bridge, agent permissions,
  actor identity, bootstrap ownership, and task-run templates

## Context

The audit found four coupled boundary failures:

1. A repository-known public API key could be used in production and could be
   transported in URL query parameters. Backend, frontend, Compose, and image
   builds owned separate defaults.
2. Actor-bearing routes authorized raw aliases instead of first resolving a
   canonical, Server-scoped Member identity.
3. First-account ownership used an application check-then-act sequence, so two
   transactions could both commit an owner.
4. `TaskRunTemplate` had global human rows and global slug uniqueness, so the
   database could not enforce tenant isolation.

These are not one authentication mechanism. SmallKhoj needs explicit principal,
transport, authorization, and tenant boundaries.

## Decision

### Principal and credential model

| Boundary | Credential/principal | Transport | What it proves |
| --- | --- | --- | --- |
| Public browser/client gate | configured `PUBLIC_API_KEY` | `X-Public-Key`; chat WS requested subprotocol | the client knows the deployed public-client value; it does **not** identify a user |
| Human account | Better Auth session bridged to an Account | session cookie to frontend, authenticated server-to-server bridge | the current account and its active Server memberships |
| Better Auth bridge | `AUTH_BRIDGE_SECRET` | `X-Auth-Bridge-Secret` on the internal request | the trusted frontend server made the bridge call |
| Agent | agent API key | authorization header | the agent Member represented by the key |
| Computer/daemon | one-time connect ticket, then machine token | authorization header or reviewed daemon WS subprotocol/header | the registered Computer and Server |

The public-client value is necessarily visible in the compiled browser bundle.
It is a deployment gate, not a confidential user credential and never replaces
account, membership, role, or capability authorization. BuildKit secret mounting
prevents accidental exposure in commands and image metadata; it cannot make a
browser-delivered value secret.

### Configuration and production failure

`PUBLIC_API_KEY` is the single operator-owned deployment input.

- Backend production startup reads it directly and rejects missing/blank values
  and the known `sk_public_local` development value.
- Frontend production builds receive it only through
  `--secret id=public_api_key,env=PUBLIC_API_KEY`. The legacy build arg is
  accepted only when `NEXT_PUBLIC_DEPLOYMENT_ENV=local-dev`.
- Production Compose supplies the same value to the backend and bridges it to
  the frontend's `NEXT_PUBLIC_API_KEY` runtime name.
- `dev.sh` uses `${PUBLIC_API_KEY:-sk_public_local}` once and gives the resolved
  value to both services under explicit `local-dev` classification.
- Empty `AUTH_BRIDGE_SECRET` always fails closed, including debug mode.

`NEXT_PUBLIC_*` values are compiled into Next.js output. Rotation therefore
requires a frontend image rebuild and a coordinated backend/frontend restart.
Changing only container runtime env does not rotate an existing browser bundle.

### Transport

- Public HTTP and SSE requests use `X-Public-Key`; `?api_key=` is rejected.
- Browser chat WebSocket connects to the credential-free `/api/chat/ws` URL and
  requests two subprotocols: fixed `smallkhoj.chat.v1` and
  `smallkhoj.public-key.<base64url(key)>`. The server validates before accepting
  and selects only `smallkhoj.chat.v1`, so it does not reflect the credential.
- The legacy frontend `/ws` daemon bridge similarly uses fixed, bearer, and
  agent-id subprotocol entries for browser-compatible clients; non-browser
  clients may use headers. It no longer reads token or agent ID query values.
- Authentication denials use stable status/close reasons and never echo the
  supplied value.

Caddy's normal WebSocket reverse proxy preserves `Sec-WebSocket-Protocol`; a
production-like Caddy handshake is a release gate for changes to this protocol.

### Capability authorization

Protected agent operations use an explicit capability registry. Missing config,
missing or JSON-null permissions, an empty map, unknown capabilities, non-boolean
values, and absent entries deny. Only a known capability explicitly equal to
`true` allows the operation.

New agents persist a complete map. Legacy rows whose permission value is missing
or JSON null are backfilled once to their historical effective permissions;
an explicit `{}` remains an intentional deny-all value.

Member mutation is a human role boundary: `PATCH /members/{id}` requires active
Server owner/admin membership before target lookup or mutation.

### Canonical actor identity

Actor input is resolved exactly once inside the active Server. Omission, exact
display name, `@display`, and the viewer's UUID all resolve to the same Member
UUID. Authorization compares that UUID with the current viewer UUID.

Foreign aliases/UUIDs return 403, unknown aliases return 404, and ambiguous
case-insensitive aliases return 400. Resolution never creates a Member and never
queries outside the active Server.

### Bootstrap owner state machine

Installation bootstrap registration acquires a PostgreSQL transaction-scoped
advisory lock before reading or assigning the current owner. Exactly one winner
becomes owner; later/concurrent successful registrations become members. The
lock is held through commit or rollback and is released automatically by
PostgreSQL, so retry does not leave orphan Account, Member, Membership, or Server
rows.

Creating a new Server for an already authenticated account is a separate scope:
that account remains owner of the Server it explicitly creates.

### Task-run template tenancy

- Builtins are global system rows: `visibility='builtin'` and `server_id IS NULL`.
  Human routes may read but cannot create, update, disable, or shadow them as
  global rows.
- Human templates are Server-owned: `visibility IN ('server', 'user')` and
  `server_id IS NOT NULL`.
- Partial indexes enforce global builtin slug uniqueness and tenant-local
  `(server_id, slug)` uniqueness. Tenant templates take deterministic precedence
  over builtins when resolving the same slug in an active Server.
- List/get/update/disable/run always scope by active Server; missing and foreign
  IDs/slugs both return 404 and cross-tenant runs create no assignment/run rows.
- Migration classifies only repository-known builtins and creator-backed human
  rows. Ambiguous legacy rows abort the transactional migration for explicit
  operator classification.

## Consequences

- Production cannot start or build with implicit development credentials.
- Browser-visible public-client material is no longer mistaken for user
  authentication; sensitive operations still require account/agent principals.
- URL history, proxy access logs, screenshots, and standard WebSocket URLs no
  longer carry reusable credentials.
- Concurrent registration and template tenancy invariants are enforced by
  PostgreSQL rather than process-local ordering.
- Legacy permission/template data needs explicit, tested compatibility handling.
- Public-key rotation is coordinated and currently requires rebuild/restart; a
  future zero-downtime design may add a bounded dual-key overlap, but must not
  reintroduce a known default or URL transport.

## Rollout and rollback

1. Back up PostgreSQL and run Alembic through `0004_template_tenancy`; stop on
   ambiguous legacy templates.
2. Generate `PUBLIC_API_KEY`, `AUTH_BRIDGE_SECRET`, and Better Auth values outside
   the repository.
3. Build the frontend with the `PUBLIC_API_KEY` BuildKit secret and deploy the
   matching backend/frontend configuration together.
4. Run production-like HTTP, SSE, chat WebSocket/Caddy, account, permission,
   actor, owner-race, and template-tenant gates.

Rollback uses the previous frontend image together with its matching backend env
value. Do not roll back only one side of the public-key contract. Database
downgrade from `0004` is safe only after proving tenant slugs can again satisfy
global uniqueness; otherwise restore from the pre-migration backup or write a
forward corrective migration.
