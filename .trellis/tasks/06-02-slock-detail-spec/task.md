# Slock 具体细节规范文档

## 目标
基于 UI 交互设计和后端架构分析，输出 Slock 各模块的详细技术规范，作为重构 MVP 的实施依据。

## 依赖
- `06-02-slock-backend-analysis` — 后端结构分析文档

## 输入
- `zy-think/archived/_archived-slock-ui-interaction-design.md` — UI 交互设计
- `zy-think/archived/_archived-slock-backend-architecture.md` — 后端架构分析（上一步产出）

## 产出
- 文档路径：`zy-think/archived/_archived-slock-detail-spec.md`
- 内容包括：
  1. 每个 UI 模块对应的后端数据结构（TypeScript interface）
  2. API 端点规范（请求/响应格式）
  3. WebSocket 事件协议
  4. 权限模型细节
  5. Task 状态机完整定义
  6. Message / Thread 数据结构
  7. Daemon 注册和心跳协议

## 状态
- [x] 已完成 — 文档已输出到 `zy-think/archived/_archived-slock-detail-spec.md`
