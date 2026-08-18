# NAP goose 接入实现细节（逐行解析）

> 源仓库：`/Users/code/project/agent-platform`（Neutree Agent Platform, NAP）
> 本文档是 smallkhoj 接入 goose 的移植依据。记录 NAP 已验证的实现，含文件路径、
> 行号、关键代码片段，供 `goose-runtime.ts` / `goose-session-store.ts` /
> `goose-provider-env.ts` 移植时参照。

---

## 1. goose 是怎么被调起的

**NAP spawn `goose` 二进制作子进程，走 stdio 的 JSON-RPC（ACP 协议）对话。**
无 HTTP API、无 in-process 库。

```
控制面下发 agent_type="goose"
   ↓ (字符串拼镜像名 → nap-agent-goose:latest)
agents/goose/src/index.ts   ← 入口：注入平台prompt/skill/凭据/模型env
   ↓ setBridgeFactory
internal/acp-adapter/acp-bridge.ts  ← 通用桥，spawn('goose', ['acp', ...])
   ↓ stdio ndjson + @agentclientprotocol/sdk
goose 二进制 (v1.43.0)
```

goose 版本锁定 **v1.43.0**（`agents/goose/Dockerfile:92-101`，从
`github.com/block/goose/releases` 下载）。容器入口是 Node agent server，
goose 被 per-session on-demand spawn。

## 2. ACP SDK

- 包名：**`@agentclientprotocol/sdk`**（官方 Zed SDK，非 `codex-acp`、非
  `@agent-client-protocol/*`）。历史名 `codex-acp` 只残留在日志/错误信息里。
- 版本：**`^0.14.1`**（声明于三处 package.json：`internal/acp-adapter`、
  `agents/codex`、`agents/goose`）。
- 导入：`ClientSideConnection`, `ndJsonStream`, `PROTOCOL_VERSION`，类型
  `Client`, `ContentBlock`, `McpServer`, `PromptResponse`,
  `RequestPermissionRequest/Response`, `SessionNotification`, `SessionUpdate`。

## 3. goose 专属代码只有 6 处

NAP 不在 agent runtime 里做 `switch(agentType)`。`agent_type` 是自由字符串端到端
流转（Zod schema 无 enum，`internal/types/api.ts:65`）。
- 镜像名靠字符串拼接：`getAgentImage(agentType)` =
  `${AGENT_IMAGE_PREFIX}-${agentType}:${AGENT_IMAGE_TAG}`（`internal/k8s-provider/config.ts:34`）
  → `goose` 产出 `nap-agent-goose`。
- 仅 UI 下拉枚举三值（`web/src/components/workspace/ModelFields.tsx:22`）。
- 两处 `AgentKind` union（`internal/agent-skills/src/platform.ts:24`、
  `internal/platform-prompt/src/index.ts:9`）仅用于 Mustache view 构造。

### 3.1 桥工厂（`agents/goose/src/index.ts:108-121`）

```ts
setBridgeFactory(async (sessionId: string) => {
  const dataDir = prepareSessionDir(sessionId)
  const b = new AcpBridge({
    program: 'goose',
    args: ['acp', '--with-builtin', 'developer,summon'],
    cwd: WORKSPACE_DIR,
    env: { GOOSE_PATH_ROOT: dataDir },
    sessionIdCodec: sessionDirCodec(sessionId),
    clientCapabilitiesMeta: { goose: { customNotifications: true } },
    onExtNotification: (method, params) => trackExtNotification(sessionId, method, params),
  })
  await b.start()
  return b
})
```

两个 goose 专属 knob：
- `sessionIdCodec` —— 把 goose 每库 native id（`YYYYMMDD_1`）映射到平台 UUID。
- `clientCapabilitiesMeta: { goose: { customNotifications: true } }` —— 解锁私有
  `_goose/unstable/session/update` 通知流（initialize 时发送，`acp-bridge.ts:216-221`）。

### 3.2 `--with-builtin developer,summon` 为什么必需（`index.ts:86-92`）

> goose REPLACES its config-file extension set with the ACP session/new list.
> Only CLI-pinned builtins survive (`initial_session_extensions` in goose's ACP
> server). Without developer the agent has no shell/edit tools; summon adds the
> delegate/load subagent tools.

