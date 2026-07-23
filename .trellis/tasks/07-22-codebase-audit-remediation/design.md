# Codebase audit remediation design

## Program shape

该任务是修复 program 的父任务，拥有完整需求、依赖图和最终集成结论；具体实现由可独立验证的 child task 完成。父任务不直接承载跨域源码修改，以避免一个超大 diff 同时改变迁移、安全、运行时、分页和 UI。

```text
Audit evidence
  -> schema/destructive writes
  -> auth/tenant boundaries
  -> runtime/query/resource contracts
  -> delivery/UI gates
  -> architecture debt
  -> product-direction dispositions
  -> one integrated release candidate
```

## Child boundaries

1. **Schema integrity** owns Alembic, identity sequencing, legacy adoption, Task-delete audit tombstones, and real PostgreSQL fixtures.
2. **Auth and tenancy** owns key transport/configuration, permissions, impersonation, first-owner concurrency, template tenant scope, and auth ADR/tests.
3. **Runtime and querying** owns serializers/query budgets, upload resource budgets, NOTIFY/SSE connection lifecycles, pagination, and realtime subscription ownership.
4. **Delivery and UI** owns CI, build/test scripts, lockfile/docs consistency, e2e authentication, and visible `./twd` evidence.
5. **Architecture debt** owns behavior-preserving router/client/helper/state-owner decomposition after contract coverage exists.
6. **Product directions** owns disposition and linkage for 006–011; it does not code through unresolved value decisions.
7. **Integration release** owns merge ordering, conflicts, full gates, truth-source updates, rollout and rollback evidence.

No child may silently change another child's terminal contract. Cross-child changes require an explicit parent design update.

## Dependency order

```text
schema integrity ───────┐
auth and tenancy ───────┼─> runtime/querying ─> delivery/UI ─> architecture debt
product dispositions ──┘                                      │
                                                               v
                                                     integration release
```

- Schema migrations land before application code relies on automatic sequence values.
- Auth/tenant contracts land before canonical e2e and browser flows are rewritten.
- SSE and pagination contracts land before realtime UI evidence and client-state decomposition.
- Architecture decomposition follows characterization coverage so it cannot hide behavior changes.

## Database and state invariants

- `messages.seq` automatic generation is unique and strictly advances beyond every committed explicit/historical value used during migration.
- Alembic revision history is the deployment schema authority; compatibility helpers cannot fabricate an unstamped head schema.
- A deletion audit may preserve an identifier as payload data, but may not create a new FK to an already deleted row.
- At most one first owner can be committed for a server/bootstrap scope under concurrent registration.
- Global builtin template creation is privileged; tenant templates and slugs cannot interfere across servers.
- Pagination order is total and stable. Cursor fields encode that order and are consumed end-to-end.
- Long-lived streams do not own request-scoped database resources; durable/pooled listeners have explicit owner, recovery, and shutdown.
- Derived client state has one owner; additional views are projections rather than independently synchronized stores.

Each stateful child must include a state×event table, numbered invariants, crash/concurrency/restore/bypass scenarios, and a test matrix before implementation.

## Test architecture

- **Unit/characterization:** pure authorization, serialization, cursor, resource-budget and state-owner contracts.
- **PostgreSQL integration:** migrations, FK behavior, concurrent owner registration, query counting where dialect behavior matters.
- **ASGI/runtime integration:** real dependency finalization during StreamingResponse, listener reconnect/shutdown, authenticated e2e API setup.
- **Frontend tests:** cursor consumption, targeted refresh, error/loading and deletion confirmation logic.
- **Real UI:** project `./twd` against worktree-specific ports; record DOM/network/marker evidence.
- **Release gate:** one integrated branch runs all supported backend/frontend/CI-equivalent gates, not a union of per-branch green claims.

Tests are written RED first. A RED must fail for the intended contract reason against the current/broken implementation; environment or fixture errors do not count.

## Advisor branch reuse

Advisor branches are untrusted patch sources. For every reused hunk:

1. map it to a current child requirement;
2. inspect its tests for the real contract;
3. reproduce RED on the remediation base where feasible;
4. cherry-pick only self-contained correct commits or reimplement minimally;
5. reject stale tests that encode the bug as expected behavior;
6. run child and integration gates.

## Rollout and rollback

- Schema changes use forward-compatible staged rollout: migration first, compatibility application second, cleanup last.
- Every migration has a fresh-database path and an existing-database path. Destructive downgrades are documented rather than claimed safe when they are not.
- Auth/key changes support an explicit transition window or coordinated deployment; frontend/backend env names cannot diverge.
- Runtime connection changes expose health/reconnect evidence and have bounded shutdown.
- Each child remains revertible until the integration release. Final release notes name irreversible database steps and operational checks.

## Safety boundary

- Development database/runtime uses isolated worktree configuration only.
- Never target the user's shared runtime or external browser tabs as proof of an unmerged worktree.
- Existing dirty main files remain user-owned and out of scope unless individually approved.
