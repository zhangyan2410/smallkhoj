# Agent Team、Mailbox 与外部 Agent Runtime 控制边界调研

> **调研已于 2026-07-15 收束。** 对产品决策请优先阅读精简的 [core-conclusion.md](core-conclusion.md)。本文保留完整的资料、推导、实验前假设和第一轮实验记录，供追溯而非继续扩大探针范围。

> 状态：调研已收束；不再进行新的 Provider 探针或生产实现。
> 日期：2026-07-13 至 2026-07-15
> 所属任务：`07-13-agent-runtime-capability-matrix`
> 说明：本文保留前期假设和调研脉络；第一轮真实结果以 `provider-capability-matrix.md` 和其链接的 sanitized evidence 为准。模型 thought/message chunk 与原始 Provider transcript 只短暂存在于 `/tmp`，不会被写入本任务目录。

参考项目的独立核对与“复用 / 适配 / 拒绝”决策见：[`research/reference-project-runtime-patterns.md`](research/reference-project-runtime-patterns.md)。

## 1. 执行摘要

最初的问题来自 SmallKhoj 中 Agent 的协作可靠性：一个 Agent 在执行长任务、经历多轮上下文压缩后，可能忘记主动调用 `slock message check`，从而没有处理别人对它的 `@`，最终 runtime 又显示为 idle。

前期调研首先比较了腾讯 WorkBuddy、QoderWork/Qoder Experts、Qoder Cloud Managed Agents 和 AgentScope 的多 Agent 模式。它们在产品层面普遍采用：

```text
用户目标
  ↓
Leader / Coordinator
  ↓ 拆解、分派、并行或串行调度
多个独立专家 / Child Agent
  ↓ 定向回传结果
Leader 汇总与交付
```

Qoder Cloud Managed Agents 进一步公开了 `Session Thread + Mailbox + Scheduler`：Coordinator 通过 `create_agent`、`send_to_agent` 等工具向 Child Thread 投递消息，Child 通过 `send_to_parent` 回报，服务端 Mailbox 根据 Thread 状态调度消息。

这个参考一度促成了一个过强的初步设想：为 SmallKhoj 建立 `pending → leased → running → handled` 的持久 Mailbox 状态机，并提供可挂起的 `wait` 和 Agent RPC。

随后讨论指出了决定性的真实差距：

> WorkBuddy、Qoder Cloud 和 AgentScope 的团队机制建立在它们拥有 Agent Loop 的前提上；SmallKhoj 当前主要托管 Codex、Claude Code、Kimi Code、ZCode、OpenCode 等厂商 Agent 工具。SmallKhoj 能启动进程、输入 prompt、观察输出、恢复部分 session，但未必能控制这些工具内部的 turn、tool loop、compaction 或暂停恢复。

因此，本文的修正结论是：

1. **不能把 first-party Agent 的 Thread 状态机直接照搬给 vendor Agent CLI。**
2. **SmallKhoj 必须区分自己拥有的 Work Item/Invocation，与 Provider Session/Turn/Tool Loop。**
3. **Portable Mailbox 的第一承诺应缩小为“可靠地安排下一次调用”，而不是“可靠地暂停、插入并恢复当前 turn”。**
4. **`wait` 的 common-denominator 语义是 scheduler 在两次 invocation 之间等待；跨 Agent 的依赖结果通过后续 invocation 回调，而不是冻结 vendor Agent 内部调用栈。**
5. **只有 Provider 明确提供 turn API 时才能启用 steer/interrupt；真正的 durable continuation 通常需要 Pi 或自研/open-source owned Agent Loop。**
6. **真实实验必须先回答每个 Adapter 到底能控制什么，再冻结 Mailbox、wait 和 RPC 的产品承诺。**

## 2. 原始问题与范围演进

### 2.1 最初联想：Reminder 与消息总线

讨论最初从 daemon 的 Reminder 能力开始：Reminder 可以在未来触发并重新唤醒安排它的 Agent，因此自然联想到是否能把 Agent 通信改造成类似 NATS 的发布/订阅。

随后范围被收窄：Reminder/定时并不是当前核心，真正需要研究的是 WorkBuddy 和 QoderWork 的 Agent Team 模式，以及它们如何分派和回传任务。

### 2.2 第二次收窄：不是 NATS，而是可靠 RPC/Mailbox

进一步讨论后，目标不再是广播式 pub/sub，而是：

- 一个 Agent 对另一个 Agent 发起定向请求；
- 请求不会因为接收者正在忙或模型忘记检查消息而消失；
- 接收者在合适时机被可靠唤醒；
- 发起者能够等待或在未来收到相关结果；
- 系统而不是 Prompt 承担投递可靠性。

### 2.3 关键纠正：SmallKhoj 不拥有多数 Agent Loop

第一次架构推演把 Qoder 的 first-party Thread/Mailbox 能力过度映射到了 SmallKhoj。用户指出：

- SmallKhoj 的真实用户主要会连接 Codex、Claude Code、Kimi Code、ZCode 等完整 Agent 工具；
- 这些工具不是一层裸模型 API，而是厂商自己的 Agent harness；
- SmallKhoj 可能可以输入和读取输出，但不一定能暂停、恢复或操纵其内部 turn；
- 如果未来采用 Pi 或其他开源 Agent Base，SmallKhoj 才可能真正拥有 Agent Loop，但那是另一种产品运行模式。

本任务由此从“设计完整 Durable Mailbox”改为“先建立 Runtime Capability Matrix 和 Reliable Wakeup Boundary”。

## 3. 术语与证据等级

### 3.1 本文中的层次

为避免把不同系统里的 `turn` 混为一谈，本文使用下列术语：

| 术语 | 定义 | 典型所有者 |
| --- | --- | --- |
| Business Work Item | SmallKhoj 中需要某个 Agent 行动的业务工作，例如 `@`、DM、Task assignment、RPC result | SmallKhoj |
| Dispatch Attempt | SmallKhoj 将一个 Work Item 提交给某个 Runtime Adapter 的一次尝试 | SmallKhoj |
| Adapter Invocation | 一次 CLI 进程、ACP prompt、HTTP prompt 或 app-server turn 请求 | SmallKhoj + Adapter |
| Provider Session | Codex/Claude/Kimi/OpenCode 保存的可恢复对话或执行上下文 | Provider |
| Provider Turn | Provider 对一次用户输入执行的推理/工具循环边界 | Provider |
| Tool Loop | 模型输出 tool call、Agent harness 执行工具、结果再次送回模型的内部循环 | Provider 或 owned loop |
| Model Generation | 单次底层模型生成 | Model provider |

### 3.2 证据标签

本文结论按来源区分：

- **[官方]**：厂商官网、官方文档或当前官方二进制公开的协议 schema。
- **[社区实操]**：有运行截图或案例，但不是厂商正式协议承诺。
- **[仓库事实]**：SmallKhoj 当前代码、测试或 `.trellis/spec/` 明确规定的行为。
- **[本机事实]**：本机已安装 CLI 的版本、`--help` 或生成的协议 schema。
- **[架构推论]**：从事实推导出的设计判断，不等价于已经验证的运行行为。
- **[待实验]**：必须通过真实 Provider 调用验证，不能靠文档或代码静态推断。

## 4. 外部 Agent Team 调研

## 4.1 腾讯 WorkBuddy

