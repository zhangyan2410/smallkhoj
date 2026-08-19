# 后端开发指南

> 本项目后端开发的最佳实践。

---

## 概览

本目录包含后端开发指南（guide）。请用你项目的具体约定填充每个文件。

---

## 指南索引

| 指南 | 描述 | 状态 |
|-------|-------------|--------|
| [目录结构](./directory-structure.md) | 模块组织与文件布局 | 生效中 |
| [数据库指南](./database-guidelines.md) | ORM 模式、查询、迁移、只读标记观察 | 生效中 |
| [错误处理](./error-handling.md) | 错误类型与处理策略 | 待填充——归属 08-19-agent-platform-quality-gates（R5） |
| [质量指南](./quality-guidelines.md) | 代码标准、发布门禁与 runtime profile 的 Integration Gate 契约（contract） | 待填充——归属 08-19-agent-platform-quality-gates（R2/R5/R6） |
| [日志指南](./logging-guidelines.md) | 结构化日志、日志级别 | 生效中 |
| [发布流水线](./release-pipeline.md) | 端到端验证 -> squash 合并 -> 无 registry 云端部署 -> 感知 schema 的回滚总览 | 生效中 |
| [部署环境契约](./deployment-environment-contracts.md) | local-dev/local-prod/cloud-prod 证据、Caddy 路由、直接镜像归档部署 | 生效中 |
| [Daemon 发布与租约契约](./daemon-release-and-lease-contracts.md) | Aura 发布指针、安装器恢复、显式回滚、感知租约的 Connect/Reconnect，以及单活跃 WS 租约强制（lease.revoked/4001） | 生效中 |
| [Runtime Slock 集成](./runtime-slock-integration.md) | 托管 runtime 身份、Slock CLI、本地代理、提供商，以及 ACP 兼容契约 | 生效中 |
| [事件投递契约](./event-delivery-contracts.md) | Activity/事件过滤、daemon 投递与 runtime token 安全契约 | 生效中 |
| [线程契约](./threading-contracts.md) | 单层线程（thread）API、摘要（summary）元数据、DM 展示与 daemon 线程事件 | 生效中 |
| [记忆契约](./memory-contracts.md) | 服务端持有的作用域（scope）记忆、提案审计、选择性上下文清单与任务恢复契约 | 生效中 |
| [稳定成员身份与频道上下文](./member-identity-channel-contracts.md) | 不可变 Name、单一归属 Server 的身份、Channel 引用、成员事件、提及、墓碑与 daemon 上下文 | 生效中 |

---

## 如何填充这些指南

对每个指南文件：

1. 记录项目的**实际约定**（不是理想状态）
2. 附上来自代码库的**代码示例**
3. 列出**禁止模式**及原因
4. 补充团队犯过的**常见错误**

目标是帮助 AI 助手和新成员理解你的项目如何运作。

---

**语言**：所有文档都应使用**英文**撰写。
