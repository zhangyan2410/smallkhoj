---
topics: [events, design, archived]
doc_kind: archived-note
created: 2026-06-04
updated: 2026-06-19
---

# Event 设计 — 定稿

> 日期：2026-06-04
> 状态：**已定稿**

---

## 修订项总览

| # | 主题 | 决定 | 优先级 |
|---|------|------|--------|
| 1 | per-server seq | BIGSERIAL + UNIQUE(server_id, seq)，id 做 PK | P0 |
| 2 | 事件类型命名 | `namespace.action`（`message.created`） | P1 |
| 2.5 | event_type 约束 | 不加 SQL CHECK，应用层 enum `.value` | P0 |
| 3 | payload 内联深度 | 通知模式：ID + preview，客户端按需 GET | P0 |
| 4 | 序列化格式 | Plain JSON，删 JSON-RPC | P1 |
| 5 | 传输层 | SSE 优先，WebSocket 后置 | P2 |
| 6 | EventEnvelope | 平铺 + 顶层 `id`，无 recipient 字段 | P1 |
| 7 | ack | P0 不做，P2 加（SSE Last-Event-ID + cursor 够用） | P2 |
| 8 | 投递过滤 | dispatcher 层 visibility 过滤，无 recipient 在 envelope | P1 |
| 9 | 事件可见性 | 自己 channel + 自己触发 + server 级 | P0 |
| 10 | thread reply | 参与者 + @mention，channel 成员只看 reply count | P1 |
| 11 | 字段映射 | DB `created_at` → 传输 `timestamp`（ISO8601） | P0 |
| 12 | Event ≠ Activity | 彻底解耦，activity 不入 event 流 | P0 |
| 13 | Activity 数据流 | daemon tap → server 内存中继(~50条/agent FIFO) → client | P0 |

---

## DDL — 最终版

```sql
CREATE TABLE event_records (
    seq             BIGSERIAL,
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    event_type      VARCHAR(80) NOT NULL,
    actor_id        UUID REFERENCES members(id) ON DELETE SET NULL,
    channel_id      UUID REFERENCES channels(id) ON DELETE SET NULL,
    task_id         UUID REFERENCES tasks(id) ON DELETE SET NULL,
    message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (server_id, seq)
);

-- 增量拉取（核心索引）
CREATE INDEX idx_event_records_server_seq
    ON event_records (server_id, seq);

-- 可见性：server 内某 channel 事件流
CREATE INDEX idx_event_records_server_channel_seq
    ON event_records (server_id, channel_id, seq)
    WHERE channel_id IS NOT NULL;

-- 可见性：server 内某 agent 触发的事件
CREATE INDEX idx_event_records_server_actor_seq
    ON event_records (server_id, actor_id, seq)
    WHERE actor_id IS NOT NULL;

-- 按类型过滤
CREATE INDEX idx_event_records_server_type_seq
    ON event_records (server_id, event_type, seq);

-- 按时段
CREATE INDEX idx_event_records_created
    ON event_records (server_id, created_at DESC);

-- ref 查找
CREATE INDEX idx_event_records_message
    ON event_records (message_id)
    WHERE message_id IS NOT NULL;
CREATE INDEX idx_event_records_task
    ON event_records (task_id)
    WHERE task_id IS NOT NULL;
```

**删除**：`activity_logs` 表、`event_records.activity_id` 列。

---

## EventType enum（应用层）

```python
class EventType(str, Enum):
    # Message
    MESSAGE_CREATED = "message.created"
    MESSAGE_UPDATED = "message.updated"
    MESSAGE_DELETED = "message.deleted"
    MESSAGE_REACTION = "message.reaction"

    # Task
    TASK_CREATED = "task.created"
    TASK_CLAIMED = "task.claimed"
    TASK_UPDATED = "task.updated"
    TASK_CLOSED = "task.closed"

    # Member
    MEMBER_JOINED = "member.joined"
    MEMBER_LEFT = "member.left"
    MEMBER_STATUS_CHANGED = "member.status_changed"
    MEMBER_PROFILE_UPDATED = "member.profile_updated"

    # Channel
    CHANNEL_CREATED = "channel.created"
    CHANNEL_MEMBER_JOINED = "channel.member_joined"
    CHANNEL_MEMBER_LEFT = "channel.member_left"

    # File
    FILE_UPLOADED = "file.uploaded"
    FILE_DELETED = "file.deleted"

    # Reminder
    REMINDER_FIRED = "reminder.fired"

    # Connection
    CONNECTION_ESTABLISHED = "connection.established"
    CONNECTION_LOST = "connection.lost"

    # Agent
    AGENT_STARTED = "agent.started"
    AGENT_STOPPED = "agent.stopped"

    # Computer
    COMPUTER_CONNECTED = "computer.connected"
    COMPUTER_DISCONNECTED = "computer.disconnected"

    # Error
    ERROR = "error"
```

