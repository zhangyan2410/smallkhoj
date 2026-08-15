---
name: smallkhoj-add-runtime
description: SmallKhoj 新增 agent runtime 的全链路接入工作流（daemon 接线 → 事件契约 → 产品接线 → 真机验证）。当用户要接入、添加或审计一个新的 runtime / agent 后端（goose、kimicode、DeepSeek Harness、codex 变体等），或提到 runtime 下拉、detectedRuntimes、start_runtime、ACP runtime driver、runtime inventory 时触发。也适用于排查"新 runtime 建不了 agent / 下拉里没有 / activity 不对"这类接线遗漏问题。
---

# SmallKhoj Add-a-Runtime

> 本 skill 是把一个新 agent runtime 接进 SmallKhoj 的完整清单，从 goose
> builtin-runtime 任务（08-06）沉淀而来——每一条都对应 goose 实际踩过或漏过的
> 位置。按顺序执行；接 kimicode / DeepSeek Harness 时直接复用。

## Step 0 — 给 runtime 分类

进程模型决定抄哪个 driver 模板（先读模板再动手）：

| 模型 | 模板 | 例子 |
|---|---|---|
| ACP 常驻（一进程，stdio JSON-RPC 管多 session） | `src/runtime/codex-acp-runtime.ts` / `goose-runtime.ts` + 共享 `CodexAcpBridge` | codex-acp, goose |
| CLI turn-based（每 turn 拉进程，按 session id 续） | `src/runtime/claude-runtime.ts` | claude_code |
| HTTP/SSE server | `src/runtime/opencode-server-runtime.ts` | opencode |
| 随包 JS CLI | `src/runtime/pi-runtime.ts` | pi |

ACP runtime 的事件必须经共享 translator（`src/runtime/acp-event-translator.ts`
的 `translateAcpSessionUpdate`）产出 AgentEvent schema——禁止伪 Anthropic
信封，禁止私有事件形状。

## Step 1 — Daemon 接线（agent/daemon/aaa-daemon）

在源码里 grep `goose` 可以看到每一处的活例。逐项核对：

- `src/types.ts`：`RuntimeType` union 加类型。
- `src/daemon/daemon.ts`：
  - `DaemonRuntimeImplementation` union。
  - `normalizeDaemonRuntimeType()` 接受别名（如 `goose`/`goose_acp`）。
  - **`start()` 里的 boot 自启动条件**加 `|| runtime === '<name>'`。它与工厂
    是两处独立的判断——漏了这处，配置了 runtime 的 daemon 启动后永远不拉起
    runtime，任何消息都投不进去（goose 的 bug #1）。
  - 工厂分支 `new XxxRuntimeDriver({...})`。
  - `driver.on('session')` 的 session-ready 分支（ACP/server runtime 首个
    session 即 ready；CLI runtime 走 warmup gate）。
  - PATH 检测的 runtime 加 `requiresDetectedRuntimeCommand()` +
    `runtimeCommandDetectionError()`。
  - `sessionManager.upsert` 的默认 command 字符串。
- `src/cmd/main.ts`：`parseRuntimeOption()` 加 CLI 旗标。
- `src/runtime/runtime-activity.ts`：`RuntimeActivityRuntime` union +
  `runtimeProtocol()` 映射（走 AgentEvent schema 的 runtime，activity 翻译
  已由共享 item_delta/item_started 路径覆盖）。
- `src/runtime/providers/local-command-provider.ts`：`RuntimeCommandName`
  union + `detectXxxCommand`（env 名 → PATH → home 子路径）。
- `src/runtime/providers/provider-types.ts`：inventory 字段。
- `src/runtime/runtime-provider.ts`：inventory 条目（available /
  not_installed）+ `resolveDetectedRuntimeCommand`。

## Step 2 — 事件契约（ACP runtime）

- consumeUpdate 把每个 SessionUpdate 交给 `translateAcpSessionUpdate()`，
  以 `{ runtime: '<name>', ...AgentEvent }` emit `stream_event`。
- 工具失败必须以 `item_completed` + `status: 'failed'` 出现——daemon 的结构化
  诊断只认它；正则扫模型文本只保留给旧信封 runtime（`eventType ===
  'assistant'`）和进程 stderr。
- 若 agent 在 `tool_call_update` 上不带工具名（goose 如此），在 driver 里按
  `callId` 记住 `item_started` 的 `toolName`，否则失败诊断只会显示 "tool"。
- 硬约束：aura `message send` 的 stdout JSON 必须能从 `tool_result` 的 output
  字符串恢复（`extractTaskRunOutputMessageIdFromEvent`）——工具输出永不截断。
- 已迁 AgentEvent 的消费者：warmup gate、`countToolResults`、
  `extractTaskRunOutputMessageIdFromEvent`、control output capture
  （`collectRuntimeControlResult` 读 `item_delta` 文本）、
  `translateRuntimeStreamActivity`。新增 stream_event 消费者时必须同时处理
  `item_*` 类型与旧信封。

## Step 3 — Runtime 特有加固（按需取舍）

- **session id 防撞**：native id 非全局唯一时（goose：`20260814_1`）加 codec
  （`goose-session-store.ts` 的 `agentNamespacedCodec`）——createSession/通知
  encode，loadSession/prompt/cancel decode。core 生成的 id 不需要（codex）。
- **per-session 数据目录**：runtime 自带共享 SQLite/catalog 时，按 agentId 给
  独立根目录（`GOOSE_PATH_ROOT`）+ SAFE_ID 路径校验。
