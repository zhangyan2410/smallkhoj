# 2026-07-22 独立复核记录

> 状态：独立复核结论已形成；完整组合候选受工作树同步门禁阻断。原报告中的
> `DONE`、`APPROVED` 和执行者自述不自动继承为本轮结论。

## 1. 复核口径

每个计划按以下证据链判断：

```text
原始 finding → plan 契约 → 实际 commit/diff → 测试/运行证据 → 组合影响 → verdict
```

verdict 只使用：`APPROVE`、`APPROVE WITH DEPENDENCY`、`REVISE`、
`REJECT`、`NOT IMPLEMENTED`、`SUPERSEDED`。

必须区分四种状态：

1. finding 在基线 `47848e8` 是否属实；
2. advisor 分支是否正确修复；
3. 修复是否进入当前 `main`；
4. 与其他分支组合后是否可部署。

## 2. 仓库与来源状态

- 当前 `main` 为 `47848e8`，相对 `origin/main` ahead 1。
- 用户工作区包含多项未提交/未跟踪内容；本轮不清理、不提交、不 push。
- 20 个 advisor HEAD 均以 `47848e8` 为 merge-base，但没有任何一个进入当前
  `main`。因此现有中文报告把“分支中实现”直接写成“已修复”会误导当前状态。
- `plans/README.md` 的执行索引已漂移：只更新到 015，而 006、009、016–023
  已有实现分支。
- `/private/tmp/merge-audit-r3` 只合到 017，并停在 018 的冲突中，不能作为完整
  组合证据；005 与 018 在 `agent_api.py:list_threads` 存在真实冲突。

## 3. 已确认 verdict

| Plan | 独立 verdict | 核心理由 |
|---|---|---|
| 001 | `APPROVE` | 默认 pytest 真实 321 passed |
| 002 | `REVISE` | public key 部署链断裂，permission 默认允许现有权限 |
| 003 | `SUPERSEDED` | 已拆为 003a/003b；不代表 003b 已通过 |
| 003a | `APPROVE` | 日志/退避正确，完整分支 324 passed |
| 003b | `REVISE` | 依赖的 identity migration 没有对齐已有 seq |
| 004 | `REVISE` | 旧库接入、stamp、sequence、create_all 均有部署阻断 |
| 005 | `REVISE` | reply-count N+1 仍在，计划 query-count 验收未达标 |
| 006 | `APPROVE WITH DEPENDENCY` | 文档大体正确，待 maintainer 批准方向/措辞 |
| 007 | `NOT IMPLEMENTED` | standalone observer 存在，但未集成 |
| 008 | `NOT IMPLEMENTED` | 没有 Work Item 设计产物或实现 |
| 009 | `REVISE` | Task DELETE 的 activity/event 外键指向已删除 task |
| 010 | `NOT IMPLEMENTED` | 无产品选择、无实现分支 |
| 011 | `NOT IMPLEMENTED` | remotion 仍是空目录，PRD 验收未完成 |
| 012 | `REVISE` | 阻止 impersonation，但破坏 @name/UUID 合法自引用 |
| 013 | `REVISE` | 并发首次注册仍可产生双 owner |
| 014 | `REVISE` | 普通用户可创建全局 builtin，legacy/slug 迁移错误 |
| 015 | `APPROVE WITH DEPENDENCY` | 内存读取 cap 有效，ingress/磁盘 DoS 另行处理 |
| 016 | `APPROVE WITH DEPENDENCY` | 连接复用有效，需恢复策略和连接预算 |
| 017 | `REVISE` | agent SSE 仍持有 request-scoped DB session |
| 018 | `REVISE` | 跨 channel 游标错误、前端不翻页、threads 先 limit 后过滤 |
| 019 | `REVISE` | ruff 73 errors，frontend build 缺必需 env，CI 必红 |
| 020 | `APPROVE` | 正确保留真实使用的 ws，Bun 单 lockfile 门禁通过 |
| 021 | `APPROVE WITH DEPENDENCY` | code split/边界可构建，待真实 UI 验收并纠正报告措辞 |
| 022 | `APPROVE WITH DEPENDENCY` | task card 已 targeted；依赖修正 017，双 SSE/其余全刷需披露 |
| 023 | `REVISE` | e2e 已认证漂移，不能直接宣布为 canonical |

