# Builtin goose runtime + 结构化事件 schema 重构

> 本 PRD 经 grill-me 多轮盘问定稿。两条主线交织：
> 1. **goose 作为第二个 builtin agent runtime**（与 pi 共存，goose 主推，pi 进入 deprecated）
> 2. **顺带根除 codex 的正则诊断痼疾**——借 NAP UniversalEvent 设计换真 schema，
>    codex + goose 共享同一套结构化事件契约（档 3）

## Goal

把 **goose** 做成与 pi 同级的 **builtin agent runtime**。goose 通过 **ACP** 与 daemon
通信（与 codex-acp 同路），LLM 走 **OpenAI-compatible 直连**（goose 原生 config，不走 pi
backend 中继）。

同时，借接入 goose 的契机**重构 ACP→activity 映射层**：用结构化事件 schema（借 NAP
UniversalEvent 派生）替代现有"伪 Anthropic 信封 + 正则诊断"，codex + goose 共享同一契约，
根除"把结构化 ACP 事件压成文本再正则扫"的信息损失。这是对 codex 现状（activity 抽象
效果不好）的正本清源，不是只服务 goose 的补丁。

## Background / 调研结论（已确认）

### 定位
- **pi：`status: deprecated`**（保留可用，不再投入，计划退出）。不删 pi 代码、不强制迁移
  现有 pi workspace。前端是否打"维护中"标记属另一任务。
- **goose：主推 builtin**。Rust 二进制，冷启动 <300ms、内存 ~22MB，适合多实例常驻。
- 场景：**本机即服务节点**（Mac 对外提供 agent 服务，多 workspace 并发是真实的），非纯单
  用户；架构预留网络存储（NFS）扩展，故 per-session 隔离与 id 防撞有真实价值。

### ACP SDK 现状（无需升级）
- 两边都用官方包 `@agentclientprotocol/sdk`。
- **smallkhoj `^0.28.1`，NAP `^0.14.1`——smallkhoj 更新，不需升级。**
- `@zed-industries/codex-acp@0.16.0` **不是 SDK**，是 codex-acp 二进制 npm 包名
  （`codex-acp-runtime.ts:11`），只给 codex 路径用，与 ACP 协议无关。
- **桥的扩展依赖 SDK 0.28 原生能力**（`onNotification(method, handler)` 注册口），
  版本下限 0.28，由 package.json `^0.28.1` 锁定。

### NAP 接 goose 的本质（可借鉴）
goose 说 ACP，NAP 的通用 ACP 桥直接复用，goose 专属代码只有几处 adapter 边缘的小扩展。
但 **NAP 的 session id codec（平台预生成 UUID + meta.json 映射）不能照搬**——smallkhoj
的 session id 由 core 生成、daemon 是接收方（非预生成方）。改用 **agentId 前缀防撞**。

### 彻查结论（驱动 activity 重构范围）
- stream_event 的 `{message:{content:[...]}}` 伪 Anthropic 信封是 **daemon 内部**的，
  前端/后端不依赖（emitRuntimeTrace 只转发 type/subtype，body 丢弃）。
- 但信封有 **5 个 daemon 内部跨 runtime 通用消费者**：warmup gate（tool_use/tool_result
  扫描）、`countToolResults`、`extractTaskRunOutputMessageIdFromEvent`、control output
  捕获、`translateRuntimeStreamActivity`。档 3 要把它们一起迁移到新 schema。
- 正则诊断 `classifyRuntimeDiagnostic` 有两个调用者：`stream_event` 路径（重构目标，
  该用 `status==='failed'` 替代）与 `'line'` 路径（扫进程 stderr 原始文本，ACP 结构化
  事件不经过，**必须保留正则**）。
- **硬约束**：`extractTaskRunOutputMessageIdFromEvent` 递归解析 `aura message send` 的
  stdout JSON 挖 messageId。无论 schema 怎么换，aura 工具的 stdout payload 必须可从
  "工具输出"恢复，否则 TaskRun outputMessageId 捕获静默失效。

---

## Part A — goose runtime 接入

