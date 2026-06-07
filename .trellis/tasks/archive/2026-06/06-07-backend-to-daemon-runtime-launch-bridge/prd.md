# Backend-to-Daemon Runtime Launch Bridge

## Goal

当用户通过 UI 创建 agent 后，后端能通知已运行的 daemon 为该 agent 启动实际的 Claude runtime 进程，使 agent 从 "stopped" 变为可接收消息的状态。

## 实施阶段

### 第一阶段：Polling 命令通道 + 1:N 架构

**目标**：跑通创建 agent → daemon 启动 runtime → 消息投递的端到端流程。

**命令通道**：复用现有 `/internal/agent-api/events` polling（3s 间隔），在返回中混入控制事件。

**核心改动**：

#### Daemon 侧（daemon.ts）

1. **`runtimeDriver` → `Map<agentId, ClaudeRuntimeDriver>`**
   - 替换单实例字段为 Map
   - 每个 runtime 有独立的 credential、workspacePath、wrapperDir

2. **新增控制命令类型**
   - 扩展 `RuntimeIncomingMessage`：增加 `control` 类型（`start_runtime`、`stop_runtime`、`restart_runtime`）
   - 在 inbox polling / WS 事件中识别控制命令并分发执行

3. **新增方法**
   - `startRuntimeForAgent(agentId, config)` — 为指定 agent 创建并启动 ClaudeRuntimeDriver
   - `stopRuntimeForAgent(agentId)` — 停止指定 agent 的 runtime
   - `listActiveRuntimes()` — 列出所有活跃 runtime

4. **启动逻辑调整**
   - daemon 启动时连接 backend，获取该 computer 下所有需要运行的 agent 列表
   - 批量启动 runtime（不再只绑定单个 `--agent-id`）

5. **Heartbeat 调整**
   - `registerDaemonLifecycle` 上报所有 runtime 状态（workspaces 数组已存在，扩展为多 runtime）

6. **消息路由**
   - 收到聊天消息时，根据 `target/agentId` 路由到对应 runtime

#### Backend 侧

1. **agent_api.py — events 端点**
   - `/internal/agent-api/events` 返回中混入控制事件
   - 当有待启动的 agent 时，返回 `start_runtime` 控制事件

2. **public_api.py — create_agent**
   - 创建 agent 后，标记该 agent 需要 runtime 启动
   - 下次 daemon polling 时下发 `start_runtime` 命令

3. **agent_api.py — heartbeat/register**
   - daemon heartbeat 时，检查是否有新 agent 需要启动
   - 在响应中包含待执行的控制命令

**验收标准**：
- [ ] UI 创建 agent 后，agent 状态自动变为 running
- [ ] 向该 agent 发消息能收到回复
- [ ] 现有 daemon 能接收新 agent 的启动指令
- [ ] 同一 daemon 能同时管理多个 agent runtime
- [ ] 单个 runtime 崩溃不影响其他 runtime

---

### 第二阶段：WebSocket 双向命令通道

**目标**：后端新增 daemon 专用的 WebSocket 端点，替代 polling，实现实时控制命令推送。

**背景**：第一阶段 daemon 连接的是 Slock 官方 WS（`wss://ws.slock.ai`），后端自己的 agent API 没有 WS 端点。`P1-realtime-events` 标记为 done 但实际只完成了分析/规划，WS 端点尚未实现。

**核心改动**：

#### Backend 侧

1. **新增 WebSocket 端点** — `/internal/agent-api/ws` 或 `/ws`
   - daemon 通过 machine token 认证连接
   - 支持推送控制命令（`start_runtime`、`stop_runtime`）
   - 支持推送聊天消息（替代 polling）
   - 支持接收 daemon 的 ack/activity

2. **命令队列**
   - 为每个 computer 维护待下发的控制命令队列
   - daemon WS 连接后，推送队列中的命令

3. **create_agent 触发**
   - 创建 agent 后，直接通过 WS 推送 `start_runtime` 命令（0 延迟）
   - 如果 daemon 未连接 WS，退回到 heartbeat/polling 兜底

#### Daemon 侧

1. **WS 连接目标切换**
   - `websocket.ts` 的连接目标从 `wss://ws.slock.ai` 切换为自己的后端 WS 端点
   - 或同时维持两个 WS 连接（Slock 官方用于 Slock 功能，自己后端用于控制命令）

2. **控制命令处理**
   - `eventsFromJsonRpc` 增加 `daemon.command.*` / `control.*` 的处理分支
   - `DaemonCore` 在 WS 事件回调中增加控制命令的路由

3. **断线重连**
   - 已有 `scheduleReconnect`（5s 重连），保持不变
   - 重连后拉取离线期间的命令（通过 events 端点兜底）

**验收标准**：
- [ ] daemon 连接后端 WS 后能实时收到控制命令
- [ ] 创建 agent 后 <1s daemon 收到启动指令
- [ ] WS 断线期间的控制命令不丢失（polling 兜底）
- [ ] 控制协议与第一阶段兼容（只是传输层从 polling 换成 WS）

---

## 现状分析（已确认）

### 当前通讯架构