### Plan 002 — `REVISE`

聚焦测试：20 passed。

- PATCH member 的 admin gate 正确；`AUTH_BRIDGE_SECRET` 缺失时 fail-closed 正确。
- permission 所谓“default-deny”仍默认允许当前代码检查的全部 9 项权限，只拒绝
  未来未知字符串；没有收紧现有无 permissions agent 的任何现有能力。
- 后端读取 `PUBLIC_API_KEY`，而生产 compose、生产 env 模板和前端只使用
  `NEXT_PUBLIC_API_KEY`。自定义前端 key 会造成前后端认证断裂；保留默认值则已知
  默认 key 风险仍在。
- `docker-compose.prod.yml` 未向 backend 传 `PUBLIC_API_KEY`。
- agent WebSocket 把 bearer key 放在 `?api_key=` URL 中，仍有代理日志、历史和
  诊断记录泄漏风险。

结论：若干子修复正确，但安全批次整体未满足原报告宣称的闭环。

### Plan 003b + Plan 004 — `REVISE`（部署阻断）

- `0002_messages_seq_identity.py` 把 `messages.seq` 改为 identity，却没有把新
  sequence restart 到 `MAX(seq)+1`。
- 过渡期旧应用继续显式写 `seq=max+1`，显式 identity 值不会推进 sequence；003b
  停止显式写入后，首条新消息可能从 1 开始并与已有行冲突。
- `test_message_seq_auto_assign.py` 用 `Base.metadata.create_all` 建空表，没有运行真实
  0002、没有已有 seq 数据，所谓并发测试也只是在同一 session 顺序插两行。
- 2026-07-22 已用一次性 PostgreSQL 16 对 0001 → 0002 做真实旧数据探针：先在 baseline
  表中显式插入 `seq=1,2,3`，再运行 `alembic upgrade 0002_messages_seq`。迁移成功后
  `messages.seq` 是 `BY DEFAULT` identity，`MAX(seq)=3`，但
  `public.messages_seq_seq` 的 `start_value=1` 且尚无 `last_value`。随后省略 `seq` 插入
  第一条消息，数据库稳定报错：`duplicate key value violates unique constraint
  "messages_seq_key"`，`Key (seq)=(1) already exists`。这把部署阻断从静态推理提升为
  真实 PostgreSQL RED 证据。
- `docs/migration-workflow.md` 指示旧环境 `alembic stamp head`。若 head 已到
  0002/0003，这会把实际未执行的 identity/template 迁移标记为已执行。正确接入应只
  stamp baseline `77b8b147f689`，再 `alembic upgrade head`。
- 旧库已有表而没有 `alembic_version` 时，compose 直接 `alembic upgrade head` 会从
  0001 创建现有表并失败。
- 启动仍调用 `Base.metadata.create_all`，会制造“最新 schema、无版本记录”的状态，
  不能称 Alembic 为严格单一真相源。

结论：003b 删除应用层 `max(seq)+1` 的方向正确，但必须依赖修正后的 0002 和真实
旧库迁移回归；004 当前不可部署。

### Plan 005 — `REVISE`

- 预取确有性能改善，但 `_serialize_message` 仍对每条消息单独查询 reply count；
  100 条 search 仍至少约有 100 个额外 query，不是报告声称的 3–5。
- 没有 query-count 测试，计划自己的 “50-message search fewer than 50 queries”
  验收未达到。
- `serialize_member(..., _workspace_id=None)` 用 `None` 同时表示“没提供预取值”和
  “预取确认没有 workspace”，无 workspace member 仍会回退逐条查库。
- 与 018 有真实合并冲突；现有参考冲突解只解决文本，不证明 018 的分页语义正确。

