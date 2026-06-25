# Research: TaskRun config template design

- Query: TaskRun 配置模板、RolePreset、direct assignment 自动开始、多 agent/role 执行策略，以及现有 Task / TaskAssignment / TaskRun 表达方式
- Scope: internal
- Date: 2026-06-24

## Findings

### 结论摘要

当前 TaskRun 已经是独立于 Task 的运行记录，但仍偏向“一次 assigned task invocation”的实现：创建任务时如果 assignee 是 agent，就创建一个 `TaskAssignment` 和一个 queued `TaskRun`；daemon 收到 task.created 后把该 run 作为一个 runtime turn 派发；runtime result 事件到来时把 TaskRun 标记 completed。要支持“长期有状态 loop + 可编辑配置模板 + 多 agent/role 策略”，建议保留现有 `TaskRun` 作为长期运行容器，新增 `TaskRunTurn` / `TaskRunOutput` / `RolePreset` / `TaskRunTemplate` 等概念，而不是把模板塞进自由 prompt。

MVP 应先做：配置模板 CRUD、direct assignment 自动开始、明确的 run 启动入口、parallel/sequential 策略字段、RolePreset 固定工具/skill/memory/output/runtime 偏好。Later 再做：多轮长期 loop 的完整 turn/output 表、手动开始、条件分支、输出制品管线、上下文压缩阈值和回收策略 UI。

### Files found

后端模型与服务：

- `backend/models/slock.py` — Task、TaskAssignment、TaskRun ORM 模型；当前 role 和 status 都是枚举约束。
- `backend/models/seed.py` — 本地 startup DDL；需要和 ORM 同步新增表/列。
- `backend/services/task_runs.py` — 创建 assignment/run、run 生命周期更新、usage/context/tool evidence 序列化。
- `backend/routers/public_api.py` — public task create/update/list serializer；Tasks UI 和 chat 创建任务走这里。
- `backend/routers/agent_api.py` — agent task create/list 和 TaskRun lifecycle 上报入口。
- `backend/services/daemon_control.py` — daemon 事件 fanout 和 targetAgentId 可见性补齐。
- `backend/services/task_memory_request.py` — 现有 output direction / memory request 事件，可借鉴输出策略设计。
- `backend/services/memory_api.py` — task memory summary / promote 到 channel memory 的产物落点。
- `backend/tests/test_task_runs.py` — TaskRun 模型、创建、序列化、public/agent 创建测试。
- `backend/tests/test_agent_task_memory_handoff.py` — task output/memory/proposal 测试。

daemon/runtime：

- `agent/daemon/aaa-daemon/src/daemon/daemon.ts` — task.created 事件解析、runtime delivery、TaskRun lifecycle 回写、usage/tool/output message evidence 提取。
- `agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs` — taskRunId/promptProfile/contextSessionId 解析和 lifecycle 报告测试。

前端：

- `frontend/app/control/integration/page.tsx` — TaskRun 时间线、usage/evidence 展示，适合做全局运行监控和分组视图。
- `frontend/app/tasks/page.tsx` — Tasks 主界面、创建/更新表单、Task detail、memory/evidence/review 区块，适合做模板选择/编辑和任务级 run 分组。
- `frontend/components/task-board.tsx` — 任务卡拖拽分配 agent；当前只 patch assignee，适合接 direct assignment 配置。
- `frontend/components/task-dnd-board.tsx` — `/tasks` 页面封装的 board/list 容器。
- `frontend/app/chat/[channel]/channel-client.tsx` — chat 中从消息创建 task；适合使用默认模板或快速模板选择。
- `frontend/components/message-composer.tsx` — 较旧/简单的 `AS TASK` composer，若仍被使用，需要避免和新模板入口分裂。
- `frontend/messages/en.json`、`frontend/messages/zh-CN.json` — `/tasks` 文案目前走 i18n，新增模板 UI 要补文案。

