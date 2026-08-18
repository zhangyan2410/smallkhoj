# 前端开发指南

> 本项目前端开发的最佳实践。

---

## 概览

本目录包含前端开发指南（guide）。请用你项目的具体约定填充每个文件。

---

## 指南索引

| 指南 | 描述 | 状态 |
|-------|-------------|--------|
| [目录结构](./directory-structure.md) | 三层模型、导入规则、新代码放哪里 | 生效中 |
| [组件指南](./component-guidelines.md) | 三层组件模型、单一来源规则、禁止模式 | 生效中 |
| [产品 UI 风格](./product-ui-style.md) | 干纸实物桌面标识、手工墨边语言、主题系统、颜色 token | 生效中 |
| [Hook 指南](./hook-guidelines.md) | SSR 安全的 hook、可复用客户端行为、路由局部 context | 生效中 |
| [状态管理](./state-management.md) | 服务端状态、URL 状态、局部 UI 状态、持久偏好 | 生效中 |
| [质量指南](./quality-guidelines.md) | 代码标准、禁止模式、浏览器证据门禁 | 生效中 |
| [类型安全（type-safety）](./type-safety.md) | API 类型、边界规范化、禁止的类型模式 | 生效中 |
| [认证（auth）接入（onboarding）契约（contract）](./auth-onboarding-contracts.md) | Better Auth 注册/登录、邮箱验证策略、提供商/环境变量门禁 | 生效中 |
| [成员身份 UI 契约](./member-identity-ui-contracts.md) | 中文优先的 Name/Description UI、Channel 建议、UUID 定向与安全的 Agent 移除 | 生效中 |

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
