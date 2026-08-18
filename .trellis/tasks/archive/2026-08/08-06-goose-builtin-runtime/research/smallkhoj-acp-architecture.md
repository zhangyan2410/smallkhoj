# smallkhoj 现有 ACP / runtime 架构（移植落点）

> 本文档记录 smallkhoj daemon 现有的 ACP 桥、runtime 抽象、工厂、检测体系，
> 作为 `GooseRuntimeDriver` 的移植落点与接线清单。所有路径基于
> `/Users/code/project/smallkhoj/agent/daemon/aaa-daemon/`。

---

## 1. 架构概览

smallkhoj 是**多进程系统**：
- **Python FastAPI backend**（`backend/`）—— 持久化 + 公共 API（Postgres + Alembic）。
  对 pi 有 LLM 中继 + 容量租约（`pi_llm_relay.py` / `llm_run_leases.py`），**goose 不用这套**。
- **TypeScript/Node daemon**（`agent/daemon/aaa-daemon/`，包名
  `@smallkhoj/smallkhoj-daemon`）—— **agent runtime 管理器**，spawn 并监督 coding agent
  core（pi / claude_code / codex-acp / opencode）。**pi 和 ACP 都在这里。**
- **Next.js 前端**（`frontend/`）。

**goose 集成全在 daemon，backend 无关**（除可选的 usage 上报）。

---

## 2. ManagedRuntimeDriver 接口（`src/runtime/runtime-driver.ts`）

纯类型文件，无基类。driver 自行 `extends EventEmitter`。

```ts
export interface RuntimeLineEvent { stream: 'stdout' | 'stderr'; line: string }
export type RuntimeExitEvent = { code: number | null; signal: NodeJS.Signals | null;
  intentional: boolean; sessionId?: string }
export type RuntimeStreamEvent = Record<string, unknown> & {
  type?: string; subtype?: string; session_id?: string; sessionId?: string;
}
export interface RuntimeSendOptions {
  sessionId?: string | null;      // undefined=保持默认; null=强制新开
  sessionScopeKey?: string;
  control?: boolean;              // 绕过 Slock prompt wrapper
}
export interface ManagedRuntimeDriver {
  start(): void; stop(): void; killUnresponsive(): void;
  sendUserMessage(text: string, options?: RuntimeSendOptions): boolean;
  discardQueuedChannel(channelId: string): number;
  readonly pid: number | undefined;
  readonly sessionId: string | undefined;
  readonly queuedMessageCount: number;
  readonly busy: boolean;
  on(event: 'line'|'stream_event'|'session'|'message_sent'|'exit'|'error', listener): this;
  // + 通用 on(string, ...) / off(string, ...)
}
```

**无共享基类**——`GooseRuntimeDriver` 必须自实现全部（或 copy `CodexAcpRuntimeDriver`
改名）。codex-acp 就是 `class CodexAcpRuntimeDriver extends EventEmitter implements ManagedRuntimeDriver`。

---

## 3. 通用 ACP 桥（`src/runtime/codex-acp-bridge.ts`）—— 要扩展的目标

**此桥几乎完全是通用 ACP，非 codex 专属。** 唯一 codex 味的是默认命令解析 helper
（`resolveNpxCommand`/`buildCodexAcpCommand`）和 runtime 文件里的
`@zed-industries/codex-acp` 包默认。类本身是 vanilla ACP-over-stdio 桥。

### `CodexAcpBridgeOptions`（lines 27-35）—— **R1 扩展点**

```ts
export interface CodexAcpBridgeOptions {
  command?: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  mcpServers?: McpServer[];
  onUpdate?: (update: SessionUpdate, notification: SessionNotification) => void;
  onLine?: (event: { stream: 'stdout' | 'stderr'; line: string }) => void;
}
```
**R1 在此加 3 可选字段：`sessionIdCodec` / `clientCapabilitiesMeta` / `onExtNotification`。**

### `translateAcpUpdate()`（lines 77-116）—— 完全通用，不动

