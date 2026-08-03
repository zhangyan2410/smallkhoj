# Human-Guided Single-Run Harness Audit MVP

## Goal

Deliver a local, read-only command-line tool that converts one explicit
task contract, one Claude Code session, one harness manifest, and one Git
outcome into a reproducible evidence packet a human can use to decide why the
result diverged and what harness element to change next.

The first subject model is MiniMax-M3 through the CC Switch `MiniMax` provider
inside Claude Code. The MVP organizes evidence and provides a structured human
attribution worksheet; it does not issue an automatic causal verdict or model
score.

## User Value

Today, deciding whether a run failed because of an unclear requirement, missing
context, an unavailable/undiscoverable tool, permissions, a weak feedback gate,
human/quota interruption, or an agent execution decision requires manually
cross-reading task files, session JSONL, Git changes, tests, screenshots, and
review notes. The MVP makes those sources jointly inspectable while preserving
their provenance and uncertainty.

The user should finish a review with one of two honest outcomes:

1. one to three evidence-backed harness changes to test in the next run; or
2. a precise statement of which observation is missing before attribution is
   possible.

## Fixed MVP Boundary

### Subject runtime

- Coding-agent tool: Claude Code.
- Provider route: CC Switch provider named `MiniMax`.
- Model: MiniMax-M3.
- Deep-audit task type: explicit Trellis/task contract with requirements or
  acceptance criteria.
- Historical calibration: existing MiniMax-M3 Claude Code runs and the archived
  provider-token misattribution correction.
- Fresh validation: one new, contract-backed MiniMax-M3 run selected before the
  live-validation phase and kept independent from the audit implementation.
- CodeGraph MUST NOT be an implementation dependency. The fresh-run harness
  manifest MUST record whether CodeGraph was available, discoverable, used, or
  intentionally disabled. The planned default after the separate project-policy
  change is disabled.

### Executable shape

```text
agent-audit                         repository-root wrapper
tools/agent-audit/                 Node 22 standard-library implementation
```

Primary command contract:

```text
./agent-audit collect \
  --repo <repository-or-worktree> \
  --task <task-directory> \
  --session <claude-session-id-or-jsonl-path> \
  --harness <harness-manifest.json> \
  --base <git-revision> \
  --head <git-revision-or-worktree> \
  --out <new-output-directory>

./agent-audit validate <audit-directory>
```

The exact flag spelling may change only through an update to this PRD and
design before implementation is activated.

## Requirements

### R1. Standalone local operation

- The CLI MUST run locally without the SmallKhoj backend, frontend, daemon,
  PostgreSQL, Redis, Docker, a browser, telemetry SaaS, or an external LLM API.
- Product code SHOULD use the Node 22 standard library and MUST NOT rely on an
  undeclared global package beyond documented project tools.
- `--help` MUST document all inputs, authority limits, privacy behavior, and
  generated files.
- Test runs MUST support isolated temporary repositories, source fixtures, home
  directories, and output directories.

### R2. Explicit audit identity

Every audit MUST record:

- schema and generator version;
- audit ID and generation timestamp;
- repository/worktree path identity;
- base revision;
- outcome revision or dirty-worktree snapshot identity;
- task directory and content hashes;
- Claude Code session identity and source-file identity;
- coding-agent tool/version when known;
- provider, model, and mode when known;
- harness-manifest identity;
- warnings, unsupported fields, and redaction counts.

Unknown identity fields MUST remain unknown and MUST NOT be inferred from a
filename or user label without evidence.

### R3. Contract-backed deep audit

- `--task` MUST identify a readable task directory with a `prd.md` or an
  explicitly documented equivalent contract artifact.
- The collector MUST snapshot and hash the contract sources used for the audit.
- It MUST extract stable acceptance-criteria labels when present and assign
  deterministic local IDs to other requirement bullets without pretending to
  understand their semantics.
- It MUST record task-contract changes visible in the audited session or Git
  range when deterministically observable.
- The report MUST state that it cannot automatically decide whether a
  natural-language requirement is satisfied.

### R4. Required harness manifest

The MVP MUST define and validate a versioned JSON harness manifest containing at
least:

