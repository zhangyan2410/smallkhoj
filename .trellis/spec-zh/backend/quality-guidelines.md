# 质量指南

> 后端开发的代码质量标准。

> **⚠️ 空模板，勿据此开发。** 本文件正文尚未填写。填实归属任务：
> `.trellis/tasks/08-19-agent-platform-quality-gates`（R2 pre-commit 门禁 /
> R5 错误分类学 / R6 文件头契约注释落地后一起填）。在那之前，
> 不要引用本文件的任何"规范"。

---

## 概览

<!--
在这里记录项目的质量标准。

需要回答的问题：
- 哪些模式被禁止？
- 强制执行哪些 lint 规则？
- 测试要求是什么？
- 适用哪些代码评审标准？
-->

（待团队填写）

---

## 禁用模式

<!-- 应永不使用的模式及原因 -->

（待团队填写）

---

## 必需模式

<!-- 必须始终使用的模式 -->

（待团队填写）

---

## 测试要求

<!-- 期望的测试水平 -->

（待团队填写）

---

## 代码评审清单

<!-- 评审者应检查什么 -->

（待团队填写）

## 场景（scenario）：初始发布基础门禁（gate）

### 1. 作用域 / 触发
- 触发：新增或修改决定初始发布基础是否就绪的发布就绪脚本。
- 适用于 `scripts/initial_release_foundation_gate.py` 及 `scripts/` 下的支撑校验脚本。

### 2. 签名
- 基础门禁命令：
  `python3 scripts/initial_release_foundation_gate.py --base-url <public-url> [--daemon-package-version <published-package-version>] [--allow-http] [--env-file <path>] [--runtime] [--skip-backend-tests] [--strict-warnings] [--partial] [--json]`
- 备份/恢复演练（drill）命令：
  `python3 scripts/postgres_backup_restore_drill.py [--dry-run] [--env-file <path>] [--compose-file <path>] [--backup-dir <path>] [--restore-database <name>] [--json]`
- JSON 报告字段包括 `ready`、`failures`、`blocked`、`warnings`、`p0Warnings`、`risks` 和 `checks`。

### 3. 契约
- 存在失败、阻塞检查或任何 P0 警告时，`ready` 必须为 false。
- 除非在门禁之外显式收窄发布定义，P0 警告不是可接受的发布就绪状态。
- `--strict-warnings` 额外让非 P0 警告产生 warning 退出码。
- `--partial` 只用于开发检查项，不得用作发布候选证据。
- 脚本不得打印秘密值。允许出现环境路径、键名以及 `<set>`/`<empty>` 摘要。
- 备份/恢复演练必须对恢复数据库名冲突失败关闭（fail-closed）。其可执行
  步骤顺序是 `backup -> create -> restore -> verify -> drop-after`；
  绝不能发出 pre-create 的 `dropdb`。`createdb` 失败即终止演练，只有本次
  调用的 `createdb` 成功之后才允许清理。
- 风险登记表的存在仅是追踪证据。它不得用作某个产品 P0 风险（例如
  账户/服务器/频道隔离）的通过门禁。
- 消费 Trellis 任务证据的门禁必须同时搜索活跃任务路径和
  `.trellis/tasks/archive/<year-month>/` 下的归档任务路径。已完成的证据
  不得在 `task.py archive` 之后变得不可见。

### 4. 校验与错误矩阵
- 缺少 P0 可执行覆盖 → `blocked`，退出码 `3`。
- 检查失败 → `failed`，退出码 `1`。
- 无失败/阻塞检查但有 P0 警告 → `warning`，`ready=false`，退出码 `2`。
- 带 `--strict-warnings` 的非 P0 警告 → 退出码 `2`。
- 不带 `--strict-warnings` 的非 P0 警告 → 仅当没有失败、阻塞检查或 P0 警告时 `ready=true`。
- 证据只存在于已归档的 Trellis 任务 → 正常检查该证据；不要回退为 dry-run 警告或 missing-risk 失败。

### 5. 好/基线/坏案例
- 好：一次已部署的冒烟检查通过，且 FR-04 记录了具体的 WebSocket 认证拒绝结果。
- 好：一个已归档基础任务的 `risk-register.md` 和 `evidence/postgres_backup_restore_drill_*.json` 仍是当前门禁的有效输入。
- 好：dry-run 备份/恢复计划记录命令形状，但在真实恢复执行前返回 P0 警告。
- 基线：当初始发布显式接受该限制时，P1 容量警告可以保持为警告。
- 坏：FR-07 只有 dry-run 证据时返回 `ready=true`。
- 坏：用 `--partial` 输出充当发布候选证据。
- 坏：因为风险登记表提到 FR-01 就把 FR-01 标记为通过。
- 坏：为要在任务归档后存活的证据硬编码只查 `.trellis/tasks/<task>/...`。

