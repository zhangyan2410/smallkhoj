# Daemon distribution and versioning design

## Current State

The current product-facing daemon command is only a developer convenience wrapper:

- backend command generation points to the repository root `smallkhoj-daemon` script;
- the wrapper assumes the repository contains `agent/daemon/aaa-daemon`;
- missing builds are repaired by running `npm install && npm run build`;
- every wrapper run attempts `npm run build`;
- wrapper version and daemon package version are not unified;
- production deployment can generate a server URL, but it cannot yet generate a real download/install URL for a packaged daemon.

This means a customer or teammate without the source checkout cannot follow the onboarding command.

## Product Direction

Treat daemon distribution as a release artifact, not a source-tree script.

The first release can use a simple CLI artifact rather than a full native app:

1. Build a macOS arm64 daemon artifact from `agent/daemon/aaa-daemon`.
2. Publish or serve it from a versioned path.
3. Generate UI commands that install/use the artifact and then run `smallkhoj-daemon connect --token ... --server ...`.
4. Record daemon version on connect/register/heartbeat.
5. Warn or block when the daemon is older than the server's minimum supported version.

The developer wrapper can remain in the repository for local work, but it must not be the production onboarding contract.

## Packaging Options

Recommended first slice:

- Package the Node daemon as a self-contained executable or archive with `dist/`, `package.json`, runtime dependencies, and a launcher script.
- Produce an artifact named with platform and version, for example:
  - `smallkhoj-daemon-v0.2.0-darwin-arm64.tar.gz`
  - `smallkhoj-daemon-v0.2.0-darwin-arm64.sha256`
- Install under a user-owned path such as `~/.smallkhoj/bin/smallkhoj-daemon`.
- Make the product command use that installed binary.

Possible later improvements:

- Homebrew tap;
- signed/notarized macOS package;
- Linux packages;
- Windows support;
- auto-update channel.

## Version Contract

Use one source of truth for daemon package version. The daemon should print it from the package/build metadata rather than a hard-coded wrapper string.

Minimum metadata:

- `daemonVersion`: artifact/CLI version, for display and support.
- `protocolVersion` or `apiVersion`: optional first release field if server/daemon compatibility starts changing.
- `platform`: `darwin-arm64`, `darwin-x64`, `linux-x64`, etc.
- `buildSha` or `commit`: useful for release debugging.

Backend behavior:

- accept known-compatible versions;
- return a clear 426/409-style error for unsupported versions once a minimum version is enforced;
- surface old-version diagnostics in UI.

## Onboarding Command Shape

Production UI should not show source paths. Acceptable first-slice command shapes:

```bash
curl -fsSL https://<server>/downloads/smallkhoj-daemon/install.sh | bash
smallkhoj-daemon connect --token sk_connect_... --server https://<server>
```

or a single bootstrap command:

```bash
curl -fsSL https://<server>/downloads/smallkhoj-daemon/install-and-connect.sh | bash -s -- --token sk_connect_... --server https://<server>
```

The two-line command is easier to audit. The one-line command is easier for onboarding. Either is acceptable if token safety, checksums, and diagnostics are handled.

## Security And Trust

- Do not expose durable machine tokens in browser-visible commands.
- Prefer checksum verification for downloaded artifacts.
- Keep install scripts small and readable.
- Avoid requiring `sudo` in the first release; install into the user's home directory.
- Make token expiry and already-used errors human-readable.

## Server/Domain Awareness

Production deployment must set a public base URL used for:

- backend API;
- WebSocket URL derivation;
- daemon connect `--server`;
- daemon artifact download URL.

Local development may keep using the repository wrapper, but production must generate commands from the public server URL and artifact metadata.

## Migration From Current Wrapper

The current root `smallkhoj-daemon` wrapper can become:

- a dev-only wrapper, clearly labelled; or
- the source template for packaged launcher scripts.

It should stop being the only product-facing daemon entry point.