- coding-agent tool, version, provider, model, and mode;
- workspace/repository and intended base revision;
- instructions and context sources declared available to the agent;
- tools and skills declared available, including how each is exposed;
- permission, sandbox, network, browser, and runtime constraints;
- quota/context-reset information known before or during the run;
- human interventions or known external interruptions;
- optional evidence-command/artifact references.

Each declared tool SHOULD describe capability, discoverability source, and
permission mode. The CLI MUST distinguish a missing manifest field from a
declared absence. It MUST NOT reconstruct the full available tool set merely
from calls that happened to appear in the session.

### R5. Claude Code native adapter

- The adapter MUST accept an explicit JSONL file path for deterministic tests
  and an exact session ID for local discovery.
- Session discovery MUST scope candidates to the requested repository/worktree
  and fail on ambiguity rather than selecting the newest plausible file.
- It MUST parse incrementally or line-by-line so one malformed/truncated record
  does not require loading an unbounded file into memory.
- It MUST preserve source line/record locators, native IDs when present, event
  timestamps, record types, model identity observations, tool calls/results,
  user/human messages, assistant completion claims, and directly observable
  context-access actions.
- Claude-specific fields MUST remain adapter extensions rather than generic
  audit concepts.
- Unsupported/unknown record shapes MUST be counted and surfaced without
  crashing or silently disappearing.

### R6. Context-access evidence

- The report MUST distinguish context declared available in the harness
  manifest from context directly observed as read/accessed during the session.
- A file path mentioned in prose MUST NOT be treated as successfully read.
- Tool-call evidence such as Read, Grep, Glob, or a deterministically recognized
  command MAY establish access, but the report MUST retain the exact basis and
  uncertainty.
- The MVP MUST NOT claim that unobserved context was unavailable; it may only
  report that access was not observed.
- Access occurring after a material edit or completion claim MUST retain timing
  order so a human can judge whether feedback arrived too late.

### R7. Tool-use and tool-gap evidence

- The report MUST join declared tool availability with observed discovery,
  calls, permission/approval outcomes when present, results, and failures.
- It MUST provide a human worksheet for the parent taxonomy: unavailable,
  undiscoverable/unexposed, permission/environment blocked, inadequate tool,
  missing workflow gate, available-but-skipped/misused, or unknown.
- An absent call MUST NOT be rendered as "tool missing."
- A successful call MUST be usable as counter-evidence to an agent claim that
  the tool was unavailable.
- Low-level retries and latency MAY appear as supporting evidence but are not
  primary diagnosis outputs.

### R8. Git and outcome snapshot

- The collector MUST verify that `--repo` is a Git worktree and resolve the
  requested base revision without changing repository state.
- For a revision head, it MUST record commit identity and a deterministic
  changed-file/patch identity.
- For `--head worktree`, it MUST include tracked modifications and untracked
  outcome files in a deterministic snapshot manifest while excluding the output
  directory itself.
- It MUST NOT stage, commit, checkout, reset, clean, or otherwise mutate the
  repository.
- The report MUST distinguish code/artifact existence from validation evidence.

### R9. External outcome evidence

- The collector MUST support bounded references to test output, browser
  evidence, review notes, and task evidence supplied through the harness
  manifest or task directory.
- It MUST record artifact identity, source path, hash, timestamp when available,
  and declared purpose.
- It MUST NOT mark an acceptance criterion passed merely because an evidence
  file exists.
- Missing, unreadable, stale, or revision-mismatched evidence MUST be reported
  as such.

### R10. Versioned output bundle

The output directory MUST contain:

```text
manifest.json       input identities, hashes, warnings, redaction statistics
audit.json          versioned canonical facts and source locators
report.md           deterministic, human-readable evidence report
human-review.md     editable attribution and next-intervention worksheet
```

- The final output directory MUST be new by default. Existing output MUST not
  be overwritten without an explicit safe option.
- A failed collection MUST not leave a valid-looking partial final bundle.
- `validate` MUST check file presence, JSON/schema consistency, hash/link
  integrity available within the bundle, source-locator format, and report
  generation compatibility.
- Re-running with the same normalized inputs MUST produce semantically stable
  evidence/report content; volatile audit ID/time fields are excluded from the
  deterministic comparison.

### R11. Deterministic report sections

`report.md` MUST include:

1. audit subject and source authority summary;
2. task-contract snapshot and requirement/AC index;
3. harness/tool/context manifest, including unknown fields;
4. chronological high-signal run outline;
5. declared-versus-observed context access;
6. declared-versus-observed tool usage and permission/results;
7. Git/outcome summary;
8. validation, browser, review, and task-state evidence inventory;
9. completion claims versus available evidence;
10. conflicts, unsupported source records, redactions, and known limits;
11. links/locators needed by the human worksheet.

The report MUST avoid replaying every low-value event and MUST bound all
excerpts/payload summaries.

### R12. Human attribution worksheet

`human-review.md` MUST provide one structured finding block per observed gap the
reviewer chooses to record. Each block MUST support:

- affected requirement/AC;
- outcome gap;
- one or more attribution categories;
- supporting evidence locators;
- counter-evidence/alternative explanations;
- confidence or `unknown`;
- missing observation that would distinguish alternatives;
- proposed harness change;
- expected signal and smallest next experiment.

The generated worksheet MUST contain instructions and empty templates, not a
pre-filled automatic causal verdict.

### R13. Privacy, redaction, and bounded output

- The CLI MUST open the Claude source read-only and MUST NOT write anywhere
  under the native tool store.
- Credentials, authorization headers, provider keys, token-file contents,
  secret-looking environment values, and configured secret paths MUST be
  redacted.
- Raw prompts, assistant prose, source code bodies, stdout/stderr, and tool
  results MUST be omitted by default or represented by bounded, redacted
  summaries and hashes.
- Limits for record size, excerpt size, total excerpt budget, and output file
  size MUST be documented and tested.
- Committed fixtures MUST be synthetic or irreversibly sanitized and MUST not
  contain a developer's real home path, credential, private prompt, or project
  source content.

### R14. MiniMax calibration and live validation

- A regression fixture MUST model conflicting provider-level and native-session
  MiniMax usage fields and prove the report preserves both sources while
  selecting native session data for the session-token fact.
- Historical local validation SHOULD use the archived MiniMax-M3 productivity
  run when its source session can be identified without committing private
  content.
- Final acceptance MUST include one fresh contract-backed MiniMax-M3 run through
  Claude Code/CC Switch in an isolated subject worktree.
- The subject task MUST not be implementation of `agent-audit` itself and MUST
  not receive the audit report, another agent's implementation, or findings
  before it finishes.
- The final human review MUST state whether an alleged tool/context gap is
  supported, contradicted, or unknown and identify at least one next-run
  intervention or missing observation.

### R15. Documentation and tests

- Documentation MUST cover installation/runtime requirements, commands,
  harness-manifest schema and example, source authority, output files,
  redaction, known limits, MiniMax caveats, and safe cleanup.
- Unit tests MUST cover task parsing, manifest validation, Claude record
  variants, malformed/truncated JSONL, source locators, redaction, deterministic
  output, atomic publication, Git revision/worktree snapshots, and bundle
  validation.
- Integration tests MUST use synthetic temporary repositories and home/session
  stores; they MUST prove the CLI does not mutate either source.
- Real validation commands and resulting audit identity MUST be recorded under
  this task without committing raw private session content.

## Acceptance Criteria

- [ ] AC1 — `./agent-audit --help`, `collect`, and `validate` run using only the
  documented local Node runtime and without SmallKhoj services or network.
- [ ] AC2 — A valid explicit task, harness manifest, synthetic Claude JSONL,
  base/head Git state, and output directory generate all four required bundle
  files.
- [ ] AC3 — Invalid/ambiguous task, session, Git, manifest, or existing output
  inputs fail clearly without mutating sources or publishing a valid-looking
  partial bundle.
- [ ] AC4 — The report presents stable requirement/AC identities, contract
  hashes, and declared-versus-observed context evidence without declaring
  natural-language requirements satisfied.
- [ ] AC5 — The report joins declared tool availability with observed calls,
  permissions/results, and agent claims, and never converts an absent call into
  a missing-tool fact.
- [ ] AC6 — Git revision and dirty-worktree fixtures produce deterministic file
  and patch/snapshot identities, including untracked outcome files and excluding
  the audit output directory.
- [ ] AC7 — Test/browser/review/task artifacts are inventoried with identity and
  freshness warnings; file existence alone does not mark an AC passed.
- [ ] AC8 — `audit.json`, `manifest.json`, and source locators validate; rerendered
  `report.md` is semantically deterministic for the same normalized input.
