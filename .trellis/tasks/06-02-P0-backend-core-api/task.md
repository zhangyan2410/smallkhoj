# P0: FastAPI 后端核心 API

## 目标
用 FastAPI + PostgreSQL 替代 `mvp-prototype/` 中的内存 DaemonStore，实现 daemon 能连接的最小 API 闭环。

## 依赖
- PostgreSQL 已在 `backend/config.py` 中配置（`postgresql+asyncpg`）
- 现有 FastAPI 骨架在 `backend/`

## 要实现的端点（6 个）

### 1. `GET /internal/agent-api/server`
- 返回 server info（channels、agents、humans）
- 参考 `mvp-prototype/internal/agent-api/server/route.ts`

### 2. `POST /internal/agent-api/send`
- 发送消息到 channel/DM
- 参数：target、content、seenUpToSeq
- 返回：state (sent/held)、messageSeq
- 参考 `mvp-prototype/internal/agent-api/send/route.ts`

### 3. `GET /internal/agent-api/events`
- 拉取事件（轮询模式，后续升级为 SSE/WS）
- 参数：since（seq）
- 返回：events 数组
- 参考 `mvp-prototype/internal/agent-api/events/route.ts`

### 4. `GET /internal/agent-api/history`
- 读取频道/DM 消息历史
- 参数：channel、limit、before、after
- 参考 `mvp-prototype/internal/agent-api/history/route.ts`

### 5. `POST /internal/agent-api/tasks/claim`
- 认领任务（乐观锁：`WHERE assignee_id IS NULL`）
- 参考 `mvp-prototype/internal/agent-api/tasks/claim/route.ts`

### 6. `POST /internal/agent-api/tasks/update-status`
- 更新任务状态（todo→in_progress→in_review→done）
- 参考 `mvp-prototype/internal/agent-api/tasks/update-status/route.ts`

## 认证
- 验证 `Authorization: Bearer {apiKey}` + `X-Agent-Id` 头
- MVP 阶段可用 seed data 中的 apiKey 验证

## 数据库核心表
- `servers` — 顶层隔离单元
- `channels` + `channel_members` — 频道
- `messages` — 消息（含 seq 自增）
- `tasks` — 任务（含 assignee、status）
- `members` — 统一 human/agent
- `api_keys` — API 认证

## 验收标准
- [ ] PostgreSQL 表创建成功
- [ ] 6 个端点可通过 curl/httpie 访问
- [ ] daemon 的 `serverUrl` 切到 `http://localhost:8000` 后能正常收发消息
- [ ] 用项目中的 webdriver（twd.py）做 e2e 真实测试验证
