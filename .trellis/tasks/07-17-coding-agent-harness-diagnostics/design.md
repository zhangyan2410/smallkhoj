# Coding Agent Harness Diagnostics — Long-Term Design

## 1. Design Intent

The architecture separates evidence collection from causal judgment. The first
deliverable makes a human faster and more consistent at diagnosing one run.
Later automation consumes the same evidence contract and must not gain authority
merely because a model generated the explanation.

```text
native local stores + task/Git/test/review artifacts + harness manifest
                              |
                              v
                    read-only source adapters
                              |
                              v
                    canonical evidence bundle
                              |
               +--------------+---------------+
               |                              |
               v                              v
      deterministic report             later fact detectors
               |                              |
               v                              v
       human attribution  <----- compare ---- automated synthesis
               |
               v
      next-run harness experiment
```

No dashboard or database is required to validate this model. A durable directory
containing machine-readable evidence, a human-readable report, and a human
review worksheet is the initial product boundary.

## 2. Architectural Boundaries

### 2.1 Source adapters

Each adapter reads one native source without mutating it and emits canonical
evidence items. Adapters own tool-specific record semantics, workspace/session
discovery, event identity, and source locators.

Planned adapters:

| Tool | Native source | Initial role |
| --- | --- | --- |
| Claude Code | workspace-mapped JSONL under `~/.claude/projects` | Stage 1 adapter; carries MiniMax-M3 run |
| Codex | rollout JSONL under `~/.codex/sessions` | Later independent adapter |
| Pi | JSONL under `~/.pi/agent/sessions` | Later; requires a real local sample |
| Kimi Code | session index plus per-agent `wire.jsonl` under `~/.kimi-code` | Later independent adapter |
| ZCode | local SQLite plus rollout logs under `~/.zcode` | Later independent adapter |
| OpenCode | local SQLite under `~/.local/share/opencode` | Later independent adapter |

`trellis mem` may assist session discovery and cleaned-dialogue recall, but the
audit contract cannot depend on it for tool/action evidence that its cleaned
dialogue projection does not retain.

### 2.2 Canonical evidence bundle

The bundle is an immutable snapshot for one audit invocation. It is not a
general event database. It contains normalized records plus hashes/locators for
the source state used to generate them.

Conceptual structure:

```text
AuditBundle
  identity
    auditId, generatedAt, schemaVersion
    repository, worktree, baseRevision, outcomeRevision
    taskContractHash, sessionIdentity
  subject
    codingTool, toolVersion
    provider, model, mode
  taskContract
    source artifacts, requirements, acceptance criteria, changes
  harness
    instructions, context declarations, tools, skills, permissions
    sandbox, network, browser, runtime, quota/interruption annotations
  evidence[]
    kind, authority, source, locator, observedAt, payloadSummary, hash
  requirementCoverage[]
    requirementId, contextEvidence[], actionEvidence[], outcomeEvidence[]
  claims[]
    actor, claimKind, statement/excerpt, sourceLocator
  humanFindings[]
    gap, categories[], evidence[], counterEvidence[], confidence, unknowns
  interventions[]
    layer, change, hypothesis, expectedSignal, nextExperiment
```

Tool-native records remain addressable through `source` and `locator`. The
canonical model describes observable audit meaning, not every native field.

### 2.3 Report renderer

The deterministic renderer consumes only the bundle and task artifacts. It may
organize and summarize structured facts but does not infer causes. Its outputs
are:

- `audit.json`: versioned canonical evidence bundle;
- `report.md`: deterministic facts and coverage views;
- `human-review.md`: editable attribution worksheet;
- `manifest.json`: input identities, hashes, generator version, warnings, and
  redaction counters.

A static HTML rendering can be added later from the same bundle. It is not a
Stage 1 requirement because it would add UI work before diagnostic utility is
validated.

### 2.4 Detectors and automated synthesis

Later deterministic detectors emit evidence-backed candidate facts such as
"required project guide was first read after editing" or "completion was
claimed while the declared gate failed." They do not emit broad causal labels.

