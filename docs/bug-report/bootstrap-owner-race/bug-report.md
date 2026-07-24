# Concurrent bootstrap owner race

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | Bootstrap registration decides whether a new membership is `owner` in application code. Two independent transactions can both observe that no owner exists and both commit owner memberships. Expected: the installation's initial bootstrap server has at most one committed bootstrap owner under arbitrary interleaving, while an existing account creating a separate Server still owns that new Server. |
| **2. Evidence** | `_bootstrap_account()` in `backend/routers/public_api.py` creates the first account/server/member path without a database-enforced singleton/serialization primitive. Advisor commit `8da5c3e` adds a first-user-wins query/check but no database constraint, lock row, advisory lock, or serializable retry. Existing tests are single-session/fake-session and cannot prove the invariant. |
| **3. Confirmed root cause** | The role decision was a check-then-act race with no cross-process database serialization. Two independent PostgreSQL transactions both read the empty owner state and committed owner memberships. |
| **4. Diagnostic strategy** | Use the isolated migration PostgreSQL harness and two independent sessions/transactions. Synchronize both registrations after the empty-state read, release them together, repeat, and inspect committed Account/Server/Member/ServerMembership rows. Compare with working per-Server owner creation, which is a distinct operation. |
| **5. Timeout strategy** | If the race cannot be deterministically synchronized in one test cycle, add an explicit barrier hook at the service boundary used only by tests or prove the missing invariant through catalog inspection plus repeated concurrent runs. Do not substitute a single-session test. |
| **6. Warning strategy** | Reject application-only `SELECT` then `INSERT`, process-local locks, or tests sharing one transaction. Stop if the meaning of "bootstrap scope" becomes ambiguous; encode no constraint until installation bootstrap versus per-Server ownership is explicit. |
| **7. User-visible correction** | Concurrent first signup cannot create two installation owners or partial orphan identities. A losing/retried signup follows a defined non-owner outcome without downgrading the winner. |
| **8. Acceptance** | Intended RED uses two PostgreSQL connections and demonstrates either two owners or absence of a database invariant. GREEN repeats the race, commits exactly one bootstrap owner, verifies loser outcome and no orphans, and separately proves new-Server creators remain owner of their own Server. |

## Report

- **Reporter:** Independent re-audit of finding 013 on 2026-07-23.
- **Reproduction:** Run two first registrations in independent PostgreSQL transactions synchronized before role assignment.
- **Root cause:** Deterministic two-session PostgreSQL RED committed `roles=['owner', 'owner']`.
- **Repair:** Acquire a transaction-scoped PostgreSQL advisory lock for the installation bootstrap owner scope before reading/assigning the role. Hold it until caller commit/rollback; keep explicit per-Server creation ownership separate.
- **Verification:** Repeated two-session commit/rollback/retry matrix and database state inspection.

## Candidate patch disposition

- `8da5c3e`: reject as a terminal fix because it remains check-then-act; isolated helper/query ideas may be reused only behind a database-enforced mechanism.

## TDD evidence

### RED

Two independent transactions registered against a pre-created default Server
with no owner. Both completed, and committed inspection returned:

```text
roles=['owner', 'owner']
```

This was the intended proof that application check-then-act did not serialize
across processes.

### GREEN

```bash
cd backend
SMALLKHOJ_MIGRATION_TEST_ADMIN_URL=postgresql://.../postgres \
SMALLKHOJ_MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://.../audit_remediation_test \
  uv run pytest -q tests/test_bootstrap_owner_postgres.py
# 4 passed in 3.29s
```

The real PostgreSQL suite repeats the race, asserts exactly one owner and one
member, proves rollback releases the advisory lock without orphan Account,
Member, Membership, or Server rows, proves retry can become owner, and preserves
the independent rule that an account creating a new Server owns that Server.
