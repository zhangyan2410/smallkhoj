# Slock 后端结构分析

## 目标
分析 Slock 现有 MVP 代码（daemon + frontend store + API routes），对照官方产品交互设计，梳理出后端应有的分层架构和数据模型，输出分析文档。

## 输入
- `zy-think/archived/_archived-slock-ui-interaction-design.md` — 官方 UI 交互设计整理
- `agent/daemon/aaa-daemon/src/` — Daemon TypeScript 源码
- `frontend/lib/daemon-store/index.ts` — MVP 内存 Store
- `frontend/app/internal/agent-api/` — MVP API routes

## 产出
- 文档路径：`zy-think/archived/_archived-slock-backend-architecture.md`
- 内容包括：
  1. 现有 MVP 架构分析（优缺点）
  2. 目标后端分层（Data Layer / Service Layer / API Layer / Event Layer）
  3. 数据库 Schema 设计建议（核心表：servers, computers, members, channels, messages, tasks, files, activity_logs）
  4. API 设计（RESTful 路由 + WebSocket 事件）
  5. 与现有 daemon 代码的对接点

## 状态
- [x] 已完成 — 文档已输出到 `zy-think/archived/_archived-slock-backend-architecture.md`