An automated judge may later transform facts and human-gold examples into a
causal explanation, but its output remains an inference layer with citations,
counter-evidence, confidence, and alternatives.

## 3. Evidence Authority

Authority is contextual; no global source is always correct. The bundle records
one of these evidence modes:

| Mode | Meaning | Examples |
| --- | --- | --- |
| `observed` | Directly recorded behavior or artifact | native tool call/result, Git diff, command result, screenshot dimensions |
| `declared` | Harness/task configuration intended to be true | PRD, tool manifest, permission config, system instruction |
| `claimed` | Actor assertion not independently proven | agent says a tool is missing or work is complete |
| `reviewed` | Human/reviewer judgment tied to evidence | semantic screenshot review, requirement coverage judgment |
| `inferred` | Derived explanation requiring uncertainty | likely workflow gap, possible model limitation |

Examples of source-specific precedence:

- File outcome: Git object/worktree state outranks an agent statement.
- Test outcome: a captured command result for the audited revision outranks a
  checked PRD box.
- Available tools: a versioned harness manifest is authoritative for declared
  availability; a successful tool call proves actual availability at that
  moment; absence of a call proves neither availability nor absence.
- MiniMax usage: native Claude Code session usage is preferred for actual
  session tokens when CC Switch/provider aggregate fields conflict. The
  conflict itself remains evidence.
- Product intent: the versioned task contract and recorded user changes outrank
  an agent's retrospective restatement.

## 4. Requirement and Outcome Truth

Deep mode requires an explicit task contract. Stage 1 recognizes stable IDs in
acceptance-criteria checkboxes when present and assigns deterministic generated
IDs to other requirement bullets. The original text and artifact hash remain
the authority; generated IDs are locators, not semantic interpretation.

Outcome truth is assembled from:

1. base and outcome Git state;
2. changed-file and patch identities;
3. captured validation command results tied to the outcome revision/worktree;
4. browser/evidence artifacts and their metadata when required;
5. review findings;
6. final Trellis/task state;
7. agent completion claims, kept as claims.

The first renderer never marks a natural-language requirement satisfied on its
own. It shows linked evidence and leaves the human verdict open.

## 5. Tool-Gap Decision Model

For a suspected outcome gap, the report leads the reviewer through:

```text
What concrete action was required by the contract?
  -> What capability is needed for that action?
  -> Was the capability declared available?
     -> Was it discoverable in the agent's provided context?
        -> Was it attempted?
           -> Was invocation allowed?
              -> Did the tool produce adequate feedback?
                 -> Did the workflow require acting on that feedback?
```

This yields the categories required by parent R5. The decision tree intentionally
allows `unknown`; a missing harness manifest cannot be repaired by guessing from
the transcript.

## 6. Human Review Contract

Each human finding records:

- observed outcome gap;
- affected requirement IDs;
- one or more attribution categories;
- supporting evidence locators;
- counter-evidence and alternative hypotheses;
- confidence (`high`, `medium`, `low`, or `unknown`);
- missing observation that would distinguish alternatives;
- recommended harness intervention;
- expected observable signal in the next run.

The worksheet should be completable without reading an entire JSONL stream. It
must still link to bounded source excerpts or identities for auditability.

## 7. Agent Self-Report Contract (Future Stage)

Self-report probes are intentionally outside the first child. A later child may
capture three bounded checkpoints:

1. early capability inventory;
2. first material block;
3. pre-completion evidence gap review.

Each probe asks for the exact blocked action, perceived missing capability,
supporting observation, fallback attempted, and requested change. The adapter
stores the response as `claimed` evidence and checks contradictions such as a
tool claimed missing after a successful call.

## 8. Multi-Tool Compatibility

The normalized hierarchy is deliberately small:

```text
Workspace -> ToolSession -> Turn/Step -> ModelSpan | ToolSpan | Annotation
```

Adapters may omit a level when their native store does not support it. Missing
semantics are represented as unavailable, not synthesized. Tool-specific raw
metadata can be stored under a namespaced extension while generic reports use
only canonical fields.

