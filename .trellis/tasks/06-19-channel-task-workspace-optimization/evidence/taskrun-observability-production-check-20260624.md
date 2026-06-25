# TaskRun observability production check — 2026-06-24

**Slock task**: #5 (`REAL_RUNTASK_OBSERVABILITY_20260624211222`)
**Channel**: #33
**Assignee**: @REAL-runtask-20260624210714-agent-basic
**Marker**: REAL_RUNTASK_OBSERVABILITY_20260624211222

## 1. 当前 TaskRun gate 能证明什么

### 数据面（backend/services/task_runs.py + agent/daemon/aaa-daemon/src/daemon/daemon.ts）

- **7 态状态机**：`queued → dispatched → running → awaiting_input → completed/failed/cancelled`，由 `TASK_RUN_STATUSES` 强校验；serializer 把 `progressState/progressLabel` 推给前端（task_runs.py:14, 273-289）
- **双源证据**：daemon 上报 lifecycle（POST `/internal/agent-api/task-runs/{id}/lifecycle`），token 优先从 Claude Code session jsonl 的 `message.usage` 读，避免 Anthropic-compat adapter（MiniMax 报数 2-8x 膨胀）的污染（daemon.ts:903-938, 2156-2191）
- **Warmup gate**：runtime 启动注入 `[event=system.warmup]` probe，必须成功调一次 `slock` tool 才翻 `'starting'→'running'`；超时 degrade 而非永久 starting（daemon.ts:840-882, 1490-1509）
- **4 态活动时间线**（Working/Thinking/Output/Idle）通过 `/internal/agent-api/activity` 上报，warmup 完成前不发，避免启动风暴（daemon.ts:955-1046）
- **12 种 evidence_issues**：`TASK_RUN_WORKSPACE_MISSING / RUNTIME_NOT_READY / OUTPUT_MISSING / TOKEN_USAGE_MISSING / CONTEXT_USAGE_MISSING / TOOL_USAGE_MISSING / RUNTIME_STALL_TIMEOUT / RUNTIME_RESULT_MISSING` 等（task_runs.py:252-270）

### 展示面（frontend/app/control/integration/page.tsx）

- **4 个静态 gate**：Daemon 连接 / Runtime 就绪 / TaskRun 证据 / 用量与上下文，state pass/warn/fail/idle（page.tsx:362-408）
- **时间线只显示人类可判断的阶段和证据**，session id/完整 uuid 默认隐藏；详情可展开（page.tsx:479-560）
- **指标卡**：任务数 / 进行中 / 上下文风险（occupancy ≥50% 计数）（page.tsx:745-749）

### 本次运行的硬证据

- 任务 #5 状态 = todo / 1 run 进行中
- Mac-mini.local daemon online，agent `REAL-runtask-20260624210714-agent-basic` runtime=claude_code model=MiniMax-M3 status=running session=`3b695236-cdd2-4bc2-a803-24298517626e`
- 历史任务 #3 / #4：`completed` 但 `evidenceIssues=4`（output/token/context/tool 全缺）→ 验证了"完成态证据缺失"的已知缺口

---

## 2. 当前仍缺什么

1. **完成态证据缺失无强制收尾**：历史任务 #3 / #4 都 `completed_missing_evidence`（output/token/context/tool 4 类全缺），gate 只 warn 不阻塞，run 静默停在「完成但没证据」
2. **多角色仅 schema 就绪**：`role='leader'/'reviewer'/'participant'` 在 `_prompt_profile` 有映射（task_runs.py:39-46），但 control plane 没真实派发，serializer 还没在 RunRow 之外暴露 leader chip
3. **parent_run_id / output_message_ids[] 未填**：schema 字段有（task_runs.py:99-127），但 call-site 没接，leader→child run 链断
4. **failure_code 不进 gate**：daemon 会上报 `failureCode/failureReason`（RUNTIME_EXITED / RUNTIME_ERROR / RUNTIME_STOPPED，daemon.ts:1108-1169），但 4 gate 没把 failure_code 反映到 state，只到 warn
5. **evidence_entries 表未建**：现在是 `evidenceIssues: string[]`（task_runs.py:330），不可回填、不可审计
6. **@agent mention 派发未接**：channel 里 `@agent` 仅是显示文本，没触发 claim
7. **runtimeProvider 现状**：本次 agent 用默认 MiniMax-M3（`runtimeProvider: null`，`backend: null`）；detected runtimes 列表展示了 cc-switch 提供的多个 provider，但 start_runtime 仍未通过 `runtimeProvider` 显式选型（runtime-slock-integration.md:441-505）

