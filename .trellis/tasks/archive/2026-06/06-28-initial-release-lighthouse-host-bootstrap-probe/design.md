# Initial release Lighthouse host bootstrap probe design

## CLI Shape

```bash
rtk python3 scripts/lighthouse_host_probe.py [--json] [--strict-warnings]
```

Default mode is read-only and human-readable. JSON mode is for release evidence.

## Probe Areas

- OS and package manager:
  - read `/etc/os-release` when available;
  - detect `apt-get`, `dnf`, `yum`, or `apk`;
  - detect whether the current user is root or has non-interactive sudo.
- Resources:
  - CPU count;
  - total memory;
  - swap;
  - free disk under the current repository path.
- Runtime dependencies:
  - `docker` command availability;
  - Docker daemon response;
  - `docker compose version` response.
- Public port readiness:
  - local TCP connect check for `127.0.0.1:80` and `127.0.0.1:443`.
- Firewall tooling:
  - detect `ufw`, `firewall-cmd`, `iptables`, and `nft`.

## Suggested Commands

The CLI may emit suggested commands but must not execute them:

- Ubuntu/Debian Docker install path using Docker's official apt repository.
- Swapfile creation when total memory is under 2 GiB and swap is absent or very small.
- UFW open-port commands when `ufw` exists.

## Result Contract

Each check:

```json
{
  "name": "host.memory",
  "status": "passed|warning|failed",
  "reasonCode": "HOST_PROBE_READY",
  "reason": "Human-readable reason.",
  "details": {}
}
```

Top-level:

```json
{
  "ready": true,
  "warnings": 0,
  "failures": 0,
  "checks": [],
  "suggestedCommands": []
}
```

Exit codes:

- `0`: no failures, warnings allowed.
- `1`: failed checks.
- `2`: warnings with `--strict-warnings`.

## Non-Goals

- Do not SSH into Tencent Cloud automatically.
- Do not use `tccli`.
- Do not mutate the host.
- Do not start Docker containers.
