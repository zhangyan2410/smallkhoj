# NAP UniversalEvent 深调研（Part B schema 参考设计）

> 源：`/Users/code/project/agent-platform`（Neutree Agent Platform, NAP）
> 用途：smallkhoj Part B 档 3 schema 重构的蓝本。本记录两个子 agent 的完整调研，
> 是 PRD "借 NAP 主干派生 schema" 决策的依据。

---

## 总判定

UniversalEvent 是真实、生产验证、多消费者的 schema，有两个生产 translator（ACP 和
Claude Code SDK）。它 goose-agnostic，对 smallkhoj 关心的字段（call_id 关联的
tool_call/tool_result、status、usage、turn 完成）干净地契合 ACP。
**两个注意事项**：(a) 它是 ACP 的**有损子集**——非终态 tool status、agent_thought_chunk、
plan 在翻译时丢弃；(b) TS 主类型用 `type: string`（非真 union），discriminated union
只活在 Zod mirror 里。两者在 smallkhoj 派生版都可修。

---

## 1. 完整类型系统（`internal/types/events.ts`，117 行）

### ContentDelta（10-13）
```ts
export interface ContentDelta {
  type: 'text' | 'reasoning'
  text: string
}
```

### ContentPart（15-28）—— 核心，单 interface + type tag，非 union
```ts
export interface ContentPart {
  type: 'text' | 'tool_call' | 'tool_result' | 'reasoning' | 'status' | 'image'
  text?: string
  call_id?: string
  name?: string
  arguments?: string
  output?: string
  is_error?: boolean
  label?: string
  detail?: string
  data?: string        // base64
  media_type?: string
}
```
六变体共享一个扁平 shape。哪些字段有意义取决于 `type`：tool_call 用 call_id/name/arguments；
tool_result 用 call_id/output/is_error；status 用 label/detail；image 用 data/media_type；
text/reasoning 用 text。

### UniversalItem（35-43）
```ts
export interface UniversalItem {
  item_id: string
  kind: 'message' | 'tool_call' | 'tool_result' | 'status'
  role: 'user' | 'assistant' | 'tool' | null
  status: 'in_progress' | 'completed' | 'failed'
  content: ContentPart[]
  parent_tool_use_id?: string | null
}
```

### UniversalEvent（45-62）—— wire frame，单 interface 非 union
```ts
export interface UniversalEvent {
  type: string              // ← 注意：bare string，非字面量 union
  timestamp: number
  session_id?: string
  reason?: 'completed' | 'error' | 'interrupted'
  stats?: TurnStats
  item?: UniversalItem
  item_id?: string
  delta?: ContentDelta
  request_id?: string
  questions?: unknown[]
  message?: string
  code?: string
}
```
**discriminator**：`type` 字段，实际用七个值：`session.started`、`session.ended`、
`item.started`、`item.delta`、`item.completed`、`question.requested`、`error`
（字面量只在 Zod mirror 强制，见第 4 节）。

### TurnStats（86-93）/ ContextGauge（73-77）
```ts
export interface ContextGauge {
  numTurns: number
  contextTokens: number  // 上次 API 调用 input_tokens ≈ 当前上下文大小
  contextWindow: number
}
export interface TurnStats extends ContextGauge {
  costUsd: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}
```
注释明确且关键：`ContextGauge` 是**唯一**持久化到 session 行（`last_turn_stats`）的部分，
token *accounting* 在独立的 append-only usage ledger，不在这。只有 numTurns/contextTokens/
contextWindow 被持久化（`db/sessions.ts:244-252`、`control-plane/src/lib/sse.ts:281-298`）。

### 关键问题回答
- **discriminated union？** canonical TS 文件**不是**——`type: string`。union 只在 Zod mirror
  （`events.schema.ts:146-159`）。
- **tool_call 和 tool_result 关联？** 是，靠 `call_id`。分属不同 UniversalItem
  （tool_call role assistant；tool_result role tool），消费者按 call_id join。
- **thinking/reasoning vs assistant text？** 分开（ContentPart 'text' vs 'reasoning'，
  ContentDelta.type 可 'reasoning'）。但**实践中 ACP translator 从不 emit reasoning**
  （agent_thought_chunk 是 no-op，见第 2 节），Claude translator 也不。schema 占位无人填。
