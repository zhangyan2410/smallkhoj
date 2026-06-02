# Slock 后端架构分析

## 1. 现有 MVP 架构分析

### 1.1 Daemon 层（TypeScript）

Daemon 是当前 MVP 的核心组件，代码位于 `/Users/code/project/smallkhoj/agent/daemon/aaa-daemon/src/`。它是一个本地运行的 Node.js 进程，承担了 Agent 通信、消息代理和运行时管理三重职责。

**核心模块及其职责：**

| 模块 | 文件 | 职责 |
|------|------|------|
| DaemonCore | `daemon/daemon.ts` | 主编排器，管理所有子系统生命周期（proxy、WS、MCP、session），负责 PID 锁、信号处理、日志环形缓冲 |
| ClientHandler | `daemon/client-handler.ts` | JSON-RPC 消息路由，将 daemon 方法分发到本地处理或转发到 HTTP proxy |
| SessionManager | `daemon/session-manager.ts` | 内存中的会话跟踪，`Map<string, SessionInfo>` 存储 |
| AgentProxy | `proxy/agent-proxy.ts` | 本地 HTTP 代理（127.0.0.1:dynamic），认证调用方，改写 agent-scoped 路径到 Slock API 路径，注入认证头 |
| StateMachine | `proxy/state.ts` | 代理状态机（Starting -> Idle -> Prompting -> Draining -> Completed -> Dead） |
| EventBuffer | `proxy/event-buffer.ts` | 环形缓冲区（容量 100,000），用于消息新鲜度检测和 inbox 协调 |
| WebSocketManager | `websocket.ts` | 与 Slock 服务端建立 WebSocket 长连接，接收实时事件，自动重连（5s 间隔）+ 心跳（30s） |
| ClaudeRuntimeDriver | `runtime/claude-runtime.ts` | 以子进程方式启动 Claude Code CLI，通过 stdin/stdout 的 stream-json 格式交互，管理消息队列和 busy 状态 |
| SlockWrapper | `runtime/slock-wrapper.ts` | 生成 `.slock/` 目录下的 shell/cmd/ps1 包装脚本，将 slock CLI 注入 PATH |
| SlockCLI | `slock-cli.ts` | Agent 端使用的命令行工具，通过本地 proxy 与 Slock API 通信 |
| ChatBridge | `chat-bridge.ts` | MCP 兼容桥接（仅保留 deprecated 的 migration_done no-op） |

**数据流（Daemon 视角）：**

```
WebSocketManager ──→ DaemonCore.deliverRuntimeMessage() ──→ ClaudeRuntimeDriver.sendUserMessage()
                                                    ↑
AgentProxy.handleRequest() ──→ upstream Slock API ──→ consumeResponse() ──→ EventBuffer
                                                    ↑
slock-cli.ts ──→ fetch(proxyUrl) ──→ AgentProxy ──→ rewriteAgentPath() ──→ upstream Slock API
```

**Credential 加载逻辑**（`daemon.ts:loadCredential()`）：
1. 优先从 `importSlockRuntime` 导入已有 `.slock` 运行时
2. 其次从 `credentialPath` JSON 文件读取
3. 最后 fallback 到环境变量 `SLOCK_AGENT_ID` / `SLOCK_SERVER_ID` / `SLOCK_AGENT_TOKEN`

**Freshness 机制**（`agent-proxy.ts:buildFreshnessHold()`）：
- 当 Agent 尝试发送消息时，proxy 检查 `EventBuffer` 中是否有未读消息（`seq > seenUpToSeq`）
- 如果有，返回 HTTP 409 + `{state: 'held', reason: 'pending_messages', pending: [...]}` 强制 Agent 先处理积压消息

**问题分析：**

1. **单 Agent 设计**：`DaemonCore` 中 `credential` 是单个 `Credential | null`，所有子系统都围绕一个 Agent 构建。如果一台 Computer 上要运行多个 Agent 实例（对应 UI 设计中的 "Agent Workspaces"），当前架构无法支持。

2. **无持久化**：`SessionManager` 使用纯内存 `Map`，进程重启后所有会话数据丢失。`EventBuffer` 同理。

3. **Proxy 路径硬编码**：`rewriteAgentPath()` 中的路径映射表（如 `/server` -> `/internal/agent-api/server`）是硬编码的，每次 API 变更需要同步修改。

4. **缺少 Server/Computer/Members 概念**：类型定义（`types.ts`）中没有 Server、Computer、Member 这些顶层实体，只有 Credential（agentId + serverId + token）和 SlockMessage/Task/InboxEntry。

5. **消息投递模型不完整**：
   - 没有 Channel 的 CRUD
   - 没有 DM（Direct Message）的显式支持
   - 没有 Thread 的创建/管理
   - `SlockMessage.channelType` 是可选字段，没有强制校验

6. **权限控制缺失**：`slock-cli.ts` 中有 `assertWriteAllowed()` 的基本写保护（`SLOCK_ALLOW_WRITES`），但没有 UI 设计文档中描述的细粒度权限（文件读写、命令执行、网络访问等）。

7. **Activity 日志不存在**：UI 设计中 Activity 是核心模块（记录 Agent 的完整运行过程），但 MVP 中完全没有实现。DaemonCore 的 `logBuffer` 只是记录 daemon 自身日志，不是 Agent 行为日志。

### 1.2 Frontend Store 层（Next.js）

Frontend Store 是 MVP 中最接近"后端"的部分，承担了本应由独立后端服务完成的职责。代码位于：

- 数据存储：`/Users/code/project/smallkhoj/frontend/lib/daemon-store/index.ts`
- 认证：`/Users/code/project/smallkhoj/frontend/lib/daemon-auth.ts`
- API 路由：`/Users/code/project/smallkhoj/frontend/app/internal/agent-api/` 目录下的各个 `route.ts`

