# 事件投递契约（Event Delivery Contracts）

> 运行时投递、事件过滤与活动/事件分离契约。

---

## 场景（Scenario）：活动/事件变更不得制造运行时噪声

### 1. 作用域（Scope）/ 触发条件

当代码改动以下任一项时使用本 spec：

- `ActivityLog` 的创建或 `ACTIVITY_EVENT_TYPES`
- `EventRecord` 的创建、事件类型别名或载荷（payload）形状
- daemon WebSocket / SSE / 轮询投递
- daemon 代理的事件缓冲或新鲜度检查
- 运行时消息格式化或投递
- 可能到达 agent 运行时的任务/消息/线程/提醒事件

### 2. 签名

- 后端事件存储：`event_records(server_id, seq, event_type, actor_id, channel_id, message_id, task_id, payload)`
- 后端活动存储：`activity_logs(server_id, agent_id, kind, description, details, channel_id, task_id)`
- 活动→事件映射：`routers/public_api.py` 中的 `PUBLIC_ACTIVITY_EVENT_TYPES`（supervisor_* 活动 kind → 点式公共事件类型）
- 事件类型归一化：`services/public_events.py` 中的 `PUBLIC_EVENT_TYPE_ALIASES` + `_event_scope()`；`routers/public_api.py` 中的 `EVENT_TYPE_ALIASES`（点式→旧式）
- daemon WS：`WS /internal/agent-api/ws?eventLogCursor=<seq>`
- agent 轮询/SSE：`/internal/agent-api/events`
- 运行时投递：`ClaudeRuntimeDriver.sendUserMessage()`
- 代理新鲜度：`readUpToSeq`、`seenUpToSeq`、待处理的 `message_received` 事件

### 3. 契约

- **活动是可观测性，不是工作。** `runtime_working`、`runtime_thinking`、`runtime_output`、`runtime_idle` 等运行时状态活动用于 UI/调试时间线。它们不得成为投递回同一运行时的提示词。
- **运行时诊断同样是可观测性，不是工作。** `runtime_warning` 与 `runtime_error` 仍是 `ActivityLog` 遥测，在运行时活动分组中可见。它们不得加入 `ACTIVITY_EVENT_TYPES`，不得转换为可执行的 `EventRecord` 行，也不得投递回运行时。
- **只有可执行事件到达运行时。** 只有具体的入站工作才允许运行时投递：可见的 `message.created`、已指派的 `task.created`、定向的 `thread.summary_requested` 以及显式控制命令。在本 spec 另有说明之前，新事件类型默认为非运行时。
- **自己产生的消息事件会被抑制（suppress），不投递给运行时。** `actor_id == receiving_agent.id` 的 `message.created` 不得投递回同一运行时；否则模型可能自问自答、浪费令牌（token）或循环。
- **定向事件是排他的。** 当存在 `payload.targetAgentId` 时，只有该 agent 可以接收事件。不要同时按频道成员关系广播。
- **工作区与心跳（heartbeat）事件不进入运行时收件箱。** `workspace.*`、daemon 心跳、由 register/heartbeat 派生的状态刷新以及高频活动只能更新状态/UI。
- **事件游标（cursor）越过不可见事件前进。** daemon 连接不应反复重新考虑不可见或被抑制的事件。游标处理必须越过它们前进，同时只投递可见/可执行的事件。
- **点式与旧式事件名必须在分类前归一化。** 对消息投递而言 `message.created` 与 `message_received` 等价；对已指派任务投递而言 `task.created` 与 `task_created` 等价。
- **非消息事件不得污染消息新鲜度。** 任务/线程/控制事件在可执行时可以投递给运行时，但不得作为待处理的未读（unread）消息阻塞后续发送。
- **运行时提示载荷必须小且可安全回复。** 被投递的消息事件必须包含用于回复的 `target` 和足以行动的上下文，但不得包含完整活动流或无关事件载荷。
- **运行时活动命令预览是摘要，不是全文转录。** `runtime_output.details.commandPreview` 必须可选且令牌安全。在后端存储或 UI 渲染之前，必须脱敏/移除 Slock 代理内部信息，例如 `SLOCK_AGENT_PROXY_URL`、`SLOCK_AGENT_PROXY_TOKEN`、`SLOCK_AGENT_PROXY_TOKEN_FILE`、`SLOCK_AGENT_ACTIVE_CAPABILITIES` 以及任何 `agent-proxy-tokens` 文件系统路径。它不得把绝对 wrapper 路径改写成看起来不同的语义命令。受管运行时实际执行的是 PATH 注入的短 `aura ...` 命令，因此活动可以在通用 200 字符截断生效之前如实展示真实工具输入。UI 的产品行为不得依赖完整命令文本。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 运行时上报 `runtime_idle` 活动 | 活动只出现在 UI/调试表面（surface）；没有运行时把它当作新回合接收。 |
| agent 发送消息 | `message.created` 持久化，但发送方运行时不会把自己的消息当作入站工作接收。 |
| 人类向单个 agent 发私信 | 只有接收方 agent 运行时收到事件；`target` 是 `dm:@<human>` 或带线程限定。 |
| 事件带 agent A 的 `targetAgentId` | agent A 收到；agent B/C 收不到，即使频道内可见。 |
| `workspace.heartbeat` 或 daemon 类心跳更新 | 只更新当前状态；不向运行时投递 `EventRecord`。 |
| 点式 `task.created` 指派给 agent | 作为可执行任务工作投递，但不设置待处理消息新鲜度。 |
| 未知的新事件类型 | 在合适处存储/可见，但在显式分类之前不投递给运行时。 |