### Plan 012 — `REVISE`

聚焦测试：33 passed。

- 实现关闭了直接冒充其他 actor 的安全漏洞。
- 但合法自引用只接受精确裸 `viewer.display_name`；既有契约还接受 `@alice` 和 viewer
  UUID。新实现会把这两种合法请求误判为 403。
- 新测试只覆盖裸名字，遗漏既有引用格式。

### Plan 013 — `REVISE`

聚焦测试：29 passed。

- 首个 membership 为 owner、后续为 member 的基本逻辑成立。
- 两个并发首次注册都可能观察到零 membership 并各自成为 owner；
  `(server_id, account_id)` 唯一约束不能阻止不同 account 的双 owner。这仍是可利用的
  owner 提权窗口，不只是普通残余风险。
- `/auth/login` 对不存在的用户名仍会创建账户，legacy auth 仍是共享 public key 模型。
- Option B 是否得到 maintainer 明确产品选择，现有材料尚未找到直接证据。

结论：需要数据库级/事务级的“唯一首位 owner”串行化方案，并确认产品选择；不能以当前
实现宣称 SECURITY-06 已关闭。

### Plan 014 — `REVISE`（安全阻断）

聚焦测试：38 passed，但测试把漏洞固化为预期。

- 普通登录用户可提交 `visibility="builtin"`，创建 `server_id=NULL` 的全局模板，
  所有租户可见。
- 迁移注释称 legacy `server_id=NULL` 非 builtin 模板“仍可读、只读”，但查询只允许
  当前 server 或 builtin；这些 legacy 模板会直接消失。
- `slug` 仍是全局唯一，没有改为 tenant-local 唯一；一个租户可阻止其他租户使用同
  slug，并产生跨租户可用性/枚举问题。

### Plan 015 — `APPROVE WITH DEPENDENCY`

聚焦测试：5 passed。

- `_read_capped` 限制了应用从 `UploadFile` 再次读入内存的累计量；agent upload 和
  avatar 均获得 50 MiB cap。
- 但 Starlette 在 route 执行前已解析 multipart，较大请求体可能已进入
  `SpooledTemporaryFile`。该 helper 不是“网络流式早退”，磁盘请求体 DoS 仍存在。

依赖：报告必须降级措辞，并另行处理 ingress/request-body 限制。

### Plan 016 — `APPROVE WITH DEPENDENCY`

聚焦测试：4 passed。

- NOTIFY 主路径复用 asyncpg pool，原始“每事件新建连接” finding 已直接改善。
- pool acquire/execute 失败只 log 并 return，不重建 pool，也不降级 one-shot connect；
  跨进程通知可能持续丢失。
- 与 017 组合后，每进程潜在约 SQLAlchemy 30 + notify 10 + listener 1 个连接；部署
  worker 数必须进入容量预算。

依赖：增加/验证 pool 失效后的恢复策略，并把每进程连接预算纳入部署门禁。

### Plan 017 — `REVISE`（核心 finding 未修）

聚焦测试：4 passed；环境 FastAPI 0.136.1。

- 公共 SSE route 正确移除了 request DB dependency。
- agent `/events` 仍声明 `db: AsyncSession = Depends(get_db)`，`resolve_agent` 也通过
  `Depends(get_db)` 复用 request-scoped session。
- FastAPI yield dependency 在 `StreamingResponse` 完成后才退出；初始 SELECT 已开启
  事务，所以 agent SSE 仍长期占用连接。
- 新测试只检查 generator/循环源码，没有验证 FastAPI dependency finalizer 生命周期。
- pool 从 5 调到 30 只延后耗尽，没有修复连接寿命。

### Plan 018 — `REVISE`

- server-wide `/tasks` 使用 `task_number` 游标，但数据库唯一键为
  `(channel_id, task_number)`；跨 channel 排序和 `before` 会重复或漏数据。
- 多个前端页面只请求一次 `/api/v1/tasks`，不消费 `nextCursor`，上线后早于前 50 条的
  任务会从 UI 消失。