### 4.1.1 官方公开的产品模式

**[官方]** 腾讯 WorkBuddy 官方页将产品描述为：

- “一人指挥，全行业专家执行”；
- 100+ 领域专家组成虚拟团队；
- 多专家、多模型协同；
- 多专家并行协作；
- 从策略到交付一站完成。

官方给出的软件开发团队示例具有典型工序：

```text
产品经理定需求
  ↓
架构师设计并拆任务
  ↓
工程师批量实现
  ↓
QA 验证
  ↓
最终交付
```

来源：[WorkBuddy 官方页](https://www.codebuddy.cn/work/)

### 4.1.2 专家、Skill 与专家团

**[社区实操]** WorkBuddy 实战蓝皮书将几种能力区分为：

| 能力 | 实质 |
| --- | --- |
| 普通任务 | 通用 Agent 完成一次明确工作 |
| Skill | 稳定执行某个动作或方法 |
| 专家 | 人设 + 方法论 + 工具链 |
| 专家团 | 团长 + 多专家 + 协作流程 |

专家团由团长负责：

- 理解总目标；
- 拆解子任务；
- 决定并行或串行；
- 选择专家；
- 检查中间产物；
- 在关键点请求用户确认；
- 汇总最终交付。

来源：

- [WorkBuddy 专家和专家团](https://github.com/AlephAITech/WorkBuddyGuide/blob/main/docs/bluebook/%E7%AC%AC%E4%B8%80%E7%AF%87%20%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C%EF%BC%9A%E5%85%88%E6%8A%8A%20WorkBuddy%20%E7%94%A8%E8%B5%B7%E6%9D%A5/%E7%AC%AC%206%20%E7%AB%A0%20WorkBuddy%E7%9A%84%E4%B8%93%E5%AE%B6%E5%92%8C%E4%B8%93%E5%AE%B6%E5%9B%A2/index.md)
- [WorkBuddy 多 Agent 系统设计案例](https://github.com/AlephAITech/WorkBuddyGuide/blob/main/docs/bluebook/%E7%AC%AC%E4%B8%89%E7%AF%87%20%E8%BF%9B%E9%98%B6%E7%AF%87%EF%BC%9A%E6%8A%8A%E6%A1%88%E4%BE%8B%E5%8F%98%E6%88%90%E8%87%AA%E5%B7%B1%E7%9A%84%E5%B7%A5%E4%BD%9C%E7%B3%BB%E7%BB%9F/%E7%AC%AC%2024%20%E7%AB%A0%20%E5%A6%82%E4%BD%95%E8%BF%9B%E8%A1%8C%E5%A4%9A%20Agent%20%E7%B3%BB%E7%BB%9F%E8%AE%BE%E8%AE%A1/index.md)

该蓝皮书明确声明自己不是官方功能说明书，因此只能作为产品行为和实操方式的辅助证据。

### 4.1.3 共享产物式协作

**[社区实操]** 宣传片专家团案例采用了明显的工件流水线：

```text
brief.md
  ↓
storyboard.md
  ├─→ assets/
  └─→ clips/
          ↓
        bgm/
          ↓
      output/final.mp4
```

这个模式强调：关键事实和交接通过明确产物传递，下游读取上游已经确认的工件，而不是依靠多个 Agent 在群聊中反复转述。

### 4.1.4 WorkBuddy 未公开的部分

目前公开资料没有证明：

- 每位专家是否对应独立进程、独立 Provider Session 或只是一种角色 prompt；
- 团长与成员之间是否存在 durable mailbox；
- 是否有 ack、lease、retry、dead letter；
- 是否支持 reconnect replay；
- 底层使用 NATS、Redis Streams、数据库队列或其他中间件；
- 团长崩溃后如何恢复工序；
- Agent 是否能直接互发消息；
- 对外承诺的 delivery semantics 是什么。

结论：WorkBuddy 为“Leader-led 专家团队”提供了强产品证据，但没有公开足够的 runtime/control-plane 契约。

## 4.2 QoderWork、Qoder Experts 与 Qoder Cloud Managed Agents

Qoder 的公开资料横跨多个产品层，必须分开理解。

### 4.2.1 QoderWork 产品层

**[官方]** Qoder 官网将 QoderWork 描述为：

- local-first 的桌面 AI 工作伙伴；
- 通过 multi-agent collaboration 连接办公工具和数据；
- 持续理解、规划、执行、验证和交付真实业务任务；
- “Multiple expert agents collaborate to complete tasks end to end”。

来源：

- [Qoder 官方页](https://qoder.com/)
- [QoderWork Introduction](https://docs.qoder.com/qoderwork/introduction)

**[官方]** QoderWork 的用户可见工作单元是 Task，每个 Task 包括：

- 独立 conversation history；
- 工作目录；
- workspace/model 配置；
- attachments/context；
- Task Monitor；
- artifacts。

不同 Task 的对话上下文相互隔离；绑定相同本地目录时，可能通过文件工件协作，但这不等于共享 Provider 对话。

来源：

- [QoderWork New Task](https://docs.qoder.com/qoderwork/new-task)
- [QoderWork Task Conversations](https://docs.qoder.com/qoderwork/chat-basics)
- [QoderWork Task Management](https://docs.qoder.com/qoderwork/task-management)

### 4.2.2 Expert Kits 不是 Agent Team Runtime

**[官方]** QoderWork Expert Kit 包含：

```text
Quick Commands
Skills
Data Connections
Workflows
Output Standards
```

它解决的是“把一个岗位或行业的成熟方法打包，供真人团队统一安装和复用”。一次会话可以加载多个 Kit，但公开文档没有说每个 Kit 会启动一个独立 Agent Thread。

因此：

```text
Expert Kit ≠ 多 Agent runtime
Expert Kit ≈ 可分发的岗位能力与工作流包
```

来源：[QoderWork Expert Kits](https://docs.qoder.com/qoderwork/expert-kits)

### 4.2.3 Qoder Desktop Experts Mode

**[官方]** Qoder Desktop 的 Experts Mode 明确公开了 Agent Team：

| 角色 | 职责 |
| --- | --- |
| Lead Agent | 理解需求、拆解、调度、质量控制 |
| Researcher | 调研、代码定位、依赖和环境分析 |
| Full-Stack Engineer | 前后端实现 |
| QA | 测试、构建、验证证据 |
| Code Reviewer | 风险与代码审查 |
| UI Operator | 浏览器/UI 端到端验证 |
| Debug Engineer | 复现、根因定位和诊断 |

文档说明：

- Lead Agent 先生成结构化计划；
- 用户可确认或调整计划；
- Lead 动态调度不同专家；
- 专家互不阻塞并可并行；
- Lead 实时对齐和整合结果；
- 用户可运行中纠偏；
- Expert Team Canvas 展示各专家任务和状态；
- 专家可以配置不同模型、Skills、MCP 和额外 Prompt；
- Lead Agent 本身不可定制。

来源：[Qoder Experts Mode](https://docs.qoder.com/user-guide/quest/experts-mode)

### 4.2.4 Qoder Cloud Managed Agents

**[官方]** Qoder Cloud Managed Agents 公开了目前调研中最具体的多 Agent 通信抽象：

```text
Session
├── Coordinator Thread
├── Child Thread A
├── Child Thread B
└── Mailbox + Scheduler
```

每个 Child Thread：

- 绑定独立 Agent snapshot；
- 有独立 conversation history；
- 有独立 execution context；
- 通过 Mailbox 收取任务；
- 通过 `send_to_parent` 回报 Coordinator。

Coordinator 工具包括：

| 工具 | 语义 |
| --- | --- |
| `create_agent` | 异步创建 Child Thread 并投递初始任务 |
| `Agent` | 同步式委派并等待 Child 回报 |
| `send_to_agent` | 给现有 Child Thread 追加定向消息 |
| `list_agents` | 查看 Child 状态和 pending message count |

Child 工具：

| 工具 | 语义 |
| --- | --- |
| `send_to_parent` | 回报结果/进度/问题，然后 Child 进入 idle |

公开生命周期：

```text
user.message
  ↓
Coordinator 创建/选择 Child
  ↓
任务消息进入 Mailbox
  ↓
Scheduler 根据 Thread 状态派发
  ↓
Child 独立执行
  ↓
send_to_parent
  ↓
结果经 Mailbox 返回 Coordinator
  ↓
Coordinator 继续或汇总
```

文档还公开：

- Agent roster 最多 20 个；
- 每 Session 最多 25 个并发 Thread（含 Coordinator）；
- 所有 Thread 停止后 Session 才进入 idle；
- 有 Thread 创建、运行、idle、终止和消息事件；
- Thread 事件可通过 API/SSE 获取。

来源：[Qoder Cloud Managed Agents](https://docs.qoder.com/cloud-agents/managed-agents)

### 4.2.5 证据边界

Qoder Cloud 的文档能证明 Qoder 的公开技术体系中存在 Mailbox/Thread/Scheduler 模型，但不能据此断言：

- QoderWork 桌面端内部使用同一套 CAS；
- Qoder Experts Mode 与 Cloud Managed Agents 完全同构；
- Mailbox 的底层中间件是什么；
- 内部投递是否 exactly-once、at-least-once 或其他语义；
- 一个 Child 的 `idle` 如何与底层模型 turn 精确对应。

## 4.3 AgentScope 初步调研

在用户将范围收窄到 WorkBuddy/QoderWork 之前，初步查看了 AgentScope 2.0。

**[官方]** AgentScope 2.0 公开强调：

- Agent Team：Leader Agent 创建 workers 并通过内置 team tools 协调；
- Event System：统一事件流，用于前端和 human-in-the-loop；
- multi-tenancy / multi-session Agent Service；
- background task offloading：长工具转入后台，结果完成后再次唤醒 Agent 并继续会话。

来源：

- [AgentScope GitHub](https://github.com/agentscope-ai/agentscope)
- [AgentScope Agent Team](https://docs.agentscope.io/latest/en/deploy/agent-team)

它与 Qoder 一样属于拥有 Agent framework/loop 的参考实现。本文不把它的后台唤醒能力直接当成 vendor CLI 的可移植能力。

## 5. 为什么这不是 NATS 选型问题

Qoder 公开的 Agent-facing 语义更接近定向 Actor Mailbox：

```text
send_to_agent(thread_id, message)
```

而不是裸 topic 广播：

```text
publish("research.tasks", message)
```

两者差异：

| Directed Mailbox | Topic Pub/Sub |
| --- | --- |
| 目标是明确 Thread/Agent | 发布者只知道 subject |
| 容易建立 parent/child、correlation 和 pending count | 需要额外定义 consumer group 与任务归属 |
| Scheduler 可根据目标状态派发 | Broker 只负责传输，未必理解 Agent 状态 |
| 容易追踪一次委派的结果 | 结果关联需另建协议 |

因此 NATS/JetStream 可以成为未来某种底层实现，但它不能替代：

- Work Item 身份；
- 目标 Agent/Thread；
- correlation；
- runtime capability；
- dispatch policy；
- outcome evidence；
- uncertain/reconcile 处理。

更合理的概念分层是：

```text
工作平面：定向 Work Item / Mailbox
观察平面：Event Stream / SSE / Webhook / UI Activity
```

只有工作平面的 actionable item 才应该成为新的 Agent 输入；观察事件不能全部回灌给模型。

## 6. SmallKhoj 当前消息与 Runtime 链路

## 6.1 后端事件和目标选择

**[仓库事实]** SmallKhoj 在消息提交后持久化 `EventRecord`。daemon WebSocket 投递是 computer-scoped：后端枚举该 Computer 上可见事件的每个 Agent，并设置接收者 `agentId/targetAgentId`。

`backend/services/daemon_control.py` 中 `_event_visible_to_agent` 的关键规则包括：

- `targetAgentId` 存在时只投给该 Agent；
- `message.created` 不回投给原作者；
- workspace/部分 UI-only 事件不进入 runtime；
- channel 可见性仍参与普通事件筛选。

相关规范：`.trellis/spec/backend/event-delivery-contracts.md`。

## 6.2 Daemon 自动投递

**[仓库事实]** `DaemonCore` 监听 proxy：

```text
message_received
  ↓
deliverRuntimeMessage
  ↓
normalizeRuntimeIncomingMessage
  ↓
selectRuntimeSessionScope
  ↓
formatRuntimeIncomingMessage
  ↓
runtime.driver.sendUserMessage
```

当前实现位置：

- `agent/daemon/aaa-daemon/src/daemon/daemon.ts`：`deliverRuntimeMessage()`、`deliverRuntimeMessageToDriver()`；
- `agent/daemon/aaa-daemon/src/daemon/session-scope.ts`：DM/channel/thread/task scope；
- `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts`：事件归一化和本地 buffer。

这说明 daemon-managed runtime 并非完全依赖模型主动 polling：完整消息可以被自动转换为新的 runtime 输入。

## 6.3 Busy 时的本地队列

**[仓库事实]** 当前多个 driver 都有进程内 `pendingUserMessages`：

### Claude stream-json driver

- 当 child 不可写或 driver 判定 busy 时，将输入放入数组；
- `result` 后清除 `awaitingTurnResult/compacting/outstandingToolUses`；
- `flushQueuedMessages()` 在安全边界写下一条 JSONL user message。

文件：`agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`。

### Codex CLI driver

- 一个 `codex exec` 子进程对应一次外层 invocation；
- 子进程存在时，新输入放入数组；
- 子进程退出后调用 `flushQueuedMessages()`；
- 如果有 session id，则下一次使用 `codex exec resume`。

文件：`agent/daemon/aaa-daemon/src/runtime/codex-runtime.ts`。

### Codex ACP driver

- `activePrompt` 或 bootstrap 存在时排队；
- `bridge.prompt()` 返回后清空 activePrompt；
- 随后 flush 下一条；
- session 通过 ACP create/load 恢复。

文件：

- `agent/daemon/aaa-daemon/src/runtime/codex-acp-runtime.ts`；
- `agent/daemon/aaa-daemon/src/runtime/codex-acp-bridge.ts`。

### OpenCode server driver

- 用 `activePrompt` 序列化 prompt；
- 本地队列在 active prompt 结束后 flush；
- server SSE 用于观察 session/message/tool/status 等事件。

文件：`agent/daemon/aaa-daemon/src/runtime/opencode-server-runtime.ts`。

## 6.4 `message check` 与 freshness

**[仓库事实]** `slock message check` 通过本地 proxy 映射到 Agent API events/receive。proxy 维护：

```text
lastSeenSeq
readUpToSeq
```

如果 Agent 试图发消息而本地 buffer 中存在更高 seq 的未读 message event，proxy 可以返回 HTTP 409：

```json
{
  "state": "held",
  "reason": "pending_messages"
}
```

这是一种 freshness 防护：避免 Agent 在未读取新上下文时继续发送可能过时的回复。

但 `seen/read cursor` 不能证明：

- 消息已提交给 Provider；
- Provider turn 已开始；
- Agent 已理解；
- Agent 已回复；
- 业务工作已完成。

## 6.5 Prompt 中仍存在注意力依赖

**[仓库事实]** Claude/OpenCode runtime prompt 仍要求 Agent：

- 将 content-free inbox notice 视为有新消息等待；
- 在自然断点调用 `slock/raft message check`；
- 是否立即查看由 Agent 判断；
- 不应因为 notice 没有正文就认为没有工作。

这说明至少在部分运行路径或产品意图中，消息 materialization 仍可能依赖模型行为。

同时，通用 driver 实现又会在 busy 时把完整 runtime prompt 放入本地队列，并在 result 边界后自动 flush。Prompt 描述和实际 driver 路径之间是否存在不同 Provider、不同 runtime 或历史实现的设计漂移，需要真实 trace 验证。

## 6.6 Reconnect 和潜在丢失窗口

**[仓库事实]** `.trellis/spec/backend/runtime-slock-integration.md` 规定：

- daemon WS URL 可以带 `eventLogCursor=<last delivered seq>`；
- 没有 cursor、cursor 为 0 或无效时，从当前最大 EventRecord seq 开始，只订阅未来事件；
- 不自动重放历史聊天，历史上下文由 Agent 主动 read/check/search。

这是为了避免 daemon 重启后把旧消息大量回灌给 Agent，但也暴露一个待验证窗口：

```text
后端已经扫描/发送事件
  ↓
旧 daemon 将消息放入进程内 pendingUserMessages
  ↓
尚未启动下一 invocation
  ↓
daemon 崩溃
  ↓
重启时无有效 cursor，从 latest 开始
```

系统目前没有独立 durable 记录表达“Agent A 对 message M 仍有一项未执行工作”。

是否能通过其他 backend member cursor/polling 路径补回，需要实验和更细的代码 trace；不能仅由 EventRecord 存在推断可靠处理。

## 7. 第一次 Mailbox 设想及其问题

第一次推演提出了类似 Qoder 的状态机：

```text
pending
  ↓ scheduler claim
leased
  ↓ daemon accepted
dispatched
  ↓ provider started
running
  ↓ turn completed
handled
```

并设想：

- durable inbox item；
- lease 和超时重投；
- Agent RPC correlation；
- `wait_for` 持久 continuation；
- idle 前原子检查 mailbox；
- Reminder、RPC result、mention 都转换为 wake item。

这个方向捕捉到了“可靠性不能依赖 Prompt”的问题，但错误地假设 SmallKhoj 能统一观察或控制 Provider turn。

### 7.1 `running` 的过度推断

对于 vendor CLI，我们通常只能看到：

- 进程仍然存在；
- ACP prompt 尚未返回；
- stdout 出现 assistant/tool event；
- app-server 发出 turn notification。

这些事件语义并不相同。统一称为模型 `running` 会掩盖不确定性。

### 7.2 `handled` 的过度推断

即使 invocation exit code 为 0，也不能证明 Agent 已经处理了 `@`：

- 模型可能没有发送可见回复；
- 输出可能只在 stdout；
- 模型可能认为无需处理；
- 工具可能执行了一半；
- context compaction 可能丢失业务意图；
- Provider 可能完成生成但没有完成 SmallKhoj 侧的通信动作。

因此 delivery attempt 和 semantic outcome 必须拆开。

### 7.3 Suspend/Resume 假设不成立

大多数 vendor Agent surface 没有公开“冻结当前 tool loop，持久化调用栈，未来从同一位置恢复”的能力。

Cancel 通常是：

- 终止进程；
- 取消 ACP session/prompt；
- interrupt 当前 Codex turn。

这些都不等于无损 suspend。

## 8. 修正后的控制分层

## 8.1 SmallKhoj 始终可以控制的层

只要 Runtime Adapter 可运行，SmallKhoj 通常可以：

- 启动/终止外部进程；
- 发送初始 prompt；
- 保存 Provider session id（如果有）；
- 读取 stdout/stderr/JSONL/SSE；
- 观察进程退出或 prompt promise 返回；
- 在之后发起新的 invocation；
- 在外部持久化 Work Item 和 dispatch attempt。

## 8.2 Provider 可选提供的增强层

不同 Adapter 可能额外提供：

- persistent session；
- structured events；
- provider turn id；
- active turn cancel；
- same-turn steer；
- tool call events；
- compaction events；
- user-input acknowledgment。

这些必须通过 capability negotiation 暴露，不能仅根据名称推断。

## 8.3 Owned Agent Loop 才能稳定提供的层

如果 SmallKhoj 采用 Pi 或另一个开源 Agent Base 并拥有 loop，可以决定：

- 何时调用模型；
- 如何解析和执行 tool call；
- 每一步如何写 event log；
- 在 tool call 前后建立 checkpoint；
- 如何暂停业务 continuation；
- RPC result 何时恢复 Agent；
- compaction 前写入哪些状态；
- retry/cancel 的精确边界。

这不是 vendor CLI wrapper 能自动继承的能力。

## 9. 本机 Surface 静态核对结果

以下结果来自本机 CLI `--version/--help`、SmallKhoj adapter 代码和生成协议 schema；尚未经过真实 busy/cancel/resume 探针。

## 9.1 Codex CLI `0.144.3`

**[本机事实]** `codex exec` 提供：

- 非交互 prompt；
- `exec resume`；
- `--json` JSONL 输出；
- output schema；
- process-level invocation。

当前 SmallKhoj `codex-runtime.ts` 将每次 `exec` 视为一个外层 invocation，子进程退出后再处理下一条。

初步能力：

| 能力 | 静态判断 |
| --- | --- |
| 新 invocation | verified by CLI/help/code |
| session resume | verified by CLI/help/code |
| completion boundary | process exit / emitted result |
| active cancel | process signal，非无损 |
| active steer | `exec` 无公开支持 |
| suspend continuation | unsupported/未公开 |

## 9.2 Codex ACP

**[仓库事实]** 当前桥接基于 `@agentclientprotocol/sdk`，公开调用：

```text
initialize
newSession
loadSession
prompt
cancel
```

初步能力：

| 能力 | 静态判断 |
| --- | --- |
| session create/load | verified by adapter code |
| completion boundary | `PromptResponse` resolve |
| cancel | ACP `cancel(sessionId)` |
| active steer | 当前 bridge 没有 |
| suspend continuation | 没有 |

## 9.3 Codex app-server

**[本机事实]** `codex app-server generate-json-schema --experimental` 生成的 schema 包含：

```text
thread/start
thread/resume
turn/start
turn/steer
turn/interrupt
turn/started
turn/completed
```

`turn/steer` 参数要求：

```text
threadId
expectedTurnId
input
```

协议还明确表示：某些 active turn 不接受 same-turn steering，例如 `/review` 或手动 `/compact`；此时请求会失败。

初步能力：

| 能力 | 静态判断 |
| --- | --- |
| provider thread id | supported |
| provider turn id | supported |
| turn completion notification | supported |
| active interrupt | supported |
| active steer | conditional |
| true suspend/resume | 未提供，只能 interrupt 后再继续 thread |

限制：

- app-server 标记为 experimental；
- SmallKhoj 当前没有 app-server runtime adapter；
- 需要真实协议探针验证 steer、interrupt、compact 和 session 可用性。

OpenAI Codex manual helper 在本次会话中因官方站点 HEAD 403 无法获取，且当前没有 OpenAI Docs MCP；为避免修改用户全局 MCP 配置，本文对 app-server 的判断以本机当前官方 Codex 二进制生成 schema 为准。

## 9.4 Claude Code `2.1.183`

**[本机事实]** CLI 提供：

- `--print`；
- `--input-format stream-json`；
- `--output-format stream-json`；
- partial messages；
- `--replay-user-messages`；
- session id、resume、continue；
- hook events；
- result event。

**[仓库事实]** 当前 driver 自己在 busy 时排队，只在 `result` 后写下一条 user JSONL。

初步能力：

| 能力 | 静态判断 |
| --- | --- |
| persistent process | supported by stream-json mode |
| session resume | supported |
| structured completion | result event |
| input acknowledgment | CLI 有 replay-user-messages 选项，尚待验证含义 |
| active cancel | 主要为 process termination，是否有更细粒度协议待验证 |
| same-turn steer | 没有类似 `expectedTurnId` 的公开 CLI 契约 |
| true suspend/resume | 未公开 |

关键待实验问题：active turn 时写第二条 stream-json user message，到底是 Provider 排队、立即合入、只产生 notice，还是拒绝。

## 9.5 Kimi Code `0.21.1`

**[本机事实]** CLI 提供：

- `--session`、`--continue`；
- `--prompt` 非交互模式；
- stream-json 输出；
- ACP server；
- local REST/WebSocket server；
- session visualizer。

初步能力：

| 能力 | 静态判断 |
| --- | --- |
| one-shot invocation | supported |
| session resume | supported |
| ACP session/prompt | surface exists |
| active cancel | ACP 标准可能支持，需真实验证 Kimi 实现 |
| active steer | 未公开 |
| suspend/resume | 未公开 |

## 9.6 OpenCode `1.17.13`

**[本机事实]** CLI 提供：

- `opencode run`；
- `opencode serve`；
- `opencode acp`；
- session 管理；
- server/attach；
- structured server events。

**[仓库事实]** 当前 SmallKhoj OpenCode server driver 使用 HTTP/SSE 观察 prompt、message、tool、usage、status，并在 adapter 层序列化 activePrompt。

初步能力：

| 能力 | 静态判断 |
| --- | --- |
| persistent server/session | supported |
| structured events | supported by current driver |
| completion boundary | active prompt promise/session status |
| abort/cancel | 可能由 API 提供，需真实验证 |
| active steer | 未确定 |
| suspend continuation | 未公开 |

## 9.7 Qoder、ZCode 和其他外部 Agent

本机当前没有 `qoder`、`zcode` 可执行文件。第一轮不能对其能力作肯定判断。

矩阵必须保留：

```text
unverified
```

而不是根据 Codex、Claude 或 Qoder Cloud 的能力替它们填值。

## 10. 修正后的 Runtime Capability Contract

本任务拟验证并最终收敛类似下列 contract：

```typescript
type RuntimeCapabilities = {
  persistentSession: boolean
  structuredEvents: boolean
  observableCompletionBoundary: boolean
  inputAcknowledgement: boolean
  cancelActiveInvocation: boolean
  steerActiveInvocation: boolean
  providerTurnIds: boolean
  toolCallEvents: boolean
  compactionEvents: boolean
  suspendContinuation: boolean
}
```

注意：

- 这些字段描述可观察协议能力，不描述模型智能；
- `cancelActiveInvocation` 不等于无损暂停；
- `persistentSession` 不等于恢复内部 tool stack；
- `observableCompletionBoundary` 不等于业务任务完成；
- `structuredEvents` 不保证每个内部行为都可见；
- `steerActiveInvocation` 必须允许 `conditional`，不能只用 boolean；最终 contract 可能需要枚举和约束信息。

因此更完整的结果可能采用：

```typescript
type CapabilitySupport =
  | { level: 'verified' }
  | { level: 'conditional'; constraints: string[] }
  | { level: 'unsupported' }
  | { level: 'unverified' }
  | { level: 'blocked'; reason: string }
```

## 11. 修正后的 Reliable Wakeup Boundary

## 11.1 Portable baseline

不依赖 Provider 内部 turn 控制时，最强可移植承诺是：

> 显式 actionable work 被持久化；如果目标 Adapter 正忙，工作保持 queued；当 SmallKhoj 观察到下一个安全提交边界后，系统创建或恢复 Provider Session，并把该工作作为新的完整输入提交。

流程：

```text
@ / DM / Task / RPC result
  ↓
durable pending work
  ↓
adapter available?
  ├─ yes → submit invocation
  └─ no  → keep queued
                 ↓
      result / PromptResponse / process exit
                 ↓
      submit next work as new invocation
```

这个 baseline 不需要：

- mid-turn injection；
- suspend/resume；
- Provider tool-loop 控制；
- 模型主动记得 `message check`。

## 11.2 可以承诺的内容

- Work Item 已持久化；
- busy 时不会只存在于模型注意力；
- 在可观察边界后会尝试下一次 invocation；
- daemon 重启后仍能看到 pending work（未来实现目标，当前尚未实现）；
- 有 dispatch attempt 时间线；
- queued work 存在时不会把系统状态解释为完全无工作；
- 新 `@` 可以作为新的完整 prompt，避免依赖旧上下文压缩后的记忆。

## 11.3 不能统一承诺的内容

- 立即打断当前长任务；
- 将消息插入当前 Provider turn；
- 无损暂停和恢复；
- exactly-once 的模型行为；
- Agent 一定回复；
- exit code 0 等于业务已处理；
- 副作用发生到什么阶段；
- 所有 Provider 都保留相同 session 语义。

## 11.4 Busy 时四种策略

### A. Deferred until safe boundary

默认策略：当前 invocation 继续，Work Item 保持 queued，完成后启动下一次。

优点：Provider 无关、风险最低。缺点：长任务期间延迟较高。

### B. Interrupt and reconcile

高优先级消息可以 cancel/SIGTERM 当前 invocation，然后处理新工作。之后不是“无损 resume”，而是重新检查工作区和 session 状态再继续。

必须考虑：工具可能已经产生副作用但尚未输出 result。

### C. Isolated sidecar invocation

并行启动新的 scoped session 处理简单确认或无关消息。需要文件/权限隔离，避免两个 invocation 同时修改相同工作区。

### D. Provider-specific steer

仅当 Adapter capability 明确支持，例如 Codex app-server 的条件式 `turn/steer`。失败后必须回退到 A，不能丢 Work Item。

## 12. Wait 与 Agent RPC 的修正语义

## 12.1 Scheduler 等待新工作

当 Agent 当前没有任务时，不需要保持模型进程进行长 sleep：

```text
当前 invocation 完成
  ↓
Provider 进程退出或 session idle
  ↓
SmallKhoj daemon/scheduler 等待
  ↓
Mailbox 有新工作
  ↓
重新启动或 resume Provider
```

这适用于几乎所有 vendor CLI。

## 12.2 在长任务中等待另一个 Agent

真正困难的是：Agent A 发起 RPC 后，希望从同一业务计划继续。

Portable 方式不是冻结 A 的当前 turn，而是拆成两次 invocation：

```text
Invocation A1
  - 发送 rpc_request(call_123)
  - 保存必要业务状态
  - 结束或被安全中断

Agent B
  - 处理 call_123
  - 返回 rpc_result

Invocation A2
  - resume A 的 Provider Session（如果支持）
  - 注入 call_123 的结果和恢复上下文
  - 继续业务计划
```

这是“逻辑同步、物理异步”。

## 12.3 无法忽视的 yield 问题

如果 `agent.call` 只是一个 CLI/MCP tool，tool 返回 `call_id` 后要求 Agent “现在停止并等待”，停止动作仍可能依赖模型遵循。

能力层级：

1. **弱保证**：tool result 提示模型结束本轮。
2. **中等保证**：daemon 观察到 wait/defer 注册后，调用 Provider cancel/interrupt；这不是无损暂停。
3. **强保证**：SmallKhoj 拥有 Agent Loop，在 tool call 边界持久化 continuation 并停止 loop，结果到达后恢复。

第三种通常需要 Pi/自研 Agent Base，而不是通用 vendor CLI wrapper。

## 13. Pi / 开源 Agent Base 的意义与代价

## 13.1 获得的控制权

采用 Pi 或其他 owned loop，可以控制：

- model call；
- tool call 执行；
- abort signal；
- step event；
- tool result 持久化；
- continuation；
- RPC correlation；
- compaction/checkpoint；
- context reconstruction。

因此可以实现比 vendor adapter 更强的 Team/Mailbox/Wait 语义。

## 13.2 真实代价

- 不再直接使用完整 Codex/Claude Code 原生 harness；
- 需要重建或适配 tools、permissions、sandbox、hooks、skills、MCP 和 Git workflow；
- 同一个底层模型在不同 harness 下表现会变化；
- 厂商 Agent 新能力不会自动继承；
- 认证、订阅或 API 计费路径可能不同；
- SmallKhoj 自己承担更多安全和稳定性责任。

## 13.3 更现实的双轨

### Vendor Agent Adapter tier

面向 Codex、Claude Code、Kimi Code、ZCode、Qoder、OpenCode 等，承诺：

```text
start
submit input
optional session resume
observe output
observe adapter completion
optional cancel
next invocation
```

### Owned Agent Runtime tier

面向 Pi/自研/open-source loop，额外承诺：

```text
durable tool loop
step checkpoint
wait continuation
RPC await
richer team orchestration
```

两者应在产品 UI/能力矩阵中明确区分，不能假装完全兼容。

## 14. Delivery Attempt 与 Outcome Evidence

修正后的状态不应声称 Provider 内部事实。

建议的外层尝试状态：

```text
queued
dispatching
adapter_active
adapter_completed
adapter_interrupted
adapter_failed
delivery_uncertain
```

另建结果证据：

```text
reply_message_id
task_status_transition
explicit_ack
artifact_id
tool_side_effect_evidence
no_visible_outcome
```

### 14.1 为什么需要 `delivery_uncertain`

如果 Adapter 在 active 阶段崩溃，它可能已经：

- 修改文件；
- 调用外部 API；
- 发送消息；
- 创建资源；
- 执行部分命令。

但 SmallKhoj没有观察到完整 result。

对于只读、幂等工作，可以自动重试；对于副作用工作，不能盲目 at-least-once 重放，应进入 reconcile/manual policy。

## 15. 真实实验前的能力假设

下表只是待验证假设，不是最终矩阵：

| Surface | Busy 输入假设 | 完成边界假设 | Cancel 后恢复假设 | Steer 假设 |
| --- | --- | --- | --- | --- |
| Codex exec | SmallKhoj 外层排队 | process exit/JSON result | session resume 可继续，但需核对工作区 | 不支持 |
| Codex ACP | 当前 adapter 外层排队 | PromptResponse | cancel 后 session 是否可复用待测 | 不支持 |
| Codex app-server | server 管理 active turn | turn/completed | interrupt 后 thread 可继续，质量待测 | 条件式支持 |
| Claude stream-json | 当前 driver 排队；Provider 原生行为未知 | result event | kill/resume 能否稳定恢复待测 | 无明确契约 |
| Kimi prompt | 外层排队 | process/output end | `--session` 恢复待测 | 不支持 |
| Kimi ACP | ACP/adapter 序列化 | PromptResponse | cancel 后 session 待测 | 无标准 steer |
| OpenCode serve | 当前 adapter 序列化 | prompt/session event | abort 后 session 待测 | API 行为待测 |

## 16. Capability Spike 的实验问题

第一轮应在一次性隔离目录中回答：

### 16.1 Codex exec

1. 第一次 `exec` 是否稳定输出可解析 session id 和 result？
2. `exec resume` 是否形成一个明确的新 invocation？
3. 第一进程 active 时，当前 adapter 的第二条输入是否只存在于本地队列？
4. SIGTERM/SIGKILL 后 session 是否可恢复？
5. 中断前已经产生的文件副作用如何表现？

### 16.2 Codex ACP

1. `prompt()` 的完成语义是什么？
2. active prompt 时第二次调用是否被协议拒绝、串行或并行？
3. `cancel(sessionId)` 后 session 能否继续 prompt？
4. cancel 前后的 tool events 和结果事件是否足以区分 interrupted/failed？

### 16.3 Codex app-server

1. `turn/start`、`turn/started`、`turn/completed` 的 ID 是否稳定关联？
2. 普通推理、tool call、review、manual compact 时 `turn/steer` 分别如何？
3. `turn/interrupt` 后 thread 能否继续？
4. interrupt 后是否需要 reconciliation？
5. schema/version 变更风险如何隔离？

### 16.4 Claude Code stream-json

1. active turn 时写第二条 user JSONL 会发生什么？
2. `--replay-user-messages` 是输入接收 ack 还是业务 turn ack？
3. compaction event 前后第二条消息是否仍可靠形成下一轮？
4. process kill 后 `--resume` 是否恢复到一致状态？
5. tool_use 已执行但 result 尚未完成时中断，如何判断副作用？

### 16.5 Kimi Code

1. prompt mode 的 session id 和完成边界是否稳定？
2. ACP new/load/prompt/cancel 是否完整实现？
3. cancel 后 session 是否可继续？
4. stream-json 是否能提供足够事件构建 adapter state？

### 16.6 OpenCode

1. serve API 的 prompt completion 与 session status 如何关联？
2. abort 后是否有明确 terminal event？
3. session 是否可继续？
4. SSE 丢线重连如何恢复？
5. activePrompt 并发请求是排队、拒绝还是并发？

## 17. 实验安全边界

用户已经同意按下列边界进行第一轮最小真实调用；这项同意解决了实验范围问题，但不跳过 Trellis 的最终计划评审。任务仍处于 `planning`，在 `prd.md`、`design.md`、`implement.md` 经最终审阅并激活前，不运行真实 Provider 调用。

已批准边界：

- 每个已登录 Provider 最多两次最小真实调用；
- 使用一次性隔离目录和小型 disposable Git fixture；
- 不使用真实项目任务；
- 不发送外部消息；
- 不执行网络副作用；
- 不绕过权限系统；
- 不自动安装 Qoder/ZCode；
- 不修改全局 Provider/MCP/Auth 配置；
- 遇到登录、付费确认、验证码或异常额度立即停止；
- cancel/kill 实验只作用于为本实验启动的进程；
- 保存命令、协议帧、时间戳、版本和观察结果；
- 真实结果写回本任务文档，不直接修改生产 runtime。

## 18. 当前已达成的决策

1. 当前问题不是先选择 NATS，而是明确定向可靠唤醒与 Adapter 能力。
2. Reminder/定时不是第一研究目标。
3. WorkBuddy/Qoder/AgentScope 是产品和 first-party framework 参考，不是对 vendor CLI 能力的证明。
4. Qoder Cloud Managed Agents 的 Mailbox/Thread/Scheduler 是重要概念参考。
5. QoderWork Expert Kits 不是独立 Agent Team runtime。
6. SmallKhoj 已有 daemon push 和 driver 内存队列，问题不是完全没有自动投递。
7. 当前系统仍缺少“某 Agent 对某 actionable item 尚未形成下一 invocation”的 durable work truth。
8. 第一阶段不能承诺 mid-turn steer、suspend/resume 或 exactly-once Agent 行为。
9. 第一阶段应先完成 Provider capability spike。
10. Portable baseline 是“在下一个可观察安全边界可靠创建/恢复一次新 invocation”。
11. Pi/owned loop 可以提供更强 continuation，但不能无代价替代 vendor harness。
12. 真实 Provider 实验必须在本文、参考项目决策、`design.md` 和 `implement.md` 完成并经用户最终确认激活后进行。

## 19. 尚未决定或尚未验证

### 19.1 非阻塞的后续产品决策

- `@` 的默认最大等待延迟是否需要 SLA；
- 是否需要为 urgent `@` 提供 interrupt 或 sidecar 策略；
- Vendor tier 和 Owned tier 是否在产品上显式区分；
- 是否值得为 Codex app-server 建立实验性专用 Adapter。

这些问题不阻塞 capability spike；应在真实证据形成后由后续生产任务决定。

### 19.2 技术验证

- Claude active turn 的原生 stream-json busy input 语义；
- Codex ACP cancel 后 session 的实际可用性；
- Codex app-server steer/interrupt 的真实边界；
- Kimi ACP 完整度；
- OpenCode abort/resume 与 SSE reconnect；
- daemon/runtime 崩溃时当前 event cursor 是否存在未覆盖恢复路径；
- content-free notice 与完整 queued prompt 各自在什么路径发生；
- context compaction 后新 queued input 是否总能形成独立后续 invocation。

## 20. 后续产物

本任务后续应在本文基础上形成：

1. `research/reference-project-runtime-patterns.md`：Multica、Agent Platform、Clowder AI 的模式核对与复用/适配/拒绝决定；
2. `provider-capability-matrix.md`：版本化、带证据的最终能力矩阵；
3. `design.md`：Adapter capability contract 和 portable reliable-wakeup 边界；
4. `implement.md`：仅描述实验步骤、证据采集和回滚，不实施生产 Mailbox；
5. 如实验结论支持，再单独创建后续生产任务，例如：
   - durable next-invocation queue；
   - Codex app-server adapter；
   - vendor-agent interrupt policy；
   - Pi/owned runtime spike；
   - Agent RPC/continuation。

## 21. 主要来源索引

### 21.1 外部官方资料

- [腾讯 WorkBuddy 官方页](https://www.codebuddy.cn/work/)
- [Qoder 官方页](https://qoder.com/)
- [QoderWork Introduction](https://docs.qoder.com/qoderwork/introduction)
- [QoderWork New Task](https://docs.qoder.com/qoderwork/new-task)
- [QoderWork Expert Kits](https://docs.qoder.com/qoderwork/expert-kits)
- [Qoder Experts Mode](https://docs.qoder.com/user-guide/quest/experts-mode)
- [Qoder Cloud Managed Agents](https://docs.qoder.com/cloud-agents/managed-agents)
- [AgentScope GitHub](https://github.com/agentscope-ai/agentscope)
- [AgentScope Agent Team](https://docs.agentscope.io/latest/en/deploy/agent-team)

### 21.2 社区实操资料

- [WorkBuddyGuide](https://github.com/AlephAITech/WorkBuddyGuide)
- [WorkBuddy 专家和专家团章节](https://github.com/AlephAITech/WorkBuddyGuide/blob/main/docs/bluebook/%E7%AC%AC%E4%B8%80%E7%AF%87%20%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C%EF%BC%9A%E5%85%88%E6%8A%8A%20WorkBuddy%20%E7%94%A8%E8%B5%B7%E6%9D%A5/%E7%AC%AC%206%20%E7%AB%A0%20WorkBuddy%E7%9A%84%E4%B8%93%E5%AE%B6%E5%92%8C%E4%B8%93%E5%AE%B6%E5%9B%A2/index.md)
- [WorkBuddy 多 Agent 系统设计章节](https://github.com/AlephAITech/WorkBuddyGuide/blob/main/docs/bluebook/%E7%AC%AC%E4%B8%89%E7%AF%87%20%E8%BF%9B%E9%98%B6%E7%AF%87%EF%BC%9A%E6%8A%8A%E6%A1%88%E4%BE%8B%E5%8F%98%E6%88%90%E8%87%AA%E5%B7%B1%E7%9A%84%E5%B7%A5%E4%BD%9C%E7%B3%BB%E7%BB%9F/%E7%AC%AC%2024%20%E7%AB%A0%20%E5%A6%82%E4%BD%95%E8%BF%9B%E8%A1%8C%E5%A4%9A%20Agent%20%E7%B3%BB%E7%BB%9F%E8%AE%BE%E8%AE%A1/index.md)

### 21.3 SmallKhoj 代码与规范

- `agent/daemon/aaa-daemon/src/daemon/daemon.ts`
- `agent/daemon/aaa-daemon/src/runtime/runtime-driver.ts`
- `agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts`
- `agent/daemon/aaa-daemon/src/runtime/codex-runtime.ts`
- `agent/daemon/aaa-daemon/src/runtime/codex-acp-runtime.ts`
- `agent/daemon/aaa-daemon/src/runtime/codex-acp-bridge.ts`
- `agent/daemon/aaa-daemon/src/runtime/opencode-server-runtime.ts`
- `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts`
- `agent/daemon/aaa-daemon/src/proxy/event-buffer.ts`
- `backend/services/daemon_control.py`
- `.trellis/spec/backend/runtime-slock-integration.md`
- `.trellis/spec/backend/event-delivery-contracts.md`

### 21.4 本机静态核查

- `codex-cli 0.144.3`
- `Claude Code 2.1.183`
- `Kimi Code 0.21.1`
- `OpenCode 1.17.13`
- Codex app-server schema 生成命令：

  ```bash
  codex app-server generate-json-schema --experimental -o <temporary-directory>
  ```

### 21.5 本地参考项目

- Multica：`/Users/code/project/multica`
  - `server/pkg/agent/agent.go`
  - `server/internal/daemon/wakeup.go`
  - `server/internal/daemon/daemon.go`
  - `server/pkg/agent/hermes.go`
- Agent Platform：`/Users/code/project/agent-platform`
  - `docs-site/src/content/docs/guides/5-trigger-agents.md`
  - `control-plane/src/services/agent-notifier.ts`
  - `control-plane/src/routes/workspaces/sessions.ts`
- Clowder AI：`/Users/code/project/clowder-ai`
  - `packages/api/src/domains/cats/services/runtime-session/RuntimeSessionMetadata.ts`
  - `packages/api/src/domains/cats/services/agents/providers/acp/AcpAgentService.ts`
  - `docs/features/F201-antigravity-reliability-contract.md`

## 22. 文档结论

当前最可信的架构方向不是复制 Qoder 的完整 first-party Mailbox，也不是先选择 NATS，而是：

1. 把 SmallKhoj 自己拥有的 Work Item 和 Dispatch Attempt 做成明确真相源；
2. 用 Runtime Capability Contract 描述每个 vendor Agent 的真实可控边界；
3. 对所有 Adapter 只承诺 durable queue + next safe invocation；
4. 对支持更强协议的 Provider 启用 interrupt/steer 增强，但保持可靠回退；
5. 对真正需要 wait continuation 和 Agent RPC await 的场景，评估 Pi/owned loop 独立运行层；
6. 先通过隔离真实实验验证每项能力，再设计生产 Mailbox。

## 23. 2026-07-14 第一轮真实 Provider 实验结果

本节取代本文中所有“尚未运行真实 probe”的时态描述；历史假设仍保留，便于追溯为什么选择这些 case。完整矩阵见 [`provider-capability-matrix.md`](provider-capability-matrix.md)。

### 23.1 实验纪律与证据卫生

- 所有 Provider cwd 都是 `/tmp/smallkhoj-agent-runtime-capability-matrix/...` 下的 disposable Git fixture；本仓库没有作为 Provider cwd。
- 每个动态 Provider 至多两次 model-bearing input：Codex app-server 2/2、Kimi ACP 2/2、OpenCode ACP 2/2；Claude 的 stream-json case 因 CLI 参数错误只消耗了 1/2，未尝试凑满。
- `turn/steer` 和 ACP `session/prompt` 都经 durable ledger 在写入 stdin 前预占；失败/超时不会退款。
- 证据保留 protocol method、时间、request correlation、stop reason、结构化 update 类别、fixture digest、cleanup 和不确定性；删除 model thought/message chunk、prompt text、hook payload、opaque id 与 credential-shaped content。
- 每个 live case 后都验证 fixture digest、owned process cleanup 和 evidence redaction。`verify-evidence` 在归档后通过。

### 23.2 Codex app-server：协议能力存在，但安全边界未通过

无模型握手已观察到 `initialize` 和 ephemeral `thread/start`；动态 case 随后观察到：

```text
turn/start → turn/started(threadId, turnId)
          → turn/steer(expectedTurnId) accepted
          → turn/interrupt accepted
```

这证明当前 `0.144.3` app-server 的确拥有比 `codex exec` 更强的 active-turn protocol shape。但该 case 同时收到 `source=user` 的 `hook/started` / `hook/completed` 通知，来源是用户 home 下的 Codex hook 配置。我们没有读取该配置，也不能证明其命令没有 fixture 外副作用，因此该 evidence 被归类为 `delivery_uncertain`。

结论：不能把这次 accepted steer 直接翻译成 SmallKhoj 的“可安全中断、可透明注入”能力。若未来继续，需要一个独立 spike 先建立 hook isolation/deny policy、side-effect reconciliation 与 fallback-to-queue 行为。

### 23.3 Claude stream-json：核心 busy 问题仍是未知

第一轮发现了两个 harness/argv 问题，而不是 Claude 的 queue 行为：

1. runner 错误拒绝了合法空参数 `--allowedTools ""`，此时没有 Provider 进程输入；
2. 修复 runner 后，实际 CLI 在首条输入后报告 `--print + --output-format=stream-json` 需要 `--verbose`。ledger 仍按 fail-closed 计为已尝试的输入；没有出现 `assistant`、`result` 或第二条输入。

因此不能声称 Claude 对忙碌期输入是 adapter queue、provider queue、same-turn merge 或 rejection。后续只可在新的显式预算窗口中，以已修复 `--verbose` argv 重跑。

### 23.4 Kimi ACP 与 OpenCode ACP：resident session 是真实能力，不是 continuation

两者均完成 `initialize → session/new → session/set_config_option(mode=plan)`，在同一 resident ACP session 中接受两次短 prompt，并对每次 `session/prompt` 返回 `stopReason=end_turn`。两者还发出了 `session/update`；没有观察到 tool-call update，fixture digest 未变化。

这可以支持下面三个窄结论：

1. ACP 是 Kimi/OpenCode 当前本机可用的结构化 Adapter Invocation surface；
2. 同一常驻 session 可以接收**串行**后续输入，并向 adapter 暴露 completion/usage/update 证据；
3. `sessionId` 与 `loadSession`/`resume` capability advertisement 存在，但没有证明跨进程 reload、cancel 后可用、未完成 tool loop 恢复或真正的 `await` continuation。

没有对 busy-time second prompt、active cancel、SSE reconnect 或 compaction 做推断；这些格子仍为 `unverified`。

### 23.5 对 Mailbox、wait 和 RPC 的实际影响

真实结果没有把 portable baseline 推翻，反而强化了它：

```text
durable Work Item
  → adapter is busy / capacity unknown
  → retain queued work outside the model
  → observe an invocation boundary or scheduler wakeup
  → submit a new complete prompt to a new/referenced session
  → separately record transport terminal and semantic outcome evidence
```

因此：

- NATS/发布订阅可以是未来唤醒 hint 的实现选项，但不能替代 Work Item、lease、target、attempt、correlation、idempotency 和 `delivery_uncertain` 的语义；
- 普通 vendor tier 的 `wait` 应定义为 scheduler 在 **invocation 之间** 等待，依赖结果由 later invocation callback 注入，形成“逻辑同步、物理异步”；
- Codex app-server 类增强只能作为 provider-specific opt-in，失败或没有清洁证据时一律退回 durable next-invocation queue；
- 真正要求暂停栈、恢复 tool loop、Agent RPC await 的产品目标，仍需要 Pi 或其他 owned Agent Loop 的独立产品/安全评估，不能靠 vendor session resume 假装实现。

### 23.6 第一轮之后仍未验证的事项

- Claude stream-json active busy input 的真实接受/排队/拒绝边界；
- Codex app-server 在无 user-global hook 的隔离环境中，steer/interrupt 的安全和语义边界；
- Codex exec、Codex ACP、Kimi prompt、OpenCode serve 不能从其他 surface 借结果；
- Kimi/OpenCode ACP 的 active cancellation、cross-process `loadSession`、post-cancel usability、compaction 与 unfinished continuation；
- production daemon crash/reconnect 后已有内存 pending queue 与 EventRecord cursor 的可靠恢复路径。

这份结论仍是“实验前假设与边界”，不是最终实现方案。实验额度与安全边界已经确定；下一步是审阅 `prd.md`、`design.md` 和 `implement.md`，确认后再激活任务并运行探针。
