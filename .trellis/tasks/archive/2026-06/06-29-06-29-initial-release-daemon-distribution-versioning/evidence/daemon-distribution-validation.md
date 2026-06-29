# Daemon distribution validation

Date: 2026-06-29

## Artifact build

Command:

```bash
rtk python3 scripts/build_daemon_distribution.py --output-dir /tmp/smallkhoj-daemon-release-check --platform darwin-arm64 --json
```

Result:

```json
{
  "artifact": "/private/tmp/smallkhoj-daemon-release-check/smallkhoj-daemon-v0.2.0-darwin-arm64.tar.gz",
  "checksumFile": "/private/tmp/smallkhoj-daemon-release-check/smallkhoj-daemon-v0.2.0-darwin-arm64.tar.gz.sha256",
  "installScript": "/private/tmp/smallkhoj-daemon-release-check/install.sh",
  "manifest": "/private/tmp/smallkhoj-daemon-release-check/smallkhoj-daemon-v0.2.0-darwin-arm64.tar.gz.manifest.json",
  "platform": "darwin-arm64",
  "sha256": "4f0cb464e18dc9d00274eebb7eee66e794faa8a78cd1fdfef56f622e6d13af8c",
  "version": "0.2.0"
}
```

## Install outside repository checkout

Command:

```bash
rtk env \
  SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=file:///private/tmp/smallkhoj-daemon-release-check \
  SMALLKHOJ_DAEMON_HOME=/tmp/smallkhoj-daemon-install-check/home \
  SMALLKHOJ_DAEMON_BIN_DIR=/tmp/smallkhoj-daemon-install-check/bin \
  bash /private/tmp/smallkhoj-daemon-release-check/install.sh
rtk /tmp/smallkhoj-daemon-install-check/bin/smallkhoj-daemon --version
```

Result:

```text
Installed smallkhoj-daemon 0.2.0 (darwin-arm64) to /tmp/smallkhoj-daemon-install-check/home/versions/v0.2.0-darwin-arm64
0.2.0
```

## Connect outside repository checkout

The installed CLI was launched from `/tmp`, not from the repository checkout, against a fake backend implementing `/internal/agent-api/daemon/connect`, `/daemon/register`, `/daemon/heartbeat`, and `/daemon/shutdown`.

Result:

```json
{
  "ok": true,
  "cwd": "/tmp",
  "cli": "/tmp/smallkhoj-daemon-install-check/bin/smallkhoj-daemon",
  "registerCount": 1,
  "daemonVersion": "0.2.0"
}
```

The fake backend asserted:

- `/daemon/connect` received `Authorization: Bearer sk_connect_installed_real`;
- connect body included `daemonVersion:"0.2.0"`;
- register/heartbeat used the returned `sk_machine_installed_real` token;
- workspace payload was empty because connect does not auto-create or steal an agent workspace.

## Computer-scoped runtime workspace validation

Automated daemon runtime tests now cover the product default workspace root and computer-scoped dynamic runtime cwd:

```bash
rtk npm run build
rtk node --test test/daemon-runtime.test.mjs test/daemon-version-source.test.mjs
```

Result:

```text
19 passed
```

The new checks assert:

- `SMALLKHOJ_DAEMON_WORKSPACE_ROOT` overrides the default daemon workspace root;
- `SMALLKHOJ_DAEMON_HOME` maps to `<home>/workspaces`;
- two different `computerId` values on the same Server and `workspaceId` produce different runtime directories;
- `smallkhoj-daemon connect` without `--workspace` reads `computer.id` from `/daemon/connect`, starts a runtime from a backend `start_runtime` command, and reports `cwd` under `.slock-runtimes/<serverId>/<computerId>/<workspaceId>`.

## Browser-visible install command

WebDriver command:

```bash
rtk ./twd --compact eval --url-match localhost:3001/computers "return { install: document.querySelector('[data-testid=daemon-reconnect-install-command]')?.textContent || document.querySelector('[data-testid=daemon-install-command]')?.textContent || null }"
```

Observed:

```text
curl -fsSL http://localhost:8001/downloads/smallkhoj-daemon/install.sh | SMALLKHOJ_DAEMON_DOWNLOAD_BASE_URL=http://localhost:8001/downloads/smallkhoj-daemon bash
```

Screenshot:

- `evidence/daemon-install-command-ui.png`

## Automated checks

```bash
rtk npm run build
rtk node --test test/daemon-runtime.test.mjs test/daemon-version-source.test.mjs test/smallkhoj-daemon-wrapper.test.mjs
rtk backend/.venv/bin/python -m pytest scripts/tests/test_build_daemon_distribution.py -q
rtk .venv/bin/python -m pytest tests/test_daemon_control.py tests/test_daemon_command_generation.py tests/test_server_account_membership.py -q
rtk npx tsx --test frontend/test/daemon-install.test.ts frontend/test/computer-navigation.test.ts
rtk npm --prefix frontend run lint
rtk python3 scripts/initial_release_deploy_preflight.py --root . --json
```

Notes:

- Daemon runtime/version/wrapper tests passed: 23 tests.
- Backend daemon/account scope tests passed: 67 tests.
- Frontend daemon install/navigation tests passed: 5 tests.
- Artifact builder tests passed: 2 tests.
- Frontend lint passed with 15 pre-existing warnings unrelated to this task.
- Deployment preflight passed with 13 checks, 0 failures, and 0 warnings.
