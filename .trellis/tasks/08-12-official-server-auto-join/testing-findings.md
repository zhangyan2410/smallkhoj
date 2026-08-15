# 实测发现的问题（2026-08-12 浏览器 + API 验证）

本文档记录官方 server 自动加入功能在真实浏览器 + 后端 API 验证中发现的问题。
**仅记录，不在此任务里改代码。** 每个 issue 标注归属（前端 / 后端 / 新需求）。

验证环境：本地 dev stack（backend:8000 / frontend:3000）。

**官方账号确认（2026-08-13 更正）**：用户已用邮箱 `sqserver@shengqu.com` 注册，
注册时填的 name 是 `AuarServer`（邮箱存于 Better Auth 独立库，应用库无邮箱列，
所以按名字搜 "sqServer" 搜不到——这是最初的混淆点）。Better Auth userId
`GmMhK3X31HVU41M6iIrjp5oWIoViUf4Y`。其 home server 即官方 server：
`server_handle = s8pz9`，role=owner。`backend/.env` 现为
`OFFICIAL_SERVER_HANDLE=s8pz9`（已从临时值 `szphh` 改正）。

验证期间临时造的 Sqteam(szphh)/livedev(shazw) 账号与 server 已全部清理。

---

## ✅ 已通过验证（AC1–AC4）

- AC1：新用户注册后自动以 `member` 身份加入官方 server，`GET /auth/me` 可见。
  浏览器 switcher 显示「Sqteam · 成员」。✅
- AC2：官方账号本人只有 owner membership，无重复 member 行。✅
- AC3：未配置 handle 时行为不变。✅（Postgres 单测 + 7 条 bootstrap 基线全绿）
- AC4：handle 不存在时注册照常完成、跳过加入。✅
- 后端单测：`test_official_server_auto_join_postgres.py` 3/3 绿；
  `test_account_bootstrap_postgres.py` 3/3 绿（无回归）。
- 实时栈验证：bridge API + DB 双重确认自动加入 role=member、status=active、复用同一 human Member。

---

## 🐞 Issue 1（后端）：member 能在别人 server 上建 channel —— 缺权限校验

**现象**：`AuarServer`（在 Sqteam 中是 `member`）调用 `POST /channels` 成功创建了
`#member-test-channel`，返回 HTTP 200。

**2026-08-13 复测确认**（用真实普通 member 在官方 server s8pz9 上）：注册普通
member `member1`（auto-join s8pz9 为 member），用其 token + `X-Server-Id=s8pz9`：
- 建 channel `POST /channels` → **HTTP 200，`member-ch` 真的落在 s8pz9**（按 id 查实）→ 越权坐实。
- 生成 daemon connect 命令 `POST /computers/connect-command` → HTTP 403（正确拦截）。
- 建 agent `POST /members/agents` → HTTP 403（正确拦截）。
- 即三项里**只有建 channel 漏了校验**，连 daemon / 建 agent 都正确拦了。

**根因**：`backend/routers/public_api.py:5512` `create_channel()` 只调用
`_resolve_active_server_context()`，**没有** `require_admin_role(context.membership)`。
对比同文件 `:5355` `create_agent()` 和 connect-command 端点都正确调用了 `require_admin_role`。

**期望**：普通 member 不应在非 home 的 server 上建 channel（与 agent 创建一致）。

**修复方向（后续任务）**：在 `create_channel()` 入口加
`require_admin_role(context.membership)`；同时排查所有写操作端点是否遗漏该校验。
注意 home server 的 owner 自然通过。

**严重度**：中（权限越权，但当前用户量极小、无存量用户）。

---

## 🐞 Issue 2（前端）：admin-only 操作未按角色隐藏 UI

**现象**：用户反馈「切换后这俩都能去创建 channel 和 agent」。其中：
- 建 channel：后端没拦（见 Issue 1），所以前端点了真能建。
- 建 agent：**后端已正确拦截**（403 "Server owner/admin role required"），
  但前端仍对 member 暴露「创建 agent」入口 → 用户点击后被拒，体验是坏的。

