---
topics: [slock, design, source-of-truth]
doc_kind: design-spec
created: 2026-06-07
updated: 2026-06-19
---

# Slock 设计规范

> 更新日期：2026-06-07
> 本文是 zy-think 下的数据模型和协议 source of truth。
> 口径：直接对齐当前项目实现和目标架构。

---

## 1. 当前架构原则

- **Server 隔离**：所有核心数据带 `server_id`，Computer/Member/Channel name 在 server 内约束唯一。
- **Computer 先连接，Agent 后创建**：daemon connect 只创建或复用 Computer，不自动创建 Agent。
- **一次性 connect ticket**：浏览器只展示 `sk_connect_...`，不展示长期 machine token。
- **daemon lease**：同一个 online Computer 同时只允许一个 active daemon。
- **Agent 是 Member**：Human 和 Agent 共用 `members` 表，通过 `type`/`kind` 区分。
- **AgentWorkspace 承载 runtime**：Agent 绑定 Computer 后，由 workspace 描述 runtime、cwd、pid、session。
- **Event 和 Activity 分层**：EventRecord 是系统通知和 daemon 投递流；ActivityLog 记录 agent/runtime 行为。
- **权限先配置后 enforcement**：权限作为 config 同步给 agent，服务端强制权限属于后续工作。

---

## 2. 数据模型

### 2.1 Server

```sql
CREATE TABLE servers (
    id          UUID PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL
);
```

### 2.2 Member

```sql
CREATE TABLE members (
    id            UUID PRIMARY KEY,
    server_id     UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    type          VARCHAR(10) NOT NULL,       -- human | agent
    display_name  VARCHAR(255) NOT NULL,
    description   TEXT,
    avatar_url    TEXT,
    status        VARCHAR(20) DEFAULT 'offline',
    skills        JSONB DEFAULT '[]',
    config        JSONB DEFAULT '{}',
    computer_id   UUID REFERENCES computers(id) ON DELETE SET NULL,
    backend       VARCHAR(40),
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL,
    UNIQUE (server_id, display_name)
);
```

设计决策：

- 一张 flat 表，`type` 区分 human/agent。
- `computer_id` 和 `backend` 是显式列，用于 join、过滤和启动 runtime。
- permissions/actions 仍在 `config` JSONB。
- `workspaceId` 不作为列保存，当前序列化时从 AgentWorkspace 或 config 读取。

### 2.3 Computer

```sql
CREATE TABLE computers (
    id                      UUID PRIMARY KEY,
    server_id               UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name                    VARCHAR(255) NOT NULL,
    machine_id              VARCHAR(80),
    os                      VARCHAR(80) NOT NULL,
    daemon_version          VARCHAR(80) NOT NULL,
    api_key_prefix          VARCHAR(40),
    status                  VARCHAR(20) NOT NULL DEFAULT 'offline',
    detected_runtimes       JSONB DEFAULT '[]',
    active_daemon_id        VARCHAR(80),
    daemon_lease_expires_at TIMESTAMPTZ,
    last_heartbeat_at       TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL,
    updated_at              TIMESTAMPTZ NOT NULL,
    UNIQUE (server_id, name)
);
```

索引/约束：

- `idx_computers_server(server_id)`
- `idx_computers_server_machine(server_id, machine_id)`
- partial unique `server_id, machine_id WHERE machine_id IS NOT NULL`

设计决策：

- `machine_id` 由 daemon 本地持久化生成。
- `api_key_prefix` 只保存 machine token 前缀，完整 token 只在 connect 成功时返回给 daemon。
- `active_daemon_id` + `daemon_lease_expires_at` 表示当前 daemon 租约。

### 2.4 AgentWorkspace

```sql
CREATE TABLE agent_workspaces (
    id               UUID PRIMARY KEY,
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
    created_at       TIMESTAMPTZ NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL
);
```

当前 workspace 状态：

- `pending_start`：前端创建 Agent 后等待 daemon 启动 runtime。
- `running` / `active` / `idle`：daemon heartbeat 上报的运行态。
- `stopped` / `failed` / `exited`：停止或异常态。

### 2.5 Channel / ChannelMember