```
┌─────────────┐     WS (wss://ws.slock.ai)     ┌──────────────┐
│   Backend    │◄────────────────────────────────│  DaemonCore  │
│  (FastAPI)   │                                 │  (Node.js)   │
│              │  GET /internal/agent-api/events  │              │
│              │◄───────── inbox polling (3s) ───│  (fallback)  │
│              │                                 │              │
│              │  POST /daemon/register          │              │
│              │◄───────── heartbeat (15s) ──────│              │
│              │                                 │              │
│              │  POST /daemon/connect           │              │
│              │◄───────── 初始连接 ─────────────│              │
└─────────────┘                                 └──────┬───────┘
                                                       │ stdin/stdout (stream-json)
                                                       ▼
                                                ┌──────────────┐
                                                │ Claude Code  │
                                                │  (子进程)     │
                                                └──────────────┘
```

| 方向 | 方式 | 协议 | 内容 |
|------|------|------|------|
| Daemon → Backend | HTTP polling | GET /events (3s) | 拉取聊天消息 |
| Daemon → Backend | WebSocket | wss://ws.slock.ai | 实时事件流 |
| Daemon → Backend | HTTP POST | /daemon/register, /heartbeat | 注册和心跳 |
| **Backend → Daemon** | **无** | **不存在** | **只能通过 events 响应间接传递** |

### 断链点（共 4 处）

1. **创建 agent 不触发 runtime** — `public_api.py:1063` workspace 硬编码 `status="stopped"`，创建后直接 return
2. **Daemon 不感知新 agent** — daemon 只管理启动时 `--agent-id` 指定的 agent，运行中创建的新 agent 不会被感知
3. **Agent 没有 API Key** — 创建 computer 时会生成 `ApiKey`，但创建 agent 时没有
4. **Backend → Daemon 无命令通道** — 只有 Daemon → Backend（heartbeat/polling），没有反向通道

### Daemon 当前架构限制

- **1 daemon = 1 runtime**：`DaemonCore` 只有一个 `runtimeDriver: ClaudeRuntimeDriver | null`（daemon.ts:57）
- **无动态管理能力**：没有 `startRuntime(agentId)` / `stopRuntime()` 等方法
- **事件协议只有聊天消息**：`RuntimeIncomingMessage` 只有 content/target 等聊天字段，没有控制命令
- **WebSocket 单向**：daemon 连接到 backend 的 WS，只接收聊天事件，没有命令协议

### 关键文件

| 文件 | 职责 | 行号 |
|------|------|------|
| `backend/routers/public_api.py` | create_agent endpoint | 1008-1077 |
| `backend/routers/agent_api.py` | daemon register/heartbeat/events | 800-876, 1037-1486 |
| `agent/daemon/aaa-daemon/src/daemon/daemon.ts` | DaemonCore 主逻辑 | 全文 |
| `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts` | Claude runtime 驱动 | 全文 |
| `agent/daemon/aaa-daemon/src/cmd/main.ts` | CLI 启动命令 | 36-116 |
| `agent/daemon/aaa-daemon/src/websocket.ts` | WS 连接管理 | 全文 |

### Slock 真实 daemon 的参考

Slock 的 daemon 是 1:N 架构 — 一台机器上的 daemon 管理多个 agent runtime（如 kimi-mac、codex-mac、claude-deepseek 等都在同一 daemon 下）。aaa-daemon 需要对齐这个设计。

### WS 通讯现状

daemon 的 `websocket.ts` 已实现 WS 连接管理（连接、重连、心跳、ack），但：
- 连接目标是 `wss://ws.slock.ai`（Slock 官方），不是自己的后端
- 只接收 `message.*` 和 `task.*` 事件，不处理控制命令
- 后端 agent_api.py 没有 WebSocket 端点（只有 `chat.py` 的 `/api/chat/ws` 面向前端）

## 决策

### 问题 1：Backend → Daemon 命令通道
- **第一阶段**：复用 events polling（改动小，3s 延迟可接受）
- **第二阶段**：WS 双向（实时，0 延迟）

### 问题 2：Daemon 改为 1:N
- **选定**：1:N（对齐 Slock 真实架构）

### 问题 3：Agent API Key
- **选定**：延续 machine token，暂不引入 agent 级别凭证

### 问题 4：前端 UX
- **选定**：自动启动

## Requirements

* Backend 创建 agent 后能通知 daemon 启动 runtime
* Daemon 能动态为多个 agent workspace 启动/停止 Claude runtime
* Agent 状态从 stopped → running 正确流转
* 用户发消息给 agent 后能收到回复
* 聊天消息正确路由到对应 agent 的 runtime

## Definition of Done

* 第一阶段 + 第二阶段均完成
* Backend + daemon 联调测试通过
* E2E 测试覆盖创建 agent → 发消息 → 收回复流程
* Lint / typecheck / CI green

## Out of Scope

* Agent 级别 API Key / 凭证体系
* Runtime 资源隔离（CPU/内存限制）

## Technical Notes

* daemon 事件轮询间隔：3 秒（daemon.ts:533-575）
* daemon WebSocket 连接：websocket.ts（连接 Slock 官方，5s 重连，30s 心跳）
* daemon runtime 启动条件：`config.runtime === 'claude_code'`（daemon.ts:177-179）
* backend 已有的 daemon 端点：connect / register / heartbeat / events
* backend WS 端点：仅 `/api/chat/ws`（chat.py，面向前端），agent API 无 WS
* Slock daemon 使用 1:N 架构，aaa-daemon 需要对齐