session/new 带 mcpServers 时（平台总是带），goose 丢弃 config.yaml 的 `extensions:`，
只有 CLI pin 的 builtin 存活。

### 3.3 Universal Event 的 goose helper（`internal/acp-adapter/universal-events.ts:28-38`）

```ts
function gooseToolName(update: { _meta?: unknown }): string | undefined {
  const meta = update._meta as { goose?: { toolCall?: { toolName?: unknown } } } | null | undefined
  const name = meta?.goose?.toolCall?.toolName
  return typeof name === 'string' && name.length > 0 ? name : undefined
}
```
用于 `universal-events.ts:221` 与 `:311`：`const stableName = gooseToolName(update) ?? update.kind ?? update.title`。
goose 的 `title` 是模型生成的展示文本（不稳定），不靠这个 helper 工具分发会 key 在
不稳定字符串上。codex 无 `_meta`，落到 `kind`/`title`。

### 3.4 session store 适配（`agents/goose/src/session-store.ts`）—— 见第 4 节

### 3.5 usage 提取（`internal/agent-usage/src/index.ts:426`）

`parseAcpUsageLog()` + `UsageSource` 加 `'goose'`。sweeper dispatch
（`internal/agent-usage/src/node.ts:113-218`）三独立 for 循环：claude 走
`.claude/projects/`、codex 走 `.codex/sessions/`、goose 走 `.acp-usage/`。

### 3.6 UI tool 渲染器（`internal/ui-sdk/src/tool-renderers/goose/developer.tsx`，245 行）

注册 8 个 goose 原生工具渲染。**smallkhoj 不做 UI 渲染器，跳过此项。**

---

## 4. per-session SQLite 隔离（`agents/goose/src/session-store.ts`，移植核心）

### 4.1 WHY（header comment）

> Goose keeps every session in one shared SQLite catalog (WAL mode,
> `$DATA_DIR/goose/sessions/sessions.db`). On the workspace volume that file
> sits on NFS, where a single writer already suffers sqlx's 5s busy-timeout
> convoy (10-56s turns measured) and concurrent writers from multiple NFS
> clients are documented-unsafe — and the serverless direction (one workspace
> scaling to N pods sharing one PV) makes multiple clients unavoidable.
>
> So each platform session gets its own GOOSE_PATH_ROOT with a private tiny
> sessions.db holding exactly one session: single-writer by construction
> (cp serializes turns per session), collision-free across pods.

机制是 `GOOSE_PATH_ROOT`（goose-native，见 `crates/goose/src/config/paths.rs`），
重定向所有 goose 目录（`$ROOT/{config,data,state}`、`$ROOT/.agents`）。
仅 `data/`/`state/` per-session；`config`/`.agents` symlink 回共享副本。

### 4.2 常量与安全（lines 49-63）

```ts
const HOME = process.env.HOME ?? `${process.env.WORKSPACE_DIR || '/workspace'}/.home`
export const SESSIONS_BASE = join(HOME, '.goose-sessions')
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function sessionDataDir(platformId: string): string {
  if (!SAFE_ID.test(platformId)) {
    throw new Error(`Refusing unsafe session id as path component: ${platformId}`)
  }
  return join(SESSIONS_BASE, platformId)
}
```

### 4.3 `prepareSessionDir()`（lines 65-84，幂等）

```ts
export function prepareSessionDir(platformId: string): string {
  const dir = sessionDataDir(platformId)
  mkdirSync(dir, { recursive: true })
  ensureSharedLink(join(HOME, '.config', 'goose'), join(dir, 'config'))
  ensureSharedLink(join(HOME, '.agents'), join(dir, '.agents'))
  return dir
}

function ensureSharedLink(target: string, link: string): void {
  mkdirSync(target, { recursive: true })
  try { symlinkSync(target, link) }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e }
}
```

目录布局 `$HOME/.goose-sessions/<platform-uuid>/`：
- `config` → symlink 到 `~/.config/goose`（共享 config.yaml / AGENTS.md）
- `.agents` → symlink 到 `~/.agents`（共享 skills）
- `data/` —— goose 运行时自建，`sessions.db` 在此
- `state/` —— per-session goose 日志（goose 自建）
- `meta.json` —— 我们的，codec 写

