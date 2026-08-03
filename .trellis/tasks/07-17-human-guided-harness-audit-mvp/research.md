# Human-Guided Single-Run Harness Audit MVP — Research Notes

## 1. Why Claude Code Is the First Adapter

- The selected model/provider, MiniMax-M3 through CC Switch, runs inside Claude
  Code and therefore leaves Claude Code native project/session JSONL.
- `trellis mem` already discovers Claude sessions by project and can return
  cleaned dialogue, proving local workspace/session mapping is available.
- cc-lens independently demonstrates replay of Claude user/assistant/tool,
  thinking, and compaction records.
- Existing SmallKhoj archived MiniMax evidence cites exact Claude session IDs
  and native usage as the correction source for provider-report inflation.

The adapter is named for the coding tool (`claude`/`claude-code`), not for
MiniMax. Provider/model are subject metadata.

## 2. Historical MiniMax Ground-Truth Lesson

`../archive/2026-06/06-15-minimax-agent-reply-latency/prd.md` and its `info.md`
record that an earlier diagnosis attributed roughly 72k–95k cached tokens to a
large MiniMax static prompt. Native Claude session JSONL showed roughly 23k
steady-state cache reads, comparable to other providers. Provider/daemon
aggregate fields were inflated.

The MVP must therefore implement this pattern:

```text
provider aggregate value
  -> retained as observed provider evidence
native Claude session usage
  -> retained as observed session evidence
authority rule
  -> native session wins for session-token fact
report
  -> shows conflict and limitation, does not delete either source
```

This is a concrete regression oracle for evidence authority, not merely a
MiniMax performance metric.

## 3. Historical Productive Run Candidate

`../archive/2026-07/06-19-channel-task-workspace-optimization/evidence/runtask-productivity-smoke-20260624.md`
describes a useful MiniMax-M3/Claude Code run:

- explicit research assignment and marker;
- known worktree, runtime/tool/provider, agent, channel, and task identity;
- 46 turns and observable Read/Bash/task/Slock activity;
- a durable research report and final channel message;
- completed runtime result;
- incomplete control-plane normalization of output/token/context evidence.

It is suitable for private historical validation because the expected output
and known evidence gaps are already documented. The real JSONL remains local
and must not be copied into fixtures or committed evidence.

## 4. Existing CLI Pattern

The repository-root `smallkhoj-trace` wrapper executes
`scripts/smallkhoj-trace.mjs` with Node and uses standard-library filesystem,
process, HTTP, and child-process functions. Its pattern supports a small root
entry point without adding the CLI to backend/frontend packages.

Decision: use the same root-wrapper shape, but place the new implementation in
`tools/agent-audit/` because it is a standalone audit tool with its own tests and
fixtures.

## 5. Why `trellis mem` Is Not the Whole Implementation

`trellis mem` is valuable for session discovery and cleaned conversational
recall. Its public CLI supports JSON output and task-phase slicing for Claude,
Codex, and Pi. However a causal audit needs evidence that a cleaned dialogue
projection may omit or aggregate:

- stable raw tool-call/result relationships;
- source line/record locators;
- unknown/malformed record warnings;
- native usage/source conflicts;
- exact context-access ordering;
- privacy/redaction decisions made at normalization time.

Decision: the MVP reads the exact selected Claude JSONL through its own
read-only adapter. It may use `trellis mem` as a discovery aid only if the CLI
contract remains independently testable with synthetic stores.

## 6. Why a Harness Manifest Is Required

A session records what happened, not necessarily everything that was available.
For example:

- no WebDriver call could mean no browser tool, an undiscoverable tool, a
  permission restriction, an agent decision, or a task that did not require it;
- a tool definition may have been injected but never invoked;
- project instructions may name a tool that was absent from the runtime;
- provider/tool versions and permissions may change between runs.

Decision: a pre-run versioned harness manifest is required for deep diagnosis.
The report compares declarations with observations and preserves contradictions.

## 7. Fresh Subject Decision

Use a new bounded, non-trivial project task after the CLI passes synthetic and
historical MiniMax validation. Freeze its contract and harness manifest before
starting Claude Code through MiniMax-M3, and withhold the audit implementation
and prior findings from the subject until the run ends.

The original `07-16-session-observability-console` contract is excluded from
fresh validation because:

- Kimi and GLM implementations already exist in sibling worktrees;
- prior reviews expose likely failure modes and would contaminate a new run;
- its original CodeGraph-first constraint no longer represents the planned
  default harness;
- it encodes an earlier operational-observer interpretation rather than the
  newly clarified harness-diagnostics intent;
- same-task comparability would not compensate for these uncontrolled changes.

This sacrifices immediate Kimi/GLM/MiniMax comparison in favor of a cleaner
first causal audit. Controlled comparison remains a later parent stage.

## 8. CodeGraph as a Harness Variable

The user intends to stop using CodeGraph for complex tasks. A focused evaluation
was performed after rebuilding the CodeGraph 1.0.1 index with the current
engine. The result is consistent with that preference:

- exact known-symbol lookup, source display, caller/callee trails, and impact
  analysis were accurate and fast;
- fuzzy medium queries produced the correct entry point mixed with many generic
  type/name collisions;
- a concrete cross-layer `TaskRun.outputMessageId` discovery query selected an
  unrelated WebDriver `result()` function and omitted the actual end-to-end
  path that targeted `rg` exposed;
- project policy/disable queries ignored Markdown/config integration and
  returned unrelated Linear/Impeccable hook symbols;
- conceptual harness-diagnosis queries anchored on Codex ACP source rather than
  requirements, context provenance, tools, workflow, and human intervention;
- large irrelevant source dumps create direct context-pollution risk for the
  model using the tool.

Decision for this MVP:

1. `agent-audit` has no CodeGraph runtime or build dependency.
2. Harness manifests explicitly record CodeGraph like any other tool:
   `available`, exposure/discoverability, permission, use observations, and an
   intentional-disabled reason.
3. No CodeGraph call is required to prove source discovery or validation.
4. The fresh MiniMax run should use the post-soft-disable harness if the
   separate project-policy change has landed; otherwise the current mandate is
   recorded as a confounding harness constraint.
5. A later before/after report may use CodeGraph removal as the first concrete
   harness intervention, but it must measure outcome/decision effects rather
   than assume removal is beneficial.

The current installation state is relevant to the later shutdown task:

- the ignored project index is approximately `47 MB` under `.codegraph/`;
- no CodeGraph background process was observed;
- telemetry is currently enabled;
- Claude has a global CodeGraph MCP entry;
- the inspected Codex config has no CodeGraph entry;
- the repository mandates CodeGraph-first in `AGENTS.md` and documents it in
  `docs/codegraph-agent-guide.md`.

No installation, policy, telemetry, MCP, or index removal is performed by this
planning change.

## 9. Implementation Unknowns to Resolve with Fixtures

- Claude JSONL variants emitted by the installed Claude Code version.
- Whether tool availability/version is recorded natively or only in the
  harness manifest.
- Reliable workspace metadata for exact session discovery.
- Stable handling of subagents/sidechains without flattening false turn
  semantics.
- How completion/result records differ across native Claude and CC Switch
  provider modes.
- Safe bounded extraction of explicit block/completion claims.
- Git snapshot behavior for large untracked/binary files and symlinks.
- Whether image metadata can be read with Node standard library alone; if not,
  dimensions remain an optional unsupported field rather than adding a heavy
  dependency.

These are implementation research questions and do not require user preference
unless they force a product-scope change.
