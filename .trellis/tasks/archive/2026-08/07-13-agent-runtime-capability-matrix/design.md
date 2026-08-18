# Agent Runtime Capability Spike — Technical Design

> 状态：in_progress / first live evidence collected  
> 日期：2026-07-13 至 2026-07-14  
> 适用任务：`07-13-agent-runtime-capability-matrix`  
> 重要边界：本文设计的是隔离能力探针、证据模型和架构结论产物，不设计或修改生产 Mailbox。

## 1. Design Objective

在不假设 SmallKhoj 拥有 vendor Agent Loop 的前提下，建立一套可复现、可审计、可保守解释的实验方法，回答：

- SmallKhoj 对每个 runtime surface 能提交什么；
- 能观察到哪些 completion/cancel/session/turn/tool 证据；
- active invocation 期间第二条输入由谁处理、何时处理；
- 中断后能否安全地创建后续 invocation；
- 哪些能力只能标为 conditional、unverified 或 delivery uncertain；
- 所有 Provider 的最强共同可靠唤醒边界是什么。

设计优先级按顺序为：

1. 不影响真实项目、外部系统和全局 Provider 配置；
2. 不把外层事件过度解释为 Provider 内部状态；
3. 证据可由另一个人按记录复现；
4. 严守每个已登录 Provider 最多两次最小真实调用；
5. 覆盖不足时保留 `unverified`，不为“完整表格”制造伪结论。

## 2. Boundary Model

### 2.1 Six-layer ownership model

```text
Business Work Item                         SmallKhoj owns
  └─ Dispatch Attempt                     SmallKhoj owns
       └─ Adapter Invocation              SmallKhoj initiates/observes
            └─ Provider Session           Provider owns; adapter may reference
                 └─ Provider Turn         Provider owns; surface may expose
                      └─ Tool Loop / Model Generation
                                            Provider or owned Agent Loop owns
```

每层的含义如下：

| Layer | 本任务中的含义 | 可以观察的典型证据 | 不允许的过度推断 |
| --- | --- | --- | --- |
| Business Work Item | 需要目标 Agent 行动的 `@`、DM、Task、RPC result | work id、target、payload digest、created time | 已被 Provider 接收 |
| Dispatch Attempt | 将 Work Item 交给某 Adapter 的一次尝试 | attempt id、lease/submit time、policy | 模型已开始推理 |
| Adapter Invocation | CLI process、ACP prompt、HTTP prompt、app-server turn request | PID/request id、stdout、response、exit | 业务 work 已 handled |
| Provider Session | Provider 保存的会话/线程 | session/thread id、load/resume response | 未完成调用栈已恢复 |
| Provider Turn | Provider 对一次输入的 turn | turn id、started/completed event | 所有 Provider 都可 steer |
| Tool Loop / Generation | Agent harness 的工具循环和模型生成 | tool event、partial message（若 surface 暴露） | 未暴露的内部状态可由外层 idle 推断 |

### 2.2 Probe scope versus future production scope

本任务只实例化 `Adapter Invocation` 及以下的观察证据。`Business Work Item` 和 `Dispatch Attempt` 只作为未来 reliable-wakeup contract 的概念模型，不新增数据库表、队列、lease、scheduler 或生产 API。

## 3. Capability Contract

### 3.1 Support level

```typescript
type CapabilitySupport =
  | {
      level: 'verified'
      evidenceIds: string[]
    }
  | {
      level: 'conditional'
      evidenceIds: string[]
      constraints: string[]
      fallback?: string
    }
  | {
      level: 'unsupported'
      evidenceIds: string[]
      basis: 'protocol' | 'documented' | 'reproducible_rejection'
    }
  | {
      level: 'unverified'
      reason: string
    }
  | {
      level: 'blocked'
      reason: string
      evidenceIds?: string[]
    }
```

判定规则：

- `verified`：当前准确版本上，动态探针观察到能力成立，且证据没有与结论冲突。
- `conditional`：当前版本动态成立，但有明确状态、请求参数、turn kind、adapter policy 或 fallback 约束；Codex `turn/steer` 预期属于此类或保持 `unverified`。
- `unsupported`：当前 surface 的版本化协议明确不提供，或动态请求得到稳定、可归因的拒绝。CLI help 没写某能力通常只够 `unverified`，不能单凭“没看到”断言 unsupported。
- `unverified`：没有运行、预算不足、只有营销材料、只有其他 Provider/产品类比，或证据不足以判定。
- `blocked`：已经完成安全 preflight，但认证、安装、费用确认、权限、协议启动或环境条件阻止继续。

