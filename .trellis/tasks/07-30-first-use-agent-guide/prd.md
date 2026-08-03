# First-use Agent Creation Guide for Non-Technical Users

## Goal

让一个**完全没用过 AI、本机没装任何 coding agent（claude code/codex 都没有）、不懂命令行**的用户，打开 SmallKhoj 后能被清晰引导到「创建一个能用的 agent 并和它对话」，而不是面对一堆技术术语（Runtime/Provider/Computer）或一个会失败的下拉框。

核心：把已经实现的能力（bundled Pi + MiniMax relay + 动态 runtime 检测）包装成一个**面向小白的引导流程**，让"能用"这件事可见、可懂、可走通。

## Background

前置任务 `07-28-runtime-select-guide`（已合并 main）已经完成了底层：
- daemon 检测并上报 bundled Pi（`type:pi, source:bundled`）
- 创建 agent 时 runtime 下拉**动态**来自 `detectedRuntimes`（修了写死 bug）
- 后端 lease/relay 让 Pi 经 MiniMax 中转，用户无需配 key
- runtime=pi 在 backend 全链路打通

但当前 UI 仍是"一个技术表单"：Computer 下拉 + Runtime 下拉 + Provider 下拉 + Name。小白看到不知道：
1. 该填什么 name
2. Runtime 是什么、选哪个
3. bundled Pi 为什么"自带、不用配 key"
4. 创建完去哪、怎么开始聊

本任务把这层**产品化**，不改后端能力，专注前端引导体验。

## User Value

- 小白用户打开产品 → 一个清楚的「开始」入口 → 几步创建出能聊的 agent → 进对话。
- 全程不出现「Runtime / Provider / Computer / LLM key」这些词，或出现时有普通用户能懂的解释。
- bundled Pi 作为「官方提供的、开箱即用、不用配 key」的默认推荐路径。
- 本机已装 claude code/codex 的进阶用户，仍能选它们（不强制 Pi）。

## Requirements

### R1 — 首次进入有空状态引导，不是空白
- 一个没有任何 agent 的 Server，首屏要有一个明确的「创建你的第一个 Agent」入口 + 一句话说明这是什么。
- 不要让用户落到一个空 members 列表或空 chat 页自己猜。

### R2 — 创建 agent 表单产品化（去技术化）
- 表单字段用普通用户语言：不是「Runtime」，是「选择你的 AI 助手类型」之类。
- bundled Pi 项要有清楚的「官方提供 / 无需配置 / 开箱即用」标识，并作为**默认推荐**（本机啥都没装时默认选它）。
- 本机已装的 runtime（claude code/codex）作为「你电脑上已有的」可选，并如实标注。
- 没装的 runtime 不可选（已在前置任务实现，本任务保留并优化呈现）。
- 表单顶部一句引导：「选一个 AI 助手就能开始，推荐使用自带的 Pi（无需任何配置）」。

### R3 — 创建成功后直接进入对话，不停在表单
- 创建 agent 成功后，自动进入与该 agent 的 DM，而不是回到 members 列表让用户再找。
- 进入 DM 时有「打个招呼试试」之类的引导（可选的初始提示）。

### R4 — bundled Pi 的"不用配 key"要可见可信
- 选 bundled Pi 时，表单明确说明「使用官方提供的模型，你不需要任何 API key」。
- 不出现 key 输入框（bundled Pi 路径不需要）。
- 非 Pi runtime（claude code 等）若需要本机配置，如实标注「需要本机已安装并配置」。

### R5 — 引导文案中英文 + 本地化
- 所有新增文案中英双语（`messages/zh-CN.json` + `en.json`）。
- 用产品语言，不用 Runtime/Provider/daemon 等内部术语（除非在高级/诊断区）。

### R6 — 不回归
- 现有进阶用户的创建 agent 流程（手动选 runtime/provider）保留，作为「高级」或默认展开的次要路径。
- 不破坏 07-28 的动态 runtime 检测逻辑。

## Acceptance Criteria

- [ ] 空 Server（无 agent）首屏有明确的创建引导入口，不是空白列表。
- [ ] 创建 agent 表单：bundled Pi 默认推荐 + 「官方提供/无需配置」标识；本机已装的可选；没装的不可选。
- [ ] 创建成功自动进入 agent DM。
- [ ] 选 Pi 路径全程无 key 输入框、无 Runtime/Provider 术语暴露给小白。
- [ ] 中英文案齐全。
- [ ] 现有手动创建流程不回归。
- [ ] frontend lint/tsc/build/test 全绿。
- [ ] `./twd` 真测：空 Server → 引导 → 创建 Pi agent → 自动进 DM（可见证据）。

## Out of Scope

- 后端 relay/lease/Pi runtime 能力（已在 07-28 完成，本任务不改后端）。
- Pi↔MiniMax SSE usage 兼容（Pi 包内部边缘，独立后置）。
- guest 共享 Server / 多用户权限（明确先不做）。
- 空 Server 长状态机 / first-run onboarding 长流程（不做 07-22 那套）。
- 跨平台 embedded Node 打包。

## Notes

- 底层能力已就绪（07-28 合并），本任务纯前端引导产品化。
- 参考 multica 的 create-agent-dialog 模式（disabled runtime 带 title 提示）。
- 设计前查 `.trellis/spec/guides/reference-projects.md`。
