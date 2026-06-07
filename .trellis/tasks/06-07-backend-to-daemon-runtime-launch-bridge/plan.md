# Implementation Plan: Backend-to-Daemon Runtime Launch Bridge

## 依赖关系

```
Step 1 (Daemon 1:N 基础)
  └→ Step 2 (控制命令协议)
       └→ Step 3 (Backend 下发控制事件)
            └→ Step 4 (Create Agent 触发启动)
                 └→ Step 5 (消息路由)
                      └→ Step 6 (WS 双向命令通道)
```

## 第一阶段：Polling 命令通道 + 1:N 架构

### Step 1: Daemon 1:N Runtime 管理

**目标**：将 `DaemonCore` 从单 runtime 改为多 runtime 管理。

**文件**：`agent/daemon/aaa-daemon/src/daemon/daemon.ts`

**改动**：

1. 将 `private runtimeDriver: ClaudeRuntimeDriver | null = null` 改为 `private runtimes: Map<string, ClaudeRuntimeDriver> = new Map()`
2. 将 `private runtimeSessionId: string | null = null` 改为 `private runtimeSessionIds: Map<string, string> = new Map()`
3. 新增方法：
   ```
   startRuntimeForAgent(agentId: string, config: RuntimeConfig): void
   stopRuntimeForAgent(agentId: string): void
   getRuntimeForAgent(agentId: string): ClaudeRuntimeDriver | undefined
   listActiveRuntimes(): Array<{ agentId: string; pid?: number; sessionId?: string; busy: boolean }>
   ```
4. 重构 `startClaudeRuntime()` → 接受参数创建 runtime 并存入 Map
5. 重构 `stop()` → 遍历 Map 停止所有 runtime
6. 重构 `deliverRuntimeMessage()` → 接受 agentId 参数，路由到对应 runtime
7. 重构 stall watchdog → 每个 runtime 独立的 watchdog

**文件**：`agent/daemon/aaa-daemon/src/daemon/client-handler.ts`

**改动**：如果 `handleMessage` 引用 `runtimeDriver`，需要改为通过 agentId 查找。

**验证**：
- `npm run build` 通过
- 单元测试：能创建/停止多个 runtime
- 手动测试：daemon 启动后能通过 CLI 命令启动多个 agent runtime

---

### Step 2: 控制命令协议

**目标**：定义 daemon 能识别和执行的控制命令类型。

**文件**：`agent/daemon/aaa-daemon/src/daemon/daemon.ts`

**改动**：

1. 新增控制命令类型定义：
   ```typescript
   interface DaemonControlCommand {
     type: 'start_runtime' | 'stop_runtime' | 'restart_runtime';
     agentId: string;
     config?: {
       runtime: string;
       runtimeModel?: string;
       runtimeCommand?: string;
       workspacePath?: string;
       backend?: string;
     };
   }
   ```
2. 在 `normalizeRuntimeIncomingMessage` 附近新增 `isControlCommand()` 判断
3. 新增 `handleControlCommand(command: DaemonControlCommand)` 方法：
   - `start_runtime` → 调用 `startRuntimeForAgent()`
   - `stop_runtime` → 调用 `stopRuntimeForAgent()`
   - `restart_runtime` → 先 stop 再 start
4. 在 inbox polling 处理流程和 WS 事件回调中加入控制命令的分支

**文件**：`agent/daemon/aaa-daemon/src/websocket.ts`

**改动**：

1. `eventsFromJsonRpc` 增加 `daemon.command.*` 的处理，返回 `{ type: 'control', command: ... }`
2. `eventFromRawPayload` 增加 `control` 类型的识别

**验证**：
- 能解析控制命令 JSON
- `handleControlCommand` 正确调用 start/stop/restart

---

### Step 3: Backend Events 端点下发控制事件

**目标**：backend 在 events 响应中混入控制命令，daemon polling 时拉取。

**文件**：`backend/routers/agent_api.py`

**改动**：

1. 新增控制命令模型：
   ```python
   class DaemonControlEvent(BaseModel):
       type: Literal["start_runtime", "stop_runtime", "restart_runtime"]
       agentId: str
       config: Optional[dict] = None
   ```
2. 在 events 端点中：
   - 查询该 computer 下是否有 `pending_runtime_start` 状态的 agent
   - 如果有，在 events 列表前面插入控制事件
   - 返回格式与现有 events 兼容，增加 `event_type: "control"` 字段
3. 新增数据库字段或状态标记：
   - agent workspace 增加 `pending_command` 字段（如 `"start_runtime"`）
   - 或者用现有 status 字段（`"pending_start"` → daemon 收到后更新为 `"starting"` → 最终 `"running"`）

**验证**：
- 手动设置 agent pending_command 后，polling 能返回控制事件
- daemon 收到控制事件后能正确解析

---

### Step 4: Create Agent 触发启动

**目标**：UI 创建 agent 后，backend 自动标记需要启动 runtime。

**文件**：`backend/routers/public_api.py`

**改动**：

