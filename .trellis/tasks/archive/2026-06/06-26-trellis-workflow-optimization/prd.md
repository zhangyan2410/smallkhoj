# Optimize Trellis workflow and Codex flow

## Goal

Align SmallKhoj Trellis flow with official 0.6.5 behavior, enable reliable Codex workflow breadcrumbs, reduce task noise, and document project-specific flow decisions.

## Requirements

- Align the local Trellis workflow with the official 0.6.5 flow where it affects SmallKhoj:
  - remove the redundant Phase 3.1 final verification step from the live path;
  - route final quality through Phase 2.2 final pass;
  - route reusable lessons through Phase 3.3 before Phase 3.4 commits;
  - keep `/trellis:finish-work` focused on archive and journal after work commits.
- Make no-task triage more practical:
  - simple Q&A and read-only investigation should not create a task;
  - tiny single-turn edits may run inline when the user clearly accepts that path;
  - durable, multi-file, architecture, workflow, runtime, or user-visible work should still create a Trellis task.
- Make Codex behavior explicit and reliable:
  - keep Codex default dispatch as inline;
  - document that user-level Codex hooks must be enabled and approved for per-turn workflow breadcrumbs;
  - avoid relying on Codex sub-agents for normal implementation unless explicitly requested.
- Reduce task-system noise:
  - completed/done/implemented tasks should be archived instead of remaining in active task lists;
  - planning/in-progress tasks should remain active only when they represent real future or ongoing work.
- Preserve project-specific SmallKhoj conventions:
  - shell commands use `rtk`;
  - browser-facing frontend verification uses `./twd`;
  - MCP, skill visibility, channel/runtime UI, self-hosting surfaces, and agent workspace chrome must consult the documented reference projects before design.
- Do not overwrite local Trellis customizations with upstream templates; merge official updates into local files deliberately.

## Acceptance Criteria

- [x] `trellis` CLI and project templates are updated or safely prepared for 0.6.5-compatible flow.
- [x] `.trellis/workflow.md` reflects the simplified 0.6.x finish path and SmallKhoj-specific triage rules.
- [x] `.trellis/config.yaml` explicitly records the intended Codex dispatch mode and channel guard defaults.
- [x] Codex user/project hook state is configured so Trellis workflow breadcrumbs can be enabled without hidden manual knowledge.
- [x] Finished active tasks are archived or otherwise removed from the active task noise pool.
- [x] Updated task manifests include real context entries instead of seed-only JSONL.
- [x] Validation commands prove the workflow, task context, and git state are coherent after the changes.

## Notes

- Source docs checked: `https://docs.trytrellis.app/llms.txt`, `start/everyday-use.md`, `start/how-it-works.md`, `advanced/configuration.md`, `advanced/custom-workflow.md`, `advanced/multi-platform.md`, and changelogs `v0.6.1` through `v0.6.5`.