相关 specs：

- `.trellis/spec/backend/database-guidelines.md` — DB startup DDL、任务编号并发 retry 规范。
- `.trellis/spec/backend/event-delivery-contracts.md` — runtime 只接收 actionable events，activity 不能变成 runtime prompt。
- `.trellis/spec/backend/memory-contracts.md` — task/channel memory、context manifest、输出/evidence/proposal 的现有契约。
- `.trellis/spec/frontend/product-ui-style.md` — operational UI、Task Recovery 和产物展示规范。
- `.trellis/spec/frontend/quality-guidelines.md` — critical backend mutation 优先 native form/server action；浏览器证据要求。
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — 该功能跨 DB/API/daemon/frontend，必须先定义数据流和边界。

### 1. 现有 Task / TaskAssignment / TaskRun 表达方式

`Task` 是产品任务实体，字段包括 `task_number`、`channel_id`、`message_id`、`title`、`description`、`status`、`creator_id`、`assignee_id`、`data`，并通过 relationship 关联 assignments 和 runs（`backend/models/slock.py:259`-`backend/models/slock.py:284`）。

`TaskAssignment` 当前是 task 到 assignee 的分配记录，字段有 `assignee_type`、`role`、`assignment_mode`、`status`、`created_by`。关键限制是 role 被 DB check constraint 写死为 `leader / worker / reviewer / participant`，默认 `worker`（`backend/models/slock.py:287`-`backend/models/slock.py:315`；startup DDL 同步在 `backend/models/seed.py:90`-`backend/models/seed.py:108`）。这和用户要求“role 不能写死 worker/leader/reviewer”冲突。

`TaskRun` 是实际 runtime 执行记录，已有字段可以表达 run 的核心 evidence：`prompt_profile`、`workspace_session_id`、`runtime_session_id`、`context_session_id`、`context_scope`、`context_summary`、`context_usage`、`token_usage`、`tool_usage_summary`、`output_message_id`、failure、started/completed 时间（`backend/models/slock.py:317`-`backend/models/slock.py:381`；startup DDL 在 `backend/models/seed.py:110`-`backend/models/seed.py:152`）。

当前 `create_task_assignment_and_run` 只接受 `role` 字符串，并通过 `_prompt_profile(role)` 映射到固定 profile：leader -> `task.leader`，reviewer -> `task.reviewer`，participant -> `task.participant`，其它 -> `task.worker`（`backend/services/task_runs.py:40`-`backend/services/task_runs.py:47`）。context session id 格式也把 role 写进字符串：`task:{task_id}:role:{role}:run:{run_id}`（`backend/services/task_runs.py:50`-`backend/services/task_runs.py:51`）。创建 run 时 status 固定 queued，contextScope 固定 task，contextSummary 只记录 role/assignmentMode/triggerType/sourceMessageId（`backend/services/task_runs.py:74`-`backend/services/task_runs.py:132`）。

生命周期上报入口 `update_task_run_lifecycle` 支持状态 `queued/dispatched/running/awaiting_input/completed/failed/cancelled`，可以 merge `context_usage`、`token_usage`、`tool_usage_summary`，并设置 `output_message_id`、failure 等（`backend/services/task_runs.py:135`-`backend/services/task_runs.py:214`）。Agent API 对应 `POST /internal/agent-api/task-runs/{run_id}/lifecycle`，body 只允许 lifecycle/evidence 字段，不允许修改模板/role/runtime strategy（`backend/routers/agent_api.py:93`-`backend/routers/agent_api.py:104`，`backend/routers/agent_api.py:3950`-`backend/routers/agent_api.py:4002`）。