`not_executed` 是 probe-case execution status，不是 capability support level。

### 3.2 Runtime capability shape

```typescript
type BusyInputBehavior =
  | 'adapter_queued'
  | 'provider_queued'
  | 'same_turn_steer'
  | 'parallel_invocation'
  | 'rejected'
  | 'unknown'

type RuntimeCapabilities = {
  surface: string
  version: string
  invocationStart: CapabilitySupport
  persistentSession: CapabilitySupport
  structuredEvents: CapabilitySupport
  observableCompletionBoundary: CapabilitySupport
  inputAcknowledgement: CapabilitySupport
  cancelActiveInvocation: CapabilitySupport
  sessionUsableAfterCancel: CapabilitySupport
  steerActiveInvocation: CapabilitySupport
  providerTurnIds: CapabilitySupport
  toolCallEvents: CapabilitySupport
  compactionEvents: CapabilitySupport
  suspendContinuation: CapabilitySupport
  busyInputBehavior: {
    value: BusyInputBehavior
    support: CapabilitySupport
  }
}
```

关键语义限制：

- `inputAcknowledgement` 只表示 transport/protocol 接受了输入；不表示模型理解或业务 handled。
- `cancelActiveInvocation` 只表示 cancel request 有可观察效果；不表示无损 pause。
- `persistentSession` 只表示后续 invocation 可以引用同一 Provider context；不表示恢复原 Tool Loop。
- `observableCompletionBoundary` 只表示 Adapter/Provider surface 发出 terminal signal；不表示业务完成。
- `suspendContinuation` 只有在明确保存并恢复未完成业务 continuation 时才可成立；普通 session resume 默认不满足。

## 4. Evidence Model

### 4.1 Evidence record

每个 probe case 生成一条机器可读记录和一段便于审阅的 Markdown 摘要。建议 schema：

```typescript
type ProbeEvidence = {
  schemaVersion: 1
  evidenceId: string
  runId: string
  caseId: string
  surface: string
  provider: string
  executionStatus:
    | 'passed'
    | 'failed'
    | 'blocked'
    | 'not_executed'
    | 'timed_out'
    | 'cancelled'
    | 'delivery_uncertain'
  startedAt: string
  endedAt: string
  versions: Record<string, string>
  fixture: {
    root: string
    gitHead?: string
    beforeDigest: string
    afterDigest: string
  }
  invocation: {
    transport: 'process' | 'stdin_jsonl' | 'json_rpc' | 'acp' | 'http_sse'
    commandRedacted?: string[]
    requestIds?: string[]
    providerSessionIds?: string[]
    providerTurnIds?: string[]
    pid?: number
  }
  observations: Array<{
    at: string
    source: 'controller' | 'stdout' | 'stderr' | 'protocol' | 'filesystem' | 'process'
    kind: string
    payloadRedacted: unknown
  }>
  terminal: {
    adapterState: string
    processExitCode?: number
    processSignal?: string
    providerStopReason?: string
    contradictorySignals: string[]
  }
  sideEffectAssessment: {
    risk: 'none' | 'fixture_only' | 'external_or_unknown'
    observed: string[]
  }
  cleanup: {
    status: 'complete' | 'partial' | 'not_needed'
    remainingOwnedPids: number[]
    notes: string[]
  }
  uncertainties: string[]
}
```

### 4.2 Evidence identity and linkage

- `runId`：一次整体实验运行，例如 `20260713T153000+0800`。
- `caseId`：稳定的 surface/case 名，例如 `codex-appserver-active-steer-interrupt`。
- `evidenceId`：`<runId>/<caseId>/<attempt>`。
- capability matrix 中的每个 `verified`/`conditional` 必须列出一个或多个 `evidenceId`。
- static evidence 与 dynamic evidence 分开标注；static schema/help 不能伪装为 live behavior。

### 4.3 Contradictory evidence

Recorder 不提前把事件压成单一成功/失败。例如：

```text
protocol stopReason=end_turn
stderr terminal provider error
output empty
process exit=0
```

四条都保留。Assessor 再按规则得出 `failed` 或 `delivery_uncertain`，避免丢掉 Multica/Clowder 已经暴露的 nominal-success 冲突。