注意：`prepareSessionDir` 不建 `data/`/`state/`/`meta.json`。goose 自己建前两者；
`meta.json` 由 codec 的 `encode()` 懒写。

### 4.4 meta.json 读写（lines 86-104，原子写）

```ts
function metaPath(platformId: string): string { return join(sessionDataDir(platformId), 'meta.json') }

export function readNativeId(platformId: string): string | null {
  try {
    const meta = JSON.parse(readFileSync(metaPath(platformId), 'utf-8'))
    return typeof meta?.native_id === 'string' ? meta.native_id : null
  } catch { return null }
}

function writeNativeId(platformId: string, nativeId: string): void {
  const path = metaPath(platformId)
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify({ native_id: nativeId }))
  renameSync(tmp, path)   // 原子
}
```

存的是 `{ "native_id": "YYYYMMDD_1" }`，以目录名（平台 id）隐式 key，**不是查找表**。

### 4.5 SessionIdCodec（lines 106-127，移植核心）

契约（`acp-bridge.ts:50-55`）：
```ts
export interface SessionIdCodec {
  encode(nativeId: string): string
  decode(platformId: string): string
}
```

```ts
export function sessionDirCodec(platformId: string): SessionIdCodec {
  return {
    encode(nativeId: string): string {
      writeNativeId(platformId, nativeId)   // createSession 返回时调一次
      return platformId                      // 采用预制的平台 id
    },
    decode(pid: string): string {
      return readNativeId(pid) ?? pid         // miss 则直通（跨 core id / 崩溃残留）
    },
  }
}
```

端到端：
- **encode**：goose `createSession` 返回 native id（私有 db 里恒 `<date>_1`），
  encode 把它写进该 session 的 `meta.json` 并返回平台 UUID。
- **decode**：每次 `loadSession`/`prompt`/`cancel` 调，读 `meta.json` 取回 native id。
- **跨 core fallback**：`readNativeId` 返 null（无 meta.json，从未建过 goose 数据目录的
  跨 core id，或 createSession 前崩溃）→ decode 原样返回平台 id → goose `session/load`
  用自己的 not-found 报错 → `/chat` handler 包装成可操作的跨 core 提示。**故意的 fall-through**。

核心不变量：**一桥服务一个 session**。故闭包内一个 bound `platformId` 是权威的，
goose 的 native id（每数据目录恒 `<date>_1`，跨 session 会撞）绝不在此桥外作索引。

### 4.6 sweepOrphanSessionDirs()（lines 129-153，boot GC）

prepareSessionDir 在 bridge spawn 前跑，createSession（触发 encode→writeNativeId）在后。
中间崩溃 → 暂存目录无 `meta.json` 成孤儿。boot 时扫：

```ts
export function sweepOrphanSessionDirs(maxAgeMs = 24 * 60 * 60 * 1000): void {
  let entries: string[]
  try { entries = readdirSync(SESSIONS_BASE) } catch { return }
  for (const name of entries) {
    const dir = join(SESSIONS_BASE, name)
    try {
      if (existsSync(join(dir, 'meta.json'))) continue       // 有 meta = 真 session
      if (Date.now() - statSync(dir).mtimeMs < maxAgeMs) continue  // 新建可能在建中
      rmSync(dir, { recursive: true, force: true })
    } catch { /* 留给下次 boot */ }
  }
}
```

默认 `maxAgeMs` = **24 小时**（live 目录几秒内就有 meta.json，24h 仍裸的就是死的）。
启发式："无 meta.json AND mtime 老"。错误 per-entry 非致命。

---

## 5. 真实 usage 提取（`agents/goose/src/server.ts`）

### 5.1 accumulatedUsage map（lines 25-35）

```ts
const accumulatedUsage = new Map<string, { input: number; output: number }>()
```
**key = 平台 session id**（非通知里的 native id）。因为每桥一 session，
`index.ts` 把平台 id 绑进 `onExtNotification` 闭包（`index.ts:117`），无需翻译。
注释：`PromptResponse.usage` 只反映 turn 最后一次 LLM 请求，工具循环 turn 少计 2×+，
**这些累积计数才是准确计费源**。