序列化方面，`serialize_task_run` 已输出 camelCase contract：`promptProfile`、`contextSessionId`、`contextSummary`、`contextUsage`、`tokenUsage`、`toolUsageSummary`、`usageSummary`、`outputMessageId`、`progressState`、`progressLabel`、`evidenceIssues` 等（`backend/services/task_runs.py:352`-`backend/services/task_runs.py:400`）。`_usage_summary` 会计算 token、tool、context occupancy，并在 `contextOccupancyRatio >= 0.5` 时标记 `contextOverThreshold`（`backend/services/task_runs.py:263`-`backend/services/task_runs.py:303`）。这说明现有系统已有“上下文压缩/占用可观测性”的基础，但没有真正的压缩策略配置。

Evidence 规则目前偏“一次执行完成后是否有证据”。completed run 缺 output message、token usage、context usage/window、tool usage 时会生成 `TASK_RUN_OUTPUT_MISSING`、`TASK_RUN_TOKEN_USAGE_MISSING`、`TASK_RUN_CONTEXT_USAGE_MISSING`、`TASK_RUN_CONTEXT_WINDOW_MISSING`、`TASK_RUN_TOOL_USAGE_MISSING` 等 issue（`backend/services/task_runs.py:306`-`backend/services/task_runs.py:326`）。

### 2. API 和事件如何表达 run 信息

Public task serializer 会把 task 的 runs 一并返回：`runs: [serialize_task_run(run)]`（`backend/routers/public_api.py:993`-`backend/routers/public_api.py:1029`）。Agent API serializer 同样返回 `runs`（`backend/routers/agent_api.py:562`-`backend/routers/agent_api.py:596`）。

Public `POST /api/v1/tasks` 创建 task 后，如果 assignee 是 agent，会调用 `create_task_assignment_and_run(... role="worker", assignment_mode="task_created", trigger_type="task_created")`（`backend/routers/public_api.py:1957`-`backend/routers/public_api.py:2078`）。它只在 activity/event details 里放了 `taskRunId`，没有放 `promptProfile`、`contextSessionId` 或未来模板字段（`backend/routers/public_api.py:2040`-`backend/routers/public_api.py:2070`）。

Agent `POST /internal/agent-api/tasks` 创建 delegated task 也固定 `role="worker"`，`assignment_mode="agent_delegated"`，`trigger_type="leader_delegated"`（`backend/routers/agent_api.py:2293`-`backend/routers/agent_api.py:2385`）。测试也明确断言 public create 和 agent create 都创建 worker run（`backend/tests/test_task_runs.py:766`-`backend/tests/test_task_runs.py:933`）。

Public `PATCH /api/v1/tasks/{task_id}` 目前只更新 task 字段和 assignee，然后记录 `supervisor_task_updated` activity；不会创建 `TaskAssignment` 或 `TaskRun`（`backend/routers/public_api.py:2081`-`backend/routers/public_api.py:2136`）。这意味着现有 DND 手动分配 agent 只是改 `assignee_id`，并不会启动 runtime。用户要求“direct assignment 先自动开始，手动开始后加”需要新增显式“assign and start”或“start run”路径，不能只复用现有 patch。

Activity -> EventRecord 时，backend 会把 details 合入 payload（`backend/routers/public_api.py:1064`-`backend/routers/public_api.py:1079`）。Daemon event fanout 只补 `targetAgentId/assigneeId`，不补 run 配置字段（`backend/services/daemon_control.py:406`-`backend/services/daemon_control.py:421`）。Daemon 的 event parser 可以从 value 或 details 解析 `taskRunId`、`promptProfile`、`contextSessionId`（`agent/daemon/aaa-daemon/src/daemon/daemon.ts:1732`-`agent/daemon/aaa-daemon/src/daemon/daemon.ts:1759`）。因此 MVP 可以在 task.created / run.started event details 里直接带 `promptProfile/contextSessionId/rolePresetId/templateId`，不必先新增 daemon 拉详情逻辑。

