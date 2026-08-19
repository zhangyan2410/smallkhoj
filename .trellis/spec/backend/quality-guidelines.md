# Quality Guidelines

> Code quality standards for backend development.

> **⚠️ 空模板，勿据此开发。** 本文件正文尚未填写。填实归属任务：
> `.trellis/tasks/08-19-agent-platform-quality-gates`（R2 pre-commit 门禁 /
> R5 错误分类学 / R6 文件头契约注释落地后一起填）。在那之前，
> 不要引用本文件的任何"规范"。

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
  `python3 scripts/initial_release_foundation_gate.py --base-url <public-url> [--daemon-package-version <published-package-version>] [--allow-http] [--env-file <path>] [--runtime] [--skip-backend-tests] [--strict-warnings] [--partial] [--json]`
- Backup/restore drill command:
  `python3 scripts/postgres_backup_restore_drill.py [--dry-run] [--env-file <path>] [--compose-file <path>] [--backup-dir <path>] [--restore-database <name>] [--json]`
- JSON report fields include `ready`, `failures`, `blocked`, `warnings`, `p0Warnings`, `risks`, and `checks`.

### 3. Contracts
- `ready` must be false when there are failures, blocked checks, or any P0 warning.
- P0 warnings are not accepted release-ready states unless the release definition is explicitly narrowed outside the gate.
- `--strict-warnings` additionally makes non-P0 warnings produce a warning exit code.
- `--partial` is only for developing checks and must not be used as release-candidate evidence.
- Scripts must not print secret values. Env paths, key names, and `<set>`/`<empty>` summaries are allowed.
- A backup/restore drill must fail closed on a restore-database name collision. Its
  executable step order is `backup -> create -> restore -> verify -> drop-after`;
  it must never issue a pre-create `dropdb`. A failed `createdb` ends the drill, and
  cleanup is permitted only after this invocation's `createdb` succeeded.
- Risk-register existence is tracking evidence only. It must not be used as the passing gate for a product P0 risk such as account/server/channel isolation.
- Gates that consume Trellis task evidence must search both the active task path and archived task paths under `.trellis/tasks/archive/<year-month>/`. Completed evidence must not become invisible after `task.py archive`.

### 4. Validation & Error Matrix
- Missing P0 executable coverage -> `blocked`, exit code `3`.
- Failed check -> `failed`, exit code `1`.
- P0 warning with no failures/blocked checks -> `warning`, `ready=false`, exit code `2`.
- Non-P0 warning with `--strict-warnings` -> exit code `2`.
- Non-P0 warning without `--strict-warnings` -> `ready=true` only if there are no failures, blocked checks, or P0 warnings.
- Evidence exists only in an archived Trellis task -> inspect that evidence normally; do not fall back to a dry-run warning or missing-risk failure.

### 5. Good/Base/Bad Cases
- Good: a deployed smoke check passes and FR-04 records a concrete WebSocket auth rejection result.
- Good: an archived foundation task's `risk-register.md` and `evidence/postgres_backup_restore_drill_*.json` remain valid inputs for the current gate.
- Good: a dry-run backup/restore plan records command shape but returns a P0 warning until a real restore executes.
- Base: a P1 capacity warning can remain a warning when the initial release explicitly accepts the limitation.
- Bad: returning `ready=true` when FR-07 has only dry-run evidence.
- Bad: using `--partial` output as release-candidate evidence.
- Bad: marking FR-01 passed because the risk register mentions FR-01.
- Bad: hard-coding only `.trellis/tasks/<task>/...` for evidence that survives task archival.

### 6. Tests Required
- Unit test that P0 warnings increment `p0Warnings`, make `ready=false`, and return exit code `2`.
- Unit test that JSON output omits secret values.
- Regression tests must reject every pre-create `dropdb`, require the five-step
  backup/create/restore/verify/drop-after plan, and prove a `createdb` collision fails
  without cleanup.
