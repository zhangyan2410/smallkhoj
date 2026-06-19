# Claude Code Project Notes

Read `AGENTS.md` first. It is the shared project index for Codex, Claude, Gemini, Kimi, and other agents.

## Debug Harness

- Use `/Users/code/project/smallkhoj/smallkhoj-trace` first when debugging the full SmallKhoj agent/control-plane flow.
- Quick summary: `./smallkhoj-trace summary`
- Follow live trace: `./smallkhoj-trace follow`
- Machine-readable output: `./smallkhoj-trace summary --json`
- The trace tool aggregates backend/frontend dev logs, daemon JSON-RPC logs, daemon sessions, service health, and managed Claude runtime trace lines. Playwright covers UI assertions; `smallkhoj-trace` covers why messages, tasks, and runtime events moved through the system.