Runtime delivery 中，daemon 收到 message 后先 format prompt，再加载 selective memory context manifest，然后 `sendUserMessage`；如果有 `taskRunId`，会报告 `dispatched`，实际 delivered 后报告 `running` 并设置 active task run counters（`agent/daemon/aaa-daemon/src/daemon/daemon.ts:300`-`agent/daemon/aaa-daemon/src/daemon/daemon.ts:365`）。result event 到来时会报告 `completed` 并清空 activeTaskRun 状态（`agent/daemon/aaa-daemon/src/daemon/daemon.ts:1043`-`agent/daemon/aaa-daemon/src/daemon/daemon.ts:1083`）。这就是现有“一次 turn 完成即 completed”的边界，和长期 loop 目标冲突。

Daemon 会统计 tool use/result、输出消息 id、token/context usage 并上报 lifecycle（`agent/daemon/aaa-daemon/src/daemon/daemon.ts:962`-`agent/daemon/aaa-daemon/src/daemon/daemon.ts:1040`，`agent/daemon/aaa-daemon/src/daemon/daemon.ts:2119`-`agent/daemon/aaa-daemon/src/daemon/daemon.ts:2183`）。测试覆盖了 event 中 `promptProfile/contextSessionId` 进入 prompt，以及 lifecycle POST（`agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs:480`-`agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs:547`）。

### 3. 前端适合展示 TaskRun 分组视图和配置模板的位置

`/control/integration` 已经有 TaskRun timeline 类型定义，包含 `promptProfile/contextSessionId/contextUsage/tokenUsage/toolUsageSummary/outputMessageId/evidenceIssues/stale` 等完整 run fields（`frontend/app/control/integration/page.tsx:39`-`frontend/app/control/integration/page.tsx:98`）。`RunRow` 显示状态、role chip、task title、evidence issue、执行者、电脑、工作区、开始/结束/耗时、输出、usage summary 和隐藏技术细节（`frontend/app/control/integration/page.tsx:499`-`frontend/app/control/integration/page.tsx:581`）。这个页面适合展示全局“TaskRun 分组视图/运行监控”：按 task/template/agent/status 分组，排查策略、并行度、失败原因。

`/tasks` 是最适合配置模板的主入口，因为它已有 server action 创建/更新 task，且符合 frontend spec 对关键 mutation 使用 native form/server action 的要求（`frontend/app/tasks/page.tsx:225`-`frontend/app/tasks/page.tsx:264`；spec 在 `.trellis/spec/frontend/quality-guidelines.md`）。Task detail 已展示 activity、source、evidence、TaskRecovery、memory request、review（`frontend/app/tasks/page.tsx:516`-`frontend/app/tasks/page.tsx:705`）。建议这里加 task-level “Runs / 配置模板 / 输出策略”区块：创建任务时选模板；任务详情里显示 template snapshot、runs grouped by role/agent/turn/output。

`frontend/components/task-board.tsx` 支持把 agent 拖到 task card 上，当前 `handleAssignAgent` 只调用 `PATCH /api/v1/tasks/{task.id}` 更新 assignee（`frontend/components/task-board.tsx:803`-`frontend/components/task-board.tsx:833`）。这是 direct assignment MVP 的最佳入口：拖拽 agent 到 task 后不应只是改 assignee；应根据默认模板创建 assignment/run 并自动 start，或弹出轻量配置确认。用户要求 direct assignment 先自动开始，所以 MVP 可默认用 task/channel/server 默认模板立即创建 run。

Chat 中 `createTaskFromContent` 会从 @mention 或 DM peer 推断 assignee，然后 `POST /api/v1/tasks` 创建 task（`frontend/app/chat/[channel]/channel-client.tsx:852`-`frontend/app/chat/[channel]/channel-client.tsx:893`）。这是第二个 direct assignment 入口：从消息创建 task 时若解析到 agent，就应套用默认模板并自动开始。Later 可以在 chat 菜单里选择模板；MVP 可以只使用默认模板，避免 chat UI 过重。