## 5. Disposable Probe Architecture

```text
Probe Controller
  ├─ Static Preflight
  ├─ Call Budget Ledger
  ├─ Fixture Manager
  ├─ Surface Driver
  │    ├─ process / stream-json
  │    ├─ ACP
  │    ├─ JSON-RPC app-server
  │    └─ HTTP/SSE
  ├─ Event Recorder → raw ephemeral transcript
  ├─ Redactor       → sanitized task evidence
  ├─ Assessor       → capability matrix
  └─ Cleanup Guard  → experiment-owned resources only
```

### 5.1 Location and isolation

- fixture root：`/tmp/smallkhoj-agent-runtime-capability-matrix/<run-id>/`；
- 每个 Provider/surface 使用独立子目录；
- fixture 初始化为 disposable Git repository，基线只含无敏感信息的 nonce/readme/sentinel；
- 不把 SmallKhoj repo 作为 Provider working directory；
- 探针脚本和 sanitized evidence 可以放在本任务目录，Provider 运行生成物只留在 `/tmp`；
- raw transcript 只在权限受限的临时目录存在，redaction 后删除。

### 5.2 Call budget ledger

预算按 Provider 而不是 surface 计数：

```text
Codex       ≤ 2 model-bearing inputs
Claude      ≤ 2 model-bearing inputs
Kimi        ≤ 2 model-bearing inputs
OpenCode    ≤ 2 model-bearing inputs
```

- `--version`、`--help`、schema generation、local protocol initialize/handshake 若不会触发模型，不消耗调用预算，但仍记录。
- 任何可能触发模型的 user input、prompt、turn 或 steer input 都先原子预占预算；结果失败也计数，防止重试失控。`cancel`、`interrupt`、纯 initialize/load/resume request 只有在不附带模型输入时才不计数。
- 同一 Provider 多个 surface 竞争预算；优先验证最接近 SmallKhoj 当前生产路径和本问题核心的 surface。
- 预算不足的 case 写 `not_executed`，相关 capability 保持 `unverified`。

### 5.3 Probe prompt contract

所有真实 prompt：

- 包含唯一 nonce，便于关联输入和输出；
- 只允许读取 fixture 或执行明确、短时、无网络的本地命令；
- 不要求访问 SmallKhoj repo、用户 home 文档、git remote 或外部服务；
- 不要求发送消息、创建远端资源或修改全局配置；
- 如需制造 active window，只允许 bounded local wait；
- 如需副作用观察，只能修改 fixture sentinel，并在 prompt 中显式限定路径。

## 6. Dynamic Probe Allocation

两次调用预算不足以把每个 Provider 的 completion、busy input、resume、cancel、post-cancel reuse 和所有 surface 全部动态跑一遍。本设计不掩盖这个限制，而是按“可靠唤醒问题的信息增益”分配预算。

### 6.1 Codex

Static/executable preflight：

- `codex exec` version/help/JSON output flags；
- 当前 ACP bridge initialize/session/prompt/cancel surface；
- app-server experimental schema、initialize、thread/turn methods；
- 不含模型输入的 process/protocol startup 与 clean shutdown。

推荐动态预算：优先 app-server，因为它是本机唯一明确暴露 active turn steer/interrupt 的 Codex surface。

1. 调用 1：启动一个 bounded active turn，捕获 `threadId`、`turnId` 和 started event。
2. 调用 2：在 active window 发送带 `expectedTurnId` 的 `turn/steer`，记录 accepted/rejected/conditional 行为；随后对同一 turn 发不携带模型输入的 `turn/interrupt`。可以在不发新 turn 的前提下验证 thread reference/load，但 post-interrupt session usability 保持 `unverified`。

Codex exec/ACP 的 resume、queue 和 cancel 以当前 adapter code/static evidence 为起点；若没有剩余预算，动态能力保持 `unverified`，不得借 app-server 结果填充。

若 app-server 在模型调用前 blocked，则预算可以转给当前生产 surface，优先 Codex exec 的 normal + resume；转移原因写入 ledger。

### 6.2 Claude Code stream-json

1. 调用 1：发送会维持短暂 active window 的最小 prompt，记录 user replay/ack、assistant/tool/result 事件。
2. 调用 2：在第一次仍 active 时写入第二条 user JSONL，观察它被 provider 接受、排队、并入、拒绝还是由 controller/driver 排队；等待两个 terminal boundary 或超时。