**DaemonStore（内存数据存储）：**

```typescript
// 核心数据结构
class DaemonStore {
  agents: Map<string, Agent>          // Agent 实例
  channels: Map<string, Channel>      // 频道
  messages: Message[]                 // 所有消息（数组，无分区）
  events: Event[]                     // 所有事件（数组，seq 自增）
  tasks: Map<number, Task>            // 任务
  subscribers: Set<EventSubscriber>   // SSE 事件订阅者
}
```

**Seed 数据**：硬编码了 3 个 Agent（aaa/deepseek/codex-mac）、2 个 Channel（#all/#window）、3 个 Task。使用 `globalThis` 单例模式来对抗 Next.js HMR 的模块重载。

**已实现的 API 端点（Next.js Route Handlers）：**

| 路径 | 方法 | 功能 | 文件 |
|------|------|------|------|
| `/internal/agent-api/server` | GET | 返回 Server 信息（channels, agents, humans） | `server/route.ts` |
| `/internal/agent-api/send` | POST | 发送消息到 target | `send/route.ts` |
| `/internal/agent-api/events` | GET | 增量事件查询，支持 `since=latest` cursor | `events/route.ts` |
| `/internal/agent-api/history` | GET | 按频道查询消息历史 | `history/route.ts` |
| `/internal/agent-api/stream` | GET | SSE 实时事件推送 | `stream/route.ts` |
| `/internal/agent-api/tasks/claim` | POST | Agent 领取任务 | `tasks/claim/route.ts` |
| `/internal/agent-api/tasks/update-status` | POST | 更新任务状态 | `tasks/update-status/route.ts` |

**认证机制**（`daemon-auth.ts`）：
- 硬编码 token 映射：`sk_test_aaa -> aaa`, `sk_test_deepseek -> deepseek`, `sk_test_codex -> codex-mac`
- 验证 `Authorization: Bearer {token}` + `X-Agent-Id` 头的匹配

**问题分析：**

1. **没有数据库**：所有数据在内存中，进程重启即丢失。`globalThis` 单例在 Next.js 生产部署（无 HMR）中也无法持久化。

2. **无 Server 隔离**：`getServerInfo()` 返回硬编码的 `serverId: "local-mvp"`，没有多 Server 支持。

3. **无 Computer 实体**：UI 设计中 Computer 是一等公民（管理 Daemon 连接、检测 Runtimes、展示 Agent Workspaces），MVP 完全缺失。

4. **无 Member 概念**：只有 Agent，没有人类用户和 Agent 的统一 Member 模型。`humans` 字段硬编码了 `[{id: "zy-ean", name: "zy-ean"}]`。

5. **消息无 Thread**：`Message` 接口没有 `threadId` 字段，无法支持 Thread（消息线程）特性。

6. **无 DM 支持**：虽然 daemon 的 `SlockMessage` 有 `channelType: 'dm'`，但 Store 中没有 DM 的路由和处理。

7. **无文件管理**：UI 设计中有 Files 页面管理上传附件，MVP 没有实现。

8. **无权限系统**：所有认证通过即可执行所有操作。

9. **SSE 实现问题**：`stream/route.ts` 的 SSE 端点通过 `store.subscribe()` 获取事件，但 Next.js Route Handler 的 ReadableStream 在 Vercel 等平台上可能超时或被中断。

10. **事件模型不完整**：Event 类型只有 `message | task_claimed | task_updated | connected | disconnected`，缺少 UI 设计中的 Agent 状态变更、文件操作、权限变更等事件。

### 1.3 Backend 层（FastAPI）

代码位于 `/Users/code/project/smallkhoj/backend/`，目前非常初步。

**已实现：**

| 文件 | 功能 |
|------|------|
| `main.py` | FastAPI 应用入口，CORS 配置（允许 localhost:3000），lifespan 管理占位 |
| `config.py` | pydantic-settings 配置，预留了 `database_url`（PostgreSQL）和 `llm_api_key` |
| `routers/health.py` | GET `/api/health` 健康检查 |
| `routers/chat.py` | WebSocket `/api/chat/ws` 聊天端点，流式调用 LLM |

**问题分析：**

1. **与 Slock 无关**：当前 Backend 是一个通用的 LLM 聊天服务，与 Slock 的多 Agent 协作平台概念无关。没有任何 Agent、Channel、Task、Message 的数据模型。

2. **数据库未使用**：`config.py` 定义了 `database_url`，但没有 ORM 模型、没有 migration、没有任何数据库连接代码。

3. **职责不清**：FastAPI backend 和 Next.js frontend 的 agent-api 路由存在职责重叠。从架构上看，应该是 Backend（FastAPI）作为真正的后端服务，Frontend 只负责 UI 渲染和 BFF（Backend for Frontend）层。

4. **WebSocket 协议不匹配**：`chat.py` 的 WebSocket 协议是简单的 `{q: "..."}` 请求-响应模式，与 Slock 的事件驱动协议（message_received, task_claimed 等）完全不同。

### 1.4 数据流分析

**MVP 数据流（完整链路）：**

```
[1] Agent (Claude Code 子进程)
  ↓ stdin (stream-json user message)
[2] ClaudeRuntimeDriver
  ↓ 子进程调用 slock CLI
[3] slock-cli.ts
  ↓ HTTP fetch 到本地 proxy
[4] AgentProxy (127.0.0.1:port)
  ↓ 路径改写 + token 注入
  ↓ HTTP fetch 到 Next.js API Route
[5] Next.js Route Handler (/internal/agent-api/*)
  ↓ 读写 DaemonStore (内存)
[6] DaemonStore (全局内存单例)
  ↓ 通知 subscribers
[7] SSE Stream (/internal/agent-api/stream)
  ↓ Server-Sent Events
[8] WebSocketManager (与 Slock 官方服务器)
```