- **工具 status（pending/in_progress/completed/failed）？** 部分。UniversalItem.status 是
  `'in_progress'|'completed'|'failed'`——无 'pending'。ACP 四态 ToolCallStatus 压成三态；
  pending 当 in_progress 处理。**非终态 status 从不作为 UniversalEvent emit**——translator
  只在终态转换时 emit tool item（line 316）。
- **工具输出 payload / stdout 可恢复？** 是。ContentPart.output(string) 承载，加 is_error。
  ACP 偏好 rawOutput(stringified)，fallback 到 content blocks。DB 持久化截断
  （truncateToolOutput，sse.ts:1122）。stdout 截断限内可恢复；结构化 rawOutput 对象**丢失**
  （只 stringification 存活）。
- **usage/token？** 是，via TurnStats on session.ended（非 per-event）。从 PromptResponse.usage
  + 累积 UsageUpdate 构建（buildStats 471-493）。
- **result/turn 完成？stop reason？** session.ended 带 reason: completed/error/interrupted。
  **无 Anthropic 式 stop_reason**（end_turn/max_tokens/tool_use 等）。

---

## 2. ACP translator —— AcpEventTranslator

`internal/acp-adapter/universal-events.ts`（519 行）。有状态，每 chat turn 一实例（53-56 注释）。

**每个 SessionUpdate kind 的映射**（translateUpdate switch，144-456）：

| ACP sessionUpdate | emit 的 UniversalEvent | 备注 |
|---|---|---|
| agent_message_chunk（145-183） | item.started（首 chunk）+ item.delta/text 每 chunk | 非文本 content block **丢弃**（147-152） |
| tool_call（185-273） | item.started（tool_call, in_progress） | 压制 codex mcp_startup.* 伪调用（191）。已终态则重派为 tool_call_update（264-271） |
| tool_call_update（275-429） | **仅终态转换**：item.completed(tool_call) + item.completed(tool_result) | 最复杂分支。terminalEmitted guard（319-320）保证只 emit 一次。output 从 rawOutput 然后 content blocks（352-382） |
| usage_update（436-446） | **无**——stash 到 lastUsageUpdate 给 buildStats | |
| plan（431-434） | **无**——`// no UI mapping for now` | **丢弃** |
| agent_thought_chunk（448-451） | **无**——`// Internal reasoning` | **丢弃**。schema 的 reasoning 变体未用的原因 |
| 其他 | logged, dropped（453-455） | |

**对 plan、agent_thought_chunk、中间 tool status 是有损压缩**。对 tool_call/result/status
终态/usage 干净无损。终态配对 emit 是刻意设计：translator 缓冲非终态 update 到 Map（69-79），
结束时 emit 一对 item.completed，消费者从不见 pending/in_progress via tool_call_update。

buildStats（471-493）：codex 不填 PromptResponse.usage，input/output 留 0；只 cost 经
usage_update 到达。

---

## 3. Claude Code 也有独立 translator（非 ACP）

`agents/claude-code/src/universal-events.ts`（348 行）。类 `UniversalEventTranslator`（注意：
与 ACP 的不同名）。把 Anthropic Claude Agent SDK 的 SDKMessage 流直接翻成 UniversalEvent，
无 ACP。

**它把 smallkhoj 当前用的伪 Anthropic 信封干净地映射到结构化 schema**：
- stream_event + text_delta → item.started + item.delta（113-138）
- content_block_start tool_use → item.started tool_call（139-162）
- msg.type 'assistant' → 走 message.content[]：text→item.completed message；
  tool_use→item.completed tool_call（168-239）
- msg.type 'user' tool_result → item.completed tool_result，status 从 is_error（271-298）
- system + compact_boundary → status item completed（306-326）

**对 smallkhoj 的关键观察**：此文件证明 schema 干净容纳 smallkhoj 当前用的**完全相同的
伪 Anthropic 信封**。映射直接，因为 Claude Code 和 smallkhoj 共享 Anthropic 血统。

---

## 4. 消费者——跨 5 层验证

UniversalEvent 被**至少 5 个独立层**消费：
1. **OpenAPI/Zod mirror**（`control-plane/src/openapi/events.schema.ts`）——discriminated
   union 实际住这。drift guard 测试断言与 canonical TS 类型同步。
2. **DB 持久化**（`control-plane/src/lib/sse.ts` ~1033-1131）——item.completed 分解成
   session_events 行（每 ContentPart 一行）。item.started/item.delta **不持久化**。