```ts
case 'agent_message_chunk':   -> message_delta  (text from content.text if type==='text')
case 'agent_thought_chunk':   -> thought_delta
case 'tool_call':             -> tool_call      (toolName = title ?? kind; status)
case 'tool_call_update':      -> tool_result if status in {completed,failed} else tool_call
case 'usage_update':          -> usage
case 'plan'/'available_commands_update'/'current_mode_update': -> unknown
default:                      -> unknown
```
**不引用 codex，goose 直接复用。** `plan` 等故意吞为 `unknown`。

### `CodexAcpBridge` 类（lines 118-256）

- 构造：存 options。字段 `options` / `child` / `connection` / `sessionIds:Set`。
- `pid`（129）/ `alive`（133）。
- **`start()`（137-175）**：spawn via `runtimeCommandSpawnSpec(command, args)`；
  options.args 非空则**用传入 args，永不回退 codex-acp**（**这是 goose 的 override 钩子**：
  传 `args:['goose','acp']` 就赢）；env 显式则 caller-owned 不与 process.env 合；
  stderr→emitProcessLines；child exit→emit `{code,signal}`；
  建 ACP streams（Writable.toWeb/Readable.toWeb）；
  构造 Client 回调（`sessionUpdate`→onUpdate+emit 'update'；`requestPermission`→
  `approveFirstPermissionOption`）；
  `new ClientSideConnection(() => client, ndJsonStream(input, output))`；
  `connection.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })`。
  **R1：clientCapabilities 加 `_meta: clientCapabilitiesMeta`；Client 回调加 ext
  notification 分发到 onExtNotification。**
- `createSession`（177-185）：`connection.newSession({cwd, mcpServers})`，add sessionIds，
  返回 `result.sessionId`。**R1：返回值经 `sessionIdCodec?.encode()`**。
- `loadSession`（187-196）：`connection.loadSession({sessionId, cwd, mcpServers})`。
  **R1：入参 sessionId 经 `sessionIdCodec?.decode()`**。
- `prompt`（198-202）：wrap text 为 `ContentBlock[]=[{type:'text',text}]`，
  `connection.prompt({sessionId, prompt})`，返 `PromptResponse`。
  **R1：入参 sessionId 经 decode**。
- `cancel`（204-207）。**R1：入参经 decode**。
- `stop(timeoutMs=2000)`（213-237）：drop connection → `signalRuntimeProcessTree(child,'SIGTERM')`
  → race exit vs timeout → 超时 SIGKILL。`destroy()`=`stop(0)`。
- **权限（244-247）**：`approveFirstPermissionOption` 永远选第一个 option（默认
  `'allow-once'`）。**通用 ACP 行为，goose 继承。**

---

## 4. codex-acp runtime driver（`src/runtime/codex-acp-runtime.ts`）—— 移植模板

`CodexAcpRuntimeDriver extends EventEmitter implements ManagedRuntimeDriver`（lines 77-396）。

### 关键常量与类型（lines 11-28）

```ts
const DEFAULT_CODEX_ACP_PACKAGE = '@zed-industries/codex-acp@0.16.0';
export interface CodexAcpRuntimeOptions {
  credential: Credential; workspacePath: string; wrapperDir: string;
  slockHome?: string; launchId?: string;
  command?: string; commandArgs?: string[];   // ← 可构造覆盖
  baseEnv?: NodeJS.ProcessEnv; resumeSessionId?: string;
}
```
**`command`/`commandArgs` 可构造覆盖**，缺省回退 `npx -y @zed-industries/codex-acp@0.16.0`。

### `resolveCodexAcpLaunchCommand()`（lines 30-40）—— goose 镜像此逻辑

```ts
const command = options.command?.trim() || resolveNpxCommand(options.baseEnv);
const commandArgs = options.commandArgs?.filter(arg => arg.trim().length > 0);
if (commandArgs && commandArgs.length > 0) return { command, args: commandArgs };  // 显式覆盖赢
if (isNpxCommand(command)) return { command, args: ['-y', DEFAULT_CODEX_ACP_PACKAGE] };
return { command, args: [] };
```

### 字段（78-88）