### 5. 好/基准/坏案例

- 好：新增一个 UI 活动 kind 只改时间线渲染与 API 序列化。
- 好：新增一个运行时可执行事件时，同时更新后端可见性、daemon 分类、运行时格式化与测试。
- 基准：频道 `message.created` 事件投递给除 actor 外的可见 agent。
- 坏：把所有 `ActivityLog` kind 映射为 `EventRecord` 并经 daemon WS 推送。
- 坏：把 `EventRecord.actor_id` 当作 daemon 投递目标。
- 坏：把 `runtime_output` / `runtime_idle` 活动变更投递给产生它们的运行时。
- 坏：新增一种能到达 daemon WS 但缺少 `targetAgentId` 过滤或消息新鲜度分类的事件类型。

### 6. 必需测试

- `_event_visible_to_agent` / daemon 事件展开的后端可见性测试：
  - 自己产生的 `message.created` 对该 agent 被抑制。
  - `targetAgentId` 只投递给目标。
  - `workspace.*` 与 `thread.summary_updated` 不投递给运行时。
- daemon 代理分类测试：
  - 点式与旧式消息事件归一化为 `message_received`。
  - 点式任务事件是非消息运行时事件，不产生待处理消息新鲜度。
  - 未知事件被忽略或作为非运行时通知呈现，而不是提示词。
- 活动回归：
  - 运行时活动上报创建/更新活动表面，而不产生运行时工作。
  - `runtime_warning` / `runtime_error` 在运行时活动 UI 分组中保持可见，绝不变成运行时可执行事件。
  - 心跳/register 更新不产生高频活动/事件记录。
- 令牌回归：
  - 发送消息的运行时不会把自己的 `message.created` 事件当作新回合接收。
  - 包含 Slock 代理环境变量赋值的运行时工具命令或 wrapper 片段，不会在 `runtime_output.details.commandPreview` 中持久化这些环境变量名或 `agent-proxy-tokens` 路径。
  - PATH 注入的 `aura message send` 工具命令在代理密钥脱敏后保持不变；不靠仅活动侧的 wrapper 路径改写来制造短命令。

### 新增 EventRecord 类型 — 必需清单

当你通过扩展 `PUBLIC_ACTIVITY_EVENT_TYPES` + `PUBLIC_EVENT_TYPE_ALIASES` + `_event_scope()` 新增一个点式事件类型（例如 `member.created`、`foo.updated`）时，必须验证运行时投递门禁，而不只是 SSE 浏览器扇出（fanout）：

1. **作用域处理器** — 在 `services/public_events.py` 的 `_event_scope()` 中加一个分支，让事件带有有意义的 `scope`（`{kind, id}`）。前端按作用域过滤；缺少分支会产生 `scope={kind:"server"}`，可能过度投递或投递不足。
2. **运行时门禁** — 确认 `agent/daemon/aaa-daemon/src/daemon/daemon.ts` 处的 daemon 代理会丢弃它。门禁是 `event_received` 处理器内的 `isRuntimeActionableEventType(eventType)`：只有 `task_created`/`task.created`/`thread_summary_requested` 会到达 `deliverRuntimeMessage`。仅 UI 事件（`member.*`、`workspace.*`、`computer.*`、`reminder.*`）不得加入该允许列表，除非该事件确实是可执行的运行时工作。
3. **消息新鲜度** — 确认新类型不是 `message.*`，这样它不会污染代理中的待处理消息新鲜度。
4. **别名单对称** — 如果客户端依赖旧名称，需在 `EVENT_TYPE_ALIASES`（后端 `public_api.py`）与 daemon 的 `_dotted_event_type` / `_legacy_event_type` 映射中同时加入点式→旧式配对。