- [ ] AC9 — `human-review.md` contains the required attribution, alternatives,
  uncertainty, and intervention fields and contains no automatic causal verdict.
- [ ] AC10 — Synthetic secret/prompt/code/tool-output fixtures prove bounded
  redaction; no real home path, credential, prompt, or source body appears in
  committed fixtures or generated test snapshots.
- [ ] AC11 — Malformed, truncated, oversized, and unknown Claude JSONL records
  are surfaced as bounded warnings while supported records remain auditable.
- [ ] AC12 — MiniMax conflicting-usage regression proves native Claude session
  data and provider aggregate data remain separately attributed and prevents the
  previously disproven context-size conclusion.
- [ ] AC13 — Focused unit and integration suites pass from documented commands
  and verify native session/Git source state is unchanged before and after.
- [ ] AC14 — One historical MiniMax-M3 run generates a local report without
  committing private session contents; reviewer notes record useful and missing
  evidence.
- [ ] AC15 — One fresh isolated MiniMax-M3 subject run generates a complete
  packet and a human finding that ends in a bounded intervention or an explicit
  missing-observation decision.
- [ ] AC16 — A reviewer can reproduce the final packet from documented source
  identities and commands, and confirms it is more useful for harness diagnosis
  than a raw chronological session replay alone.

## Constraints

- Do not modify or finish the existing `session-observability-console` task as
  part of this child.
- Do not implement a UI, daemon, database, HTTP ingest service, or automated
  judge in this child.
- Do not execute arbitrary commands found inside a session transcript or
  harness manifest.
- Do not require hidden chain-of-thought or claim access to reasoning that the
  native source does not expose.
- Do not identify an agent's coding tool solely from its model label.
- Do not identify model capability as the root cause from this single run.
- Do not expose Kimi/GLM benchmark implementation details to the fresh MiniMax
  subject.
- Do not treat CodeGraph as required audit infrastructure. Until the current
  `AGENTS.md` CodeGraph-first rule is changed in a separately approved action,
  implementation agents must still obey the active project instruction and
  record that constraint in the harness manifest.
- Do not write implementation code in the dirty root worktree; use the planned
  sibling worktree after a safe base is agreed.
- Preserve unrelated commit `47848e8`, `MEMORY.md`, current task directories,
  `session-observer/`, and other root-worktree changes.

## Termination Conditions

This child is complete only when:

1. AC1–AC16 are checked and mapped to exact commands, fixtures, bundle IDs,
   source identities, and reviewer observations;
2. all supported collection is read-only and privacy/redaction tests pass;
3. historical and fresh MiniMax-M3 packets are produced without committing raw
   private session content;
4. the fresh subject was not contaminated by prior implementations/findings;
5. a human completes at least one finding with evidence, counter-evidence,
   uncertainty, and a next experiment;
6. the user confirms the packet changes or sharpens a real harness decision;
7. the implementation passes Trellis quality review and leaves a reviewable,
   task-scoped diff in its feature worktree;
8. documentation can reproduce collection from an isolated fixture and explain
   why unknowns are not automatic diagnoses.

If the tool only generates a transcript/timeline, infers unavailable tools from
missing calls, leaks sensitive payloads, or emits an unsupported causal verdict,
the correct status is **not complete**.

## Out of Scope

- Live/in-run Trellis-channel probes; they are the next parent stage.
- Automatic deterministic harness detectors beyond data-integrity/authority
  rules required to assemble the packet.
- LLM-generated causal explanations or rankings.
- Codex, Kimi Code, ZCode, OpenCode, and Pi adapters.
- Multi-run comparison UI or reports.
- A free-form-session deep diagnosis without a task contract.
- Capturing or storing full raw chain-of-thought.

## Fresh Validation Subject Decision

The fresh MiniMax-M3 subject will be a new, bounded, non-trivial project task
created after the CLI passes its synthetic and historical MiniMax gates. Its
contract must have explicit requirements and outcome evidence, and the subject
agent must not receive the audit implementation or prior findings before its
run ends.

The existing `session-observability-console` PRD is intentionally excluded from
fresh validation: Kimi/GLM implementations and reviews already create
contamination risk, while its original CodeGraph-first harness constraint no
longer matches the intended default. This MVP therefore prioritizes a clean
single-run causal sample over same-task comparison.
