# Implementation Plan

1. Update the Trellis CLI to the latest stable release and inspect project-template drift with `trellis update --dry-run --create-new`.
2. If safe, create `.new` template files for modified Trellis/platform files and compare them with local versions.
3. Merge workflow changes into `.trellis/workflow.md`:
   - practical no-task triage;
   - Codex inline planning/in-progress states;
   - `0.6.5` final pass and spec-sync language;
   - remove live dependence on Phase 3.1.
4. Make `.trellis/config.yaml` explicit:
   - `codex.dispatch_mode: inline`;
   - keep channel worker guard visible;
   - keep comments accurate for SmallKhoj.
5. Enable Codex hook prerequisites in `/Users/lee/.codex/config.toml` where possible and mark the SmallKhoj UserPromptSubmit hook enabled if the trusted hash is already present.
6. Archive active done-like tasks using `task.py archive` where the repository is clean enough for Trellis bookkeeping.
7. Validate:
   - `trellis --version`;
   - `task.py current --source`;
   - `task.py validate 06-26-trellis-workflow-optimization`;
   - status distribution of active tasks;
   - git diff review.
8. Commit the workflow changes locally. Do not push.
