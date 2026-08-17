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

## Codex 工作方式

Codex 默认直接完成当前工作，不主动初始化、读取或执行 Trellis 工作流，不创建、
激活或归档 Trellis task，不调用 `trellis-*` skills，也不运行 `.trellis/scripts/`
中的流程命令。只有用户明确要求“使用 Trellis”时，Codex 才进入 Trellis 流程。

如果用户给出 `.trellis/` 下的具体文件，Codex 可以把它当作普通需求、设计或交接
文档直接读取和编辑；这不代表需要激活任务或进入 Trellis 生命周期。

## Project Index

SmallKhoj keeps project rules short in this file; detailed workflows live in indexed docs and skills.

- Local development fast path: contained local fixes and small features run inline in the current worktree with one focused verification command. Do not create a Trellis task/worktree/PR, run full suites/E2E/remote review, or wait for GitHub CI unless the user explicitly requests integration/release or the change crosses a high-risk boundary. Source of truth: `.trellis/workflow.md`.
- Code map: use CodeGraph as the code-structure tool before broad Bash filtering; it can replace simple `rg`/file-tree sweeps for entry-point discovery. Guide: `docs/codegraph-agent-guide.md`. Index: `codegraph status`, `codegraph files`, `codegraph query "<symbol>"`, `codegraph explore <topic>`, `codegraph node <symbol>`.
- Multi-agent/integration Git flow: `docs/multi-agent-development-workflow.md`. Use `main` as the stable line. Sibling worktrees, `feat/*` branches, PRs, and squash merge are for parallel work, explicit main integration/release, or high-risk changes; they are not the default for the local fast path.
- Real UI/runtime acceptance: `docs/real-test-sop-template.md` and `docs/real-runtime-dm-reply-sop.md`. For an actual browser-behavior change that needs acceptance, use the project WebDriver wrapper `./twd`; do not call `twd.py` directly. Do not run browser/E2E verification for non-UI changes or repeat it when relevant code has not changed. The committed Playwright flow under `e2e/` is an explicit full-integration check and is not UI acceptance or the local default.
- Real-test environment selection and handoff: `.agents/skills/smallkhoj-real-test/SKILL.md`. Run its read-only context collector before selecting ports, processes, containers, auth, or databases, and include the complete output in delegated Agent prompts.
- Runtime/control-plane trace: `./smallkhoj-trace` for backend/frontend logs, daemon sessions, JSON-RPC, service health, and runtime delivery timelines.
- Trellis 本地只读仪表盘: `./trellis-dashboard` 在 127.0.0.1:4322 起 web UI 展示 Trellis 任务/工件/会话/journal 状态（`--json` 一次性快照，`?demo` 演示数据）；实现在 `tools/trellis-dashboard/`，测试 `make trellis-dashboard-test`。
- Worker orchestration: `.agents/skills/smallkhoj-worker-orchestration/SKILL.md`; helper script `.agents/skills/smallkhoj-worker-orchestration/scripts/start-worker-stack.sh`.
- Advisory codebase audits and roadmap discovery: `.agents/skills/improve/SKILL.md`. Use it before Trellis task selection; after selecting a finding, translate it into a normal Trellis PRD/design/implementation task. Integration and conflict rules: `docs/improve-trellis-usage.md`.
- CC Switch launcher: `ccs-claude` starts Claude Code with a selected CC Switch provider without changing the global provider. Index: `ccs-claude list`, `ccs-claude current`, `ccs-claude "<provider>" <model>`.

<comet-ambient-resume>
<!-- Managed by Comet. Edits inside this block may be replaced by comet init/update. -->
<!-- Contract: comet.resume_probe.v2 -->

## Comet Ambient Resume

在这个仓库中，开始处理需要改动或调查的任务前，如果可能存在活跃 Comet workflow，把当前用户请求传入只读探针：`comet resume-probe . --stdin --json`。

- 如果用户通过宿主明确调用任意 Comet Skill（例如 `@comet`、`/comet`、`@comet-native` 或 `/comet-hotfix`），显式调用优先于本恢复协议；不要运行 resume probe，直接进入被调用的 Skill。
- 只信任返回的 `workflow`、`skill` 和 `entrySource`；它们只由项目配置或无配置兼容回退决定。不得扫描或切换另一套 workflow。
- 如果 probe 返回 `auto_resume`，简短说明选中的 active change，并进入 `nextCommand` 指向的永久入口。不要把状态命令当作恢复入口直接推进。
- 如果 probe 返回 `ask_user`，只问一个简短问题并等待用户回复。
- 如果当前请求未明确调用 Comet Skill，且 probe 返回 `out_of_scope` 或 `none`，不要进入 Comet workflow。
- 如果配置或状态无效且没有 `nextCommand`，停止并报告原因；不要猜测另一个 workflow。
- 不能只因为存在 active change 就把无关任务挂到该 change。Native 的未提交改动由 Native 入口检查，不由探针自动归因。
</comet-ambient-resume>
