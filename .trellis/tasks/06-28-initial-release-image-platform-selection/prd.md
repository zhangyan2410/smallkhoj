# Initial release image platform selection

## Goal

Prevent architecture-mismatched production images from being transferred to the first Lighthouse host.

Apple Silicon local Docker builds produce `linux/arm64` images by default, while Tencent Cloud Lighthouse instances may be `linux/amd64` depending on the purchased plan. The image transfer runner must let the operator choose the target Docker platform once the server architecture is known.

## Requirements

- Add an optional production image transfer CLI flag for Docker build platform selection.
- Apply the selected platform consistently to backend, frontend, and Caddy Docker builds.
- Keep the default behavior unchanged when no platform is provided.
- Document that existing local `arm64` images must not be reused for an `amd64` server.
- Update the deployment spec so future agents verify target host architecture before building/uploading images.

## Acceptance Criteria

- [x] Unit tests prove `--platform linux/amd64` is included in all three Docker build commands.
- [x] Unit tests prove default command planning remains unchanged when platform is omitted.
- [x] Deployment docs explain how to choose `--platform` after confirming Lighthouse architecture.
- [x] Trellis deployment spec records the platform/architecture contract.

## Validation Evidence

- `python3 -m py_compile scripts/production_image_transfer.py scripts/lighthouse_ssh_deploy_probe.py scripts/make_deployment_bundle.py scripts/initial_release_deploy_preflight.py scripts/lighthouse_host_probe.py scripts/post_deploy_smoke.py scripts/remote_deploy_evidence.py scripts/create_prod_env_template.py`
- `python3 -m unittest scripts.tests.test_create_prod_env_template scripts.tests.test_make_deployment_bundle scripts.tests.test_initial_release_deploy_preflight scripts.tests.test_lighthouse_host_probe scripts.tests.test_post_deploy_smoke scripts.tests.test_lighthouse_ssh_deploy_probe scripts.tests.test_remote_deploy_evidence scripts.tests.test_production_image_transfer`
- `python3 scripts/production_image_transfer.py --host 203.0.113.10 --user ubuntu --remote-dir /opt/smallkhoj --output-archive /Volumes/ORICO/smallkhoj-deploy/smallkhoj-production-images-amd64.tar --platform linux/amd64 --use-vpn-proxy --json`
- `git diff --check`

## Out of Scope

- Automatically detecting the remote architecture before SSH credentials are available.
- Building or uploading real images in this task.