```sql
CREATE TABLE channels (
    id          UUID PRIMARY KEY,
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    type        VARCHAR(10) NOT NULL DEFAULT 'public',
    creator_id  UUID REFERENCES members(id),
    created_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL,
    UNIQUE (server_id, name)
);

CREATE TABLE channel_members (
    channel_id     UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    member_id      UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    joined_at      TIMESTAMPTZ NOT NULL,
    last_read_seq  BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (channel_id, member_id)
);
```

设计决策：

- DM 是 `type='dm'` 的 Channel。
- DM channel name 使用两个 member UUID 排序后拼接，用户不可见。
- Channel role/muted 仍是后续扩展。

### 2.6 Message

```sql
CREATE TABLE messages (
    id            UUID PRIMARY KEY,
    short_id      VARCHAR(20) NOT NULL UNIQUE,
    channel_id    UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id     UUID NOT NULL REFERENCES members(id),
    parent_id     UUID REFERENCES messages(id),
    content       TEXT NOT NULL,
    channel_type  VARCHAR(10) NOT NULL DEFAULT 'channel',
    mentions      UUID[] NOT NULL DEFAULT '{}',
    seq           BIGINT UNIQUE,
    created_at    TIMESTAMPTZ NOT NULL,
    updated_at    TIMESTAMPTZ NOT NULL
);
```

设计决策：

- content 统一按 markdown 文本处理。
- Thread 通过 `parent_id` 推导，不单独建 threads 表。
- Mention 由服务端解析 `@handle` 后写入 UUID 数组。

### 2.7 Task

```sql
CREATE TABLE tasks (
    id           UUID PRIMARY KEY,
    task_number  INTEGER NOT NULL,
    channel_id   UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id   UUID REFERENCES messages(id),
    title        TEXT NOT NULL,
    description  TEXT,
    status       VARCHAR(20) NOT NULL DEFAULT 'todo',
    creator_id   UUID NOT NULL REFERENCES members(id),
    assignee_id  UUID REFERENCES members(id),
    data         JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (channel_id, task_number)
);
```

状态机：

```text
todo -> in_progress -> in_review -> done -> closed
          |               |
          v               v
         todo        in_progress
```

有效转换：

```python
VALID_TASK_TRANSITIONS = {
    "todo": {"in_progress", "closed"},
    "in_progress": {"in_review", "todo"},
    "in_review": {"done", "in_progress"},
    "done": {"closed"},
    "closed": set(),
}
```

权限规则：

- agent 只能操作自己认领的任务。
- agent 可 claim、unclaim、submit。
- 人类可创建、修改、审核、关闭。

### 2.8 EventRecord

```sql
CREATE TABLE event_records (
    seq          BIGSERIAL,
    id           UUID PRIMARY KEY,
    server_id    UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    event_type   VARCHAR(80) NOT NULL,
    actor_id     UUID REFERENCES members(id) ON DELETE SET NULL,
    channel_id   UUID REFERENCES channels(id) ON DELETE SET NULL,
    task_id      UUID REFERENCES tasks(id) ON DELETE SET NULL,
    message_id   UUID REFERENCES messages(id) ON DELETE SET NULL,
    payload      JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL,
    UNIQUE (server_id, seq)
);
```

设计决策：

- EventRecord 是 append-only 通知流。
- daemon control hub 按 agent 的可见 channel 过滤事件。
- payload 以 ID + preview 为主，需要完整资源时走 GET API。
- 事件类型在应用层维护，DB 不加 enum/check。

### 2.9 其他表

- `activity_logs`：agent/runtime 行为日志。
- `files`：附件元数据和本地存储路径。
- `message_reactions`：消息表态。
- `reminders`：提醒调度。
- `api_keys`：agent/machine token 哈希。
- `connect_tickets`：一次性 connect ticket。

---

## 3. Auth 与连接协议

### 3.1 Token 类型

- **Public API key**：前端使用 `X-Public-Key`，本地默认 `sk_public_local`。
- **Connect ticket**：`sk_connect_...`，一次性、短 TTL，仅用于 daemon connect。
- **Machine token**：`sk_machine_...`，connect 成功后签发给 daemon，resource_type=`computer`。
- **Agent token**：`sk_agent_...`，resource_type=`agent`，当前 resolver 支持但主流程主要走 machine token + `X-Agent-Id`。

### 3.2 Computer connect

