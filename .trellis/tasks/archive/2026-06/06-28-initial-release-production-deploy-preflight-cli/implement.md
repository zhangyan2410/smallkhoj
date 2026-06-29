# Initial release production deploy preflight CLI implementation

## Checklist

1. [x] Add RED tests for repo config and env/warning exit semantics.
2. [x] Implement `scripts/initial_release_deploy_preflight.py` with structured check results.
3. [x] Run tests and default preflight.
4. [x] Run runtime preflight on the current machine.
5. [x] Update deployment docs and spec with the new gate.
6. [x] Run full targeted verification, archive, and commit.

## Validation Commands

```bash
rtk python3 -m unittest scripts.tests.test_initial_release_deploy_preflight
rtk python3 scripts/initial_release_deploy_preflight.py --json
rtk python3 scripts/initial_release_deploy_preflight.py --runtime --json
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-production-deploy-preflight-cli
```

## Verification Notes

- Red test: `rtk python3 -m unittest scripts.tests.test_initial_release_deploy_preflight` failed because `scripts.initial_release_deploy_preflight` did not exist.
- Unit tests: `rtk python3 -m unittest scripts.tests.test_initial_release_deploy_preflight` passed 4 tests.
- Default preflight: `rtk python3 scripts/initial_release_deploy_preflight.py --json` returned `ready: true`, `failures: 0`, `warnings: 0`.
- Runtime preflight on current machine: `rtk python3 scripts/initial_release_deploy_preflight.py --runtime --json` returned `ready: true`, `failures: 0`, `warnings: 0`; Docker daemon, Docker Compose, memory, disk, and ports 80/443 checks passed.
- Env-file smoke: a temporary `.env` with `SMALLKHOJ_SITE_ADDRESS=:80` returned `warnings: 1`, no secret values, exit `0` without `--strict-warnings`, and exit `2` with `--strict-warnings`.