- `/threads` 先 limit roots 再在内存过滤无回复 root；最新 roots 多为无回复时会返回
  空页/不足页，即使更老处仍有有效 thread。应在 SQL 中先用 `EXISTS`/JOIN 过滤。
- 与 005 在 `agent_api.py:list_threads` 有真实冲突。

### Plan 001 — `APPROVE`

- diff 仅修改 `backend/pyproject.toml`，正确迁移到 dependency groups，并增加 pytest
  `pythonpath`、`testpaths` 和 asyncio 配置。
- 默认命令实测：`321 passed in 2.42s`，不再需要手工 `PYTHONPATH=.`。
- `git diff --check 47848e8..c910178` 通过。

### Plan 003（旧合并计划）— `SUPERSEDED`

- 旧 003 已按依赖拆为 003a（scheduler/WS 可独立落地）和 003b（必须等迁移）。
- `SUPERSEDED` 只描述计划结构；不表示 003b 已正确完成。003b 当前仍为 `REVISE`。

### Plan 003a — `APPROVE`

- reminder/thread-summary loop 会记录异常、指数退避并在成功后恢复基础 interval；daemon
  send failure 会记录并移除失效 websocket。
- reminder 的增长、60 秒 cap、成功 reset 和异常日志有直接测试。
- 聚焦测试 `3 passed`，完整分支测试 `324 passed in 2.74s`。
- thread-summary 默认 interval 本身为 60 秒，因此 cap 不产生指数增长，但没有行为退化。

### Plan 006 — `APPROVE WITH DEPENDENCY`

- finding 属实：基线 `DESIGN.md` 仍要求 light-first 单色中海蓝，而代码已是
  water/dark/shuimo + Inkframe。
- 分支正确归档旧 handoff，并以强 `SUPERSEDED` header 防止后续继续执行旧 checklist；
  关键 token 表与 `globals.css` 中的生效值基本一致。
- 文档仍有轻微过度概括：water/shuimo 的 background/card 相同，但 popover、secondary、
  muted、sidebar 等并非“核心表面完全一致”。
- 计划明确要求 operator 在编辑前批准方向；现有材料中没有找到该批准记录。合入依赖
  maintainer 对这次方向反转和措辞做显式确认。
- 当前 `main` 的 `DESIGN.md` 仍是旧版，`FRONTEND_OPTIMIZATION_HANDOFF.md` 也尚未归档；
  用户给出的仓库根路径本身不能证明 plan 006 已进入 main。

### Plan 007 — `NOT IMPLEMENTED`

- finding 属实：`session-observer/` 是完整的 standalone 项目，但 frontend/backend/项目
  导航中没有集成入口。
- 没有 advisor/007 实现分支；现有 standalone 项目不等于“集成完成”。

### Plan 008 — `NOT IMPLEMENTED`

- durable Work Item/DispatchAttempt 是 capability matrix 结论支持的后续设计方向，不是
  当前代码 defect 的既有修复。
- 当前 task 中没有 plan 要求的 `work-item-design.md`，后端也没有 WorkItem/
  DispatchAttempt 实体；没有 advisor/008 分支。

### Plan 009 — `REVISE`（真实数据库路径会失败）

- fake-session 聚焦测试 `6 passed`，但它们没有执行 PostgreSQL 外键。
- `DELETE /tasks/{id}` 先执行 `DELETE tasks`，随后 `_record_activity(...,
  task_id=task.id)`；该 helper 会立即 `flush()` `ActivityLog`，并再创建同一 `task_id` 的
  `EventRecord`。两列都外键指向 `tasks.id`，所以对已删除 task 的新插入会触发 FK
  violation。`ON DELETE SET NULL` 只处理删除时已经存在的引用，不会使之后的新引用合法。