经验来源：任务 `06-22-06-22-frontend-realtime-sync-fixes` 为成员页自动刷新添加了 `member.created`。它是仅 UI 事件；daemon 代理门禁正确丢弃了它，因此没有运行时收到虚假回合。

### 7. 错误 vs 正确

#### 错误

```text
ActivityLog(kind="runtime_idle") -> EventRecord(event_type="runtime.idle") -> daemon WS -> runtime prompt
```

这把运行时自己的遥测喂回给它，在没有用户工作的情况下烧掉令牌。

#### 正确

```text
Runtime stream event -> ActivityLog(kind="runtime_idle") -> Activity tab / trace only
```

只有具体的入站工作才有资格进行运行时投递。

---

## 场景：新增事件类型

引入新事件类型之前，在代码评审中回答这些问题：

1. 它是仅存储/UI，还是需要某个运行时对其执行动作？
2. 如果是运行时可执行，精确的目标 agent 是谁？
3. 它需要 `targetAgentId`、`channelId`、`messageId`、`taskId` 或 `threadId` 吗？
4. 它应该影响消息新鲜度 / 待处理发送吗？
5. 它需要在重连时重放，还是只需实时投递？
6. 什么机制防止自回显循环？
7. 哪些 WebDriver/API/DB/trace 证据能证明事件到达了正确的位置且别无他处？

如果任一答案不明确，暂不要把该事件投递给运行时。

---

## 场景：运行时控制结果必须归属于被投递的控制回合

### 1. 作用域 / 触发条件

- 触发：改动 `daemon/runtime_control`、provider 斜杠命令映射、`ManagedRuntimeDriver.sendUserMessage(..., { control: true })`，或为 context/usage/compact 观测采集 provider `stream_event` 输出。

### 2. 签名

- 请求：`DaemonRuntimeControlCommand { action, agentId, workspaceId?, waitForResult?, timeoutMs? }`。
- 投递：`ManagedRuntimeDriver.sendUserMessage(slashCommand, { control: true }): boolean`。
- 结果：`DaemonRuntimeControlResult { accepted, delivered, action, agentId, runtime?, slashCommand?, reason?, output?, outputTruncated?, error? }`。
- 集成门禁消费方：`parseRuntimeControlEvidence(result)`，随后针对所选规范 `runtime` 与 `agentId` 做目标关联。
- 输出预算：每个控制结果最多捕获 65,536 个字符。

### 3. 契约

- 运行时控制命令是仅即时的。忙碌或尚不可写的驱动返回 `false`，且不得把 `{ control: true }` 输入排入后续回合的队列。
- `accepted=true` 表示 daemon 识别并支持所请求的动作；`delivered=true` 另行证明 provider 运行时立即接受了该斜杠命令。
- daemon 可以在发送前先布好结果收集器，以免错过快速的异步输出，但只有当 `sendUserMessage` 返回 `true` 时收集器才有效。
- 忙碌状态返回 `delivered=false, reason=runtime_control_busy`，不调用 `sendUserMessage`，也不订阅共享流。
- 发送返回 false 时返回 `delivered=false, reason=runtime_control_not_delivered`；发送抛错时返回其净化后的错误。两条路径都立即分离收集器。
- 助手文本只捕获到控制输出预算为止。多余文本被丢弃并返回 `outputTruncated=true`。超时、结果、发送失败与被拒绝的投递都恰好分离监听器一次。
- provider 流事件目前不携带跨运行时的控制回合标识。因此排队投递必须失败关闭（fail-closed）；与之后第一个 `assistant` 或 `result` 事件的时间相近不是关联证明。
- 任何把运行时控制结果用作门禁证据的外部消费方，都必须要求 `result.runtime`（已规范化）与 `result.agentId` 同时匹配所选运行时 profile 与确切的工作区 Agent。身份缺失或不匹配会以 `RUNTIME_CONTROL_TARGET_MISMATCH` 使其 context/limit 证据失效；来自另一运行时的静态结果绝不能满足目标门禁。