**2026-08-13 前端复测确认**（注册普通 member `member2`，auto-join s8pz9 为 member，
浏览器实际操作，非 curl）：

| 操作 | 前端入口对 member | 前端对话框 | 后端结果 | 综合 |
|------|------------------|-----------|---------|------|
| 建 channel | ✅ 聊天页「创建频道」可见 | 完整打开(频道名+描述) | **200 成功** | ❌ 前后端都漏 |
| 建 agent | ✅ 聊天页「创建智能体」可见 | 完整打开(名字+描述) | 403 拦截 | ⚠️ 前端没隐藏 |
| 连 daemon | ✅ 电脑页「添加电脑」可见 | connect 流程 | 403 拦截 | ⚠️ 前端没隐藏 |

- **最严重是建 channel**：member2 在前端对话框填 `fe-member-channel` 点创建 →
  DB 查实该频道**真落在 s8pz9**（AuarServer 的官方 server）→ 普通 member 在别人的
  server 建了频道，前后端都没拦。这是 Issue 1 的前端侧坐实。
- 建 agent / 连 daemon：前端完整暴露入口和表单，member 填完提交才撞 403。
  nav 里「电脑/成员/控制」页对 member 也全部可见。

**期望**：前端根据当前 membership 的 `role`（owner/admin/member）隐藏或禁用
admin-only 操作（建 channel、建 agent、连 daemon）。`auth/me.memberships` 已经带
`role` 字段，前端有足够信息判断。建 channel 还需配合 Issue 1 的后端校验。

**严重度**：高（建 channel 前后端双漏，普通 member 能在官方/他人 server 建频道）。

---

## 🐞 Issue 3（前端/UX）：server 切换上下文不明显

**现象**：用户反馈「看不出切换，也不知道我当前是我的 server 还是其他人的」。
切换 server 后，当前身处哪个 server、是 owner 还是 member，视觉上不够突出。

**期望**：在顶栏 / switcher / 页面标题处更明确地标识：
- 当前 server 名称 + handle；
- 当前角色（owner / member）；
- 是否为「自己的 home server」vs「加入的 server」。

**严重度**：低（体验/可用性，非功能性）。

---

## 🧩 Question 解答：#general 是手动建的，不是默认频道

**结论**：`#general` 是验证时由我手动通过 API 创建的，**不是默认存在**。

证据（DB 时间戳）：
- Sqteam server 创建于 `23:33:25`
- `#general` 创建于 `23:35:08`（晚 1.5 分钟，我建频道那一步）

`bootstrap_account()`（`services/account_bootstrap.py`）只创建
Server + Account + Member + owner membership，**不创建任何 channel**。
因此每个新 server（包括官方 server）初始都是零频道。

**影响**：如果产品期望官方 server 一建好就有默认公开频道（如 `#general`/`#公告`），
需要额外的产品逻辑（官方账号注册后自建，或 bootstrap 时为官方 server 预置频道）。
当前 PRD 范围内不包含此项。

---

## 🧩 核心后续需求（超出现 PRD）：官方 server 需连 daemon + 创建 agent

用户明确：官方 server 的**核心目的**不只是让大家加入，而是要：
1. 官方 server 连接一个 daemon；
2. 在官方 server 上创建一个 agent（官方 bot）；
3. 加入的 member 可以与该 agent 交互。

**官方 server (s8pz9 / AuarServer) 当前实测状态（2026-08-13）**：
- channels = 0，agents = 0，humans = 1（仅 AuarServer 本人）。
- 即官方 server 目前是空壳：自动加入让用户"进得来"，但没有官方 agent 可对话，
  也没有任何频道。真正的产品价值（进来能跟官方 agent 互动）尚未实现。

