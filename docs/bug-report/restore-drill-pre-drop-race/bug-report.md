# Restore drill pre-drop race

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | The PostgreSQL backup/restore drill plans and executes `dropdb --if-exists <restore_database>` before `createdb`. Expected: an existing restore-database name makes `createdb` fail closed without deleting anything. Actual: the drill first deletes whatever currently owns that name, so a same-name concurrent drill or operator database can be destroyed. |
| **2. Evidence** | Static execution trace in `scripts/postgres_backup_restore_drill.py`: `build_steps()` emits `backup -> drop-restore-db-before -> create-restore-db -> restore -> verify-restore -> drop-restore-db-after`, and `run_drill()` executes that order. Repository search found no second implementation that makes the pre-drop safe; the foundation gate already requires only the five non-pre-drop steps. RED/GREEN command evidence is recorded below. |
| **3. Root cause** | The original drill treated a deterministic temporary-name collision as stale state to erase. `--if-exists` suppresses only a missing-database error; it does not establish ownership. Therefore the drill has no proof that the database deleted before `createdb` was created by this invocation. |
| **4. Diagnostic strategy** | Trace the generated step list into the execution loop, compare it with the foundation gate's required step set, then add dry-run and command-execution regressions that reject any pre-create `dropdb` and preserve `createdb` collision failure. |
| **5. Timeout strategy** | If the focused regression did not reproduce within 15 minutes, stop editing and inspect the exact generated command list and mock call sequence; do not add runtime/database experiments or touch a shared PostgreSQL instance. |
| **6. Warning strategy** | Stop if a proposed fix catches `createdb` failure and continues, weakens collision failure, introduces a wildcard cleanup, or can run cleanup without evidence that this invocation's `createdb` succeeded. Three failed repair attempts would require design review rather than another patch. |
| **7. User-visible interaction correction** | No product UI changes. Operators now see the drill fail on an occupied restore-database name instead of silently deleting the existing database. They must select a new unique name or investigate the collision. |
| **8. Acceptance** | `test_dry_run_has_no_destructive_pre_cleanup` requires `backup/create/restore/verify/drop-after` and exactly one post-create `dropdb`. `test_createdb_collision_fails_without_cleanup` requires a failed `createdb` to end the drill without any `dropdb`. Focused tests and related foundation-script tests must pass. |

## Report

### Reporter

An independent release-plan review identified the destructive command ordering on
2026-07-24 while checking whether the restore drill was safe to execute against the
deployment database service.

### Reproduction

1. Build a dry-run plan with an explicit `--restore-database` name.
2. Observe that `drop-restore-db-before` precedes `create-restore-db`.
3. Consider another drill or operator database occupying the same name between name
   selection and command execution.

Expected: `createdb` reports the collision and the drill exits non-zero without
deleting the existing database.

Actual: the pre-drop deletes the existing database, then `createdb` succeeds, erasing
the collision evidence and the other owner's data.

### Root-cause analysis

The command builder has two cleanup operations but only the final one has an ownership
precondition: it follows this invocation's successful `createdb`. The initial cleanup
has no ownership token, lock, or successful-create evidence. Database-name uniqueness
cannot serve as ownership proof, especially when callers may pass a deterministic
`--restore-database` value. The safe PostgreSQL primitive is already present:
`createdb` fails when the database exists.

### Fix

Remove only the destructive pre-drop step. Preserve the normal final cleanup after a
successful create/restore/verify sequence. Do not catch or convert `createdb` name
collisions: they remain a failed drill and no cleanup is executed for that invocation.

Rejected alternatives:

- Keeping `dropdb --if-exists` and adding a time/name check: neither proves ownership.
- Retrying with deletion after `createdb` fails: this recreates the same race.
- Adding shared-database locking in this patch: unnecessary for the safe fail-closed
  behavior and materially expands the release-critical fix.

### Verification evidence

RED (before implementation):

```text
rtk python3 -m unittest scripts.tests.test_postgres_backup_restore_drill -v
exit code: 1
Ran 3 tests in 0.002s
FAILED (failures=2)
```

Both failures were the intended regression signal: the actual results contained
`drop-restore-db-before`, while the expected dry-run and collision paths did not.

GREEN (after removing the pre-drop step):

```text
rtk python3 -m unittest scripts.tests.test_postgres_backup_restore_drill -v
exit code: 0
Ran 3 tests in 0.002s
OK
```

Related foundation-script regression:

```text
rtk python3 -m unittest scripts.tests.test_postgres_backup_restore_drill scripts.tests.test_initial_release_foundation_gate -v
exit code: 0
Ran 24 tests in 10.465s
OK
```