同时存在另一条数据流：

```
[官方 Slock 服务器]
  ↓ WebSocket push
[WebSocketManager]
  ↓ DaemonCore.deliverRuntimeMessage()
[ClaudeRuntimeDriver.sendUserMessage()]
  ↓ stdin 注入
[Agent (Claude Code)]
```

**关键问题：数据源不统一**

MVP 中存在两个独立的 "后端"：
- **Next.js 内存 Store**：Agent 通过 local proxy 访问，数据在进程内存
- **官方 Slock 服务器**：通过 WebSocket 接收事件，但 MVP 的 local API 并不依赖官方服务器

这两条数据流在 MVP 中是断开的：Agent 发送消息写入 Next.js Store，但 WebSocket 从官方服务器接收的事件与 Store 中的数据不同步。

### 1.5 现有问题总结

按严重程度排序：

| # | 问题 | 严重度 | 影响 |
|---|------|--------|------|
| 1 | **无持久化存储** | 致命 | 进程重启所有数据丢失，无法投入生产 |
| 2 | **无 Computer 实体** | 高 | UI 中 Computers 管理完全无法实现 |
| 3 | **无 Member 统一模型** | 高 | 人类用户和 Agent 无法统一管理，权限控制无基础 |
| 4 | **无 Thread 支持** | 高 | UI 中 Thread 是核心特性（每条消息可衍生线程） |
| 5 | **无 DM 路由** | 高 | Agent-to-Agent 私信无法实现 |
| 6 | **无权限系统** | 高 | UI 中 Permissions 模块（文件读写/命令执行/网络访问）无法实现 |
| 7 | **无 Activity 日志** | 高 | Agent 操作行为无法审计和调试 |
| 8 | **单 Agent Daemon 设计** | 中 | 一台 Computer 上无法运行多个 Agent 实例 |
| 9 | **FastAPI 与 Next.js 职责重叠** | 中 | 架构不清，后续扩展困难 |
| 10 | **SSE 实现不稳定** | 中 | 长连接在 serverless 环境下不可靠 |
| 11 | **认证硬编码** | 中 | token 写死在代码中，无法动态管理 |
| 12 | **无文件存储** | 低 | UI 中 Files 页面无法实现 |

---

## 2. 目标后端分层架构

### 2.1 整体分层设计

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                          │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐             │
│  │ Next.js   │  │ Slock    │  │ Daemon    │             │
│  │ Frontend  │  │ 官方客户端│  │ CLI       │             │
│  └─────┬─────┘  └─────┬────┘  └─────┬─────┘             │
├────────┼───────────────┼──────────────┼──────────────────┤
│        │     API Layer (HTTP + WebSocket)                │
│        ▼               ▼              ▼                  │
│  ┌─────────────────────────────────────────────────┐    │
│  │              FastAPI Backend                     │    │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────────┐ │    │
│  │  │ REST API  │ │ WebSocket │ │ Daemon Auth   │ │    │
│  │  │ Routes    │ │ Manager   │ │ & Registration│ │    │
│  │  └─────┬─────┘ └─────┬─────┘ └───────┬───────┘ │    │
│  ├────────┼─────────────┼───────────────┼─────────┤    │
│  │        │   Service Layer              │         │    │
│  │        ▼                              ▼         │    │
│  │  ┌─────────────────────────────────────────┐   │    │
│  │  │           Business Services             │   │    │
│  │  │ ServerSvc · ComputerSvc · MemberSvc    │   │    │
│  │  │ ChannelSvc · MessageSvc · TaskSvc      │   │    │
│  │  │ FileSvc · ActivitySvc · PermissionSvc  │   │    │
│  │  └──────────────┬──────────────────────────┘   │    │
│  ├─────────────────┼──────────────────────────────┤    │
│  │                 │  Event Layer                  │    │
│  │                 ▼                               │    │
│  │  ┌───────────────────────┐ ┌─────────────────┐ │    │
│  │  │ Event Dispatcher      │ │ Event Store     │ │    │
│  │  │ (pub/sub)             │ │ (append-only)   │ │    │
│  │  └───────────┬───────────┘ └────────┬────────┘ │    │
│  ├──────────────┼──────────────────────┼──────────┤    │
│  │              │   Data Layer         │          │    │
│  │              ▼                      ▼          │    │
│  │  ┌──────────────────┐  ┌──────────────────┐   │    │
│  │  │ PostgreSQL       │  │ Object Storage   │   │    │
│  │  │ (主数据库)        │  │ (文件/附件)      │   │    │
│  │  └──────────────────┘  └──────────────────┘   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │        Daemon Integration Layer (TypeScript)    │    │
│  │  ┌──────────┐ ┌──────────┐ ┌────────────────┐  │    │
│  │  │ Agent    │ │ WebSocket│ │ Runtime        │  │    │
│  │  │ Proxy   │ │ Client   │ │ Driver(s)      │  │    │
│  │  └──────────┘ └──────────┘ └────────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Data Layer（数据库）

**选型：PostgreSQL + SQLAlchemy (async)**

理由：
- 已在 `config.py` 中预留了 `database_url`，且选择了 `postgresql+asyncpg` 驱动
- PostgreSQL 的 JSONB 类型适合存储 Agent 的动态 metadata、Activity 日志的变体结构
- LISTEN/NOTIFY 机制可用于实时事件推送（替代或补充 WebSocket）
- Row Level Security 可实现 Server 级别的数据隔离

