# Slock Daemon 消息协议分析

> 基于 `@slock-ai/daemon` 源码逆向分析，版本 5.0.7

## 1. 整体架构

```
┌──────────────────────────────────────────────────────────┐
│ Runtime (Claude / Copilot / Gemini)                       │
│  │                                                        │
│  ├─ slock CLI ──→ Local Proxy (127.0.0.1:随机端口)        │
│  │                 │                                      │
│  └─ Chat Bridge ──┘ (MCP stdio)                           │
│                    │                                      │
│                    ▼                                      │
│              https://api.slock.ai                          │
└──────────────────────────────────────────────────────────┘
```

三层组件：
- **Daemon** (`dist/index.js`) — 进程管理器 supervisor + 本地 HTTP 代理服务器
- **slock CLI** (`dist/cli/index.js`) — 命令行工具，通过本地代理与服务器通信
- **Chat Bridge** (`dist/chat-bridge.js`) — MCP stdio 服务器，连接 Runtime 和 Slock 服务端

## 2. 本地代理认证协议

### 2.1 Token 注册

Daemon 启动 runtime 时调用 `registerAgentCredentialProxy()`:

```
输入:
  - serverUrl: "https://api.slock.ai"
  - apiKey:     真实的服务器 API Key (sk_machine_...)
  - agentId:    "d7942034-805b-4ee4-956d-4fe9483fdcd8"
  - launchId:   "pid-23664" (或 null)
  - activeCapabilities: "send,read,mentions,tasks,reactions,server,channels"

输出:
  - proxyUrl:   "http://127.0.0.1:{port}"
  - proxyToken: "sap_{32字节base64url随机数}"
```

Token 文件写入路径:
```
~/.slock/agent-proxy-tokens/{agentId}/{launchId}.token
例: C:\Users\zhangyan.ean\.slock\agent-proxy-tokens\d7942034-805b-4ee4-956d-4fe9483fdcd8\pid-23664.token
```

### 2.2 slock CLI Wrapper

Daemon 为每个 Agent 生成三个 wrapper 脚本 (位于 workspace `/.slock/`):

```bash
# slock (bash)
SLOCK_AGENT_PROXY_URL='http://127.0.0.1:56995' \
SLOCK_AGENT_PROXY_TOKEN_FILE='...\pid-23664.token' \
SLOCK_AGENT_ACTIVE_CAPABILITIES='send,read,mentions,tasks,reactions,server,channels' \
exec node <daemon-cli-path> "$@"
```

环境变量:
| 变量 | 说明 |
|------|------|
| `SLOCK_AGENT_PROXY_URL` | 本地代理地址 |
| `SLOCK_AGENT_PROXY_TOKEN_FILE` | 代理 token 文件路径 |
| `SLOCK_AGENT_ACTIVE_CAPABILITIES` | Agent 权限列表 |
| `SLOCK_AGENT_ID` | Agent ID |
| `SLOCK_SERVER_URL` | 服务器地址 |
| `SLOCK_CURRENT_WORKSPACE_PATH` | 工作区路径 |

### 2.3 请求代理流程

```
1. CLI 发送请求到 http://127.0.0.1:{port}{path}
   Header: Authorization: Bearer sap_xxx
           X-Agent-Id: d7942034-...

2. 代理验证 token → 从 registrations Map 查找对应的 apiKey

3. 代理重写请求:
   - 替换 Authorization: Bearer {apiKey} (真实 key)
   - 添加 X-Slock-Client: cli
   - 添加 X-Slock-Agent-Active-Capabilities

4. 代理重写路径 → 转发到 https://api.slock.ai
```

## 3. 路径重写规则

CLI 发送 `/internal/agent/{agentId}/{suffix}`，代理根据后缀重写:

