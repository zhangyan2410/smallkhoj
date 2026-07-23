# 2026-07 codebase audit remediation program

## Goal

将 2026-07 独立复核确认的真实缺陷修复到可安全合入和部署的状态，并以真实数据库、并发、运行时、分页、CI、构建和 UI 证据证明完成；产品方向项必须得到明确处置，不能用“已有 plan”冒充已实现。

## Authority

- 原始证据：父任务 `07-20-07-19-codebase-audit`。
- 独立 verdict：`research/2026-07-22-independent-verification.md`。
- 当前仓库、修复分支 diff、测试与运行结果高于 advisor 自述、旧 `DONE`/`APPROVED` 标签和文档状态。
- advisor 分支只能作为候选实现和反例来源；不得整批信任或机械合并。

## Requirements

### R1 — Schema and destructive-write integrity

- 修复 003b/004 的旧库 Alembic 接入、`messages.seq` identity sequence 对齐、迁移顺序和 `create_all`/Alembic 双真相源问题。
- 修复 009 的 Task 删除后 ActivityLog/EventRecord 外键失败，并保留可理解的删除审计 tombstone。
- 迁移和删除契约必须由真实 PostgreSQL 测试覆盖，不接受 fake session 或只用 `Base.metadata.create_all` 的替代证明。

### R2 — Authentication, authorization, and tenant isolation

- 修复 002 的 public API key 配置链、默认凭据、WebSocket URL 凭据暴露和 permission 语义。
- 修复 012 的 impersonation 防护，同时保留 display name、`@name`、UUID 三种合法 viewer 自引用。
- 修复 013 的并发首次注册双 owner 风险，建立数据库可证明的不变量。
- 修复 014 的 builtin 创建权限、legacy NULL 模板可见性、tenant-local slug 和跨租户 IDOR 边界。
- 为 auth/public-key/tenant 边界建立直接 contract tests，不以旁路单元测试代替。

### R3 — Runtime, resource, query, and pagination contracts

- 完成 005 的 reply-count/member/workspace 批处理，达到有断言的 query-count 预算，并收敛 public/agent serializer shape 漂移。
- 完成 015 的 ingress、内存和磁盘资源上限；临时文件必须可清理，拒绝路径必须可观测。
- 完成 016 的 NOTIFY 连接复用、断线恢复和连接预算。
- 修复 017，使所有 SSE 路径在流存活期间不持有 request-scoped DB session。
- 修复 018 的跨 channel 稳定游标、前端 `nextCursor` 消费和 thread filter-before-limit 语义。
- 收敛 022 的双 SSE/页面级全刷新，使事件订阅拥有一个明确的连接和状态所有者。

### R4 — Delivery gates and browser-visible behavior

- 修复 019，使仓库提供的 CI 定义在干净环境中真实可绿；Ruff baseline 和 production build env 必须显式、可复验。
- 保持 020 已验证的 Bun 单 lockfile 和真实 `ws` 依赖，不回归到多 package manager 状态；同步 frontend README。
- 完成 021/022/009 等可见行为的 `./twd` 验收，包括 loading/error、targeted refresh、Task/File 删除确认与结果。
- 修复 023 的 e2e 登录/session/server context/API key 注入；不能把认证漂移的 suite 标为 canonical。
- repo UI 验收只使用项目 `./twd` wrapper；不以 Playwright 代替仓库可见 UI 验收。

### R5 — Confirmed architecture debt

- 为 TDA-01、TDA-03、TDA-05/FRONTEND-01、TDA-06、FRONTEND-05 建立保行为重构：拆分巨型 router/client、统一重复 helper/serializer、明确前端状态所有者。
- 重构必须先有 characterization tests 和可量化边界，不因“文件变短”改变 API/schema/runtime 行为。
- DEP-01 以 ADR 明确 auth 与 public control-plane 边界。

### R6 — Product-direction dispositions

- 006–011 中的方向项分别得到 `integrate existing task`、`implement after explicit decision`、`defer with rationale` 或 `reject as not required` 的明确处置。
- 007 session observer、008 durable Work Item、011 remotion 优先复用现有 Trellis task，不重复创建平行真相源。
- 010 `/control/*` 信息架构等价值选择在编码前取得 maintainer 决策。
- 方向项未获产品决策时不得记作“已修复”，但也不得与真实 bug 混在同一完成统计中。

### R7 — Integration truth and documentation

- 所有修复基于同步后的 `main` 在 sibling `feat/*` worktree 中实施；不修改当前 dirty main。
- 解决 005/018 等真实组合冲突，并在同一候选上运行完整数据库、backend、frontend、build、runtime 和 UI 门禁。
- 更新人类中文报告、技术报告、计划索引、`DESIGN.md` 和 migration 文档，使“advisor 分支”“组合候选”“main”状态可区分。
- 不 stage、commit、push、移动或删除与本任务无关的 `MEMORY.md`、`session-observer/`、其他 task/spec WIP。

## Acceptance Criteria

- [ ] 12 个 `REVISE` plan 全部在子任务中有 confirmed root cause、失败测试、修复 commit 和通过证据，独立复核 verdict 可提升为 `APPROVE` 或有新证据支持的明确替代处置。
- [ ] 004/003b 在真实 PostgreSQL 上覆盖 baseline、已有历史 seq、过渡期显式写入、切换自动写入和并发自动写入；迁移后第一条自动消息不冲突。
- [ ] 009 通过真实 PostgreSQL route/AsyncSession 测试，删除 Task 后事务提交成功，审计记录保留 tombstone 且无悬空 FK。
- [ ] 002/012/013/014 的 auth、并发 owner、合法自引用和 tenant isolation adversarial matrix 全绿。
- [ ] 005/018 有 query-count、跨 channel cursor、前端翻页和 filter-before-limit contract tests，无重复或漏项。
- [ ] 016/017/022 有连接生命周期证据：活动 SSE 不占 request DB session，断线可恢复，页面不建立无主重复连接。
- [ ] CI-equivalent backend pytest/Ruff、frontend tests/lint/typecheck/frozen install/production build 在干净修复候选上全绿。
- [ ] 所有用户可见变更都有 `./twd` DOM/network/screenshot 或 marker 证据，且测试目标明确指向修复 worktree 实例。
- [ ] 架构重构完成后公共 API、JSON shape、数据库 schema 和运行时行为由 characterization/regression tests 证明未漂移。
- [ ] 006–011 每项有明确产品处置；任何待决项均有单一决策问题、推荐项和影响，不以 TODO 隐藏。
- [ ] 完整组合候选无未解决 merge conflict，`git diff --check`、Trellis validate 和项目质量门禁通过。
- [ ] 文档只把已进入对应分支/main 且有证据的修复写成已完成。

## Out of Scope

- 不借审计修复重写产品、替换框架或创建与 finding 无关的新功能。
- 不迁移或删除其他 task 的用户 WIP。
- 不对共享/生产数据库执行迁移或破坏性探针。
- 不把错误/过时 advisor 分支整体合并后再“边测边猜”；每个可复用 commit 都必须逐 hunk 复核。

## Current Start Gate

代码实施需等待以下 worktree 前置条件：

1. 明确授权处理并 push 当前 `main` 的 `47848e8`；
2. 修正并提交本次审计相关 docs/task，使 `docs/` clean；
3. `main` 与 `origin/main` ahead/behind 均为 0；
4. 创建 sibling remediation worktree 后再激活本任务/子任务。
