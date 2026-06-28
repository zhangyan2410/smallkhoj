# Initial release worker rollout runner

## Goal

Add a no-secret guarded CLI to apply release-worker env to the deployed host, restart backend, run live-run preflight, and start the Feishu worker only after explicit readiness gates.

## Requirements

- Add an operator-safe CLI for the post-secret release worker rollout path.
- The CLI must validate the repo-external release-worker env file with `validate_release_worker_env.py` before any remote mutation.
- The CLI must send env values to the remote updater over stdin, not as SSH command arguments.
- The CLI must restart only the backend service after applying env, then run the container-side live-run preflight.
- The CLI must not start the Feishu worker unless the operator passes an explicit start flag and the live-run preflight command has succeeded.
- The CLI must support dry-run/plan output that prints no env values and does not mutate local or remote state.
- The CLI must expose the live-run preflight inputs (`--feishu-chat-id`, `--feishu-chat-type`, and `--command`) as arguments rather than hard-coding them.
- The CLI must use the existing remote deploy layout and compose path, with sensible defaults for the current Lighthouse host.
- The deployment runbook must point operators to the CLI as the preferred path after `release-worker.env` is filled.
- The no-secret deployment bundle must include the CLI.

## Acceptance Criteria

- [x] Unit tests prove the default plan validates locally, applies env over SSH stdin, restarts backend, and runs live-run preflight without printing env values.
- [x] Unit tests prove the worker start step is omitted by default and included only with an explicit flag after preflight.
- [x] Unit tests prove dry-run JSON output contains commands and labels but not env file contents.
- [x] The deployment bundle includes the rollout CLI.
- [x] Documentation shows the guarded rollout command and keeps secrets outside command arguments.
- [x] `python3 -m unittest discover scripts/tests` passes.
- [x] `python3 scripts/initial_release_deploy_preflight.py --json` passes from the worktree.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