### R1 — 扩展通用 ACP 桥（`codex-acp-bridge.ts`），增量加 3 个可选 option

纯向后兼容（codex 不传时行为不变）：
- `sessionIdCodec?: SessionIdCodec` —— goose 原生 id ⇄ 平台 id 双向映射
- `clientCapabilitiesMeta?: Record<string, unknown>` —— initialize 时带 `clientCapabilities._meta`
  （schema 0.28 已验证 `_meta` 合法存在，`additionalProperties: true`）
- `onNotification(method, handler)` 注册口 —— **透传 SDK 0.28 原生能力**
  （**不用 NAP 的 `onExtNotification` 通用回调**——那是 0.14 时代的妥协；0.28 有原生
  精确注册口，driver 注册特定 method `'_goose/unstable/session/update'`）

桥内改动：`initialize` 的 `clientCapabilities` 带 `_meta`；`createSession` 返回值经
`codec.encode`；`loadSession/prompt/cancel` 入参经 `codec.decode`；connection 上暴露
`onNotification` 透传。`translateAcpUpdate` 完全通用，不动。

**前置 gate（R1.1）**：写 `goose-acp-smoke.js`（仿现有 `smoke:codex-acp`），验证 0.28 +
真实 goose 二进制组合：initialize 带 goose meta → createSession（验 codec encode）→
简单 prompt → 验收到 `_goose/unstable/session/update` 通知 → loadSession（验 codec decode）
→ 退出。不通过不写 driver。

### R2 — per-session 数据隔离（新建 `goose-session-store.ts`）

每平台 session 一个独立 `GOOSE_PATH_ROOT`（goose-native env，重定向所有 goose 目录），
内含私有 `sessions.db`，单写者无竞争，多 workspace 并发安全。
- 目录名由 **agentId** 派生（`$HOME/.goose-sessions/<agentId>/`，或 agentId+nativeId）
- `prepareSessionDir()`：建目录 + symlink（`config`→`~/.config/goose`、
  `.agents`→`~/.agents`，共享配置/skills），`data/`/`state/` 由 goose 自建
- `SAFE_ID` 正则防路径穿越（agentId 作目录名）

**与 NAP 的差异**：不移植 NAP 的 meta.json 映射 + `sweepOrphanSessionDirs` boot GC
（那是为平台预生成 UUID 设计的）。agentId 前缀方案下，目录名即 agentId，映射隐式存在。

### R3 — session id 防撞 codec（`agentNamespacedCodec`，与 R2 同文件）

goose 原生 id 是 `<日期>_1`（如 `20260806_1`），多 workspace 同日首条会撞。用 agentId
前缀替代（NAP 自己的 codec 文档 acp-bridge.ts:41-48 就举了 `<workspaceId>-<nativeId>`
的例子，证明 namespacing 是 codec 的标准用法）：

```ts
function agentNamespacedCodec(agentId: string): SessionIdCodec {
  const prefix = `${agentId}-`
  return {
    encode: (nativeId) => `${prefix}${nativeId}`,        // "ag_xyz-20260806_1"
    decode: (platformId) => platformId.startsWith(prefix)
      ? platformId.slice(prefix.length)                   // 还原给 goose
      : platformId,                                       // 跨 core id 直通
  }
}
```

约 10 行，替代 NAP 的 ~50 行（meta.json 读写 + sweepOrphan）。
**核心不变量**：1 bridge : 1 session : 1 data dir（NAP 反复强调，多开安全的基石）。

### R4 — goose 真实 usage 提取（`goose-runtime.ts` 内）

移植 NAP `trackExtNotification` + `recordUsage`。goose 的 `PromptResponse.usage` 只反映
turn 最后一次 LLM 请求，工具循环 turn 少计 2×+。改用 goose 累积计数通知：
- 经 R1 的 `onNotification('_goose/unstable/session/update', ...)` 注册
- 过滤 `sessionUpdate === 'usage_update'`，读 `accumulatedInputTokens`/
  `accumulatedOutputTokens`，存进 `accumulatedUsage` map（key=平台 session id）
