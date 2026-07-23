---
title: SmallKhoj codebase audit 2026-07-19
status: independent-review-planning
created: 2026-07-20
audit_date: 2026-07-19
audited_commit: 47848e8
---

# SmallKhoj codebase audit 2026-07-19

## 当前阶段：独立复核（2026-07-22）

原始审计及执行者自述不是本阶段的完成证据。用户要求独立判断：原始 finding 是否属实、各执行分支是否真正解决问题、组合合并后是否仍然正确；静态证据或现有测试不足时，允许补写最小验证测试。

### 目标

以当前仓库、20 个 advisor 分支及真实组合结果为权威证据，交付一份可追溯、可复验的中文结论，而不是复述既有 `DONE` / `APPROVED` 状态。

### 复核要求

1. 覆盖 `plans/README.md` 中 001–023 的全部条目，包括拆分后的 003a/003b、已执行项、未执行方向项和旧 003 的 BLOCKED 状态。
2. 对每个原始 finding 独立检查基线代码，判定为属实、部分属实、证据不足、误报或已漂移。
3. 对每个声称已完成的执行分支，检查 plan-vs-diff、测试质量、范围漂移和回归风险；不得仅以“测试通过”作为正确性证明。
4. 建立 `finding → plan → commit/diff → test/runtime evidence → verdict` 追踪矩阵。
5. 在隔离合并环境中按真实依赖顺序组合所有拟合入分支，记录实际冲突、冲突解决和组合回归；不得修改用户当前 `main` 工作区。
6. 对安全、迁移/`messages.seq`、SSE/连接池、上传限额、分页/N+1 等高风险契约做针对性验证。
7. 只有当关键结论缺少直接证据时才新增测试；新增测试先证明它能暴露缺陷或覆盖缺口，再用于验证修复，并明确记录测试归属。
8. 核对中文报告、技术报告、计划索引、`DESIGN.md`、`docs/migration-workflow.md` 与实际分支/当前 `main` 的状态一致性。

### 验收标准（独立复核）

- [ ] 全部计划均有独立 verdict：`APPROVE`、`APPROVE WITH DEPENDENCY`、`REVISE`、`REJECT`、`NOT IMPLEMENTED` 或 `SUPERSEDED`。
- [ ] 每个 verdict 至少有代码 diff/当前文件、测试或运行结果、依赖/合并状态三类证据中适用的证据；不适用项有理由。
- [ ] 所有高风险安全 finding 均复查授权边界和旁路，不只检查 happy path。
- [ ] Alembic/IDENTITY 与 003b 的部署顺序通过迁移文件、模型、调用点和隔离验证闭环证明。
- [ ] 真实组合分支能够完成后端测试和前端规定门禁，或准确列出阻断合入的问题和复现命令。
- [ ] 报告明确区分“分支中已修复”“组合候选中已修复”“当前 main 已修复”，避免把未合入代码写成线上现状。
- [ ] 新增验证测试（若有）有失败前证据、通过后证据，并且不改变生产行为。
- [ ] 最终中文报告列出误报、漏报、错误修复、不完整修复、文档漂移、剩余风险和建议合并顺序。

### 范围边界

- 本阶段默认是审计与验证，不直接把 advisor 分支合入 `main`，不提交、不 push、不部署。
- 不清理当前未提交/未跟踪文件，不处理未 push 的 `47848e8`。
- 为证明审计结论而补的测试只在隔离工作树或明确的审计分支中进行；生产修复另立/续接对应 Trellis 实现任务。

## 背景

用户提问"审计一下当前项目代码哪些需要优化"，并指出已知问题"SQL 迁移还没做，目前用的还是 ALTER"。用 `improve` 技能做了一次只读全量审计（9 大类），然后把选中的 finding 写成自包含执行计划（`plans/`），派发执行子代理到隔离 worktree 实现，主代理独立复核后给 APPROVE / REVISE / BLOCK 判决。

## 完整审计报告

**[research/2026-07-19-codebase-audit.md](./research/2026-07-19-codebase-audit.md)** 是这份任务的单一真相来源。包含：

- 速查表（30+ finding，ID / 类别 / 根因一句话 / 状态）
- 用户已知问题的真正根因（SQL 迁移 → 深挖出 `Message.seq autoincrement=True` 多年不工作 + 两套 schema 源打架）
- 并发风险专题（6 个并发相关 finding）
- merge 清单与依赖（10 个 worktree HEAD、依赖图、部署注意、checklist）
- 详细 finding 根因（每个 DONE plan 的根因 + 证据 file:line + 修复方式）
- 执行过程中的 deviation 记录（5 次执行者正确 STOP + reviewer 判决）
- 未解决问题（按优先级排序，20 个未修 finding）
- 维护说明

