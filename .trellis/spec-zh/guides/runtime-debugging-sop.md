# Runtime 调试 SOP（操作规程）

> **目的**：当 agent 不回复/很慢/疑似卡住时，按这个标准流程走，而不是临时抓日志。Activity 时间线是首要入口；它由 daemon 的 verbose stream-json 翻译器驱动，展示 runtime 的真实状态。

---

## 四态时间线

每个 runtime 回合都经历四个状态。Activity 标签页记录每一次状态迁移：

| 状态 | kind | 颜色 | 含义 |
|---|---|---|---|
| **Working** 🟠 | `runtime_working` | 橙色 | 消息已到达 runtime stdin（新回合开始） |
| **Thinking** ⚪ | `runtime_thinking` | 黄色 | Claude Code 正在调用提供商（第一个 `assistant` 事件） |
| **Output** 🔵 | `runtime_output` | 蓝色 | runtime 调用了工具（`tool_use` 块） |
| **Idle** 🟢 | `runtime_idle` | 绿色 | 回合结束（`result` 事件）；携带 token 和时长指标 |

数据的事实来源：**Claude Code verbose stream-json 事件**，由 daemon 的 `stream_event` 处理器上报，而不是 daemon 自行估算的猜测值。

---

## Trace-ID 端到端延迟追踪（trace）

四态时间线回答“回合是否卡住、卡在哪里”。而“回复**慢**——到底哪一段慢”这个问题，请改用 trace-ID 流水线，不要逐层分别翻日志。

### 工作原理

- 后端在创建消息时生成 `traceId`（`backend/services/latency_trace.py` — `trace_id_from_request`，格式 `message:<hex>`；调用方提供的 `X-SmallKhoj-Trace-Id` 头优先）。该 id 随 EventRecord 负载经 WS 进入 daemon（`message.traceId`），并标记每一个 daemon/runtime span。
- 后端 span：`backend.public_message.*` / `backend.agent_send.*` — `request_received → resolve → db_flush → event_record → commit → push_events → response_ready`。
- daemon/runtime span：`daemon.websocket.message_received`（WS 接收）→ `daemon.runtime_delivery.attempt` / `.sent_or_queued` → `daemon.runtime.stdin_write` → `daemon.runtime.first_output` → `daemon.runtime.result`。
- 每个 span 对应一行 `Latency trace: {traceId, span, elapsedMs, ...}` 日志——后端写入 `.dev-logs/backend.log`，daemon 经其日志 RPC 上报。`smallkhoj-trace` 两者都能解析。

### “回复慢”的标准排查路径

1. `./smallkhoj-trace latency` — 按 traceId 分组 span，以相对首个事件的 `+elapsed` 打印。用 `--tail N` 扩大窗口；用 `--json` 看原始事件。
2. `./smallkhoj-trace summary --json` — 跨层时间线 + 服务健康，看哪一层停止了输出。
3. `./smallkhoj-trace follow` — 复现慢回合时每 2 秒实时刷新。

### 说明

- 这是**唯一现成的、覆盖 backend → WS → daemon → runtime 全链路的视图**。不要用单层日志重建时间线——单个层无法归属层与层之间损失的时间。
- 层内 `elapsedMs` 基于单调时钟；跨层偏移来自墙上时钟的 `at` 时间戳，因此跨层间隙只能当作近似值（秒级）。
- 提供商延迟数字要用 daemon 实测的 `wallClockMs`，绝不用提供商上报的 `durationApiMs`（虚高——见第 4 步和上文的 MiniMax 说明）。

---

## 标准调试流程

### 第 1 步：读 Activity 时间线

打开 agent 的 **Activity** 标签页。找到最后一条 `runtime_working` 记录（你发的那条消息），然后向后读：

