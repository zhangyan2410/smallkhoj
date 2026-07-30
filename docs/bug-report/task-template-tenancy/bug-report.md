# TaskRunTemplate tenant isolation

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | `TaskRunTemplate` has no `server_id`; list/get/update/delete/run resolve globally by slug or ID. One Server can observe, collide with, or mutate another Server's templates. Expected: global builtin templates are privileged and read-only to human routes, while human templates are owned and uniquely named inside an active Server. |
| **2. Evidence** | `backend/models/slock.py` defines a global slug uniqueness constraint with no tenant column. `backend/services/task_run_templates.py` queries active rows globally. Public routes do not consistently resolve templates through active Server membership. Advisor commits `52ca927`, `c3a257b`, and `f70f1e0` add partial scoping but target a stale pre-Alembic-foundation revision chain, allow ordinary creation of builtin rows, silently hide ambiguous legacy NULL rows, and rely heavily on fake sessions. |
| **3. Confirmed root cause** | Tenant ownership is absent from the terminal schema, so service checks cannot establish a durable boundary. Visibility is overloaded as provenance, mutation privilege, and read scope. Global uniqueness leaks/couples tenant slugs. |
| **4. Diagnostic strategy** | Run a real PostgreSQL migration matrix from current `0003_messages_seq_auto`; inventory every legacy template row and its defensible provenance. Add catalog/index tests, same-slug two-tenant tests, and authenticated route tests for list/get/create/update/delete/run. Resolve by active `server_id` before authorization. |
| **5. Timeout strategy** | If any legacy `server_id IS NULL` non-builtin row lacks defensible provenance, stop the migration and require an explicit operator/product mapping. Do not guess a tenant or silently hide the row. |
| **6. Warning strategy** | Reject nullable human templates, global human slug uniqueness, public builtin mutation, cross-tenant 403 existence disclosure, fake-session-only proof, or a revision whose `down_revision` is not the current Alembic head. |
| **7. User-visible correction** | Two Servers may use the same human template slug. Users see builtins plus their active Server's templates, cannot mutate builtins, and receive the same 404 for missing and foreign IDs. |
| **8. Acceptance** | Fresh/head/legacy PostgreSQL migration tests prove classification and partial unique indexes. Authenticated owner/admin/member route matrix covers builtin privilege and list/get/create/update/delete/run. Same slug across two tenants succeeds; duplicate in one tenant fails; foreign ID/slug stays invisible. |

## Report

- **Reporter:** Independent re-audit of finding 014 on 2026-07-23.
- **Reproduction:** Create or locate templates through two active Server contexts using the same/global slug and cross-tenant IDs.
- **Root cause:** Tenant identity and uniqueness are missing from the schema, and route/service lookups are global.
- **Repair direction:** Add a current-head migration with explicit legacy classification, partial/scoped uniqueness, privileged builtin ownership, and active-Server-scoped resolution.
- **Verification:** Real PostgreSQL migration/catalog evidence plus real route authorization tests.

## Candidate patch disposition

- `52ca927`: reuse the idea of `server_id` and partial indexes; rewrite on top of `0003_messages_seq_auto` and add explicit legacy classification.
- `c3a257b`: reuse scoped-query structure; reject ordinary builtin creation and visibility-as-authorization shortcuts.
- `f70f1e0`: reuse its adversarial case inventory; replace fake-session claims with PostgreSQL and authenticated route evidence.

## TDD evidence

### RED

At `0003_messages_seq_auto`, PostgreSQL catalog inspection found only the global
`uq_task_run_templates_slug`; there was no tenant column, tenant check, or partial
tenant index. The authenticated two-Server HTTP case failed on the first tenant
create with 409 because the underlying row lacked a valid `server_id`/tenant
shape, so it could not reach the intended same-slug-across-tenants assertion.

### GREEN

```bash
cd backend
SMALLKHOJ_MIGRATION_TEST_ADMIN_URL=postgresql://.../postgres \
SMALLKHOJ_MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://.../audit_remediation_test \
  uv run pytest -q \
    tests/test_template_tenancy_postgres.py \
    tests/test_template_tenancy_postgres_http.py \
    tests/test_runtime_seed_postgres.py
# 5 passed in 4.76s
```

The real PostgreSQL tests prove fresh-head partial indexes/checks, tenant-local
uniqueness, same slug in two Servers, builtin/null consistency, defensible legacy
classification, ambiguous-row transactional rollback, authenticated builtin
denial, foreign 404 for update/disable/run, no cross-tenant run artifacts, and
idempotent builtin seed execution.
