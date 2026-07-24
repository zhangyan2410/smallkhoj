# SmallKhoj 代码审计报告 — 2026-07-19

> **历史审计方法**：`improve` 技能（只读审计 + 自包含执行计划）。审计提交 `47848e8`，9 大类覆盖（correctness / security / performance / tests / tech-debt / deps / DX / docs / direction）。
> **历史执行方式**：每个 finding 写成 `plans/NNN-*.md`，advisor 子代理在隔离 worktree 实现并自报状态。2026-07-23 的独立复核证明，原 `DONE`/`APPROVE` 不能当作集成或发布事实。
> **当前维护规则**：先读下面的 current-candidate overlay；其后的 2026-07-19 advisor 状态、merge 清单和“已修/未修”文字仅保留为历史基线，不再作为当前真相源。

## Current-candidate overlay — 2026-07-24

### State and release ordering

```text
branch: feat/2026-07-audit-remediation
location: local remediation worktree only
not yet: clean-candidate commits / PR / squash merge / main / deploy / release

required order:
  local code + production-shape + critical UI validation
  -> precise commits
  -> rebuild from the clean candidate SHA + formal capacity/full gates
  -> PR + squash merge
  -> linux/amd64 build and deploy from merged code
  -> validate the newly deployed cloud version
```

The current cloud deployment contains older images. It must not be tested or
benchmarked as evidence for this candidate.

### Approved important-bug scope

Included:

- security, authentication and tenancy boundaries;
- schema/data consistency, transactions and concurrency races;
- PostgreSQL connection budget, SSE, `LISTEN/NOTIFY`, pagination and cleanup;
- upload/delete boundaries;
- CI, Docker images and delivery blockers.

Excluded from this release: broad Router extraction, `ChannelClient`
decomposition, chat-state-owner consolidation, observer integration, durable
Work Item and `/control/*` route redesign.

### Candidate status by workstream

| Workstream | Direct candidate status | Remaining release work |
|---|---|---|
| schema-integrity | implemented locally; focused gates passed | clean candidate, final full gate, commits, merge |
| auth-tenancy | implemented locally; focused gates passed | clean candidate, final full gate, commits, merge |
| runtime-querying | implemented locally; focused gates passed | formal 30-minute Caddy capacity, full gate, commits, merge |
| delivery-ui | local Caddy smoke and critical `./twd` evidence passed | precise commits, capacity/full gate, PR/merge |
| cloud release | current candidate not deployed | post-merge amd64 deploy, then new-cloud validation |

Plan 003a is repaired in the current candidate even though the advisor commit was
not in its ancestry. The accepted behavior is scheduler exception logging,
capped exponential backoff with success reset, and daemon send-failure logging.
Focused evidence: RED `5 failed, 50 passed`; GREEN `55 passed`; Ruff passed.
Diagnostic: `docs/bug-report/scheduler-loop-silent-failure/bug-report.md`.

Two additional delivery blockers were found and guarded:

1. The repository-root `.dockerignore` recursively excludes dotenv files while
   retaining examples, so a backend build with repository-root context cannot
   silently include a local `backend/.env`. Diagnostic:
   `docs/bug-report/backend-image-secret-context/bug-report.md`.
2. Production frontend image builds continue to inject the public key through a
   BuildKit secret but disable build-layer cache reuse. Secret contents are not
   cache keys, while Next embeds the key in browser assets; a cached layer could
   retain the prior deployment key. The no-cache rebuild restored successful
   local registration. Diagnostic:
   `docs/bug-report/frontend-public-key-build-cache/bug-report.md`.

`docs/migration-workflow.md` exists in the current candidate. `DESIGN.md` is
still the stale old version; Plan 006 did not rewrite it in this candidate.

### Critical local UI evidence

Marker: `REAL_audit_delivery_ui_20260723235900`.

Environment: disposable `local-prod` stack through Caddy at
`http://127.0.0.1:19081`. The run did not access or modify the older cloud
deployment.

- new Better Auth signup/session, active Server, member and owner membership;
- 201 Task fixtures crossing the `limit=200` cursor into a second UI page;
- one physical SSE invariant;
- `task.created` targeted refresh with two Task API page GETs and zero RSC GETs;
- visible Task confirmation/delete, DB row removal and null-FK
  `task.deleted` tombstone;
- `file.deleted` SSE removal with zero File GETs and zero RSC GETs;
- quarantined storage cleanup with committed DB delete and visible localized
  `role=alert` warning.

