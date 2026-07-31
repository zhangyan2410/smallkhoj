# Runtime Select Guide — Technical Design

## 1. 边界与不动的东西

本任务动三处：**daemon（让 Pi 成为真实 runtime 类型并上报，含 relay 调用）**、**backend（Pi LLM relay + 容量租约，lease 走新 alembic 迁移）**、**前端（Runtime 下拉用真实检测数据 + 引导 + capacity 状态）**。

built-in Pi 复用项目既有 MiniMax 供应：key 只在 backend，Pi 的模型请求经 daemon→backend relay 中转，backend 注入 MiniMax 凭证。用户**无需**自备 key。

明确不引入：guide/systemRole、guest role、空 server 状态机、embedded Node 打包、重新审批 MiniMax 订阅。

## 2. 数据流（目标态）

```
daemon 启动
  -> detectRuntimes() 聚合本机 runtime
  -> detectedRuntimesForInventory() 产出 detected runtime 数组
       - 默认 runtime (config.runtime ?? 'claude_code')
       - bundled Pi: { type:'pi', status:'available', source:'bundled', version }  [新增]
       - inventory.providers 里本机装的 claude/codex/opencode/...
  -> register/heartbeat 上报给 backend -> computer.detectedRuntimes

前端创建 agent 表单
  -> 读取 computer.detectedRuntimes
  -> runtimeOptionsFromDetected() 把 detected 聚合成 Runtime 下拉选项  [新增/复用]
       - 检测到的 runtime -> 可选
       - 没检测到的预期 runtime -> 灰掉
       - bundled Pi (source:'bundled') -> 始终可选 + 「自带」标识
  -> 用户选 runtime + 填 name（无需配 key）
  -> POST /api/v1/members/agents (已有端点，admin-only)
  -> backend 建 agent + AgentWorkspace (runtime='pi' 落自由 string 列)
  -> daemon 启动 Pi runtime

Pi 首个真实回合（lazy，不预热占模型回合）
  -> PiRuntimeDriver acquire 一个 scoped run lease (后端 LlmRunLease)
       - 容量满 -> waiting，UI 显示排队
       - 容量空 -> active
  -> Pi 进程通过 daemon provider extension 指向本地 AgentProxy
  -> AgentProxy 带 sap_* token 转发到 backend relay
  -> backend 校验 agent/server/computer/run lease + model 白名单
  -> backend 注入 MiniMax 凭证，转发到 LLM_API_BASE / PI_LLM_API_BASE
  -> 回合结束（完整工具循环结束）-> release lease -> FIFO 递进下个 waiter
```

## 3. Layer A — daemon 改动

### 3.1 `agent/daemon/aaa-daemon/src/types.ts`
- `RuntimeType` union 加 `'pi'`（当前 line 54 没有）。
- `DetectedRuntime.type` 自动跟随（它用同一个 union）。

### 3.2 `agent/daemon/aaa-daemon/src/runtime/runtime-provider.ts`
- `detectedRuntimesForInventory()`（line 62-85）增加 bundled Pi 上报：调用 `resolveBundledPiLayout()`，找到随包 Pi 就 push `{ type:'pi', status:'available', source:'bundled', version }`。
- `resolveDetectedRuntimeCommand()` 的 union 加 `'pi'`（line 168）。
- **直接摘用 07-22**：`feat/bundled-pi-trial-runtime` 的同名文件改动。

### 3.3 新增 `agent/daemon/aaa-daemon/src/runtime/pi-runtime.ts`
- **摘用 07-22 同名文件（406 行，含 relay/lease，不剥离）**：
  - 保留：`BUNDLED_PI_VERSION`、`BundledPiLayout`、`resolveBundledPiLayout()`、`resolvePiLaunch()`、`PiRuntimeDriver implements ManagedRuntimeDriver`、`writeProviderExtension`（指向本地 AgentProxy 的 relay extension）、session/config 路径、JSON 解析、child 生命周期、lease acquire/heartbeat/release、`capacity_waiting`/`capacity_running` 事件。
  - **剥离**：`SERVER_GUIDE_ROLE_PROMPT` + `runtimeRole==='server_guide'` 分支（guide 那套不做）。`buildPiSystemPrompt` 退回只用 base prompt。
  - env 注入保留 `SMALLKHOJ_LLM_PROXY_*`、`SMALLKHOJ_LLM_RUN_ID`（relay 用）；保留清空 `LLM_API_KEY`/`PI_LLM_API_KEY`（防用户本地 key 污染 relay 路径）。

