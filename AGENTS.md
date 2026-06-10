<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## Local Network Policy

- If a network command fails because of connectivity, TLS, GitHub, or package registry access, retry that single command with a per-command proxy on `127.0.0.1:7897`.
- Prefer scoped one-shot environment variables, for example `HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 <command>`.
- Do not change global shell config, system proxy settings, package-manager global proxy settings, or all future commands just to fix one network failure.

## Local Tool Index

### SmallKhoj Worker Orchestration Skill

- Skill: `smallkhoj-worker-orchestration`
- Path: `/Users/code/project/smallkhoj/.agents/skills/smallkhoj-worker-orchestration/SKILL.md`
- Purpose: use this before delegating development work through the local SmallKhoj/Slock worker stack. It captures the verified flow: Docker/Colima test DB, FastAPI backend, aaa-daemon, `ccs-claude` provider launch, Slock dispatch, watcher notifications, and supervisor code review.
- Use when: starting or verifying workers, assigning work to `@aaa`, choosing GLM/Kimi/MiniMax providers, debugging daemon/runtime delivery, reading watcher notifications, or reviewing worker-produced changes.
- Default worker provider: prefer `ccs-claude "Zhipu GLM" glm-5.1`; fall back to Kimi or MiniMax if GLM is unavailable or out of quota.
- Helper: `.agents/skills/smallkhoj-worker-orchestration/scripts/start-worker-stack.sh start|status|stop`

### SmallKhoj Flow Trace

- Command: `/Users/code/project/smallkhoj/smallkhoj-trace`
- Purpose: Codex and Claude Code should use this first when debugging the full SmallKhoj agent/control-plane flow. It aggregates backend/frontend dev logs, daemon JSON-RPC logs, daemon sessions, service health, and managed Claude runtime trace lines into one timeline.
- Quick summary: `./smallkhoj-trace summary`
- Follow live trace: `./smallkhoj-trace follow`
- Machine-readable output: `./smallkhoj-trace summary --json`
- Scope: this is the project debug harness for flow visibility; use the project WebDriver tool for UI/browser assertions, while `smallkhoj-trace` covers why messages/tasks/runtime events moved through the system.

### Project WebDriver Policy

- Do not use Playwright for browser/UI verification in this repository.
- Use the project WebDriver harness instead: `/Users/code/project/smallkhoj/agent/daemon/webdriver/twd.py`.
- For frontend or browser-facing fixes, drive the running local app through this WebDriver tool, use unique markers, verify visible DOM state, and cross-check backend/API/database state when relevant.
- Keep `smallkhoj-trace` for runtime/control-plane flow diagnosis; use WebDriver only for browser-visible behavior.

### CC Switch Terminal Launcher

- Command: `/Users/lee/.local/bin/ccs-claude`
- Purpose: start Claude Code from a CC Switch provider without changing CC Switch's global current provider, so different terminals can use different providers/models at the same time.
- Data source: reads Claude providers from `/Users/lee/.cc-switch/cc-switch.db` and merges `common_config_claude` from the CC Switch `settings` table.
- Behavior: creates a temporary Claude settings file for the current process, starts `claude` with `--settings`, `--model`, `--setting-sources project,local`, and `--permission-mode bypassPermissions`.
- List providers: `ccs-claude list`
- Current CC Switch provider: `ccs-claude current`
- Start examples:
  - `ccs-claude "Zhipu GLM" glm-5.1`
  - `ccs-claude Kimi kimi-for-coding`
  - `ccs-claude DeepSeek deepseek-v4-pro -- --continue`
- Important: do not create another command named `cc-switch`; that name belongs to the CC Switch desktop app/Homebrew cask.
