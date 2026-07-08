# Open Design Research

## Source

- GitHub project: `nexu-io/open-design`
- Latest release observed during setup: `open-design-v0.11.0`
- MCP package observed during setup: `open-design-mcp@0.16.1`
- ADE npm package used locally: `open-design-ade@0.4.2`

## Deployment Options Considered

### Docker

The documented Docker image route uses `ghcr.io/nexu-io/od:latest` and port `7456`.

This failed locally because GHCR returned unauthorized responses when trying to inspect or pull the image:

```text
Head "https://ghcr.io/v2/nexu-io/od/manifests/latest": unauthorized
```

Logging out of GHCR did not resolve the anonymous pull failure. Because disk is constrained, this path was not pursued further.

### Desktop DMG

The release includes macOS DMG assets, but they are roughly 259-269MB before install overhead. This was not used because the npm ADE package is much smaller and sufficient for a local daemon/web UI.

### npm ADE

The selected path is `open-design-ade@0.4.2`.

It starts a local daemon and bundled web UI:

```bash
node /tmp/smallkhoj-open-design-ade-run/node_modules/open-design-ade/dist/cli.js --port 7456 --host 127.0.0.1 --no-open
```

Current local URL:

```text
http://127.0.0.1:7456
```

The running service logs:

```text
[od] daemon listening on http://127.0.0.1:7456
[open-design-ade] listening on http://127.0.0.1:7456
```

## MCP

Use `open-design-mcp@0.16.1` as a stdio MCP server.

Required baseline environment:

```text
OD_DAEMON_URL=http://localhost:7456
```

Optional generation/BYOK variables for future use:

```text
BYOK_BASE_URL
BYOK_API_KEY
BYOK_MODEL
BYOK_PROVIDER
```

The MCP package exposes project/design operations such as listing projects, creating/updating projects, saving artifacts, linting artifacts, composing briefs, and generating designs.