- turn 结束优先用累积值算 delta，fallback 到 `normalizePromptUsage`（照搬 codex）
- 写 `$HOME/.acp-usage/<sessionId>.jsonl`（平台 id 作文件名，安全）
- **解锁通知需 `clientCapabilitiesMeta: { goose: { customNotifications: true } }`**
  （R1 initialize 时带），无此 flag goose 不发通知

### R5 — LLM provider env（新建 `goose-provider-env.ts`，瘦身版）

goose 走原生 `~/.config/goose/config.yaml`（用户 `goose configure` 配 provider/key/model），
**daemon 不接管 LLM 凭证**。`applyGooseProviderEnv` 只设平台强制开关：
- delete `ANTHROPIC_*`/`GOOSE_FAST_MODEL`（防 core 切换串留）
- `GOOSE_MODE='auto'`、`GOOSE_DISABLE_KEYRING='1'`、
  `GOOSE_DISABLE_TOOL_CALL_SUMMARY='1'`、`GOOSE_DISABLE_SESSION_NAMING='1'`
  （砍两个浪费 LLM 调用的 UI 甜点）
- `OPENAI_CUSTOM_HEADERS='User-Agent=smallkhoj-goose/1.0'`

**不移植 NAP 的 `base_url` 拆分那段**（model/key/base_url 由 goose config 提供）。
后续阶段再考虑把凭证纳入 smallkhoj 配置体系（不在本任务）。

### R6 — GooseRuntimeDriver（新建 `goose-runtime.ts`）

结构仿 `codex-acp-runtime.ts`。`createBridge()` 构造桥时传 goose 参数：
- `command:'goose', args:['acp','--with-builtin','developer,summon']`
  （goose 在 session/new 带 mcpServers 时丢弃 config.yaml extensions，必须 CLI pin
  才保留 developer[shell/edit] + summon[subagent delegate]）
- `env`：baseEnv + applyGooseProviderEnv + `GOOSE_PATH_ROOT=dataDir`
- 绑 `agentNamespacedCodec(agentId)`、`clientCapabilitiesMeta:{goose:{customNotifications:true}}`、
  `onNotification('_goose/unstable/session/update', ...)`→trackExtNotification

**consumeUpdate 走 Part B 的新 schema**（不照搬 codex 的伪 Anthropic 信封）。

### R7 — goose 类型注册与 daemon 接线（每处 1-3 行）

- `types.ts:55` `RuntimeType` 加 `|'goose'`
- `daemon.ts:239` `DaemonRuntimeImplementation` 加 `|'goose'`
- `runtime-activity.ts:1` 加 `'goose'`（Part B 会重构此文件）
- `daemon.ts:2812` `normalizeDaemonRuntimeType` 加 goose 分支
- `cmd/main.ts:37` `parseRuntimeOption` 加 goose
- `runtime-provider.ts:72` `detectedRuntimesForInventory` 加 goose 条目
  （PATH 检测到→`source:'bundled'`+version，否则 `not_installed`）
- `daemon.ts:1095` 工厂加 `runtimeType === 'goose' ? new GooseRuntimeDriver({...})` 分支
- `daemon.ts:733` 自启动条件加 `|| 'goose'`
- `daemon.ts:1506` session ready 条件加 `|| 'goose'`（goose 像 codex 是 ACP resident，
  session 建立即 markRuntimeReady）

### R8 — goose 二进制提供方式（分阶段）

- **第一阶段（本任务）**：PATH 检测。`brew install goose` 或官方 install.sh，daemon detect
  到即报 available。所有优化到位。
- **第二阶段（后续打包任务）**：改打包脚本下载对应架构 goose 二进制塞进发行包
  （仿 NAP `agents/goose/Dockerfile` 拉 v1.43.0）。Rust 原生二进制跨架构分发是独立工程。

---

## Part B — 结构化事件 schema 重构（档 3，codex + goose 共享）

### 为什么（root cause）

