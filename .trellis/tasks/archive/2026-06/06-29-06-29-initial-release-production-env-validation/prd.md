# Initial release production env validation

## Goal

Add a no-secret dry-run validator for the repo-external Feishu/Jira release worker env file before applying it to the deployed Lighthouse .env.prod.

## Requirements

- Add a no-secret CLI that validates a repo-external `release-worker.env` style file before it is piped into `scripts/update_prod_env_from_stdin.py`.
- The validator must reuse the production env updater's parser and allow-list so accepted keys cannot drift between dry-run validation and actual patching.
- The validator must report missing required release-worker keys without printing any configured values.
- The validator must reject unknown or malformed keys before any remote `.env.prod` mutation workflow is run.
- The validator must support JSON output for automation and a human-readable output for operator use.
- Include the validator in the no-secret deployment bundle and update the release deployment runbook with the validation step.
- Keep real Feishu, Jira, Tencent Cloud, LLM, and database secrets outside the repository and out of command arguments.

## Acceptance Criteria

- [x] A focused unit test proves a complete `release-worker.env` file passes validation and prints only key/status metadata.
- [x] A focused unit test proves missing Feishu/Jira runtime keys return `ready=false` and list missing key names only.
- [x] A focused unit test proves unknown or malformed keys fail validation without exposing provided values.
- [x] The deployment bundle includes the validator and its generated README references it before the env updater command.
- [x] `scripts/initial_release_deploy_preflight.py --json` still passes from the worktree.
- [x] Script unit tests pass through `python3 -m unittest discover scripts/tests`.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
