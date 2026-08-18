# smallkhoj stream_event 消费者彻查（档 3 风险审计）

> 本记录是判断"codex 能否与 goose 同改结构化 schema"的依据。子 agent 完整审计了
> codex-acp 的 consumeUpdate 产出格式被哪些下游消费、改成结构化会牵动哪些点。
> 路径基于 `/Users/code/project/smallkhoj/agent/daemon/aaa-daemon/`，行号已对齐源码。

---

## 1. 被审计的契约 —— consumeUpdate（codex-acp-runtime.ts:296-375）

所有 emit 的事件共享 `runtime: 'codex_acp'`、`session_id`/`sessionId`（都设为 ACP
notification.sessionId）、`acpUpdate: update.sessionUpdate`（注意：**只 discriminator 字符串**，
如 'tool_call_update'，非 raw 对象）。伪 Anthropic shape 按 ACP kind 构建：

| ACP kind | emit 的 type | message.content[0] block 字段 |
|---|---|---|
| thought_delta（304-317） | 'assistant' | `{type:'thinking', thinking}` |
| message_delta（304-317） | 'assistant' | `{type:'text', text}` |
| tool_call（319-341） | 'assistant' | `{type:'tool_use', id, name, input:{status, command:codexToolCommandPreview, raw:完整 SessionUpdate}}` |
| tool_result（343-361） | 'user' | `{type:'tool_result', tool_use_id, content:JSON.stringify({status,raw}), is_error:status==='failed'}` |
| usage（363-374） | 'usage' | 无 message——顶层 used/contextWindow/raw |
| result（buildResultEvent 377-389） | 'result' | 无 message——subtype:success/cancelled, stopReason, usage, raw |
| runPrompt catch（283-288） | 'result' | subtype:'error', error |

`input.raw` 在 tool_use 块承载完整 raw SessionUpdate 对象；tool_result.content 是
`{status, raw:<完整 update>}` 的 JSON 字符串。这是结构化 ACP 数据存活进 stream_event 的
唯一两处。

---

## 2. daemon.ts 中每个 stream_event 消费者

driver 注册 daemon.ts:1218（`driver.on('stream_event', (event)=>{...})`）。单 handler，按用途分支：

**(a) Warmup gate** —— daemon.ts:1228-1260。通用（每 runtime 跑）但有 codex 专属 fast path。
- 1229 `runtime.runtime === 'codex' && eventType === 'result'` + `event.subtype === 'success'`
  → markRuntimeReady('codex_acp_warmup_complete')。**codex 专属**。读 event.subtype。
- 1235-1245 `eventType === 'assistant'` → 迭代 getContentBlocks，读 block.type==='tool_use'、
  .id、.name、.input.command。匹配 `name==='Bash' && /\baura\b/.test(cmd)` 或 /aura/i.test(name)，
  存 block.id 到 pendingWarmupResult。**通用**，但依赖伪 Anthropic tool_use 块。
- 1246-1259 `eventType === 'user'` → 读 block.tool_use_id、.content、.is_error。**通用**。

**(b) Task run 工具计数** —— daemon.ts:1337-1359。
- 1338 countToolResults(event) → getContentBlocks.filter(b=>b.type==='tool_result').length
  （helper daemon.ts:3028-3031）。**通用**。
- 1340 extractTaskRunOutputMessageIdFromEvent(event)（daemon.ts:2984-2996）→ 迭代 getContentBlocks，
  读 tool_result，递归挖 block.content/stdout 找 UUID messageId。**通用**——扫 aura message
  send 的 stdout JSON（在 tool_result.content 字符串里）。

**(c) Usage/上下文捕获** —— daemon.ts:1262-1331。
- 1272-1316（trace，eventType==='result'）读 event.usage、.modelUsage、.duration_api_ms。
  **通用**（claude_code 还读 session-jsonl at 1284-1286，codex 跳过）。
- 1319-1331（eventType==='usage'）读 event.used、.totalTokens、.contextWindow/.size →
  存 runtime.lastTurnContextUsage。**通用**。codex-acp 的 usage 事件（363-374）喂这。