- 2026-07-22 已在独立 PostgreSQL 16 数据库按路由顺序执行真实事务：`DELETE tasks`
  成功 1 行，紧接着插入带原 `task_id` 的 `activity_logs` 时稳定报
  `activity_logs_task_id_fkey`；单独把后续 `event_records` 路径推进到插入，也稳定报
  `event_records_task_id_fkey`。两次失败后事务均回滚，Task 仍为 1 行，activity/event
  均为 0 行。因此接口的真实结果是整笔失败，不是“删除成功但审计记录缺失”。
- task/file 的删除 activity 复用了 `supervisor_task_updated` / `supervisor_message_sent`，
  审计事件语义不准确；前端 task 文案也硬编码中英文混合。
- 计划要求的 `./twd` 端到端删除证据不存在；当前浏览器桥没有 SmallKhoj 本地 tab。
- 结论：Task DELETE 在真实数据库上不能批准；需要先记录无 FK 的 tombstone/details 事件
  或把 activity 的 `task_id` 留空，再加真实 PostgreSQL 回归。

### Plan 010 — `NOT IMPLEMENTED`

- finding 属实：密集 daemon console 仍在顶级 `/daemon`，产品 surface 仍直接链接它，
  与 PRODUCT 的 `/control/*` 分层原则不一致。
- 该计划要求 operator 先选 A/B；没有选择记录，也没有 advisor/010 分支。

### Plan 011 — `NOT IMPLEMENTED`

- finding 在审计时属实，当前工作区的 `remotion/` 仍没有可列出的源文件或
  `package.json`；相应 PRD 的 acceptance checklist 仍全未勾选。
- 没有 operator A/B/C 选择记录，也没有 advisor/011 分支。

### Plan 019 — `REVISE`（CI 必然失败）

- backend pytest `341 passed`；frontend Node test `148 passed`；frontend lint 和
  typecheck 通过。新增脚本本身可用。
- 新 CI 无条件执行 `uv run ruff check .`，当前实测有 73 个错误（49 I001、12 F401、
  9 UP035 等），所以 backend job 必红。
- frontend CI 无条件 `bun run build`，却没有提供生产必需的 Better Auth env；同一分支
  实测在 page-data 阶段失败：`BETTER_AUTH_SECRET is required in production`。
- plan 一面允许“第一次 CI 可能失败”，一面又把这些命令直接设成 merge gate；这不构成
  可用 CI。应先建立明确 baseline（修复或受控 ignore），并给 build 配置非敏感测试 env。
- 019 还依赖整体 verdict 为 `REVISE` 的 002，不能按“001+002 DONE”直接合并。

### Plan 020 — `APPROVE`

- `useChatWebSocket` 确认零 importer，删除该 hook 和 `react-use-websocket` 正确。
- `frontend/server.ts` 仍真实使用 `ws`，执行者正确保留 `ws` 和 `@types/ws`，没有机械照抄
  计划中“删三个依赖”的错误假设。
- package manager 与实际环境一致：`bun@1.3.14`；只保留 `bun.lock`。
- `bun install --frozen-lockfile`、eslint、`tsc --noEmit` 均通过；提供所需非敏感 build
  env 后 production build 通过。
- `frontend/README.md` 仍宣传 npm/yarn/pnpm；这是独立 DOCS-01，020 没有解决它。

### Plan 021 — `APPROVE WITH DEPENDENCY`

- markdown 和 dnd-kit 改为有效的 client dynamic imports；Server Component 的 task board
  通过薄 client wrapper 使用 `ssr:false`，做法正确。
- landing `MemberAvatar` 原本就在 Server Component 中生成 data URI，dicebear 不进入该路由
  client bundle；执行者正确没有为一个误报添加 `ssr:false` pop-in。
- root `loading.tsx` / `error.tsx` 已加入且 i18n 完整；lint、typecheck、带 build env 的
  production build 均通过。
- error boundary 不会修复现有 `apiGet` 对 non-ok/异常返回 fallback 的“静默失败”；报告只能
  声称新增了边界，不能声称所有 fetch failure 已可见。
- 合入前仍依赖 `./twd` 验证实际 loading/error UI、可访问性和动态组件首帧；当前无本地 tab，
  这项验收未完成。

