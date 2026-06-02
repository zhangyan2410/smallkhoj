# P1: Computer 实体 + 统一 Member 模型

## 目标
实现 Computer 注册流程和统一 Member 模型（human + agent），为权限系统打基础。

## 依赖
- `P0-backend-core-api` 完成

## 后端
- `POST /api/v1/computers/register` — daemon 启动时注册机器
- `GET /api/v1/members` — 统一列出 human + agent
- `members` 表使用 `kind: 'human' | 'agent'` 鉴别联合
- `computers` 表：hostname、os、agent_workspaces 关联

## 前端
- Computers 页面：展示已注册机器列表
- Members 页面：统一展示 human 和 agent

## 验收标准
- [ ] daemon 启动时自动注册 Computer
- [ ] Members API 返回统一的 human+agent 列表
- [ ] 前端展示 Computers 和 Members 页面