- **停在 Working，没有后续 Thinking** → 消息从未到达 runtime。检查 daemon WS 连接、`start_runtime` 控制命令，以及 runtime 进程是否存活。
- **停在 Thinking** → 提供商慢或不可用。看后面最终有没有跟上 Idle 记录——如果 daemon 日志里在 Thinking 和下一状态之间有大量 `api_retry` 事件，瓶颈就是提供商（GLM/Kimi/MiniMax）。
- **停在 Output** → 某个工具调用挂起了。Output 记录的 `details.toolName` 会告诉你是哪个工具。检查 slock CLI 健康状况、文件权限等。
- **到达 Idle 但频道没有回复** → runtime 完成了回合，但从未调用 `slock message send`。这是 **kimi-for-coding** 的典型故障模式——模型以纯文本作答而不使用 slock CLI。在第 3 步确认。

### 第 2 步：在会话（session）文件中确认事实

Activity 时间线派生自流事件。如果它看起来不对，检查源头：

```
~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
```

- `<encoded-cwd>` = runtime 工作区路径，把 `/` 替换为 `-` 并带前导 `-`。
- 每一行是一个 JSON 对象：`user`（注入的消息或 tool_result）、`assistant`（模型输出 + tool_use）、`result`（带用量的回合摘要（summary））。
- **会话文件里的 token 计数才是真实计费数字。** daemon 追踪里的 `cacheReadInputTokens` 可能被提供商的 Anthropic 兼容适配器放大（已知 MiniMax 会多报约 2-8 倍）。相信会话文件。

### 第 3 步：检查“没有 slock send”故障

如果 runtime 已到达 Idle 但频道没有 agent 回复：

1. 打开该回合的会话 jsonl。
2. 查看 `assistant` 消息的 `content` 块。
3. 如果 `tool_use` 块数量为**零**（或没有任何 `slock message send`），说明模型以普通聊天文本作答——回复生成了，但从未发到频道。

已知问题源：`kimi-for-coding`。缓解手段：预热门禁（启动就绪检查）会提前暴露这类问题——此类 runtime 在 `starting` 状态超时，并在追踪中带 `reason=warmup_timeout` 降级。

### 第 4 步：诊断指标异常

如果 `cacheReadInputTokens` 高得不真实（例如全新会话就有 70k+）：

- 检查 daemon 追踪的 `providerReportedInflated` 字段——若为 `true`，提供商的用量报告不可信。
- 做延迟对比时用 `wallClockMs`（daemon 实测，绝不虚高），不要用 `durationApiMs`（提供商上报）。
- 要真实 token 计数，读会话文件的 `message.usage.cache_read_input_tokens`。

---

## 关键文件

| 内容 | 位置 |
|---|---|
| 四态翻译器 | `agent/daemon/aaa-daemon/src/daemon/daemon.ts` — `stream_event` 处理器 + `reportRuntimeActivity` |
| Activity 写入 API | `backend/routers/agent_api.py` — `POST /internal/agent-api/activity` + `_record_activity` |
| Activity kind 到事件的映射 | `backend/routers/agent_api.py` — `ACTIVITY_EVENT_TYPES` |
| 前端渲染 | `frontend/app/(app)/members/activity-tab.tsx` — 图标/文案/颜色/分桶映射 |
| 会话事实来源 | `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` |

---

## 设计原则（为什么这样构建）

1. **verbose stream-json 是唯一事实来源。** daemon 只翻译，不猜测。运行时状态不靠自行测量的启发式判断。
2. **截断发生在 daemon 侧**（每个字符串字段 200 字符）——最小化网络带宽，并保持 `activity_logs` 行体量小。
3. **后端 `_record_activity` 与存储实现无关。** 详情是扁平 JSON，没有 SQL 关系依赖。当活动量增长时，只需替换 `_record_activity` 的实现即可把存储迁移到 NoSQL（Mongo/DynamoDB）——daemon 和前端不用改。
4. **任何活动之前先过预热门禁。** 四态翻译器只在 `runtime.ready` 为 true 后触发，启动噪声不会污染时间线。
