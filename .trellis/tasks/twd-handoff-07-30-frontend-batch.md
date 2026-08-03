# twd 测试交接：07-30 前端三连任务（perf / activity-indicators / background-notifications）

写给执行 UI 验证的 agent。代码实现已全部完成并通过静态验证（lint / typecheck / 241 单测 / i18n 对齐），本文档只覆盖**真机可见证据**部分。三个任务的 PRD 分别在 `.trellis/tasks/07-30-*/prd.md`，验收标准以 PRD 的 Acceptance Criteria 为准。

## 环境与启动

- 代码在 **worktree**：`/Users/code/project/smallkhoj-frontend-perf-optimization`（分支 `feat/frontend-perf-optimization`）。**所有被测前端代码都在这个 worktree，不在 main 工作区。**
- 启动前端：`cd /Users/code/project/smallkhoj-frontend-perf-optimization/frontend && PORT=3000 bun run dev`
- 后端：main 工作区的 :8000（之前一直在跑；若不在，按项目常规方式启动）。
- 浏览器驱动：用主仓库的 `./twd`（`/Users/code/project/smallkhoj/twd`），**不要直接调 twd.py，不要用 Playwright**。流程与证据规范见 `docs/real-test-sop-template.md`、`docs/real-runtime-dm-reply-sop.md`。
- 需要已登录会话；测试账号沿用 SOP 里的既有做法。

## 改动地图（知道测什么、在哪看）

### Task 1 `07-30-frontend-perf-optimization`（行为应保持不变的回归面）
- SSE 单连接：`frontend/components/realtime-provider.tsx`（全局唯一连接）+ `lib/realtime-owner.ts`（订阅分发）。所有页面共用一条 `/api/v1/events/stream`。
- 聊天组件拆分：`app/(app)/chat/[channel]/` 下 `channel-client.tsx`（编排）+ `message-list.tsx` + `composer.tsx` + `chat-types.ts`；`components/markdown-message.tsx` 加了 memo。
- Task board：`components/task-board.tsx` SSE 失效事件改为后台刷新（不再闪 loading）；`TaskMemoryInline` loading 改为布尔 prop。

### Task 2 `07-30-realtime-activity-indicators`
- 状态层：`lib/activity-unread-state.ts`（统一存储 `smallkhoj.activity.unread.v1`，键带域前缀 `chat:`/`task:all`/`activity:all`；旧 key `smallkhoj.chat.unread.v1` 读取时一次性迁移）。
- 跟踪器（无 UI）：`components/activity-unread-tracker.tsx`，挂在 `app/(app)/layout.tsx`。
- 展示原件：`components/activity-indicator.tsx` + `hooks/use-activity-indicator.ts`。
- 集成点：`components/app-rail.tsx`（chat 图标=计数徽标，tasks/activity 图标=红点）；`app/(app)/chat/[channel]/chat-sidebar.tsx`（迁移到统一 store）。

### Task 3 `07-30-background-notifications`
- 纯逻辑：`lib/background-notifications.ts`（事件→通知计划 + 抑制 + 30s 节流）、`lib/notification-preferences.ts`（三域开关，存 `smallkhoj.notifications.v1`）。
- 跟踪器（无 UI）：`components/background-notification-tracker.tsx`，挂在 `app/(app)/layout.tsx`，复用同一条 SSE。
- 设置 UI：`components/notification-settings.tsx`，在 `/settings` 页「Notifications / 通知」卡片。
- i18n：`messages/en.json` / `zh-CN.json` 新增 `settings.notifications.*` 与顶层 `notifications.*`。

## 测试场景（按任务）

### Task 1 — SSE 单连接 + 聊天回归
1. **单连接证据**：登录后依次浏览 /chat/<channel> → /tasks → /members → /daemon → /settings，DevTools Network 过滤 `events/stream`：全程只有 **1 条** SSE 连接（切页不新增、不断开重连风暴）。可用 `twd cdp` Network domain 或 `twd eval` 检查。截图/记录证据。
2. **聊天功能回归**（拆分后行为不变）：打开某频道，发消息、开 thread 回复、加 reaction、收藏消息、发送 asTask、desk 材质（material）交互、Markdown 渲染、滚动到底。逐项可见验证。
3. **Task board 后台刷新**：停留在 /tasks，触发一个 task 更新事件（见下方「事件触发方法」）：看板内容更新但**不出现整板 loading 闪烁**。

### Task 2 — 红点/计数指示
4. **AppRail chat 计数**：停留在 /tasks（非 chat 页），从另一成员向当前账号发 DM（或在他频道发消息）：rail 上 chat 图标出现**计数徽标**；再发一条计数 +1。
5. **tasks/activity 红点**：停留在 /chat，触发 task.created/updated → tasks 图标红点；触发 agent 状态变化（member.status.updated）→ activity(Bell) 图标红点。
6. **访问清除**：带着 tasks 红点点击进入 /tasks → 红点消失；进入 /daemon → activity 红点消失。
7. **当前路由抑制**：停留在 /chat 任意页时 chat 徽标不显示（被抑制）；侧栏内当前打开的频道/DM 不显示未读。
8. **聊天侧栏未读**：收到其它频道消息 → 侧栏对应频道出现未读计数；点开该频道 → 计数清零（含服务端 read-cursor 回写，刷新页面后不复活）。
9. **持久化**：收到未读后**刷新页面**，rail/侧栏未读仍在（localStorage `smallkhoj.activity.unread.v1`）。可选验证迁移：手工在 localStorage 写旧 key `smallkhoj.chat.unread.v1` = `{"channel:id:<id>":{"count":2,"lastSeq":5}}`，刷新后旧 key 被删除、未读出现在新 key 下。
10. **自发不计**：当前账号自己发消息，自己不产生未读。

