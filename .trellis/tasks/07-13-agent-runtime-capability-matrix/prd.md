# Agent Runtime Capability Matrix and Reliable Wakeup Boundary

## Goal

通过可复现的本地实验，确定 SmallKhoj 在托管 Codex、Claude Code、Kimi Code、OpenCode 等第三方 Agent 工具时，实际能够依赖哪些生命周期与消息投递能力；据此定义不依赖模型注意力、又不虚构 Provider Turn 控制权的最强 portable reliable-wakeup contract。

本任务直接回答的问题是：Agent 在长程任务和多轮上下文压缩后，可能忘记检查新的 `@`，随后 runtime 变为 idle。显式 actionable work 的正确性不能只依赖模型记得调用 `slock message check`；与此同时，SmallKhoj 也不能在没有证据时承诺 mid-turn 注入、暂停、无损恢复或 exactly-once Agent 行为。

## Background and Confirmed Facts

- SmallKhoj 当前主要托管 vendor Agent harness，而不是拥有其内部 Agent Loop。系统稳定拥有的是外层进程/请求与 Adapter Invocation；Provider Session、Turn、Tool Loop、compaction 和 model generation 的可控性因 surface 而异。
- 当前 daemon 已能接收 actionable message event，并把完整输入提交给 runtime adapter。Claude、Codex CLI、Codex ACP 和 OpenCode driver 在 busy 时使用进程内 pending queue，在各自观察到的完成边界后 flush。
- 进程内 queue 不是 durable work truth，也不能证明 Provider 已接受、理解或处理某条消息。
- 部分 runtime prompt 仍要求模型在自然断点调用 `slock message check`；长任务、context compaction 或较弱的 instruction following 可能破坏该注意力路径。
- 后端 `EventRecord` 是持久化的，但缺少有效 cursor 时，daemon reconnect 从当前 latest event 开始而不重放旧聊天，因此不能仅凭 EventRecord 存在推断待执行工作一定能恢复。
- Qoder Cloud 的 `Session Thread + Mailbox + Scheduler`、AgentScope background wakeup 和 WorkBuddy/Qoder Experts 的 Agent Team 都是 first-party Agent/loop 参考，不能直接证明 vendor CLI 的 turn control。
- 本地参考项目支持三项控制面模式：Multica 的 server-side queue + wake hint + polling fallback 与 slot-before-claim；Agent Platform 的 event-to-independent-session 和 durable-before-advisory-notify；Clowder 的 sidecar runtime evidence、liveness 分类与 fail-closed resume。
- 2026-07-14 static preflight 已确认：Codex CLI `0.144.3`、Claude Code `2.1.183`、Kimi Code `0.21.1`、OpenCode `1.17.13`；Qoder、ZCode 和 Pi command 未安装。版本证据见 `evidence/static-20260714-v2/`。
- Codex app-server 本机生成的 experimental schema 包含 `thread/start`、`thread/resume`、`turn/start`、`turn/steer`、`turn/interrupt`、`turn/started` 和 `turn/completed`。`turn/steer` 要求 `expectedTurnId` 且存在拒绝 same-turn steer 的条件；SmallKhoj 当前未使用该 surface。
- 当前 Codex ACP bridge 公开 session create/load、prompt 和 cancel，没有 portable active-turn steer 或 suspension。
- 用户已同意第一轮可以使用隔离的最小真实调用验证能力，但真实探针仍需在 `prd.md`、`design.md`、`implement.md` 最终评审并激活任务后才运行。
- 激活后已完成的第一轮结果必须以 `provider-capability-matrix.md` 和对应 evidence id 为准：Kimi/OpenCode ACP 完成了同 session 的两次短 prompt；Codex app-server 观察到一次 steer/interrupt 协议接受，但用户级 hook 使该条记录成为 `delivery_uncertain`；Claude busy-input 仍未验证。

## Requirements

### R1. Separate Owned and Provider State

- 研究和矩阵必须区分 `Business Work Item`、`Dispatch Attempt`、`Adapter Invocation`、`Provider Session`、`Provider Turn`、`Provider Tool Loop` 和 `Model Generation`。
- 未观察到支持精确语义的证据时，不得把消息标为 `handled`、把模型标为 `running`，或把 Provider Turn 标为 `resumable`。
- Provider-specific capability 必须按具体 surface 表达，不能根据 provider 名称或其他 first-party 产品推断。

