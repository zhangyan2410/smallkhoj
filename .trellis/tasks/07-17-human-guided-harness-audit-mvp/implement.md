# Human-Guided Single-Run Harness Audit MVP — Implementation Plan

## 0. Pre-Start Gates

- [x] User reviewed this PRD/design/plan and approved implementation on
  2026-07-17.
- [x] Fresh-subject strategy resolved: create a new bounded MiniMax-M3 task
  after synthetic and historical gates; freeze its exact contract before the
  live-validation phase.
- [ ] Resolve the safe branch base without pushing commit `47848e8` or mixing
  unrelated root-worktree changes.
- [ ] Record the effective CodeGraph policy at branch start. The CLI itself must
  not depend on CodeGraph; if the project-level mandate has not yet been
  soft-disabled, comply with it only as an explicit harness constraint.
- [ ] Create sibling worktree
  `../smallkhoj-human-guided-harness-audit-mvp` on
  `feat/human-guided-harness-audit-mvp`.
- [ ] Record base revision, branch, worktree path, and task scope.
- [ ] Run a minimal baseline relevant to root Node tooling and record unrelated
  pre-existing failures.
- [ ] Load `trellis-before-dev` and the relevant implementation specs in the
  feature worktree before writing code.

Do not run `task.py start` or write implementation code until these gates and
the Trellis planning review are complete.

## 1. TDD Slice — CLI Skeleton and Safe Output

### Red

- [ ] Add tests for `--help`, unknown command/flag, missing required inputs,
  existing non-empty output, and exit-code categories.
- [ ] Add an integration test proving a collection failure leaves no final
  valid-looking bundle.
- [ ] Add a root-wrapper resolution test from a non-root working directory.

### Green

- [ ] Add zero-dependency `tools/agent-audit/package.json` and CLI entry.
- [ ] Add root `agent-audit` wrapper.
- [ ] Implement strict argument parsing and usage text.
- [ ] Implement temporary-output construction and atomic final publication.

### Refactor/checkpoint

- [ ] Keep path resolution and output publication isolated from source parsing.
- [ ] Run focused CLI/output tests.

## 2. TDD Slice — Hashing, Redaction, and Evidence Primitives

### Red

- [ ] Add deterministic hashing/ID fixtures with reordered input fields.
- [ ] Add structured/unstructured secret, auth header, token path, home path,
  HTML/script, oversized string, and excerpt-budget fixtures.
- [ ] Add duplicate evidence ID/locator validation tests.

### Green

- [ ] Implement canonical JSON serialization for stable IDs/hashes.
- [ ] Implement evidence constructors and authority/source validation.
- [ ] Implement redaction and bounded summary/excerpt budgets.
- [ ] Implement manifest-level redaction counters and warnings.

### Refactor/checkpoint

- [ ] Ensure secrets are not echoed in errors, snapshots, or hashes intended for
  human display.
- [ ] Run redaction/evidence tests before any real session read.

## 3. TDD Slice — Harness Manifest

### Red

- [ ] Add valid MiniMax/Claude manifest fixture.
- [ ] Add missing-versus-declared-unknown cases.
- [ ] Add invalid subject, tool capability, permission, path, intervention, and
  artifact reference cases.
- [ ] Add unknown namespaced extension and unsupported top-level field cases.

### Green

- [ ] Implement versioned schema validation with precise field errors.
- [ ] Normalize declared tool/context/skill/environment entries.
- [ ] Preserve declarations as `declared` authority.
- [ ] Document the schema and provide a synthetic example.

### Refactor/checkpoint

- [ ] Verify an absent tool entry is reported as unknown availability, not
  declared absence.
- [ ] Run manifest tests.

## 4. TDD Slice — Task Contract

### Red

- [ ] Add PRD fixtures for explicit R/AC IDs, generated IDs, nested bullets,
  checked state, duplicate IDs, Unicode, and empty/missing requirements.
- [ ] Add content-hash and line-locator stability tests.

### Green

- [ ] Implement conservative Markdown section/bullet extraction.
- [ ] Produce task artifact identities and stable requirement records.
- [ ] Separate document checkbox state from outcome verdict.
- [ ] Surface duplicate explicit IDs and unsupported contract structure.

### Refactor/checkpoint

- [ ] Confirm the parser does not interpret natural-language satisfaction.
- [ ] Run contract tests.

## 5. TDD Slice — Claude Code Adapter

### Red

- [ ] Build synthetic JSONL fixtures for supported metadata, roles, content
  blocks, tool calls/results, compaction, usage, and terminal records.
- [ ] Add exact-session discovery with zero/one/multiple workspace candidates.
- [ ] Add malformed middle line, truncated final line, unknown type, oversized
  line, duplicate/native-ID conflict, and missing timestamp cases.
- [ ] Add context-access positive and prose-mention negative cases.
- [ ] Add a source read-only/state-unchanged integration test.

### Green

- [ ] Implement line-streaming reader and safe record envelope.
- [ ] Implement session/workspace discovery without latest-file guessing.
- [ ] Normalize supported observations and native locators.
- [ ] Link tool calls/results and emit bounded warnings.
- [ ] Implement conservative context-access recognizers.
- [ ] Record thinking presence metadata without raw hidden reasoning.

### Refactor/checkpoint

- [ ] Keep Claude-specific fields in namespaced extensions.
- [ ] Ensure no real session content enters fixtures/snapshots.
- [ ] Run adapter tests.

## 6. TDD Slice — Git and Outcome Evidence

### Red

- [ ] Add temporary Git integration cases for revision ranges, non-ancestor
  base, staged/unstaged changes, untracked files, ignored files, symlinks, file
  deletion/rename, output-under-worktree exclusion, and source mutation checks.
- [ ] Add evidence artifact path/hash/revision match and mismatch cases.

