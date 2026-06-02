# P1: 实时事件系统

## 目标
实现 WebSocket/SSE 实时推送，替代轮询 events 端点。

## 依赖
- `P0-backend-core-api` 完成

## 后端
- WebSocket endpoint `/ws` 或 SSE `/internal/agent-api/stream`
- 16 种事件类型（`message.created`, `task.claimed`, `task.updated` 等）
- Append-only event store
- daemon 的 WebSocket 连接到此端点

## 验收标准
- [ ] daemon 连接 WS 后能实时收到新消息
- [ ] 事件类型正确（message/task/channel 事件）
- [ ] 断线重连正常