### 3.4 daemon 主流程接入（`src/daemon/daemon.ts`，摘用 07-22 改法）
- import `PiRuntimeDriver` + `resolveBundledPiLayout`（line ~28）。
- `normalizeDaemonRuntimeType`：加 `'pi'` 分支。
- auto-start guard（line ~540）：加 `'pi'` 到允许自动启动集合。
- driver 构造 ternary（line ~858-937）：加 pi 分支 `new PiRuntimeDriver({...})`，options 含 `proxyUrl/proxyToken/manageCapacity:true/model`，**不含** `runtimeRole`。
- `requiresDetectedRuntimeCommand`（line ~2268）：pi 不要求 detected command。
- Pi lazy readiness（line ~1420）：driver 初始化后直接 markReady，不预热占模型回合。

### 3.5 `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts`
- **摘用 07-22**：scoped LLM relay 路径（把 Pi 的 `/v1/llm/...` 请求带 `sap_*` token 转发到 backend relay）。main 基线的 proxy 只有 Slock API 转发，没有 LLM relay，是 net-new。

### 3.6 daemon package.json + lockfile
- 加 `@mariozechner/pi-coding-agent@0.73.1`。摘用 07-22 的 package.json 改动。

## 4. Layer B — backend 改动

### 4.1 lease 表（alembic 新迁移 0005）
- `backend/models/slock.py`：加 `LlmRunLease` 类（`__tablename__='llm_run_leases'`），字段按 07-22（run_id/server_id/computer_id/agent_id/status/created_at/acquired_at/heartbeat_at/expires_at/released_at/failure_code）+ 索引 + status CHECK。摘用 07-22 slock.py:211。
- 新增 alembic migration `0005_llm_run_lease.py`：`down_revision='0004_template_tenancy'`，手写 `create_table` + 索引 + CHECK + 完整 downgrade（参考 main 的 `0004` 写法）。
- `backend/scripts/legacy_schema_preflight.py`：在 post-baseline 排除集合登记 `llm_run_leases`（防旧库指纹误判漂移，migration-workflow.md 强制要求）。
- **不塞回 seed.py**（main 的 seed.py 顶部 docstring 禁止任何 DDL）。

### 4.2 lease 服务 + relay 服务（摘用 07-22）
- `backend/services/llm_run_leases.py`：摘用 07-22（事务序列化的 acquire/heartbeat/release + FIFO 递进 + 过期回收）。
- `backend/services/pi_llm_relay.py`：摘用 07-22（校验 lease + model 白名单 + 注入 MiniMax 凭证 + 流式透传 + 凭证不出现在日志/错误）。
- `backend/services/runtime_state_lock.py`：摘用 07-22（Server 级事务 advisory lock，防对向锁序死锁）。
- `backend/routers/agent_api.py`：摘用 07-22 的 lease acquire/heartbeat/release 端点 + LLM relay 路由。
- `backend/config.py`：摘用 07-22 的 `PI_LLM_*` / `PI_LLM_MAX_ACTIVE_RUNS` / heartbeat / expiry 设置（`LLM_*` fallback）。

### 4.3 schema_readiness
- 0005 入仓后 `assert_schema_at_head` 自动要求部署 DB `alembic upgrade head`，部署 compose 已是 upgrade→uvicorn 顺序，无需改启动脚本。

## 5. Layer C — 前端改动（核心引导）

### 5.1 `frontend/lib/runtime-options.ts`（补 Pi case）
- `publicRuntimeValue()`：加 `case 'pi': return 'pi'`。
- `expectedProviderNamesForRuntime()`：pi 分支返回 `[]`。
- 新增 `runtimeOptionsFromDetected(computers, filters)`：聚合 detected 成 `{value,label,bundled?,available}` Runtime 选项数组。
  - detected runtime -> `{ available: true }`
  - 已知但未 detected（claude_code/codex）-> `{ available: false }` 灰掉
  - `source==='bundled'` 的 Pi -> `{ bundled: true, available: true }`

