# Reference Task Model Research (multica / clowder-ai / SmallKhoj)

> **Task**: RUNTASK_RESEARCH_TASK_MODEL_202606241900 (Slock task #4)
> **Date**: 2026-06-24
> **Author**: @3333 (claude_code / MiniMax-M3, runtime session `71340587-d2ac-4ae0-9682-3519bdf3d3fe`)
> **Scope**: 本地只读调研三套项目的 task / run / group-work 模型；本报告不修改除自身之外的任何项目文件。

---

## 1. 摘要

本报告对 **multica**、**clowder-ai**、**SmallKhoj TaskRun** 三套系统的"工作项 / 运行时执行 / 多 agent 编排"模型做横向对比，并基于现有 SmallKhoj 现状给出下一阶段实现建议。

主要结论：

- **multica** 是"Issue（产品工作项） + AgentTaskQueue（一次执行）"的双层模型，并由本地 daemon 以"runtime 拉取 → 服务端原子 claim"的 pull 模型推动状态机。Squad 是"leader agent + worker roster"的轻量封装：分配给 squad 的 issue 永远只 enqueue leader，由 leader 通过评论 `@agent` 自行 fan-out；`AgentTaskQueue.IsLeaderTask` 区分 leader-role 与 worker-role，用于破除自循环。
- **clowder-ai** 是"Thread（长期会话） + Task（毛线球） + Session chain（active→sealing→sealed） + Agent（cat persona）"四层模型，**没有独立的 TaskRun 实体**。一次"run" = 一次 session invocation；任务输出分散在 `AutomationState` cursors、`EvidenceItem` 知识库和 thread 级 artifact list 中。A2A fan-out 用 `WorklistRegistry` + `MAX_A2A_DEPTH` + ping-pong streak 限速。
- **SmallKhoj 当前 TaskRun** 已经是"Message → Task → TaskRun"三层结构（与本次 PRD 一致），状态机 7 态，CHECK 约束已落地；但 **multi-agent / leader / claim queue / evidence bundle 都还停留在 schema 层**，没有 call-site 真正发出 `role=leader`、没有 `parent_run_id` 链、没有 worker 拉取接口、`output_message_id` 仍是单点证据。
- **下一步建议** 沿四个方向增量落地：补齐"leader 真正 fan-out + parent_run_id 链"、引入最小可工作的 claim queue（`status='queued'` + `claimed_by/claimed_at` 字段，不替换 daemon 推送）、把 `output_message_id` 扩成 `output_message_ids[]` + `evidence_entries` 表、补 V3 gate 的具体 failure codes（PRD/implement.md 已列出 6 个）。

---

## 2. 证据路径

本报告引用的源文件 12 个，按项目分组。

### 2.1 multica（/Users/code/project/multica）

| # | 路径 | 关键证据 |
|---|---|---|
| M1 | `server/pkg/db/generated/models.go` (lines 74-104) | `AgentTaskQueue` 结构体：状态字段、session_id、work_dir、parent_task_id、is_leader_task、handoff_note 等 |
| M2 | `server/pkg/db/generated/models.go` (lines 371-397) | `Issue` 结构体：polymorphic assignee（member/agent/squad）、parent_issue_id、stage 屏障字段 |
| M3 | `server/pkg/db/generated/models.go` (lines 627-649) | `Squad` / `SquadMember`：leader_id 直指 agent 表，squad 是 leader + roster 的轻量封装 |
| M4 | `server/pkg/db/queries/agent.sql` (lines 277-378) | 状态机 SQL：`ClaimAgentTask` / `StartAgentTask` / `CompleteAgentTask`；唯一 slot 规则（同一 (issue_id, agent_id) 不可并发） |
| M5 | `server/internal/service/issue_trigger.go` (lines 14-21, 82-157) | `WillEnqueueRun`：写 issue 时是否 enqueue runtime 任务的唯一判定；squad 分支解析到 leader id |
| M6 | `server/internal/service/task.go` (lines 957-1137, 515-523) | `ClaimTask` / `ClaimTaskForRuntime`：daemon 3s poll，按 runtime 维度查任务；`EnqueueTaskForSquadLeader` 设置 `is_leader_task=true` |
| M7 | `server/internal/handler/daemon.go` (lines 1227, 1381-1405) | `ClaimTaskByRuntime` endpoint；leader 任务 claim 时追加 `buildSquadLeaderBriefing` 到 agent 指令 |
| M8 | `server/internal/handler/issue_child_done.go` (lines 42-50, 472-526) | stage barrier 唤醒父 issue；same-squad / shared-leader 自循环守卫 |
| M9 | `server/internal/handler/comment.go` (lines 1397-1415) | `@agent` / `@squad` mention 派发到对应任务 |
| M10 | `docs/product-overview.md` (lines 92-125) | 多态 actor、Task 任务定义、Session Resumption 概念表 |
| M11 | `server/internal/service/autopilot.go` (lines 56-58, 235-236) | autopilot 调度也路由到 squad leader，与 issue assign 走同一入口 |

### 2.2 clowder-ai（/Users/code/project/clowder-ai）

| # | 路径 | 关键证据 |
|---|---|---|
| C1 | `packages/shared/src/types/task.ts` (lines 21-29, 102-137) | `TaskStatus = 'todo'\|'doing'\|'blocked'\|'done'`；`TaskKind` 区分 work/pr_tracking/issue_tracking；`subjectKey` 去重 |
| C2 | `packages/shared/src/types/session.ts` (lines 5-64) | `SessionStatus = 'active'\|'sealing'\|'sealed'`；session 是带 `seq` 的链；`catHandoffNote` 显式 A2A 交接 |
| C3 | `packages/api/src/domains/cats/services/stores/ports/ThreadStore.ts` (lines 113-188, 978-987) | `Thread` 接口：`parentThreadId` 子线程、`routingPolicy`、`threadMemory`、`preferredCats`、`pendingContinuation` |
| C4 | `packages/api/src/domains/cats/services/agents/routing/AgentRouter.ts` (line 1347) | mention → 串行 vs 并行策略：`intent.ideate && cats>1 ? parallel : serial` |
| C5 | `packages/api/src/domains/cats/services/agents/routing/WorklistRegistry.ts` (lines 11-67) | A2A worklist：`parentInvocationId` 为 key，`MAX_A2A_DEPTH` 限制 + ping-pong streak |
| C6 | `packages/api/src/domains/cats/services/agents/invocation/QueueProcessor.ts` (lines 289-291) | per-(thread, cat) slot 队列；fairness gate；zombie sweeper |
| C7 | `packages/api/src/domains/cats/services/context/IntentParser.ts` (lines 6-13) | `ideate` vs `execute` 意图解析 |
| C8 | `packages/api/src/domains/memory/interfaces.ts` (lines 78-152) | `IEvidenceStore` / `EvidenceItem`：按 `anchor` 索引，不挂在 task 上 |
| C9 | `packages/shared/src/types/thread-artifact.ts` | `ThreadArtifactDTO` / `GlobalArtifactDTO`：thread 级产物聚合 |
| C10 | `packages/shared/src/types/task-outcome.ts` | 仅含 permission-cancel 事件，**没有 TaskRun 实体** |

### 2.3 SmallKhoj 当前（/Users/code/project/smallkhoj-channel-taskrun-model）

| # | 路径 | 关键证据 |
|---|---|---|
| S1 | `.trellis/tasks/06-19-channel-task-workspace-optimization/design.md` (lines 5-11, 138-151, 313-343) | 三层模型 + 双状态机 + leader/drag 模式设计 |
| S2 | `backend/models/slock.py` (lines 259-372) | `Task` / `TaskAssignment` / `TaskRun` ORM：`role` (leader/worker/reviewer/participant)、`assignment_mode` (leader_designated/direct_drag/agent_delegated/system/task_created) |
| S3 | `backend/models/seed.py` (lines 90-148) | DDL：`task_assignments` + `task_runs` 表 + CHECK 约束 |
| S4 | `backend/services/task_runs.py` (lines 14-15, 73-194) | 状态机常量 + `create_task_assignment_and_run()` + `update_task_run_lifecycle()`；context_session_id 独立生成 |
| S5 | `backend/api/public_api.py` (line 2040) | `task_created` 触发路径，固定 `role="worker"` |
| S6 | `backend/api/agent_api.py` (lines 2341, 3937-3981) | `agent_delegated` 触发路径（仍然固定 `role="worker"`）+ lifecycle 上报 endpoint |
| S7 | `agent/daemon/aaa-daemon/src/daemon/daemon.ts` (lines 306-340, 980-996, 1067-...) | daemon 收到 `task.created` 推送；上报 dispatched/running/completed/failed/cancelled |
| S8 | `.trellis/tasks/06-19-channel-task-workspace-optimization/evidence/runtask-smoke-20260624.md` (lines 94-112) | 三个开放问题：running 状态可能跳过、outputMessageId 未回填、token/context 证据不完整 |
| S9 | `.trellis/tasks/06-19-channel-task-workspace-optimization/implement.md` (lines 56-89) | Phase 3/4 待办清单 + 6 个 V3 gate failure codes |
| S10 | `frontend/app/control/integration/page.tsx` | 4 个 gate + per-run timeline（Chinese-first，技术 id 默认隐藏） |
| S11 | `.trellis/tasks/06-19-channel-task-workspace-optimization/multica-task-model-research.md` (lines 1-150) | 设计团队前一份 multica 调研（产品视角，更简短） |
| S12 | `.trellis/tasks/06-19-channel-task-workspace-optimization/clowder-evaluation.md` (lines 1-156) | 设计团队前一份 clowder 评估（产品视角） |

> 本次新报告与 S11/S12 的区别：前两份是产品视角（"借鉴哪些 UX 模式"）；本报告新增 (1) 真实 `multica` 状态机 SQL/service 代码引用、(2) `clowder-ai` store/agent registry/queue 实际形态、(3) SmallKhoj 当前 call-site 与 schema 的对照清单、(4) 针对"channel group task / leader 分配 / direct assignment / 多 agent run / output evidence"五个具体能力的下阶段实现路径。

---

## 3. 对比表

### 3.1 三层模型横向对比

| 维度 | multica | clowder-ai | SmallKhoj (current) |
|---|---|---|---|
| 产品工作项实体 | `Issue` | `Task`（毛线球） | `Task` |
| 状态机 | backlog / todo / in_progress / in_review / done / cancelled | todo / doing / blocked / done | todo / in_progress / in_review / done (+ blocked / cancelled) |
| 运行时执行实体 | `AgentTaskQueue`（独立表） | `Session`（`active→sealing→sealed` chain） | `TaskRun`（独立表） |
| 运行时状态机 | queued → dispatched → waiting_local_directory → running → completed / failed / cancelled | active → sealing → sealed（每次 invocation 一行；多次 invocation 串成 chain） | queued → dispatched → running → awaiting_input → completed / failed / cancelled |
| 多 agent 编排 | `Squad`（leader agent + roster，leader 通过 @mention 派发） | `preferredCats` + `routingPolicy` + A2A `WorklistRegistry` | `TaskAssignment` 表（role 枚举已支持，但 call-site 全是 `role=worker`） |
| Leader 概念 | Squad leader = agent（有 briefing 注入） | 无 first-class leader；`bootcampState.leadCat` + `preferredCats` 间接表达 | 设计文档有 leader/coordinator 模式；schema 有 `role='leader'`；**无 call-site 真正发出** |
| Direct assignment | Issue.assignee 单一 member/agent/squad | Task.ownerCatId 字段（无 claim RPC） | Task.assignee + TaskAssignment.assignee（1 对 1，**无多 agent**） |
| 运行时拉取模型 | **Pull**：daemon 3s poll `POST /tasks/claim` (by runtime) | **Push + 队列**：`InvocationQueue` per-(thread, cat) slot | **Push**：daemon 收 `task.created` 事件即写 runtime |
| 队列/claim 字段 | AgentTaskQueue.claimed_by daemonside、prepare_lease、stale reclaim | `slotKey(threadId, catId)` + fairness gate | `TaskRun.status='queued'` 是唯一信号，**无 claimed_by/claimed_at** |
| 会话恢复 | AgentTaskQueue.session_id + work_dir | Session chain (`seq` + `chainKey` F198) | `workspace_session_id` + `context_session_id` 双字段 |
| 证据/输出 | AgentTaskQueue.result JSONB + TaskMessage + TaskUsage + TaskToken | `EvidenceItem`（独立 memory store，anchor 索引）+ `ThreadArtifact` + `AutomationState` | `output_message_id` 单 FK + `failure_code/reason` + `token_usage` JSONB |
| 自循环守卫 | `IsLeaderTask` 标志 + same-squad / shared-leader 检查 | A2A streak + `MAX_A2A_DEPTH` | **无**；`agent_api.py:2341` 走 leader_delegated 但仍 `role=worker` + `parent_run_id=None` |
| 父/子关系 | Issue.parent_issue_id + stage barrier | Thread.parentThreadId（F128） | **无**；schema 没有 `parent_task_id` / `parent_run_id` 已被 fill 但全为 NULL |
| 评论/mention 派发 | `@agent` / `@squad` → EnqueueTaskForMention / SquadLeader | AgentRouter mention parser + intent | 暂未实现 `@agent` 派发（仅有 task 创建路径） |
| 私有/访问门 | `canAccessPrivateAgent` + `canEnqueueSquadLeader`（agent-to-agent 总是允许；member 需 owner/admin） | `routingPolicy.scopes` 限域 | daemon 端 `resolve_agent` 校验 `agent_id=member.id` |

### 3.2 关键设计抉择

| 抉择 | multica | clowder-ai | SmallKhoj 当前 |
|---|---|---|---|
| **product 状态 vs runtime 状态** | 严格分离（`Issue` 与 `AgentTaskQueue` 不同表、不同生命周期） | 混合（`Task` 包含 AutomationState cursors；session 是独立链） | 严格分离（`Task` 与 `TaskRun` 不同表）— **已对齐 multica 范式** ✓ |
| **leader 选举方式** | 显式：每个 squad 固定一个 leader agent（创建时指定） | 无显式 leader；通过 routing policy + preferredCats 软指定 | 设计上有 `role='leader'`，但**没有"谁是 leader"的存储字段** |
| **拉 vs 推** | Pull（daemon 主动 claim） | Push + slot 队列 | Push（daemon 收 task.created 事件） |
| **多 agent 派发点** | 评论 @mention（用户在产品里看到所有派发） | AgentRouter 解析（mention/intent 推断） | 暂未设计派发点 |
| **证据与任务关系** | 1:n（一个 issue 多个 task；task 自己有 result/usage） | n:n（EvidenceItem 全局 anchor；Task 引用 subjectKey 不引用 evidence） | 1:1（一个 TaskRun → 一个 output_message_id） |
| **批处理** | `pending_batcher` silence-window debounce | `InvocationQueue` slot + fairness gate | 无（每条 task 一个 run） |

### 3.3 我们（SmallKhoj）目前最接近 multica 的部分

- `Task` 与 `TaskRun` 分表（`backend/models/slock.py` lines 259-372）
- `TaskRun` 7 态状态机 + CHECK 约束
- `TaskAssignment.role` 枚举支持 leader/worker/reviewer/participant
- `TaskRun.parent_run_id` self-FK 已建（仅未被填充）
- `context_session_id` 独立于 `workspace_session_id`（`services/task_runs.py:115-118`）

### 3.4 我们已经偏离 multica 的部分（需要在做扩展前决策）

- 没有 claim/queue worker 拉取；没有 `claimed_by/claimed_at`
- 没有 leader briefing 注入
- 没有 `@agent` mention 派发到 task run
- 没有 parent/child 任务链
- evidence 是单 `output_message_id`，不是 bundle

---

## 4. 建议（按 SmallKhoj 五个目标能力分组）

### 4.1 Channel group task

**目标**：在 channel 中创建一个任务，能让多个 agent 协同。

**建议**：
- 直接复用 `TaskAssignment` 表，不新建 group-task 表。Squad / group 是关系型数据，不需要独立实体。
- 创建 task 时通过 `TaskAssignment` 多写几行（每行一个 agent / role），由 `create_task_assignment_and_run` 一次性扩展为 N 个 `TaskRun`（多参数版本）。
- 借鉴 clowder 的 `subjectKey` 思路：task 上加 `subject_key` 字段防止同一 channel 重复创建同主题任务（可选；不强求）。
- **不引入** multica 的 `Issue.parent_issue_id` 字段；保持 message → task → taskRun 的扁平结构；如果需要父子任务，扩展 `tasks.parent_task_id` 即可（schema 改动小）。

### 4.2 Leader 分配

**目标**：人类指派一个 leader agent，让它协调子任务。

**建议**：
- **第一步**（最小可行）：leader 任务真正发出 `role='leader'`，并在 leader 的 `prompt_profile` 注入一段"你可以创建子任务"的 instruction（参考 multica `buildSquadLeaderBriefing` 的 `services/task_runs.py:73-131` 调用点）。
  - 改动：`agent_api.py:2341` 把 `role="worker"` 改成 `role="leader"`，并把 `parent_run_id` 填到被指派 leader 自己的 task（不填，留空）。
- **第二步**：leader 通过新增 endpoint `POST /internal/agent-api/task-runs/{id}/delegate` 创建子 task assignment + child run。child run 写入 `parent_run_id` 指向 leader run。
- **第三步**：防自循环——在 `update_task_run_lifecycle` 完成时检查：若 child run 触发的评论 mention 又落回 leader agent 且 `attempt > 1`，跳过（参考 multica `IsLeaderTask` + `effectiveChildAgentOwner`）。
- **不复制** multica 的 squad briefing 完整模式（Operating Protocol + Roster + Instructions 拼接），Slock 没有 squad 实体；只在 prompt_profile 字段里给 leader 一段简短 instruction。

### 4.3 Direct assignment（多 agent 拖拽式指派）

**目标**：人类把同一任务拖到多个 agent，各自产生一个 run。

**建议**：
- `create_task_assignment_and_run` 增加批量版本：接受 `assignees: list[(member_id, role)]`，循环创建 N 个 `TaskAssignment` + N 个 `TaskRun`，都 `parent_run_id=None`（它们是兄弟不是父子）。
- 任务详情接口聚合所有 `task_assignments` + `task_runs`，UI 在 control/integration 页面扩展一列。
- **保留** `tasks.assignee_id`（人类/主 owner），但仅用于显示与默认排序；运行时派发完全走 `task_assignments`。
- **不要** 仿 clowder 把 `Task.ownerCatId` 当作"主 owner 优先"——我们 `Task.assignee_id` 是历史字段，runtime 派发应忽略它，否则会和多 agent 拖拽冲突。

### 4.4 多 agent run（worker fan-out）

**目标**：一个 leader 任务运行中，能创建 worker 子任务。

**建议**：
- 增量点 1：worker run 的 `parent_run_id` 指向 leader run（schema 已就绪，缺填充）。
- 增量点 2：worker run 的 `context_session_id` 用 `task:{task_id}:role:worker:run:{run_id}`（已是当前格式），并且 leader 与 worker 之间通过 `tasks.id` 共享 task 上下文（`TaskAssignment` 多行）。
- 增量点 3：worker run 完成时，如果它的 `TaskAssignment.role` 是 `reviewer` 或 `participant`，汇总到 leader 的 `TaskRun.context_usage` JSONB（仅"提示性"，不做强约束）。
- **不复制** multica 的 stage barrier（`Issue.stage`）：Slock task 在 channel 上下文里语义更弱，加 stage 会过度形式化。
- **不复制** clowder 的 `MAX_A2A_DEPTH` 硬限：Slock 的 fan-out 由人类拖拽和 leader 显式 delegate 决定，不需要深度限制器——只防自循环。

### 4.5 Output evidence（输出证据）

**目标**：一个 TaskRun 的输出不只是一条 message id，而是 bundle。

**建议**（按改动量递增）：
1. **最小**：把 `output_message_id` 改名为 `output_message_ids TEXT[]`；允许一个 run 关联多条消息（多轮 reply、continuation、status update）。
2. **加 JSONB**：`output_attachments JSONB` 记录附件 / 文件 / 外部链接列表。
3. **加 evidence 表**（如果团队觉得必要）：`task_run_evidence(id, run_id, kind, anchor, content_path, source_hash, created_at)`，与 clowder 的 `EvidenceItem` 类似但挂在 run 上。
4. **回填**：daemon 在 `reportTaskRunLifecycle(status='completed')` 之前，确保 `activeTaskRunId` 关联的消息 id 写入 `output_message_ids`（修复 S8 提到的 `outputMessageId` 缺失问题）。
5. **token/context 证据补齐**：`token_usage` 当前只有 `source: 'provider-stream-json'`，缺 `inputTokens/outputTokens/cacheRead/cacheWrite`；`context_usage` 缺分母（max context window）。S9 列在 V3 gate 失败码里 (`TASK_RUN_CONTEXT_USAGE_MISSING` / `TASK_RUN_OUTPUT_MISSING`) 的两个码，正好对应这两类缺口。
- **不复制** multica 的 `TaskMessage`（per-tool-call event 流）：Slock daemon 已经有 runtime session JSONL 做 trace，不重复持久化。
- **不复制** clowder 的 `EvidenceItem` anchor 全局索引：Slock 的证据应当与 run 强绑定（短期）；如果未来要支持跨 run 检索，再升级到 anchor。

---

## 5. 风险 / 待验证项

| # | 风险 / 待验证 | 影响 | 缓解 |
|---|---|---|---|
| R1 | leader 真正发出 `role='leader'` 后，daemon prompt_profile 是否会因"leader 上下文要求更高"而触发更多 token 消耗？ | 成本 | 在 `services/task_runs.py:115-118` 的 `context_summary` 字段加一个 `expected_role_tier` 标记，做运行时观测 |
| R2 | 批量创建多 assignment 时，如果其中部分 agent 没有 ready workspace，run 会以 `status='queued'` 滞留。是否需要新增 `claimed_by/claimed_at` 做最小 claim？ | 多 agent 拖拽可用性 | 短期：复用现有 `runtime_workspace_id IS NULL` 判定逻辑；中期：增加 `claimed_by TEXT` + `claimed_at TIMESTAMPTZ` 字段，daemon 启动时扫描 claim 5 分钟前的 stale queued run |
| R3 | `output_message_ids[]` 改名是否会破坏现有 `output_message_id` 单字段下游读取（特别是 control/integration 页面）？ | UI 兼容性 | 保留 `output_message_id` 一段时间（双写：写入时同时填 `output_message_id = output_message_ids[0]`）；UI 迁移后删除旧列 |
| R4 | `parent_run_id` 链的查询模式尚未在 `TaskListSerializer` 之外实现；如果产品要从"per-task 视角"展示，需要聚合查询。 | API 性能 | 短期不实现 parent chain 聚合；UI 仍按 `task.id` 展示。后续用 `WITH RECURSIVE` 或物化视图 |
| R5 | multica 的 `CanEnqueueSquadLeader` / `CanAccessPrivateAgent` 表明多 agent 编排有"私有 agent"门控。Slock 的 agent 现在是 member 派生，没有 private 概念。 | 安全模型 | 暂不引入；等 SmallKhoj 出现 multi-tenant workspace 后再设计 |
| R6 | clowder 的 `WorklistRegistry` 暗示 A2A 共享 AbortController / depth budget。Slock daemon 的 runtime 是 Claude/Codex CLI，深度 fan-out 可能撞 context window。 | 运行时稳定性 | 在 leader prompt 里显式约束"不要无限递归 delegate"，并在 `update_task_run_lifecycle` 加 `attempt > 3` 强制失败 |
| R7 | 三个项目对"evidence"语义差异很大：multica 把它当 run 输出，clowder 把它当全局知识，SmallKhoj 当前只有 message id。改名 / 加表都需要 backfill 与前端同步。 | 数据迁移 | 优先做"双字段 + 双写"，不立即破坏性改动 |
| R8 | 当前 `_prompt_profile(role)` 的取值集合未在 S2/S3 完整列出（仅在 `services/task_runs.py:115` 提到），需对照 `prompt_profiles` 表确认 leader/worker/reviewer/participant 是否都有对应 profile。 | 配置完备性 | 在 backend 增加 `prompt_profiles` 表的 seed 校验，leader 角色必须有 profile，否则启动报错 |
| R9 | 现有 PRD（prd.md lines 188-224）"Open Questions"已列出 8+ 待决项，本报告未逐一对照——实现时需先关掉其中阻碍 leader/direct-drag 的项（如 leader 失败后是否需要自动 reassign） | PRD 完备性 | 建议把"Open Questions"中与本报告 4.1-4.5 直接相关的 3-4 项升级为必答项 |
| R10 | 三份调研（multica / clowder-evaluation / 本报告）目前都没有涉及 Slock daemon 在 `runtask` 模式下的 resource cap / rate limit / token budget 控制。运行时过多 fan-out 可能击穿 daemon | 运行时安全 | 在 V3 gate 之外，加一个"任务预算 gate"：每个 task 在创建时打 `budget_tokens`，每个 run 上报累计消耗，超额则 fail |

---

## 6. 结论与下一步

按 ROI 排序，本报告建议的落地顺序：

1. **真发 `role='leader'` + `parent_run_id` 链**（改动小，PRD 早定义，schema 就绪）。预期 1-2 天。
2. **`create_task_assignment_and_run` 批量版本**（多 agent 拖拽）。预期 1-2 天。
3. **`output_message_ids[]` + output 回填**（修复 S8 中三个开放问题的两个）。预期 1 天。
4. **V3 gate 6 个 failure codes 落地**（implement.md 已列）。预期 1-2 天。
5. **`@agent` mention 派发**（多 agent 协同的最后一公里）。预期 2-3 天。
6. **`evidence_entries` 表**（可选；如果 3 之后 product 反馈"证据不够"再做）。预期 2 天。

每一步都应保持：① 不破坏现有 TaskRun lifecycle 7 态机；② 不改写 daemon 与 runtime session 模型；③ 新增字段都填默认值，向后兼容；④ 同步在 `frontend/app/control/integration/page.tsx` 加可视化（runRole chip、parent/child 缩进、output bundle 列表）。

---

*End of report — 12 源文件已逐一引用，5 个目标能力均给出实现路径，10 条风险/待验证项已分类。本报告不修改除自身之外的任何项目代码，符合任务交付要求。*