- Unit test for each new gate mapping to the intended `riskId` and priority.
- Unit test that tracking/meta checks do not accidentally satisfy product P0 coverage.
- Regression test that archived task evidence is found after the active task directory is moved to `.trellis/tasks/archive/<year-month>/`.
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

#### Wrong
```text
Read only .trellis/tasks/06-29-.../risk-register.md; after archive, report FOUNDATION_RISK_REGISTER_MISSING.
```

#### Correct
```text
Search .trellis/tasks/06-29-... first, then .trellis/tasks/archive/*/06-29-... before deciding evidence is missing.
```

## Scenario: Integration Gate Runtime/Profile Selection and Skip Semantics

### 1. Scope / Trigger

- Trigger: changing `tools/integration-gate/foundation-gate.mjs`, `tools/integration-gate/run.mjs`, the Integration Gate result consumer, or runtime readiness/control evidence.
- This is a public CLI and cross-layer evidence contract: Computer/runtime snapshot + optional daemon evidence -> isolated runtime report -> optional four-runtime matrix -> frontend Gate console.

### 2. Signatures

- CLI: `node tools/integration-gate/run.mjs --runtime <all|claude_code|codex|opencode|pi> [--runtime-control-result <path>] [--daemon-rpc-base <url>] [--runtime-agent-id <id>]`.
- Default: `--runtime all`.
- Per-runtime report: `{mode:"foundation-only", runtime, ok, steps[12], failures, summary:{total,passed,failed,skipped}}`.
- Matrix report: `{runtime:"all", runtimeReports[4], steps[48], summary}`.
- Non-applicable step: `{status:"skip", applicable:false, evidence:{runtime,reason}}`.

### 3. Contracts

- Runtime matching uses the canonical runtime type only. Provider/model metadata, including MiniMax, is separate test invocation evidence and cannot select or cross-match a runtime family.
- Detection, workspace reuse, running/warmup, session evidence, and automatic runtime-control Agent selection must all use the same target profile.
- The four canonical profiles are `claude_code`, `codex`, `opencode`, and `pi`; `all` builds four isolated reports in that order. A fully green matrix has 48 steps: 44 pass and 4 explicit skips.
- Claude requires `/context`; Codex requires `/status`. OpenCode and Pi do not currently expose supported context/compact control, so `context-preflight` and `compact-if-needed` are `skip` with `applicable:false`; skip is truthful non-applicability, not pass or unknown.
- Daemon log warmup evidence is scoped to the exact selected Agent id. Unowned/global log text or another Agent's token/warmup failure must not satisfy or poison a profile.
- Runtime-control evidence is usable only when its canonical `runtime` and exact `agentId` match the selected profile/workspace. Otherwise context/limit fields are discarded and applicable steps fail with `RUNTIME_CONTROL_TARGET_MISMATCH`.
- `--runtime-control-result`, `--context-output`, and `--runtime-agent-id` require a single runtime where applicable; one static evidence file cannot be broadcast across `all`.
- The Gate must not edit, switch, reorder, disable, or delete any local runtime/provider configuration. Provider/model setup is an operator-owned precondition; if safe isolated setup cannot be proven before a write, record a blocker instead of mutating configuration.
- The seven historical mode names remain stable. Runtime selection changes Foundation readiness only and does not silently alter chat/collaboration scenario semantics.
- Collaboration audience resolution (07-30 task `07-30-integration-gate-review-fixes`): when collaboration execution starts with a channel name but no durable `--channel-id`, it must reuse the channel ID returned by the message-send response to load channel membership before evaluating V1/V2/V3 audience evidence — never evaluate audience evidence against an unresolved or guessed channel identity. When `--channel-id` is supplied explicitly, keep the fast path and do not issue a duplicate membership request for the same resolved channel.

### 4. Validation & Error Matrix