`options` / `bridge:CodexAcpBridge|null` / `pendingUserMessages:PendingUserMessage[]` /
`currentSessionId?` / `started` / `stopping` / `bootstrapping:Promise|null` /
`activePrompt:Promise|null` / `systemPrompt` / `lastUsageUpdate` / `exitEmitted`。

### 方法（移植时几乎逐行照搬）

- `start()`（96-113）：幂等；写 prompt 文件；建 systemPrompt；emit 'line'；`void flushQueuedMessages()`。
  **不立即 spawn bridge**——桥在首次 prompt 懒建。
- `stop()`（115-126）/ `killUnresponsive()`（128-139）：flag + bridge.stop() + emitExitOnce。
- getters：`pid`=bridge?.pid / `sessionId`=currentSessionId / `queuedMessageCount` / `busy`=Boolean(bootstrapping||activePrompt)。
- `sendUserMessage()`（168-178）：busy/无 session 则 queue 返 false；否则 runPrompt 返 true。
- `flushQueuedMessages()`（180-185）：不忙则 shift 下一条 → runPrompt。
- **`ensureSession(options?)`（187-230）**：桥/session bootstrap。读 requestedSessionId
  （null=强制新，undefined=复用默认，string=load 指定）；现有/alive 则复用；bootstrapping
  in flight 则 await；否则 IIFE：挑桥（alive 复用否则 createBridge）→ start → 分支
  （null→createSession / truthy→loadSession / currentSessionId→loadSession / else→createSession）；
  sessionId 变则 emit 'session'；finally 清 bootstrapping。
- **`createBridge()`（232-259）**：`resolveCodexAcpLaunchCommand` → `new CodexAcpBridge({command,args,cwd,env:buildCodexRuntimeEnv(...),onUpdate:(u,n)=>this.consumeUpdate(u,n),onLine})`。
  **goose 的 createBridge 在此传 goose 专属参数（codec/meta/extNotification/GOOSE_PATH_ROOT）。**
- `runPrompt()`（261-294）：包进 activePrompt；ensureSession；构造 prompt（control 用 raw，
  否则 buildCodexPrompt）；emit 'message_sent'；`await bridge.prompt(sessionId,prompt)`；
  emit 'stream_event' buildResultEvent；err 则 emit error/result；finally 清 activePrompt + flush。
- **`consumeUpdate(update,notification)`（296-375）**：调 translateAcpUpdate → 映射 RuntimeStreamEvent：
  - message_delta/thought_delta → `{type:'assistant',runtime:'codex_acp',session_id,sessionId,message:{content:[{type:'text'|'thinking',...}]},acpUpdate}`
  - tool_call → `{type:'assistant',message:{content:[{type:'tool_use',id,name,input:{status,...}}]}}`
  - tool_result → `{type:'user',message:{content:[{type:'tool_result',tool_use_id,content,is_error}]}}`
  - usage → 存 lastUsageUpdate，emit `{type:'usage',used,contextWindow,raw}`
  - unknown 静默丢
  **goose 照搬，仅 `runtime:'codex_acp'`→`'goose'`。**
- `buildResultEvent()`（377-389）：subtype=cancelled/success；usage=normalizePromptUsage。
- `normalizePromptUsage()`（398-419）：兼容多种字段名（inputTokens/input_tokens 等），返
  snake_case + camelCase 双形态。**goose 照搬**。
- helpers：`stringField`/`numberField`/`codexToolCommandPreview`/`isRecord`（421-447）。

### slock prompt（lines 46-75）

`buildCodexAcpSlockPrompt` = `buildSlockSystemPrompt`（来自 `claude-runtime.js`）+ Codex ACP
专段。**goose 第一版继承 buildSlockSystemPrompt，可加 goose 专段。**

---

## 5. pi runtime（`src/runtime/pi-runtime.ts`）—— bundled 参考