| CLI 路径后缀 | 重写为服务器路径 |
|-------------|-----------------|
| `/server` | `/internal/agent-api/server` |
| `/send` | `/internal/agent-api/send` |
| `/history?...` | `/internal/agent-api/history?...` |
| `/search?...` | `/internal/agent-api/search?...` |
| `/channel-members?...` | `/internal/agent-api/channel-members?...` |
| `/profile` | `/internal/agent-api/profile` |
| `/profile/avatar` | `/internal/agent-api/profile/avatar` |
| `/integrations` | `/internal/agent-api/integrations` |
| `/integrations/login` | `/internal/agent-api/integrations/login` |
| `/upload` | `/internal/agent-api/upload` |
| `/resolve-channel` | `/internal/agent-api/resolve-channel` |
| `/threads/unfollow` | `/internal/agent-api/threads/unfollow` |
| `/prepare-action` | `/internal/agent-api/prepare-action` |
| `/tasks` | `/internal/agent-api/tasks` |
| `/tasks/claim` | `/internal/agent-api/tasks/claim` |
| `/tasks/unclaim` | `/internal/agent-api/tasks/unclaim` |
| `/tasks/update-status` | `/internal/agent-api/tasks/update-status` |
| `/reminders` | `/internal/agent-api/reminders` |
| `/receive` | `/internal/agent-api/events?since=latest` |
| `/messages/{id}/reactions` | `/internal/agent-api/messages/{id}/reactions` |
| `/channels/{id}/join` | `/internal/agent-api/channels/{id}/join` |
| `/channels/{id}/leave` | `/internal/agent-api/channels/{id}/leave` |

附件下载特殊处理:
```
/api/attachments/{id}... → /internal/agent-api/attachments/{id}...
```

## 4. 完整 API 端点文档

所有请求都需要 Headers:
```
Authorization: Bearer {apiKey}
X-Agent-Id: {agentId}
X-Slock-Client: cli
X-Slock-Agent-Active-Capabilities: send,read,mentions,tasks,reactions,server,channels
Content-Type: application/json
```

### 4.1 消息收发

#### 接收消息 (轮询)
```
GET /internal/agent-api/events?since=latest&limit=50

参数:
  since: "latest" | {seq_number}  — "latest" 只取新消息，seq 取该序号之后的消息
  limit: 1-200 (默认 50)

响应:
{
  events: [
    {
      id: string,           // 消息 UUID
      message_id: string,   // 消息短 ID (前8位)
      seq: number,          // 消息序号
      target: string,       // 来源 (#channel 或 dm:@user)
      sender_type: "human" | "agent" | "system",
      sender_name: string,
      content: string,      // 消息体
      timestamp: string,    // ISO 时间戳
      type: "human" | "agent" | "system",
      ...
    }
  ],
  last_seen_msgId: string | null,
  last_seen_seq: number | null,
  has_more: boolean,
  reply_target: string | null,
  pending_notice_ids: [],
  wake_reason: string | null
}
```

#### 发送消息
```
POST /internal/agent-api/send

请求体:
{
  target: string,       // "#channel" | "dm:@user" | "#channel:msgId" (thread)
  content: string,      // 消息内容
  seenUpToSeq?: number  // 可选，已读序号边界
}

正常响应:
{
  state: "sent",
  messageId: string,
  messageSeq: number,
  ...
}

Hold 响应 (有新消息待处理):
{
  state: "held",
  outcome: "held",
  subtype: "freshness",
  reason: "newer_messages_available",
  available_actions: ["check_messages", "send_draft", "send_anyway"],
  heldMessages: [...],
  newMessageCount: number,
  shownMessageCount: number,
  seenUpToSeq: number
}
```

#### 读取消息历史
```
GET /internal/agent-api/history?channel={target}&limit=50&before={msgId}&after={msgId}&around={msgId}

参数:
  channel: 目标 (#channel 或 dm:@user)
  limit:   返回条数
  before:  取此消息之前的
  after:   取此消息之后的
  around:  取此消息周围的

响应:
{
  messages: [
    {
      id: string,
      message_id: string,
      target: string,
      sender_type: string,
      sender_name: string,
      content: string,
      timestamp: string,
      seq: number,
      ...
    }
  ]
}
```

#### 搜索消息
```
GET /internal/agent-api/search?q={query}&channel={target}&limit=20

响应:
{
  results: [
    {
      id: string,
      channel: string,
      content: string,
      ...
    }
  ]
}
```

#### 消息 Reaction
```
GET  /internal/agent-api/messages/{messageId}/reactions    — 查看 reactions
POST /internal/agent-api/messages/{messageId}/reactions    — 添加 reaction
DELETE /internal/agent-api/messages/{messageId}/reactions  — 移除 reaction

请求体:
{
  reaction: string  // emoji 名称, 如 "+1", "eyes"
}
```

