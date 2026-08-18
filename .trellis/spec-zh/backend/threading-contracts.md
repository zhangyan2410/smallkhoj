# 线程契约

## 场景（scenario）：带 agent 摘要的单层线程

### 1. 作用域（scope）/ 触发条件

- 触发条件：前端聊天、公共 API、agent API、daemon 事件投递和持久化都参与线程（thread）行为。
- 线程是单层的。对回复的回复必须归并到根消息，存储 `messages.parent_id = <root_message_id>`。
- 线程摘要（summary）是 `thread_summaries` 中的元数据，不是普通聊天消息。

### 2. 签名

- 数据库：`messages.parent_id` 指向根消息；`thread_summaries.root_message_id` 唯一。
- 公共 API：
  - `GET /api/v1/channels/{channel}/messages?threadMode=roots`
  - `GET /api/v1/threads/{thread_id}`
  - 带可选 `threadId` 或 `parentId` 的 `POST /api/v1/channels/{channel}/messages`
  - `GET /api/v1/dms`
  - `POST /api/v1/dm`
- Agent API：
  - `GET /internal/agent-api/threads/{thread_id}`
  - `POST /internal/agent-api/threads/{thread_id}/summary`
- Daemon/CLI：
  - `thread.summary_requested` 事件通过 `payload.targetAgentId` 指向单个 agent。
  - 托管 runtime：`aura thread read --thread-id <id>`
  - 托管 runtime：`aura thread summary --thread-id <id> --summary <text>`
  - `slock` 和 `raft` 仍是兼容别名，但新生成的摘要请求不再宣传它们。

### 3. 契约（contract）

- 仅当 `threadMode=roots` 时，根时间线响应才只返回根消息；每个根消息可附带 `replyCount` 和 `threadSummary`。
- 线程详情响应返回 `{thread, replies, messages, replyCount, threadSummary}`。为向后兼容，`messages` 先包含根消息，再包含回复。
- 创建回复必须既接受根消息 id/短 id，也接受回复 id/短 id，然后一律按根 id 持久化。
- 摘要文本必须非空且最多 300 字符。
- 摘要请求事件必须包含 `targetAgentId`、`threadId`、`threadShortId`、`target`、`content`、`replyCount` 和 `summaryMaxChars`。
- 自动摘要调度保持保守：除非 `THREAD_SUMMARY_SCHEDULER_ENABLED=true` 否则禁用；每个 tick 只处理一小批；且不得对同一个未应答的 `replyCount` 重复请求摘要。只有在回复数发生变化、或已完成的摘要过时后，才允许再次自动请求。
- DM API 保留原始 `dm:...` 频道名用于路由，但为面向人的 UI 提供 `displayName` 和 `peer`。

### 4. 校验与错误矩阵

- CLI/API 读取缺少线程 id -> 参数非法或 HTTP 400。
- 未知线程 id/短 id -> HTTP 404。
- 摘要为空 -> HTTP 400。
- 摘要超过 300 字符 -> HTTP 400。
- 摘要写入者既不是被请求的 agent 也不是线程参与者 -> HTTP 403。
- 定向摘要事件被投递给任何非目标 runtime -> bug；按 `targetAgentId` 过滤。

### 5. 好/基线/坏案例

- 好：主时间线以 `threadMode=roots` 拉取，经 `GET /threads/{id}` 打开右侧面板，用 `threadId` 发表回复，并刷新根列表和面板。
- 基线：agent 收到 `thread.summary_requested` 后，用 `aura thread read` 读取线程，用 `aura thread summary` 写入元数据；它不发聊天消息。
- 基线：当 WS 连接缺少正数游标时，daemon 重启不会把旧的 `thread.summary_requested` 事件重放进 runtime 队列。
- 坏：在主频道时间线里渲染回复。
- 坏：把回复的 id 存为 `parent_id`，制造嵌套回复。
- 坏：在已有对端元数据时，把原始 `dm:uuid-uuid` 当作 DM 主标题显示。
- 坏：每个调度间隔或每次 daemon 重启，都重试同一个线程/回复数的未应答摘要请求。

### 6. 必需测试

- 后端/API：仅根时间线包含 `replyCount` 和 `threadSummary`；线程详情区分 `thread` 与 `replies`；摘要写入拒绝空/超长/非参与者写入。
- daemon：CLI/代理/JSON-RPC 把 `thread.read` 和 `thread.summary` 路由到规范的 agent API 端点。
- runtime 投递：`thread.summary_requested` 被归类为 runtime 事件，且只投递给 `targetAgentId`。
- runtime 投递：daemon WS 重连/首连回归覆盖历史 `thread.summary_requested` 行，确保没有显式正数游标时不会把它们推进模型队列。
- 浏览器 E2E：频道和 DM 的线程回复出现在线程面板而不是主时间线；DM 头部/侧栏使用对端显示名。

### 7. 错误 vs 正确

#### 错误

```python
# Creates nested threads when replying to a reply.
parent_id = reply_message.id
```

#### 正确

```python
# Single-level threads: all replies attach to the root.
parent_id = reply_message.parent_id or reply_message.id
```

#### 错误

```typescript
fetch(`/api/v1/channels/${channel}/messages?limit=50`)
```

#### 正确

```typescript
fetch(`/api/v1/channels/${channel}/messages?limit=50&threadMode=roots`)
```