### 4. 校验与错误矩阵

| 条件 | 预期结果 |
| --- | --- |
| 运行时或工作区缺失 | `accepted=false`、`delivered=false`、明确的 runtime/workspace 原因。 |
| 运行时忙碌 | `accepted=true`、`delivered=false`、`reason=runtime_control_busy`、无排队控制输入。 |
| 尽管发送前检查为空闲，驱动仍返回 `false` | `accepted=true`、`delivered=false`、`reason=runtime_control_not_delivered`，收集器已分离。 |
| 驱动发送时抛错 | `delivered=false`，返回错误，收集器立即分离。 |
| 助手输出超过 65,536 字符 | 输出封顶为 65,536 字符且 `outputTruncated=true`。 |
| 匹配的即时控制回合发出 `result` | 收集器返回有界输出并分离。 |
| 有界超时前没有结果 | `reason=runtime_control_timeout`；可能返回部分有界输出，监听器分离。 |
| 门禁证据缺失或不匹配 `runtime` / `agentId` | 不要消费其 context 或 limit 字段；以 `RUNTIME_CONTROL_TARGET_MISMATCH` 使适用的 context 步骤失败。 |

### 5. 好/基准/坏案例

- 好：空闲的 Claude 运行时接受 `/context`，发出助手文本与结果，daemon 以 `delivered=true` 返回该有界文本。
- 基准：忙碌运行时返回 `runtime_control_busy`；调用方可在观察到空闲后重试。
- 坏：把 `/status` 排在既有用户回合之后，并把该回合之后第一个 `result` 事件当作状态响应。
- 坏：stdin 发送抛错后仍让收集器挂到超时。
- 坏：在没有控制面大小预算的情况下追加 provider 文本。
- 坏：从 Codex 加载静态 `/status` 结果并当作 Claude `/context` 证据，只因为两个输出都含百分比。

### 6. 必需测试

- daemon 边界测试必须断言忙碌控制不会调用 send、不会消费无关输出、也不会保留 `stream_event` 监听器。
- 发送抛错与返回 false 的测试必须断言立即清理监听器以及显式的投递/错误状态。
- 输出预算测试必须发出超过 65,536 字符并断言精确上限加 `outputTruncated=true`。
- Claude 与 Codex ACP 驱动测试必须断言普通用户消息在忙碌时仍排队，而控制消息不排队。
- 成功的 JSON-RPC 控制结果测试必须继续证明立即投递的命令会捕获其真实 provider 输出。
- 集成门禁测试必须证明匹配的 `runtime + agentId` 证据通过，不匹配的静态/动态证据失败关闭且不消费其 context 用量。

### 7. 错误 vs 正确

#### 错误

```typescript
const result = collectFirstGlobalResult(driver);
const delivered = driver.sendUserMessage('/status', { control: true });
// delivered=false may mean queued; the next result can belong to older work.
return result;
```

#### 正确

```typescript
if (driver.busy) return { accepted: true, delivered: false, reason: 'runtime_control_busy' };
const collector = collectBoundedControlResult(driver);
const delivered = driver.sendUserMessage('/status', { control: true });
if (!delivered) {
  collector.settle({ reason: 'runtime_control_not_delivered' });
  return { accepted: true, delivered: false, reason: 'runtime_control_not_delivered' };
}
return collector.promise;
```

#### 错误

```javascript
report.contextUsage = parseRuntimeControlEvidence(file).contextUsage;
```

#### 正确

```javascript
const evidence = correlateRuntimeControlEvidence(parseRuntimeControlEvidence(file), {
  runtime: targetRuntime,
  agentId: selectedAgentId,
});
report.contextUsage = evidence.contextUsage; // absent on identity mismatch
```

---

## 场景：浏览器公共实时 SSE 事件

### 1. 作用域 / 触发条件

- 触发：新增或改动 `GET /api/v1/events/stream` 下的浏览器侧实时事件。
- 这与 daemon/运行时投递相互独立。浏览器事件唤醒产品 UI 表面；运行时事件只有被上述运行时投递契约显式分类后才变成模型工作。

### 2. 签名