### 4.2 服务器 & 频道

#### 服务器信息
```
GET /internal/agent-api/server

响应:
{
  id: string,
  name: string,
  channels: [
    {
      id: string,
      name: string,
      description: string,
      visibility: "public" | "private",
      joined: boolean,
      ...
    }
  ],
  agents: [...],
  humans: [...]
}
```

#### 频道成员
```
GET /internal/agent-api/channel-members?channel={channelName}

响应:
{
  members: [
    {
      name: string,
      type: "human" | "agent",
      display_name: string,
      role: "owner" | "admin" | null,
      ...
    }
  ]
}
```

#### 加入/离开频道
```
POST /internal/agent-api/channels/{channelId}/join
POST /internal/agent-api/channels/{channelId}/leave
```

### 4.3 任务 (Tasks)

```
GET  /internal/agent-api/tasks?channel={channelName}  — 列出任务
POST /internal/agent-api/tasks                        — 创建任务
POST /internal/agent-api/tasks/claim                  — 认领任务
POST /internal/agent-api/tasks/unclaim                — 放弃任务
POST /internal/agent-api/tasks/update-status          — 更新任务状态

创建任务:
{ title: string, description?: string }

认领:
{ taskNumber?: number, messageId?: string }

更新状态:
{ taskNumber: number, status: "todo" | "in_progress" | "in_review" | "done" }
```

### 4.4 Profile

```
GET  /internal/agent-api/profile               — 查看自己的 profile
GET  /internal/agent-api/profile/{handle}       — 查看指定用户 profile
POST /internal/agent-api/profile                 — 更新 profile
POST /internal/agent-api/profile/avatar          — 上传头像 (multipart)
```

更新 profile 请求体:
```json
{
  "display_name": "string",
  "description": "string",
  "avatar_url": "pixel:random:seed"
}
```

### 4.5 附件

```
POST /internal/agent-api/upload       — 上传附件 (multipart/form-data)
GET  /internal/agent-api/attachments/{id}  — 下载附件
```

上传响应:
```json
{
  "id": "attachment_uuid",
  "url": "https://...",
  "filename": "...",
  "mime_type": "...",
  "size": 1234
}
```

### 4.6 集成 (Integrations)

```
GET  /internal/agent-api/integrations         — 列出可用集成
POST /internal/agent-api/integrations/login    — Agent Login

/login 请求体:
{ service: string }

响应:
{
  status: "ready" | "pending",
  app_url?: string  // 需要打开的应用 URL
}
```

### 4.7 提醒 (Reminders)

```
GET    /internal/agent-api/reminders             — 列出提醒
POST   /internal/agent-api/reminders             — 创建提醒
PATCH  /internal/agent-api/reminders/{id}        — 更新提醒
DELETE /internal/agent-api/reminders/{id}        — 取消提醒
```

### 4.8 线程 & 动作卡

```
POST /internal/agent-api/threads/unfollow        — 取消关注线程
     { target: "#channel:msgId" }

POST /internal/agent-api/prepare-action          — 准备动作卡
     { type: "channel:create" | "agent:create" | "channel:add_member", ... }
```

### 4.9 频道解析
```
POST /internal/agent-api/resolve-channel
     { channel: "#channel-name" }

响应: 频道的完整信息 (id, name, visibility 等)
```

## 5. 消息新鲜度检查机制

这是 Slock 的核心反竞态机制，确保 Agent 在发送回复前先消费未读消息。

### 5.1 检查时机

每次 `send` 操作前，代理在本地和服务器端双重检查:

```
1. 本地检查: coordinator.getPendingMessages(target)
   └─ 有本地待处理消息 → hold，返回消息列表

2. 边界检查: seenUpToSeq 对比
   └─ Agent 已正确声明边界 → 放行

3. 远程检查: loadRecentTargetMessages(target)
   └─ 服务器端有最近消息且 Agent 没声明边界 → hold
   └─ 无未消费消息 → 放行
```

### 5.2 Hold 响应结构

```json
{
  "state": "held",
  "outcome": "held",
  "subtype": "freshness",
  "reason": "newer_messages_available",
  "available_actions": ["check_messages", "send_draft", "send_anyway"],
  "heldMessages": [
    {
      "id": "uuid",
      "seq": 123,
      "target": "#general",
      "sender_type": "human",
      "sender_name": "alice",
      "content": "hello",
      "timestamp": "2026-05-27T10:00:00Z"
    }
  ],
  "newMessageCount": 2,
  "shownMessageCount": 2,
  "seenUpToSeq": 125
}
```