**ORM 框架：SQLAlchemy 2.0 + Alembic**

- 异步引擎（`create_async_engine`）
- 声明式映射（`DeclarativeBase`）
- Alembic 管理 migration

**文件存储：**

- 小规模：本地文件系统 + 数据库存路径
- 中规模：MinIO / S3 兼容对象存储
- MVP 阶段可先用本地文件系统

### 2.3 Service Layer（业务逻辑）

每个核心实体对应一个 Service 类，封装业务规则和数据访问：

```python
# 服务层示例结构
class ServerService:
    async def create_server(owner_id: str, name: str) -> Server
    async def get_server(server_id: str) -> Server
    async def list_members(server_id: str) -> list[Member]

class ComputerService:
    async def register_computer(server_id: str, api_key: str, name: str, os_info: dict) -> Computer
    async def update_heartbeat(computer_id: str) -> None
    async def detect_runtimes(computer_id: str, runtimes: list[str]) -> None
    async def list_agent_workspaces(computer_id: str) -> list[AgentWorkspace]

class MemberService:
    async def create_human_member(server_id: str, user_id: str, display_name: str) -> Member
    async def create_agent_member(server_id: str, computer_id: str, config: AgentConfig) -> Member
    async def update_permissions(member_id: str, permissions: PermissionSet) -> Member
    async def get_profile(member_id: str) -> Profile
    async def update_profile(member_id: str, updates: dict) -> Profile

class ChannelService:
    async def create_channel(server_id: str, name: str, type: ChannelType, creator_id: str) -> Channel
    async def join_channel(channel_id: str, member_id: str) -> None
    async def leave_channel(channel_id: str, member_id: str) -> None
    async def get_members(channel_id: str) -> list[Member]

class MessageService:
    async def send_message(sender_id: str, target: str, content: str, **kwargs) -> Message
    async def send_dm(sender_id: str, recipient_id: str, content: str) -> Message
    async def create_thread(parent_message_id: str, sender_id: str, content: str) -> Message
    async def get_history(channel_id: str, limit: int, before: str | None) -> list[Message]
    async def search_messages(server_id: str, query: str, filters: dict) -> list[Message]
    async def add_reaction(member_id: str, message_id: str, reaction: str) -> None

class TaskService:
    async def create_task(channel_id: str, creator_id: str, title: str) -> Task
    async def claim_task(task_id: str, assignee_id: str) -> Task
    async def update_task_status(task_id: str, status: TaskStatus, updater_id: str) -> Task
    async def list_tasks(channel_id: str | None, status: TaskStatus | None) -> list[Task]

class FileService:
    async def upload_file(channel_id: str, uploader_id: str, file: UploadFile) -> FileAttachment
    async def get_file(file_id: str) -> FileAttachment
    async def download_file(file_id: str) -> BinaryIO

class ActivityService:
    async def log_activity(agent_id: str, activity_type: str, details: dict) -> ActivityLog
    async def get_activities(agent_id: str, filters: dict) -> list[ActivityLog]

class PermissionService:
    async def check_permission(member_id: str, action: str, resource: str) -> bool
    async def grant_permission(member_id: str, action: str, resource: str) -> None
    async def revoke_permission(member_id: str, action: str, resource: str) -> None
```

### 2.4 API Layer（HTTP + WebSocket）

**API 层分为两组：**

**用户端 API（供 Next.js Frontend 调用）：**
- 认证：JWT / Session-based
- 路径前缀：`/api/v1/`

**Agent 端 API（供 Daemon / slock CLI 调用）：**
- 认证：Machine API Key + Agent Token
- 路径前缀：`/internal/agent-api/`（保持与现有 Daemon 兼容）

```python
# FastAPI 路由结构
app = FastAPI()

# 用户端
app.include_router(server_router,     prefix="/api/v1/servers")
app.include_router(computer_router,   prefix="/api/v1/computers")
app.include_router(member_router,     prefix="/api/v1/members")
app.include_router(channel_router,    prefix="/api/v1/channels")
app.include_router(message_router,    prefix="/api/v1/messages")
app.include_router(task_router,       prefix="/api/v1/tasks")
app.include_router(file_router,       prefix="/api/v1/files")
app.include_router(activity_router,   prefix="/api/v1/activities")
app.include_router(permission_router, prefix="/api/v1/permissions")

# Agent 端（兼容 Daemon 的 internal API）
app.include_router(agent_api_router,  prefix="/internal/agent-api")
app.include_router(agent_proxy_router, prefix="/internal/agent/{agent_id}")
```

**WebSocket 端点：**

```python
# 用户端实时通知
@app.websocket("/api/v1/ws")
async def user_websocket(ws: WebSocket, user_id: str):
    """用户端 WebSocket：推送消息、任务变更、Agent 状态等"""
    ...

# Agent 端实时通信
@app.websocket("/internal/ws")
async def agent_websocket(ws: WebSocket, agent_id: str):
    """Agent 端 WebSocket：接收指令、推送消息、投递任务"""
    ...
```

### 2.5 Event Layer（实时事件推送）

**设计原则：**
- 所有写操作（发送消息、创建任务、状态变更等）都产生事件
- 事件存储在 append-only 的 `events` 表中
- 通过 WebSocket / SSE 推送给订阅者
- 支持事件回放（新连接可从某个 cursor 开始补发）

**事件类型：**