- 公共流：`GET /api/v1/events/stream?scopeKind=<kind>&scopeId=<id-or-name>`
- 认证：仅通过 `X-Public-Key` 的公共 API 认证。查询串中可复用的凭证会被拒绝。
- 响应媒体类型：`text/event-stream`。
- 后端信封（envelope）：
  - `id: string`
  - `type: string`
  - `scope: {kind: channel|dm|task|workspace|member|computer|server, id?: string, name?: string}`
  - `seq: number`
  - `epoch: string`
  - `createdAt: string`
  - `payload: object`
- 本地扇出：`services.public_events.public_event_hub`。
- 跨进程接缝：Postgres `LISTEN/NOTIFY` 通道 `smallkhoj_public_events`。

### 3. 契约

- 公共浏览器事件派生自已提交的 `EventRecord` 行。数据库仍是事实来源；流是唤醒/补齐路径。
- 只有在写事务提交且被变更资源可通过公共 API 刷新之后，才发布浏览器事件。
- 浏览器事件载荷必须保持产品安全。不得暴露 daemon 控制命令、运行时提示信封、本地代理密钥、机器令牌或原始 provider 日志。
- `seq` 目前使用持久的 `EventRecord.seq`，它是服务器全局且单调的。前端补齐可在出现明显缺口时重新拉取；未来按作用域的序列化必须保留相同的信封字段名。
- `epoch` 在后端进程重启时变化，让客户端可以重新拉取/重置高水位状态。
- SSE 在空闲保活时必须发心跳注释而非数据事件。
- 订阅者队列必须在断开时清理。
- 除非后续生产就绪 spec 明确更改扇出决策，否则不得为此流引入 Redis。
- Postgres 扇出必须校验 NOTIFY 通道标识符，并使载荷保持在 Postgres NOTIFY 载荷上限之内。
- 压缩与最小化的 Postgres NOTIFY 信封必须同时以顶层 `serverId` 与 `payload.serverId` 保留所选 Server 身份。跨进程 SSE 授权使用该身份；丢掉它会让其余每个后端 worker 丢弃一个本有效的事件。如果连承载身份的最小信封都装不进载荷上限，就在调用 `pg_notify` 之前失败。
- `POST /internal/agent-api/daemon/connect` 在提交后无条件发出 `computer.status.updated`（动作 `"connect"`）——即使状态串保持 `online` → `online`。只有 `daemon/register`/`daemon/heartbeat` 按实际状态变化设门（08-03 任务 `08-03-computer-connect-ux`）：`/computers` 页依赖 `RealtimeRefresh` 收到该事件来在 daemon 连接后自动刷新，而"仅在变化时"发布会为全新连接悄悄重新引入手动刷新 bug。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 公共 API key 缺失/无效 | 经 `verify_public_api_key` 返回 HTTP 401。 |
| 客户端断开 | 订阅队列从进程内 hub 移除。 |
| 空闲流 | 在配置的心跳间隔内发出 `: heartbeat` 注释。 |
| 重复事件 id 到达本地 hub | 重复被近期 id 记忆丢弃。 |
| 作用域过滤器不匹配 | 事件不会交付给该订阅者。 |
| Postgres NOTIFY 通道含不安全字符 | 适配器构造以 `ValueError` 失败。 |
| 事件载荷超过 NOTIFY 载荷预算 | 适配器在发送超限载荷前发布失败。 |
| 大型 Server 作用域事件被压缩 | `serverId` 在顶层与 `payload` 中仍可用；同 Server 订阅者能收到，异 Server 订阅者拒绝。 |
| daemon `/connect` 在状态串不变时提交 | 提交后仍发布 `computer.status.updated`（动作 `connect`）；register/heartbeat 保持仅状态变化才发布的门控。 |

### 5. 好/基准/坏案例

- 好：来自公共 API 或 agent API 的 `message.created` 提交一条 `EventRecord`，然后发布带频道作用域与消息载荷的浏览器信封。
- 好：`task.updated`、`member.status.updated`、`workspace.updated` 与表情回应更新复用同一流端点与信封。
- 基准：本地开发使用进程内 hub，在单个后端进程下工作。
- 基准：生产形态的部署可以在同一公共事件信封背后使用 Postgres `LISTEN/NOTIFY`。
- 坏：客户端需要公共 API 头时使用浏览器原生 `EventSource`。
- 坏：把 daemon WebSocket/控制面载荷直接发到 `/api/v1/events/stream`。
- 坏：为本任务添加 Redis 作为必需服务。

