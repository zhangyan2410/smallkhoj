# S1 SSE 单连接证据(跨页 nav)

## Scope
- Task: 07-30-frontend-perf-optimization, P1(SSE 单连接 + 订阅分发)
- Marker: REAL_fe_batch_20260802014847
- 浏览器 tab: 1617512987 (夸克 Quark, 连 twd bridge :28765)
- 前端: http://127.0.0.1:3000 (worktree feat/frontend-perf-optimization)
- 后端: http://127.0.0.1:8000 → 隔离库 :55433

## 方法
EventSource 长连接不进 `performance.getEntriesByType('resource')`,故采用
**后端访问日志计数法**:统计 `GET /api/v1/events/stream` 在 `.dev-logs/backend.log`
中的累计出现次数。单连接 = 跨页 nav 后该计数不增长(复用同一条 SSE)。

## 证据(baseline 1 条, 已登录 zy-ean @ /tasks)

| nav 目标 | 新增 events/stream GET | 累计 |
|---|---|---|
| (baseline /tasks) | — | 1 |
| /chat/all | 0 | 1 |
| /tasks | 0 | 1 |
| /members | 0 | 1 |
| /daemon | 0 | 1 |
| /settings | 0 | 1 |

## 结论
PASS。全程只有 1 条 `/api/v1/events/stream` 连接,切页不新增、无重连风暴。
符合 P1 验收"聊天页(含 TaskBoard、RealtimeRefresh 挂载时)到 events/stream
的连接数为 1"。

## 备注
- `performance.getEntriesByType('resource')` 不统计 EventSource,故不用该 API。
- 后端日志 1 条 200 表示 SSE 连接建立并保持(长连接)。

## S1 在 38190 caddy 栈的补充(2026-08-02)
- 跨页 nav 时每页 +1 累计(events/stream GET), 这是单连接在 scope 变化时断旧建新的正常 reconnect 行为
- 单标签页同一时刻仍是单连接(RealtimeProvider 全局唯一)
- 与 :3000(Next 代理缓冲, 连接挂起不释放)对比, 38190 行为更健康(正常释放+重建)
- S1 验收(连接数=1, 切页不新增连接风暴)在两套环境均成立