---

## 3. MiniMax / Claude Code warmup + context 获取风险

来自本次启动的 `smallkhoj-trace` 实时观察 + daemon.ts 源码：

1. **PATH 顺序陷阱（实测触发）**：`/Users/lee/.npm-global/bin/slock` 在 PATH 里早于项目 wrapper `.slock/slock`，warmup 阶段全局 slock 没有 `SLOCK_AGENT_PROXY_TOKEN_FILE` env，直接报 `MISSING_TOKEN`。本次启动 trace 留有完整证据：runtime 第一次 `Bash("slock server info")` → tool_result error → 之后才走 wrapper 路径。生产环境下应该 fail-fast 而不是让模型自己重试
2. **warmup 检测依赖 Bash+regex**：daemon 用 `(name === 'Bash' && /\bslock\b/.test(cmd)) || /slock/i.test(name)`（daemon.ts:863）。MiniMax 倾向先输出 thinking 再决定工具，如果它把 `slock server info` 包装成自定义工具名（不含 slock 字符串），warmup 永远 pending，直到 120s timer degrade
3. **thinking_tokens 风暴**：trace 显示每次启动先吐 4–7 条 `system/thinking_tokens`（estimated 8→106），然后才到 tool_use。这些 thinking 不算 warmup 证据，会让 runtime 在 `starting` 停留较久；本次 runtime 在 ~13:07:50–51 thinking 阶段就吃了 5+ 条
4. **session 抓取时序**：本项目用了 cat_cafe 三入口 skill，hook_response 在 init 之前到达（trace order 17 vs 23），导致前几条 user-message 可能缺 `session_id`。daemon 后续 user-message 必须先 omit 再补，链路脆弱
5. **contextWindow 多源 fallback 链**：`runtime_usage_event.used` → `resultData.size` → `providerUsage.contextWindow`（daemon.ts:941-953, 2106-2118）。MiniMax 不报 contextWindow 时 occupancyRatio 一直 undefined，control plane 「上下文风险」卡 0
6. **provider cache_read inflation**：daemon 用 session-jsonl 兜底（daemon.ts:903-922），但只在 result 事件触发；多次 tool_use 之间的中间态 cache_read 仍以 provider 报数为准，trace 字段不一致
7. **多 runtime scope**：本次单 runtime 没问题，但 prompt profile 的 task scope 还没真正触发（worker/leader/reviewer/participant 4 profile 都有，但 channel 任务创建仍走 task.worker，task_runs.py:39-46 + frontend runRole 映射）

---

## 4. 下一步 channel taskrun 产品模型建议

### A. 修 warmup 链路（紧急）
- daemon 启动时检查 `$PATH` 第一个元素是否是当前 wrapper 目录；否则 prepend 并 `exec` 自己，从根上消掉 MISSING_TOKEN
- warmup probe 改成强制 MCP 风格（`mcp__slock__server_info`）而不是依赖 Bash+regex，避免 MiniMax thinking-first 路径
- warmup timer 默认 120s 偏长，建议按 runtime 类型分流：MiniMax 90s、Claude native 30s