1. `create_agent` endpoint 中：
   - 创建 agent workspace 后，不再硬编码 `status="stopped"`
   - 如果该 agent 的 computer 有已注册的 daemon，设置 `pending_command="start_runtime"`
   - agent 初始状态设为 `"pending_start"`
2. 返回中包含启动状态信息

**文件**：`backend/routers/agent_api.py`

**改动**：

1. daemon heartbeat 时，返回该 computer 下所有 pending 的控制命令
2. daemon 执行完控制命令后，backend 更新 agent 状态（`pending_start` → `running`）

**验证**：
- 创建 agent → 检查 pending_command 已设置
- daemon heartbeat → 返回控制事件
- daemon 执行 → agent 状态变为 running
- 端到端：创建 agent → 发消息 → 收回复

---

### Step 5: 消息路由

**目标**：daemon 收到聊天消息时，正确路由到对应 agent 的 runtime。

**文件**：`agent/daemon/aaa-daemon/src/daemon/daemon.ts`

**改动**：

1. `deliverRuntimeMessage()` 从消息中提取目标 agentId
   - WS 事件：从 `target` 字段解析（如 `target=#channel` → 查询 channel 的 agent 成员）
   - Proxy 事件：从 `X-Agent-Id` 头或事件体中获取
2. 根据 agentId 在 `runtimes` Map 中查找对应 driver
3. 如果找不到对应 runtime，记录日志并跳过
4. 更新 `deliverRuntimeMessage` 签名，接受 agentId 参数

**文件**：`agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts`（如需要）

**改动**：确保 proxy 的 `freshness_hold` 和 `message_received` 事件包含目标 agentId 信息。

**验证**：
- 多个 agent 同时在线时，消息正确路由
- 单个 agent 收不到发给其他 agent 的消息
- agent 不在线时消息不丢失（backend 保留，下次启动投递）

---

## 第二阶段：WebSocket 双向命令通道

### Step 6: Backend WebSocket 端点

**目标**：后端新增 daemon 专用的 WS 端点，替代 polling 实现控制命令推送。

**文件**：`backend/routers/agent_api.py`（或新增 `backend/routers/daemon_ws.py`）

**改动**：

1. 新增 WebSocket 端点 `/internal/agent-api/ws`
2. 认证：machine token（与现有 heartbeat 相同）
3. 连接管理：维护 `Map<computerId, WebSocket>` 连接池
4. 推送逻辑：
   - daemon WS 连接后，立即推送该 computer 下所有 pending 控制命令
   - `create_agent` 后直接通过 WS 推送 `start_runtime`
   - 如果 daemon 未连接，退回到 heartbeat/polling 兜底
5. 接收 daemon 消息：ack、activity、runtime 状态上报

**文件**：`agent/daemon/aaa-daemon/src/websocket.ts`

**改动**：

1. 连接目标：从 `wss://ws.slock.ai` 改为配置项（支持同时连接 Slock 官方 + 自己后端）
2. 认证头：machine token
3. 解析：增加 `control.*` / `daemon.command.*` 方法处理
4. 新增 `onControlCommand` 事件，`DaemonCore` 监听后调用 `handleControlCommand`

**验证**：
- daemon 连接后端 WS 成功
- 创建 agent → <1s daemon 收到 `start_runtime`
- WS 断线 → polling 兜底不丢命令
- WS 重连 → 拉取离线期间命令

---

## 实施顺序和并行度

```
Step 1 ──── Step 2 ──── Step 3 ──── Step 4 ──── Step 5 ──── Step 6
(Daemon)   (Daemon)    (Backend)   (Backend)   (Daemon)   (Backend+Daemon)
                                               (可并行)
```

- Step 1 和 Step 2 可以连续完成（都是 daemon 侧改动）
- Step 3 和 Step 4 可以连续完成（都是 backend 侧改动）
- Step 5 依赖 Step 1（需要 Map 结构就位）
- Step 6 依赖前面所有步骤（WS 是在完整流程上的传输层升级）

**预估工作量**：
- Step 1: ~2-3h（daemon 核心重构）
- Step 2: ~1-2h（协议定义 + 处理逻辑）
- Step 3: ~2-3h（backend 端点改造）
- Step 4: ~1-2h（create agent 流程）
- Step 5: ~1-2h（消息路由）
- Step 6: ~3-4h（WS 端点 + daemon 连接切换）

**总计**：~10-16h

## 风险和注意事项

1. **Step 1 是高风险点**：daemon 核心重构，需要仔细测试现有单 runtime 流程不回归
2. **消息路由需要 agentId 信息**：确保 backend 的 events/WS 事件包含足够的目标 agent 信息
3. **credential 管理**：1:N 模式下，每个 runtime 的 credential 可能不同（不同 agent 可能用不同 server），需要随 `start_runtime` 命令下发
4. **workspace 隔离**：每个 agent 的 workspacePath 必须独立，不能共享文件系统状态
5. **进程资源**：多个 Claude Code 子进程同时运行，注意 CPU/内存占用