这超出了本 PRD（仅「自动加入」）的范围。需要单独立项，涉及：
- daemon 接入官方 server 的配置与鉴权；
- 官方 agent 的 member 创建（`members.type='agent'`，注意 agents 表 CHECK 约束
  `type='agent' AND account_id IS NULL`，即 agent 不挂 account）；
- agent 在官方 server 公开频道的可用性；
- 官方 server 是否需要默认公开频道（如 `#general`/`#公告`），因为 bootstrap
  不建任何频道，当前为 0。
注意约束：`.trellis/spec/backend/member-identity-channel-contracts.md` 提到
agent 跨 server 进驻当前受限（`channel_membership.py:51-53`），官方 agent
驻留官方 server 内是可行的，但进驻用户 server 另当别论。

### 实测结果（2026-08-13，用产品跑通，非读代码）

用真实流程在官方 server `s8pz9` 上完整跑了一遍 daemon + agent 接入：

**✅ 已跑通：**
1. **daemon 接入官方 server**：前台 daemon 页生成 connect 命令（ConnectTicket 绑定
   s8pz9）→ 跑 daemon 消费 ticket → Computer 落在 s8pz9，在线心跳。
   （为避免和已有 qq daemon 抢 machine-id/credential，用隔离 HOME `~/.smallkhoj/daemon`
   跑独立实例，PID 74311，computer 名 Mac-mini.local。）
2. **创建官方 agent**：`POST /members/agents` 必须带 `computerId`（agent 必须挂在某
   computer 上，否则 400 Missing computerId）。创建 `Official`（agent id
   `1086437f`），`config.computerId` 自动绑定到 daemon 的 computer。
3. **runtime 启动 + agent 上线**：daemon 心跳下发 start 命令 → 拉起 claude_code
   runtime → warmup 完成 → agent `status=online`，agent_workspaces `status=running`。
   （踩坑：隔离 HOME 缺 claude 认证 → warmup 卡住；补 `~/.claude.json`+settings 后恢复。）
4. **自动加入**（前序已验）：新用户注册自动以 member 加入 s8pz9。

**❌ 未跑通 / 需进一步确认：**
5. **agent 不响应 @mention**：在 #general（已把 agent 加为频道成员）发 `@Official`
   消息，agent 不回复。后端日志显示消息创建**不触发任何 agent dispatch**
   （ext_events / task_runs / llm_run_leases 全 0），daemon WS 也没收到消息。
   → **结论：@mention 不会自动调用 agent**。agent 的调用入口应是另一套机制
   （很可能是"任务/Task"，nav 里有独立的"任务"页；或需要显式建 task 指派给 agent），
   不是频道里 @一下就行。这部分未继续深挖。

**实测踩坑记录（环境层，非产品缺陷）：**
- 本机已有 daemon 绑着 qq（s29kd），machine-id/credential 共用 `~/.smallkhoj/daemon`，
  直接跑第二个 daemon 会覆盖 qq 的 credential → 用隔离 HOME 解决。
- 隔离 HOME 缺 claude 认证 → runtime warmup 卡住 → 复制真实 `~/.claude.json`+settings 解决。
- runtime 停掉后（daemon 重启）不会自动重启，需把 agent_workspaces.status 拨回
  `pending_start` 触发下一次心跳的 start 命令（rearm 逻辑受 `runtime_should_autostart`
  + 90s grace 影响，本场景没自动 rearm）。

**结论：官方 server 的 daemon + agent 接入链路是通的**（daemon→computer→agent→
runtime→online 全部验证）。**唯一缺口是 agent 的对话调用入口**：@mention 不触发，
需确认产品 intended 的调用方式（疑似走 Task）。

---

## 🧹 测试遗留数据

验证期间临时造的测试账号 / server 已全部清理（Sqteam/szphh、livedev/shazw、
verify-user-temp，及其 channels/memberships/messages）。
`backend/.env` 现为 `OFFICIAL_SERVER_HANDLE=s8pz9`（指向真正的官方 server AuarServer）。