```python
class EventType(str, Enum):
    # 消息相关
    MESSAGE_CREATED = "message.created"
    MESSAGE_REACTION = "message.reaction"

    # 任务相关
    TASK_CREATED = "task.created"
    TASK_CLAIMED = "task.claimed"
    TASK_UPDATED = "task.updated"
    TASK_CLOSED = "task.closed"

    # 成员相关
    MEMBER_JOINED = "member.joined"
    MEMBER_LEFT = "member.left"
    MEMBER_STATUS_CHANGED = "member.status_changed"

    # 频道相关
    CHANNEL_CREATED = "channel.created"
    CHANNEL_MEMBER_JOINED = "channel.member_joined"
    CHANNEL_MEMBER_LEFT = "channel.member_left"

    # Agent 运行时
    AGENT_STARTED = "agent.started"
    AGENT_STOPPED = "agent.stopped"
    AGENT_ACTIVITY = "agent.activity"

    # 计算机相关
    COMPUTER_CONNECTED = "computer.connected"
    COMPUTER_DISCONNECTED = "computer.disconnected"

    # 权限变更
    PERMISSION_CHANGED = "permission.changed"
```

**事件推送架构：**

```
Service Layer 写操作
  ↓
EventDispatcher.publish(event)
  ↓
  ├──→ EventStore.append(event)          # 持久化
  ├──→ WebSocketManager.broadcast(event) # 实时推送
  └──→ SSE connection pool               # SSE 备用通道
```

### 2.6 Daemon Integration Layer

Daemon（TypeScript）作为 Agent 运行时的管理代理，部署在用户的 Computer 上，通过 HTTP + WebSocket 与 FastAPI Backend 通信。

**Daemon 需要保留的职责：**
- 本地 Agent Proxy（路径改写、认证注入）
- Claude Code / 其他 Runtime 的进程管理
- `.slock/` 目录和 slock wrapper 脚本生成
- 本地 Event Buffer 和 Freshness 机制
- 凭证管理和安全存储

**Daemon 不应承担的职责（移到 Backend）：**
- 消息存储和查询（移到 MessageService + PostgreSQL）
- 任务存储和状态管理（移到 TaskService + PostgreSQL）
- 频道/成员管理（移到 ChannelService + MemberService）
- 认证验证（移到 Backend 的认证中间件）

---

## 3. 数据库 Schema 设计

### 3.1 核心表设计