### 6. 必需测试
- 单元测试：P0 警告递增 `p0Warnings`、置 `ready=false` 并返回退出码 `2`。
- 单元测试：JSON 输出省略秘密值。
- 回归测试必须拒绝每一条 pre-create `dropdb`、要求五步
  backup/create/restore/verify/drop-after 计划，并证明 `createdb` 冲突
  失败时不做清理。
- 每个新门禁都要有映射到预期 `riskId` 与优先级的单元测试。
- 单元测试：追踪/元检查不会意外满足产品 P0 覆盖。
- 回归测试：活跃任务目录被移到 `.trellis/tasks/archive/<year-month>/` 之后仍能找到归档任务证据。
- 任务证据必须记录命令、目标环境、退出码、摘要，以及任何非通过的发布决定。

### 7. 错误 vs 正确
#### 错误
```text
0 failed + 0 blocked + 1 P0 warning -> ready=true
```

#### 正确
```text
0 failed + 0 blocked + 1 P0 warning -> ready=false, exit code 2
```

#### 错误
```text
Read only .trellis/tasks/06-29-.../risk-register.md; after archive, report FOUNDATION_RISK_REGISTER_MISSING.
```

#### 正确
```text
Search .trellis/tasks/06-29-... first, then .trellis/tasks/archive/*/06-29-... before deciding evidence is missing.
```

## 场景：集成门禁的 Runtime/档案（profile）选择与跳过语义

### 1. 作用域 / 触发

- 触发：修改 `tools/integration-gate/foundation-gate.mjs`、`tools/integration-gate/run.mjs`、集成门禁结果消费者，或 runtime 就绪/控制证据。
- 这是一个公共 CLI 与跨层证据契约：计算机/runtime 快照（snapshot）+ 可选 daemon 证据 -> 隔离的 runtime 报告 -> 可选的四 runtime 矩阵 -> 前端门禁控制台。

### 2. 签名

- CLI：`node tools/integration-gate/run.mjs --runtime <all|claude_code|codex|opencode|pi> [--runtime-control-result <path>] [--daemon-rpc-base <url>] [--runtime-agent-id <id>]`。
- 默认：`--runtime all`。
- 单 runtime 报告：`{mode:"foundation-only", runtime, ok, steps[12], failures, summary:{total,passed,failed,skipped}}`。
- 矩阵报告：`{runtime:"all", runtimeReports[4], steps[48], summary}`。
- 不适用步骤：`{status:"skip", applicable:false, evidence:{runtime,reason}}`。

### 3. 契约

- runtime 匹配只使用规范的 runtime 类型。提供方（provider）/模型元数据（包括 MiniMax）是独立的测试调用证据，不能用于选择或交叉匹配 runtime 家族。
- 检测、工作区复用、运行/预热、会话证据和自动 runtime 控制 Agent 选择必须全部使用同一个目标档案。
- 四个规范档案是 `claude_code`、`codex`、`opencode`、`pi`；`all` 按该顺序构建四份隔离报告。全绿矩阵有 48 步：44 通过 + 4 个显式跳过。
- Claude 需要 `/context`；Codex 需要 `/status`。OpenCode 与 Pi 目前不提供受支持的 context/compact 控制，因此 `context-preflight` 和 `compact-if-needed` 为 `skip` 且 `applicable:false`；skip 表示真实的不可适用，不是通过，也不是未知。
- daemon 日志预热证据只作用于被精确选中的 Agent id。无主/全局日志文本或另一 Agent 的 token/预热失败不得满足或污染某个档案。
- runtime 控制证据仅当其规范 `runtime` 与精确 `agentId` 匹配所选档案/工作区时才可用。否则丢弃 context/limit 字段，且适用的步骤以 `RUNTIME_CONTROL_TARGET_MISMATCH` 失败。
- `--runtime-control-result`、`--context-output` 与 `--runtime-agent-id` 在适用时要求单一 runtime；一份静态证据文件不能广播到 `all`。
- 门禁不得编辑、切换、重排、禁用或删除任何本地 runtime/provider 配置。提供方/模型设置是操作者所有的前置条件；如果在写入之前无法证明安全的隔离设置，就记录一个 blocker，而不是改动配置。
- 七个历史模式名保持稳定。runtime 选择只改变 Foundation 就绪结果，不会悄悄改变 chat/协作场景的语义。
- 协作受众（audience）解析（07-30 任务 `07-30-integration-gate-review-fixes`）：当协作执行以频道名开始且没有持久 `--channel-id` 时，必须复用消息发送响应返回的频道 ID 来加载频道成员关系（membership），再评估 V1/V2/V3 受众证据——绝不对未解析或猜测的频道身份评估受众证据。当显式提供 `--channel-id` 时，保留快速路径，不对同一个已解析频道发起重复的成员关系请求。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 不支持的 `--runtime` | `CONFIG_ERROR UNSUPPORTED_RUNTIME`，退出 `2`，发生在任何网络访问之前。 |
| `--runtime all` 加静态 context/control 证据 | `CONFIG_ERROR RUNTIME_EVIDENCE_REQUIRES_SINGLE_RUNTIME`，退出 `2`。 |
| `--runtime all` 加显式 runtime Agent id | `CONFIG_ERROR RUNTIME_AGENT_ID_REQUIRES_SINGLE_RUNTIME`，退出 `2`。 |
| 目标 runtime 缺失/运行中会话缺失 | 该 runtime 特有的严格步骤失败；另一个 runtime 不能满足它。 |
| runtime 控制的 `runtime` 或 `agentId` 缺失/不匹配 | context/compact 以 `RUNTIME_CONTROL_TARGET_MISMATCH` 失败；证据仅保留为安全的诊断元数据。 |
| 日志失败点名另一 Agent | 对目标档案忽略它；不报告目标预热失败。 |
| OpenCode/Pi 不支持 context 控制 | 两行显式 `skip` 且 `applicable:false`；其余十步保持严格。 |
| 提供方/模型包含另一个 runtime 的名字 | 家族匹配忽略它；只用规范 runtime 身份。 |
| 协作以频道名开始、无 `--channel-id` | 用发送返回的频道 ID 解析频道，然后加载成员关系并评估 V1/V2/V3；未解析身份是失败，不是空受众。 |
| 已提供 `--channel-id` | 成员关系快速路径；对同一个已解析频道没有重复的成员关系请求。 |