`num` helper（line 23）：`const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)`

### 5.2 trackExtNotification()（lines 37-49）

```ts
export function trackExtNotification(platformSessionId, method, params): void {
  if (method !== '_goose/unstable/session/update') return
  const update = params.update as Record<string, unknown> | undefined
  if (update?.sessionUpdate !== 'usage_update') return
  const input = num(update.accumulatedInputTokens)
  const output = num(update.accumulatedOutputTokens)
  if (input === 0 && output === 0) return
  accumulatedUsage.set(platformSessionId, { input, output })
}
```
method 过滤 `_goose/unstable/session/update`；`params.update` 内仅
`sessionUpdate === 'usage_update'` 时动作；读累积计数（session 级，非 per-turn）；
忽略零值；每次覆盖（map 恒持最新累积计数）。

**解锁此通知流需 client capability flag**（`index.ts:116`
`clientCapabilitiesMeta: { goose: { customNotifications: true } }`），无此 flag goose 不发。

### 5.3 recordUsage()（lines 51-96，两种 shape）

```ts
function recordUsage(sessionId: string, usage: unknown): void {
  const acc = accumulatedUsage.get(sessionId)
  const model = loadRuntimeConfig()?.model || undefined
  let payload = null
  if (acc) {
    payload = { ts, model, accumulated_input_tokens: acc.input, accumulated_output_tokens: acc.output }
  } else if (usage && typeof usage === 'object') {
    const u = usage as { inputTokens?, outputTokens?, totalTokens? }
    const input = num(u.inputTokens); const output = num(u.outputTokens)
    if (input === 0 && output === 0) return
    payload = { ts, model, input_tokens: input, output_tokens: output, total_tokens: num(u.totalTokens) || input + output }
  }
  if (!payload) return
  const dir = join(process.env.HOME ?? join(WORKSPACE_DIR, '.home'), '.acp-usage')
  mkdirSync(dir, { recursive: true })
  appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(payload)}\n`)
}
```

两种 shape（优先级）：
1. **累积计数**（accumulatedUsage 有条目）：sweeper 的 `parseAcpUsageLog` 把累积转 per-line
   delta（codex 风格），**文件 restart-safe**（读时算，非写时算）。
2. **fallback 直传 per-turn**（无 ext notification）：从 `PromptResponse.usage` 读，少计
   多请求 turn（"好过没有"）。

追加目标 `$HOME/.acp-usage/<sessionId>.jsonl`（PVC-durable）。文件名用**平台 UUID**（安全）。
为何 JSONL：goose session 在 SQLite，零依赖 sweeper 读不了，必须旁路写可解析文件。

### 5.4 recordUsage 接线（`server.ts:98-123`）

传给 `createAcpAgentApp({ recordUsage })`，server 工厂在 turn 结束调
`(sessionId, PromptResponse.usage)`。仅 goose 接 recordUsage（codex/claude 的 transcript
直接扫盘，传 `recordUsage: undefined`，共享 server 在 `acp-server.ts:537` 跳过）。

---

## 6. LLM provider env（`agents/goose/src/config.ts:495-554`）

```ts
export function applyProviderEnv(rc: RuntimeConfig): void {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_BASE_URL
  delete process.env.OPENAI_API_KEY
  delete process.env.OPENAI_HOST
  delete process.env.OPENAI_BASE_PATH
  delete process.env.GOOSE_FAST_MODEL

  process.env.GOOSE_PROVIDER = 'openai'
  process.env.GOOSE_MODEL = rc.model
  process.env.GOOSE_MODE = 'auto'
  process.env.GOOSE_DISABLE_KEYRING = '1'
  process.env.OPENAI_CUSTOM_HEADERS = 'User-Agent=agent-platform-goose/1.0'
  process.env.GOOSE_DISABLE_TOOL_CALL_SUMMARY = '1'
  process.env.GOOSE_DISABLE_SESSION_NAMING = '1'

  if (rc.api_key) process.env.OPENAI_API_KEY = rc.api_key
  if (rc.small_model) process.env.GOOSE_FAST_MODEL = rc.small_model
  if (rc.base_url) {
    try {
      const u = new URL(rc.base_url)
      process.env.OPENAI_HOST = u.origin
      const basePath = u.pathname.replace(/\/+$/, '')
      process.env.OPENAI_BASE_PATH = `${basePath.replace(/^\/+/, '')}/chat/completions`
    } catch { console.error(`[agent] Invalid base_url, ignoring: ${rc.base_url}`) }
  }
}
```

要点：
- **delete 而非置空**（biome-ignore 注释明确：env var 必须 delete，不能设 "undefined"，
  否则子进程继承字面量 "undefined"）。
- `GOOSE_PROVIDER='openai'` 强制 OpenAI-compatible provider。
- `GOOSE_MODE='auto'` 自动批准工具调用（无权限弹窗，平台经 ACP 管权限）。
- `GOOSE_DISABLE_TOOL_CALL_SUMMARY`/`GOOSE_DISABLE_SESSION_NAMING` 砍两个浪费 LLM 调用
  的 UI 甜点（per-tool-call AI 标题、per-session AI 名字）。
- `OPENAI_CUSTOM_HEADERS`：goose 默认不发 User-Agent（reqwest 没 `.user_agent()`），
  此格式逗号分隔 `Key=Value`，每 chat/completions 请求带，env 胜 config.yaml（平台强制）。
- **base_url 拆分**：`new URL()` → `OPENAI_HOST` = origin（scheme+host+port），
  `OPENAI_BASE_PATH` = 去尾斜杠的 pathname + `/chat/completions`。
  goose 的 OpenAI 客户端拼 `${OPENAI_HOST}/${OPENAI_BASE_PATH}` 成完整 chat-completions URL。
  例：`https://relay.example.com/v1` → host=`https://relay.example.com`，
  basePath=`v1/chat/completions`。