| Condition | Expected behavior |
| --- | --- |
| Unsupported `--runtime` | `CONFIG_ERROR UNSUPPORTED_RUNTIME`, exit `2`, before network access. |
| `--runtime all` plus static context/control evidence | `CONFIG_ERROR RUNTIME_EVIDENCE_REQUIRES_SINGLE_RUNTIME`, exit `2`. |
| `--runtime all` plus explicit runtime Agent id | `CONFIG_ERROR RUNTIME_AGENT_ID_REQUIRES_SINGLE_RUNTIME`, exit `2`. |
| Target runtime missing/running session missing | Runtime-specific strict step failure; another runtime cannot satisfy it. |
| Runtime-control `runtime` or `agentId` missing/mismatched | Context/compact fail with `RUNTIME_CONTROL_TARGET_MISMATCH`; evidence is retained only as safe diagnostic metadata. |
| Log failure names another Agent | Ignore it for the target profile; do not report target warmup failure. |
| OpenCode/Pi context control unsupported | Two explicit `skip` rows with `applicable:false`; other ten steps remain strict. |
| Provider/model contains another runtime name | Ignore it for family matching; use only canonical runtime identity. |
| Collaboration starts with a channel name, no `--channel-id` | Resolve the channel from the send-returned channel ID, then load membership and evaluate V1/V2/V3; unresolved identity is a failure, not an empty audience. |
| `--channel-id` already supplied | Membership fast path; no duplicate membership request for the same resolved channel. |

### 5. Good/Base/Bad Cases

- Good: a Codex workspace with `runtime:"codex"`, `runtimeProvider:"MiniMax"`, running session, and matching `/status` result passes the Codex profile.
- Good: OpenCode and Pi each pass ten strict Foundation steps and show two explicit skips.
- Base: `all` runs four reports against one Computer snapshot while every workspace/session/log/control observation stays correlated to its own profile.
- Bad: a MiniMax Claude provider name makes a Codex workspace satisfy Claude readiness.
- Bad: one OpenCode Agent's `MISSING_TOKEN` daemon log fails all four runtime warmup steps.
- Bad: a static Codex `/status` JSON file supplies Claude context percentage evidence.

### 6. Tests Required

- Foundation model tests assert canonical runtime/provider independence, no workspace cross-match, OpenCode/Pi skip shape, 48-step matrix totals, and exact Agent log filtering.
- CLI tests assert default `all`, all five accepted runtime values, unsupported-runtime pre-network exit `2`, Codex automatic Agent selection, OpenCode/Pi strict runtime/session behavior, and preservation of all seven mode names.
- Static and dynamic runtime-control tests assert matching `runtime + agentId` evidence passes and missing/mismatched identity fails with `RUNTIME_CONTROL_TARGET_MISMATCH`.
- Mixed daemon-log tests assert one Agent's warmup/token error cannot poison another runtime profile.
- Collaboration CLI tests prove name-only starts resolve membership via the send-returned channel ID (red without the fix) and explicit `--channel-id` runs make exactly one membership request.
- Result-consumer/UI tests assert `skip` remains skipped and contributes to `summary.skipped`, never `unknown` or pass.
- Pure contract suite: `node --test tools/integration-gate/*.test.mjs`; it must remain service-free and database-free.

### 7. Wrong vs Correct

#### Wrong

```javascript
const candidate = workspaces.find((w) => JSON.stringify(w).includes('MiniMax'));
for (const runtime of runtimeTargets) buildReport({ runtime, runtimeHealth: parseDaemonRuntimeHealth(allLogs) });
```

#### Correct

```javascript
const agentId = selectRuntimeAgentIdForTarget(computers, runtime);
const runtimeHealth = parseDaemonRuntimeHealth(allLogs, { runtime, agentId });
const control = correlateRuntimeControlEvidence(rawControl, { runtime, agentId });
buildReport({ runtime, runtimeHealth, contextUsage: control.contextUsage });
```