Cross-run comparison is keyed by a `HarnessManifest` rather than by model name.
Two MiniMax-M3 runs in different tools, permissions, prompts, or base revisions
are not controlled merely because the model label matches.

## 9. Privacy and Redaction

- Native stores are opened read-only and never migrated.
- Default reports include bounded summaries, hashes, paths relative to the
  audited repository when possible, tool names/status, and source locators.
- Credential-like keys, authorization headers, token files, environment
  secrets, and known home-directory credential paths are redacted.
- Full prompts, code bodies, stdout/stderr, and tool-result payloads are omitted
  by default. Explicit excerpt inclusion has size limits and redaction.
- Fixtures are synthetic or irreversibly sanitized; a developer's home session
  file must never become a committed test fixture.
- Output directories are explicit. Test runs use temporary directories.

## 10. Stage and Child Boundaries

### Stage 1 — Human-guided single-run MVP

Owns the first Claude Code adapter, task/Git/harness inputs, deterministic
bundle/report, human worksheet, privacy controls, historical MiniMax calibration
case, and one reproducible MiniMax-M3 validation run.

### Stage 2 — In-run claims

Owns Trellis-channel probes and claim/observation contradiction handling. It is
not allowed to change Stage 1 evidence authority.

### Stage 3 — Deterministic detectors

Owns only rules whose truth can be proven from canonical evidence. Candidate
detectors are selected from repeated human findings, not invented in advance.

### Stage 4 — Automated synthesis

Owns judge prompts/contracts, gold-report evaluation, citation validation,
uncertainty behavior, and regression tests.

### Stage 5 — Additional adapters

Each adapter can be a separate child. Adapter acceptance requires a real local
sample, synthetic/sanitized fixtures, source-locator stability, and explicit
unsupported-field behavior.

### Stage 6 — Controlled comparison

Owns manifest matching, confound reporting, paired intervention experiments,
and comparison presentation. It never replaces single-run findings.

## 11. Implementation Placement

The first executable should live outside managed `.trellis/scripts` so a Trellis
refresh cannot overwrite it:

```text
agent-audit                         repository-root wrapper
tools/agent-audit/
  cli.mjs
  lib/
  test/
  fixtures/
```

Node 22 standard-library code and `node:test` match existing standalone project
tool patterns such as `smallkhoj-trace` and avoid adding a backend/database
dependency. The Stage 1 child owns the exact module breakdown and TDD sequence.

## 12. Rollout and Rollback

- Every stage is opt-in and read-only with respect to native stores.
- Schema versions are explicit in bundle and manifest files.
- New fields are additive until a dedicated migration decision is recorded.
- A failed audit must leave no partial final bundle; generation writes to a
  temporary location and publishes atomically when practical.
- Removing the CLI and generated audit directory fully rolls back Stage 1;
  there are no database migrations or daemon state changes.
- Later probes and judges remain separately enabled so the evidence collector
  can continue to operate if automation is disabled.

## 13. Design Risks

1. **Transcript-as-truth**: inferring availability or intent solely from what
   appeared in conversation.
2. **Data exhaust product**: generating a large replay instead of a decision
   aid.
3. **Retrospective storytelling**: an automated judge explains a result with no
   falsifiable evidence.
4. **Model/tool conflation**: attributing Claude Code or CC Switch behavior to
   MiniMax-M3, or vice versa.
5. **Evidence existence fallacy**: treating a screenshot/test filename as proof
   without checking what it demonstrates.
6. **Privacy leakage**: copying raw prompts, code, credentials, or home paths
   into committed artifacts.
7. **Schema overfitting**: using Claude-specific turn semantics as the generic
   model.
8. **Benchmark contamination**: showing one agent another agent's implementation
   or retrospective findings.
9. **Unknown erasure**: filling missing harness configuration with assumptions.
10. **Dashboard-first drift**: building UI/persistence before proving that the
    human review questions change a next-run decision.