- `BUNDLED_PI_VERSION='0.73.1'`（line 22）；`SMALLKHOJ_PI_PROVIDER='smallkhoj-minimax'`（23）。
- `resolveBundledPiLayout()`（80-100）：读 `SMALLKHOJ_DAEMON_INSTALL_ROOT`；nodePath 默认
  `<installRoot>/runtime/node/bin/node`；piEntry 默认
  `<installRoot>/node_modules/@mariozechner/pi-coding-agent/dist/cli.js`；不存在返 undefined。
  **goose bundled 第二阶段仿此写 resolveBundledGooseLayout()（但 goose 是 Rust 二进制路径，
  非 node_modules）。**
- `resolvePiLaunch()`（102-114）：`node <piEntry> -p --mode json --session <path> [--extension] [--append-system-prompt] [--provider] [--model]`。
- pi 是**一进程一 turn**（spawn → stdin.end(prompt) → 读 ndjson → exit），非 ACP resident。
  **goose 是 ACP resident（像 codex-acp），不像 pi。**
- `buildPiRuntimeEnv`（116-145）：设 PI_CODING_AGENT_DIR / SMALLKHOJ_LLM_PROXY_URL/TOKEN /
  Slock env；**delete 一堆防绕过 proxy**。**goose 不走 proxy，不抄这段。**
- capacity leasing（manageCapacity）：pi 专属，goose 无。
- `--mode json` 让 pi 吐 ndjson；session 持久化靠 `--session <path>` 复用同一 session.jsonl。

---

## 6. runtime-provider（`src/runtime/runtime-provider.ts`）—— 检测/inventory

### `detectedRuntimesForInventory(config, inventory, bundledPi)`（62-108）

`base` 数组硬编 4 条（lines 72-93）：
- `claude_code`：available iff inventory.claudeCommand
- `codex`：available iff inventory.codexCommand
- `opencode`：available iff inventory.opencodeCommand
- **`pi`（87-92）：恒 `status:'available', source:'bundled'`**，version 从 bundledPi。
  注释："Pi 是产品内置 runtime，检测层面恒可用"。

**R7 在此加 goose 条目**：PATH 检测到 goose 命令→`source:'bundled'`+version，否则
`status:'not_installed'`。第一阶段仿 codex（CLI 检测）但标 bundled 语义。

### `resolveRuntimeProviderLaunch()`（110-177）/ `resolveDetectedRuntimeCommand()`（179-186）

按需加 goose 分支（若走 manual/codex-like）；bundled 路径可不加。

---

## 7. daemon 工厂与生命周期（`src/daemon/daemon.ts`）

### `DaemonRuntimeImplementation`（line 239）

```ts
type DaemonRuntimeImplementation = 'pi' | 'claude_code' | 'codex' | 'opencode';
```
**R7 加 `| 'goose'`。**

### runtime 规范化（2812-2818）

```ts
function normalizeDaemonRuntimeType(runtime) {
  if (!runtime || runtime==='claude' || runtime==='claude_code') return 'claude_code';
  if (runtime==='codex' || runtime==='codex_acp') return 'codex';
  if (runtime==='opencode') return 'opencode';
  if (runtime==='pi') return 'pi';
  return undefined;
}
```
**R7 加 `if (runtime==='goose') return 'goose';`。**

### 工厂 if/else（1095-1148）—— **R6/R7 接线核心**

```ts
const driver = runtimeType === 'pi'
  ? new PiRuntimeDriver({...})
  : runtimeType === 'codex'
  ? new CodexAcpRuntimeDriver({...})
  : runtimeType === 'opencode'
  ? new OpenCodeServerRuntimeDriver({...})
  : new ClaudeRuntimeDriver({...});   // 默认 fallback
```
**R7 在 fallback 前插 `: runtimeType === 'goose' ? new GooseRuntimeDriver({...})`。**

### 其他类型分支（全量清单，R7 按需加 goose）

- **line 733**：自启动条件 `(config.runtime === 'claude_code'||...||'pi') && credential.agentId`。
  **加 `|| 'goose'`。**
- **1075-1079**：pi bundled-layout 检查。goose 第一阶段无 bundled 二进制，可不加检查
  （PATH 检测在 inventory 层）。
