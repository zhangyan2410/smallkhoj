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

- Local development fast path: contained local fixes and small features run inline in the current worktree with one focused verification command. Do not create a Trellis task/worktree/PR, run full suites/E2E/remote review, or wait for GitHub CI unless the user explicitly requests integration/release or the change crosses a high-risk boundary. Source of truth: `.trellis/workflow.md`.
- Code map: use CodeGraph as the code-structure tool before broad Bash filtering; it can replace simple `rg`/file-tree sweeps for entry-point discovery. Guide: `docs/codegraph-agent-guide.md`. Index: `codegraph status`, `codegraph files`, `codegraph query "<symbol>"`, `codegraph explore <topic>`, `codegraph node <symbol>`.
- Multi-agent/integration Git flow: `docs/multi-agent-development-workflow.md`. Use `main` as the stable line. Sibling worktrees, `feat/*` branches, PRs, and squash merge are for parallel work, explicit main integration/release, or high-risk changes; they are not the default for the local fast path.
- Real UI/runtime acceptance: `docs/real-test-sop-template.md` and `docs/real-runtime-dm-reply-sop.md`. For an actual browser-behavior change that needs acceptance, use the project WebDriver wrapper `./twd`; do not call `twd.py` directly. Do not run browser/E2E verification for non-UI changes or repeat it when relevant code has not changed. The committed Playwright flow under `e2e/` is an explicit full-integration check and is not UI acceptance or the local default.
- Real-test environment selection and handoff: `.agents/skills/smallkhoj-real-test/SKILL.md`. Run its read-only context collector before selecting ports, processes, containers, auth, or databases, and include the complete output in delegated Agent prompts.
- Runtime/control-plane trace: `./smallkhoj-trace` for backend/frontend logs, daemon sessions, JSON-RPC, service health, and runtime delivery timelines.
- Worker orchestration: `.agents/skills/smallkhoj-worker-orchestration/SKILL.md`; helper script `.agents/skills/smallkhoj-worker-orchestration/scripts/start-worker-stack.sh`.
- Advisory codebase audits and roadmap discovery: `.agents/skills/improve/SKILL.md`. Use it before Trellis task selection; after selecting a finding, translate it into a normal Trellis PRD/design/implementation task. Integration and conflict rules: `docs/improve-trellis-usage.md`.
- CC Switch launcher: `ccs-claude` starts Claude Code with a selected CC Switch provider without changing the global provider. Index: `ccs-claude list`, `ccs-claude current`, `ccs-claude "<provider>" <model>`.
