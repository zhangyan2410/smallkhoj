# 2026-07 Codebase Audit — Plan Index

> **Independent-review status, corrected 2026-07-23.**
>
> These plans were generated as advisory output against `47848e8`. Advisor branch
> commits and their passing tests are candidate evidence only. They are not merged into
> the audit base, do not prove composition/deployment, and must not be reported as
> current `main` fixes.

## Current local-candidate overlay (2026-07-24)

The historical independent verdicts below remain useful as the 2026-07-23
baseline. The active remediation candidate has since moved beyond that baseline:

```text
branch: feat/2026-07-audit-remediation
state: local worktree only; not committed as a clean candidate, not merged,
       not deployed, and not released
required order:
  local focused/UI validation -> precise commits
  -> clean-candidate capacity/full gates -> PR + squash merge -> merge
  -> linux/amd64 build/deploy -> validation of the new cloud deployment
```

The older cloud images must not be tested or benchmarked as evidence for this
candidate.

Current release scope is limited to important defects: security/auth/tenancy;
database and transaction races; PostgreSQL/SSE/resource ownership/pagination;
upload/delete boundaries; and CI/Docker/delivery. Large Router extraction,
`ChannelClient` decomposition, chat-state-owner consolidation, and plans 006–008,
010–011 implementation are excluded from this release.

### Candidate evidence status

| Area | Current candidate status | Remaining release boundary |
|---|---|---|
| schema integrity | Implemented in the local candidate and focused-gated | clean candidate + final full gate + merge |
| auth / tenancy | Implemented in the local candidate and focused-gated | clean candidate + final full gate + merge |
| runtime / querying | Implemented in the local candidate and focused-gated | formal 30-minute Caddy capacity run + final full gate + merge |
| 003a scheduler/WS reliability | Repaired in the local candidate: exception logging, capped exponential backoff with success reset, and daemon send-failure logging. RED: 5 failed / 50 passed; GREEN: 55 passed plus Ruff. See `../../../../docs/bug-report/scheduler-loop-silent-failure/bug-report.md`. | final full gate + merge |
| delivery build context | Root `.dockerignore` recursively excludes dotenv files while retaining examples. See `../../../../docs/bug-report/backend-image-secret-context/bug-report.md`. | final full gate + merge |
| frontend public key build | Production frontend image builds use the BuildKit secret with no layer-cache reuse, preventing a stale compiled public key; local registration passed after rebuild. See `../../../../docs/bug-report/frontend-public-key-build-cache/bug-report.md`. | final full gate + merge |
| delivery / visible UI | Local Caddy smoke and critical `./twd` scenarios passed under `REAL_audit_delivery_ui_20260723235900`. | precise commits, formal capacity/full gate, PR/merge |

The UI marker proves only the disposable `local-prod` stack: new signup/session
and owner Server; 201 Tasks crossing the `limit=200` cursor; one physical SSE;
Task event refresh with two Task API pages and zero RSC requests; Task UI delete
plus null-FK DB tombstone; File SSE removal with zero File GETs and zero RSC;
and the quarantined storage-cleanup warning rendered as `role=alert`. Evidence
index:
[`REAL_audit_delivery_ui_20260723235900-notes.md`](../evidence/REAL_audit_delivery_ui_20260723235900-notes.md).

### Formal product-direction dispositions

| Plan | Disposition | Release effect |
|---|---|---|
| 006 | `ACCEPT_DOC_TRUTH` / implementation `DEFERRED` / `RELEASE_EXCLUDED` | Accept shipped water/dark/shuimo reality; `DESIGN.md` reconciliation is later docs-only work. `DESIGN.md` is still stale, so 006 is not completed. |
| 007 | `DEFER_LINKED` / `RELEASE_EXCLUDED` | Standalone observer work owns the direction; no observer WIP is touched. |
| 008 | `DEFER_LINKED` / `RELEASE_EXCLUDED` | Durable Work Item is a separate new feature. |
| 009 | `SUPERSEDED_BY_SCHEMA_AND_DELIVERY` | Backend and critical local `./twd` paths are implemented/passed; release closure still waits for clean candidate, full gate, commits, and merge. |
| 010 | `DEFER_LINKED` / `RELEASE_EXCLUDED` | Keep `/daemon` unchanged in this release. |
| 011 | `DEFER_LINKED` / `RELEASE_EXCLUDED`; `REJECT_DESTRUCTIVE_CLEANUP_IN_AUDIT_SCOPE` | No user-owned Remotion file is touched. |

`docs/migration-workflow.md` now exists in the candidate. `DESIGN.md` remains
the old version; the earlier statement that plan 006 had rewritten it was not
true for this candidate.

### Cloud-host fact boundary

The target is a nominal **4 vCPU / 4 GB** Tencent Lighthouse SKU. The guest is
`x86_64`, exposes 4 vCPUs and `3,564,584,960` bytes (`3.3198 GiB`, reported as
`3.32 GiB`) of RAM, has 3 GiB swap recorded separately, and PostgreSQL
`max_connections=100`. Swap is not steady-state RAM. Every existing cloud
observation belongs to older images and proves nothing about the current local
candidate. A 500-cloud-user claim is not established.

## Verdict vocabulary

- `APPROVE`: advisor change is technically acceptable on the evidence reviewed;
- `APPROVE WITH DEPENDENCY`: useful/correct partial change with an unresolved terminal
  dependency;
- `REVISE`: finding is real or direction useful, but the proposed implementation does
  not satisfy the contract;
- `NOT IMPLEMENTED`: direction/plan has no accepted implementation;
- `SUPERSEDED`: the plan was structurally replaced by named subplans, not completed.