### Plan 022 — `APPROVE WITH DEPENDENCY`

- task.created/task.updated 已从页面级全量 `router.refresh()` 移出，任务卡只重新请求
  `/api/v1/tasks`；lint、typecheck、production build 通过。
- member/message 事件仍走页面级 `router.refresh()`，所以只能声称“task card targeted”，
  不能称首页全量刷新问题整体消失。
- 页面同时挂载两个 `RealtimeRefresh`，即建立两条 SSE 连接。单独基于 47848e8 合入会加重
  原始 SSE 连接寿命问题；必须依赖修正后的 017 公共 SSE 生命周期，且部署前明确接受或收敛
  为单连接事件总线。
- 缺少 `./twd` network/DOM 证据来证明 task event 只请求任务接口；当前无本地 tab。

### Plan 023 — `REVISE`

- 原始文档矛盾属实：AGENTS blanket ban 与已提交 Playwright suite 同时存在。
- 但现有 `management-flow.spec.ts` 没有登录或注入 `smallkhoj_session`，而 `/`、
  `/computers`、`/members` 等当前会通过 `requireCurrentAccount()` 跳到 `/login`。
- suite 还硬编码 `sk_public_local`，与可配置 public key/002 的目标冲突；API helper 也没有
  account token/active server 上下文。
- 因此把这套已认证漂移的 suite 直接宣布为“canonical end-to-end flow test”不准确。应先修复
  e2e auth/env，再更新 AGENTS；当前文字不能批准。

## 4. 未单独成 plan 的 finding

- **TDA-01** 属实且未解决：基线 `public_api.py` 4617 行、`agent_api.py` 4144 行。
- **TDA-03** 属实但低优先级：Feishu adapter/transport 各有 `_nested`，多个 orchestration
  模块各自定义 outcome dataclass/helper；尚无统一抽象。
- **TDA-05 / FRONTEND-01** 属实且未解决：基线 `channel-client.tsx` 2049 行，职责和状态高度
  集中。
- **TDA-06** 属实；005 只做部分预取，没有收敛 public/agent 两套 serializer shape。
- **FRONTEND-05** 属实且未解决：channel client 与 `chat-data-context` 仍是两套状态所有者。
- **TEST-02** 在基线属实；002 增加 public key/permission 相关覆盖，但 auth 边界仍未形成完整
  contract suite。
- **DEP-01** 更准确地说是 ADR/边界不清风险，不是已证明的可利用 bug；仍未解决。
- **DOCS-01** 属实且未解决：即使采用 020 后，frontend README 仍推荐 npm/yarn/pnpm，和
  canonical Bun lockfile/packageManager 冲突。
- **CORRECTNESS-04** 的防御式 headers 读取已被 002 子提交正确修正，但不改变 002 整体
  `REVISE`。
- **TDA-02** 只部分属实：markdown/dnd-kit 是有效 code-split 目标；landing dicebear 的
  “进入 client 首屏 bundle”前提是误报，因为它在 Server Component 生成 data URI。
- **DOCS-02** 的矛盾是真问题，但现有 e2e suite 自身也已认证漂移，正确方向是先修 suite，
  不是直接放宽规则。

## 5. 当前 main 与报告状态差异

- 上述 advisor 实现均未进入当前 `main`；当前 main 仍保留原始 finding。
- 中文报告、技术报告和交接文档的“已修复/全部 APPROVED”不能作为发布状态使用。
- `DESIGN.md` 当前 main 已确认仍是 3433 字节的旧版；plan 006 的重写只在 advisor 分支。
- `docs/migration-workflow.md` 当前 main 不存在，只在 advisor 迁移分支中存在。

## 6. 组合与验证限制

- `merge-audit-r3` 实际只合入了 002、003a、005、006、012、013、015–017；没有覆盖
  003b/004/009/014/019–023，并停在 018 与 005 的 `agent_api.py` 冲突中，不能用其测试结果
  代表完整组合。