### 6. 必需测试

- 单元：事件信封包含 `id`、`type`、`scope`、`seq`、`epoch`、`createdAt` 与 `payload`。
- 单元：心跳/注释与 SSE 帧格式。
- 单元：进程内 hub 的作用域过滤与订阅者清理。
- 单元：Postgres NOTIFY 接缝校验通道名并构造 `pg_notify`。
- 单元：压缩与最小 NOTIFY 信封保留 Server 身份；对最小信封而言过大的身份会被拒绝。
- API：`/api/v1/events/stream` 在公共认证下返回 `text/event-stream` 与就绪帧。
- 集成/真机测试：agent 创建的聊天消息无需手动刷新即出现在已打开的浏览器中。

### 7. 错误 vs 正确

#### 错误

```text
Agent/runtime EventRecord -> daemon prompt envelope -> browser stream
```

这把运行时特定的投递语义泄漏进产品 UI，并有暴露控制面细节的风险。

#### 正确

```text
Committed EventRecord -> public event envelope -> /api/v1/events/stream -> frontend projector/refetch
```

浏览器流保持产品安全，并与运行时提示投递相互独立。

---

## 场景：PostgreSQL 扇出与 SSE 资源所有权

### 1. 作用域 / 触发条件

- 触发：改动 PostgreSQL `LISTEN/NOTIFY`、浏览器或 agent SSE 路由、数据库连接池规模、后端 worker 数量、重连逻辑或应用 lifespan 启动/关闭。

### 2. 签名

- 进程属主：`services.public_events.PostgresNotifyRuntime`。
- lifespan 入口：`start_postgres_public_event_listener()` 与 `stop_postgres_public_event_listener()`。
- 发布者池 application name：`smallkhoj-notify-publisher`。
- 监听者 application name：`smallkhoj-notify-listener`。
- 公共流：`GET /api/v1/events/stream`。
- agent 流：`GET /internal/agent-api/events/stream`。
- 冻结的 agent 声明：`AgentEventStreamClaims(member_id, server_id)`。
- 连接预算：`(DATABASE_POOL_SIZE + DATABASE_MAX_OVERFLOW + NOTIFY_PUBLISHER_POOL_SIZE + 1 listener) * BACKEND_WORKERS + BETTER_AUTH_DATABASE_POOL_SIZE + (DATABASE_POOL_SIZE + DATABASE_MAX_OVERFLOW) Feishu-worker reserve + POSTGRES_CONNECTION_HEADROOM <= POSTGRES_MAX_CONNECTIONS`。

### 3. 契约

- 一个后端进程最多持有一个发布者池与一个监听者代。重复启动/停止是幂等（idempotent）的。
- 发布者获取/执行失败会关闭失败的池，在恢复锁下创建一个替代池，并只在 `NOTIFY_PUBLISH_ATTEMPTS` 与操作超时内重试。它不得为每个事件打开一条未预算的裸连接。
- 监听者连接终止会转入降级/重连状态，恢复 `LISTEN`，并拒绝旧代捕获的回调。
- 监听者、回调任务、发布者池与连接关闭都受 `NOTIFY_SHUTDOWN_TIMEOUT_SECONDS` 约束；关闭不得无限等待。
- 请求作用域的 `AsyncSession` 与活的 ORM 实体不得逃逸进 `StreamingResponse`。setup/auth 在函数作用域依赖下冻结基本标识符；agent 轮询每次轮询打开一个短会话，并在关闭前序列化帧。
- 公共浏览器流在 setup 之后基于队列，只捕获所选 Server id、作用域过滤器、请求取消状态与队列。
- 队列容量有界。队列溢出可以尽力而为/丢弃并带可观测日志；不得无限增长。
- 该预算是部署级的，不只是后端的。Better Auth 持有一个带显式已验证上限的进程级 `pg.Pool`。可选的飞书 worker 是独立的 SQLAlchemy 进程，即使其 Compose profile 被禁用也保留预算。运维余量不能替代任一服务池。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 发布者连接被终止 | 在配置的尝试/超时预算内替换池并重试；成功后恢复健康。 |
| 监听者连接被终止 | 以有上限的退避重连，恢复 `LISTEN`，下一个事件恰好投递一次。 |
| 已停止代的回调触发 | 忽略它；不发布。 |
| 关闭时资源卡住 | 记录超时日志，在支持处终止，并完成有界关闭。 |
| 所需连接预算超过容量 | 设置校验在启动前失败，并给出所需/容量/worker 详情。 |
| SSE 请求保持打开 | 其 setup 依赖已终结；普通查询可以获取连接池。 |
| agent 两次轮询之间流失身份 | 拒绝/终止轮询路径，不保留失效（stale）ORM 状态。 |