### Task 3 — 后台系统通知
前置：/settings 的 Notifications 卡片点「Enable notifications」授权；确认状态徽标显示 Granted（被拒时验证 denied 引导文案展示、控制台无未捕获错误）。
11. **后台 DM 通知 + 点击直达**（PRD 首条验收）：把 SmallKhoj 标签页切到后台（聚焦另一个标签页/窗口），从另一成员发 DM → 出现系统通知；点击通知 → 窗口聚焦且落在 `/chat/<DM名>`。
12. **聚焦抑制**：停留在该 DM 页面且窗口聚焦时收到消息 → **不**弹系统通知。
13. **频道 @提及**：后台时他人在频道发 `@<你>` → 通知；不发提及的普通频道消息 → 不通知（宁缺毋滥）。
14. **任务/ memory 通知**：后台时触发 task.created/updated、memory proposal → 各自域通知；点击落在 `/tasks?task=<id>` / 对应页。
15. **域开关**：/settings 关掉 chat 开关 → DM 不再通知（刷新页面开关保持）；打开恢复。
16. **节流折叠**：30s 内同 scope 连发多条 → 只弹第一条 + 窗口结束时一条折叠汇总（「N 条新消息」），不逐条弹。
17. **无新增 SSE**：通知功能开启前后，Network 中 `events/stream` 连接数不变（仍 1 条）。

## 事件触发方法

- **DM/频道消息**：用第二个账号/成员（或后端 API 直接 POST 消息，参照 `docs/real-runtime-dm-reply-sop.md` 的既有做法）。
- **task 事件**：在 /tasks 创建或更新任务（用另一会话/成员身份，或用 API）。
- **agent 状态事件**：启动/停止一个 agent worker，或按 SOP 触发 member.status.updated。
- **memory proposal**：在频道里触发 agent 产出 memory 提案（既有 SOP 流程）。
- **重放去重**（可选）：断开重连 SSE（如重启后端事件流或 Network offline/online），同一 epoch/seq 事件重放后未读计数与通知不重复。

## 注意

- 不要改代码；发现 bug 记录复现步骤、截图、console/网络证据，回传给实现方（我）。
- main 工作区 `/Users/code/project/smallkhoj` 有未提交脏文件，与本批次无关，别碰别提交。
- 任何 git commit/push/PR 都不在测试 agent 职责内。

---

## 追加（2026-08-02）：DM 未读清不掉的 bug 已修复，需复测

测试发现的「进 DM 后徽标只增不减」（截图中 chat 徽标卡在 4）根因在后端，已修：

- **后端**（main 工作区 `/Users/code/project/smallkhoj`，未提交）：`backend/services/public_events.py` `_event_scope()` 的 message.*/file.*/reaction.updated 分支，scope.kind 由硬编码 `"channel"` 改为按 `payload.channelType` 区分（DM → `"dm"`）。改前确认过 `should_deliver_public_event`：只在订阅方显式传 scopeKind 时过滤，前端全局 SSE 不传，无影响。新增回归测试 `test_dm_message_event_uses_dm_scope_kind_from_channel_type` 等，`pytest tests/test_public_events.py` 22 passed、`test_chat_read_cursors.py` 27 passed。**需要 rebuild backend 镜像并重启栈后生效。**
- **前端**（worktree，未提交）：`frontend/lib/chat-unread-state.ts` `chatEntityKeys` 对 DM 实体追加旧 `chat:channel:*` 别名键——修复前污染的 localStorage 计数（写在 channel 键下）进 DM 页时也能一并清除。前端 242 tests 全绿。

复测步骤：
1. rebuild backend 镜像 → 重启栈（前端镜像用 worktree 最新代码）。
2. 人给 agent 发 DM，抓 SSE：DM 事件 `scope.kind` 应为 `"dm"`。
3. 收到 DM → rail 出现徽标；localStorage `smallkhoj.activity.unread.v1` 里应是 `chat:dm:*` 键。
4. 点进该 DM → 徽标归零、侧栏红点消失；切走切回不复活；`chat_thread_read_cursors` 表有新行。
5. 旧污染兼容：手工往 localStorage 写 `chat:channel:id:<dmId>` / `chat:channel:name:<dmName>` 计数，进 DM 页后应被清除。

## 追加 2（2026-08-02）：未读清不掉的第二处根因已修（storage/React state 竞态）

scope.kind 修复后仍存在的「徽标只增不减」，根因是状态层两条写入路径不同步，已修（worktree，未提交）：

- `lib/activity-unread-state.ts` 新增 `clearActivityUnreadMarked(storage, target, keys)`：与 `markActivityUnread` 对称，**基于 localStorage 最新快照**清除、写回并广播 `ACTIVITY_UNREAD_EVENT`。
- `hooks/use-activity-unread-store.ts` 的 `clearKeys` 改为调用它，不再基于可能滞后的 React state `previous` 清除（旧代码在 sidebar 挂载 effect 先跑、state 尚未同步时找不到 key → 清不掉）。
- 附带收益：清除现在会广播事件，同标签页的其它 store 实例（AppRail 徽标）立即同步——之前即使清掉了 storage，rail 徽标也要等下一个事件才刷新。
- 新增单测覆盖（基于最新快照清除、写回、广播、无 key 时静默），前端 243 tests 全绿。

复测：正常登录 → 收 DM 有徽标 → 进 DM 徽标立即归零（rail 与侧栏同时）→ 切走切回不复活。
