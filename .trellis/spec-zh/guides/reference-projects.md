# 参考项目指南

> 目的：记住在设计与实现相邻平台能力之前，应先查阅哪些兄弟/参考仓库。

## 核心记忆

SmallKhoj 在本地有可用的参考项目。它们是参考项目，不是 GA 本身，不得与 GA 代码库混为一谈。

在设计 MCP 可见性、skill 可见性、channel/runtime 编排、agent 工作区或类似平台界面之前，先查阅这些参考：

| 参考 | 本地路径 | 远端 / 标识 | 用途 |
| --- | --- | --- | --- |
| agent-platform | `/Users/code/project/agent-platform` | `https://github.com/neutree-ai/agent-platform.git` | Agent 平台架构、skill/内容服务、控制面、浏览器/服务边界、自托管布局 |
| clowder-ai | `/Users/code/project/clowder-ai` | `https://github.com/zts212653/clowder-ai` | Cat Cafe skill、多 agent workflow 约定、记忆/证据系统、评审/合并生命周期 skill |
| multica | `/Users/code/project/multica` | `https://github.com/multica-ai/multica.git`（`multica-ai/multica`） | MCP/agent 产品模式、自托管文档、daemon/server 布局、app/package 组织、skill 锁定/配置模式 |

## 何时查阅

- 在新增 MCP 清单、skill 清单、工具/资源可见性或能力浏览器界面之前。
- 在 SmallKhoj 引入新的 channel/runtime 编排概念之前。
- 在新造本地 skill 布局、skill 注册表或 skill 来源模型之前。
- 在设计向开发者或 supervisor 暴露 agent/MCP/skill 内部机制的 UX 之前。
- 在改变自托管、daemon、控制面或 agent 工作区边界之前。

## 如何使用

1. 先查看相关参考项目，再决定 SmallKhoj 应复用该模式、改造它，还是明确拒绝它。
2. 把决策记录到当前活跃的 Trellis 任务、ADR 或实现笔记中。
3. 不要盲目复制代码。把参考当作契约（contract）、边界、术语和 UX 的先行实践，而不是强制来源。
4. 如果参考与 SmallKhoj 现有 spec 冲突，以 SmallKhoj 的 spec 为准，除非任务明确要更新它们。

## 错误 vs 正确

### 错误

“不查参考项目，从零开始构建 MCP/skill 可见性。”

### 正确

“先看 `agent-platform`、`clowder-ai` 和 `multica-ai/multica`，总结可借鉴的模式，再实现符合当前 Trellis spec 的 SmallKhoj 版本。”