`frontend/components/message-composer.tsx` 还有一个简单 `AS TASK` checkbox（`frontend/components/message-composer.tsx:17`-`frontend/components/message-composer.tsx:80`）。需要确认是否仍在 active route 中使用；若使用，也必须接同一模板 contract，不能成为绕过模板的旧入口。

### 4. TaskRun / Turn / Output / Memory / RolePreset 设计建议

建议概念拆分：

- `Task`: 用户可理解的工作目标，长期存在，包含标题、描述、状态、来源、默认模板。
- `TaskAssignment`: 某个 assignee/agent 在某个 role preset 下参与 task 的记录，表示“谁以什么职责加入”，不等于一次 runtime turn。
- `TaskRun`: 长期有状态 loop 容器，绑定 task、assignment、role preset、template snapshot、runtime workspace、context session、run status、aggregation state。一个 run 可以经历多次 turn，不应在第一个 provider result 后天然 completed。
- `TaskRunTurn`: 一次 runtime input/output cycle。保存 turn number、input event/message、provider session id、status、started/completed、token/context/tool usage、compression decision、failure。
- `TaskRunOutput`: run/turn 产生的产物索引，类型可以是 `message`、`memory_entry`、`file`、`artifact`、`ppt`、`video`、`image`、`external_url`、`review_decision` 等；现有 `output_message_id` 只能作为 MVP 的 message output 快捷字段。
- `TaskRunMemory` 或复用 `MemoryEntry`: task/run/turn 级记忆与恢复点。现有 memory contract 已支持 task scope 和 final-summary/progress/evidence；run 级可先放在 metadata 中，later 再单独建表或扩 scope。
- `RolePreset`: 可复用能力配置，不是自由 prompt。包含身份名、目标、工具策略、skill 策略、memory 策略、输出策略、runtime 偏好、允许编辑字段、默认 stop/continue 条件。
- `TaskRunTemplate`: 编排模板，包含 role presets 列表、执行策略 parallel/sequential、start policy、aggregation policy、output requirements、context/compression policy。创建 run 时应 snapshot 到 run/assignment，避免模板后续修改影响历史 run 解释。

当前 `TaskRun.status` 可以继续作为 run-level 状态，但长期 loop 需要新增更细状态。MVP 可保持现有 status，并把“provider result 后不要自动 completed”的行为限制在模板配置中：例如 `completionPolicy: "single_turn_result" | "await_explicit_done" | "output_gate" | "manual_review"`。默认兼容旧行为为 `single_turn_result`；新 template 默认用 `await_explicit_done` 或 `output_gate`，让 runtime result 只完成当前 turn，run 进入 `awaiting_input` 或 `running`，直到 agent 显式发送 final output/summary 或后端聚合器判定完成。

上下文压缩不要太早自动触发：现有 serializer 在 occupancy >= 0.5 就标记 `contextOverThreshold`（`backend/services/task_runs.py:280`-`backend/services/task_runs.py:303`）。建议模板中单独配置 `contextPolicy`：

- `memoryManifest: selective`：继续使用现有 selective manifest，避免全量 memory 注入。
- `compressionMode: manual | suggested | auto_at_threshold`，MVP 默认 `suggested`。
- `suggestAtOccupancyRatio`: 建议不低于 0.65。
- `autoCompressAtOccupancyRatio`: later，建议不低于 0.85，且需要用户/role policy 允许。
- `preserveRecentTurns`: 默认保留最近 N turn 和 pinned outputs。
- `recoveryOutputsRequired`: final summary / progress / evidence / artifacts 等。

### 5. RolePreset / 配置模板如何避免退化成自由 prompt

RolePreset 不应只是 `name + prompt`。建议 schema 固定结构：