- **usage 提取**：先确认 agent 实际报什么。goose 1.46：`message_usage` ext
  通知在 turn 内逐次到（准确的 per-turn 汇总）；累积 `usage_update` 在
  prompt 返回**之后**才到（turn 末读它拿到的是上一 turn 的过期值）。分层：
  per-message 汇总 → 累积 delta → `PromptResponse.usage`。ext 通知可能需要
  `clientCapabilities._meta` flag 才解锁。
- **provider env**：daemon 不接管 native-config runtime 的 LLM 凭证——只清掉
  冲突的中继 env（`ANTHROPIC_*`…）并设平台开关；用户经 runtime 自己的配置
  （`goose configure` / OpenAI 兼容 env 透传）配 provider。
- warmup/slock 提示词：在 `buildSlockSystemPrompt` 后追加短小的 runtime 备注
  （沙箱/提权差异、heredoc 禁令）。

## Step 4 — 产品接线（backend + frontend）

漏了这步 daemon 侧等于白做——goose 曾因此用户完全无法创建 agent：

- `backend/routers/public_api.py` `_normalize_runtime()` aliases 加新 id
  （`start_runtime` 信封会原样透传给 daemon，无其他卡点）。
- `frontend/lib/runtime-options.ts`：
  - `RUNTIME_LABELS`——创建智能体下拉里的选项。
  - `PRIMARY_RUNTIMES`——电脑页 chips（否则 daemon 上报了 available 也会被
    过滤不显示）。
  - `publicRuntimeValue()` 的 case/别名。
- 品牌标签表 ×3：`app/(app)/computers/page.tsx`（`runtimeBrandLabel`）、
  `app/(app)/daemon/page.tsx`、`lib/control-plane.ts`（`runtimeLabel`）。
- 新增 UI 文案时补 i18n（标签本身是字面量，不需要）。

## Step 5 — 测试阶梯（逐级 gate）

1. **单测**：translator（仿 `test/acp-event-translator.test.mjs`）、driver
   生命周期、`runtime-activity.test.mjs` 的 AgentEvent 路径断言。
2. **smoke gate**（桥层、真二进制、无 daemon）：复制
   `src/scripts/goose-acp-smoke.ts` → `npm run smoke:<name>`：initialize（+
   capability meta）→ createSession（验 codec encode）→ prompt → 收到 ext
   通知 → loadSession（验 codec decode）。不过不写 driver。
3. **隔离 daemon E2E**（进程内 `DaemonCore` + 假 backend + 隔离 HOME）：
   boot 自启动、codec 前缀 session id、AgentEvent 流、结构化工具失败、
   per-turn usage、per-agent 数据目录。并发：两个实例不同 agentId——同日
   native id 不得相撞。
4. **隔离全栈 E2E**（真实用户路径）：
   - 新库（`CREATE DATABASE … OWNER smallkhoj`），backend 起备用端口
     （先 `alembic upgrade head`；`PORT=8001 DATABASE_URL=… uv run python
     main.py`）；frontend `npm run dev` 带
     `NEXT_PUBLIC_API_BASE_URL` / **`NEXT_PUBLIC_WS_BASE_URL`**（不设会静默
     回落 localhost:8000——打到共享 main 栈！）/ `BETTER_AUTH_URL`。
   - **用 127.0.0.1 域名，不要用第二个 localhost 端口**：cookie 按 host 而非
     端口隔离，localhost:3000/3001 会互相覆盖 session。
   - frontend 依赖：与 main 工作树 package.json 一致时 `cp -cR` 克隆
     node_modules（APFS clonefile；turbopack 拒绝 symlink 的 node_modules）。
   - 电脑接入要一次性 **ConnectTicket**（`POST
     /api/v1/computers/connect-command`），不是 computer credential apiKey；
     `connect-preview` 需要 release 制品（symlink 主仓根 `release-artifacts/`）。
   - 浏览器用 `./twd`：注入 `smallkhoj_session` cookie；React 受控输入用原生
     value setter + input 事件；DM composer 是 `input[name=content]`，Enter
     keydown 提交。
5. **UI 验收**：创建对话框出现该 runtime 且可选 → 建 agent → daemon 拉起真实
   进程 → DM 消息 → 收到回复（看动态 Output 应是 `aura message send`）→
   动态页 Working/Thinking/Output/Error + Idle 带真实 per-turn token → 与
   `GET /api/v1/activity`（字段 `activity`）对账一致。

## 已知坑（都真踩过）

- boot 自启动条件与工厂是两处，都要列。
- control output capture 读 `item_delta` 文本；新 schema runtime 若消费者没迁
  移，control 命令输出静默变空。
- `runtime.lastTurnUsage` 只在 turn 带 `traceId` 时填充；warmup turn 的 Idle
  tokens 为空是正常的。
- 累积 usage 通知可能在 prompt 返回后到达——绝不把累积计数当 turn 总量上报。
- `pkill -f "next dev"` 会杀掉机器上所有 dev server（包括共享 main 栈）。按
  PID/端口杀（`lsof -ti :PORT`）。

## 参考

- 任务 08-06 PRD + research：`.trellis/tasks/08-06-goose-builtin-runtime/`
- runtime 排障：`.agents/skills/` 同仓的 runtime-debugging SOP
  （`.trellis/spec/guides/runtime-debugging-sop.md`）
- backend runtime/slock 契约：`.trellis/spec/backend/runtime-slock-integration.md`