Full rationale and reproduced evidence:

```text
../research/2026-07-22-independent-verification.md
```

## Historical independent verdict and remediation owner (2026-07-23 baseline)

This table records the independent judgment of the advisor patches before the
current remediation work. It must not be read as the current candidate status;
use the overlay above for that.

| Plan | Title | Independent verdict | Remediation owner / action |
|---|---|---|---|
| 001 | pytest default collection | `APPROVE` | integration release: reuse and rerun |
| 002 | P1 authorization batch | `REVISE` | auth-tenancy |
| 003 | seq race + scheduler logging | `SUPERSEDED` | use 003a and 003b separately |
| 003a | scheduler logging/backoff | `APPROVE` | integration release: reuse and rerun |
| 003b | remove manual Message.seq | `REVISE` | schema-integrity after corrected migration |
| 004 | Alembic/schema authority | `REVISE` | schema-integrity |
| 005 | serializer N+1 | `REVISE` | runtime-querying |
| 006 | DESIGN truth reconciliation | `APPROVE WITH DEPENDENCY` | product-directions; maintainer approval |
| 007 | session observer integration | `NOT IMPLEMENTED` | product-directions; defer/link existing task |
| 008 | durable Work Item/dispatch | `NOT IMPLEMENTED` | product-directions; separate feature program |
| 009 | Task/File DELETE | `REVISE` | schema-integrity + delivery-ui |
| 010 | `/control/*` separation | `NOT IMPLEMENTED` | product-directions; explicit route decision |
| 011 | Remotion disposition | `NOT IMPLEMENTED` | product-directions; preserve/link user WIP |
| 012 | actor impersonation | `REVISE` | auth-tenancy |
| 013 | registration default role | `REVISE` | auth-tenancy |
| 014 | TaskRunTemplate tenancy | `REVISE` | auth-tenancy after schema foundation |
| 015 | capped upload reads | `APPROVE WITH DEPENDENCY` | runtime-querying; ingress/disk/cleanup envelope |
| 016 | NOTIFY connection pool | `APPROVE WITH DEPENDENCY` | runtime-querying; recovery/connection budget |
| 017 | SSE session lifetime | `REVISE` | runtime-querying |
| 018 | list pagination caps | `REVISE` | runtime-querying |
| 019 | CI/test scripts | `REVISE` | delivery-ui |
| 020 | frontend dependency cleanup | `APPROVE` | delivery-ui/integration: reuse and rerun |
| 021 | frontend code splitting | `APPROVE WITH DEPENDENCY` | delivery-ui; real UI evidence |
| 022 | targeted realtime refresh | `APPROVE WITH DEPENDENCY` | runtime-querying + delivery-ui after 017 |
| 023 | AGENTS/e2e wording | `REVISE` | delivery-ui after authenticated e2e repair |

## Historically reproduced release blockers

### 003b / 004 — historical sequence collision

A one-shot PostgreSQL 16 probe upgraded a baseline with explicit `messages.seq=1,2,3`
through advisor revision 0002. The identity sequence remained at 1. The first insert
omitting `seq` failed with `messages_seq_key`, `Key (seq)=(1) already exists`.

Required terminal contract: align identity above all historical/explicit values, prove
old/new writer transition, adopt legacy schemas by read-only fingerprint plus baseline-
only stamp, and remove implicit startup DDL. Never recommend `stamp head`.

### 009 — Task DELETE foreign-key rollback

A real PostgreSQL transaction following the proposed route hit
`activity_logs_task_id_fkey` and `event_records_task_id_fkey` after deleting the Task.
The transaction rolled back; the Task remained and no audit/event row committed.

Required terminal contract: capture primitive tombstone, delete dependencies/entity,
write activity/event with `task_id=NULL` and old UUID in payload, commit, then publish.

### 019 — deterministic red CI

The proposed workflow unconditionally runs a Ruff baseline with 73 current errors and a
production frontend build without required Better Auth/public-key environment. Both are
known failures, so the workflow is not a usable merge gate yet.

## Known semantic conflict zones

- 005 + 018: `agent_api.py:list_threads`; combined solution must satisfy constant query
  budget, SQL filter-before-limit and stable cursor traversal.
- 012 + 014: actor normalization and server/template scope must both survive; do not
  resolve with ours/theirs.
- 017 + 022: SSE dependency finalization, one browser transport and targeted refresh are
  one cross-layer contract.
- 002 + 019 + 023: backend/frontend/compose/CI/e2e must consume the same credential and
  authenticated server-context contract.

## Remediation dependency order

```text
schema-integrity
  -> auth-tenancy
  -> runtime-querying
  -> delivery-ui
  -> architecture-debt
product-directions (approved/deferred dispositions)
  -> integration-release
```

The remediation task tree is a child of the audit task:

```text
.trellis/tasks/07-22-codebase-audit-remediation/
.trellis/tasks/07-22-audit-remediation-*/
```

Do not update a row to a completion claim until the integrated candidate supplies direct
RED/GREEN/full-gate/runtime evidence. At the time of this overlay, precise commits, the
formal 30-minute Caddy capacity run, final full gates, PR, squash merge, new amd64 deploy,
and new-cloud observation are still pending. After PR merge, record the merge SHA
separately; after actual deployment and observation, record release health separately.

## Original advisory plans

The detailed `001-*.md` through `023-*.md` files are retained as historical planning and
candidate-patch context. Their instructions and `Done criteria` are not automatically
the remediation terminal contract. Where they conflict with the independent review or
new remediation child artifacts, the independent review and reviewed child artifacts
take precedence.