现状：codex 的 `consumeUpdate` 把 ACP 结构化事件（discriminated union，带 status/
rawOutput/locations）压成伪 Anthropic 信封 `{message:{content:[{type:'tool_use',...}]}}`，
诊断层再用 7 条正则扫文本猜 error/warning。**信息必然损失**：工具失败靠文本正则猜、
推理混在 text block、工具进度完全丢失。这是 codex activity "效果不好"的根因。
goose 不该继承这个包袱，且 codex 该一起修。

### 设计：NAP 主干派生 schema（借设计 + 补三点 + 改一处弱点）

**借主干**（NAP 5 类消费者生产验证）：`UniversalEvent`（type 时间轴）+ `UniversalItem`
（kind/role/status）+ `ContentPart`（type-tagged）+ `TurnStats` + `call_id` 关联
tool_call/tool_result。

**四字段决策表（已定）**：

| 字段 | NAP 怎么做 | 我们决策 | 理由 |
|---|---|---|---|
| 非终态工具状态 | 缓冲内部 Map，只 emit 终态 | **不保留** | 非回归（现状也丢）；终态足够支撑失败诊断；中间态高频 emit 是性能负担；未来要进度条再加 `item.progress` 扩展 |
| 推理流（reasoning） | schema 占位但 translator `break` 丢弃 | **保留，降级用途** | 成本极低（不再 break，emit 成 reasoning delta）；但不再是诊断主源（那是 tool status 的活），降级为"可选展示+弱诊断补充"，避免贸然全丢让现有可观测性失效 |
| 结构化 diff/图像 | content 拼字符串，图像换文字摘要 | **不保留，保 stdout 可恢复** | 代价最大（牵动持久化+全消费者）；非 IDE 产品不需逐行 diff；底线是 aura stdout JSON 可从 output 解析（messageId 坑不能破） |
| stop_reason 粒度 | 只有 completed/error/interrupted | **保留，顺手做** | 代价近零（字段透传）；对 runtime 健康诊断有价值（max_tokens 频发=上下文爆，tool_use 循环=agent 卡住） |

**改 NAP 弱点**：NAP 的 TS 主类型用 `type: string`（非真 union）。我们直接把主类型做成
**discriminated union**（编译期保证 type→payload 对应），discriminated union 只在 NAP
的 Zod mirror 里的弱点不存在于我们。

**保 output 不截断**：`ContentPart.output` 是 string，但保证完整未截断（尤其 aura stdout
JSON），截断只发生在出网/持久化边界。

### B1 — 定义新 schema（新建 `src/runtime/event-schema.ts`）

```ts
// discriminated union（编译期 type→payload 保证）
type AgentEvent =
  | SessionStartedEvent
  | ItemStartedEvent      // 工具/消息开始（status: in_progress）
  | ItemDeltaEvent        // 流式增量（text / reasoning）
  | ItemCompletedEvent    // 终态（completed/failed）—— 唯一持久化态
  | SessionEndedEvent     // turn 结束（reason + stopReason + stats）
  | ErrorEvent

interface UniversalItem { kind, role, status, content: ContentPart[], call_id? }
interface ContentPart { type: 'text'|'tool_call'|'tool_result'|'reasoning'|'status', ... }
interface TurnStats { inputTokens, outputTokens, costUsd, contextTokens, contextWindow, ... }
```

### B2 — 共享 ACP translator（新建 `src/runtime/acp-event-translator.ts`）

纯函数 + 极少量状态（tool status 跟踪 Map 放 driver 实例，共享模块保持无状态）。
codex 和 goose 的 consumeUpdate 都调它把 ACP SessionUpdate 翻成 AgentEvent：
- `agent_message_chunk` → ItemDelta(text)
- `agent_thought_chunk` → ItemDelta(reasoning)  ← **不 break，启用**
- `tool_call` → ItemStarted(tool_call, in_progress)
- `tool_call_update.status` 终态 → ItemCompleted(tool_call) + ItemCompleted(tool_result)
  ← **status==='failed' 直接产出失败信号，不正则**
- `usage_update` → 缓冲到 buildStats
- `plan` → 暂丢（未来扩展）

**性能保证**：纯函数 + 按需构造（text/reasoning chunk 不碰 rawInput，只有工具终态才解析
output），不比现状慢（删掉的 7 条正则匹配反而省）。

