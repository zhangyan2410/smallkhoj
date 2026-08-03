# Coding Agent Harness Diagnostics

## Goal

Build a local-first, evidence-backed audit workflow that helps a developer
explain how a coding-agent result was jointly shaped by the task contract,
context, tools, workflow, environment, human intervention, and agent decisions,
then identify the smallest harness change most likely to improve the next run.

The product begins with a human making the causal judgment from a reproducible
single-run evidence packet. Deterministic detectors, structured in-run agent
self-report, automated causal synthesis, additional coding-tool adapters, and
controlled multi-run comparison are later independently verifiable stages.

## Product Thesis

A capable model can underperform because the surrounding harness did not let it
understand, attempt, or verify the right work. A useful diagnostic therefore
cannot start from a model score or a generic event timeline. It must reconstruct
this chain with attributable evidence:

```text
original intent
  -> task contract and acceptance criteria
  -> context and capabilities actually exposed
  -> agent assumptions and execution decisions
  -> tool actions, edits, and feedback
  -> tests, review, and outcome truth
  -> evidence-backed attribution
  -> next-run harness intervention
```

The fundamental unit is one contract-backed run. Cross-run comparison is a
composition of independently auditable single-run reports, not a separate
model leaderboard.

## Background and Confirmed Facts

- The existing `07-16-session-observability-console` task is centered on
  external event ingest, session projection, persistence, and browser replay.
  That surface can show what happened but does not establish why an outcome
  diverged from user intent.
- Coding-agent tools and models are different axes. Claude Code, Codex, Kimi
  Code, ZCode, OpenCode, and Pi are tools/harnesses; MiniMax-M3, GLM, Kimi K3,
  and Claude models are model/provider choices within or behind those tools.
- Most supported tools retain useful local session data under a user-level
  application directory and associate it with a workspace path. A generic
  observer should prefer read-only native adapters over requiring every tool to
  adopt a new push protocol.
- An absent tool call does not prove an absent tool. Tool-gap attribution also
  requires a capability need, an availability manifest, discoverability,
  permission state, attempt evidence, and tool-result evidence.
- Agent self-report can reveal perceived constraints but is a claim, not ground
  truth. It must remain distinguishable from directly observed evidence.
- The first deep audit is intentionally limited to runs with an explicit task
  contract. Free-form coding sessions may later receive a weaker spec-risk
  report, but cannot support the same causal claims.
- The first calibration model is MiniMax-M3 running through Claude Code and the
  CC Switch `MiniMax` provider. Existing project evidence shows provider-level
  cache/token fields may be inflated relative to the native Claude session
  JSONL, so source provenance is mandatory.

## Definitions

- **Coding-agent tool**: The executable product and runtime that supplies the
  conversation, tools, permissions, context assembly, and session store, such
  as Claude Code or Codex.
- **Model/provider**: The model and provider route used inside the tool, such as
  MiniMax-M3 through CC Switch.
- **Harness**: Everything around the model that affects execution: task
  formulation, context injection, project rules, available tools and skills,
  permissions, sandbox/network/runtime environment, checkpoints, verification
  gates, quota, and human intervention.
- **Task contract**: The versioned statement of intent used as outcome truth,
  including original request, PRD, requirements, acceptance criteria, and
  recorded requirement changes.
- **Evidence item**: A fact with source type, source locator, timestamp or
  revision, extraction method, and confidence. Evidence must be traceable back
  to a task artifact, native session record, Git state, command result, browser
  artifact, review finding, or explicit human annotation.
- **Agent claim**: A statement made by the running agent about intent,
  constraints, missing capabilities, decisions, or completion. It is never
  silently promoted to observed fact.
- **Finding**: A human- or machine-authored interpretation linking an observed
  outcome gap to evidence, counter-evidence, unresolved alternatives, and an
  attribution category.
- **Harness intervention**: A concrete, bounded change proposed for the next
  run, with the evidence and hypothesis that justify it.

## Requirements

### R1. Single-run causal audit as the core unit

- A deep audit MUST identify one repository/worktree, one task-contract
  snapshot, one coding-agent session, one base state, and one observed outcome.
- A report MUST remain useful without any comparison to another model or run.
- The system MUST NOT infer model capability from one failed or successful run.

### R2. Complete causal-chain coverage

The audit model MUST be able to represent:

1. original intent and requirement changes;
2. task requirements and acceptance criteria;
3. harness/tool/model/environment configuration;
4. context declared as available and context actually accessed;
5. human messages, interventions, quota stops, and restarts;
6. agent actions, material decisions, and tool results;
7. resulting file changes and completion claims;
8. tests, browser evidence, review findings, and final task state;
9. outcome gaps and the evidence needed to distinguish competing causes.

