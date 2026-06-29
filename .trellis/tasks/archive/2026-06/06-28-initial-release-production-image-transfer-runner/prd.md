# Initial release production image transfer runner

## Goal

Enable the first Tencent Cloud Lighthouse deployment without requiring a container registry or building production images on the 2 vCPU / 2 GB server.

The release operator should be able to build production Docker images on the local development machine or a stronger build host, export them as Docker archives, upload them over SSH, and load them on the Lighthouse host before running the existing production compose stack.

## Background

- The initial-release deployment path already has preflight, host probe, no-secret bundle, post-deploy smoke, SSH probe, and evidence collection scripts.
- `docker-compose.prod.yml` expects backend, frontend, and Caddy image tags to be available on the target host.
- A registry-based flow is still valid later, but it adds setup friction for the first end-to-end server test.
- Building the Next.js frontend and Python/backend dependencies directly on the 2C2G Lighthouse server is risky for memory, disk, and time.

## Requirements

- Provide a no-secret CLI for planning and executing local image build/export plus SSH upload/load.
- Support backend, frontend, and Caddy production image tags, with sensible default tags for an initial local release.
- Support a `--skip-build` path when the images already exist locally.
- Support dry-run output that shows the command plan without executing build, save, scp, or ssh load steps.
- Support JSON output for evidence capture and repeatable operator runs.
- Support SSH options consistent with the existing Lighthouse SSH tooling: host, user, port, identity file, and remote directory.
- Support Docker build proxy configuration for the local VPN path used in this project, including build-container proxy values via `host.docker.internal:7897`.
- Avoid reading or printing `.env.prod`, environment secrets, tokens, or credential values.
- Keep the first-release flow compatible with the existing deployment bundle and production compose stack.

## Acceptance Criteria

- [x] A unit-tested script can build, save, upload, and load backend/frontend/Caddy image archives through a deterministic command plan.
- [x] Dry-run mode emits the intended commands and metadata without executing Docker, SCP, or SSH.
- [x] `--skip-build` omits Docker build steps while preserving save, upload, and load steps.
- [x] VPN/proxy mode includes Docker build arguments suitable for local Docker builds that need outbound network access through port `7897`.
- [x] The script output and tests demonstrate that no `.env.prod` contents or secret-like values are printed.
- [x] Deployment documentation explains when to use registry-based images versus the registry-free image transfer flow.
- [x] The relevant Trellis deployment spec records the image-transfer contract for future agents.

## Validation Evidence

- `python3 -m py_compile scripts/create_prod_env_template.py scripts/make_deployment_bundle.py scripts/initial_release_deploy_preflight.py scripts/lighthouse_host_probe.py scripts/post_deploy_smoke.py scripts/lighthouse_ssh_deploy_probe.py scripts/remote_deploy_evidence.py scripts/production_image_transfer.py`
- `python3 -m unittest scripts.tests.test_create_prod_env_template scripts.tests.test_make_deployment_bundle scripts.tests.test_initial_release_deploy_preflight scripts.tests.test_lighthouse_host_probe scripts.tests.test_post_deploy_smoke scripts.tests.test_lighthouse_ssh_deploy_probe scripts.tests.test_remote_deploy_evidence scripts.tests.test_production_image_transfer`
- `python3 scripts/production_image_transfer.py --host 203.0.113.10 --user ubuntu --remote-dir /opt/smallkhoj --use-vpn-proxy --json`
- `python3 scripts/lighthouse_ssh_deploy_probe.py --host 203.0.113.10 --user ubuntu --remote-dir /opt/smallkhoj --remote-env-file .env.prod --compose-up --use-loaded-images --json`
- `python3 scripts/initial_release_deploy_preflight.py --json`
- `git diff --check`

## Out of Scope

- Pushing images to Docker Hub, Tencent Container Registry, or another registry.
- Creating or editing production secrets.
- Running the real Lighthouse deployment; this task only provides the missing deployment mechanism.