3. **Web/UI**（`web/src/stores/agent-session-store.ts`）——zustand store 消费所有事件类型。
4. **聚合**（`sse-aggregate.ts` aggregateChatStream）——drain SSE 成单 {finalMessage,stats,reason}。
5. **SSE turn 消费框架**（`internal/sse-consumer/src/run-turn.ts`）——通用 runTurn + plugin。

广验证：同 schema 喂 OpenAPI doc 生成器、Postgres 持久化、React 流式 store、静态历史
normalizer、两个聚合器、子 agent dispatcher。

---

## 5. goose 专属 adapter

`gooseToolName()`（universal-events.ts:28-38）：
```ts
function gooseToolName(update) {
  const meta = update._meta as { goose?: { toolCall?: { toolName?: unknown } } }
  const name = meta?.goose?.toolCall?.toolName
  return typeof name === 'string' && name.length > 0 ? name : undefined
}
```
**translator 中唯一 goose 专属代码**。调两次（tool_call start 221、tool_call_update 311），
都在 `stableName = gooseToolName(update) ?? update.kind ?? update.title` fallback 链里。
只读 ACP `_meta` 扩展槽。**UniversalEvent schema 本身零 goose 引用**——schema goose-agnostic，
goose 是 adapter 边缘的翻译 quirk，正是 smallkhoj 想要的分层。

---

## 6. 演化/扩展性

无版本字段、无 schema_version。向后兼容靠 social contract + UniversalEvent 的
optional-everything shape。代码**演示**的演化模式：新 core 在 adapter 边缘 case-by-case
处理（gooseToolName、codex mcp_startup 过滤、codex image-gen 补偿），**不扩 schema 字段**。
ACP 被视为多种输入 shape 之一（独立 Claude translator 的存在即证明）。

---

## 7. 与原生 ACP SessionUpdate 对比——子集 + 增补

| 概念 | ACP | UniversalEvent | 方向 |
|---|---|---|---|
| 助手文本流 | agent_message_chunk | item.delta(text) | 等价 |
| 推理 | agent_thought_chunk | schema 占位，translator 丢 | **实际丢失** |
| 规划 | plan | 无 | **丢失** |
| 工具调用 | tool_call(结构化) | UniversalItem tool_call | **不同 shape**；结构化 kind/content 压成 string arguments |
| 工具中间 status | tool_call_update.status 四态 | 只终态 emit | **丢失**——pending/in_progress 不暴露 |
| 工具结果 | rawOutput+content[] | tool_result output/is_error | **不同 shape**；结构化 content 压成一个 stringified output |
| 图像输出 | content image blocks | 文字摘要 | **丢失**（刻意，避免 MB 级 DB 写） |
| usage | usage_update+PromptResponse.usage | TurnStats on session.ended | 终态等价 |
| turn 边界 | 隐式 | session.ended+reason | 增补 |
| 错误 | 无 | error event | 增补 |
| stop reason 粒度 | 无 | 只有 completed/error/interrupted | 两边都无 Anthropic 式 |

---

## 对 smallkhoj 的移植建议

1. **偷核心 shape**：UniversalEvent + UniversalItem + ContentPart + TurnStats。call_id 关联的
   tool_call/tool_result 分离、item.started/delta/completed 生命周期、session.ended+reason
   都生产验证过。
2. **收紧 discriminator**：canonical TS 直接做 discriminated union（NAP 只在 Zod mirror 做）。
3. **决策保留字段**：四字段决策表已定（见 PRD Part B）——reasoning 启用、stopReason 透传、
   非终态 status 不保留、结构化 diff 不保留但 stdout 可恢复。
4. **预期每 core 一个 translator**（NAP 正是如此：ACP cores 用 AcpEventTranslator，
   Claude-Code 形态用 UniversalEventTranslator）。
5. **镜像 NAP 持久化分裂**：DB 只存 item.completed（终态）；item.started/item.delta 仅
   live-stream。token accounting 不进 per-session stats 行（NAP 的 ContextGauge vs TurnStats
   分裂，注释解释为何）。

**smallkhoj 作者应全文读**：
- `internal/types/events.ts`（契约）
- `internal/acp-adapter/universal-events.ts`（ACP 路径，有损边缘内联文档）
- `agents/claude-code/src/universal-events.ts`（Anthropic 信封路径，最贴 smallkhoj 现状）
- `control-plane/src/lib/sse.ts:1033-1131`（消费者如何把 item 分解成持久行）
