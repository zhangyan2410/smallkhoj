# Initial release post-deploy smoke CLI implementation

## Checklist

1. [x] Add RED tests with a local fake HTTP deployment.
2. [x] Implement `scripts/post_deploy_smoke.py`.
3. [x] Run smoke against fake server tests and localhost failure/scheme cases.
4. [x] Update deployment docs and code-spec with the post-deploy gate.
5. [x] Run verification, archive, and commit.

## Validation Commands

```bash
rtk python3 -m unittest scripts.tests.test_post_deploy_smoke
rtk python3 -m py_compile scripts/post_deploy_smoke.py
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-post-deploy-smoke-cli
```

## Verification Notes

- Red test: `rtk python3 -m unittest scripts.tests.test_post_deploy_smoke` failed because `scripts.post_deploy_smoke` did not exist.
- Unit tests: `rtk python3 -m unittest scripts.tests.test_post_deploy_smoke` passed 4 tests.
- CLI negative smoke: `rtk python3 scripts/post_deploy_smoke.py --base-url http://127.0.0.1:9 --allow-http --json` returned exit `1` and a fast failed report with 7 checks.
- Regression guard: `rtk python3 -m unittest scripts.tests.test_initial_release_deploy_preflight scripts.tests.test_lighthouse_host_probe` passed 9 tests.
- Full script test group: `rtk python3 -m unittest scripts.tests.test_post_deploy_smoke scripts.tests.test_initial_release_deploy_preflight scripts.tests.test_lighthouse_host_probe` passed 13 tests.
- Script compile: `rtk python3 -m py_compile scripts/post_deploy_smoke.py scripts/initial_release_deploy_preflight.py scripts/lighthouse_host_probe.py` passed.
- Existing deploy checks still work: deploy preflight returned `ready: true`, `failures: 0`, `warnings: 0`; host probe returned `ready: true`, `failures: 0`, `warnings: 4` on macOS.
