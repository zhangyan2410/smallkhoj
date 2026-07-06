# Check Review

Date: 2026-07-06

Channel: `cr-read-cursor-body-scope`

Reviewer: `check-codex`

Result:

```text
P1/P2 blockers: 0 open
Issues found and fixed: none
Issues not fixed: 0 open
```

Reviewer summary:

- Confirmed `update_chat_read_cursor()` validates decoded JSON body shape before
  route-level `.get(...)` access.
- Confirmed present malformed `scope` values return the explicit shape error.
- Confirmed missing `scope` still allows the existing top-level thread fallback
  request shape.
- Confirmed validation happens before commits/writes.

Reviewer validation:

```text
backend HTTP cursor tests: 32 passed
backend cursor suite: 59 passed, 9 skipped in reviewer sandbox
backend py_compile: pass
frontend chat unread compatibility: 13 passed
git diff --check: pass
task.py validate: pass
```

Main-session validation remains stronger for the Postgres-backed cases:

```text
backend cursor suite: 68 passed
```