```sql
-- ══════════════════════════════════════════════════════════
-- 1. servers — 顶层隔离单元
-- ══════════════════════════════════════════════════════════
CREATE TABLE servers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    owner_id    UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════
-- 2. users — 平台用户（人类）
-- ══════════════════════════════════════════════════════════
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(255) UNIQUE,
    name        VARCHAR(255) NOT NULL,
    avatar_url  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════
-- 3. computers — 物理机器，运行 Daemon
-- ══════════════════════════════════════════════════════════
CREATE TABLE computers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    api_key_hash    VARCHAR(255) NOT NULL,           -- 机器码凭证的哈希
    os_info         JSONB DEFAULT '{}',              -- {os: "macos", version: "14.5"}
    daemon_version  VARCHAR(50),
    detected_runtimes JSONB DEFAULT '[]',            -- ["claude-code", "codex-cli"]
    status          VARCHAR(20) DEFAULT 'offline',   -- online | offline
    last_heartbeat  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_computers_server ON computers(server_id);

-- ══════════════════════════════════════════════════════════
-- 4. members — 统一成员模型（人类 + Agent）
-- ══════════════════════════════════════════════════════════
CREATE TABLE members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    type            VARCHAR(10) NOT NULL CHECK (type IN ('human', 'agent')),
    -- 人类关联
    user_id         UUID REFERENCES users(id),
    -- Agent 关联
    computer_id     UUID REFERENCES computers(id),
    -- 公共字段
    display_name    VARCHAR(255) NOT NULL,
    description     TEXT,
    avatar_url      TEXT,
    status          VARCHAR(20) DEFAULT 'offline',   -- online | idle | offline | active
    skills          JSONB DEFAULT '[]',              -- Agent 的技能列表
    config          JSONB DEFAULT '{}',              -- Agent 的配置信息
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT member_type_fk CHECK (
        (type = 'human' AND user_id IS NOT NULL AND computer_id IS NULL) OR
        (type = 'agent' AND computer_id IS NOT NULL)
    )
);
CREATE INDEX idx_members_server ON members(server_id);
CREATE INDEX idx_members_computer ON members(computer_id);

-- ══════════════════════════════════════════════════════════
-- 5. agent_workspaces — Agent 在 Computer 上的运行实例
-- ══════════════════════════════════════════════════════════
CREATE TABLE agent_workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    computer_id     UUID NOT NULL REFERENCES computers(id) ON DELETE CASCADE,
    workspace_path  TEXT NOT NULL,
    runtime_type    VARCHAR(50),                     -- "claude-code", "codex-cli", etc.
    runtime_status  VARCHAR(20) DEFAULT 'stopped',   -- running | stopped | crashed
    session_id      VARCHAR(255),                    -- 运行时会话 ID
    pid             INTEGER,
    last_seen       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agent_workspaces_agent ON agent_workspaces(agent_member_id);
CREATE INDEX idx_agent_workspaces_computer ON agent_workspaces(computer_id);

-- ══════════════════════════════════════════════════════════
-- 6. channels — 沟通频道
-- ══════════════════════════════════════════════════════════
CREATE TABLE channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    type            VARCHAR(10) NOT NULL DEFAULT 'public' CHECK (type IN ('public', 'private', 'dm')),
    creator_id      UUID REFERENCES members(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(server_id, name)
);
CREATE INDEX idx_channels_server ON channels(server_id);

-- ══════════════════════════════════════════════════════════
-- 7. channel_members — 频道成员关联
-- ══════════════════════════════════════════════════════════
CREATE TABLE channel_members (
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (channel_id, member_id)
);

-- ══════════════════════════════════════════════════════════
-- 8. messages — 消息
-- ══════════════════════════════════════════════════════════
CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    short_id        VARCHAR(20) NOT NULL,            -- 人类可读的短 ID（如 "a1b2c3d4"）
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES members(id),
    parent_id       UUID REFERENCES messages(id),    -- Thread 的父消息 ID
    content         TEXT NOT NULL,
    channel_type    VARCHAR(10) NOT NULL DEFAULT 'channel' CHECK (channel_type IN ('channel', 'dm', 'thread')),
    seq             BIGSERIAL,                       -- 全局递增序列号
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_channel ON messages(channel_id, created_at DESC);
CREATE INDEX idx_messages_parent ON messages(parent_id, created_at);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_seq ON messages(seq);

-- ══════════════════════════════════════════════════════════
-- 9. message_reactions — 消息反应
-- ══════════════════════════════════════════════════════════
CREATE TABLE message_reactions (
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    reaction        VARCHAR(50) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, member_id, reaction)
);

-- ══════════════════════════════════════════════════════════
-- 10. tasks — 任务
-- ══════════════════════════════════════════════════════════
CREATE TABLE tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_number     INTEGER NOT NULL,                -- 频道内递增的任务编号
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id      UUID REFERENCES messages(id),    -- 关联的消息
    title           TEXT NOT NULL,
    description     TEXT,
    status          VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'done', 'closed')),
    creator_id      UUID NOT NULL REFERENCES members(id),
    assignee_id     UUID REFERENCES members(id),
    data            JSONB DEFAULT '{}',              -- 扩展数据
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(channel_id, task_number)
);
CREATE INDEX idx_tasks_channel ON tasks(channel_id, status);
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX idx_tasks_status ON tasks(status);

-- ══════════════════════════════════════════════════════════
-- 11. files — 文件附件
-- ══════════════════════════════════════════════════════════
CREATE TABLE files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id       UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    channel_id      UUID REFERENCES channels(id),
    message_id      UUID REFERENCES messages(id),
    uploader_id     UUID NOT NULL REFERENCES members(id),
    filename        VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(100),
    size_bytes      BIGINT,
    storage_path    TEXT NOT NULL,                   -- 本地路径或 S3 URL
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_files_channel ON files(channel_id);

-- ══════════════════════════════════════════════════════════
-- 12. activity_logs — Agent 操作行为日志
-- ══════════════════════════════════════════════════════════
CREATE TABLE activity_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID NOT NULL REFERENCES members(id),
    workspace_id    UUID REFERENCES agent_workspaces(id),
    activity_type   VARCHAR(50) NOT NULL,           -- "command_exec", "file_write", "file_read", "message_send", etc.
    details         JSONB NOT NULL DEFAULT '{}',     -- 具体操作的详情
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_activity_agent ON activity_logs(agent_id, created_at DESC);
CREATE INDEX idx_activity_type ON activity_logs(activity_type, created_at DESC);

-- ══════════════════════════════════════════════════════════
-- 13. permissions — 细粒度权限
-- ══════════════════════════════════════════════════════════
CREATE TABLE permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    resource_type   VARCHAR(50) NOT NULL,           -- "file_read", "file_write", "command_exec", "network_access"
    resource_id     VARCHAR(255),                   -- 可选的资源 ID（如特定频道、特定路径）
    allowed         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(member_id, resource_type, resource_id)
);
CREATE INDEX idx_permissions_member ON permissions(member_id);

-- ══════════════════════════════════════════════════════════
-- 14. events — 事件流（append-only）
-- ══════════════════════════════════════════════════════════
CREATE TABLE events (
    id              BIGSERIAL PRIMARY KEY,
    server_id       UUID NOT NULL REFERENCES servers(id),
    event_type      VARCHAR(50) NOT NULL,
    actor_id        UUID REFERENCES members(id),
    payload         JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_events_server_seq ON events(server_id, id);

-- ══════════════════════════════════════════════════════════
-- 15. reminders — 提醒
-- ══════════════════════════════════════════════════════════
CREATE TABLE reminders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    fire_at         TIMESTAMPTZ NOT NULL,
    repeat          VARCHAR(20),                    -- "daily", "weekly", etc.
    channel_id      UUID REFERENCES channels(id),
    message_id      UUID REFERENCES messages(id),
    done            BOOLEAN DEFAULT FALSE,
    data            JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reminders_fire ON reminders(fire_at) WHERE NOT done;

-- ══════════════════════════════════════════════════════════
-- 16. api_keys — Agent 和 Computer 的认证凭证
-- ══════════════════════════════════════════════════════════
CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key_hash        VARCHAR(255) NOT NULL UNIQUE,
    key_prefix      VARCHAR(20) NOT NULL,           -- "sk_machine_", "sk_agent_"
    resource_type   VARCHAR(20) NOT NULL,           -- "computer" | "agent"
    resource_id     UUID NOT NULL,                  -- computers.id 或 members.id
    server_id       UUID NOT NULL REFERENCES servers(id),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
```

### 3.2 ER 关系图（文字描述）

```
users 1 ──── N servers (via owner_id)
servers 1 ── N computers
servers 1 ── N members
servers 1 ── N channels
servers 1 ── N files
servers 1 ── N events

computers 1 ── N members (type='agent')
computers 1 ── N agent_workspaces

users 1 ──── 1 members (type='human', via user_id)

members 1 ── N messages (sender_id)
members 1 ── N tasks (creator_id / assignee_id)
members 1 ── N activity_logs
members 1 ── N permissions
members 1 ── N reminders
members M ── N channels (via channel_members)

channels 1 ── N messages
channels 1 ── N tasks
channels 1 ── N channel_members
channels 1 ── N files

messages 1 ── N messages (parent_id, 即 Thread)
messages 1 ── N message_reactions
messages 1 ── 0..1 tasks

agent_workspaces 1 ── N activity_logs
```