该分配优先回答原始 `@` 问题。kill/resume、compaction 和 post-cancel reuse 若无法在同两次输入内安全观察，保持 `unverified`。

### 6.3 Kimi Code

先做 prompt mode 与 ACP surface handshake，选择本机实际可启动、事件最结构化的一条作为动态 surface：

1. 调用 1：normal completion，捕获 session id、structured output 和 terminal boundary。
2. 调用 2：优先同 session resume 或 active busy/cancel input。若选择 cancel，只验证 cancel boundary；post-cancel session usability 保持 `unverified`，不能追加第三次调用。

选择依据和被放弃的 case 写入 evidence，未跑 surface 维持 `unverified`。

### 6.4 OpenCode

先启动 disposable `serve` 或 `acp`，验证 endpoint/handshake/SSE 而不输入真实 prompt。动态优先当前 SmallKhoj 使用的 server/SSE 族：

1. 调用 1：normal prompt，关联 message/session/status/tool/SSE 与 completion。
2. 调用 2：在 active prompt 时提交第二条输入，或在 API 明确支持时对第二次 active input 执行 abort 二选一。若选择 abort，post-cancel session usability 保持 `unverified`。

选择 busy input，是因为它直接回答可靠 `@`；选择 abort，则必须说明 busy input 仍未验证。

### 6.5 Qoder、ZCode、Pi 与其他 Agent

- 不安装、不改配置、不做模型调用；
- 记录 binary missing/preflight result；
- capability 为 `unverified`，execution 为 `not_executed`，不是 `unsupported`。

## 7. Timeout, Cancel and Cleanup

### 7.1 Time budgets

- static command：默认 15 秒；
- protocol startup/handshake：默认 30 秒；
- normal minimal turn：默认 120 秒；
- intentionally active window：prompt 指定 5–15 秒，本地总超时不超过 120 秒；
- cleanup grace：先 protocol cancel/interrupt，再 SIGINT/SIGTERM，最后对实验自有 process group SIGKILL；每层等待短且有上限。

具体值在运行 manifest 中冻结，执行途中不为“等一个可能会来的结果”无限延长。

### 7.2 Ownership guard

- controller 启动时记录 PID、process group、cwd、start timestamp；
- cancel/kill 只允许命中 owned process registry 中的实验进程；
- 禁止 `pkill codex`、`killall claude` 等按进程名全局终止；
- 发现 PID 不匹配或进程已复用时停止清理并记录 manual note；
- 不触碰用户已经打开的 Codex/Claude/Kimi/OpenCode session。

### 7.3 Terminal classification

```text
normal terminal + coherent signals              → passed/failed
explicit cancel acknowledged + process settles  → cancelled
controller timeout + no known side effect        → timed_out
transport loss after possible fixture effect     → delivery_uncertain
external/unknown side effect cannot be ruled out → delivery_uncertain + stop
```

`delivery_uncertain` 不自动重试。只有 prompt 和 filesystem evidence 明确证明只读或幂等 fixture-only 时，才允许在剩余预算内重跑；预算已消耗则不重跑。

## 8. Secret Redaction and Evidence Hygiene

### 8.1 Collection restrictions

- 不运行 `env`、不 dump keychain、Provider config、auth database 或完整 home 目录；
- 不把 token/secret 作为命令行参数；若 Provider 自己从已登录状态取认证，证据只记录 `auth_available=true/false/unknown`；
- command record 对 token、cookie、Authorization、API key、session credential 使用占位符；
- protocol frame 采用字段 allowlist，未知大字段默认摘要/hash，不默认全文持久化；
- Provider 输出若回显绝对路径、prompt context 或 header，先过 redactor 再进入任务目录。

### 8.2 Redaction rules

至少覆盖：

- `Authorization: Bearer ...`；
- 常见 `*_API_KEY`、`*_TOKEN`、cookie、JWT、OAuth token；
- URL query 中 token/code/signature；
- 用户 home 下非 fixture 的绝对路径（保留 basename 或 `<HOME>`）；
- Provider session credential 与普通 session/thread id 分开：可安全关联的 opaque id 可以 hash/prefix 化，credential 一律删除。

每份 sanitized evidence 记录 redactor version 和 redaction count。若 redactor 发现无法安全分类的大块内容，该证据只保留 hash、时间和结构摘要。

## 9. Assessment Rules

### 9.1 Busy input

归因顺序：