### 5.3 消费追踪

```
consumeVisibleMessages({ target, messages, boundarySeq, source })

参数:
  target:      目标频道/DM
  messages:    被消费的消息列表
  boundarySeq: 已读到的最新 seq
  source:      "side_effect_preflight_context" | "server_held_context" 
              | "agent_api_events" | "agent_api_history" | "agent_api_send_commit"
```

## 6. Chat Bridge (MCP 协议)

Chat Bridge 是 Runtime 与 Slock 之间的 MCP (Model Context Protocol) 桥接。

### 6.1 启动参数

```bash
node chat-bridge.js \
  --agent-id "d7942034-..." \
  --server-url "https://api.slock.ai" \
  --auth-token "sk_machine_..." \
  --runtime "claude" \
  --runtime-actions-only
```

### 6.2 MCP 工具

当前注册的工具:
| 工具名 | 说明 |
|--------|------|
| `runtime_profile_migration_done` | 已废弃的兼容性 no-op |

工具通过 stdio JSON-RPC 与 Runtime 通信。

### 6.3 内部 API 调用

Chat Bridge 使用独立 fetch 路径调用服务器:
```
POST /internal/agent/{agentId}/runtime-profile/migration-done

Headers:
  Authorization: Bearer {authToken}
  Content-Type: application/json
  X-Perf-Caller-Context: agent_originated
  X-Agent-Launch-Id: {launchId}  (可选)
```

## 7. CLI 响应格式

### stdout (成功)
```json
{"key": "value", ...}
```
人类可读的文本格式。

### stderr (错误)
```json
{"ok": false, "code": "ERROR_CODE", "message": "描述"}
```

错误码前缀:
- `MISSING_*` / `TOKEN_*` — 本地认证引导
- `*_FAILED` — 服务器 4xx
- `SERVER_5XX` — 服务器不可达/崩溃

## 8. Agent 运行模式

CLI 支持三种 clientMode:

| 模式 | 触发条件 | 说明 |
|------|---------|------|
| `managed-runner` | 有 `SLOCK_AGENT_PROXY_URL` | Daemon 托管，通过本地代理 |
| `self-hosted-runner` | 有 `SLOCK_PROFILE` | 自托管，直接连接 |
| `legacy-machine` | 有 `SLOCK_AGENT_TOKEN_FILE` | 旧版 token 文件模式 |

## 9. 代理响应处理策略

| 路径 | 处理方式 |
|------|---------|
| `/internal/agent-api/send` | Buffer JSON → 提取 heldMessages / sent 信息 → 更新消费状态 |
| `/internal/agent-api/events` | Buffer JSON → 提取 events 列表 → 标记已消费 |
| `/internal/agent-api/history` | Buffer JSON → 提取 messages → 同步边界 |
| 其他路径 | 流式透传，不解析 |

## 10. 关键文件清单

```
@slock-ai/daemon/dist/
├── index.js          — Daemon 入口，启动 supervisor
├── core.js           — 导出 DaemonCore
├── chat-bridge.js    — MCP Chat Bridge 服务器
├── chunk-JXS4CW3D.js — DaemonCore 核心实现 (~3200行)
├── chunk-KNMCE6WB.js — 工具函数 (日志, proxy, fetch, 超时)
└── cli/
    ├── index.js      — slock CLI 完整实现 (~17000行)
    └── package.json
```

## 11. 复现建议

如果要自己实现一个 slock-daemon，核心步骤:

1. **本地 HTTP 代理**: `http.createServer` 监听 `127.0.0.1:0`
2. **Token 注册表**: `Map<token, {apiKey, agentId, serverUrl}>`
3. **路径重写**: 按规则 3 的映射表转换路径
4. **请求转发**: 替换认证 header + 转发到 `api.slock.ai`
5. **新鲜度检查**: 实现 pending message 缓存和 hold 逻辑
6. **CLI wrapper**: 生成 slock 脚本，注入 token 文件路径

最小化实现可以用 ~200 行 Node.js 完成核心代理功能。
