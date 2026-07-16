# Improve skill with Trellis

The project installs `shadcn/improve` at `.agents/skills/improve/`. It is an
advisory, read-only codebase-audit skill. Its useful role in this repository is
to discover and specify high-value work **before** normal Trellis delivery
begins.

## Recommended lifecycle

```text
$improve / $improve next / $improve <focus>
                    ↓
review findings and choose one candidate
                    ↓
create a Trellis task and translate the chosen plan
into prd.md / design.md / implement.md
                    ↓
trellis-before-dev → trellis-implement → trellis-check
                    ↓
commit / PR → trellis-finish-work
```

`improve` writes advisory plans under `plans/` (or `advisor-plans/` if the
repository already uses `plans/` for something else). Trellis remains the
source of truth for accepted work under `.trellis/tasks/`. Do not leave an
accepted roadmap item only in an Improve plan: create a Trellis task and carry
over its evidence, scope, dependencies, verification commands, and escape
hatches.

## Which skill to use

| Need | Use | Why |
| --- | --- | --- |
| Find the highest-value bugs, risks, debt, or next product direction | `improve` | Broad evidence-based audit and prioritized executor-ready plans |
| Turn a chosen feature into requirements and product decisions | `trellis-brainstorm` | Owns Trellis PRD/design/implementation planning and asks one decision at a time |
| Research one question for an existing Trellis task | `trellis-research` agent | Persists evidence in that task's `research/` directory |
| Stress-test unresolved product/design decisions | `grilling` / `grill-me` | Interview-driven challenge; it does not replace repository evidence gathering |
| Model the business domain and persist ADR/glossary material | `grill-with-docs` | Combines grilling with domain-modeling artifacts |
| Audit or improve a visual product surface | `impeccable` | UI-specific critique, design rules, browser workflow, and implementation commands |
| Implement selected work | `trellis-implement` agent | Follows task context and project specs, and edits code directly |
| Verify and fix an implementation | `trellis-check` agent/skill | Checks the actual diff, specs, tests, and cross-layer behavior |
| Delegate implementation to local SmallKhoj workers | `smallkhoj-worker-orchestration` | Owns worker stack startup, dispatch, supervision, and evidence review |

## Conflict rules

### Improve versus Trellis planning

Both can produce implementation plans, but they operate at different points:

- Use `improve` when the question is broad: "What is worth doing?", "What are
  we missing?", or "Audit this repository."
- Use `trellis-brainstorm` after a candidate has been selected and the question
  becomes: "Exactly what should this task deliver?"
- Do not run both as competing owners of the same plan. Trellis artifacts are
  authoritative once a task exists.

### Improve `execute` versus Trellis implementation

Do **not** use `improve execute <plan>` for repository work. It has its own
executor/worktree/review lifecycle, which duplicates and can conflict with:

- `trellis-implement` and `trellis-check` agents;
- the project's sibling-worktree and PR rules;
- Trellis task status, context JSONL, commit, journal, and archive lifecycle;
- `smallkhoj-worker-orchestration` ownership of local worker delegation.

Use Trellis implementation/check agents after translating the plan.

### Improve `reconcile` versus Trellis task state

Do not use `improve reconcile` to mark Trellis work done or blocked. Trellis
task metadata, validation, finish, and archive commands remain authoritative.
An Improve plan may be treated as stale after its selected work has been
captured by a Trellis task.

### Improve `branch` versus Trellis check

- `improve branch` is advisory: identify architectural or maintainability
  follow-ups introduced by a branch and write plans.
- `trellis-check` is a delivery gate: verify/fix the current implementation and
  run required checks.

For a branch nearing completion, run `trellis-check` first. Use `improve branch`
only when a separate follow-up roadmap assessment is wanted.

### Improve versus Impeccable

For visual design, accessibility, layout, color, responsive behavior, and UI
polish, `impeccable` owns the detailed workflow. `improve` may identify a UI
area as strategically weak, but the selected UI task should use Impeccable and
Trellis rather than asking Improve to prescribe visual implementation details.

### Improve versus Grilling

`improve` resolves repository facts through code and produces recommendations.
Grilling resolves human intent and challenges trade-offs through questions.
When both help, run Improve first, then grill only the remaining product
decisions in the selected candidate.

## Recommended invocations

```text
$improve quick
$improve deep security
$improve tests
$improve perf
$improve next
$improve branch
$improve plan introduce versioned database migrations
```

Avoid these in the Trellis repository workflow:

```text
$improve execute <plan>
$improve reconcile
$improve --issues
```

The last command is not inherently unsafe, but Trellis/PR task tracking should
remain the default. Publishing issues also creates external state and requires
explicit user approval, especially for security findings.