- **1229**：`runtime.runtime === 'codex' && eventType === 'result'` codex warmup 完成。
- **1284**：claude_code session-jsonl usage grounding。
- **1502**：codex/opencode 默认 command 字符串。
- **1506-1507**：`runtime.runtime === 'codex' || 'opencode'` session 建立即 ready。
  **加 `|| 'goose'`（goose 像 codex 是 ACP resident，session 建立即 markRuntimeReady）。**
- **1556**：`runtime.runtime === 'codex' ? 'Codex' : runtime.runtime` 显示名。
- **1656-1677**：pi lazy-ready vs warmup-probe 分支。**goose 走 codex 式（session ready），
  不走 pi lazy。**
- **2191-2219**：restart-on-crash（claude-only）。goose 第一版不加重启。
- **2727-2738**：runtimeControlSlashCommand（claude/codex 的 /context 等）。
  **goose 第一版返 null（同 pi/opencode）。**

### usage 捕获（1262-1331）

`'stream_event'` handler：`eventType==='result'` 读 event.usage（claude_code 还读
session jsonl grounding）；`eventType==='usage'` 填 lastTurnContextUsage。
**goose 的 usage 主要走自己的 recordUsage（写 .acp-usage jsonl），这条 handler 照常
收 stream 里的 usage 事件作 in-flight 上下文窗口指示。**

---

## 8. 所有 RuntimeType 分支点（R7 接线清单）

### 类型声明
- `src/types.ts:55` — `RuntimeType` union。**加 `|'goose'`。**
- `src/daemon/daemon.ts:239` — `DaemonRuntimeImplementation`。**加 `|'goose'`。**
- `src/runtime/runtime-activity.ts:1` — `RuntimeActivityRuntime`。**加 `'goose'`** +
  protocol 映射（:91-102 `case 'goose': return 'goose-stream'`）。
- `src/runtime/providers/provider-types.ts:1` — `LocalRuntimeProviderRuntime`。
  **第一版不加**（goose 不进 cc-switch/manual provider）。

### 规范化
- `src/daemon/daemon.ts:2812` — `normalizeDaemonRuntimeType`。**加 goose。**
- `src/cmd/main.ts:37-43` — `parseRuntimeOption`（CLI `--runtime goose`）。**加 goose。**

### 检测
- `src/runtime/runtime-provider.ts:62-108` — `detectedRuntimesForInventory`。**加 goose 条目。**
- `src/runtime/runtime-provider.ts:179-186` — `resolveDetectedRuntimeCommand`。按需。
- `src/runtime/providers/local-command-provider.ts` — 加 `detectGooseCommand`（PATH 检测）。

### 工厂/生命周期
- `src/daemon/daemon.ts:733` — 自启动。**加 `||'goose'`。**
- `src/daemon/daemon.ts:1095-1148` — 工厂。**加 goose 分支。**
- `src/daemon/daemon.ts:1506` — session ready。**加 `||'goose'`。**
- `src/daemon/daemon.ts:1656-1677` — readiness 分支。**goose 走 codex 式（不走 pi lazy）。**

---

## 9. 无 capability 矩阵

grep `supportsMcp`/`capabilities:`/`features:` 在 src/ **零命中**。daemon 向客户端广告
runtime 仅两方式：
1. **detected-runtime inventory**（`detectedRuntimesForInventory`）—— `{type,status,source?,version?}`。
2. **Slock wrapper capabilities** —— 固定串 `'send,read,mentions,tasks,reactions,server,channels'`，
   所有 runtime 一样（daemon 级 config，非 runtime-type-specific）。

**goose 无需声明 capability，加 inventory 条目即可。**

---

## 10. package.json 依赖现状

```json
"dependencies": {
  "@agentclientprotocol/sdk": "^0.28.1",     // ← 比 NAP 的 0.14.1 新
  "@mariozechner/pi-coding-agent": "0.73.1",  // pi bundled（纯 JS npm 包）
  "@modelcontextprotocol/sdk": "^1.29.0",
  "commander": "^12.4.0", "ws": "^8.16.0", "zod": "^4.4.3"
}
```

**goose 是 Rust 二进制，不能当 npm 依赖。** 第一阶段靠 PATH（`brew install goose`）；
第二阶段打包脚本下载二进制（仿 NAP Dockerfile）。
