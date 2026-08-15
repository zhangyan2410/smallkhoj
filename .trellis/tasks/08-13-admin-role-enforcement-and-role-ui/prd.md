# Server 管理权限校验与角色化 UI

## Goal

修复实测发现的三个问题（来源：`.trellis/tasks/08-12-official-server-auto-join/testing-findings.md` Issue 1–3）：普通 member 能在他人/官方 server 建频道（后端漏校验），前端对 member 暴露 admin-only 入口，server 切换上下文不明显。

## Background（实测已坐实）

- Issue 1（后端，严重度中）：`create_channel()`（`backend/routers/public_api.py:5512`）只调 `_resolve_active_server_context()`，**缺** `require_admin_role(context.membership)`；实测普通 member `POST /channels` → 200 成功建频道。对比 `create_agent()`（`:5355`）与 connect-command 端点已正确拦截。
- Issue 2（前端，严重度高）：普通 member 在聊天页可见「创建频道」「创建智能体」入口、电脑页可见「添加电脑」，填完提交才撞 403（建频道甚至成功）。`auth/me.memberships` 已带 `role` 字段，前端具备判断信息。
- Issue 3（前端/UX，严重度低）：切换 server 后看不出当前身处哪个 server、角色是什么、是 home 还是加入的 server。
- 相关 spec：`.trellis/spec/backend/member-identity-channel-contracts.md` 错误矩阵已有「Non-owner/admin mutates members → 403」。

## Requirements

- R1（后端）：`POST /api/v1/channels` 要求当前 server 的 owner/admin 角色；普通 member 收到 403。home server 的 owner 自然通过。
- R2（后端）：顺带排查所有以 `_resolve_active_server_context` 开头的**写操作**端点，确认哪些缺 `require_admin_role`；按「频道/agent/computer/invite 等管理操作必须 admin+，发消息/读操作保持 member 可用」的语义补齐或确认无需补。
- R3（前端）：根据当前 active server 的 membership `role` 隐藏 admin-only 入口：创建频道、创建智能体、添加电脑（连 daemon）。member 角色不渲染这些入口，而不是点击后才 403。
- R4（前端，轻度）：让当前 server 上下文更明显——当前 server 名称 + 当前角色标识（owner/member），区分「自己的 server」与「加入的 server」。以最小改动实现（如 switcher 触发按钮或顶栏展示），不做大改版。

## Acceptance Criteria

- [x] AC1（R1）：普通 member 对非 home server 调 `POST /channels` → 403；owner/admin 正常创建。✅ `backend/tests/test_channel_create_role_postgres_http.py`（member 403 / owner 200 / admin 200，真实 FastAPI app + 独立 postgres）
- [x] AC2（R2）：写端点排查结论（2026-08-13，`public_api.py` 全量写端点 vs `require_admin_role` 调用点交叉比对）：
  - **已正确 admin+**：server-invites 创建、tasks DELETE、computers DELETE / connect-preview / connect-command / reconnect-* / credential、workspaces lifecycle / DELETE、members PATCH / DELETE、members/agents POST、channels DELETE、channels members POST / DELETE、files DELETE。
  - **member 可用属设计如此**：messages POST、reactions、read-cursors、saved、tasks POST / PATCH、tasks assignments、files POST、reminders、memory 读写、dm POST、invite accept、auth/logout。
  - **本次修复**：channels POST 补 `require_admin_role`。
  - **遗留观察（未改，需产品决策）**：① `POST /api-keys` 允许 member 铸造 `resource_type="admin"` 的 key（resource_id 限本人 member），admin key 授权面待单独评估；② `task-run-templates` POST / PATCH / disable 无角色校验（模板是 server 配置，疑似应 admin+，但成员可用是否产品语义未定）。
- [x] AC3（R3）：member 角色下聊天侧栏不渲染「创建频道」「创建智能体」，电脑页不渲染「添加电脑」，工作台 quick-start 与 daemon 控制页的建频道表单同样隐藏；owner/admin 照常。✅ 组件级验证：`frontend/test/visible-destructive-actions-integration.test.ts` 新增「admin-only creation entries are hidden for plain members」源断言 + `bun test` / `tsc --noEmit` / eslint 全绿（2 个失败为 HEAD 预存，members 页 `MemberNameTag` 断言，与本次无关，已用 `git show HEAD:` 核实）。
- [x] AC4（R4）：rail switcher 触发按钮显示当前 server 首字母 + tooltip「名称 · 角色」；下拉当前 server 行标注「我的」（home server）；聊天侧栏 brand 行副标题显示「server 名 · 角色（· 我的）」。✅ 同文件「current server context is visible」断言 + i18n 双语言键。

## Out of Scope

- 官方 server 连 daemon + 建官方 agent + 对话调用入口（`@mention` 不触发 dispatch 的问题）——`testing-findings.md` 已标注需单独立项。
- 官方 server 默认频道预置（`#general`/`#公告`）。
- 任何数据迁移、存量数据处理。

## References

- `.trellis/tasks/08-12-official-server-auto-join/testing-findings.md`（Issue 1–3 实测证据与期望）
- `.trellis/tasks/08-12-official-server-auto-join/prd.md`（前序任务）
