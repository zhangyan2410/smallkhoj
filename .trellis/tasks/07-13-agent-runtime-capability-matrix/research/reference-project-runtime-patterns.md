# 参考项目的 Runtime、Wakeup 与恢复模式

> 状态：真实 Provider 探针前的本地参考项目核对  
> 日期：2026-07-13  
> 范围：`multica`、`agent-platform`、`clowder-ai`  
> 目的：按 SmallKhoj 的参考项目规范，明确哪些模式复用、适配或拒绝；本文不证明任何 vendor Agent 的实际 turn 能力。

## 1. 结论先行

三个参考项目共同支持一个比“复制 Qoder Mailbox”更保守、也更符合 SmallKhoj 现实的方向：

1. **业务工作必须先成为服务端可恢复的事实，实时 wakeup 只是降低延迟的提示。**
2. **容量应在 claim/dispatch 前确认。**不能先把工作标成已经派发，再让它在 runtime 本地排队等待执行槽。
3. **统一 Adapter 边界应描述一次外层 invocation 的输入、事件和终局结果。**它不能假装统一拥有 Provider Turn 或 Tool Loop。
4. **外部触发默认更适合创建一次新的、独立的执行，而不是冻结并继续现有调用栈。**
5. **恢复和重试必须由证据驱动。**Provider session id、进程存活或 nominal success 都不足以证明安全 continuation。
6. **出现副作用后又失去可靠回执时，应进入 `delivery_uncertain`/reconcile，而不是盲目重放。**

因此，本任务复用的是控制面和证据模式，不复制参考项目的具体代码或它们对自有 Agent Runtime 的能力假设。

## 2. Multica：服务端队列、wakeup hint 与统一 vendor Adapter

本地路径：`/Users/code/project/multica`

### 2.1 观察到的模式

#### A. WebSocket wakeup 不是唯一正确性路径

`server/internal/daemon/wakeup.go:48` 在 WebSocket 不可用时明确记录：polling fallback 仍然有效。`server/internal/daemon/daemon.go:2382-2473` 则由每个 runtime 的 poller 同时接收周期轮询和 wakeup channel；没有 runtime id 的 wakeup 会 fan out，补捞连接建立前已经排队的工作。

其语义是：

```text
server-side queued task       ← 工作真相
       │
       ├─ WebSocket wakeup    ← 低延迟提示，可丢、可合并
       └─ periodic polling    ← 最终发现的回退路径
```

这比“把每个通知当成必须可靠投递的消息”更简单：wakeup 只促使 daemon 尽快重新检查权威队列。

#### B. 先获得执行容量，再 claim 工作

`server/internal/daemon/daemon.go:2479-2550` 明确采用 slot-before-claim：

- poller 先取得执行 slot；
- 有 slot 后才调用 `ClaimTask`；
- 没有容量时，任务继续留在服务端 `queued`；
- 避免任务过早进入 `dispatched`，但 runtime 实际还不能启动，最后被 dispatch timeout 错杀。

这里最重要的不是 Multica 的具体状态名，而是状态事实必须与真实资源边界对齐：

```text
没有执行槽 ≠ 已 dispatch
Adapter 还没接受 invocation ≠ Provider 已开始处理
```

#### C. Adapter 统一到 `Session{Messages, Result}`，而不是统一 Provider Turn

`server/pkg/agent/agent.go:16-20` 定义：

```go
Execute(ctx, prompt, opts) (*Session, error)
```

`server/pkg/agent/agent.go:76-81` 将一次执行暴露为：

- `Messages`：可选的运行中事件流；
- `Result`：恰好一个外层终局结果。

`server/pkg/agent/agent.go:118-125` 的结果状态包含 `completed`、`failed`、`aborted`、`timeout`、`cancelled`，并可携带 `SessionID`。这个抽象覆盖 Claude、Codex、OpenCode、Kimi、Pi、Qoder 等不同 launch family，但它承诺的是 **execution boundary**，不是所有 Provider 共享相同 turn/steer/suspend 语义。

#### D. nominal completion 仍需结合 Provider 错误证据修正

