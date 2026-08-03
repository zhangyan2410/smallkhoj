# Coding Agent Harness Diagnostics — Planning Research

## Research Question

What evidence already exists locally to diagnose why a coding-agent result
diverged from intent, and what must remain outside the initial scope to avoid
rebuilding an operational telemetry dashboard?

## 1. Existing Session Observer Boundary

The existing
`../07-16-session-observability-console/prd.md` requires a standalone observer
with versioned HTTP ingest, SQLite persistence, deterministic lifecycle
projection, SSE updates, and a list/detail browser UI. Its research concludes
that the current SmallKhoj activity feed is backend-bound and not a durable
session aggregate.

That conclusion remains valid for operational session visibility. It does not
provide the additional truth sources required to explain outcome alignment:

- the original task contract and its evolution;
- what context and capabilities were exposed;
- which required capabilities were available but undiscovered or unused;
- the relationship between edits, validation evidence, and final claims;
- the contribution of workflow gates, human intervention, and agent decisions.

Decision: keep the existing task independent. Reuse lessons or an eventual
event adapter only when they serve the causal audit model; do not silently
retarget its benchmark.

## 2. cc-lens Reference Finding

`Arindam200/cc-lens` demonstrates that Claude Code project JSONL can support
conversation replay, tool/thinking/compaction rendering, and model/token
aggregation. Its implementation is tied to Claude paths and record semantics,
including Claude-specific user/assistant grouping and identifiers.

Decision: reuse it as evidence that a Claude native adapter is feasible, not as
the generic audit core. A replay UI does not establish task intent, harness
availability, outcome truth, or causal attribution.

## 3. Native Local Sources

Prior read-only schema discovery in the active Codex planning session found:

| Tool | Local source shape | Feasibility note |
| --- | --- | --- |
| Claude Code | project/session JSONL | Suitable first adapter; `trellis mem` already discovers/extracts cleaned dialogue |
| Codex | date-organized rollout JSONL | Suitable later adapter; `trellis mem` support exists |
| Pi | session JSONL | Adapter support exists in `trellis mem`, but this machine lacks a verified sample |
| Kimi Code | session index, state, main/subagent `wire.jsonl` | Contains turn prompts, context messages, loop steps, tool calls/results, and usage |
| ZCode | local SQLite plus JSONL rollout/logs | Rich turn/tool/model usage tables; suitable later adapter |
| OpenCode | local SQLite with session/message/part/event data | Source is feasible; the current `trellis mem` OpenCode reader is temporarily disabled after the SQLite migration |

Important correction to the early assumption: most tools map sessions to a
workspace from a user-level application store rather than writing a complete
trace inside the repository. Adapters need workspace/session discovery and
explicit user selection; they should not require agents to adopt a new ingest
protocol first.

## 4. MiniMax Calibration Evidence

The archived task
`../archive/2026-06/06-15-minimax-agent-reply-latency/prd.md` records a useful
diagnostic failure:

- provider/daemon traces suggested MiniMax cached context of roughly 72k–95k;
- native Claude Code session JSONL showed roughly 23k steady-state cache reads,
  comparable to other providers;
- the provider compatibility layer inflated reported cache fields by roughly
  2–8 times depending on the field;
- MiniMax remained slower per call, but context-size attribution was disproven.

This is an ideal calibration case for source authority and conflicting evidence.
The first adapter must retain both values and their provenance while preferring
native session usage for the session-token fact.

The archived
`../archive/2026-07/06-19-channel-task-workspace-optimization/evidence/runtask-productivity-smoke-20260624.md`
also records a non-trivial MiniMax-M3 run through Claude Code/CC Switch:

- 46 turns over roughly eight minutes;
- real Read/Bash/task/Slock tool activity;
- a durable research report and channel summary;
- a completed runtime result;
- missing normalized TaskRun output/usage fields despite productive work.

This is useful historical input because it contains an explicit task, native
session identity, output artifacts, and known gaps between runtime truth and
control-plane projection.

## 5. Existing SmallKhoj Evidence Surfaces

- `scripts/smallkhoj-trace.mjs` already shows a dependency-light root CLI
  pattern and combines runtime/log evidence for debugging.
- `docs/multi-agent-development-workflow.md` defines worktree, branch, real-test,
  review, PR, and squash-merge evidence expectations.
- Trellis tasks provide versioned PRD/design/implementation artifacts and task
  state that can serve as the explicit contract in deep audit mode.
- Git, package test commands, `./twd` browser artifacts, and review notes remain
  authoritative for their own outcome domains.

Decision: the first CLI should live under `tools/agent-audit` with a small root
wrapper, not inside managed `.trellis/scripts`, the backend, or the unfinished
session observer.

## 6. Evidence Hierarchy Learned from Current Comparisons

The Kimi and GLM session-observer attempts illustrate different harness risks:

- an implementation can invest deeply in one layer without reaching an early
  vertical slice or keeping the declared quality gate green;