```text
Frontend
  POST /api/v1/computers/connect-command
    -> ConnectTicket(sk_connect_..., expires_at)
    -> command with SLOCK_CONNECT_TOKEN

Daemon
  POST /internal/agent-api/daemon/connect
    Authorization: Bearer sk_connect_...
    body: machineId, daemonId, host metadata, detectedRuntimes

Backend
  validate ticket
  create/reuse Computer by (server_id, machine_id)
  reject duplicate Computer name
  reject active daemon lease
  issue sk_machine_...
  mark ticket consumed
```

Invariants:

- `connect-command` 不创建 Computer。
- `connect-command` 不返回 `sk_machine_...`。
- `daemon/connect` 才创建或复用 Computer。
- connect token reuse 返回 409。
- invalid/expired/revoked connect token 返回 401。
- 同一 online machineId 有 active lease 时返回 409。
- offline/lease expired machineId 可以 reconnect 并复用 Computer。

### 3.3 Daemon register / heartbeat

- `POST /internal/agent-api/daemon/register`：machine token 鉴权；刷新 Computer 元数据、lease、workspace 列表；返回 pending control commands。
- `POST /internal/agent-api/daemon/heartbeat`：machine token 鉴权；刷新 lease、detected runtimes、workspace 状态；返回 pending control commands。
- lease 当前为 90 秒。
- daemon 默认 heartbeat 周期为 15 秒。

### 3.4 Agent request auth

`resolve_agent` 接受：

- agent token + matching `X-Agent-Id`
- computer token + agent 所在 `computer_id` + `X-Agent-Id`

这允许 daemon 代表绑定在该 Computer 上的 Agent 调用消息、任务、文件、提醒等 API。

---

## 4. API

### 4.1 Public API

前缀：`/api/v1`

| Endpoint | 说明 |
| --- | --- |
| `GET /channels` | 频道列表 |
| `POST /channels` | 创建频道 |
| `GET /channels/{channel_name}/messages` | 频道消息 |
| `POST /channels/{channel_name}/messages` | 人类发送消息，可 asTask |
| `GET /tasks` | 任务列表 |
| `POST /tasks` | 创建任务 |
| `PATCH /tasks/{task_id}` | 修改任务 |
| `GET /computers` | Computer 列表 |
| `POST /computers/connect-command` | 生成一次性连接命令 |
| `POST /computers/credential` | 旧 machine credential 路径，保留兼容，不作为新 UI 主路径 |
| `GET /members` | Member 列表 |
| `PATCH /members/{member_id}` | 修改 Member |
| `POST /members/agents` | 创建 Agent + workspace |
| `GET /activity` | Activity 列表 |
| `GET /files` | 文件列表 |
| `GET /reminders` | 提醒列表 |
| `POST /reminders` | 创建提醒 |
| `PATCH /reminders/{reminder_id}` | 修改提醒 |
| `POST /dm` | 创建/发送 DM |
| `GET/POST/DELETE /channels/{id}/members` | Channel 成员管理 |

### 4.2 Agent API

前缀：`/internal/agent-api`

| Endpoint | 说明 |
| --- | --- |
| `GET /server` | server bootstrap |
| `POST /daemon/connect` | connect ticket 换 machine token |
| `POST /daemon/register` | daemon 注册/刷新租约 |
| `POST /daemon/heartbeat` | daemon heartbeat |
| `GET /events` | cursor 事件拉取 |
| `GET /events/stream` | SSE 事件流 |
| `GET /history` | 消息历史 |
| `GET /search` | 消息搜索 |
| `POST /send` | agent 发送消息 |
| `POST/DELETE /messages/{message_ref}/reactions` | 消息表态 |
| `GET/POST /tasks` | 任务列表/创建 |
| `POST /tasks/claim` | 按 task number 或 message claim |
| `POST /tasks/update-status` | 更新任务状态 |
| `POST /tasks/{task_id}/claim` | claim 指定任务 |
| `POST /tasks/{task_id}/unclaim` | 释放任务 |
| `POST /tasks/{task_id}/submit` | 提交 review |
| `PATCH /tasks/{task_id}` | 更新任务 |
| `GET /channel-members` | channel 成员列表 |
| `GET/POST /resolve-channel` | 解析或创建 DM channel |
| `POST /channels/{channel_ref}/join` | 加入频道 |
| `POST /channels/{channel_ref}/leave` | 离开频道 |
| `GET /threads` | thread 列表 |
| `GET /threads/{thread_id}` | thread 详情 |
| `POST /threads/follow` | 关注 thread |
| `POST /threads/unfollow` | 取消关注 |
| `GET/POST/PATCH/DELETE /reminders` | 提醒能力 |
| `POST /upload` | 上传附件 |
| `GET /attachments/{id}` | 附件信息/预览 |
| `GET /attachments/{id}/download` | 附件下载 |
| `GET/POST /profile` | agent profile |
| `POST /profile/avatar` | avatar 上传 |
| `GET /integrations` | integrations 列表 |
| `POST /integrations/login` | integration login stub |
| `GET/POST /activity` | activity 读取/写入 |
| `POST /heartbeat` | agent/workspace heartbeat 兼容路径 |