---

## 4. API 设计建议

### 4.1 RESTful 路由

**用户端 API（`/api/v1/`）：**

```
# Server
GET    /api/v1/servers                          # 列出用户的 Server
POST   /api/v1/servers                          # 创建 Server
GET    /api/v1/servers/{server_id}              # 获取 Server 详情

# Computers
GET    /api/v1/servers/{server_id}/computers    # 列出 Computer
POST   /api/v1/computers/register               # 注册 Computer（CLI 调用）
GET    /api/v1/computers/{computer_id}          # Computer 详情
PATCH  /api/v1/computers/{computer_id}          # 更新 Computer（名称等）
GET    /api/v1/computers/{computer_id}/workspaces  # Agent Workspaces

# Members
GET    /api/v1/servers/{server_id}/members      # 列出成员
GET    /api/v1/members/{member_id}              # 成员详情
PATCH  /api/v1/members/{member_id}              # 更新成员信息
POST   /api/v1/members/{member_id}/permissions  # 设置权限
GET    /api/v1/members/{member_id}/activities   # 活动日志

# Channels
GET    /api/v1/servers/{server_id}/channels     # 列出频道
POST   /api/v1/servers/{server_id}/channels     # 创建频道
GET    /api/v1/channels/{channel_id}            # 频道详情
POST   /api/v1/channels/{channel_id}/join       # 加入频道
POST   /api/v1/channels/{channel_id}/leave      # 离开频道
GET    /api/v1/channels/{channel_id}/members    # 频道成员

# Messages
POST   /api/v1/channels/{channel_id}/messages   # 发送消息
GET    /api/v1/channels/{channel_id}/messages   # 获取历史消息
GET    /api/v1/messages/{message_id}            # 消息详情
POST   /api/v1/messages/{message_id}/thread     # 创建 Thread
GET    /api/v1/messages/{message_id}/thread     # 获取 Thread 回复
POST   /api/v1/messages/{message_id}/reactions  # 添加反应
DELETE /api/v1/messages/{message_id}/reactions  # 移除反应

# Tasks
GET    /api/v1/servers/{server_id}/tasks        # 任务列表（支持 Board/List 视图）
POST   /api/v1/channels/{channel_id}/tasks      # 创建任务
POST   /api/v1/tasks/{task_id}/claim            # 领取任务
PATCH  /api/v1/tasks/{task_id}                  # 更新任务

# Files
GET    /api/v1/servers/{server_id}/files        # 文件列表
POST   /api/v1/channels/{channel_id}/files      # 上传文件
GET    /api/v1/files/{file_id}                  # 文件详情
GET    /api/v1/files/{file_id}/download         # 下载文件

# DM
POST   /api/v1/servers/{server_id}/dms          # 创建/获取 DM 频道
GET    /api/v1/dms/{dm_id}/messages             # DM 消息历史
POST   /api/v1/dms/{dm_id}/messages             # 发送 DM 消息
```

**Agent 端 API（`/internal/agent-api/`，兼容 Daemon）：**

```
# 保持现有 Daemon 的 API 路径不变
GET    /internal/agent-api/server               # Server 信息
POST   /internal/agent-api/send                 # 发送消息
GET    /internal/agent-api/events               # 增量事件查询
GET    /internal/agent-api/history              # 消息历史
GET    /internal/agent-api/stream               # SSE 实时推送
GET    /internal/agent-api/tasks                # 任务列表
POST   /internal/agent-api/tasks                # 创建任务
POST   /internal/agent-api/tasks/claim          # 领取任务
POST   /internal/agent-api/tasks/update-status  # 更新任务状态
GET    /internal/agent-api/channel-members      # 频道成员
POST   /internal/agent-api/channels/{id}/join   # 加入频道
POST   /internal/agent-api/channels/{id}/leave  # 离开频道
POST   /internal/agent-api/threads/unfollow     # 取消关注 Thread
GET    /internal/agent-api/profile              # 获取/更新 Profile
POST   /internal/agent-api/profile              # 更新 Profile
GET    /internal/agent-api/integrations         # 集成列表
POST   /internal/agent-api/integrations/login   # 登录集成
GET    /internal/agent-api/reminders            # 提醒列表
POST   /internal/agent-api/reminders            # 创建提醒
PATCH  /internal/agent-api/reminders/{id}       # 更新提醒
DELETE /internal/agent-api/reminders/{id}       # 删除提醒
GET    /internal/agent-api/attachments/{id}     # 查看附件
GET    /internal/agent-api/attachments/{id}/download  # 下载附件
POST   /internal/agent-api/upload               # 上传附件
POST   /internal/agent-api/resolve-channel      # 解析频道名
GET    /internal/agent-api/search               # 搜索消息
GET    /internal/agent-api/knowledge            # 知识库列表
POST   /internal/agent-api/prepare-action       # 预检查操作权限
```

### 4.2 WebSocket 事件协议

**用户端 WebSocket（`/api/v1/ws`）：**

```typescript
// 客户端 → 服务端
interface ClientMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  channels?: string[];       // 订阅的频道 ID
}

// 服务端 → 客户端
interface ServerEvent {
  type: string;              // 事件类型（见 EventType 枚举）
  seq: number;               // 递增序列号
  timestamp: string;         // ISO 8601
  data: Record<string, unknown>;  // 事件负载
}
```

**Agent 端 WebSocket（`/internal/ws`）：**