### 5. 好/基线/坏案例

- 好：一个 Codex 工作区带 `runtime:"codex"`、`runtimeProvider:"MiniMax"`、运行中会话和匹配的 `/status` 结果，通过 Codex 档案。
- 好：OpenCode 与 Pi 各通过十个严格的 Foundation 步骤并显示两个显式跳过。
- 基线：`all` 对一份计算机快照跑四份报告，同时每个工作区/会话/日志/控制观察都保持与自己的档案相关。
- 坏：一个 MiniMax 的 Claude 提供方名让 Codex 工作区满足 Claude 就绪。
- 坏：一个 OpenCode Agent 的 `MISSING_TOKEN` daemon 日志令四个 runtime 预热步骤全部失败。
- 坏：一份静态 Codex `/status` JSON 文件充当 Claude 的 context 百分比证据。

### 6. 必需测试

- Foundation 模型测试断言：规范 runtime/provider 相互独立、无工作区交叉匹配、OpenCode/Pi 跳过形状、48 步矩阵总数、精确的 Agent 日志过滤。
- CLI 测试断言：默认 `all`、全部五个被接受的 runtime 值、不支持的 runtime 在联网前退出 `2`、Codex 自动 Agent 选择、OpenCode/Pi 严格的 runtime/会话行为、以及全部七个模式名的保留。
- 静态与动态 runtime 控制测试断言：匹配的 `runtime + agentId` 证据通过，缺失/不匹配的身份以 `RUNTIME_CONTROL_TARGET_MISMATCH` 失败。
- 混合 daemon 日志测试断言：一个 Agent 的预热/token 错误不能污染另一个 runtime 档案。
- 协作 CLI 测试证明：仅以名字启动时经发送返回的频道 ID 解析成员关系（修复前为红），且显式 `--channel-id` 运行只发起一次成员关系请求。
- 结果消费者/UI 测试断言：`skip` 保持跳过并计入 `summary.skipped`，绝不变成 `unknown` 或通过。
- 纯契约套件：`node --test tools/integration-gate/*.test.mjs`；它必须保持不依赖服务、不依赖数据库。

### 7. 错误 vs 正确

#### 错误

```javascript
const candidate = workspaces.find((w) => JSON.stringify(w).includes('MiniMax'));
for (const runtime of runtimeTargets) buildReport({ runtime, runtimeHealth: parseDaemonRuntimeHealth(allLogs) });
```

#### 正确

```javascript
const agentId = selectRuntimeAgentIdForTarget(computers, runtime);
const runtimeHealth = parseDaemonRuntimeHealth(allLogs, { runtime, agentId });
const control = correlateRuntimeControlEvidence(rawControl, { runtime, agentId });
buildReport({ runtime, runtimeHealth, contextUsage: control.contextUsage });
```
