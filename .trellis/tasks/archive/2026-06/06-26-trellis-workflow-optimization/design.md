# Design

## Current Problems

- The local project is on Trellis `0.6.0`, while official docs list `0.6.5` as the latest stable release.
- The local workflow still includes a live `Phase 3.1 Quality verification` step that official `0.6.1+` folded into `Phase 2.2` and `Phase 3.4`.
- Codex has a project `UserPromptSubmit` hook, but the user-level hook feature is not enabled and the SmallKhoj hook is marked disabled in `/Users/lee/.codex/config.toml`.
- The active task tree contains many completed or stale tasks, which makes startup context and `continue` routing noisy.
- The workflow has accumulated stricter-than-official task creation rules, causing small changes to compete with durable Trellis tasks.

## Target Flow

SmallKhoj should keep Trellis as the durable workflow layer, but apply it with a clearer split:

- **No task**: answer-only, read-only inspection, short explanation, or status report.
- **Inline task**: contained, one-turn edit that can be understood and verified immediately. The assistant must state why inline is acceptable.
- **Full Trellis task**: multi-file code, workflow/platform changes, runtime behavior, user-visible UI, design decisions, or anything that should leave durable task/spec context.

For active tasks:

```text
Plan -> Execute/check final pass -> Spec update when needed -> Work commit -> finish-work archive/journal
```

`finish-work` is not the feature-code commit step. It archives and records after work commits exist.

## Codex Behavior

Codex remains `inline` by default because Codex sub-agents do not reliably inherit the parent task context. The project can still keep `trellis-implement`, `trellis-check`, and `trellis-research` definitions for explicit use, but the default current-session flow is:

```text
trellis-before-dev -> edit inline -> trellis-check -> trellis-update-spec if needed -> commit -> finish-work
```

The Codex per-turn breadcrumb requires:

- user-level `[features].hooks = true`;
- project trusted in `/Users/lee/.codex/config.toml`;
- the SmallKhoj `UserPromptSubmit` hook approved/enabled.

## Task Hygiene

Completed task directories should leave the active tree. The archive step is part of workflow quality, not optional cleanup. Done-like statuses (`done`, `completed`, `implemented`) should be treated as archive candidates after confirming the work tree is clean and the task is not still needed as a live parent.

## Update Strategy

Do not force-overwrite locally modified Trellis files. Use:

```bash
rtk trellis upgrade
rtk trellis update --dry-run --create-new
```

Then merge the relevant `0.6.5` behavior into local files. Apply direct edits only where the local project intentionally differs from upstream.
