# Initial release worker rollout execution gates

## Goal

Add regression coverage proving release_worker_rollout stops before remote mutation when env validation fails and stops before worker startup when live-run preflight fails.

## Requirements

- Add regression coverage for `scripts/release_worker_rollout.py` execution gating, not just dry-run planning.
- Prove that when local release-worker env validation fails, the rollout stops before SSH env application, backend restart, live-run preflight, or worker startup.
- Prove that when live-run preflight fails, the rollout stops before the `start-feishu-worker` step.
- Keep all tests no-secret and no-network by using fake plan steps and mocked execution results.
- If the runner behavior does not already satisfy these gates, patch it minimally without changing the documented operator commands.

## Acceptance Criteria

- [x] A unit test proves validator failure executes only `validate-release-worker-env`.
- [x] A unit test proves preflight failure skips `start-feishu-worker`.
- [x] The tests do not run SSH, Docker, or read real env files.
- [x] `python3 -m unittest scripts/tests/test_release_worker_rollout.py` passes.
- [x] `python3 -m unittest discover scripts/tests` passes.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
