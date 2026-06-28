# Initial release SSH deployment probe runner

## Goal

Add a repeatable SSH runner for the initial release deployment probe so a Tencent Cloud Lighthouse host can be inspected from the local machine with one no-secret command.

The current runbook already has the right pieces: no-secret bundle generation, upload/unpack, host probe, deploy preflight, compose startup, and post-deploy smoke. The risk is operator error when copying commands into the first server. This task wraps the safe first half of that process.

## Requirements

- Generate the existing no-secret deployment bundle locally.
- Upload the bundle to a remote host over `scp`.
- Run remote commands over `ssh` to create a release directory, unpack the bundle, and run `lighthouse_host_probe.py --json`.
- Optionally run remote repo/config preflight without requiring `.env.prod`.
- Optionally run remote env/runtime preflight when the operator provides a remote env-file path.
- Optionally run remote `docker compose pull/build/up` only behind an explicit flag.
- Optionally run public post-deploy smoke from the local machine when the operator provides a base URL.
- Keep secrets out of CLI output and repository files; the runner must not create or upload `.env.prod`.
- Provide `--dry-run` so the exact SSH/SCP/local commands can be reviewed before execution.
- Support SSH identity file and port arguments.

## Acceptance Criteria

- [x] A new script exposes a no-secret SSH probe workflow with dry-run output.
- [x] Unit tests cover command planning for upload/probe, optional env/runtime preflight, optional compose startup, and optional public smoke.
- [x] Deployment docs explain how to run the SSH probe against Lighthouse.
- [x] Backend deployment spec records the runner contract and safety constraints.
- [x] Existing deployment script tests continue to pass.

## Notes

- This task is PRD-only because it is a contained deployment utility and test/docs/spec update.
- The script is intentionally provider-neutral SSH first. Tencent Cloud CLI inspection can be layered later once cloud credentials and instance IDs are available.
- Validation: `python3 -m unittest scripts.tests.test_make_deployment_bundle scripts.tests.test_initial_release_deploy_preflight scripts.tests.test_lighthouse_host_probe scripts.tests.test_post_deploy_smoke scripts.tests.test_lighthouse_ssh_deploy_probe` passed with 27 tests.
- Dry-run evidence: `lighthouse_ssh_deploy_probe.py --host 203.0.113.10 --user ubuntu --identity-file /tmp/key.pem --remote-dir /opt/smallkhoj --dry-run` prints create-bundle, SSH mkdir, SCP upload, remote unpack, host probe, and repo preflight without executing them.