Missing input MUST remain visibly unknown. It MUST NOT be filled with a
plausible narrative.

### R3. Provenance and evidence authority

- Every normalized evidence item MUST retain its original source and stable
  locator, such as a file plus line/event identity, Git object/revision, command
  record, or native session record identity.
- The report MUST distinguish direct observation, declared configuration,
  agent claim, human judgment, and inference.
- Conflicting sources MUST both remain visible. The implementation MUST define
  source-specific authority rules instead of silently selecting the most
  convenient value.
- Sensitive prompt/session material MUST not be copied into a report by default;
  excerpts require an explicit bounded policy and redaction.

### R4. Contract-to-outcome coverage

- The audit MUST map each stable requirement or acceptance criterion to the
  context exposure, implementation evidence, validation evidence, completion
  claim, and unresolved gap available for that item.
- A checked task box, a generated evidence filename, or an agent completion
  statement MUST NOT by itself count as outcome proof.
- Contract changes during a run MUST be time-ordered and distinguished from the
  contract the agent originally received.

### R5. Tool and capability diagnosis

For each suspected tool gap, the audit MUST distinguish at least:

1. required capability truly unavailable;
2. capability available but not exposed or not discoverable;
3. tool exposed but blocked by permission, sandbox, network, installation, or
   environment state;
4. tool invoked but insufficient or poorly integrated for the required action;
5. tool available but the workflow did not require it at the correct checkpoint;
6. tool available, discoverable, and usable but skipped or misused by the agent;
7. insufficient evidence to decide.

The absence of a call MUST NOT be used as proof of category 1.

### R6. Attribution taxonomy

Findings MUST support multiple contributing categories without forcing a single
winner:

- requirement/input;
- task-contract/acceptance quality;
- context availability or provenance;
- tool discovery, availability, permission, fitness, or integration;
- workflow and feedback-loop design;
- environment, provider, quota, or interruption;
- human intervention;
- agent planning, reasoning, execution, or verification decision;
- unresolved/model-capability possibility after alternatives remain unproven.

Numerical scores are optional only if their meaning and evidence are explicit.
The product MUST NOT begin with an unexplained harness or model score.

### R7. Human judgment before automated judgment

- The first product stage MUST generate a reproducible evidence packet and a
  structured human attribution worksheet.
- It MUST NOT emit an automatic causal verdict.
- A later automated judge MUST be evaluated against human gold reports and MUST
  cite evidence, counter-evidence, confidence, and unresolved alternatives.

### R8. Agent self-report as a later evidence source

- A later stage MAY ask an agent at bounded checkpoints what information or
  capability it believes is missing, what exact action it would take if the
  gap were removed, what evidence indicates a block, and what fallback it tried.
- These responses MUST be labeled as agent claims and checked against observed
  availability, attempts, permissions, and results.
- Probes MUST not continuously interrupt the run or teach the agent the answer
  to the benchmark task.

### R9. Local-first and private operation

- Essential collection, normalization, review, and report generation MUST run
  locally without SmallKhoj backend services, PostgreSQL, Redis, Docker, a
  telemetry SaaS, or an external LLM API.
- Native tool stores MUST be opened read-only.
- Reports MUST exclude credentials, auth tokens, provider keys, environment
  secrets, and unbounded raw prompts/tool output.
- The user MUST control where a durable audit packet is written and be able to
  use an isolated temporary output directory.

### R10. Adapter-based multi-tool evolution

- Tool-specific storage semantics MUST be isolated behind adapters.
- The canonical audit model MUST not encode Claude-specific `parentUuid`, Kimi
  `stepUuid`, ZCode table names, or another tool's internal event vocabulary as
  universal domain concepts.
- Original tool-native identifiers and source locators MUST still be retained
  for verification.
- A push/HTTP integration MAY be added for a tool with no useful native store,
  but MUST remain a fallback rather than the initial universal requirement.

### R11. Actionable next-run output

- Every recommended intervention MUST name the harness layer to change, the
  evidence supporting it, the expected observable effect, and the smallest next
  experiment that could validate or falsify it.
- Reports MUST prefer one to three bounded interventions over a generic list of
  best practices.
- A report MAY conclude that current evidence is insufficient and recommend a
  missing observation instead of a speculative fix.

### R12. Controlled comparison only after single-run validity

- Future comparison MUST compose complete single-run audits.
- A comparison manifest MUST record at least tool/version, provider/model/mode,
  base commit, task-contract hash, available tools/skills, permissions/sandbox,
  network/browser state, quota/context resets, human interventions, and outcome
  evidence identity.
- Uncontrolled comparisons MUST be labeled illustrative and MUST NOT be used to
  rank model capability.

## Long-Term Task Map