- `id`, `name`, `description`, `category`, `version`, `enabled`
- `roleKey`: 稳定 key，例如 `researcher`, `builder`, `critic`, `planner`, `operator`, `designer`，但不限制在 worker/leader/reviewer。
- `instructionTemplate`: 允许有短文本模板，但只能引用固定变量，如 `{task.title}`、`{task.description}`、`{source.message}`、`{memory.snippets}`。不能作为唯一配置。
- `toolPolicy`: `allowedTools`, `deniedTools`, `approvalMode`, `networkPolicy`, `filesystemPolicy`, `browserPolicy`, `sideEffectPolicy`
- `skillPolicy`: `requiredSkills`, `optionalSkills`, `forbiddenSkills`, `skillLoadMode`
- `memoryPolicy`: `readScopes`, `writeScopes`, `proposalRequired`, `summaryCadence`, `promotionPolicy`, `contextManifestTopK`
- `outputPolicy`: allowed/required output types，如 `message`, `memory`, `file`, `slides`, `video`, `image`, `structured_json`; required evidence; final output destinations
- `runtimePreference`: `runtime`, `provider`, `model`, `temperature/effort` 类偏好，`workspaceAffinity`
- `loopPolicy`: maxTurns、idle behavior、awaiting input 条件、completion policy、retry policy
- `contextPolicy`: 上下文策略、压缩建议阈值、手动/自动压缩
- `editableFields`: UI 允许用户改哪些字段，例如 title/description/output directions/model/parallelism；禁止用户直接改 tool allowlist 之外的能力边界
- `audit`: createdBy/updatedBy/createdAt/updatedAt

TaskRunTemplate 建议 schema：

- `id`, `name`, `description`, `version`, `scope` (`server`/`channel`/`user`)
- `roles`: `{rolePresetId, count, agentSelector, required, dependsOn, inputMapping, outputMapping}`
- `executionStrategy`: `parallel` / `sequential` / `hybrid`
- `startPolicy`: `auto_on_direct_assignment` / `manual` / `scheduled`
- `assignmentPolicy`: direct drag、chat mention、task create 分别如何选 agent/role
- `aggregationPolicy`: Task 状态如何由多个 runs 聚合，例如 all required done、any failed blocks、review gate
- `defaultOutputPolicy`, `defaultMemoryPolicy`, `defaultContextPolicy`
- `editableFields`
- `templateSnapshot` 写入 TaskRun/Assignment，以便历史可解释。

这样做的核心是：用户可以编辑“目标和偏好”，但不能把 role 退化成未受约束的自由 prompt。真正影响运行能力的工具、skill、memory、output、runtime 都由 schema 字段表达，并由后端验证。

### 6. Direct assignment MVP 与多 agent/role 状态聚合

MVP 行为建议：

1. 从 chat @agent/DM 创建 task 或把 agent 拖到 task 上，视为 direct assignment。
2. 如果请求带 `templateId`，使用该模板；否则使用 server/channel 默认模板。
3. 如果 direct assignment 只有一个 agent，创建一个 `TaskAssignment` + 一个 `TaskRun`，rolePreset 使用模板默认 role，`startPolicy=auto_on_direct_assignment` 时立即发 runtime-actionable event。
4. 如果 direct assignment 选择多 agent/role，按模板 `executionStrategy` 创建多个 assignments/runs：
   - `parallel`: 所有无 dependency 的 runs 都 queued/dispatched。
   - `sequential`: 只启动第一个 role/run；后续 run 等前置 output gate 完成。
5. `Task.status` 聚合：
   - 任一 run running/dispatched -> task `in_progress`
   - 所有 required runs completed 且 review required -> `in_review`
   - 所有 required runs completed 且 no review -> `done`
   - 任一 required run failed -> task 保持 `in_progress` 或 `blocked/failed`（当前 Task status 没有 failed，MVP 可用 `in_progress` + data 聚合状态，later 加 status）
   - optional run failed 不阻断，但显示 warning。

后端要避免复用 `PATCH /tasks` 的旧语义直接自动启动，因为 patch 现在只是普通更新。建议新增：