### B3 — codex consumeUpdate 迁移 + 5 个通用消费者迁移

- `codex-acp-runtime.ts` consumeUpdate 改调共享 translator，emit AgentEvent
- 5 个消费者从读 content blocks 改读新 schema：
  - warmup gate（tool_use/tool_result 扫描）→ 读 ItemStarted/ItemCompleted
  - `countToolResults` → 读 ItemCompleted(tool_result)
  - `extractTaskRunOutputMessageIdFromEvent` → 从 ItemCompleted 的 output 解析 aura stdout
  - control output capture → 读 ItemDelta(text)
  - `translateRuntimeStreamActivity` → **重构为读 AgentEvent**，删 daemon.ts:1364 的正则调用
- **正则 `classifyRuntimeDiagnostic` 只保留 `'line'`（stderr）路径**，删 stream_event 路径调用

### B4 — 测试更新

- `test/codex-acp-runtime.test.mjs`：断言从伪 Anthropic 深比较改为 AgentEvent 断言
- `test/runtime-activity.test.mjs`：新 schema 的 activity 信号断言
- 新增 `test/acp-event-translator.test.mjs`：共享 translator 单元测试

---

## Non-goals

- ❌ UI 工具渲染器（goose 工具调用走现有 markdown，不做 tool-renderer）
- ❌ pi 的 backend LLM 中继/容量租ure（goose 不走，那套保持给 pi）
- ❌ goose Rust 二进制打进 npm 发行包（R8 第二阶段）
- ❌ cc-switch / manual provider 对接（goose 走 bundled 检测）
- ❌ runtimeControlSlashCommand（/compact 等，第一版不给 goose 加）
- ❌ 结构化 diff/图像输出（B 决策表已定不保留）
- ❌ 非终态工具状态流式 emit（未来 item.progress 扩展）

## Acceptance Criteria

### Part A（goose）
- [x] `brew install goose` 后 daemon inventory 报 goose `available`+`source:'bundled'`+版本
- [x] 配 `runtime:'goose'` + goose configure 配好 provider 可启动
- [x] 发消息：goose 进程拉起、`~/.goose-sessions/<agentId>/` 生成、ACP 事件流转、
      usage 写入 `~/.acp-usage/`
- [x] 开第二个 workspace 并发跑，两进程独立、SQLite/id 不撞
- [x] goose-acp-smoke 通过（R1.1 前置 gate）

### Part B（schema 重构）
- [x] codex + goose 都走新 AgentEvent schema + 共享 translator
- [x] 工具失败经 `status==='failed'` 结构化判定，stream_event 路径不再调
      `classifyRuntimeDiagnostic`（stderr 路径保留）
- [x] reasoning 作为 ItemDelta(reasoning) emit（不再 break）
- [x] stopReason 在 SessionEnded 透传
- [x] 5 个通用消费者迁移到新 schema，行为等价
- [x] **aura message send 的 stdout JSON 仍可从工具 output 恢复**
      （extractTaskRunOutputMessageIdFromEvent 不破，硬约束）
- [x] tsc 编译通过、全部测试通过

### 回归
- [x] codex-acp 路径不破（桥改动向后兼容，identityCodec 兜底）
- [x] pi/opencode/claude 路径不破（它们若暂未迁新 schema，仍能工作；迁移可分步）

## 实现与验证附录（2026-08-14/15 审计后补）

任务审计（代码层 + 真机）发现并修复了实现阶段的遗漏，随后把产品侧
（backend 白名单 + frontend UI）一并打通。相关提交：

- `9ea92c0` goose builtin runtime + AgentEvent schema（原实现）
- `6d3bd3e` 审计修复：daemon 自启动漏 goose（R7 遗漏）；control output
  capture 未迁 AgentEvent（codex 回归）；goose per-turn usage（message_usage
  逐次累加 → 累积 delta → PromptResponse 三层，goose 1.46 的累积
  usage_update 在 prompt 返回后才到，直接透传会读到上一 turn 的过期值）；
  lastTurnUsage 非 claude runtime 恒空；toolName by callId 补全。