### 5. 好/基准/坏案例

- 好：在一次性 PostgreSQL 中终止真实监听者与发布者 PID；新 PID 出现，后续两个事件各到达一次，双重停止后命名属主连接为零。
- 好：在 SQLAlchemy `pool_size=1,max_overflow=0` 下，保持任一流打开并从独立会话执行 `SELECT 1`。
- 基准：瞬态通知在有界重试预算后被丢弃，而持久的 `EventRecord` 仍是事实来源。
- 坏：为每个已提交事件 `asyncpg.connect()`、无限裸连接兜底，或为掩盖被保留的 SSE 会话而加大 SQLAlchemy 池。
- 坏：流闭包从请求 setup 捕获 `db`、`Member` 或 `Server`。

### 6. 必需测试

- 单元状态测试：幂等生命周期、发布者替换、监听者终止回调、失效代拒绝、重连上限与有界关闭。
- 真实 PostgreSQL：终止命名的发布者/监听者连接，观察替换/恰好一次投递，并断言停止后属主连接为零。
- 受控 ASGI/HTTP：在流保持打开时观察就绪帧后 `get_db` 的终结，然后断开并断言订阅/任务清理。
- 极小真实池：公共与 agent 流保持打开时独立查询成功。
- 配置：完整的后端 + Better Auth + 飞书 worker + 余量预算接受文档默认值，把三个后端 worker 计算为 84 连接，并拒绝容量 83。

### 7. 错误 vs 正确

#### 错误

```text
request session -> StreamingResponse closure -> open for hours
event commit -> new asyncpg TCP connection -> pg_notify -> close
```

#### 正确

```text
short setup session -> frozen claims -> dependency finalized -> bounded stream state
lifespan owner -> publisher pool + generation-guarded listener -> bounded recovery/shutdown
```

---

## 场景：聊天读取游标 API 契约

### 1. 作用域 / 触发条件

- 触发：改动 `POST /api/v1/chat/read-cursors` 的请求解析、作用域解析、`lastReadSeq` 校验、`lastSeenMessageId` 归属检查、游标单调性或其测试。
- 证据簇：四个 07-06 任务（`chat-read-cursor-last-read-seq-input-hardening`、`chat-read-cursor-thread-last-seen-contract`、`chat-read-cursor-request-body-scope-hardening`、`chat-read-cursor-postgres-monotonic-scope-completion`）。

### 2. 签名

- 端点：`POST /api/v1/chat/read-cursors`
- 作用域请求体：`{scope: {kind: "channel"|"dm"|"thread", channelId?: <uuid>} | {kind: "thread", rootMessageId: <uuid>}}`
- 游标字段：`lastReadSeq` / `last_read_seq`（int），可选 `lastSeenMessageId`（仅 thread）
- 存储：`channel_members.last_read_seq`（频道 + 私信）、`chat_thread_read_cursors.last_read_seq` / `last_seen_message_id`（thread）
- 旧式兜底：缺少 `scope` 但带顶层 `{"kind":"thread","threadId":...}` 仍然接受
- 辅助函数：`mark_channel_read(...)`、`upsert_thread_read_cursor(...)`

### 3. 契约