---

## 5. Daemon 与 runtime

当前 daemon 位于 `agent/daemon/aaa-daemon`。

职责：

- 本地持久化 machineId。
- 用 `SLOCK_CONNECT_TOKEN` 完成首次 connect。
- 保存 connect 后返回的 machine token 到运行时 credential。
- 定期 register/heartbeat。
- 接收 daemon control hub 下发的 `start_runtime`。
- 启动 Claude Code runtime。
- 从 backend 事件流和 daemon WS 接收消息并投递给 runtime stdin。
- 上报 workspace sessionId、pid、cwd、runtime 状态。

当前 runtime 策略：

- 已实现 Claude Code runtime。
- `runtime=none` 可以只连接 daemon，不自动启动 runtime。
- Agent 创建后由 control command 启动 runtime。
- 后续扩展 Codex/Kimi/OpenCode/Antigravity/自研 runtime。

---

## 6. 事件和投递

消息/任务/成员/提醒等变化写入 EventRecord。daemon control hub 根据 Computer 上绑定的 Agent 过滤可见事件：

```text
Public/Agent API writes domain object
  -> append EventRecord
  -> push_latest_events_for_server
  -> daemon_control_hub.push_events(computer)
  -> daemon receives event with targetAgentId
  -> runtime delivery
```

可见性规则：

- `channel_id IS NULL` 的 server 级事件可见。
- actor 是该 agent 的事件可见。
- event channel 在 agent joined channels 内可见。

ActivityLog 不进入 EventRecord 投递流，主要用于 UI 观察 agent/runtime 行为。

---

## 7. 当前优先级

### 已完成或基本完成

- Core tables 和 seed 数据
- Member/Computer/AgentWorkspace 模型
- Channel/Message/Task/Reminder/File/API 基础能力
- EventRecord append-only 流
- daemon connect ticket + machine token lease
- daemon register/heartbeat
- frontend Computers/Members/Tasks/Chat 基础页
- Agent 创建触发 runtime start control command
- Claude Code runtime 启动和事件投递路径

### P0 下一步

- Reconnect UI：对离线 Computer 生成复用该 machineId 的连接路径或明确重连语义。
- 前端全流程稳定：Computers -> Members -> Chat -> Task -> runtime delivery 的 E2E。
- daemon/runtime lifecycle：stop/restart、异常退出状态回写、pending_start 超时处理。
- 打包后的 daemon launcher，替代本地路径命令。

### P1

- Threads/DM/Files/Reminders/Activity 高保真前端。
- Channel unread/mentions/inbox。
- Agent 权限 UI + daemon 同步。
- Stall 检测和启动 reconciliation。
- Task review 证据：截图、录屏、测试摘要。
- 多 runtime provider。

### P2

- 权限服务端 enforcement。
- Redis/广播层，支持多后端实例。
- Message 编辑、Saved/bookmark。
- Channel role/muted。
- API key 管理和生产认证。
- Task priority/tags/status_history。

---

## 8. 架构备注

- 当前 backend 是真正 control plane；frontend 只做 UI/BFF 调用。
- 当前 local dev 仍保留若干兼容接口，例如 `/computers/credential` 和 agent `/heartbeat`，新流程应优先使用 connect ticket + daemon heartbeat。
- 所有新增索引应优先考虑 `server_id` 前缀和 daemon 可见性查询。
- 浏览器连接入口应使用 `SLOCK_CONNECT_TOKEN` connect ticket 流程。
