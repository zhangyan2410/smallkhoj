# Slock 设计规范 — 定稿

> 日期：2026-06-04
> 替代 `slock-backend-architecture.md`、`slock-detail-spec.md`、`slock-ui-interaction-design.md` 中的错误部分
> 原始文档保留作为参考，本文档为 source of truth

---

## 1. 数据模型

### 1.1 Server

```sql
CREATE TABLE servers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 1.2 Member（Human + Agent 统一）

```sql
CREATE TABLE members (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id     UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    type          VARCHAR(10) NOT NULL,               -- 'human' | 'agent'
    display_name  VARCHAR(255) NOT NULL,
    description   TEXT,
    avatar_url    TEXT,
    status        VARCHAR(20) DEFAULT 'offline',      -- online/offline/active/busy
    skills        JSONB DEFAULT '[]',
    config        JSONB DEFAULT '{}',                 -- permissions, actions 等
    computer_id   UUID REFERENCES computers(id) ON DELETE SET NULL,  -- agent 独有
    backend       VARCHAR(40),                        -- agent 独有: claude_code/deepseek/codex
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_members_server ON members(server_id);
```

**设计决策**：
- 一张 flat 表 + `type` 列区分 human/agent
- `computer_id` 和 `backend` 是显式列（需要 FK + join + 过滤）
- `permissions`/`actions` 保留在 `config` JSONB（配置数据，不需要 DB 级约束）
- `workspaceId` 不存（从 AgentWorkspace 表反查 `WHERE agent_id = ?`）
- **权限不做服务器端 enforcement**：权限是配置数据，daemon 同步，agent 自限，默认全开

### 1.3 Computer & AgentWorkspace

```sql
CREATE TABLE computers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id         UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name              VARCHAR(255) NOT NULL,
    os                VARCHAR(80) NOT NULL,
    daemon_version    VARCHAR(80) NOT NULL,
    api_key_prefix    VARCHAR(40),
    status            VARCHAR(20) DEFAULT 'offline',
    detected_runtimes JSONB DEFAULT '[]',
    last_heartbeat_at TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_workspaces (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    computer_id      UUID NOT NULL REFERENCES computers(id) ON DELETE CASCADE,
    agent_id         UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    runtime          VARCHAR(40) NOT NULL DEFAULT 'claude_code',
    runtime_command  TEXT,
    runtime_model    VARCHAR(120),
    status           VARCHAR(20) NOT NULL DEFAULT 'stopped',
    session_id       VARCHAR(255),
    cwd              TEXT,
    pid              INTEGER,
    started_at       TIMESTAMPTZ,
    stopped_at       TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_workspaces_computer ON agent_workspaces(computer_id);
CREATE INDEX idx_agent_workspaces_agent ON agent_workspaces(agent_id);
```

### 1.4 Channel & ChannelMember

```sql
CREATE TABLE channels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    type        VARCHAR(10) NOT NULL DEFAULT 'public',  -- public | private | dm
    creator_id  UUID REFERENCES members(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (server_id, name)
);

CREATE TABLE channel_members (
    channel_id     UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    member_id      UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    joined_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_seq  BIGINT DEFAULT 0,            -- 未读计数基础
    PRIMARY KEY (channel_id, member_id)
);

CREATE INDEX idx_channels_server ON channels(server_id);
```

**设计决策**：
- DM 是 `type='dm'` 的 channel，两个 ChannelMember，不加 DMChannel 独立结构
- DM channel name：`dm:{min(uuid1,uuid2)}-{max(uuid1,uuid2)}`（不暴露给用户）
- `last_read_seq`：未读计数 = `max(messages.seq) - last_read_seq`
- `role`（admin/member/guest）和 `muted` P2 再加

### 1.5 Message

```sql
CREATE TABLE messages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_id      VARCHAR(20) NOT NULL UNIQUE,
    channel_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id     UUID NOT NULL REFERENCES members(id),
    parent_id     UUID REFERENCES messages(id),         -- thread: 指向原始消息
    content       TEXT NOT NULL,                         -- 统一 markdown（纯文本是 markdown 子集）
    channel_type  VARCHAR(10) NOT NULL DEFAULT 'channel', -- channel | dm | thread
    mentions      UUID[] DEFAULT '{}',                   -- 结构化 @mention（解析 @xxx 写入）
    seq           BIGSERIAL UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_channel ON messages(channel_id, created_at);
CREATE INDEX idx_messages_seq ON messages(seq);
CREATE INDEX idx_messages_parent ON messages(parent_id) WHERE parent_id IS NOT NULL;
```

**设计决策**：
- **不加 contentType 字段**：所有 content 统一是 markdown，前端永远按 markdown 渲染
- **不加 threads 表**：Thread 是虚拟的，从 `parent_id` 推导（reply_count = COUNT, participants = DISTINCT sender_id）
- `mentions`：服务端解析 `@xxx` → 查 member → 写入 UUID 数组。thread reply 推给 @mention 的人
- **不做消息删除**：append-only。Saved/bookmark P2
- 消息编辑 P2 再加

### 1.6 Task

```sql
CREATE TABLE tasks (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_number  INTEGER NOT NULL,
    channel_id   UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id   UUID REFERENCES messages(id),
    title        TEXT NOT NULL,
    description  TEXT,
    status       VARCHAR(20) NOT NULL DEFAULT 'todo',  -- todo | in_progress | in_review | done | closed
    creator_id   UUID NOT NULL REFERENCES members(id),
    assignee_id  UUID REFERENCES members(id),
    data         JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (channel_id, task_number)
);

CREATE INDEX idx_tasks_channel ON tasks(channel_id, status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
```

**状态机**：

```
TODO ──claim──> IN_PROGRESS ──submit──> IN_REVIEW ──approve──> DONE ──close──> CLOSED
                   │                       │
                unclaim                  reject
                   │                       │
                   └───────────────────────┘
```

```python
VALID_TRANSITIONS = {
    "todo":        {"in_progress", "closed"},
    "in_progress": {"in_review", "todo"},          # todo = unclaim
    "in_review":   {"done", "in_progress"},         # in_progress = reject
    "done":        {"closed"},
    "closed":      set(),                           # 终态，不可变更
}
```

**权限规则**：
- agent 只能操作自己认领的任务（assignee == self）
- agent 可做的：claim（todo→in_progress）、unclaim（in_progress→todo）、submit（in_progress→in_review）
- 只有人类可以：关闭（任意→closed）、approve（in_review→done）、reject（in_review→in_progress）、改标题/描述
- closed 是终态

**行为规范（agent system prompt）**：
1. claim 后先在 task thread 发执行计划 → 人类可提前纠正
2. 完成后发证据（前端任务：截图/录屏 via webdriver；后端任务：文字摘要+测试结果）→ status → in_review

**P2 扩展**：
- `priority`、`tags`、`closedAt`/`closedBy`、`status_history JSONB`
- 录屏/截图 via webdriver
- 自动重试 + 指数退避（Symphony 启发）
- Stall 检测：daemon 监测 agent 5 分钟无输出 → 终止 → 释放任务
- 启动 reconciliation：后端启动时扫描 running workspace → 孤儿标记 stopped

### 1.7 Event Records

```sql
CREATE TABLE event_records (
    seq          BIGSERIAL,
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id    UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    event_type   VARCHAR(80) NOT NULL,
    actor_id     UUID REFERENCES members(id) ON DELETE SET NULL,
    channel_id   UUID REFERENCES channels(id) ON DELETE SET NULL,
    task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
    message_id   UUID REFERENCES messages(id) ON DELETE SET NULL,
    payload      JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (server_id, seq)
);

CREATE INDEX idx_event_records_server_seq ON event_records(server_id, seq);
CREATE INDEX idx_event_records_server_channel_seq ON event_records(server_id, channel_id, seq) WHERE channel_id IS NOT NULL;
CREATE INDEX idx_event_records_server_actor_seq ON event_records(server_id, actor_id, seq) WHERE actor_id IS NOT NULL;
CREATE INDEX idx_event_records_server_type_seq ON event_records(server_id, event_type, seq);
CREATE INDEX idx_event_records_created ON event_records(server_id, created_at DESC);
CREATE INDEX idx_event_records_message ON event_records(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX idx_event_records_task ON event_records(task_id) WHERE task_id IS NOT NULL;
```

**设计决策**（详见 event-design-fix.md）：
- per-server seq（BIGSERIAL + UNIQUE(server_id, seq)），id 做 PK
- **通知模式**：event payload 只给 ID + preview，客户端按需 GET 拉取
- **无 recipient 字段**：dispatcher 层 visibility 过滤
- **SSE ack P2 不做**：SSE Last-Event-ID + cursor 够用
- **平铺 envelope**：`{id, type, seq, timestamp, payload}`
- **Plain JSON**：删 JSON-RPC
- **Event ≠ Activity**：彻底解耦。activity 不入 event 流。L1/L2/L3 状态分层
- **Activity 数据流**：daemon tap → server 内存 buffer（~50条/agent FIFO 不存DB）→ client

### 1.8 其他表

**FileEntry**、**MessageReaction**、**Reminder**、**ApiKey**：保持当前设计不变。

**删除**：`activity_logs` 表、`event_records.activity_id` 列。

---

## 2. Auth

双 token 路径：
- **Agent token**（`sk_agent_xxx`）：agent 自己的 key，`resource_type=agent`
- **Machine token**（`sk_machine_xxx`）：computer 级别的 key，`resource_type=computer`

`resolve_agent` 接受两种 token（agent key 或 agent 所在 computer 的 key）。
`resolve_machine` 只接受 computer token。

---

## 3. API

### 3.1 Worker API（daemon/agent 用）

前缀：`/internal/agent-api/`

| Endpoint | 说明 |
|----------|------|
| `GET /events` | SSE 流 + 历史拉取（cursor-based） |
| `POST /daemon/register` | daemon 注册（machine token） |
| `POST /daemon/heartbeat` | daemon 心跳 |
| `POST /messages` | 发消息（支持 channel/DM/thread） |
| `GET /messages` | 读消息历史 |
| `POST /tasks/create` | 创建任务 |
| `POST /tasks/claim` | 认领任务 |
| `POST /tasks/unclaim` | 释放任务（新增） |
| `POST /tasks/update-status` | 更新任务状态（加转换校验） |
| `GET /tasks` | 列出任务 |
| `POST /message/react` | 消息表态 |
| `POST /reminders/schedule` | 调度提醒 |
| `GET /reminders` | 列出提醒 |

### 3.2 Supervisor API（人类/前端用）

前缀：`/api/v1/`

| Endpoint | 说明 |
|----------|------|
| `GET /servers` | 服务器信息 |
| `GET /members` | 统一成员列表（human+agent） |
| `GET /computers` | 已注册机器列表 |
| `GET /channels` | 频道列表 |
| `POST /channels` | 创建频道 |
| `POST /channels/:id/messages` | 发消息（支持 asTask） |
| `GET /channels/:id/messages` | 频道消息历史 |
| `PUT /members/:id/permissions` | 更新 agent 权限 |
| `PUT /members/:id/actions` | 控制 agent 启停 |

---

## 4. Agent 消息投递

逐条投递，daemon 监听 agent 状态：

```
daemon 收到 SSE event（新消息）
  ↓
判断 agent 当前状态（通过 stream-json）
  ↓
idle     → 立即注入这条消息（完整内容）
busy     → 排队等待
urgent   → 发 [STOP] 信号，agent 在下一个自然停顿点停止
  ↓
agent 回到 idle → 逐条注入队列里的消息
```

agent 状态（daemon 从 stream-json 推导）：

| 状态 | 信号 | 处理 |
|------|------|------|
| idle | 等待 stdin 输入 | 立即注入 |
| thinking | `type: "thinking"` | 不打断 |
| tool_executing | `type: "tool_use"` + 等 result | 不打断 |
| responding | `type: "text"` | 不打断 |

---

## 5. EventType Enum

```python
class EventType(str, Enum):
    MESSAGE_CREATED = "message.created"
    MESSAGE_UPDATED = "message.updated"
    MESSAGE_DELETED = "message.deleted"
    MESSAGE_REACTION = "message.reaction"
    TASK_CREATED = "task.created"
    TASK_CLAIMED = "task.claimed"
    TASK_UPDATED = "task.updated"
    TASK_CLOSED = "task.closed"
    MEMBER_JOINED = "member.joined"
    MEMBER_LEFT = "member.left"
    MEMBER_STATUS_CHANGED = "member.status_changed"
    MEMBER_PROFILE_UPDATED = "member.profile_updated"
    CHANNEL_CREATED = "channel.created"
    CHANNEL_MEMBER_JOINED = "channel.member_joined"
    CHANNEL_MEMBER_LEFT = "channel.member_left"
    FILE_UPLOADED = "file.uploaded"
    REMINDER_FIRED = "reminder.fired"
    CONNECTION_ESTABLISHED = "connection.established"
    CONNECTION_LOST = "connection.lost"
    AGENT_STARTED = "agent.started"
    AGENT_STOPPED = "agent.stopped"
    COMPUTER_CONNECTED = "computer.connected"
    COMPUTER_DISCONNECTED = "computer.disconnected"
    ERROR = "error"
```

应用层 enum，DB 存 VARCHAR(80)，不加 SQL CHECK。

---

## 6. 可见性规则

**Event 可见性**：
- `X.channel_id IN agent.joinedChannels`
- OR `X.actor_id == agent.id`
- OR `X.channel_id IS NULL`（server 级事件）

**Thread visibility**：
- thread reply 推给 thread 参与者（DISTINCT sender_id）+ 本条 @mention 的人
- channel 成员只看 reply count 徽标，点击才加载

---

## 7. 优先级汇总

### P0（先做）
- per-server seq + EventType enum（event 系统）
- Event ≠ Activity 解耦（删 ACTIVITY_EVENT_TYPES）
- 通知模式 payload

### P1（紧接着）
- Member 拆列（computer_id, backend）
- Task 状态机校验 + unclaim endpoint
- Message mentions 列 + 服务端解析
- ChannelMember last_read_seq
- SSE 实时推送改造（基于 event-design-fix.md）
- Agent 状态感知投递（daemon 层）
- Stall 检测（daemon 层）
- 启动 reconciliation

### P2（后续）
- Redis 缓存层
- SSE ack（可观测性）
- 权限 enforcement
- Task 录屏/截图（webdriver）
- Task 扩展字段（priority, tags, status_history）
- Saved/bookmark
- 消息编辑
- ChannelMember role/muted
- 自动重试 + 指数退避

---

## 8. 架构备注

- **PG 14+** 推荐（部分索引 + IN() 查询优化）
- **Redis P1 加**：P0 纯 PG，P1 加 Redis 做缓存层
- **所有索引带 server_id 前缀**（daemon 不跨 server）
- **Daemon 是 relay 不是 renderer**：接收 SSE → 转发给 agent stdin