### R2. Reproducible Capability Experiments

- 为每个本地可运行 surface 建立或记录隔离探针，不使用真实项目任务，不修改无关 workspace。所有 surface 都必须有明确 capability assessment；调用预算不足而未动态执行的能力保留 `unverified`，不能用其他 surface 的结果补齐。
- 探针问题集至少覆盖下列能力；在每 Provider 最多两次 model-bearing input 的硬预算内选择信息增益最高的动态组合，其余通过 static evidence 或显式 `not_executed/unverified` 记录：
  - completion boundary 的可观察性；
  - 完成后串行提交第二条 prompt；
  - 第一次 invocation active 时第二条输入的行为；
  - 完成后的 Provider Session resume；
  - cancel/interrupt 行为及之后 session 是否可用；
  - 在受控时点终止实验所属 Adapter/daemon 进程后的行为；
  - Provider Turn ID、tool-call event、compaction event 和 input acknowledgment 是否可见；
  - same-turn steer 是 supported、conditional、queued、rejected 还是 undocumented。
- 每次实验必须记录准确 CLI/runtime 版本、命令或 protocol frame、时间戳、观察事件、exit/result state 和残余不确定性。

### R3. Provider Coverage and Status Vocabulary

- 第一轮 executable coverage 包含：Codex exec、可在本地运行的 Codex ACP/app-server、Claude Code stream-json、Kimi ACP 或 prompt mode、OpenCode serve/ACP。
- capability support 使用 `verified`、`conditional`、`unsupported`、`unverified`、`blocked`；执行结果另可使用 `not_executed`，不得猜测。
- 缺少认证、本地 setup 不支持、异常费用或安全限制都必须记录为 `blocked`/`not_executed`。
- Qoder、ZCode、Pi 和未来外部 Agent 保留矩阵条目，但在真实 adapter/runtime 可检查前维持 `unverified`。

### R4. Common-Denominator Reliable Wakeup Boundary

- 定义无需 mid-turn control 的最强 portable baseline：actionable work 先持久化；Adapter busy 时保持 queued；到下一个可观察安全提交边界后，创建或恢复 Provider Session，并把该工作作为新的完整输入提交。
- 区分 default deferred delivery、interrupt-and-reconcile、isolated sidecar invocation 和 provider-specific steer 四种策略。
- 分开表达 SmallKhoj 能保证的 `persisted`、`queued`、`submitted`、adapter terminal observation，与 correlated reply、task transition、artifact、explicit ack 等 semantic outcome evidence。
- 定义 `delivery_uncertain`，特别是 invocation 可能已经产生副作用但未留下可靠终局回执的情况。
- `slock message check` 可以保留为 inspection/catch-up 工具，但不能成为显式 actionable work 的唯一正确性路径。

### R5. Wait and Agent-to-Agent Boundaries

- portable vendor tier 不承诺暂停并精确继续 active Provider Turn。
- common-denominator wait 是 scheduler 在 invocation 之间等待；依赖结果通过 later invocation callback 注入，形成“逻辑同步、物理异步”。
- 明确哪些更强能力依赖 Codex app-server 等 provider-specific surface，哪些需要 Pi 或其他 owned Agent Loop。
- 比较 vendor-agent adapter tier 与 owned-loop runtime tier 的产品、认证、工具、权限、安全和兼容性代价，不能假设两者可透明替换。

### R6. Reference-Project Decisions

- 记录 Multica、Agent Platform 和 Clowder AI 中与 runtime queue、wakeup、execution boundary、liveness 和 recovery 有关的模式。
- 每个模式必须明确标记为 SmallKhoj 的“复用、适配或拒绝”，不能盲目复制代码或 first-party runtime 假设。
- 后续架构建议应吸收 server truth + wake hint/poll fallback、slot-before-claim、independent invocation 和 fail-closed side-effect recovery；本任务不直接实现这些生产机制。

### R7. Evidence and Safety Before Production Work

