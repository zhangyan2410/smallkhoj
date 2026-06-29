# Initial release deployment bundle design

## CLI Shape

```bash
rtk python3 scripts/make_deployment_bundle.py --output /tmp/smallkhoj-deploy-bundle.tar.gz
```

Optional:

```bash
--root <repo-root>
--prefix smallkhoj-deploy
```

## Included Files

- `docker-compose.prod.yml`
- `deploy/Caddyfile`
- `docs/initial-release-production-deployment.md`
- `scripts/initial_release_deploy_preflight.py`
- `scripts/lighthouse_host_probe.py`
- `scripts/post_deploy_smoke.py`
- generated `README.deploy-bundle.md`
- generated `manifest.json`

## Excluded Files

- `.env*`
- `.git/`
- `node_modules/`
- `.next/`
- `__pycache__/`
- `.trellis/`
- databases, logs, screenshots, and task evidence.

## Manifest Contract

```json
{
  "generatedAt": "ISO-8601 UTC",
  "gitCommit": "abc123",
  "files": [
    {"path": "docker-compose.prod.yml", "size": 123, "sha256": "..."}
  ]
}
```

## Safety

- Tar entries must be relative paths under a single prefix.
- The generator must fail if a required file is missing.
- Do not resolve or include symlink targets outside the repository.
- Do not include any file whose basename starts with `.env`.