Evidence index:

```text
../evidence/REAL_audit_delivery_ui_20260723235900-notes.md
../evidence/REAL_audit_delivery_ui_20260723235900-07-api-db.json
../evidence/REAL_audit_delivery_ui_20260723235900-08-network-final.json
```

This is local production-shape evidence only. It is not a cloud result or a
substitute for the final full gate.

### Formal dispositions for plans 006–011

| Plan | Disposition | Current truth |
|---|---|---|
| 006 | `ACCEPT_DOC_TRUTH`; implementation `DEFERRED`; `RELEASE_EXCLUDED` | accept shipped water/dark/shuimo; reconcile `DESIGN.md` later as docs-only work |
| 007 | `DEFER_LINKED`; `RELEASE_EXCLUDED` | standalone observer task/WIP owns the direction; untouched here |
| 008 | `DEFER_LINKED`; `RELEASE_EXCLUDED` | durable Work Item is a separate new feature |
| 009 | `SUPERSEDED_BY_SCHEMA_AND_DELIVERY` | backend and critical local UI passed; final closure waits for clean candidate/full gate/merge |
| 010 | `DEFER_LINKED`; `RELEASE_EXCLUDED` | keep `/daemon` unchanged |
| 011 | `DEFER_LINKED`; `RELEASE_EXCLUDED`; `REJECT_DESTRUCTIVE_CLEANUP_IN_AUDIT_SCOPE` | no user-owned Remotion file is touched |

### Cloud capacity facts and evidence boundary

The target Tencent Lighthouse SKU is nominally **4 vCPU / 4 GB**, not
2 vCPU / 2 GB. The guest is `x86_64`, exposes 4 vCPUs and
`3,564,584,960` bytes = `3.3198 GiB` (report as `3.32 GiB`) RAM. The
3 GiB swap is recorded separately and is not steady-state RAM. PostgreSQL
`max_connections=100`.

All existing cloud observations are from old images. Precise clean-candidate
commits, the formal 30-minute Caddy capacity run, final full gates, PR/squash
merge, new amd64 deployment and new-cloud validation remain pending. No
500-cloud-user claim is proven.

## Historical advisor snapshot — 2026-07-19

Everything below this heading is retained to preserve the original finding and
advisor execution trail. Its status labels and merge checklist are not current.

## 历史速查：发现清单

按 ID 排序。`ID` 对应 `plans/` 下的执行计划；`finding` 是审计原始编号（SECURITY-NN / CORRECTNESS-NN / PERF-NN / TDA-NN / TEST-NN / DX-NN / DOCS-NN / DIRECTION-NN）。