### 5.2 `frontend/components/create-agent-form.tsx`（核心 bug 修复 + 引导）
- **删掉写死的** `items={["claude_code|Claude Code", "codex|Codex", "custom|Custom"]}`（line 141）。
- Runtime 下拉用 `runtimeOptionsFromDetected(computers, {computerId, runtime})`。
- 不可用（`available:false`）灰掉 + 「(本机未检测到)」文案。
- bundled Pi 标「自带」badge。
- 引导文案：表单顶部说明「以下是这台电脑能用的 runtime，选一个就能建 agent；自带的 Pi 无需配 key」。
- runtime 默认值：优先 detected 第一个可用；仅 bundled Pi 时默认 Pi。

### 5.3 capacity 状态呈现（摘用 07-22 的前端思路，简化）
- `capacity_waiting`：在 agent 对话界面显示「安装已完成 / 排队中 / 位置 N」（Pi 安装完整，只是容量满）。
- 区分于安装/设置失败。

### 5.4 文案（`frontend/messages/zh-CN.json` + `en.json`）
- `createAgent.runtimeGuide.*`：runtime 选择 + bundled Pi 自带 + 无需配 key。

### 5.5 测试
- `frontend/test/runtime-options.test.ts`：无 codex→不可选；bundled Pi→可选+标识；动态一致。
- create-agent-form 测试：默认值、不可选、bundled 标识。

## 6. 07-22 资产摘用清单

| 07-22 文件（stash@{0}） | 本任务处理 |
|---|---|
| `agent/daemon/aaa-daemon/src/runtime/pi-runtime.ts` | 摘用，仅剥离 `SERVER_GUIDE_ROLE_PROMPT`/runtimeRole |
| `agent/daemon/aaa-daemon/src/runtime/runtime-provider.ts` | 摘用 bundled Pi 上报 |
| `agent/daemon/aaa-daemon/src/types.ts` | 摘用 `'pi'` union |
| `agent/daemon/aaa-daemon/src/daemon/daemon.ts` | 摘用 pi 接入点（不含 runtimeRole） |
| `agent/daemon/aaa-daemon/src/proxy/agent-proxy.ts` | 摘用 scoped LLM relay |
| `agent/daemon/aaa-daemon/package.json` + lockfile | 摘用 pi-coding-agent 依赖 |
| `agent/daemon/aaa-daemon/test/pi-runtime.test.mjs` | 摘用对应测试 |
| `backend/models/slock.py` (LlmRunLease) | 摘用模型，改走 alembic 迁移 |
| `backend/services/llm_run_leases.py` | 摘用 |
| `backend/services/pi_llm_relay.py` | 摘用 |
| `backend/services/runtime_state_lock.py` | 摘用 |
| `backend/routers/agent_api.py` (lease/relay 端点) | 摘用 |
| `backend/config.py` (`PI_LLM_*`) | 摘用 |
| **不摘用** | `onboarding.py`、`guide_provisioning.py`、`first-run-onboarding.tsx`、distribution embedded Node、07-22 的 seed.py lease 建表（改 alembic） |

摘用方式：`git show 'stash@{0}:<tracked path>'` 或 `git show 'stash@{0}^3:<untracked path>'`。

## 7. 兼容性

- 现有 claude_code/codex/custom：runtime union 加 `'pi'` 不影响它们；前端动态生成时它们仍按 detected 出现。
- Provider 下拉：不动其现有逻辑，只复用同源 `detectedRuntimes`。
- backend：runtime 是自由 string，`'pi'` 无需 schema 变更；唯一 schema 变更是 lease 表（alembic 0005）。
- agent 创建端点（admin-only）：不变，Pi 走同一端点。
- 非 Pi runtime 不强制走 relay，保留既有行为。

## 8. 验证策略

- 单测：runtime-options 聚合、daemon pi-runtime 命令构造/lease 生命周期、lease 并发/过期/FIFO、relay auth/model 白名单、bundled 检测。
- 契约：detectedRuntimesForInventory 有/无 bundled Pi 时的上报形态；alembic 0005 fresh upgrade + downgrade 可逆；legacy preflight 不误判。
- 真测（`./twd`，marker `REAL_runtime_select_guide_<timestamp>`）：本机无 codex 场景 codex 不可选；bundled Pi 可选且标识；选 Pi（无需配 key）创建成功并启动；并发两回合一 running 一 waiting，释放后递进。
- 回归：frontend lint/tsc/build + daemon test/typecheck + backend test 全绿。
- 安全：长期 MiniMax 凭证不出现在浏览器/产物/daemon 配置/进程参数/日志。
