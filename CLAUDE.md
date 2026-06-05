# Claude Code Project Notes

This project also uses `AGENTS.md` as the shared Codex/Claude project instruction file. Read it first for Trellis workflow, local network policy, and local tool indexes.

## Debug Harness

- Use `/Users/code/project/smallkhoj/smallkhoj-trace` first when debugging the full SmallKhoj agent/control-plane flow.
- Quick summary: `./smallkhoj-trace summary`
- Follow live trace: `./smallkhoj-trace follow`
- Machine-readable output: `./smallkhoj-trace summary --json`
- The trace tool aggregates backend/frontend dev logs, daemon JSON-RPC logs, daemon sessions, service health, and managed Claude runtime trace lines. Playwright covers UI assertions; `smallkhoj-trace` covers why messages, tasks, and runtime events moved through the system.