```typescript
// 服务端 → Agent Daemon
interface AgentEvent {
  type: 'message_received' | 'task_assigned' | 'task_updated' | 'permission_changed';
  seq: number;
  data: {
    message?: SlockMessage;
    task?: Task;
  };
}

// Agent Daemon → 服务端
interface AgentResponse {
  type: 'ack' | 'activity' | 'error';
  message_id?: string;
  seq?: number;
  data?: Record<string, unknown>;
}
```

---

## 5. 与现有 Daemon 代码的对接点

### 5.1 Daemon 需要改动的部分

**1. `AgentProxy`（`proxy/agent-proxy.ts`）— 上游地址可配置化**

当前 `handleRequest()` 中的 upstream 请求目标是 `reg.credential.serverUrl`。改为指向 FastAPI Backend 后，`Credential.serverUrl` 应设置为 Backend 地址。

改动点：
- `Credential.serverUrl` 从官方 Slock 服务器地址改为 `http://localhost:8000`（或部署地址）
- `rewriteAgentPath()` 中的路径映射保持不变（因为 Backend 的 `/internal/agent-api/` 路由已兼容）
- `Credential.token` 改为 Backend 签发的 Machine API Key 或 Agent Token

**2. `WebSocketManager`（`websocket.ts`）— 连接目标改为 Backend**

当前连接到官方 Slock 服务器（`credential.wsUrl`）。改为连接 FastAPI Backend 的 `/internal/ws` 端点。

改动点：
- `this.credential.wsUrl` 指向 `ws://localhost:8000/internal/ws`
- 保持 `Authorization` 和 `X-Agent-Id` 头的认证方式
- 心跳和重连机制不变

**3. `Credential` 加载（`daemon.ts:loadCredential()`）— 对接 Backend 的注册 API**

当前从本地 JSON 文件或环境变量加载凭证。需要增加从 Backend 注册/获取凭证的流程。

改动点：
- 新增 `DaemonConfig.registerUrl` 配置项，指向 `POST /api/v1/computers/register`
- CLI 启动时，如果没有本地凭证，调用注册 API 获取 Machine API Key
- 将获取到的凭证保存到本地 `credentialPath`

**4. `DaemonCore`（`daemon/daemon.ts`）— 支持多 Agent**

当前 `credential` 是单个实例。如果一台 Computer 上需要运行多个 Agent，需要重构。

改动点：
- `credential` 改为 `credentials: Map<string, Credential>`
- 每个 `ClaudeRuntimeDriver` 关联一个 `Credential`
- `AgentProxy` 的 `registrations` 已支持多 token，只需关联正确的 credential
- 这不是 MVP 必需的改动，但为目标架构做准备

**5. `SlockCLI`（`slock-cli.ts`）— 无需改动**

CLI 通过 `SLOCK_AGENT_PROXY_URL` 和 `SLOCK_AGENT_PROXY_TOKEN_FILE` 环境变量找到本地 proxy，不直接连接 Backend。只要 proxy 的上游地址正确，CLI 不需要改动。

**6. Freshness 机制（`agent-proxy.ts:buildFreshnessHold()`）— 考虑移除或降级**

Freshness 机制（发送消息前检查未读消息）是 Daemon 本地的优化。当 Backend 接管消息存储后，Freshness 检查应该在后端实现，Daemon 端可以简化为透传。

### 5.2 可以复用的部分

以下模块设计良好，与后端架构解耦，可以直接复用：

| 模块 | 文件 | 复用方式 |
|------|------|---------|
| **EventBuffer** | `proxy/event-buffer.ts` | 保持不变，作为 Daemon 本地的事件缓冲，减少对 Backend 的轮询 |
| **StateMachine** | `proxy/state.ts` | 保持不变，Proxy 状态机的抽象是通用的 |
| **SessionManager** | `daemon/session-manager.ts` | 保持不变，本地会话管理。后续可考虑与 Backend 的 session 同步 |
| **ClaudeRuntimeDriver** | `runtime/claude-runtime.ts` | 核心模块，直接复用。管理 Claude Code 子进程的生命周期、消息队列、busy 状态检测 |
| **SlockWrapper 生成** | `runtime/slock-wrapper.ts` | 直接复用，生成 `.slock/` 目录下的包装脚本 |
| **Slock System Prompt** | `runtime/claude-runtime.ts:buildSlockSystemPrompt()` | 直接复用，定义了 Agent 的行为规范 |
| **JSON-RPC 协议** | `protocol/jsonrpc.ts` + `methods.ts` | 直接复用，Daemon 内部通信协议 |
| **SlockCLI** | `slock-cli.ts` | 直接复用，命令行参数解析、安全检查、写保护逻辑 |
| **Path Rewrite** | `proxy/agent-proxy.ts:rewriteAgentPath()` | 直接复用，API 路径映射逻辑 |
| **SSE 解析** | `proxy/agent-proxy.ts:SseEventParser` | 直接复用，解析 SSE 事件流 |
| **消息格式化** | `daemon/daemon.ts:formatRuntimeIncomingMessage()` | 直接复用，将消息格式化为 Agent 可读的头部+正文格式 |

**重构优先级建议：**

1. **Phase 1（最小可用）**：FastAPI Backend 实现核心表 + Agent API，替代 Next.js 内存 Store。Daemon 只需修改 `Credential.serverUrl` 和 `wsUrl`。
2. **Phase 2（Computer + Member）**：添加 Computer 注册、Member 管理、权限系统。
3. **Phase 3（完整特性）**：Thread、DM、Activity 日志、文件管理、提醒。
4. **Phase 4（多 Agent）**：Daemon 支持多 Agent 实例，Backend 支持 Agent Workspaces 管理。
