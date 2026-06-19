# Agent Handoff SOP

## Purpose

Use this SOP whenever a human or supervisor assigns one of the 25 product-maturity child tasks to an agent. It reduces ambiguity and keeps every task aligned with the parent goal.

## Before Starting A Child Task

1. Read the child task's `prd.md`.
2. Read the child task's `info.md`.
3. Read every entry in `implement.jsonl`.
4. Check current dirty git state and avoid reverting unrelated work.
5. Inspect the current implementation before editing.
6. Identify whether the task is browser-facing, runtime/control-plane, backend-only, docs-only, or mixed.

## Required Implementation Behavior

* Prefer existing local patterns and APIs.
* Keep SmallKhoj's UI identity cyan/blue and product-workbench-like.
* Do not copy Slock's exact black-border/brutalist/pink styling.
* Do not use Kimi WebBridge or Playwright for repository UI verification.
* Use project WebDriver: `agent/daemon/webdriver/twd ...`.
* For runtime/control-plane paths, use `./smallkhoj-trace summary` or `./smallkhoj-trace summary --json`.
* If backend support is missing, document the exact missing contract and create/update a follow-up task rather than hiding the gap with fake UI.

## Required Evidence

Each browser-facing or runtime/control-plane task must produce evidence under the task directory:

```text
evidence/
  REAL_<task>_<timestamp>-browser.png
  REAL_<task>_<timestamp>-notes.md
  REAL_<task>_<timestamp>-api.json        # when API state matters
  REAL_<task>_<timestamp>-db.txt          # when DB state matters
  REAL_<task>_<timestamp>-trace.json      # when daemon/runtime matters
```

The notes file must include:

* marker used
* commands run
* browser route tested
* visible DOM assertion
* API/DB/trace checks performed
* pass/fail result
* remaining gaps

## Suggested Command Skeleton

```bash
agent/daemon/webdriver/twd --compact tabs
agent/daemon/webdriver/twd goto --url-match 127.0.0.1:3000 http://127.0.0.1:3000/
agent/daemon/webdriver/twd scan --text --url-match 127.0.0.1:3000
agent/daemon/webdriver/twd screenshot --url-match 127.0.0.1:3000 .trellis/tasks/<task>/evidence/<marker>-browser.png
./smallkhoj-trace summary --json
```

## Check Agent Responsibilities

The check agent must verify:

* PRD acceptance criteria are actually covered.
* `info.md` plan/spec/SOP was followed.
* `twd.py` evidence exists when required.
* API/DB/trace evidence exists when relevant.
* UI does not regress into a backend-verification page.
* No unrelated dirty files were reverted or included.
* Any new contracts/gotchas were captured in `.trellis/spec/`.

## Escalation Rules

Escalate to the human/supervisor when:

* Slock behavior and SmallKhoj architecture conflict.
* Backend support is missing and requires a product decision.
* A real-test SOP repeatedly fails in a way that automated tests miss.
* The task would require broad refactoring outside its intended scope.

## Parent References

* Parent PRD: `prd.md`
* Execution roadmap: `execution-roadmap.md`
* Real test SOP draft: `real-test-sop-integration.md`
* Slock research: `research/slock-product-surface.md`
* SmallKhoj gap research: `research/smallkhoj-current-gap.md`