`RuntimeConfig`（`config.ts:403-409`）：`{ model, provider_type, base_url?, api_key?, small_model? }`。

---

## 7. 入口与 sidecars（`agents/goose/src/index.ts`）

boot 序列：
1. `writePlatformPrompt({ agentKind:'goose', homeSubdir:'.config/goose', filename:'AGENTS.md' })`
2. uncaughtException/unhandledRejection handler 保活
3. `loadConfig()`（CP）写 AGENTS.md / config.yaml / mcp.json / runtime.json
4. `loadSkills()`（CP）—— **失败致命**，exit 1 让 kubelet 重启
5. `loadCredentials()`（CP）
6. `applyProviderEnv(rc)`
7. 注册 bridge factory（lines 108-121）→ `sweepOrphanSessionDirs()`
8. setRestartBridge：config/credential reload 时重应用 provider env
9. HTTP server on `PORT || 3001`
10. sidecars

sidecars（smallkhoj 移植可参考，非必须）：
- **ttyd**（web terminal）port 7681，tmux new-session
- **dufs workspace**（file browser）port 8000
- **dufs afs**（AgentFS mount）port 8001

---

## 8. 移植映射表（NAP → smallkhoj）

| NAP 文件 | smallkhoj 目标 | 备注 |
|---|---|---|
| `agents/goose/src/session-store.ts` | `agent/daemon/aaa-daemon/src/runtime/goose-session-store.ts` | 几乎逐行移植，HOME 常量贴合 smallkhoj |
| `agents/goose/src/config.ts` `applyProviderEnv` | `agent/daemon/aaa-daemon/src/runtime/goose-provider-env.ts` | 签名改用环境变量/daemon config 而非 CP RuntimeConfig |
| `agents/goose/src/server.ts` trackExtNotification/recordUsage | `goose-runtime.ts` 内 | daemon 无 createAcpAgentApp，直接在 driver 里 |
| `agents/goose/src/index.ts` bridge factory | `goose-runtime.ts` 的 `createBridge()` | prepareSessionDir + spawn goose + 绑 codec/通知 |
| `internal/acp-adapter/acp-bridge.ts` SessionIdCodec | 扩展 `codex-acp-bridge.ts` CodexAcpBridgeOptions | 加 3 可选 option |
| `internal/acp-adapter/universal-events.ts` gooseToolName | smallkhoj 不需要（无 Universal Event 渲染层） | 跳过 |
| `internal/ui-sdk/src/tool-renderers/goose/` | smallkhoj 不做 UI 渲染器 | 跳过 |
