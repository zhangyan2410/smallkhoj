# TWD real runtime delivery evidence

## Scope and candidate identity

- Scope claimed: `local-dev` only. No `local-prod` or `cloud-prod` claim.
- Worktree: `/Users/code/project/smallkhoj-repair-twd-evidence-runtime-loop`
- Branch: `feat/repair-twd-evidence-runtime-loop`
- Backend: `http://127.0.0.1:18000`
- Frontend: `http://127.0.0.1:13000`
- PostgreSQL: disposable container `smallkhoj-twd-loop-db-20260801`, host port 55439
- TWD bridge: feature candidate on WebSocket 28765 / HTTP 28766
- Exact Chrome tab: `1617512975`

## Real product resources

- Marker: `TWD_LOOP_20260801142749`
- Server: `cd849e71-a112-4616-a22c-47e69f217d0e`
- Computer: `10bd4b45-ad8c-4e0b-a877-81e9163b1134` (`twd-loop-142749`)
- Agent: `fb1dfb45-5fab-454b-9adc-1557eabd914f` (`loopagent-142749`)
- Workspace: `ef7f0b04-2282-49bf-925b-13841ecba687`
- Channel: `5e20e51a-db54-4488-bcbc-fc66ba261251` (`#twd-loop-142749`)
- Human message: `99a449f0-8cdc-40b9-bc5a-6bc474ab4672`, seq 1
- Agent reply: `a11e4520-c708-4819-be5d-6777a49d2d3f`, seq 2, parent is the human message
- Task #1: `ca0116a0-683d-4b97-ba4d-f45d5974aa84`, `in_review`, assigned to `loopagent-142749`

## Acceptance results

- Visible `./twd` evidence shows the exact local origin, the human marker, the
  real agent ACK, two Channel members, and Task #1 in the review column with
  the intended assignee.
- API and PostgreSQL evidence agree on message/channel/agent/task identities.
- Runtime trace `chat-send:ms9zyz5s:746631a9-2b9` completed with
  `daemon.runtime.result`, status `ok`, model `glm-5.2`.
- A live delayed exact-tab eval returned exit 1 and `EXECUTION_TIMEOUT`; after
  the late result arrived, the same tab completed a fresh eval successfully.
- First post-run Integration Gate reproduced a false negative: the real reply
  persisted, but the daemon's 200-character activity truncation cut the long
  wrapper path at `.slock/slo…`, so the Gate reported `SLOCK_SEND_MISSING`.
- After a RED regression and source repair, gate run `chat-gate-msa0udpg`
  passed all 11 checks. `commandPreview` now starts with
  `slock message send`, the target is `#twd-loop-142749`, and the visible reply
  is `ACK_TWD_GATE_REPAIR_202608011500`.
- The passing Gate retains a non-blocking `CONTEXT_EVIDENCE_MISSING` warning
  because no `/context` artifact was supplied. This is not claimed as context
  verification.

## Bug diagnosis capsules

### TWD false-success and wrong-target evidence

1. Phenomenon: timeouts could become `ok=true`; auto discovery could select an
   unrelated bridge; navigation/guard checks could accept stale or wrong-origin
   pages.
2. Evidence: deterministic no-ACK/ACK-without-result fixtures, a two-bridge
   fixture, full-URL guard tests, and the live delayed exact-tab probe.
3. Root cause: the core returned diagnostic dictionaries as ordinary results,
   the CLI selected the first populated bridge, and the guard checked only a
   partial URL with a single post-navigation probe.
4. Diagnostic strategy: trace execution ID lifecycle and compare original
   bridge/core behavior with SmallKhoj's wrapper/selection additions.
5. Timeout strategy: explicit bounded ACK/result deadlines and cleanup in a
   `finally` block; late results are rejected when no pending execution owns the
   ID.
6. Warning strategy: stable JSON codes and nonzero exits; no human-text parsing.
7. User-visible correction: exact-tab/full-origin evidence and one-line compact
   failures.
8. Acceptance: focused Python/Node suites plus live timeout and real UI/runtime
   flow.

### Dead loopback page before authentication

1. Phenomenon: after a local service restart, the selected tab became
   `chrome-error://chromewebdata/`; cookie injection failed before navigation.
2. Evidence: live exact-tab guard failure on the restarted candidate.
3. Root cause: the guard obtained and injected a reusable token before proving
   that the selected page was on the configured frontend origin.
4. Diagnostic strategy: split origin recovery, token acquisition, cookie
   injection, navigation, and final probe into observable boundaries.
5. Timeout strategy: bounded exact-tab navigation polling.
6. Warning strategy: never include the token-bearing eval argv in an error.
7. User-visible correction: recover the same tab through loopback `/login`.
8. Acceptance: guard regression plus live recovery from `chrome-error://` to
   `http://127.0.0.1:13000/members`.

### Integration Gate `SLOCK_SEND_MISSING` false negative

1. Phenomenon: a real ACK existed in UI/API/DB, but Gate result was 10/11.
2. Evidence: failed report `integration-gate.json` and activity preview ending
   at `.slock/slo…`.
3. Root cause: generic 200-character truncation ran after a very long generated
   absolute wrapper path, before the semantic `message send` portion.
4. Diagnostic strategy: compare persisted reply, runtime session tool use,
   activity preview, and Gate regex input.
5. Timeout strategy: the Gate kept its original 180-second bound; no check was
   weakened.
6. Warning strategy: retain the failed report and produce a separate post-fix
   report.
7. User-visible correction: none; this was an automation evidence defect.
8. Acceptance: real-length RED test, sanitizer GREEN, daemon rebuild/restart,
   and real Gate `PASS chat-reply-channel-base 11/11`.

## Artifact index

- `chat-final.png` — original marker and threaded ACK visible.
- `task-final.png` — Task #1 in review with the intended assignee.
- `chat-gate-pass.png` — repaired Gate marker and agent ACK visible together.
- `members.snapshot.txt` — visible Computer/Agent state snapshot.
- `api-*.json` — API cross-checks for the original marker.
- `db.txt` — selected PostgreSQL identity/state rows.
- `daemon-logs.json` and `trace.txt` — runtime/control-plane evidence.
- `twd-timeout.txt` — live timeout/late-result isolation evidence.
- `integration-gate.json` — retained 10/11 false-negative reproduction.
- `integration-gate-pass.json` — post-fix 11/11 result.
