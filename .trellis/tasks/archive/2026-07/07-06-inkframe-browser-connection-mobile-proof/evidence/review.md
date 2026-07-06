# Review Evidence

Date: 2026-07-06

Channel:

```text
cr-07-06-inkframe-browser-proof-and-postgres-followup
```

Reviewer:

```text
check-followup (Codex check agent)
```

## Result

The check agent reviewed:

- this task's `prd.md`, `design.md`, `implement.md`, and
  `evidence/browser-recovery.md`;
- the related backend HTTP cursor evidence;
- `backend/tests/test_chat_read_cursors_postgres_http.py`;
- WebDriver/frontend quality guidance.

## Findings Fixed

1. `implement.md` preflight directory creation used plain `mkdir`; reviewer
   changed it to `rtk mkdir -p ...` to match the project RTK instruction.
2. `implement.md` review-spawn command omitted
   `.agents/skills/project-webdriver-cli/SKILL.md`; reviewer added it so a
   future review worker receives the WebDriver rules.

## Open Issues

None from the review.

## Review Notes

- Browser evidence is truthful: the task records that `./twd` has no connected
  tab and does not claim chat/task/mobile acceptance.
- The new browser proof task is detailed enough for another agent to execute
  once Chrome or another supported browser tab is connected.
- The added Postgres tests are meaningful and isolated.
- The reviewer could not run the Postgres tests to full pass in its sandbox
  because local Postgres access returned `Operation not permitted`, but it
  confirmed collection counts and the main-session evidence.

## Main-Session Verification After Review And Follow-Up

```text
focused HTTP + Postgres HTTP tests: 17 passed in 1.56s
focused Postgres HTTP file: 7 passed in 1.67s
combined cursor/account/Postgres suite: 57 passed in 1.48s
backend compile: pass
git diff --check: pass
```