- 本任务是 capability spike 和 architecture-boundary 调查，不实现 durable mailbox、RPC、wait continuation、数据库迁移或生产 daemon state-machine 变化。
- 真实探针前必须固化 vendor 调研、SmallKhoj 现状比较、讨论中纠正的假设、参考项目取舍和待验证 hypotheses，并让用户审阅。
- 第一轮真实探针遵守以下边界：
  - 每个已安装且已登录 Provider 最多两次最小调用；
  - disposable 隔离目录/fixture，不承接真实项目任务；
  - 不发送外部消息，不制造网络副作用，不绕过权限；
  - 不安装 Qoder/ZCode，不修改全局 Provider/Auth/MCP 配置；
  - 遇到登录、付费确认、CAPTCHA 或异常额度立即停止；
  - cancel/kill 只作用于本实验启动的进程；
  - 所有证据经过 secret redaction 后写入任务目录。
- 任何生产实现后续任务都必须引用本任务的 capability evidence 和 contract。

## Acceptance Criteria

- [ ] A versioned capability matrix covers every provider/surface in R3 and uses explicit values such as `verified`, `conditional`, `unsupported`, `unverified`, and `blocked`.
- [ ] A task-local pre-experiment research document captures the WorkBuddy/Qoder investigation, the current SmallKhoj daemon comparison, the vendor-agent control correction, reference-project reuse/adapt/reject decisions, and the resulting experiment hypotheses before any real provider invocation.
- [ ] Each `verified` or `conditional` capability links to a reproducible local probe and captured evidence rather than an inference from marketing or another provider's architecture.
- [ ] Codex exec, Codex ACP/app-server, Claude stream-json, Kimi, and OpenCode results distinguish outer invocation control from provider-internal turn control.
- [ ] The research identifies whether busy-time input is queued by SmallKhoj, queued by the provider, accepted as same-turn steering, rejected, or unknown for each tested surface.
- [ ] For each surface, the research records the observed completion/cancellation/post-cancel boundary or explicitly marks the capability `unverified`/`blocked`; it never fills a missing result from another surface.
- [ ] A portable `RuntimeCapabilities` contract is proposed with conservative semantics for session persistence, structured events, completion observation, cancellation, active steering, provider turn IDs, tool-call events, compaction events, input acknowledgment, and suspendable continuations.
- [ ] A reliable-wakeup boundary is documented that does not require active-turn suspension and states both its guarantees and non-guarantees.
- [ ] Retry guidance distinguishes read-only/idempotent delivery from side-effecting `delivery_uncertain` attempts.
- [ ] Wait/RPC conclusions distinguish scheduler waiting between invocations, provider-specific interrupt/steer, and owned-loop continuation.
- [ ] Probe evidence records versions, frames/commands, timestamps, observations, terminal state, redaction, cleanup, and residual uncertainty under the approved safety boundary.
- [ ] No production runtime, daemon delivery, backend message semantics, global provider configuration, or unrelated workspace state is changed in this spike.
- [ ] The final evidence and architecture recommendation are reviewed by the user before any follow-up implementation task is created or started.

## Out of Scope

- Implementing NATS, Redis Streams, or another broker.
- Implementing a production durable mailbox, scheduler, database migration, RPC continuation, or wait state machine.
- Replacing vendor agents with Pi or another owned Agent Base.
- Building a production Codex app-server adapter.
- Claiming Qoder/AgentScope/WorkBuddy first-party guarantees for vendor CLI adapters.
- Installing Qoder/ZCode or changing global provider authentication solely to increase coverage.
- Destructive、externally visible、permission-bypassing or uncontrolled paid probe actions.
- Defining the production `@` latency SLA, urgent interrupt policy, or Vendor/Owned tier UI; these require later product decisions after evidence exists.

## Planning Gate

实验安全范围已经确定，用户已审阅并激活本任务。第一轮 Provider 探针已按每 Provider 最多两次模型输入的边界运行；最终结论、残余不确定性和后续产品决策以 `provider-capability-matrix.md` 为准。任何新的 Provider 调用都需要新的显式预算窗口，不能把未验证格子用推断补齐。