`server/pkg/agent/hermes.go:1590-1779` 处理一个很现实的 ACP 问题：`session/prompt` 可能以 `stopReason=end_turn` 结束，但上游 LLM 已经在 stderr 报错。

其策略区分：

- transient per-attempt warning：例如一次失败后重试成功，不能误判整次执行失败；
- terminal/exhausted failure：即使协议表面返回 completed，也要提升为 failed；
- 空输出 + 已观察到 provider error：不能把空的 nominal completion 当成功。

这证明 Adapter completion 不能只看单一信号，更不能进一步等价成业务 `handled`。

### 2.2 SmallKhoj 的取舍

| 决定 | 模式 | SmallKhoj 采用方式 |
| --- | --- | --- |
| 复用 | durable/server-side queued work | 后续 Mailbox 任务以持久 Work Item 为真相，daemon 内存队列只作缓存或执行内状态。 |
| 复用 | wakeup hint + polling fallback | wake signal 只触发 scheduler re-check；断线或合并 wakeup 不应丢失权威 pending work。 |
| 复用 | slot-before-claim | 只有 Adapter 真正有安全提交容量时才 lease/dispatch；busy 时保持 queued。 |
| 适配 | `Session{Messages, Result}` | 映射为 `AdapterInvocation + observed events + terminal result`，再用 capability 字段描述 provider-specific surface。 |
| 适配 | terminal error promotion | 实验记录所有互相矛盾的 stdout/stderr/protocol/exit 信号，最终结果允许 `delivery_uncertain`，不只做 completed/failed 二分。 |
| 拒绝 | `Result=completed` 即业务完成 | 业务结果必须另有 correlated reply、task transition、artifact 或 explicit ack 证据。 |
| 拒绝 | WebSocket 到达即 delivered/handled | wakeup 只是一条提示；正确性来自持久 work + scheduler 重查。 |

## 3. Agent Platform：触发变成独立 Session，而不是 continuation

本地路径：`/Users/code/project/agent-platform`

### 3.1 观察到的模式

#### A. Scheduler/外部事件首先创建新的独立 Session

`docs-site/src/content/docs/guides/5-trigger-agents.md:25-31` 明确写明：每次 schedule trigger 都是独立 Session，不共享上下文；如果需要跨触发继续，Agent 要把状态写入文件或 Memory。

这与 SmallKhoj 的 portable vendor tier 非常接近：

```text
trigger/event
  ↓
new invocation or resumable session input
  ↓
explicitly reconstructed context
```

它没有把触发语义包装为“恢复之前冻结的模型调用栈”。

#### B. 在创建 Session、消耗 token 前过滤事件

同一文档 `:86-111` 说明 Route Filter 发生在 Session 创建前；不匹配的事件不会启动 Agent，也不会消耗 token。Slack 和 WeCom 的 `@` 也先经过 connector/route，再成为目标 Workspace 的触发。

这个分层避免把所有 Event Stream 观察事件都回灌给模型：

```text
external event
  ↓ deterministic routing/filtering
actionable work item
  ↓
Agent invocation
```

#### C. 持久写入先成功，runtime 通知只是 advisory

`control-plane/src/services/agent-notifier.ts:14-23` 明确规定：配置/技能等持久写入已经成功后才通知运行中的 Agent reload；网络失败、非 2xx 或 timeout 只使通知返回 false，调用者把通知当 advisory。

该模式再次区分：

- durable state：权威结果；
- runtime notification：加速当前进程看到新状态的提示。

#### D. 有 pending follow-up 和 interrupt surface，但不等于 suspend

`control-plane/src/routes/workspaces/sessions.ts:221-260` 暴露 soft interrupt，保留 session history；`:263-334` 持久保存或清除一个 queued follow-up draft。

它证明“session 外部可以保存后续输入，并可以请求 interrupt”，但没有证明：

- interrupt 能保存内部 tool stack；
- pending draft 是多 item durable Mailbox；
- resumed session 会从同一个 Provider Turn 精确续跑。

### 3.2 SmallKhoj 的取舍

