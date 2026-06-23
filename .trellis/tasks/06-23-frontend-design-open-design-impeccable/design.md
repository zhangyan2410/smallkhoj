# Design Tooling Integration

## Architecture

SmallKhoj will use two complementary design tools:

- Open Design runs as a local daemon/web UI on port `7456`. AI agents reach it through `open-design-mcp`.
- Impeccable is installed as a project-local skill and hook package for design critique around UI edits.

## Platform Wiring

Claude Code:

- Skills: `.claude/skills/impeccable`
- Hook settings: `.claude/settings.local.json`
- Open Design MCP: project-scoped `.mcp.json`

Codex:

- Skills: `.agents/skills/impeccable`
- Hook settings: `.codex/hooks.json`
- Open Design MCP: project `.codex/config.toml`

## Network And Disk Constraints

All network package operations should set:

```bash
HTTP_PROXY=http://127.0.0.1:7897
HTTPS_PROXY=http://127.0.0.1:7897
ALL_PROXY=http://127.0.0.1:7897
```

For localhost health checks, also set:

```bash
NO_PROXY=127.0.0.1,localhost
```

Avoid cloning `nexu-io/open-design` or downloading desktop DMG assets unless the npm ADE path stops working. The current daemon process depends on the temporary npm install at `/tmp/smallkhoj-open-design-ade-run`; keep it while the daemon is running.

## Verification Strategy

- Open Design daemon: `curl -I http://127.0.0.1:7456`.
- Open Design browser UI: use project WebDriver `./twd` against `http://127.0.0.1:7456`.
- Claude Code MCP: `claude mcp list` and `claude mcp get open-design`.
- Codex MCP: `codex mcp list` and `codex mcp get open-design --json`.
- Impeccable hooks: run each `hook-admin.mjs status` script.
- Impeccable context/detection: run the project-local scripts against `frontend`.
