# Impeccable Research

## Source

- GitHub project: `pbakaus/impeccable`
- Installed project skill version: `3.8.0`

## Constraint

Impeccable requires Node `>=24`, while the local default Node is `v22.14.0`.

The installer was run through a temporary Node 24 package:

```bash
npx -y -p node@24 node -v
```

Observed output:

```text
v24.17.0
```

## Installation

Project-local install command used:

```bash
npx -y -p node@24 node /tmp/smallkhoj-impeccable-run/node_modules/impeccable/cli/bin/cli.js install --providers=claude,codex --scope=project
```

Installer output:

```text
Installed impeccable into: .claude, .agents (project)
Installed hooks into: .claude, .agents
```

## Resulting Paths

Claude Code:

```text
.claude/skills/impeccable/
.claude/settings.local.json
```

Codex/shared agents:

```text
.agents/skills/impeccable/
.codex/hooks.json
```

## Hook Status

Both hook-admin status checks reported the hooks as enabled, using default `.impeccable` config because no `.impeccable/config.json` or `.impeccable/config.local.json` exists yet.

Codex may still require user approval through `/hooks` before the hook is active in the UI.

## Verification Note

Both installed skill metadata files report:

```text
version: 3.8.0
```