- `POST /api/v1/tasks/{task_id}/assignments`：创建 assignment/run，可传 `assignee`, `templateId`, `rolePresetId`, `startPolicy`。
- `POST /api/v1/tasks/{task_id}/runs/start` 或 `POST /api/v1/task-runs/{run_id}/start`：手动开始 later 用；MVP direct assignment 可内部调用同一 service。
- `GET /api/v1/task-run-templates`、`POST/PATCH /api/v1/task-run-templates/{id}`：模板 CRUD。
- `GET /api/v1/role-presets`、`POST/PATCH /api/v1/role-presets/{id}`：RolePreset CRUD，MVP 可 seed defaults + allow edit selected fields。

如果先不建独立 start endpoint，也至少要把 `create_task_assignment_and_run` 扩展为接受 `template`, `rolePreset`, `start_policy`, `execution_strategy`, `output_policy`, `context_policy`，并在 `_record_activity` details 中带 `promptProfile/contextSessionId/templateId/rolePresetId`，因为 daemon 已支持解析这些字段（`agent/daemon/aaa-daemon/src/daemon/daemon.ts:1748`-`agent/daemon/aaa-daemon/src/daemon/daemon.ts:1753`）。

### MVP / Later 分层

MVP：

- 新增 `role_presets` 和 `task_run_templates` 表，或在最小版中用 `task_run_templates` JSONB 包含 role presets snapshot；但建议独立表，避免后续迁移困难。
- 放宽/替换 `TaskAssignment.role` constraint：从固定枚举改为 role key 或 `role_preset_id` 外键；保留旧 role 字段做兼容 display。
- `TaskRun` 新增 `template_id`、`template_snapshot`、`role_preset_id`、`role_snapshot`、`execution_group_id`、`execution_strategy`、`start_policy`、`completion_policy`、`output_policy`、`memory_policy`、`context_policy`、`aggregation_state`。
- Public task create 支持 `templateId` / `rolePresetId` / `runConfig`；chat direct assignment 默认自动开始。
- DND assign 改为调用 assignment/start API，而不是只 patch assignee。
- `/tasks` 创建表单加模板选择；Task detail 加 Runs 分组和 template snapshot 摘要；保留 memory/evidence/review 现有区块。
- `/control/integration` 加按 Task/Template/Role/Agent 分组视图，展示并行/顺序状态、聚合状态、缺失 evidence。
- Daemon task.created payload 补齐 `promptProfile/contextSessionId/templateId/rolePresetId/outputPolicy` 的必要子集。
- 完成策略先兼容旧 single-turn completed；新模板可配置 `await_explicit_done`，但 MVP 可以先仅在 UI/DB 记录，runtime 完成仍按旧 lifecycle 走，避免一次改太多。若要真正长期 loop，至少要新增 turn 概念或让 result event 不直接 completed run。

Later：

- 新增 `task_run_turns` 和 `task_run_outputs`，把 provider result 完成改为完成 turn，而不是完成 run。
- 手动开始 UI/API、暂停/恢复/cancel、retry、fork run。
- 多 agent sequential dependency scheduler 和 output mapping。
- 输出产物 registry：message/memory/file/slides/video/image/external artifact 的统一索引和 viewer。
- RolePreset 版本管理、模板发布/复制、channel/user scope 权限。
- 自动 context compaction：基于 contextPolicy，默认先 suggested/manual，不要早于高占用阈值自动触发。
- 更丰富 Task status，例如 `blocked` / `failed` / `awaiting_input`，或独立 `runAggregationState` 不污染 Task 主状态。

### 需要改的文件建议

后端：

