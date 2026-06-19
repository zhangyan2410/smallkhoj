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

## Project Index

SmallKhoj keeps project rules short in this file; detailed workflows live in indexed docs and skills.

- Code map: use CodeGraph as the code-structure tool before broad Bash filtering; it can replace simple `rg`/file-tree sweeps for entry-point discovery. Guide: `docs/codegraph-agent-guide.md`. Index: `codegraph status`, `codegraph files`, `codegraph query "<symbol>"`, `codegraph explore <topic>`, `codegraph node <symbol>`.
- Multi-agent Git flow: `docs/multi-agent-development-workflow.md`. Use `main` as the stable line; non-trivial work uses a sibling worktree plus `feat/*` branch; verify in that worktree; merge by PR + squash.
- Real UI/runtime testing: `docs/real-test-sop-template.md` and `docs/real-runtime-dm-reply-sop.md`. Use the project WebDriver wrapper `./twd`; do not call `twd.py` directly, and do not use Playwright for repo UI verification.
- Runtime/control-plane trace: `./smallkhoj-trace` for backend/frontend logs, daemon sessions, JSON-RPC, service health, and runtime delivery timelines.
- Worker orchestration: `.agents/skills/smallkhoj-worker-orchestration/SKILL.md`; helper script `.agents/skills/smallkhoj-worker-orchestration/scripts/start-worker-stack.sh`.
- CC Switch launcher: `ccs-claude` starts Claude Code with a selected CC Switch provider without changing the global provider. Index: `ccs-claude list`, `ccs-claude current`, `ccs-claude "<provider>" <model>`.
