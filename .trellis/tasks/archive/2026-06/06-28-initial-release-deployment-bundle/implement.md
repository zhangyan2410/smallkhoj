# Initial release deployment bundle implementation

## Checklist

1. [x] Add RED tests for tarball contents, manifest hashes, README, and secret/env exclusion.
2. [x] Implement `scripts/make_deployment_bundle.py`.
3. [x] Generate a local bundle under `/tmp` and inspect manifest.
4. [x] Update deployment docs and code-spec.
5. [x] Run verification, archive, and commit.

## Validation Commands

```bash
rtk python3 -m unittest scripts.tests.test_make_deployment_bundle
rtk python3 -m py_compile scripts/make_deployment_bundle.py
rtk python3 scripts/make_deployment_bundle.py --output /tmp/smallkhoj-deploy-bundle.tar.gz
rtk python3 - <<'PY'
import tarfile
with tarfile.open('/tmp/smallkhoj-deploy-bundle.tar.gz', 'r:gz') as tar:
    print('\n'.join(tar.getnames()))
PY
rtk git diff --check
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-deployment-bundle
```

## Verification Notes

- Red test: `rtk python3 -m unittest scripts.tests.test_make_deployment_bundle` failed because `scripts.make_deployment_bundle` did not exist.
- Unit tests: `rtk python3 -m unittest scripts.tests.test_make_deployment_bundle` passed 5 tests.
- Local bundle smoke: `rtk python3 scripts/make_deployment_bundle.py --output /tmp/smallkhoj-deploy-bundle.tar.gz` created `/private/tmp/smallkhoj-deploy-bundle.tar.gz`.
- Bundle inspection showed 8 tar members under `smallkhoj-deploy/` and `manifest.json` with 7 hashed files plus the git commit.
- Full script regression: `rtk python3 -m unittest scripts.tests.test_make_deployment_bundle scripts.tests.test_initial_release_deploy_preflight scripts.tests.test_lighthouse_host_probe scripts.tests.test_post_deploy_smoke` passed 18 tests.
- Script compile: `rtk python3 -m py_compile scripts/make_deployment_bundle.py scripts/initial_release_deploy_preflight.py scripts/lighthouse_host_probe.py scripts/post_deploy_smoke.py` passed.
