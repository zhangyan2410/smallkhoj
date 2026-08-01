# SmallKhoj 开发与真实验证最小入口

## 目标

让一个没有当前聊天上下文的 Agent，在开始真实开发前调用
`trellis-before-dev`，就能找到本项目需要的任务上下文、开发规则、现有测试命令、
真实 UI/runtime 验证方式和云端验证边界，不再依赖用户临时补充提醒。

本任务只整理现有能力，不新造 Workflow runner。

## 已确认事实

- 项目已有 `make ci`、`tools/integration-gate/`、`./twd` 和
  `./smallkhoj-trace`，当前缺少的是一个短、稳定、可发现的使用入口。
- 截图只能证明某个画面出现过，不能单独证明 Agent/Channel/Task/Chat 的完整链路正确。
- 本地测试通过不能证明云端部署正确；云端声明必须有目标云环境的实际证据。
- `.agents/skills/trellis-before-dev/SKILL.md` 与
  `.claude/skills/trellis-before-dev/SKILL.md` 当前内容不一致。
- 已完成的 TWD 修复、真实闭环和验证结果记录在
  `research/previous-twd-repair-summary.zh-CN.md`，它是本任务的已知基线，不在本任务中重做。

## 需求

### R1 — 一份中文流程索引

新增或整理一份短中文文档，明确四个阶段：

1. 开发前：读取 Trellis task、适用 spec、Git/worktree、代码入口和既有测试。
2. 改动前后：按影响范围选择自动测试；涉及核心 Server、Computer、Agent、
   Channel、DM、Chat、Task 或 runtime 时，选择对应 Integration Gate，并在修改前建立基线。
3. 完成功能后：浏览器行为使用 `./twd`，runtime 传递使用
   `./smallkhoj-trace`；截图只作为辅证，并与 DOM、API/DB、trace 或 Gate 结果对账。
4. 部署时：明确 local-dev、local-prod、cloud-prod 的证据边界；未在云端实际执行
   smoke/health gate 时，不得声称云端验证通过。

文档只索引仓库已有命令和权威文档，不复制长篇实现细节。

### R2 — `trellis-before-dev` 作为唯一手动入口

`trellis-before-dev` 必须：

- 收集当前 task、branch/worktree、dirty state、适用 spec 和代码入口；
- 在动代码前选择本次改动需要的自动测试、Integration Gate、真实 UI/runtime
  验证和部署验证范围；
- 指向 R1 的中文文档和已有工具；
- 缺少可用环境、凭据、daemon、browser 或 provider 时，记录为 blocker/未验证，
  不把它写成 PASS。

### R3 — 跨 Agent 可发现

- Codex 使用的 `.agents` skill 与 Claude 使用的 `.claude` skill 都能发现同一份中文入口。
- 长流程只保留一个仓库事实入口；平台 skill 只保留必要路由，避免再次漂移。
- 不要求增加自动同步系统；本次只做最小一致性修复。

### R4 — 用一次真实任务验证入口

修改完成后，启动一个没有本次聊天补充说明的新 Agent，让它在当前项目的一项真实任务上
调用 `trellis-before-dev`。验证它能独立给出：

- 当前任务和仓库状态；
- 适用规范与主要代码入口；
- 修改前基线；
- 修改后自动测试与真实测试计划；
- 本地和云端声明边界。

若仍需要用户提醒隐藏文件或命令，把缺失索引补回 skill/中文文档后再验证一次。

## 验收标准

- [x] AC1：仓库中存在一份简短中文流程文档，覆盖开发前、自动测试、真实测试和云端证据边界。
- [x] AC2：`.agents` 与 `.claude` 的 `trellis-before-dev` 都能明确指向同一中文入口和现有工具。
- [x] AC3：skill 的开发前简报包含 task、Git/worktree、spec、代码入口、基线、验证计划和部署影响。
- [x] AC4：涉及核心链路的修改会在动代码前选择适用 Integration Gate；无法执行时明确记录原因，不误报通过。
- [x] AC5：一次 fresh Agent 真实任务试用无需本次对话的额外提醒，并产出可执行的上下文与验证计划。
- [x] AC6：任务校验、相关 skill 检查和 `git diff --check` 通过。
- [x] AC7：本任务不新增 runner、状态机、checkpoint、resume、资源编排器或新的完整测试框架。

## 非目标

- 不新增 `./smallkhoj-flow` 或 `tools/real-delivery-workflow/`。
- 不把现有 Integration Gate、TWD、trace 或部署脚本重新封装一遍。
- 不在本任务中重新实现或合并之前的 TWD 修复。
- 不要求 Codex 与 Claude 各跑一套完整产品闭环；第一版只做一次 fresh Agent 真实试用。
- 不执行云端部署；这里只规定什么时候可以声称云端验证通过。

## 时间估算

预计 **30–60 分钟**。其中主要时间用于一次 fresh Agent 真实任务试用；如果本地
daemon、browser 或 provider 不可用，只记录实际 blocker，不扩展本任务去修复
外部环境。
