# Coding Agent Harness Diagnostics — Long-Term Execution Plan

## 1. Parent-Task Operating Rule

This parent task is the initiative truth source and integration gate. Do not
start it as the implementation target while a child owns the next concrete
deliverable. Each stage receives its own child task, sibling worktree, feature
branch, validation evidence, review, and archive cycle.

The parent remains `planning` until the first child proves the product thesis.
Later it may move to `in_progress` only if parent-owned integration work becomes
necessary; child progress does not require that transition.

## 2. Branch and Worktree Rule

For every implementation child:

1. confirm `main` and `origin/main` have an agreed safe base;
2. preserve unrelated dirty/untracked files;
3. create `../smallkhoj-<child-slug>` on `feat/<child-slug>`;
4. record branch, base branch, worktree path, and base revision in `task.json` or
   task evidence;
5. run all implementation and validation from that worktree;
6. use reviewed PR plus squash merge;
7. archive the child and clean its worktree only after merge.

Current blocker to branch creation: root `main` is ahead of `origin/main` by
commit `47848e8`, that commit is explicitly not to be pushed, and the root also
contains unrelated dirty/untracked task work. Planning may proceed; branch
creation must wait for an explicit safe-base decision rather than silently
normalizing this state.

## 3. Stage 1 — Current Child

Task: `07-17-human-guided-harness-audit-mvp`

Deliver:

- a zero-cloud, read-only local CLI;
- one Claude Code native adapter suitable for a MiniMax-M3/CC Switch run;
- explicit task-contract, harness-manifest, Git/outcome, and session inputs;
- versioned `audit.json`, deterministic `report.md`, editable
  `human-review.md`, and input `manifest.json`;
- source authority and redaction behavior;
- a historical MiniMax calibration case with known source disagreement;
- one reproducible MiniMax-M3 subject-run report;
- a documented human decision about the next harness intervention.

Stage 1 exits only when the child termination conditions pass and the user says
the report materially improves diagnosis over reading a session timeline.

## 4. Stage 2 — Structured Agent Claims

Create a child only after Stage 1 identifies which unanswered questions would
have been useful during the run.

Planned work:

1. define early, blocked, and pre-completion probe schemas;
2. send bounded probes through Trellis channel for supported workers;
3. persist replies as `claimed` evidence;
4. detect direct contradictions with tool availability and successful calls;
5. measure interruption/steering cost;
6. validate on a new MiniMax-M3 run without exposing prior answers.

Exit gate: probes add actionable information that was not already observable,
while remaining clearly non-authoritative and low-interruption.

## 5. Stage 3 — Deterministic Detectors

Create one child for a small detector set derived from repeated human findings.

Candidate sequence:

1. select no more than five high-value facts from Stage 1/2 reports;
2. write positive, negative, unknown, and conflict fixtures;
3. implement each detector against the canonical bundle only;
4. require evidence/counter-evidence locators in every result;
5. measure false positives/negatives against human-reviewed runs;
6. reject detectors that depend on hidden reasoning or tool-specific accidents.

Exit gate: each shipped detector is deterministic, source-cited, and useful to
the human reviewer without making a broad causal claim.

## 6. Stage 4 — Automated Causal Synthesis

Create only after several human gold reports and deterministic facts exist.

Planned work:

1. freeze a redacted evaluation corpus;
2. define an output schema for hypotheses, evidence, counter-evidence,
   confidence, alternatives, missing observations, and interventions;
3. validate all citations against bundle identities;
4. compare judge findings with gold reports by finding, not by one opaque score;
5. test abstention and adversarial/conflicting evidence;
6. keep the judge optional and the deterministic report usable without it.

Exit gate: the judge improves reviewer throughput without inventing evidence,
hiding uncertainty, or defaulting to a model-capability explanation.

## 7. Stage 5 — Tool Adapters

Create independent children in evidence-driven order. A suggested order is:

1. Codex rollout JSONL;
2. Kimi Code wire JSONL;
3. ZCode SQLite/rollout;
4. OpenCode SQLite;
5. Pi JSONL after a real sample is available.

For each adapter:

- survey only schemas/metadata before handling sensitive payloads;
- define supported and unsupported evidence fields;
- add sanitized fixtures;
- prove workspace/session selection and source-locator stability;
- run one real read-only audit;
- compare canonical output with the Claude adapter for semantic consistency;
- keep native extensions namespaced.

Exit gate: the adapter can generate a valid single-run packet without changing
the canonical model to mirror its private schema.

## 8. Stage 6 — Controlled Harness Comparison

Create only after at least three adapters and single-run reports are valid.

Planned work:

1. define manifest equivalence and explicit confound rules;
2. compare requirement coverage and harness interventions, not raw model rank;
3. support paired before/after runs of one intervention;
4. label non-controlled comparisons illustrative;
5. validate with one same-task/same-model/different-harness experiment;
6. preserve links to both complete single-run reports.

Exit gate: a reader can see what changed, what stayed controlled, what remains
confounded, and whether the proposed harness intervention improved the expected
signal.

## 9. Cross-Stage Verification

Every child must verify, as applicable:

- fixture-based unit tests;
- malformed/truncated/unknown source behavior;
- deterministic output and schema versioning;
- read-only source access;
- redaction and bounded excerpt behavior;
- source locator resolution;
- base/outcome revision identity;
- clean temporary-output behavior;
- real local sample without committed private session content;
- documented reproduction commands;
- peer/human review of causal claims and evidence truthfulness.

Browser evidence through `./twd` is required only when a child adds a browser
surface. Stage 1 intentionally uses Markdown/JSON and does not require browser
verification.

## 10. Parent Integration Review

After each child:

1. update the parent task map and decisions;
2. record what the child disproved or left unknown;
3. decide whether the next proposed child still addresses the product thesis;
4. avoid creating downstream automation merely because it was on the roadmap;
5. update cross-child acceptance evidence;
6. create only the next independently valuable child.

Before completing the parent, reproduce one end-to-end sequence:

```text
contract-backed run
  -> native adapter and audit packet
  -> human finding
  -> bounded harness intervention
  -> controlled next run
  -> observed improvement or falsified hypothesis
  -> optional automated explanation matching the evidence
```

## 11. Rollback Points

- Stage 1: remove the wrapper/tool directory and generated audit output; no
  persistent service state exists.
- Stage 2: disable probes while retaining offline collection.
- Stage 3: disable or remove individual detectors without changing bundles.
- Stage 4: disable automated synthesis while retaining human review.
- Stage 5: disable an adapter independently; existing bundles remain readable.
- Stage 6: remove comparison views without affecting single-run reports.

No stage may require destructive changes to native coding-tool session stores.

