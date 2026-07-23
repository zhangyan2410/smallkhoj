# Audit remediation integration and release design

## Candidate topology

```text
origin/main (synchronized)
  -> feat/2026-07-audit-remediation sibling worktree
       -> schema contract/commits
       -> auth/tenant contract/commits
       -> runtime/query contract/commits
       -> delivery/UI contract/commits
       -> architecture extractions
       -> approved product docs/route changes
       -> one integrated candidate SHA
            -> isolated PostgreSQL + backend + daemon + frontend
            -> CI-equivalent gates + automated flow + ./twd + trace
            -> re-audit + docs + review -> PR/squash
```

Children may be implemented as coherent commit series on the same remediation branch or
as reviewed child branches merged into it. In either case the integration candidate is
one linear, reproducible state and child boundaries remain visible in commits/evidence.

## Release manifest

The integration task maintains a manifest containing:

- base and candidate SHA;
- child task, terminal contract version and commit(s);
- migration revision order/checksum;
- Python/uv/PostgreSQL/Node/Bun/browser wrapper versions;
- env variable names with redacted values;
- isolated database/container, ports, PIDs and runtime URL;
- gate command, timestamp, result, duration and evidence path;
- approved product decisions and excluded/deferred linked tasks.

## Conflict protocol

```text
conflict detected
  -> classify mechanical or semantic
  -> identify owning invariants and RED tests
  -> create minimal combined failing case
  -> implement terminal contract
  -> run both child focused suites + integrated suite
  -> record resolution and discarded behavior
```

For 005/018, the terminal solution must simultaneously meet response snapshots, constant
query ceilings, SQL filter-before-limit and stable cursor traversal. For 017/022, it must
meet session finalization, subscription cleanup, one browser stream and targeted
invalidation. Neither advisor side wins by default.

## Database deployment state machine

```text
PREFLIGHT
  fresh DB ----------------------> UPGRADE_HEAD
  versioned DB -> verify revision -> UPGRADE_HEAD
  legacy DB -> read-only fingerprint -> STAMP_BASELINE_ONLY -> UPGRADE_HEAD
UPGRADE_HEAD -> POSTCHECK -> APP_ROLLOUT -> HEALTHCHECK
             -> failure: STOP / restore-or-forward-fix
```

Preflight has no mutating guess. An unknown legacy fingerprint stops. Postcheck includes
Alembic revision, schema/index/constraint/identity state and automatic sequence above
historical maximum. Application startup performs compatibility/data seeding only where
explicitly authorized; it cannot call create-all/DDL.

## Verification layers

```text
static/diff
  -> unit/characterization
  -> real PostgreSQL + ASGI integration
  -> full backend/frontend clean gates
  -> composed runtime health/trace
  -> ./twd visible workflows
  -> finding-by-finding re-audit
```

Higher layers do not erase lower failures. A screenshot cannot prove an FK or dependency
finalizer; a unit test cannot prove visible UI; a successful child branch cannot prove
conflict composition.

## Evidence matrix shape

| ID | Finding/contract | RED | Fix commit | Focused GREEN | Full gate | Runtime/UI | Verdict |
|---|---|---|---|---|---|---|---|
| example | 004 sequence | PG migration probe | SHA | migration test | backend | deploy postcheck | APPROVE |

Every confirmed defect has a row. Approved/deferred direction items instead link their
decision record and owning task.

## Rollout order

1. Backup/snapshot and read-only preflight.
2. Run schema migration and postchecks.
3. Deploy compatible backend/daemon with canonical auth/runtime config.
4. Deploy frontend with matching public configuration.
5. Run health/auth/NOTIFY/SSE/pagination/delete smoke checks.
6. Observe connection, error, queue and migration signals for the defined window.
7. Only then declare deployment healthy.

Rollback is component-specific. Reversible application/frontend changes may roll back
only to a version compatible with the migrated schema. Irreversible data migrations use
backup restore or reviewed forward-fix; documentation must not promise unsafe downgrade.

## Truth lifecycle

```text
candidate green -> docs say “candidate verified”
PR checks/review green -> docs may say “ready to merge”
squash merged to main -> docs/index say “merged” with SHA
deployed + health window -> release note may say “released/healthy”
```

This prevents the original audit error of equating advisor branch implementation with
current main/released truth.