**(d) Activity/诊断翻译** —— daemon.ts:1361-1430。
- 1361 translateRuntimeStreamActivity(runtimeType, event)——共享 seam（见第 4 节）。
  返回 RuntimeStreamActivitySignal[]。
- 1362-1381 每 signal.type==='thinking'：调 classifyRuntimeDiagnostic(signal.text)（正则）；
  若 severity，reportRuntimeActivity(runtime_error|warning, …, {protocol, sourceEvent, message})。
  **这是要杀的正则-on-stream-event 路径**。codex 的 sourceEvent 是 acpUpdate 字符串
  （如 'agent_thought_chunk'）。
- 1386-1394 否则若 turn 非 idle，reportRuntimeActivity('runtime_thinking', …)。
- 1396-1430 eventType==='assistant' → 每 signal.type==='tool_use'，dedup via
  recordedToolUseIds，increment activeTaskRunToolUseCount，reportRuntimeActivity('runtime_output',
  'Ran '+toolName, {toolName, commandPreview: sanitizeRuntimeCommandPreview, protocol, sourceEvent})。
- 1431-1472 eventType==='result' → activityTurnState='idle'，reportRuntimeActivity('runtime_idle')。

**(e) 控制命令输出提取** —— daemon.ts:2742-2799（collectRuntimeControlResult）。
- 2777-2789 event.type==='assistant' → getContentBlocks，读 block.type==='text'、.text，
  拼 chunks[]。**通用**，伪 Anthropic 依赖。
- 2791-2793 event.type==='result' → 读 event.is_error、.subtype、.error、.message。**通用**。

**(f) Trace emission（仅遥测）** —— daemon.ts:1475-1481。
- emitRuntimeTrace({type:'stream_event', agentId, eventType, subtype, sessionId})——**只转发
  type/subtype 字符串，不转发 message body**。见第 5 节。

---

## 3. classifyRuntimeDiagnostic / runtimeDiagnosticDescription（daemon.ts:2901-2937）

正则（patterns 2909-2925）。两个调用者，都喂 reportRuntimeActivity：
1. **'line' handler** daemon.ts:1200-1214——扫 event.line（bridge 的原始 stdout/stderr 文本，
   非 stream_event）。report runtime_error/warning，source:'stderr'。**ACP 重构不影响**——
   扫进程 stderr/stdout 行（如 'Codex turn exited: code=0'），从不流经 consumeUpdate。
   **重构时不要删这个正则；它留下。**
2. **stream_event activity 路径** daemon.ts:1364-1381——扫 translateRuntimeStreamActivity 从
   assistant text/thinking 块产出的 signal.text。**重构目标**。今天 tool_call_update.status
  ==='failed' 的失败只作为可能匹配正则的文本浮现；结构化 ACP 会用直接信号替代。

---

## 4. translateRuntimeStreamActivity（runtime-activity.ts:33-89）—— 唯一 activity 信号消费者

跨 src/ 穷举 grep（message.content / getContentBlocks / block 字段读取，排除定义 getContentBlocks
的 claude-runtime.ts）：伪 Anthropic `{message:{content:[...]}}` shape 的**唯一**读者：
- runtime-activity.ts:114-119（contentBlocks helper）——translateRuntimeStreamActivity 用。
- daemon.ts getContentBlocks 调用 at 1236, 1247, 2778, 2986, 3030（见第 2 节 a/b/e）。

所以 translateRuntimeStreamActivity 是**唯一从 content blocks 派生 activity 信号**的消费者，
但**不是唯一消费 content-block shape 的**——warmup gate(a)、task-run counting(b)、
control output(e) 也直接读 content blocks。档 3 全 schema 迁移时它们都要更新。

其他 runtime-activity.ts codex 专属读：runtimeSourceEvent(104-112) 读 event.acpUpdate(字符串)
作 sourceEvent。toolInputPreview(121-134) 读 block.input.{command,cmd,...}，fallback 到
input.rawInput.{…}——注意 codex-acp 把 raw update 放 input.raw 非 input.rawInput，所以 codex
fallback 永不命中，只用 input.command（codexToolCommandPreview 设）。