## 验收标准（audit 任务本身）

- [x] 审计覆盖 9 大类（correctness / security / performance / tests / tech-debt / deps / DX / docs / direction）
- [x] 每个 finding 有 `file:line` 证据（非臆测）
- [x] 用户已知问题（SQL 迁移）的根因被深挖并记录
- [x] 并发风险被单独整理成章节
- [x] 审计报告归档到 Trellis 任务目录（本任务）

## 修复进展（2026-07-19 ~ 2026-07-20）

10 个执行计划 APPROVED，等 merge。每个计划在 `plans/NNN-*.md`（自包含，弱执行者也能照做）。状态汇总见 `plans/README.md`。

| Plan | Finding | HEAD |
|------|---------|------|
| 001 | TEST-01 pytest baseline | `c910178` |
| 002 | SECURITY-01~05, 08 P1 安全批量 | `49620ac`（6 commits）|
| 003a | CORRECTNESS-02 scheduler 日志 | `e0ba3b4` |
| 003b | CORRECTNESS-01 seq race 移除 | `050a624` |
| 004 | TEST-03 Alembic + IDENTITY | `8962df8`（7 commits）|
| 005 | PERF-01, 03 序列化器 N+1 | `5a6fcd3`（3 commits）|
| 012 | SECURITY-03 impersonation | `f35c339`（2 commits）|
| 013 | SECURITY-06 auth default role (Option B) | `8da5c3e` |
| 014 | SECURITY-07 TaskRunTemplate IDOR | `f70f1e0`（3 commits）|
| 015 | SECURITY-09, 10 upload streaming | `da0aee7` |

**部署关键约束**：004 必须先部署且 `alembic upgrade head` 跑过，才能上 003b（否则消息发送 NOT NULL violation crash）。docker-compose 已配好启动时自动跑迁移。

## 仍未解决（下一轮 Trellis 任务的候选）

详见审计报告"未解决问题"章节。按优先级：

### 🔴 高优先级（建议优先立 Trellis 任务）

1. **PERF-02** — SSE `/events` 占请求级 session + engine pool 默认 5。**当前最大并发瓶颈**。>5 个 agent 同时在线 → 整个后端 DB 阻塞。
2. **PERF-03** — Postgres NOTIFY 每事件开新 asyncpg 连接，绕过池。与 PERF-02 配合修。
3. **DX-02** — 无 CI / Makefile / 统一 test 命令。每次改动无自动门。
4. **TDA-01** — `public_api.py` 4617 行 + `agent_api.py` 4144 行。安全 bug 正是埋在巨型文件里才没被发现。
5. **TEST-02** — `routers/auth.py` 和 `verify_public_api_key` 零直接覆盖。

### 🟡 中优先级

TDA-04（死代码 useChatWebSocket）、DX-01（三 lockfile 收敛）、DX-03（前端 test script）、DX-04（typecheck/lint）、TDA-02（前端 code-splitting）、FRONTEND-02（loading/error 边界）、FRONTEND-03（realtime refresh）、DOCS-02（Playwright 自相矛盾）。

### 🟢 低优先级

TDA-03（feishu 去重）、TDA-05/FRONTEND-01（channel-client 拆分）、TDA-06（serializer shape 收敛）、DEP-01（auth ADR）、DOCS-01（README 对齐）、PERF-04（分页 cap）、FRONTEND-05（状态机合并）。

### 🟡 Direction（产品决策，需 maintainer 拍板）

plan 006-011：DESIGN.md 对齐 / session-observer 集成 / Work Item 队列 / Tasks+Files DELETE / `/control/*` 路由 / remotion 决断。

## 维护说明

- **merge 一个 plan** → 更新审计报告的 "merge checklist" + 速查表状态
- **发现新 finding** → 追加到审计报告"未解决问题"，按格式记录
- **修复一个未解决问题** → 移到"详细 finding 根因"对应章节
- **下次审计**：直接读审计报告 + `plans/README.md` 就知道上次发现了什么、修了什么、还剩什么，避免重复审计
- **新立 Trellis 任务时**：在子任务的 PRD 里引用本任务（`parent: 07-20-07-19-codebase-audit`），保持追溯链
