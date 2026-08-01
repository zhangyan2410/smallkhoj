---
name: trellis-before-dev
description: "在 SmallKhoj 开发前收集当前任务、规范、代码入口、Git/worktree、Integration Gate 基线、真实 UI/runtime 验证和部署边界。用于开始或恢复功能、Bug 修复、重构，以及切换受影响 layer 后刷新上下文。"
---

# 开发前准备

在编辑代码前建立本次任务的上下文和验证基线。

## 必须执行

1. 完整读取统一中文入口：
   `docs/agent-development-and-verification-workflow.zh-CN.md`。
2. 运行其中“动代码前”的 task、phase、packages 和 Git 命令，记录准确的
   task、worktree、branch 与已有 dirty 文件。
3. 完整读取当前 task 的 `task.json`、`prd.md`，以及存在的 `design.md`、
   `implement.md` 和直接引用资料。
4. 从 `.trellis/spec/guides/index.md` 与受影响 layer 的 spec index 进入并完整读取
   本次真正适用的规范。Skill/platform 相关改动还要读取
   `.trellis/spec/guides/reference-projects.md`。
5. 用 CodeGraph 先找代码入口、调用者和已有测试；再用 `rg` 查精确值、配置、文档
   和平台副本。只改文档且 CodeGraph 不索引该内容时，明确记录这一点即可。
6. 运行中文入口列出的 Integration Gate 快速合同基线。涉及 Server、Computer、
   Agent、Channel/DM/Chat、协作、Task 或 runtime 时，再选择一个适用 live mode
   建立修改前基线；环境不具备时记录 blocker，不得写成 PASS。
7. 从中文入口选择修改后的自动测试、真实 `./twd`、API/DB、
   `./smallkhoj-trace`、Integration Gate 和部署验证范围。

## 编辑前输出

按中文入口中的“开发前简报”格式，简短输出：

- Task 与 task contract；
- Repository/worktree/branch/dirty 风险；
- 受影响范围、实际读取的 specs、代码入口和已有测试；
- 修改前 baseline，或明确的 blocker；
- 修改后 validation plan；
- deployment 影响和允许声明的证据边界；
- 尚未解决的冲突或未知项。

简报存在且任务 workflow 允许实现后才能编辑。完成实现后重跑同一基线和选定验证；
截图、本地测试或未执行的云端 gate 都不能被扩大解释。

