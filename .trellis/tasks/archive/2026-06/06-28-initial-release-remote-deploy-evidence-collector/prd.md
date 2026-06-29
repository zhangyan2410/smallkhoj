# Initial release remote deploy evidence collector

## Goal

Add a no-secret remote deployment evidence collector so the first Lighthouse deployment failure can be diagnosed from one command instead of ad hoc SSH log hunting.

The project now has no-secret bundle upload/probe, env guardrails, compose startup, and post-deploy smoke. The remaining operational gap is evidence capture after a failed or partial remote deploy: host probe output, preflight output, compose ps/config, recent logs, disk/memory/docker state, and optional public smoke should be collected consistently.

## Requirements

- Provide a local CLI that builds a command plan for collecting deployment evidence over SSH.
- Support `--dry-run` and `--json` so commands can be reviewed without connecting.
- Support SSH user, port, identity file, remote deploy directory, bundle prefix, and remote env-file path.
- Collect only no-secret evidence by default.
- Run remote commands in the unpacked deployment bundle directory.
- Include host probe and repo preflight evidence.
- Include env/runtime preflight only when a remote env-file path is provided.
- Include Docker/Compose evidence that is useful after startup: `docker compose ps`, `docker compose config --services`, recent logs for core services, `docker ps`, `docker system df`, memory and disk snapshots.
- Do not print `.env.prod` contents or secret env values.
- Optionally run local public smoke when a public base URL is provided.
- Write a local JSON evidence file summarizing command labels, commands, exit codes, and captured stdout/stderr.

## Acceptance Criteria

- [x] A new evidence collector script exists.
- [x] Unit tests cover default command planning, SSH flags, optional env/runtime preflight, optional public smoke, and command result JSON shape.
- [x] Deployment docs explain how to collect evidence after a failed remote probe or compose startup.
- [x] Backend deployment spec records the evidence collector contract and no-secret constraints.
- [x] Existing deployment script tests pass.

## Notes

- This task is PRD-only because it is a contained deployment utility plus tests/docs/spec.
- The collector does not replace real daemon/live-run validation. It captures deploy infrastructure evidence.
- Validation: deployment script suite passed with 36 tests.
- Dry-run evidence: `remote_deploy_evidence.py --host 203.0.113.10 --user ubuntu --identity-file /tmp/key.pem --remote-dir /opt/smallkhoj --remote-env-file .env.prod --public-base-url http://203.0.113.10 --allow-http --dry-run` prints labeled commands without `cat .env.prod` or `printenv`.
- Bundle check: generated tarball includes `scripts/remote_deploy_evidence.py`.