1. controller 是否在调用 Provider 前自行保留第二条输入；是则 `adapter_queued`；
2. transport 是否返回明确 accepted/queued ack；有证据才可 `provider_queued`；
3. 同一 turn id 的输出是否明确包含 steer correlation；有证据才可 `same_turn_steer`；
4. 是否创建新的 request/turn 并并行运行；有证据才可 `parallel_invocation`；
5. 明确 error/rejection；否则 `unknown`。

第二条消息最终出现在输出中，不足以单独证明 same-turn steer；它也可能是下一次 invocation。

### 9.2 Completion

Matrix 同时列出：

- transport terminal；
- Adapter terminal；
- Provider-declared stop reason；
- process exit；
- semantic outcome evidence。

只有前三者 coherent 才能验证 `observableCompletionBoundary`。任何一项都不自动把 Business Work Item 标为 handled。

### 9.3 Resume

Resume 分三种，不能混写：

| Capability | 含义 |
| --- | --- |
| session reference accepted | 后续请求可以引用同一 session/thread id |
| context continuity observed | 后续输出可复述前一 invocation nonce/上下文 |
| suspend continuation | 未完成 tool/business continuation 从断点恢复 |

前两项即使 verified，也不自动推出第三项。

### 9.4 Cancel/interrupt

需要分别记录：

- request 是否被协议接受；
- active invocation 是否出现 terminal；
- Provider thread/session 是否仍可提交新输入；
- fixture 是否已经变化；
- 是否能判断最后一个 tool call 已完成。

如果最后两项不清楚，结果至少包含 `delivery_uncertain`。

## 10. Portable Reliable-Wakeup Contract Produced by the Spike

若实验没有推翻当前假设，本任务最终推荐的 portable baseline 为：

```text
explicit actionable event
  ↓ deterministic route/filter
durable Work Item: queued
  ↓ wake hint or scheduler poll
adapter capacity available
  ↓ create Dispatch Attempt
submit new/resumed Adapter Invocation
  ↓ observe terminal evidence
record attempt result + separate semantic outcome evidence
```

### 10.1 Guarantees

- actionable work 不只存在于模型注意力或 daemon 内存；
- busy 时 work 继续 queued，不提前声称 dispatched；
- 下一个可观察安全边界会触发新的/恢复后的完整输入；
- wake hint 丢失可以由权威队列重查恢复；
- Adapter terminal 与 semantic outcome 分开；
- uncertain side effect 不盲目重放。

### 10.2 Non-guarantees

- 当前长 turn 立即看到新 `@`；
- 所有 Provider 都支持 active steer；
- cancel 是无损 pause；
- Provider Session resume 是 Tool Loop continuation；
- 模型一定响应或执行业务动作；
- exactly-once Agent behavior；
- 不同 Provider 的 session/context 行为一致。

## 11. Reference-Project Decisions Applied

| Reference pattern | Decision | Design consequence |
| --- | --- | --- |
| Multica server queue + wake/poll fallback | reuse | wakeup 不承担唯一可靠性；future work truth 必须可重查。 |
| Multica slot-before-claim | reuse | future dispatch 只在 Adapter 有容量时开始。 |
| Multica `Session{Messages, Result}` | adapt | 统一 Adapter Invocation，不统一 Provider Turn。 |
| Agent Platform trigger → independent Session | reuse | portable wait/RPC 通过 later invocation callback。 |
| Agent Platform pending draft/interrupt | adapt | 保存后续输入，但 interrupt 不叫 suspend。 |
| Clowder sidecar runtime metadata | reuse | provider state 都作为 evidence/projection，不覆盖业务真相。 |
| Clowder liveness categories | reuse | idle/tool-wait/capacity/stall 分开记录。 |
| Clowder fail-closed resume | reuse | unknown/side-effect conflict → `delivery_uncertain`/manual。 |
| First-party Agent Loop state machine | reject for portable tier | 只在 owned-loop 或已验证 provider-specific tier 承诺。 |

详细证据见 `research/reference-project-runtime-patterns.md`。

## 12. Alternatives Rejected in This Task

### 12.1 直接实现 NATS/Redis Streams

Broker 不能替代 Work Item identity、target、correlation、Adapter capability、outcome evidence 和 uncertain recovery；本任务先回答 runtime boundary。

### 12.2 直接把现有 `pendingUserMessages` 持久化