不进 event 流的（daemon 本地 / 审计用）：`command_executed`、`file_read/written`、`workspace_heartbeat`、`workspace_registered/updated`、`agent_activity`、`runtime_status_changed`。

---

## 设计决策

### #1 per-server seq

daemon 不跨 server。所有查询带 `server_id`。seq 在 server 范围内递增，`UNIQUE(server_id, seq)` 保证唯一。

### #3 通知模式

event payload 只给 ID + preview（内容前 N 字符）。daemon/web client 需要完整内容时 `GET /messages/{id}` 拉取。适用于人类短消息和 agent 长回复两个方向。

### #6/#8 平铺 + dispatcher 过滤

```typescript
interface ServerEvent {
  id: string;       // 事件 UUID
  type: string;     // EventType.value
  seq: number;      // per-server 递增
  timestamp: string; // ISO 8601
  payload: Record<string, unknown>;
}
```

无 `recipient` 字段。dispatcher 在 publish 时按 visibility 过滤。同一事件只持久化一次，按连接过滤推送。

### #7 SSE ack — P2

SSE `id:` 字段 + `eventLogCursor` query param + `Last-Event-ID` 重连 = 已覆盖断线恢复和去重。显式 ack（`POST /events/ack` + `event_acks` 表）只用于可观测性，P0 不做。

### #9 可见性

agent A 看到事件 X：
1. `X.channel_id IN A.joinedChannels`
2. OR `X.actor_id == A.id`
3. OR `X.channel_id IS NULL`（server 级事件：`member.status_changed`、`agent.started/stopped`、`computer.connected/disconnected`）

### #10 thread reply

- 事件类型仍为 `message.created`，payload 带 `threadId`
- recipients = thread 参与者（`SELECT DISTINCT sender_id FROM messages WHERE parent_id = ?`）+ 本条 @mention 的人
- channel 成员只看 parent message + reply count 徽标，点击才加载
- `message_mentions` 表后续再加，先实时解析 @mention

### #12 Event ≠ Activity — L1/L2/L3 分层

| 层级 | 内容 | 持久化 | 发 event？ |
|------|------|--------|-----------|
| L1 抽象状态 | `online`/`busy`/`offline` | `member.status` | 是 |
| L2 运行时 | runtime、cwd、workspace | ActivityLog（仅审计） | 否 |
| L3 会话细节 | session_id、pid、tokens | daemon 内存 | 否 |

删除 `ACTIVITY_EVENT_TYPES` 映射。业务代码需要时显式 `publish_event()`。

### #13 Activity 数据流

```
daemon ClaudeRuntimeDriver stream-json tap
  → server 内存 buffer（~50条/agent, FIFO, 不存DB）
  → client 多端展示（循环消息队列）
```

`activity_logs` 表删除。`event_records.activity_id` 删除。ActivityCollector 实现细节后续再定。

---

## 需要改的代码

**后端 `agent_api.py`**：
- 删 `ACTIVITY_EVENT_TYPES` 映射（L393）
- 删 `_record_activity()` 里的 EventRecord 创建（L695）
- 重写 `_event_record_event()` → notification 模式（ID + preview）
- 删 `event_records.activity_id` 相关序列化
- 事件类型重命名：`message_received` → `message.created` 等

**后端 `models/slock.py`**：
- `EventRecord` 删 `activity_id` 列和 relationship
- `Server` 删 `activity_logs` relationship
- `ActivityLog` 类整体删除（或保留但不再入库）

**`models/seed.py`**：
- 删 `ActivityLog` 引用和 seed 逻辑

**Daemon**：
- workspace_heartbeat 不再 POST
- L3 状态只在内存维护
- L1 状态变化才上报

---

## 架构备注

- **Redis P1 加**：P0 纯 PG，P1 加 Redis 做缓存层（recent messages、member 缓存、online status、SSE fan-out）
- **PG 版本**：建议 14+（部分索引 + `IN (...)` 查询优化）
- **索引原则**：所有索引带 `server_id` 前缀（daemon 不跨 server）