| 决定 | 模式 | SmallKhoj 采用方式 |
| --- | --- | --- |
| 复用 | event-to-independent-execution | `@`、DM、Task、RPC result 都先成为显式 Work Item，再在安全边界创建/恢复 invocation。 |
| 复用 | pre-session deterministic filtering | visibility、target、event kind、dedupe 等尽量在 control plane 完成，不让模型为不可行动事件付 token。 |
| 复用 | durable write before advisory notify | 先持久化 work，再发 wake hint；通知失败不会抹掉 work。 |
| 适配 | thread/session reuse | Provider 支持时可复用 Session 作为上下文优化；Work Item 的可靠性不依赖 session 一定可恢复。 |
| 适配 | pending follow-up | SmallKhoj 后续需要多 item、带 identity/correlation/attempt 的队列，而不是只保存一份可替换草稿。 |
| 拒绝 | interrupt 等于无损 pause | interrupt 只进入 interrupted/reconcile 流程；后续是新 invocation，不宣称继续原 turn。 |

## 4. Clowder AI：sidecar runtime truth、活性分类与 fail-closed 恢复

本地路径：`/Users/code/project/clowder-ai`

### 4.1 观察到的模式

#### A. Provider runtime metadata 作为 sidecar 维护

`packages/api/src/domains/cats/services/runtime-session/RuntimeSessionMetadata.ts:1-111` 单独维护 runtime/session identity、surface、identity history 和 lifecycle。其生命周期是控制面观察到的 `active`、`runtime_*_pending`、`sealed` 等，不伪装成 Provider 内部 model/turn 状态。

这与 SmallKhoj 需要的边界一致：业务 Session、外部 runtime session id、观察时间线可以关联，但不能因为有一个 `runtimeSessionId` 就声称拥有 Provider continuation。

#### B. 不把所有 silence 都叫 idle

`packages/api/src/domains/cats/services/agents/providers/acp/AcpAgentService.ts:134-143, 289-324` 区分：

- provider capacity signal；
- stream idle warning；
- 正在等待 MCP tool result 的 expected silence。

`:508-548` 又将协议错误、capacity、turn budget、stream idle stall、init failure 分开分类。说明 `process alive`、`no new output`、`tool pending`、`provider overloaded` 是不同事实，不能压成单一 `runtime_working/idle`。

#### C. 自动 resume 只在证据充分时开放

`docs/features/F201-antigravity-reliability-contract.md:211-219` 的恢复规则包括：

- heartbeat/探针能力必须先由真实 spike 验证；
- unknown/insufficient resume evidence 默认 fail-closed；
- 只有 owned、reliable、successful deterministic probe evidence 才允许较强自动 resume；
- external/shared/不可分类的副作用进入更保守层级；
- auto-resume 有 attempt cap 和显式 rollback switch。

#### D. post-side-effect uncertainty 被保留，而不是自动覆盖

同一文档 `:214-217` 对 native success 与 trajectory/upstream error 的冲突保留 `receipt_conflict`：

- 无副作用的冲突可 fresh retry；
- observed/pending/unknown side-effect risk 保持 resumable/manual 状态；
- 新 invocation 获得显式 `resumeContext`，而不是假装从原 turn 透明继续。

### 4.2 SmallKhoj 的取舍

| 决定 | 模式 | SmallKhoj 采用方式 |
| --- | --- | --- |
| 复用 | sidecar runtime metadata | 分开保存 Work Item/Attempt/Invocation 与 provider session/turn evidence；所有 provider 字段都标明来源。 |
| 复用 | multi-signal liveness | capability probe 分别记录 process、protocol result、tool event、provider warning、timeout 和 stderr。 |
| 复用 | fail-closed resume tiers | 未验证或证据不足的 Provider 不自动声称 safe resume/steer；结果为 `unverified`、`blocked` 或 `delivery_uncertain`。 |
| 复用 | side-effect-aware recovery | 只读/幂等工作可有限重试；未知或外部副作用必须 reconcile/manual。 |
| 适配 | provider-specific supervisor | 第一阶段只形成 capability/evidence contract，不直接引入 Clowder 的 Redis supervisor 或 Antigravity 专有状态。 |
| 拒绝 | session id 足以证明 continuation | Session 恢复只说明能够发起后续输入；不证明 tool stack、model generation 或业务计划精确续接。 |
| 拒绝 | unknown 自动降级重试 | 无法判断副作用和回执时默认 fail-closed。 |

