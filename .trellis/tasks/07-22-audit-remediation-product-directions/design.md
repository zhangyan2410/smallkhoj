# Product-direction disposition design

## Separation of truth

```text
audit finding
  -> current fact (source/task/runtime)
  -> classification
       correctness/security defect -> remediation child
       documentation drift          -> approved truth reconciliation
       architecture debt            -> architecture child
       unchosen product capability  -> explicit disposition + linked task
```

This prevents two failure modes: reporting advisor-branch code as shipped, and treating
every plausible product idea as a release-blocking defect.

## Proposed decision matrix

| Plan | Current classification | Recommended disposition | Owning work |
|---|---|---|---|
| 006 | authoritative doc contradicts shipped theme | `ACCEPT_DOC_TRUTH` | this child, docs-only after approval |
| 007 | standalone observer exists/WIP; no app integration | `DEFER_LINKED` | `07-16-session-observability-console`, then new integration task |
| 008 | evidence-backed new durable-work capability | `DEFER_LINKED` | `07-13-agent-runtime-capability-matrix` follow-on feature |
| 009 | real delete transaction/UI defect | `SUPERSEDED` | schema-integrity + delivery-ui |
| 010 | PRODUCT principle vs route-tree conflict | `ACCEPT_AND_IMPLEMENT` Option A | small route/navigation follow-on in this program |
| 011 | uncommitted scaffold/roadmap ambiguity | `DEFER_LINKED` | `07-10-remotion-long-skeleton-phase1` |

The matrix is a proposal until maintainer decisions are recorded. P009's classification
is evidence-backed and does not need a product direction choice; hard-delete versus
soft-delete remains outside the current v1 contract.

## Decision 006 design

Actual CSS tokens are the implementation evidence; DESIGN becomes the human authority
only after it accurately mirrors those tokens and the decision history. The final doc:

- declares water/dark/shuimo and default/storage behavior;
- gives per-theme token tables from live CSS;
- distinguishes shared background/card values from different popover/secondary/muted /
  sidebar values;
- points to the ink-wash task as superseding the light-only plan;
- retains actionable accessibility/`./twd` checks only;
- archives the old handoff rather than deleting history.

## Decision 007 design guardrail

No integration prototype is accepted until the standalone observer itself is reviewed.
If a future task is approved, start with loopback discovery and a fail-open external link
or capability card. Iframe/proxy/unified timeline are separate security/product choices,
not automatic progressions. Missing observer must never degrade core SmallKhoj routes.

## Decision 008 design guardrail

The durable Work Item is a new bounded context between business intent and provider
invocation. It cannot be represented by adding a status column to existing chat messages
without losing dispatch-attempt/idempotency/uncertainty semantics. The capability task's
verified provider matrix remains the prerequisite truth. Audit closure records the link;
feature acceptance belongs to a new PRD/design/migration program.

## Decision 010 target

Recommended route topology:

```text
product: /, /chat, /tasks, /members, /computers
control: /control/daemon, /control/integration, /control/taskrun-templates, future diagnostics
compat:  /daemon -> temporary redirect -> /control/daemon
```

A visible control entry preserves discoverability without mixing every operator link into
domain pages. Redirect remains non-permanent for one release and is tested with direct
deep links. Routing docs define placement and auth separately.

## Decision 011 guardrail

An untracked empty directory is not a product defect, and an untracked detailed PRD is
user WIP. The safe terminal audit state is a recorded roadmap disposition. Filesystem
cleanup is optional and authorized separately; building the composition is its own
feature task with its own toolchain and evidence.

## Decision artifact

Implementation creates `decisions.md` in this child with one table row plus rationale
per plan. Unresolved human decisions remain visibly `BLOCKED_DECISION`; linked deferred
items show task path/status and do not count as unfixed confirmed code defects.