- `cb6e3b2` 产品侧集成：backend `_normalize_runtime` 加 goose；frontend
  RUNTIME_LABELS / PRIMARY_RUNTIMES / 品牌标签 ×3。原实现只做了 daemon，
  用户在 UI 里根本无法创建 goose 智能体（下拉无选项 + API 400）。

### 真机验证证据（隔离环境，未动共享栈）

- R1.1 smoke gate：真实 goose 1.46 + ACP 0.28 桥（codec 编解码、ext 通知、
  loadSession round-trip）。
- 隔离 daemon E2E ×2 turn：autostart、codec 前缀 session id、结构化工具失败
  （status='failed' → runtime_error，无正则）、aura stdout 可恢复、per-turn
  usage；双 daemon 并发：同日 native id `20260814_1` 各自编码不撞、
  sessions.db 独立。
- 隔离全栈 E2E（新库 + 8001/3001 + 一次性 ConnectTicket + goose 分支 daemon，
  浏览器 ./twd）：创建智能体下拉出现 Goose → `goose acp --with-builtin`
  进程拉起 → DM 消息 2s 内收到回复（经 `aura message send` 投递）→
  动态时间线 Working/Thinking/Output/Error/Idle（带真实 per-turn token，
  98344/716）与 `GET /api/v1/activity` 对账一致。
  证据截图：`/tmp/goose-audit-ms6D/evidence-*.png`（会话级，未入库）。
- 单测：translator / codex-acp / runtime-activity（补 AgentEvent 路径断言）/
  pi，共 32 项通过。`daemon-runtime.test.mjs` 有 7 个预存失败（main 同样
  失败，环境问题，与分支无关）。

### 遗留（后续任务）

- R8 第二阶段：goose Rust 二进制打进发行包（PATH 检测已可用）。
- `GOOSE_DISABLE_SESSION_NAMING=1` 疑似对 goose 1.46 失效（日志仍见 session
  命名 LLM 调用），仅多一次小额调用。后续任务登记见
  08-15-acp-sdk-upgrade PRD 的「后续任务登记 D」。
  → 已于 08-15 复测关闭：全部 daemon 代表性路径（新建/恢复/桥接、env=1/unset）
  均恰好一笔 LLM 调用，命名调用不复现；env 保留。见
  08-15 research/g3-session-naming-verification.md。
- codex control output 迁移后无真机覆盖（control 对 goose 是 PRD non-goal）。
- 新增 runtime 的通用流程已沉淀为项目 skill：
  `.agents/skills/smallkhoj-add-runtime/SKILL.md`（下一个 runtime：
  kimicode / DeepSeek Harness 直接复用）。

## Risks

- **goose 版本**：第一阶段不锁版本，若 `goose acp --with-builtin` 行为异常再考虑锁 v1.43.0。
- **5 消费者迁移**：档 3 最大工作量在此。逐个迁移、有 NAP 蓝本、可分 runtime 推进。
- **pi/opencode/claude 暂未迁新 schema**：若 Part B 先于这些 runtime 的迁移完成，它们仍走
  旧路径——需保证新旧两条路径在 daemon 内短期共存不冲突（adapter 层兼容）。
- **slock prompt 继承**：goose 第一版继承 `buildSlockSystemPrompt`，若 goose 有特殊行为再加段落。

## References

- `research/nap-goose-integration.md` — NAP goose 实现逐行解析（移植依据）
- `research/smallkhoj-acp-architecture.md` — smallkhoj 现有 ACP/runtime 架构 + 接线清单
- `research/nap-universal-event.md` — NAP UniversalEvent 深调研（schema 参考设计，Part B 蓝本）
- `research/smallkhoj-stream-event-consumers.md` — codex stream_event 消费者彻查（档 3 风险审计）
- NAP 源码：`/Users/code/project/agent-platform/internal/types/events.ts`、
  `internal/acp-adapter/universal-events.ts`、`agents/claude-code/src/universal-events.ts`、
  `control-plane/src/lib/sse.ts:1033-1131`
