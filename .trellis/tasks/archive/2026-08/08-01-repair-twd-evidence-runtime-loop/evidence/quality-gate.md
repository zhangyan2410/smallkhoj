# Quality Gate — TWD evidence truth and runtime loop

Date: 2026-08-01 (Asia/Shanghai)

## Verdict

PASS for the task's `local-dev` scope. No `local-prod` or `cloud-prod` claim is
made. The task remains uncommitted and unpushed for operator review.

The original requirement was not only to make unit tests green: `./twd` had to
be used against the feature worktree in a real SmallKhoj Computer → Agent →
Channel → Task → Chat loop. That dogfood path completed, exposed an additional
Integration Gate false negative, received its own RED→GREEN repair, and the
real gate was rerun successfully.

## Acceptance matrix

| AC | Result | Implementation / regression proof | Real evidence |
| --- | --- | --- | --- |
| AC1 — timeout truth | PASS | `tmwebdriver_core.py` owns pending ACK/result lifecycle and raises coded failures; `test_twd_selection.py` covers no ACK, ACK without result, delayed late result, and stale-master compatibility. | `TWD_LOOP_20260801142749/twd-timeout.txt`: exact tab `1617512975` returned `ok=false`, `EXECUTION_TIMEOUT`, exit 1; a later command on the same tab succeeded without contamination. |
| AC2 — bridge ownership | PASS | `twd.py::resolve_twd_port()` searches all candidate bridges for exact tab / URL ownership; Python regressions cover exact-tab and URL ownership, both ambiguity forms, no owner, source-port aggregation, explicit port and a real dual-bridge fixture. | The live candidate used feature bridge WS 28765 / HTTP 28766 and exact tab `1617512975`. |
| AC3 — navigation / guard truth | PASS | `twd-auth-guard.mjs` compares origin/path/search/hash, uses bounded exact-tab polling, validates every returned tab ID, recovers a dead loopback tab before token acquisition, and retries trusted local login only on the selected tab. Node regressions cover wrong origin, unexpected query/hash, stale navigation success/timeout, foreign-origin login, browser-error recovery, no enumeration, and tab mismatch. | Final browser route was `http://127.0.0.1:13000/chat/twd-loop-142749`; `chat-final.png`, `task-final.png`, and `chat-gate-pass.png` are the selected visible artifacts. |
| AC4 — CLI reliability | PASS | Python regressions cover compact option in both positions, one-line handled failure and screenshot success, strict collapsed boolean including invalid input, serialized cleanup, stable action code and `CLEANUP_FAILED`. | The live timeout artifact is one-line JSON with a stable code and nonzero exit. |
| AC5 — canonical gates | PASS | Final candidate `make ci` passed on explicit disposable PostgreSQL databases: TWD 34, scripts 171 (1 skipped), backend 524, frontend 222, migrations/Alembic check, Ruff, ESLint, frontend + E2E TypeScript checks, Next production build, Compose config and `git diff --check`. Focused final-candidate runs also passed guard 30, Inkframe proof 13, Integration Gate unit 39, and daemon 281. | CI used only the disposable container on host port 55439; its temporary CI databases were removed afterward. |
| AC6 — real delivery loop | PASS | Feature worktree services and a real daemon/runtime were used; no mocked reply or direct database insertion supplied the agent answer. | Marker `TWD_LOOP_20260801142749`; Server `cd849e71-a112-4616-a22c-47e69f217d0e`; Computer `10bd4b45-ad8c-4e0b-a877-81e9163b1134`; Agent `fb1dfb45-5fab-454b-9adc-1557eabd914f`; Channel `5e20e51a-db54-4488-bcbc-fc66ba261251`; human message `99a449f0-8cdc-40b9-bc5a-6bc474ab4672`; threaded agent ACK `a11e4520-c708-4819-be5d-6777a49d2d3f`; Task `ca0116a0-683d-4b97-ba4d-f45d5974aa84` in review and assigned to that Agent. API, PostgreSQL and runtime trace agree. |
| AC7 — repair and rerun | PASS | The real run exposed long generated `.slock/.../.slock/slock` wrapper paths being truncated before the semantic command. A real-length daemon regression now requires normalization before the 200-character preview limit; the event-delivery spec records the rule. | Failed report retained as `integration-gate.json` (10/11, `SLOCK_SEND_MISSING`). Post-fix `integration-gate-pass.json` is `chat-gate-msa0udpg`, `chat-reply-channel-base`, 11/11, with visible `ACK_TWD_GATE_REPAIR_202608011500`. |

## Canonical CI environment audit

`make ci` was deliberately fail-closed while setting up the disposable
candidate:

1. The first attempt stopped at `verify-backend-env` because
   `E2E_DATABASE_SCOPE=disposable` was not supplied.
2. The second attempt supplied isolated URLs but named the migration template
   with only a `ci` marker. The repository-wide validator permits that marker,
   while the destructive PostgreSQL fixture permits only
   `test/audit/remediation/disposable`; 49 database tests therefore refused to
   start at the same safety assertion.
3. The final run used `smallkhoj_test_migration_template`, passed all gates, and
   removed `smallkhoj_ci_runtime`, `smallkhoj_ci_tests`, and the migration
   template through a cleanup trap.

These two preliminary exits were environment-guard failures, not candidate
implementation failures. They are retained here so the green result is not
presented without its setup history.

## Dogfood and evidence truth

Scope verdict: required and completed.

End-to-end path:

```text
isolated local Server
  → real connected Computer
  → real Agent runtime
  → real Channel with human + Agent
  → marker-bearing human message
  → real threaded Agent ACK through slock
  → assigned Task moved to in_review
  → exact-tab visible UI
  → API + PostgreSQL + runtime trace reconciliation
  → repository Integration Gate rerun
```

The passing Integration Gate report has `status=warning` only because it
contains the non-blocking `CONTEXT_EVIDENCE_MISSING` warning. The summary is
11 passed / 0 failed. No claim is made that `/context` evidence was verified.

`tasks.message_id` is `null` for the created Task, while `data.source` records
the source Channel. That existing product source-linkage limitation is recorded
but is not reinterpreted as verified message linkage and was not expanded into
this TWD repair.

## Hygiene and scope checks

- `git diff --check`: PASS after the final CI run.
- Credential scan of task evidence: no session, connect, machine, agent,
  provider, auth-bridge, or bearer-token patterns found. The saved Computer
  machine-token prefix is redacted.
- Repository-root media/design artifact scan: no matches.
- `.pen` design scan: no matches; there are no frontend product-source changes,
  so design comparison is not applicable.
- Architecture boundary: no new Store/Queue/Router/Adapter or cross-cell owner;
  the daemon change narrows the existing activity-preview sanitizer before its
  existing truncation boundary.
- Cat-cafe-specific hotfix, architecture-ownership, capability-tip and video
  gates are not part of SmallKhoj's executable repository contract and are
  reported N/A rather than fabricated as passing checks.

## Evidence index

The authoritative artifact index and candidate identity are in
`TWD_LOOP_20260801142749/notes.md`. Supporting files include exact-tab UI
screenshots, DOM snapshot, API JSON, PostgreSQL rows, daemon logs, runtime trace,
the live timeout result, the retained failing Gate report, and the post-repair
passing Gate report.