当前数组的 flush 边界是 Adapter-specific，且状态名可能过度推断 Provider 行为。没有 capability evidence 前直接持久化，会把未知语义冻结进生产 contract。

### 12.3 用 `runtime_working/runtime_idle` 当处理证明

当前 timeline 只能近似表示输入已写入 runtime 和 Provider 发出 result；不能证明模型理解了 `@` 或产生业务结果。

### 12.4 为实验修改生产 driver

会把 spike 风险带入真实 daemon，也让观察结果混入新实现行为。实验优先通过 task-local harness/协议客户端运行；若某 surface 只能由生产 adapter 触发，只做只读/static code evidence，并标 `unverified`。

### 12.5 在本任务引入 Pi/owned loop

Owned loop 能提供强 continuation，但会改变工具、权限、认证、订阅、sandbox 和模型行为。它应在 capability matrix 形成后单独立项。

## 13. Compatibility, Rollout and Rollback

### Compatibility

- 不更改生产 TypeScript/Python API；
- 不要求现有 daemon/session migration；
- 不更改全局 Provider 或 MCP 配置；
- 证据 schema 是 task-local v1，后续生产类型只能引用其结论，不能把实验路径当 API。

### Rollout

本任务的“rollout”只指按 surface 逐个运行探针：static preflight → 一个 Provider 的最小 dynamic case → redaction/评估 → 再决定是否继续下一个。任何 Provider 的失败不阻塞其他 Provider 的静态核对。

### Rollback

- 停止 controller；
- protocol cancel/interrupt 实验 invocation；
- 终止 ledger 内实验 process group；
- 删除 `/tmp` fixture 和 raw transcript；
- 保留 sanitized evidence、blocked reason 和 cleanup report；
- task-local harness 如有缺陷可独立删除，不影响生产 runtime。

## 14. Planned Artifacts

```text
.trellis/tasks/07-13-agent-runtime-capability-matrix/
├── prd.md
├── research.md
├── research/
│   └── reference-project-runtime-patterns.md
├── design.md
├── implement.md
├── probes/                         # Phase 2 才创建的 task-local harness
├── evidence/                       # sanitized dynamic/static evidence
│   ├── run-manifest.json
│   └── <surface>/<case>/...
└── provider-capability-matrix.md   # 最终带 evidence id 的矩阵
```

任务已激活；`probes/`、sanitized `evidence/` 与 `provider-capability-matrix.md` 已生成。它们仍是 task-local spike artifacts，绝不是生产 runtime API。

## 15. Design Validation Criteria

设计在进入实验前必须满足：

- ownership layers 没有把 Adapter state 当 Provider Turn state；
- support level 能表达 conditional/unverified/blocked；
- evidence schema 保留 contradictory signals 和 residual uncertainty；
- 每 Provider 两次调用的预算可审计且不会被自动 retry 绕过；
- cancel/cleanup 只能作用于实验进程；
- raw evidence 在写入任务目录前完成 redaction；
- `delivery_uncertain` 有明确触发条件且不会自动重试；
- 未安装/未登录 Provider 不被猜测；
- 没有生产 Mailbox、daemon 或 backend 变更。

## 16. First Live Evidence Update (2026-07-14)

设计的 ownership model 和 portable baseline 没有被推翻，但三项实现细节被实际结果收紧：

1. **Evidence must structurally redact streaming model content.** Kimi/OpenCode ACP emits many individually short `agent_thought_chunk` / `agent_message_chunk` updates. A byte cap per string is insufficient; recorder v1 now keeps only protocol/update type and aggregate counts. Raw JSONL stays in `/tmp` and is deleted after sanitization.
2. **A protocol acknowledgement is not automatically safe capability evidence.** Codex app-server accepted `turn/steer(expectedTurnId)` and `turn/interrupt`, but also ran a user-global hook outside the fixture. The resulting record is `delivery_uncertain`; it cannot promote portable active steering to `verified` or `conditional` production support.
3. **ACP supports controlled sequential invocations, not continuation.** Kimi/OpenCode ACP both completed two serial prompts in the same resident session under `mode=plan`, with no observed tool-call event and unchanged fixture. This validates a structured next-invocation enhancement, while busy injection, cancel/reuse, cross-process load and suspend continuation remain unverified.

The concrete cell-by-cell result is [`provider-capability-matrix.md`](provider-capability-matrix.md). Future production work must consume its evidence IDs rather than the pre-experiment assumptions in this document.