- `lastReadSeq` 解析必须经过具名校验辅助函数，绝不用裸的 `int(body.get("lastReadSeq") or ...)`。接受：字段缺失 -> `0`；整数 `0`；正整数；去除首尾空白后的纯数字字符串（`"12"`）。以 HTTP 400 拒绝：空/仅空白字符串、负整数或负数字符串、浮点或浮点样式字符串、布尔、对象、数组、显式 `null`。
- 键优先级：`lastReadSeq` 存在则优先；否则 `last_read_seq`；否则默认 `0`。同一个校验值馈入频道、私信与 thread 写路径。
- 请求体与 `scope` 形状校验发生在任何 `.get(...)` 访问之前、数据库写入/提交之前：非对象 JSON 请求体（`null`、数组、字符串、数字、布尔）与存在但非对象的 `scope` 值（`null`、数组、字符串、布尔、数字）返回稳定的 400——绝不让 `AttributeError`/500 泄出。缺少 `scope` 但符合顶层 thread 兜底形状仍然有效。
- 单调性：合法的更低（回退）写入返回 HTTP 200，但相对于高水位是 no-op——`last_read_seq` 保持较高的现有值，thread 游标还额外保留现有 `last_seen_message_id`。输入校验只改变合法性，绝不改变单调语义。
- thread `lastSeenMessageId` 归属：仅当 `message.id == root.id` 或 `message.parent_id == root.id`（根消息本身或直接回复）时接受。畸形 UUID、消息缺失、别的 thread 的根、或 `parent_id` 指向另一个根的回复 -> 400 且不提交数据库。`last_seen_message_id` 上的数据库外键只证明存在性，绝不证明 thread 归属——路由层校验才是真正的门禁。
- 作用域序列化是稳定的：频道 -> `{kind:"channel", channelId}`，私信 -> `{kind:"dm", channelId}`，thread -> `{kind:"thread", rootMessageId}`。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| `lastReadSeq` 缺失 | 视为 `0`；请求继续。 |
| `lastReadSeq` `"12"`（数字字符串） | 去空白后接受。 |
| `lastReadSeq` 空串 / 空白 / 浮点 / 布尔 / 负数 / 数组 / 对象 / 显式 null | HTTP 400，稳定明细（`Invalid lastReadSeq`）；不写入任何内容。 |
| 请求体是非对象 JSON（`null`/数组/字符串/数字/布尔） | HTTP 400，稳定的请求体形状错误，不是 500。 |
| `scope` 存在但不是对象 | HTTP 400，稳定的 scope 形状错误，发生在数据库提交前。 |
| `scope` 缺失但符合顶层 thread 兜底形状 | 接受（旧式兼容）。 |
| 合法的回退私信/频道/thread 写入 | HTTP 200；持久化的 `last_read_seq`（以及 thread `last_seen_message_id`）不变。 |
| thread `lastSeenMessageId` = 根或直接子回复（`parent_id == root.id`） | 持久化。 |
| thread `lastSeenMessageId` 畸形 / 缺失 / 其他 thread / 非直接回复 | HTTP 400；不提交。 |

### 5. 好/基准/坏案例

- 好：`{"scope":{"kind":"thread","rootMessageId":R},"lastReadSeq":"15","lastSeenMessageId":<direct-reply-id>}` 返回 200 并持久化两个字段。
- 基准：seq 100 之后的更早频道写入返回 200，游标仍停在 100。
- 坏：`int(body.get("lastReadSeq") or 0)` 把 `""`/`-5`/`1.5`/`true` 静默强转为合法 seq。
- 坏：信任 `chat_thread_read_cursors.last_seen_message_id` 外键作为消息属于该 thread 的证明。
- 坏：`.get()` 作用在非对象请求体上泄出的畸形请求体 500，或运行在服务写入之后的校验。

### 6. 必需测试

- 路由 HTTP 测试按作用域类型（频道、私信、thread）覆盖完整的畸形/负值矩阵，在任何游标写入前返回 400。
- 请求体/scope 形状测试证明非对象请求体与非对象 `scope` 值得到稳定 400，且顶层 thread 兜底仍有效。
- 单调性、跨作用域拒绝（如对私信频道使用 channel kind）、last-seen 归属与未授权/缺会话拒绝必须穿过真实 ASGI 边界针对临时 PostgreSQL 运行——处理器伪造与源码断言（`assert "int(body.get" not in source`）是补充，不是替代。跳过的 Postgres 套件不算通过。
- thread 回退测试断言 `last_read_seq` 与 `last_seen_message_id` 都在更早写入后保持不变。

### 7. 错误 vs 正确

#### 错误

```python
last_read_seq = int(body.get("lastReadSeq") or body.get("last_read_seq") or 0)
scope = body["scope"]          # AttributeError -> 500 on list/null bodies
await upsert_thread_read_cursor(db, root_id, uuid.UUID(body.get("lastSeenMessageId")))
```

#### 正确

```python
body = require_json_object(await request.json())      # stable 400 on non-object
scope = parse_read_cursor_scope(body)                 # stable 400 on bad scope shape
last_read_seq = parse_last_read_seq(body)             # named helper; matrix above
validate_thread_last_seen(db, root, body.get("lastSeenMessageId"))  # 400 pre-commit
```