### Green

- [ ] Implement non-mutating Git object/range/snapshot collection.
- [ ] Implement dirty-worktree aggregate identity and untracked file limits.
- [ ] Implement outcome artifact inventory and freshness warnings.
- [ ] Compare subject Git state before/after collection.

### Refactor/checkpoint

- [ ] Verify no stage/add/checkout/reset/clean command is used.
- [ ] Run Git/evidence integration tests.

## 7. TDD Slice — Bundle, Report, and Worksheet

### Red

- [ ] Add expected bundle schema and cross-file identity tests.
- [ ] Add deterministic report ordering and semantic snapshot tests.
- [ ] Add report tests for unknown availability, missing calls, successful-call
  counter-evidence, completion claim without validation, source conflicts,
  unsupported records, and redaction summaries.
- [ ] Add worksheet field/completeness tests and a test prohibiting preselected
  causal verdicts.

### Green

- [ ] Assemble versioned `audit.json` and `manifest.json`.
- [ ] Render all required `report.md` sections with bounded high-signal timeline.
- [ ] Render editable `human-review.md` templates linked by evidence IDs.
- [ ] Implement `validate` and collect-time self-validation.

### Refactor/checkpoint

- [ ] Keep renderer pure over normalized bundle input.
- [ ] Exclude volatile fields from semantic deterministic tests.
- [ ] Run bundle/report tests.

## 8. MiniMax Authority Regression

### Red

- [ ] Add a synthetic fixture with inflated provider cache/token aggregates and
  lower native Claude session usage.
- [ ] Assert that both remain in evidence, native usage is selected for the
  session-token fact, and the report warns about the conflict.
- [ ] Assert that no generated text claims MiniMax has a uniquely oversized
  static context.

### Green

- [ ] Implement source-specific usage authority and conflict rendering.
- [ ] Document the historical correction and current limitation.

### Checkpoint

- [ ] Run the regression separately and include its output in the child
  acceptance matrix.

## 9. Historical MiniMax Local Validation

- [ ] Identify the archived MiniMax-M3 Claude session by exact local metadata;
  do not print or commit raw prompt/tool contents.
- [ ] Construct a harness manifest from recorded historical facts, marking all
  unavailable facts unknown instead of backfilling assumptions.
- [ ] Generate the packet in a private temporary/output location.
- [ ] Validate it and record only safe audit ID, input identities/hashes,
  warnings, redaction counts, report-utility notes, and completed human findings
  under this task's `evidence/` directory.
- [ ] Compare the report with archived reviewer corrections and record false
  positives, missing evidence, and changes needed before fresh validation.
- [ ] Return to earlier TDD slices for any schema/renderer corrections.

## 10. Fresh MiniMax-M3 Subject Run

- [ ] Select and freeze the subject task contract.
- [ ] Create a separate subject branch/worktree that cannot read the
  `agent-audit` implementation worktree, Kimi/GLM implementations, or audit
  findings unless the task explicitly requires the tool after completion.
- [ ] Capture the harness manifest before starting the subject runtime.
- [ ] Start Claude Code through `ccs-claude MiniMax MiniMax-M3` using the
  project-approved orchestration path.
- [ ] Record quota, permissions, interventions, restarts, and task-contract
  changes as they occur without coaching the agent.
- [ ] Stop at the task's own terminal condition or a documented stable blocker;
  do not manufacture completion for the audit.
- [ ] Generate and validate the audit packet.
- [ ] Complete at least one human finding with evidence, counter-evidence,
  uncertainty, and a bounded intervention/next experiment.
- [ ] Ask the user whether the packet materially improved the decision compared
  with the native session/event timeline.

## 11. Full Validation Commands

The implementation must document exact commands. Expected shape:

```bash
node --test tools/agent-audit/test/*.test.mjs
./agent-audit --help
./agent-audit collect --repo <fixture-repo> --task <fixture-task> \
  --session <fixture-jsonl> --harness <fixture-manifest> \
  --base <fixture-base> --head worktree --out <temp-output>
./agent-audit validate <temp-output>
```

Additional gates:

- [ ] no network access required;
- [ ] native session and Git source hashes/status unchanged;
- [ ] no secret/private fixture content under Git;
- [ ] source discovery and verification use reproducible targeted commands and
  direct source reads; no quality claim depends on CodeGraph output;
- [ ] `trellis-check` full child-scope review passes;
- [ ] acceptance matrix maps AC1–AC16 to commands and observed results.

No `./twd` evidence is required because this child has no browser-facing UI. If
a browser surface is added, planning must roll back and add the required
frontend design and real browser evidence before implementation continues.

## 12. Documentation and Handoff

- [ ] Write CLI README, manifest reference/example, source authority rules,
  privacy/redaction guide, known limits, and cleanup instructions.
- [ ] Record how to add a future adapter without changing the canonical core.
- [ ] Record historical and fresh MiniMax validation notes without raw private
  session content.
- [ ] Run the PRD convergence check after any scope changes discovered during
  implementation.
- [ ] Run `trellis-update-spec` only for durable project-wide conventions
  discovered during the work.
- [ ] Commit only task-scoped changes from the feature worktree.

## 13. Rollback and Stop Rules

Stop and return to planning if:

- Claude session records do not retain enough stable evidence for the promised
  report section;
- the harness manifest cannot be captured before the fresh run;
- implementation requires copying raw private sessions into the repository;
- the fresh subject would be contaminated by existing implementations/findings;
- a UI/database/service becomes necessary to satisfy a newly discovered need;
- the tool begins making causal verdicts rather than preparing human evidence;
- the safe feature-branch base remains unresolved.

Rollback is file-local: remove the wrapper and `tools/agent-audit/`; no database,
daemon, or native session state is changed.
