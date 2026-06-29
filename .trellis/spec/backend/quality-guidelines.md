# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)

## Scenario: Initial Release Foundation Gates

### 1. Scope / Trigger
- Trigger: adding or changing release-readiness scripts that decide whether the initial release foundation is ready.
- Applies to `scripts/initial_release_foundation_gate.py` and supporting validation scripts under `scripts/`.

### 2. Signatures
- Foundation gate command:
  `python3 scripts/initial_release_foundation_gate.py --base-url <public-url> [--allow-http] [--env-file <path>] [--runtime] [--skip-backend-tests] [--strict-warnings] [--partial] [--json]`
- Backup/restore drill command:
  `python3 scripts/postgres_backup_restore_drill.py [--dry-run] [--env-file <path>] [--compose-file <path>] [--backup-dir <path>] [--restore-database <name>] [--json]`
- JSON report fields include `ready`, `failures`, `blocked`, `warnings`, `p0Warnings`, `risks`, and `checks`.

### 3. Contracts
- `ready` must be false when there are failures, blocked checks, or any P0 warning.
- P0 warnings are not accepted release-ready states unless the release definition is explicitly narrowed outside the gate.
- `--strict-warnings` additionally makes non-P0 warnings produce a warning exit code.
- `--partial` is only for developing checks and must not be used as release-candidate evidence.
- Scripts must not print secret values. Env paths, key names, and `<set>`/`<empty>` summaries are allowed.

### 4. Validation & Error Matrix
- Missing P0 executable coverage -> `blocked`, exit code `3`.
- Failed check -> `failed`, exit code `1`.
- P0 warning with no failures/blocked checks -> `warning`, `ready=false`, exit code `2`.
- Non-P0 warning with `--strict-warnings` -> exit code `2`.
- Non-P0 warning without `--strict-warnings` -> `ready=true` only if there are no failures, blocked checks, or P0 warnings.

### 5. Good/Base/Bad Cases
- Good: a deployed smoke check passes and FR-04 records a concrete WebSocket auth rejection result.
- Good: a dry-run backup/restore plan records command shape but returns a P0 warning until a real restore executes.
- Base: a P1 capacity warning can remain a warning when the initial release explicitly accepts the limitation.
- Bad: returning `ready=true` when FR-07 has only dry-run evidence.
- Bad: using `--partial` output as release-candidate evidence.

### 6. Tests Required
- Unit test that P0 warnings increment `p0Warnings`, make `ready=false`, and return exit code `2`.
- Unit test that JSON output omits secret values.
- Unit test for each new gate mapping to the intended `riskId` and priority.
- Task evidence must record the command, target environment, exit code, summary, and any non-pass release decision.

### 7. Wrong vs Correct
#### Wrong
```text
0 failed + 0 blocked + 1 P0 warning -> ready=true
```

#### Correct
```text
0 failed + 0 blocked + 1 P0 warning -> ready=false, exit code 2
```