- a broad vertical slice can still overclaim semantic evidence, such as a
  screenshot that exists but does not demonstrate the required viewport/state;
- quota interruptions and checklist-oriented evidence can shape results without
  proving a model limitation;
- neither agent could satisfy the newly clarified harness-diagnostics intent
  because that intent was not in the original task contract.

Decision: the audit must compare claims with outcome evidence, distinguish
stated from unstated intent, and retain unknowns. It must not interpret a
missing product goal that the agent never received as agent failure.

## 7. Initial Product Decisions

1. Single-run causal diagnosis is the fundamental unit.
2. Deep mode requires an explicit task contract.
3. The first output is a human-review evidence packet, not a dashboard or judge.
4. Native read-only sources come before a generic push protocol.
5. Agent self-report is a later claim source, not ground truth.
6. Tool-gap analysis requires a harness availability manifest.
7. The first coding-tool adapter is Claude Code.
8. The first model/provider calibration is MiniMax-M3 through CC Switch.
9. Node 22 standard-library tooling is the preferred Stage 1 implementation
   shape unless the child task finds contrary evidence.
10. Multi-tool and multi-run comparison wait until single-run utility is proven.

## 8. Remaining Research for Child Tasks

- Exact Claude JSONL record variants and stable source locators for tool calls,
  tool results, compact boundaries, and session metadata.
- A safe way to record declared tool availability and permissions at run start;
  session traces alone cannot prove the full available set.
- Which historical MiniMax session files can be used for local validation
  without committing private content.
- Selection of a fresh, non-circular MiniMax subject task for final Stage 1
  validation.
- Human-review completion time and which report sections actually change the
  next harness decision.

## 9. CodeGraph Default-Harness Evaluation

The user reported that CodeGraph helps with simple code tasks but is weak on
complex work and intends to stop using it. A local evaluation was run on
CodeGraph 1.0.1 after a full index rebuild (`585` files, `14,541` nodes,
`43,999` edges, approximately `47 MB`) to separate old-index problems from
current-engine behavior.

Observed results:

- **Exact known symbol: useful.** `query`, `node`, and `impact` accurately found
  `resolveDaemonUrl` and `extractTaskRunOutputMessageIdFromEvent`, showed their
  bodies, direct callers/callees, impact paths, and a relevant test file.
- **Medium fuzzy UI discovery: noisy.** A task-board drag/drop query found the
  relevant component, but also expanded across dozens of generic `Task`
  symbols and emitted large unrelated source sections.
- **Complex cross-layer discovery: misleading.** A query asking for the
  `outputMessageId` path from Claude tool result through daemon, backend, and
  frontend reported `205` symbols in `52` files and selected WebDriver's
  unrelated `result()` handler as primary source. A targeted exact search found
  the actual daemon extraction, lifecycle report, API normalization, service,
  model, tests, and frontend field immediately.
- **Project-policy/config discovery: failed.** Both before and after rebuilding,
  a query for CodeGraph integration and disable paths returned Linear and
  Impeccable hook code. Exact repository search found the real integration in
  `AGENTS.md`, `docs/codegraph-agent-guide.md`, `.codegraph/`, and the global
  Claude MCP config.
- **Conceptual/product diagnosis: failed.** A query about requirement/context/
  tool/workflow/human contributions selected Codex ACP/runtime code rather than
  task artifacts and harness evidence.
- **Context cost is material.** `explore` emits complete source bodies for
  weakly ranked matches. On complex questions, irrelevant output can consume
  more agent context and create more anchoring risk than a clean no-result.

Conclusion: CodeGraph is a specialized exact-symbol/call-graph assistant, not a
reliable default discovery or repository-knowledge tool for complex tasks. The
project-level "CodeGraph-first" mandate overstates its useful scope. Harness
Audit must not depend on it, and future runs must record whether it was
available, discoverable, used, or intentionally disabled.

Recommended decommission sequence, to execute later with explicit approval:

1. **Soft-disable default use:** remove the CodeGraph-first mandate from
   `AGENTS.md`, replace the guide with direct `rg`/targeted source inspection
   guidance, and remove CodeGraph gates from new task plans.
2. **Observe one or two complex tasks:** record search precision, missed entry
   points, context volume, and outcome quality with CodeGraph absent.
3. **Disable telemetry:** current CodeGraph telemetry is enabled; turn it off if
   the tool is no longer part of the harness.
4. **Remove agent exposure:** CodeGraph is configured as a global Claude MCP;
   uninstall that integration. It is not currently present in the inspected
   Codex config.
5. **Remove project index:** `codegraph uninit` deletes the ignored local
   `.codegraph/` directory. No CodeGraph background process was observed, so
   there is no daemon to stop now.
6. **Keep or uninstall the CLI separately:** retaining the binary for rare
   manual exact-symbol use does not require keeping it in the default harness.

The recommended initial action is soft-disable, not immediate binary removal.
That makes the change reversible and creates a clean harness intervention that
the audit initiative can evaluate.