---

## 5. 前端/后端契约 —— stream_event shape 是 daemon 内部，不逃逸客户端

**关键风险问题，已验证**：
- 'stream_event' listener（daemon.ts:1218）**从不**把完整 event 序列化给客户端。stream_event
  到 emitRuntimeTrace 的唯一处是 daemon.ts:1475-1481，且只转发
  `{type:'stream_event', agentId, eventType, subtype, sessionId}`——**不转发 message、content、
  acpUpdate、usage**。body 丢弃。
- emitRuntimeTrace（daemon.ts:2221-2228）emit 'runtime_trace' EventEmitter 事件 + 写 ring buffer。
  搜 src/ 和 test/ 找订阅者（.on('runtime_trace'/.on('runtime_line'/.on('runtime_session'）——
  **零订阅者**。fire-and-forget 遥测。
- 真正的客户端/backend 通道是 reportRuntimeActivity（daemon.ts:2123-2150）→
  POST /internal/agent-api/activity，{type, description, details:truncateDetails(details,200)}。
  details 每 string 字段截断 200 字符。所以 signal.text、commandPreview 等确实出网，但只在
  translateRuntimeStreamActivity 从 content blocks 解包后。伪 Anthropic 信封本身**不到网络**。
- 第二通道 reportTaskRunLifecycle（daemon.ts:2152-2189）→ POST .../task-runs/:id/lifecycle，
  发 tokenUsage、toolUsageSummary（仅计数）、contextUsage、outputMessageId。派生计数/ID，
  非 raw content blocks。
- client-handler.ts 不订阅 runtime_trace/line/session。客户端读经
  daemon.getProxy().eventBuffer.snapshot()——那 buffer 由 AGENT PROXY 喂，非 runtime stream_event。

**结论：伪 Anthropic content-block shape 100% daemon 内部。** 改它不能直接破前端/backend 契约。
唯一逃逸的是 activity descriptions、commandPreview 字符串、工具计数、output messageId、
usage 数字——重构必须继续产出这些，但信封自由可改。

---

## 6. codexToolCommandPreview 和 input.command/input.raw 结构（codex-acp-runtime.ts:433-443）

codexToolCommandPreview 提取 update.rawInput.{command,cmd,script}（或 rawInput 的字符串形式）
存为 tool_use 块的 input.command（line 333）。完整 update 对象存 input.raw（line 334）。

读者：
- runtime-activity.ts:83 toolInputPreview(input, name)——先读 input.command（122 行 loop 首选 key），
  fallback cmd/script/query/path/file_path/url，再 input.rawInput.{…}。codex 只 input.command
  有值，fallback keys 对 codex 死代码（opencode/bash 用）。结果 commandPreview 在
  daemon.ts:1411 浮现（runtime_output activity details，经 sanitizeRuntimeCommandPreview 剥
  SLOCK_AGENT_* env 值，2965-2980）。
- warmup gate daemon.ts:1240 读 input.command 匹配 /\baura\b/。

无其他读者。若重构把 command preview 移到结构化字段，runtime-activity.ts:toolInputPreview 和
warmup gate 的 input.command 正则需同步更新。

---

## 消费者 → 重构影响表

| # | 消费者（file:line） | 读什么 | codex 专属？ | 信封变会破吗？ |
|---|---|---|---|---|
| 1 | daemon.ts:1229-1233 warmup codex fast-path | result 的 event.subtype==='success' | YES | 仅若删 result subtype |
| 2 | daemon.ts:1236-1244 warmup tool_use 扫描 | getContentBlocks, tool_use, .id, .name, .input.command | 否 | YES 若删/改 tool_use 块 |
| 3 | daemon.ts:1247-1258 warmup tool_result 扫描 | tool_result, .tool_use_id, .content, .is_error | 否 | YES 若删/改 tool_result 块 |
| 4 | daemon.ts:1272-1316 result trace | event.usage, .modelUsage, .duration_api_ms | 否 | 仅若改 result usage |
| 5 | daemon.ts:1319-1331 usage 事件 | event.used, .contextWindow/.size/.totalTokens | 否 | YES 若删 usage 事件类型 |
| 6 | daemon.ts:1338 countToolResults | getContentBlocks, tool_result | 否 | YES 若 tool_result 块消失 |
| 7 | daemon.ts:1340 extractTaskRunOutputMessageIdFromEvent | getContentBlocks, tool_result.content JSON 挖 | 否 | YES——扫 aura message send stdout。必须保等价"工具输出 payload"面 |
| 8 | daemon.ts:1361 translateRuntimeStreamActivity | message.content[] + acpUpdate + input.command | 否 | **重构目标** |
| 9 | daemon.ts:1364-1381 thinking→诊断正则 | signal.text | 否 | 间接：结构化失败信号产出后消失 |
| 10 | daemon.ts:1386-1394 runtime_thinking | signal.text, .protocol, .sourceEvent | 否 | 间接 |
| 11 | daemon.ts:1396-1413 runtime_output | signal.toolUseId, .toolName, .commandPreview, .protocol, .sourceEvent | 否 | 间接 |
| 12 | daemon.ts:1431-1471 result→idle+TaskRun | event(result), lastTurnUsage | 否 | 仅若 result 事件 shape 变 |
| 13 | daemon.ts:1475-1481 emitRuntimeTrace | event.type, .subtype | 否 | 安全——body 已不转发 |
| 14 | daemon.ts:2777-2789 控制输出捕获 | getContentBlocks, text, .text | 否 | YES 若 assistant text 块变——/daemon 斜杠命令依赖 |
| 15 | daemon.ts:2791-2793 控制结果 | event.is_error, .subtype, .error, .message | 否 | 仅若 result shape 变 |
| 16 | daemon.ts:1200-1214 stderr 行诊断 | event.line（进程输出，非 stream_event） | 否 | **NO——独立于 ACP。保留正则。** |
| 17 | runtime-activity.ts:104-112 runtimeSourceEvent | event.acpUpdate(字符串) codex | YES | 若不设 acpUpdate，sourceEvent fallback 'codex_stream_event'。cosmetic，但 test 断言精确值 |
| 18 | runtime-activity.ts:114-119 contentBlocks | event.message.content | 否 | YES——重构目标 |
| 19 | runtime-activity.ts:121-134 toolInputPreview | block.input.command 等 | 否 | 间接 |
| 20 | test/codex-acp-runtime.test.mjs:153-170 | assistant.message.content 深比较, usage.used, result.usage | 测试 | YES——断言精确伪 shape。需更新测试 |
| 21 | test/runtime-activity.test.mjs:29-134 | acpUpdate 字符串, tool_use/input.command | 测试 | 间接——需新 fixtures |

---

## 底线：codex 能否与 goose 同改

**能，三个约束**：
1. **前端/backend 非阻塞**。信封 daemon 内部，无 wire 依赖。自由改信封。
2. **不能直接停发伪 Anthropic 块**——5 个通用消费者（warmup #2/#3、counting #6/#7、
   control output #14）跨 ALL runtime 读 content blocks。要么(a)保最小信封+加结构化字段，
   要么(b)同时重构这 5 个消费者。档 3 选(b)。
3. **正则诊断两调用者，只一个在范围**。stream_event 路径(#9)是重构目标。'line' 路径
   (#16)扫 raw 进程 stderr，必须留正则。不要删 classifyRuntimeDiagnostic；split usage。

**关键坑**：extractTaskRunOutputMessageIdFromEvent(#7)递归解析 aura message send stdout
JSON（在 tool_result.content 字符串里）。无论结构化 shape 怎么换，aura 工具的 stdout
payload 必须能从等价"工具输出"恢复，否则 TaskRun outputMessageId 捕获静默失效。