### B. 完成态证据强校验（高 ROI）
- serializer 把 4 类缺失直接合并成单个 `TASK_RUN_EVIDENCE_INCOMPLETE` failure_code
- control plane gate 加第 5 个「证据完整性」gate：completed 但任一缺失 → fail（不是 warn），任务不能进入 in_review
- 控制面在 timeline 显式展开"已记录但未回填"的差异，而不是把所有 missing 都混成 missing_evidence

### C. 多角色 channel taskrun
- TaskAssignment 加 `leader` 真实派发：channel 里 @agent 由 leader 拆分 → child run parent_run_id 链
- serializer 暴露 `runRole` chip（已有 `runRole(promptProfile)`），control/integration 时间线把 child run 缩进展示
- `output_message_ids[]` 多输出支持：worker 输出多条消息而不是单点

### D. 证据持久化
- 新建 `evidence_entries(run_id, kind, payload, source, recorded_at)`，替代 `evidenceIssues: string[]`
- 允许 session-jsonl / usage_event / tool_result 三类来源回填，写完触发 run serializer 重新评估

> 后续讨论修正（2026-06-24）：
> 这条不作为当前实现方向。runtime activity 不应新增独立入库表；本轮选择是保留 trace/ActivityLog 风格的运行时活动证据，并只在现有 TaskRun 上回填 `tokenUsage`、`contextUsage`、`toolUsageSummary`、`outputMessageId` 等可聚合摘要。若以后需要审计型 evidence 表，必须先重新讨论产品语义，不能把 runtime activity 原样入库。

### E. gate V3（替换当前 4 静态 gate）
- Worker ready / Leader appointed / Evidence complete / Cost sane（usage_suspicion）/ Safety / Stall
- 把 `failure_code` 暴露在 gate detail，前端 RunRow 一眼能看
- 给每个 gate 加 trend（最近 N 次 run 的同 code 计数）

### F. 跨 run 上下文
- `slock memory context` 已带进 system prompt（trace 可见 `## Slock Memory Context` 段），下一步写入 TaskRun.context_summary，让控制面能看到本次 run 用到了哪些 channel/task memory
- task context scope 真正激活：task scope 的 memory 进入 prompt 而不是只塞 worker 默认 profile

### G. provider / runtime 选择
- 把 `runtimeProvider` 提升为 agent 创建时的必填选项，而不是允许 `null` 落回默认；当前 `MiniMax-M3` 是 default fallback，但这次观察到 MiniMax 报数膨胀严重
- control plane 列出 `usage_provider_inflated` 风险指标：provider cache_read > session * 2 时高亮，并提示用户切换到 native Claude

---

## 参考文件

- backend/services/task_runs.py:14, 73, 134, 209, 252, 273, 292（状态机 + serializer + evidence_issues + progress_state）
- agent/daemon/aaa-daemon/src/daemon/daemon.ts:840-882（warmup gate）, 940-953（usage_event → contextUsage）, 1011-1044（result → lifecycle report）, 1490-1509（warmup timer degrade）, 1549-1585（reportTaskRunLifecycle）, 1108-1169（runtime exit/error → failure_code）
- frontend/app/control/integration/page.tsx:362-408（buildGates 4 gate）, 134-185（issueLabel 12 issue）, 479-560（RunRow timeline）
- .trellis/spec/backend/runtime-slock-integration.md:1-200（runtime contract, daemon control command, event normalization, runtime provider）
- 现场 trace：warmup probe → Bash("slock server info") → MISSING_TOKEN → wrapper 路径回退，已记录在 daemon log + `.dev-logs/`

---

## 报告发送状态

- 尝试通过 `slock message send --target "#33"` 发送完整报告到 #33
- 本次发送过程中 proxy 路径持续返回 500（`/internal/agent/{id}/send` 路由），与 daemon 心跳 401 同源（机器 API key 与 backend DB 状态不一致）
- 报告本体已落盘到本 evidence 文件，下游 reviewer 可直接读取
- 任务 #5 即将改为 in_review，标注"report saved to disk; proxy send 500 during send"