- 003b/004/014 的累计 diff 还共同带有 `0001_baseline.py` trailing whitespace，
  `git diff --check` 退出 2；其余已检查 advisor heads 通过 diff check。
- 当前 `main` ahead 1 且 docs/task 内容 dirty，worktree 同步门禁不允许安全新建完整组合
  worktree。没有在 dirty main 或 advisor 分支上补测试。
- 本轮没有向仓库新增永久测试；已通过一次性 PostgreSQL 16 探针对 004/003b 的真实
  迁移路径和 009 的真实外键路径取得 RED 运行证据。014、017、018 的缺陷仍由直接控制流、
  依赖生命周期、唯一键和分页语义确定证明；所有永久回归应在修复任务的隔离 worktree 中
  按 TDD 完成。
- WebDriver bridge 可用，但只有用户外部网页 tab，没有 SmallKhoj 本地 tab；未劫持用户 tab，
  因此 009/021/022 的可见 UI 验收明确保持未完成。

## 7. 关键复验命令

以下命令均从对应 advisor worktree 执行；项目 shell 命令统一经 `rtk`。

```bash
# 001：默认 pytest 基线
cd /Users/code/project/smallkhoj-advisor-001/backend
rtk uv run pytest -q

# 003a：聚焦与完整回归
cd /Users/code/project/smallkhoj-advisor-003a/backend
rtk uv run pytest tests/test_reminder_scheduler.py -q
rtk uv run pytest -q

# 004/003b：真实 PostgreSQL 迁移 RED 的核心步骤
# 1) upgrade 到 77b8b147f689；2) 显式插入 messages.seq=1,2,3；
# 3) upgrade 到 0002_messages_seq；4) 省略 seq 插入下一条消息。
# 实测：messages_seq_seq 从 1 开始，最后一步命中 messages_seq_key，seq=1 重复。

# 009：说明 fake-session 测试为何不足（它会绿，但不执行 PostgreSQL FK）
cd /Users/code/project/smallkhoj-advisor-009/backend
rtk uv run pytest tests/test_task_delete.py tests/test_file_delete.py -q
# 真实 PostgreSQL 探针按 route 顺序执行 DELETE tasks → INSERT activity_logs(task_id=旧 ID)，
# 实测命中 activity_logs_task_id_fkey；EventRecord 的同类插入命中 event_records_task_id_fkey。

# 019：当前 CI 的两个确定失败
cd /Users/code/project/smallkhoj-advisor-019-ci/backend
rtk uv run ruff check . --statistics
cd /Users/code/project/smallkhoj-advisor-019-ci/frontend
rtk bun run build

# 020：Bun 单锁文件与构建门禁
cd /Users/code/project/smallkhoj-advisor-020-frontend-cleanup/frontend
rtk bun install --frozen-lockfile
rtk bun run lint
rtk bunx tsc --noEmit
rtk env \
  BETTER_AUTH_SECRET=audit-only-secret-at-least-32-characters \
  BETTER_AUTH_URL=http://localhost:3000 \
  BETTER_AUTH_DATABASE_URL=postgresql://audit:audit@localhost:5432/audit \
  AUTH_BRIDGE_SECRET=audit-bridge-secret \
  NEXT_PUBLIC_API_KEY=audit-public-key \
  bun run build

# 021/022：分别在对应 frontend worktree 运行相同 lint/typecheck/build 门禁
rtk bun run lint
rtk bunx tsc --noEmit

# 当前 UI 证据可用性
cd /Users/code/project/smallkhoj
rtk ./twd --compact tabs

# 累计 diff 质量（003b/004/014 会报告 baseline trailing whitespace）
rtk proxy git diff --check 47848e8..<advisor-head>
```

高风险分支已运行的聚焦测试汇总：002 `20 passed`、012 `33 passed`、013
`29 passed`、014 `38 passed`、015 `5 passed`、016 `4 passed`、017 `4 passed`。
这些通过数只证明现有断言成立；本文相应 `REVISE` 项均已指出断言没有覆盖的真实契约。