| Plan | Finding | 类别 | 根因一句话 | 状态 |
|------|---------|------|------------|------|
| 001 | TEST-01 | tests/dx | `pyproject.toml` 无 `[tool.pytest.ini_options]`，`uv run pytest` 默认 27 collection error / 0 tests | ✅ DONE |
| 002 | SECURITY-01~05, 08 | security | 5 个授权弱点串成权限提升链（见下）| ✅ DONE |
| 003a | CORRECTNESS-02 | correctness | scheduler / WS 循环 `except Exception: pass` 静默吞异常 + 无退避 | ✅ DONE |
| 003b | CORRECTNESS-01 | correctness | `Message.seq` 手动 `max(seq)+1` 并发 race（深根因见下）| ✅ DONE |
| 004 | TEST-03 + 用户已知 | migration/tech-debt | 两套 schema 源 + 无 Alembic + `seq` 声明不工作 | ✅ DONE |
| 005 | PERF-01, 03 | performance | 序列化器 N+1（每条消息 3+1 查询，搜索 100 行 ≈ 400 查询）| ✅ DONE |
| 006 | DIRECTION-01 | direction | DESIGN.md 与落地的 water/dark/shuimo 三主题脱节 | 🟡 TODO |
| 007 | DIRECTION-02 | direction | session-observer/ 已实现但未集成进主 app | 🟡 TODO |
| 008 | DIRECTION-03 | direction | durable Work Item 队列（07-13 结论签字但未启动）| 🟡 TODO |
| 009 | DIRECTION-04 | direction | Tasks / Files 缺 DELETE（CRUD-minus-one）| 🟡 TODO |
| 010 | DIRECTION-05 | direction | PRODUCT.md 要求的 /control/* 分离未执行 | 🟡 TODO |
| 011 | DIRECTION-06 | direction | remotion/ 空目录（只剩 .DS_Store）与在飞任务矛盾 | 🟡 TODO |
| 012 | SECURITY-03 | security | `_resolve_human_actor` 接受 body `actor` 字段不校验调用者身份 | ✅ DONE |
| 013 | SECURITY-06 | security | `/auth/register` 和 `/auth/login` 默认 owner 角色 | ✅ DONE |
| 014 | SECURITY-07 | security | `TaskRunTemplate` 无 server_id 列（唯一缺的）→ 跨租户 IDOR | ✅ DONE |
| 015 | SECURITY-09, 10 | security | 文件上传 `await file.read()` 全读内存后才判大小 | ✅ DONE |
| — | PERF-02 | performance | SSE `/events` 占请求级 session + engine pool 默认 5 | 🔴 **未修** |
| — | PERF-04 | performance | `/tasks` `/threads` 无分页 cap，随数据线性恶化 | 🔴 **未修**（plan 005 部分缓解）|
| — | CORRECTNESS-03 | correctness | Postgres NOTIFY 每事件开新 asyncpg 连接（绕过池）| 🔴 **未修** |
| — | CORRECTNESS-04 | correctness | `_verify_auth_bridge_secret` 用 `getattr(request, "headers", {}) or {}` 防御写法 | ✅ plan 002 顺带修了 |
| — | TDA-01 | tech-debt | `public_api.py` 4617 行 + `agent_api.py` 4144 行（巨型文件）| 🔴 **未修**（plan 005 减轻了部分）|
| — | TDA-02 | tech-debt | 前端首屏加载 react-markdown/dnd-kit/dicebear 无 code-splitting | 🔴 **未修** |
| — | TDA-03 | tech-debt | feishu 服务模块重复定义 nested-dict / outcome 工具 | 🔴 **未修** |
| — | TDA-04 | tech-debt | `useChatWebSocket` hook + 3 个依赖（react-use-websocket/ws/@types/ws）零 importer 死代码 | 🔴 **未修** |
| — | TDA-05, FRONTEND-01 | tech-debt | `channel-client.tsx` 2049 行 + ~50 个 useState | 🔴 **未修** |
| — | TDA-06 | tech-debt | `_serialize_message`/`_serialize_task` 在两个 router 里 shape 漂移 | 🔴 **未修**（plan 005 缓解）|
| — | FRONTEND-02 | correctness | 前端无 `loading.tsx` / `error.tsx` / Suspense 边界 | 🔴 **未修** |
| — | FRONTEND-03 | performance | `RealtimeRefresh` 用 `router.refresh()` 每事件全量重渲 | 🔴 **未修** |
| — | FRONTEND-05 | tech-debt | `channel-client.tsx` 和 `chat-data-context.tsx` 两套会话状态机 | 🔴 **未修** |
| — | TEST-02 | tests | `routers/auth.py` 和 `verify_public_api_key` 零直接覆盖 | 🟡 plan 002 加了部分，仍不全 |
| — | DX-01 | dx | 三个 lockfile（bun/package-lock/pnpm）共存无 `packageManager` 字段 | 🔴 **未修** |
| — | DX-02 | dx | 无 CI、无 Makefile、无统一 test 命令 | 🔴 **未修** |
| — | DX-03 | dx | 前端 24 个 test 文件无 `test` script（从未运行）| 🔴 **未修** |
| — | DX-04 | dx | 前端无 `typecheck`，后端无 ruff/mypy | 🔴 **未修** |
| — | DEP-01 | deps | better-auth 与后端 auth.py 边界模糊，零测试 | 🔴 **未修** |
| — | DOCS-01 | docs | frontend/README 与 lockfile 现实矛盾；onboarding friction | 🔴 **未修** |
| — | DOCS-02 | docs | AGENTS.md 禁 Playwright，但仓库有 e2e 套件 + npm run e2e（自相矛盾）| 🔴 **未修** |

**统计**：30+ finding。**已完成 10 个 plan（修了 ~15 个 finding）**；**仍存在 ~17 个未修 finding**（多数是 tech-debt / DX / 性能优化，非紧急）。

---

## 历史 advisor 深挖：用户已知问题的根因

> 用户提问："SQL 迁移还没做，目前用的还是 alter"
>
> 审计发现的根因比表面深得多。完整链路如下。

### 表面

`backend/models/seed.py` 755 行手写 DDL：15 张 `CREATE TABLE IF NOT EXISTS`（与 `slock.py` declarative 完全重叠）+ 12 张表的 `ALTER TABLE ADD COLUMN IF NOT EXISTS`。启动时 `create_tables()` 跑 `Base.metadata.create_all` + 所有 raw DDL。

### 深层根因

**问题不只是"没 Alembic"，而是"两套 schema 源打架 + 一处核心模型声明根本不工作"**：

1. **两套源静默漂移**：`slock.py` 加了列，但 raw `CREATE TABLE` 先跑过 → 列静默不出现，运行时才炸；无法回滚；schema 演化埋在 755 行 if-exists 里。
2. **`Message.seq` 声明是 dead code**：
   - 模型写 `seq: Mapped[int] = mapped_column(BigInteger, autoincrement=True, unique=True)`
   - **但 SQLAlchemy 的 `autoincrement=True` 只对主键生效**，而这里主键是 `id UUID`
   - 所以 `seq` 在 DB 侧是个普通 `BIGINT NOT NULL`，**既无 IDENTITY 也无 SEQUENCE**
   - 应用层只能 `seq = SELECT max(seq) + 1` 兜底——经典 read-modify-write race（见并发专题）
   - 多年来没人发现，因为这个 race 只在并发消息发送时触发

### 修复（plan 004 + 003b，已 DONE）

- 004：引入 Alembic，`seed.py` 瘦身到 223 行（只保留数据播种，schema 全归 Alembic）；31 张表 baseline + pgcrypto + 所有 CHECK/index 都迁移过来；给 `seq` 加 `GENERATED BY DEFAULT AS IDENTITY`
- 003b：移除三处手动 `max(seq)+1` 赋值（`public_api.py:1996` / `agent_api.py:1852` / `reminder_scheduler.py:87`）+ 删除 `_next_message_seq` helper

### 部署注意 ⚠️

004 必须先部署且 `alembic upgrade head` 跑过，才能上 003b——否则消息发送会 NOT NULL violation crash。docker-compose 已配好启动时自动跑迁移。

---

## 历史 advisor 并发风险判断

> 用户提问："多人并发使用会出什么问题？"
>
> 以下是按"症状 → 根因 → 修复状态"列出的并发相关问题。

### 已修复（待 merge）

#### A. 两人同时发消息 → 其中一个 500 ✅

- **症状**：两个用户（或 agent + 人，或 reminder 触发 + 人）几乎同时发消息，其中一个请求返回 500，消息丢失。
- **根因**：`Message.seq` 应用层 `max(seq)+1` 是 read-modify-write race。两个并发请求都读到 `max=100`，都算 `101`，第二个 INSERT 撞 unique → IntegrityError → 500。
- **修复**：plan 004（IDENTITY）+ 003b（移除手动赋值）。详见上节。
- **证据**：`backend/models/slock.py:270` 旧声明 + 三个 `seq_result = await db.execute(select(func.max(Message.seq)...)`。

#### B. reminder scheduler 1Hz 空转烧 session ✅

- **症状**：reminder 功能出 bug 时，后端每秒开一个 DB session、抛异常、吞掉、再开一个，日志无任何记录，但 DB 连接数和 CPU 看起来正常波动。并发用户此时感觉偶发卡顿。
- **根因**：`except Exception: pass` 把所有错误藏起来 + 无退避，照样 1Hz 重试。
- **修复**：plan 003a 加 `logger.exception(...)` + 指数退避（1s → 2 → 4 → cap 60s，成功 reset）。`thread_summary` 和 `daemon_control` WS 循环同样修了。
- **证据**：`backend/services/reminder_scheduler.py:170-180`、`thread_summary.py:320-329`、`daemon_control.py:~287,~325`。

#### C. 同 server 模板被其他 server 并发改 ✅

- **症状**：server A 的人正在用模板起任务，server B 的人同时 PATCH 改了 `system_instruction`，A 的任务行为被悄悄改。
- **根因**：`TaskRunTemplate` 是唯一没有 `server_id` 列的顶层实体，`get_template_by_ref` 不过滤 server。
- **修复**：plan 014 加 `server_id` 列 + `or_(server_id==X, visibility=="builtin")` 过滤。跨 server 写返回 404（防枚举）。
- **证据**：`backend/models/slock.py:404`（旧）+ `services/task_run_templates.py:152`。

### 仍存在的并发风险 ⚠️

#### D. 多个 agent 同时连 SSE → 整个后端 DB 阻塞 🔴 未修（PERF-02）

- **症状**：5 个以上 agent 同时打开事件流 `/events?stream=true`，整个后端对所有用户的非流请求都卡住、超时。
- **根因**：
  - SSE 处理用请求级 `db: AsyncSession = Depends(get_db)`，但 SSE 是长连接，session 占用整个连接生命周期
  - SQLAlchemy engine 的 asyncpg 池**默认 size=5**（`backend/models/base.py:7` 没配 `pool_size`）
  - 每个 SSE 锁死一个 pool connection；>5 个并发 → 池耗尽 → 后续所有 DB 请求阻塞
- **修复方向**：SSE 循环里每次 poll 开短 session；engine 配 `pool_size` / `pool_recycle` / `pool_pre_ping`。
- **证据**：`backend/routers/agent_api.py:1909-2044`、`backend/models/base.py:7`。
- **优先级**：**当前最大的并发瓶颈**。需要时补 plan。

#### E. Postgres NOTIFY 每事件开新连接 🔴 未修（PERF-03）

- **症状**：高并发消息发送时，每条消息触发一个 NOTIFY，后端为每个 NOTIFY 开一个新 asyncpg TCP 连接——绕过 SQLAlchemy 池，连接握手成本叠加。
- **根因**：`backend/services/public_events.py:393-412` 用 `asyncpg.connect(...)` + `conn.close()` 处理每个事件，不复用池。
- **修复方向**：改用模块级 `asyncpg.create_pool()`，startup 时建、shutdown 时关。
- **优先级**：P2，与 D 配合修复收益最大。

#### F. 首注册双 owner race 🟡 已知，可接受（plan 013）

- **症状**：两个用户**同时**在全新 server 上首次 register，理论上都能拿到 owner。
- **根因**：`server_has_existing_membership` 是 check-then-act，两个并发请求都看到"零成员"。
- **是否修**：不修。`(server_id, account_id)` 唯一约束防重复成员，最坏情况是全新 bootstrap 时有两个 owner，对单人部署无害。要严格修需 DB 级条件插入，overkill。
- **证据**：`backend/routers/public_api.py:_bootstrap_account`（docstring 明确记录了 race）。

### 一句话总结

- **merge 10 个 worktree 前**：两人同时发消息必挂（seq race）+ 5 个 agent 同时在线全挂（SSE 池）
- **merge 后**：seq race 和 scheduler 空转解决，**SSE 池问题仍在**
- **完全解决并发**：还需做 PERF-02（SSE session 重构）+ PERF-03（NOTIFY 池化）

---

## 历史 advisor merge 清单与依赖（未执行）

### 依赖图

```
001 (测试基线) ─最先 merge
 ├─ 002 (P1 安全批量, 6 commits)
 │   ├─ 012 (impersonation)
 │   ├─ 013 (auth role, Option B)
 │   └─ 015 (upload streaming)
 ├─ 003a (scheduler 日志)
 ├─ 005 (序列化器 N+1)
 └─ 004 (Alembic + IDENTITY, 7 commits)
     ├─ 003b (seq race 移除)
     └─ 014 (template IDOR)
```

### 各 worktree HEAD（截至 2026-07-19）

| Plan | 分支 | Worktree | HEAD |
|------|------|----------|------|
| 001 | `advisor/001-pytest-baseline` | `../smallkhoj-advisor-001` | `c910178` |
| 002 | `advisor/002-p1-security-batch` | `../smallkhoj-advisor-002` | `49620ac`（6 commits）|
| 003a | `advisor/003a-scheduler-logging` | `../smallkhoj-advisor-003a` | `e0ba3b4` |
| 003b | `advisor/003-seq-race` | `../smallkhoj-advisor-003seq` | `050a624` |
| 004 | `advisor/004-alembic-schema-source` | `../smallkhoj-advisor-004` | `8962df8`（7 commits）|
| 005 | `advisor/005-serializer-n-plus-1` | `../smallkhoj-advisor-005` | `5a6fcd3`（3 commits）|
| 012 | `advisor/012-stop-impersonation` | `../smallkhoj-advisor-012` | `f35c339`（2 commits）|
| 013 | `advisor/013-auth-default-role` | `../smallkhoj-advisor-013` | `8da5c3e` |
| 014 | `advisor/014-template-scoping` | `../smallkhoj-advisor-014` | `f70f1e0`（3 commits）|
| 015 | `advisor/015-upload-streaming` | `../smallkhoj-advisor-015` | `da0aee7` |

### Merge 顺序与注意

1. **先 merge 001**（测试基线，所有其他分支依赖它）
2. **002 → 003a / 005 / 012 / 013 / 015**（基于 002 的安全基线）
3. **004**（Alembic + IDENTITY，独立大改动）
4. **003b / 014**（基于 004）

**关键约束**：
- 因为多个分支互相 cherry-pick 了基线（012/013/015 都带 002，003b/014 都带 004），merge 时 git 会自动识别已应用的 commit
- **004 必须在 003b 之前部署**，且部署时确保 `alembic upgrade head` 跑过（docker-compose 已配好自动跑）
- **dev DB 已经被 014 执行者应用了 0002+0003**，但生产/CI 环境需要靠 docker 启动时的 migration
- 002 和 012 都改了 `public_api.py` 的不同函数，merge 时可能有冲突但应该能自动解决

### Merge checklist

merge 后在此勾选（[ ] → [x]）：

- [ ] 001 → main
- [ ] 002 → main
- [ ] 003a → main
- [ ] 004 → main（部署时跑 `alembic upgrade head`）
- [ ] 003b → main（004 部署成功后）
- [ ] 005 → main
- [ ] 012 → main
- [ ] 013 → main
- [ ] 014 → main
- [ ] 015 → main
- [ ] 生产部署后跑 `alembic current` 确认在 `0003_template_server`
- [ ] 实测并发消息发送（10 个并发请求，全部成功且 seq 递增）

---

## 历史 advisor finding 根因与自报完成状态

### Plan 002 — P1 安全批量（5 个授权弱点）

形成权限提升链：

1. **`PATCH /members/{id}` 无 admin 校验**（SECURITY-02）
   - 任何登录成员可改他人的 `permissions`/`backend`/`runtimeProvider`
   - 对比：`delete_member` 正确调了 `require_admin_role`
   - **证据**：`public_api.py:3587-3615` vs `delete_member:3618-3626`
   - **修复**：加 `require_admin_role(context.membership)`

2. **`_require_permission` 默认放行**（SECURITY-01）
   - `if permissions is None: return`——成员没 permissions map 时直接放行
   - 而新建 agent 全部无 permissions map → 所有权限门被旁路
   - **证据**：`agent_api.py:1265-1272`
   - **修复**：用 `_DEFAULT_AGENT_PERMISSIONS` 显式 allow-list（7→9 项，含 `createReminder`/`updateReminder`，加了防漂移测试）

3. **bridge secret debug 模式 fail-open**（SECURITY-04）
   - 空 secret + `debug=True`（默认）时 `_verify_auth_bridge_secret` 直接 return
   - 任何人凭空 `userId` 可铸 session token
   - **证据**：`public_api.py:418-426` + `config.py:14` `debug: bool = True`
   - **修复**：删 debug-bypass 分支，fail closed

4. **静态 `PUBLIC_API_KEY = "sk_public_local"`**（SECURITY-05）
   - 70+ 公共 API 的唯一鉴权，硬编码且在 25+ 测试里
   - **证据**：`public_api.py:107`
   - **修复**：移到 settings（`public_api_key`），启动时若为默认值打 warning

5. **WebSocket `/api/chat/ws` 无鉴权 + LLM 强制 `trust_env=False`**（SECURITY-08）
   - 任意人开 WS 烧 OpenAI 额度；同时违反 `https_proxy` 平台约定
   - **证据**：`chat.py:11-33`、`llm.py:11-21`（注释说"绕过 http_proxy 避免 socksio 依赖"——是有意权衡）
   - **修复**：WS 加 `?api_key=` query 鉴权（浏览器不能设 header）；LLM 加 `llm_disable_proxy` 配置开关（默认保留旧行为）

### Plan 012 — actor impersonation（SECURITY-03）

- **根因**：`_resolve_human_actor` 接受 body `actor`/`sender`/`creator` 字段，调 `_ensure_human_member` 按 display_name 查找或创建成员——**不校验调用者身份**。任意登录用户可"作为"他人发消息/改任务/删频道。memory 路径做对了（`_ensure_memory_actor_matches_viewer`），其他 11 处没做。
- **修复**：加 `viewer`/`is_admin` 参数；override 时要求 viewer 名字匹配或 admin 角色；admin 逃逸口保留（supervisor 改记录需要）。跨 server 写返回 403。
- **证据**：`public_api.py:564-599` + ~10 个 call site

### Plan 013 — auth default role（SECURITY-06）

- **根因**：`/auth/register` 和 `/auth/login` 都调 `_bootstrap_account(default_role="owner")`，无密码/邮箱/邀请校验，唯一门是静态 PUBLIC_API_KEY。配合 #4 = 任意人变 owner。"login" 与 "register" 功能等价。
- **修复（Option B，用户拍板）**：首用户 owner（`server_has_existing_membership` 返回 False 时），之后全部 member。
- **race 已知可接受**：两并发首注册可能都得 owner，约束防重复，最坏情况是全新 bootstrap 有双 owner。
- **证据**：`public_api.py:725-750, 488, 553`

### Plan 014 — TaskRunTemplate IDOR（SECURITY-07）

- **根因**：`TaskRunTemplate` 是**唯一没有 `server_id` 列**的顶层实体。`get_template_by_ref` 只过滤 `status="active"`。猜 slug 即可改其他 server 的模板（携带 `system_instruction`/`tool_policy`/`memory_policy`，影响 agent 行为）。
- **修复**：加 `server_id` 列（migration 0003）+ `or_(server_id==X, visibility=="builtin")` 过滤。`builtin` 全局只读，`server`/`user` 按 server 隔离。跨 server 写返回 404（防枚举）。额外：PATCH 时 `visibility` 不可变（防 builtin-escalation）。
- **证据**：`models/slock.py:404`（旧）、`services/task_run_templates.py:152`

### Plan 015 — upload streaming（SECURITY-09, 10）

- **根因**：`agent_api.py:3439` 和 `public_api.py:3407` 都 `await file.read()` 全读内存后才判大小（public 路径）或不判（agent 路径 + avatar）。多 GB body OOM。
- **修复**：`_read_capped` chunked 流式读，超 cap 立即 413 早退（在缓冲全部之前）。avatar 也加 cap。早退测试 gaming-resistant（断言 consumed chunks，不只是 413 状态）。
- **证据**：`agent_api.py:3439, 3815`、`public_api.py:3407-3411`

### Plan 005 — 序列化器 N+1（PERF-01, 03）

- **根因**：`_serialize_message` 每条消息 3 查询（Channel、sender Member、reply count）+ `_serialize_reactions` 每个 reaction 再查 Member（嵌套 N+1）。list endpoint 循环调用：搜索 100 行 ≈ 400+ 查询。
- **修复**：`_prefetch_message_page` 把一页所有 sender/channel/reaction 压到 3 个查询（ID `in_(...)` 批量）；serializer 接受 optional `members`/`channels`/`reactions_by_msg` map，single-message caller 保留 fallback。`/threads` 额外把 per-root `count(*)` 换成一次 `group_by`。`/members` 把 workspace 查询也 batch 掉。
- **shape 字节级保持**（dict 键不动），现有测试全过作为 regression gate。
- **未做的部分**：`_serialize_message` 内部仍有 per-message `reply_count` 查询（`/search`/`/history` 路径），非 regression（原本就有），留作 follow-up。
- **证据**：`agent_api.py:700-757`、`public_api.py:1221-1292, 3232-3246`、`member_serialization.py:48-60`

### Plan 004 — Alembic + IDENTITY（TEST-03 + 用户已知）

详见上节"用户已知问题的真正根因"。

### Plan 003a / 003b — scheduler 日志 + seq race

详见并发专题 A、B。

### Plan 001 — pytest baseline（TEST-01）

- **根因**：`backend/pyproject.toml` 无 `[tool.pytest.ini_options]`，测试模块用 `from routers import` 但 pytest 从 `backend/` 跑时 `pythonpath` 不含 `.`。`uv run pytest` 默认 27 collection error。唯一 workaround `PYTHONPATH=.` 只在归档 Trellis 任务里记着。
- **附带**：`[tool.uv] dev-dependencies` 已 deprecated。
- **修复**：加 `[tool.pytest.ini_options]`（`pythonpath=["."]` + `asyncio_mode="auto"` + `testpaths=["tests"]`）；迁到 `[dependency-groups] dev`。

---

## 历史 advisor 执行 deviation 记录

> improve 技能要求执行者撞到 plan 真实矛盾时 STOP 下来问，而不是临场发挥。以下是本审计中执行者正确触发的 STOP 与 reviewer 判决。

| Plan | STOP 触发 | Reviewer 判决 |
|------|-----------|---------------|
| 003（初版）| 移除 `seq=` 后 INSERT NotNullViolation——探明 `seq` 不是真 identity | BLOCK，schema 修复移到 plan 004 |
| 004 Step 4 | plan 文字说"全 no-op"但测试断言了数据播种（矛盾）| Option A：保留数据播种，只删 schema DDL |
| 004 Step 6 | `Identity(always=True)` 会破坏 live 代码（仍手动赋 seq）| Option A：`always=False`（BY DEFAULT，过渡安全）|
| 004 Step 6b | plan 的 SQL 有两处 bug（window-in-UPDATE、`DROP GENERATED`）| 执行者修为 UPDATE-FROM-CTE + `DROP IDENTITY` |
| 014 | 为跑 identity migration，kill 了 9 天泄漏的 `idle in transaction` 连接 | 结果正确（真泄漏，未碰活连接），但流程应先问（违反硬规则 #2）|

---

## 历史 advisor 待办优先级（已被 current overlay 取代）

### 🔴 高（建议下一轮做）

1. **PERF-02**：SSE `/events` 占请求级 session + pool 默认 5。**当前最大并发瓶颈**。
2. **PERF-03**：Postgres NOTIFY 每事件开新连接。与 PERF-02 配合修。
3. **DX-02**：无 CI、无 Makefile、无统一 test 命令。每次改动无自动门。
4. **TDA-01**：`public_api.py` 4617 行 + `agent_api.py` 4144 行。安全 bug 正是埋在巨型文件里才没被发现。
5. **TEST-02**：`routers/auth.py` 和 `verify_public_api_key` 零直接覆盖。

### 🟡 中

6. **TDA-04**：删 `useChatWebSocket` + 3 个依赖（react-use-websocket/ws/@types/ws）死代码。
7. **DX-01**：三个 lockfile 共存，收敛到 bun + 加 `packageManager` 字段。
8. **DX-03**：前端 24 个 test 文件加 `"test": "node --test test/"` script。
9. **DX-04**：前端加 `typecheck`，后端加 ruff/mypy。
10. **TDA-02**：前端首屏 code-splitting（react-markdown / dnd-kit / dicebear）。
11. **FRONTEND-02**：加 `loading.tsx` / `error.tsx` / Suspense 边界。
12. **FRONTEND-03**：`RealtimeRefresh` 改为 targeted refetch 而非 `router.refresh()`。
13. **DOCS-02**：AGENTS.md 的 Playwright 禁令与 e2e 套件自相矛盾，需澄清。

### 🟢 低（非紧急）

14. **TDA-03**：feishu 服务模块去重（提取 `_feishu_payload.py` + `IntegrationOutcome`）。
15. **TDA-05 / FRONTEND-01**：`channel-client.tsx` 2049 行拆分。
16. **TDA-06**：`_serialize_message`/`_serialize_task` 两个 router 收敛 shape。
17. **DEP-01**：better-auth vs 后端 auth.py 边界写 ADR。
18. **DOCS-01**：frontend/README 与 lockfile 现实对齐。
19. **PERF-04**：`/tasks`/`/threads` 加分页 cap（plan 005 部分缓解）。
20. **FRONTEND-05**：合并 `channel-client.tsx` 和 `chat-data-context.tsx` 两套状态机。

### 🟡 Direction（产品决策，非 bug）

见 plan 006-011。各自需要 maintainer 拍板。

---

## 当前维护说明

- **本文件位置**：`.trellis/tasks/07-20-07-19-codebase-audit/research/2026-07-19-codebase-audit.md`
- **关联文件**：`../plans/README.md`、`../plans/NNN-*.md`、
  `2026-07-22-independent-verification.md`、`../evidence/`。
- **真相优先级**：current-candidate overlay 和直接 evidence 优先于下方历史 advisor 状态。
- **状态词边界**：candidate 门禁通过、merged、deployed、cloud healthy 必须分别记录；不得从前者
  推导后者。
- **下一次更新**：正式容量和 final full gate 完成后补 candidate SHA/证据；PR squash merge 后
  单独补 merge SHA；新 amd64 镜像部署并观察后再补 cloud 状态。
