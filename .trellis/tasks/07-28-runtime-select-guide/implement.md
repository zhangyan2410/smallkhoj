# Runtime Select Guide — Implementation Plan

## Delivery rule

Red-Green-Refactor。先写失败的测试，再实现。每层独立绿了再整合。

## Phase A — Baseline + 契约

1. `trellis-before-dev` 读 frontend / daemon / backend spec。
2. 基线门禁（已确认 daemon 265 pass；补跑 frontend + backend 基线）。
3. 契约测试（先红）：
   - `frontend/test/runtime-options.test.ts`：`runtimeOptionsFromDetected` 在无 codex / 有 bundled Pi 时的形态。
   - `agent/daemon/aaa-daemon/test/pi-runtime.test.mjs`：`resolveBundledPiLayout` + 命令构造 + lease 生命周期（摘 07-22）。
   - `backend/tests/test_llm_run_leases.py` + `test_pi_llm_relay.py`：并发 acquire/过期/FIFO + relay auth/model 白名单（摘 07-22）。

Checkpoint：契约测试因「Pi/lease 不存在」失败，符合预期。

## Phase B — daemon 层：让 Pi 成为真实 runtime（含 relay 调用）

### B1 类型 + 检测
- `src/types.ts`：`RuntimeType` 加 `'pi'`。
- `src/runtime/runtime-provider.ts`：`detectedRuntimesForInventory` 加 bundled Pi 上报；`resolveDetectedRuntimeCommand` union 加 `'pi'`。
- 新增 `src/runtime/pi-runtime.ts`：从 `git show 'stash@{0}^3:agent/daemon/aaa-daemon/src/runtime/pi-runtime.ts'` 摘出，**剥离** `SERVER_GUIDE_ROLE_PROMPT`/runtimeRole 分支，保留 relay/lease/provider extension/session/child 生命周期。

### B2 主流程接入（`src/daemon/daemon.ts`）
- import、`normalizeDaemonRuntimeType`、auto-start guard、driver ternary（pi 分支，options 含 `manageCapacity:true`/proxy，**不含** runtimeRole）、`requiresDetectedRuntimeCommand`、Pi lazy readiness。

### B3 proxy relay（`src/proxy/agent-proxy.ts`）
- 摘用 07-22 的 scoped LLM relay 路径。

### B4 依赖
- `package.json` + lockfile：加 `@mariozechner/pi-coding-agent@0.73.1`。

Checkpoint：
```bash
cd agent/daemon/aaa-daemon
npm test            # 含新 pi-runtime.test.mjs
npm run typecheck
```

## Phase C — backend 层：lease 表 + relay 服务

### C1 lease 表（alembic 0005）
- `backend/models/slock.py`：加 `LlmRunLease`（摘 07-22 slock.py:211）。
- `cd backend && uv run alembic revision --autogenerate -m "onboarding llm run lease"`，手填 `revision='0005_llm_run_lease'`、`down_revision='0004_template_tenancy'`，审查 upgrade/downgrade（参 `0004` 范例）。
- `backend/scripts/legacy_schema_preflight.py`：post-baseline 集合登记 `llm_run_leases` 表及其列/索引/约束/FK。
- **不塞 seed.py**。

### C2 服务 + 端点（摘 07-22）
- `backend/services/llm_run_leases.py`、`pi_llm_relay.py`、`runtime_state_lock.py`：摘用。
- `backend/routers/agent_api.py`：lease acquire/heartbeat/release 端点 + LLM relay 路由。
- `backend/config.py`：`PI_LLM_*` / `PI_LLM_MAX_ACTIVE_RUNS` / heartbeat / expiry。

Checkpoint：
```bash
cd backend && uv run pytest tests/test_llm_run_leases.py tests/test_pi_llm_relay.py -q
cd backend && SMALLKHOJ_MIGRATION_TEST_ADMIN_URL=... SMALLKHOJ_MIGRATION_TEST_DATABASE_URL=... uv run pytest tests/test_alembic_migrations_postgres.py -q
cd backend && uv run pytest tests -q
```

## Phase D — 前端层：动态 Runtime + 引导（核心）

### D1 runtime-options 补 Pi
- `frontend/lib/runtime-options.ts`：`publicRuntimeValue` 加 `case 'pi'`；新增 `runtimeOptionsFromDetected`；`expectedProviderNamesForRuntime` pi 返回 `[]`。

### D2 create-agent-form bug 修复 + 引导
- 删写死 items（line 141）；Runtime 下拉用 `runtimeOptionsFromDetected`；不可选灰掉；bundled Pi 标「自带」；默认值逻辑；引导文案。

### D3 capacity 状态
- `capacity_waiting` 在对话界面显示排队/位置，区分于安装失败。

### D4 文案
- `frontend/messages/zh-CN.json` + `en.json`：`createAgent.runtimeGuide.*`。

### D5 测试
- runtime-options + create-agent-form 测试。

Checkpoint：
```bash
cd frontend
npm test && npm run lint && npx tsc --noEmit && npm run build
```

## Phase E — 整合 + 真测

1. 起 backend/frontend/daemon 栈。
2. `./twd` 真测（marker `REAL_runtime_select_guide_<timestamp>`）：
   - 本机无 codex：codex 不可选。
   - bundled Pi：可选 + 「自带」标识。
   - 选 Pi（无需配 key）→ 创建成功 → 启动 → 首个回合经 relay 用 MiniMax 完成真实回复。
   - 并发两回合一 running 一 waiting，释放后递进。
3. 截图 + DOM 断言存 `.trellis/tasks/07-28-runtime-select-guide/evidence/`。

## Phase F — 质量门禁 + 收尾

1. 全量：frontend test/lint/tsc/build + daemon test/typecheck + backend test + alembic 迁移测试。
2. `trellis-check`（Agent 形式）跨层复核。
3. `trellis-update-spec`：把「Runtime 下拉必须走 detectedRuntimes，不准写死」+「lease 表走 alembic，不准塞 seed.py」写进 spec。
4. 单 commit：`feat(runtime): dynamic runtime select with bundled Pi + minimax relay`。

## 07-22 文件映射（摘用源）

见 design.md §6。读出方式：tracked 用 `git show 'stash@{0}:<path>'`，untracked 用 `git show 'stash@{0}^3:<path>'`。

## 不做（防范围蔓延）

guide/systemRole、guest role、空 server 状态机、embedded Node 打包、重新审批 MiniMax 订阅。