| Stage | Deliverable | Trellis task state |
| --- | --- | --- |
| 1 | Human-guided, single-run MiniMax audit packet and local CLI | Child `07-17-human-guided-harness-audit-mvp` created; planning |
| 2 | Bounded in-run agent self-report probes through Trellis channel | Create only after Stage 1 demonstrates useful questions |
| 3 | Deterministic high-confidence harness detectors | Create from false positives/negatives observed in Stage 1 |
| 4 | Evidence-cited automated causal synthesis evaluated against human gold reports | Create after a gold-report corpus exists |
| 5 | Additional native adapters for Codex, Kimi Code, ZCode, OpenCode, and Pi | Create adapters independently after the canonical model stabilizes |
| 6 | Controlled multi-run comparison and harness experiment reports | Create only after at least three tool adapters pass single-run validation |

The parent owns the task map and cross-child invariants. It is not the default
implementation target; each independently verifiable stage uses a child task,
branch, worktree, review, and acceptance gate.

## Cross-Child Acceptance Criteria

- [ ] AC-P1 — A user can inspect one contract-backed run and trace every report
  fact or finding to a stable local source without reading an unbounded raw log.
- [ ] AC-P2 — The system distinguishes coding-agent tool, provider, model, and
  harness configuration throughout its canonical model and reports.
- [ ] AC-P3 — Requirement, context, tool, workflow, environment/human, and agent
  execution contributions can all be represented without collapsing unknowns
  into a model-quality judgment.
- [ ] AC-P4 — A suspected missing tool can be classified across availability,
  discoverability, permission, fitness, workflow, usage decision, or unknown,
  with supporting and contradicting evidence.
- [ ] AC-P5 — At least one report produces a concrete next-run harness change
  that is subsequently tested in another controlled run.
- [ ] AC-P6 — Agent self-report, when added, remains visibly separate from
  observed evidence and contradictions are surfaced.
- [ ] AC-P7 — Automated causal synthesis, when added, is compared against human
  gold reports and does not invent evidence or hide alternatives.
- [ ] AC-P8 — At least three different coding-agent tools can eventually produce
  the same canonical single-run report while retaining native provenance.
- [ ] AC-P9 — Local source reads are read-only, secrets are excluded, report
  excerpts are bounded/redacted, and no essential path requires cloud upload.
- [ ] AC-P10 — Controlled comparisons record all required harness variables and
  clearly label uncontrolled variables instead of ranking models directly.

## Constraints

- Preserve the independence of the existing Kimi and GLM
  `session-observability-console` benchmark unless the user explicitly chooses
  to reuse one run as audit input. Do not expose one implementation to another
  benchmark agent.
- Do not silently retarget the existing session observer; this is a separate
  parent task and product direction.
- Do not require raw chain-of-thought. Use observable messages, tool actions,
  artifacts, decisions stated by the agent, and outcome evidence.
- Do not treat provider-reported MiniMax cache/token values as authoritative
  when the native session record disagrees.
- Do not write into user-level coding-tool stores.
- Do not push, merge, rewrite history, or clean unrelated root-worktree files as
  part of planning or implementation.
- Implementation work uses a sibling worktree and feature branch after `main`
  has a safe, agreed base; the current unpushed/dirty root state is not to be
  normalized implicitly.

## Termination Conditions

The parent initiative is complete only when:

1. every created child task is completed and independently reviewed;
2. all cross-child acceptance criteria are backed by reproducible local
   evidence;
3. human audit, deterministic facts, agent claims, and automated inference
   remain distinguishable in persisted reports;
4. at least one harness intervention has been validated by a subsequent run;
5. three or more coding-agent tools have passed single-run adapter validation;
6. automated diagnosis, if shipped, is evaluated against a human gold corpus
   and reports uncertainty rather than manufacturing causes;
7. privacy/redaction tests prove credentials and unbounded sensitive payloads
   are not included by default;
8. documentation explains known limits, unsupported sources, source authority,
   and how to reproduce a report from an isolated local environment.

Until these conditions hold, the parent remains a planning/in-progress roadmap
and no partial child should be presented as the complete harness-diagnostics
product.

## Out of Scope

- A model leaderboard or universal intelligence score.
- Low-level provider debugging as the primary product: slow turns, retries,
  tool transport errors, cancellation, and context-window errors matter only
  when they contribute evidence to an outcome diagnosis.
- Cloud telemetry, centralized employee surveillance, multi-user RBAC, billing,
  or cross-machine synchronization.
- Reconstructing hidden chain-of-thought.
- Automatically modifying the harness, task, repository, or agent permissions
  based on a diagnosis without explicit human approval.
- Replacing native coding-agent session stores, Trellis task artifacts, Git,
  test output, browser evidence, or code review as their respective truth
  sources.

