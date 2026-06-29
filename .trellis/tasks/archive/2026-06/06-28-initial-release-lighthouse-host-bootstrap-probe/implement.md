# Initial release Lighthouse host bootstrap probe implementation

## Checklist

1. [x] Add RED unit tests for host check classification and suggested command generation.
2. [x] Implement `scripts/lighthouse_host_probe.py`.
3. [x] Run host probe on current machine in JSON mode.
4. [x] Update deployment runbook and code-spec with the host probe gate.
5. [x] Run verification, archive, and commit.

## Validation Commands

```bash
rtk python3 -m unittest scripts.tests.test_lighthouse_host_probe
rtk python3 -m py_compile scripts/lighthouse_host_probe.py
rtk python3 scripts/lighthouse_host_probe.py --json
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-lighthouse-host-bootstrap-probe
```

## Verification Notes

- Red test: `rtk python3 -m unittest scripts.tests.test_lighthouse_host_probe` failed because `scripts.lighthouse_host_probe` did not exist.
- Unit tests: `rtk python3 -m unittest scripts.tests.test_lighthouse_host_probe` passed 5 tests.
- Current-machine JSON smoke: `rtk python3 scripts/lighthouse_host_probe.py --json` emitted `ready: true`, `failures: 0`, `warnings: 4`, `checks: 12`.
- Current-machine warnings were expected on macOS: no supported Linux package manager, no non-interactive sudo, no common firewall tools, and unknown `/proc/meminfo` swap.
- Regression guard: `rtk python3 -m unittest scripts.tests.test_initial_release_deploy_preflight` still passed after reusing deploy preflight helpers.
