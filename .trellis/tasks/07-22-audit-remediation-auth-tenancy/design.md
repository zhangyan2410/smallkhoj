# Authentication and tenancy remediation design

## Boundary model

```text
transport credential
  -> authenticate principal/client
  -> resolve current account/member/server membership
  -> normalize requested actor/template reference
  -> authorize capability and tenant scope
  -> execute scoped operation
```

Public API transport authentication is not a substitute for human account/session authorization. The ADR must name which routes require public client authentication, account authentication, agent/machine authentication, and active Server membership.

## Credential rollout

- Define one backend env name for the server verifier and explicitly bridge the public build value only where browser code must send it.
- Production startup/build/preflight fail when required credentials use missing or known development defaults.
- Preserve a bounded local-dev default only when `DEBUG`/environment classification explicitly permits it.
- Replace URL query credentials on WebSocket/SSE paths with a reviewed transport that existing clients and Caddy can support; coordinate backend and daemon/frontend rollout.

## Canonical actor resolution

One resolver accepts the endpoint's actor input forms and returns a scoped `Member` or a typed error. Authorization compares UUIDs, never raw user text. Resolution order must avoid treating a UUID-looking display name or duplicate case-folded alias ambiguously.

| Input | Expected |
|---|---|
| omitted where viewer default is allowed | viewer UUID |
| exact display name | viewer UUID |
| `@viewer` | viewer UUID |
| viewer UUID | viewer UUID |
| another member alias/UUID | 403 |
| ambiguous/not found | 400/404 without cross-tenant disclosure |

## Bootstrap-owner state machine

Lifecycle owner: PostgreSQL constraint/transaction, not application check order.

| State | Event | Result |
|---|---|---|
| No bootstrap owner | first registration commits | exactly one owner |
| No bootstrap owner | two registrations race | one wins owner; loser follows defined member/new-server policy |
| Owner exists | later registration | member/invite policy, never owner by stale read |
| Transaction fails | retry | no orphan partial identity rows |

The implementation may use a singleton/bootstrap lock row, advisory/row lock, serializable transaction with bounded retry, or a schema constraint that directly encodes the invariant. The selected mechanism must work across processes and be proven with independent DB connections.

## Template terminal schema

- Builtin: `server_id NULL`, privileged/system-owned, globally resolvable.
- Server/user template: `server_id NOT NULL`, ownership/visibility fields enforce active-server scope.
- Uniqueness uses partial indexes such as global builtin slug and `(server_id, slug)` for tenant rows rather than one global slug key.
- Migration explicitly maps every legacy NULL row based on defensible provenance; ambiguous rows stop migration/preflight for operator disposition rather than disappearing.

## Adversarial matrix

- Missing/empty/malformed/revoked key; default key in production; query-string key attempt.
- Missing permission set, empty set, known permission, unknown permission, wildcard if supported.
- Self aliases, foreign aliases, cross-server member ID, duplicate/ambiguous names.
- First-registration interleavings, rollback after identity creation, retry after winner commit.
- Member/admin/owner create builtin/server/user templates; cross-server get/update/delete/run; same slug across tenants; legacy row migration.

## Rollout

1. Land Alembic foundation.
2. Add schema constraints/migration and dual-compatible credential transport where necessary.
3. Update backend authorization/resolvers.
4. Update frontend/daemon clients and remove old query transport.
5. Enforce production preflight and remove compatibility path after all clients migrate.