## 5. 三个参考项目对 SmallKhoj 设计的合并约束

| 设计问题 | 合并后的约束 | 来源 |
| --- | --- | --- |
| Work truth 放哪里？ | 服务端持久 Work Item；本地 pending array 不是唯一真相。 | Multica queued task；Agent Platform durable-before-notify；Clowder supervisor evidence。 |
| wakeup 是否必须可靠送达？ | 单次 wake hint 可以丢或合并，但 scheduler 必须能从权威队列补捞。 | Multica WebSocket + polling fallback。 |
| 何时标记 dispatch？ | Adapter 有容量且已开始提交后；不要在本地等待 slot 时提前 claim。 | Multica slot-before-claim。 |
| Adapter 的公共边界是什么？ | 一次 invocation 的输入、事件、取消请求和终局观察；Provider-specific 能力另列。 | Multica `Backend.Execute → Session`。 |
| 外部 `@` 如何进入 Agent？ | 先过滤、持久化，再启动新的/恢复后的 invocation。 | Agent Platform Routes + independent Session。 |
| completion 能证明什么？ | 只能证明某一外层协议边界结束；不能自动证明 semantic handling。 | Multica terminal promotion；Clowder receipt conflict。 |
| idle/wait 如何表达？ | 区分 scheduler idle、adapter active、tool wait、provider capacity、stalled/unknown。 | Clowder ACP liveness 分类。 |
| crash 后是否自动重试？ | 只在无副作用或可验证幂等时；其余进入 `delivery_uncertain`。 | Clowder fail-closed/side-effect policy。 |
| 能否提供 transparent suspend/resume？ | Vendor tier 不承诺；Provider-specific steer/interrupt 单独验证，strong continuation 留给 owned loop。 | 三个项目均未提供可移植证明。 |

## 6. 明确不从参考项目推导的结论

以下结论没有被本地参考项目证明，也不会写入 SmallKhoj portable contract：

- 所有 vendor CLI 都可以 mid-turn 注入第二条输入；
- `cancel`/`interrupt` 等价于 suspend；
- Provider Session 可以恢复未完成的 Tool Loop；
- WebSocket/SSE 收到消息等价于 Agent 已处理；
- Adapter nominal completion 等价于业务 work handled；
- 一次 provider 名义成功允许覆盖已观察到的 terminal/side-effect 冲突；
- 通过自动 retry 可以获得 exactly-once Agent 行为。

## 7. 对本任务后续产物的直接影响

1. `design.md` 必须把 `Business Work Item → Dispatch Attempt → Adapter Invocation → Provider Session/Turn` 分层。
2. capability 值必须支持 `verified`、`conditional`、`unsupported`、`unverified`、`blocked`，并附 evidence。
3. probe harness 只测 Adapter 可观察边界，不把模型语义表现当协议能力。
4. probe 记录必须允许相互冲突的信号并产生 `delivery_uncertain`。
5. `implement.md` 必须先做静态 preflight，再按 disposable fixture、有限调用、明确 stop condition 运行真实探针。
6. 本任务不实现 durable Mailbox；后续实现若立项，应优先采用 server truth + wake hint + polling/reconciliation，而不是把可靠性压到 Prompt 注意力或 daemon 内存数组上。

## 8. 证据边界

本文来自 2026-07-13 本地 checkout 的代码和文档静态核对。它证明的是这些参考项目的已观察模式，不证明：

- 它们在生产环境中的完整 delivery SLA；
- SmallKhoj 当前 Provider 的实际 runtime 行为；
- 不同版本 Codex、Claude Code、Kimi、OpenCode 的稳定协议；
- Qoder、ZCode 或未安装 Agent 的任何能力。

这些问题只能由本任务后续的版本化、隔离真实探针回答。