- `backend/models/slock.py`：新增 RolePreset/TaskRunTemplate 模型；扩展 TaskAssignment/TaskRun 字段；调整 role constraint。
- `backend/models/seed.py`：新增 startup DDL 和 `ALTER TABLE ADD COLUMN IF NOT EXISTS`；保证旧 DB 可升级。
- `backend/services/task_runs.py`：把 role/promptProfile 固定映射改为 role preset/template resolution；新增 create assignments/runs group、start policy、aggregation helper、template snapshot。
- `backend/routers/public_api.py`：task create/update/serializer 支持 template/run config；新增 templates/role presets/assignment/start routes；activity details 补 run config fields。
- `backend/routers/agent_api.py`：agent delegated task create 支持 template/role preset；lifecycle 可能需要 run-turn aware update。
- `backend/services/daemon_control.py`：确认 task/run events payload 不丢模板字段；必要时补 run detail。
- `backend/services/task_memory_request.py` / `backend/services/memory_api.py`：把 outputDirections 升级为 outputPolicy，仍兼容现有 final_summary/evidence/artifacts/next_steps/channel_memory。

daemon：

- `agent/daemon/aaa-daemon/src/daemon/daemon.ts`：解析 template/role/output/context policy；长期 loop 时不要把每个 result 都直接完成 run，改为 turn completed + run awaiting_input/running/completed policy。
- `agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs`：补模板字段解析、completion policy、turn/output evidence 测试。

前端：

- `frontend/app/tasks/page.tsx`：创建表单加 template selector；Task detail 加 run group/template summary；server action 带 template/runConfig。
- `frontend/components/task-board.tsx`：DND assign 改调用新 assignment/start endpoint；必要时显示默认模板或轻量确认。
- `frontend/app/chat/[channel]/channel-client.tsx`：chat create task 带默认 template；later 加从消息创建任务的模板选择。
- `frontend/app/control/integration/page.tsx`：TaskRun timeline 增加 grouped view、template/role chips、multi-agent aggregation。
- `frontend/lib/control-plane.ts`：补 TaskRunTemplate/RolePreset/TaskRun 输出类型。
- `frontend/messages/en.json`、`frontend/messages/zh-CN.json`：补模板、role、策略、输出类型文案。

测试：

- `backend/tests/test_task_runs.py`：RolePreset/template DDL、create assignment/run with template snapshot、direct assignment auto start、parallel/sequential aggregation、serializer contract。
- 新增 `backend/tests/test_task_run_templates.py`：template CRUD、editableFields 验证、禁止自由 prompt 越权、默认模板 resolution。
- `backend/tests/test_public_task_run_templates.py`：public task create/chat/DND assignment payload 行为。
- `backend/tests/test_agent_task_memory_handoff.py`：outputPolicy 与现有 task summary/promote 兼容。
- `agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs`：runtime event 中 template/role/context policy 进入 prompt；lifecycle 不误完成长期 run。
- `frontend/test/*`：模板 selector render、TaskRun group view、DND assign 调用新 endpoint。
- Browser real test：按 frontend spec 用 `./twd`，覆盖 `/tasks` 创建带模板的 task、拖拽 agent 自动生成并启动 run、`/control/integration` 看到 grouped TaskRun 和 evidence。

## Caveats / Not Found

- 未发现现有 RolePreset 或 TaskRunTemplate 模型/API；当前只有 `prompt_profile` 字符串和固定 role -> promptProfile 映射。
- 未发现 `TaskRunTurn` 或多 output 表；当前 `TaskRun` 只有一个 `output_message_id` 和 JSONB usage summary，不能完整表达 message/memory/file/PPT/video 等多样产物。
- 未发现手动 start run API；`PATCH /api/v1/tasks/{id}` 更新 assignee 不创建 assignment/run，因此 DND 分配目前不会启动 runtime。
- 未发现模板编辑 UI；`/tasks` 和 chat 都只传简单 task fields。
- 未读取或打印 `.dev-pids`、token、credential 文件；调研范围限定在代码、spec、测试和任务 research 输出。
- CodeGraph 在该 worktree 未初始化，已按项目规则退回 `rg`/只读文件读取。
